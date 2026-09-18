#!/usr/bin/env bun
import { parse } from "./cli/parse.js";
import { renderHelp } from "./cli/help.js";
import { EXIT } from "./cli/exit.js";
import { APP_VERSION } from "./version.js";

// The only place that reads ambient process state. Everything downstream takes
// it as a parameter — that is what makes `--cwd` honest and the layers testable
// (enforced by no-restricted-properties in eslint.config.js).
const argv = process.argv.slice(2);

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
    // Usage errors go to stderr so `--json` consumers keep a clean stdout.
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
    // Phase 1A ships the CLI surface; the commands land in 1B and 1C.
    process.stderr.write(
      `wt ${result.invocation.spec.name}: not implemented yet.\n`,
    );
    process.exit(EXIT.ERROR);
    break;
  }
}
