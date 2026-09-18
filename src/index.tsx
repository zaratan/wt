#!/usr/bin/env bun
import { resolve } from "node:path";
import { parse, flag, value } from "./cli/parse.js";
import { renderHelp } from "./cli/help.js";
import { dispatch } from "./cli/dispatch.js";
import { EXIT } from "./cli/exit.js";
import type { CommandContext } from "./commands/context.js";
import { askConfirm } from "./lib/tty/confirm.js";
import { interactiveResolvers } from "./ui/drive.js";
import { APP_VERSION } from "./version.js";

// The only place that reads ambient process state; everything below takes it
// as a parameter. Enforced by no-restricted-properties in eslint.config.js.
const argv = process.argv.slice(2);
const env = process.env;
const processCwd = process.cwd();

const result = parse(argv);

switch (result.kind) {
  case "version": {
    process.stdout.write(`wt ${APP_VERSION}\n`);
    process.exit(EXIT.OK);
    break;
  }

  case "help": {
    process.stdout.write(renderHelp(result.topic));
    process.exit(EXIT.OK);
    break;
  }

  case "error": {
    process.stderr.write(`${result.message}\n`);
    if (result.hint !== undefined) {
      process.stderr.write(`  ${result.hint}\n`);
    }
    const topic = result.helpTopic;
    process.stderr.write(
      topic === undefined
        ? "\nRun `wt help` for the list of commands.\n"
        : `\nRun \`wt help ${topic}\` for the full list.\n`,
    );
    process.exit(EXIT.USAGE);
    break;
  }

  case "run": {
    const { options } = result.invocation;
    const json = flag(options, "json", false);
    const verbose = flag(options, "verbose", false);
    const cwdOverride = value(options, "cwd");

    const interactive =
      process.stdout.isTTY &&
      process.stdin.isTTY &&
      !json &&
      !flag(options, "yes", false);

    const aborter = new AbortController();
    // Ink owns stdout and Ctrl-C while a screen is up; the process handler
    // would otherwise write "stopping…" straight into the frame.
    const inkHeld = { current: false };
    const resolvers = interactive
      ? interactiveResolvers(inkHeld)
      : { chooseRepo: undefined };

    const context: CommandContext = {
      cwd:
        cwdOverride === undefined
          ? processCwd
          : resolve(processCwd, cwdOverride),
      env,
      options,
      json,
      yes: json || flag(options, "yes", false),
      verbose,
      dryRun: flag(options, "dry-run", false),
      interactive,
      confirm: interactive
        ? (question) =>
            askConfirm(
              { input: process.stdin, output: process.stderr },
              question,
            )
        : undefined,
      signal: aborter.signal,
      pid: process.pid,
      chooseRepo: resolvers.chooseRepo,
      trace: verbose
        ? (line) => {
            process.stderr.write(`${line}\n`);
          }
        : undefined,
    };

    // First Ctrl-C asks every child to stop and lets the command record what
    // it did; a second one means the user is done waiting.
    const interrupt = { requested: false };
    const onInterrupt = (): void => {
      if (interrupt.requested) process.exit(EXIT.INTERRUPTED);
      interrupt.requested = true;
      if (!inkHeld.current) {
        process.stderr.write("\nstopping… (Ctrl-C again to quit now)\n");
      }
      aborter.abort();
    };
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);

    const output = await dispatch(result.invocation, context);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    if (output.stdout !== undefined) process.stdout.write(output.stdout);
    if (output.stderr !== undefined) process.stderr.write(output.stderr);
    process.exit(interrupt.requested ? EXIT.INTERRUPTED : output.code);
    break;
  }
}
