import { doctor } from "../commands/doctor.js";
import { runNew } from "../commands/new.js";
import { runLs } from "../commands/ls.js";
import { runStatus } from "../commands/status.js";
import { runRm } from "../commands/rm.js";
import type { CommandContext } from "../commands/context.js";
import { renderDoctor } from "../format/doctor.js";
import { renderNew } from "../format/new.js";
import { renderLs } from "../format/ls.js";
import { renderStatus } from "../format/status.js";
import { renderRm } from "../format/rm.js";
import { EXIT } from "./exit.js";
import type { ExitCode } from "./exit.js";
import { flag, value } from "./parse.js";
import type { Invocation } from "./parse.js";

export type Output = {
  stdout?: string;
  stderr?: string;
  code: ExitCode;
};

export const dispatch = async (
  invocation: Invocation,
  context: CommandContext,
): Promise<Output> => {
  switch (invocation.spec.name) {
    case "new": {
      const branch = invocation.positionals.branch;
      if (branch === undefined) {
        return { stderr: "wt new: missing <branch>\n", code: EXIT.USAGE };
      }
      const result = await runNew(
        {
          repo: invocation.positionals.repo,
          branch,
          as: value(invocation.options, "as"),
          from: value(invocation.options, "from"),
          fetch: flag(invocation.options, "fetch", true),
          gitignore: flag(invocation.options, "gitignore", true),
          forceUmbrella: invocation.options.umbrella as boolean | undefined,
        },
        context,
      );

      if (context.json) {
        return {
          stdout: `${JSON.stringify(result, null, 2)}\n`,
          code:
            result.kind === "error" || result.kind === "choose"
              ? EXIT.ERROR
              : EXIT.OK,
        };
      }

      const text = renderNew(result, context.cwd);
      if (result.kind === "error" || result.kind === "choose") {
        return { stderr: text, code: EXIT.ERROR };
      }
      return { stdout: text, code: EXIT.OK };
    }

    case "ls": {
      const result = await runLs(
        {
          repo: value(invocation.options, "repo"),
          all: flag(invocation.options, "all", false),
        },
        context,
      );

      if (context.json) {
        return {
          stdout: `${JSON.stringify(result, null, 2)}\n`,
          code: result.kind === "ok" ? EXIT.OK : EXIT.ERROR,
        };
      }
      const text = renderLs(result);
      return result.kind === "ok"
        ? { stdout: text, code: EXIT.OK }
        : { stderr: text, code: EXIT.ERROR };
    }

    case "rm": {
      const target =
        invocation.positionals.target ?? invocation.positionals.branch;
      if (target === undefined) {
        return { stderr: "wt rm: missing <target>\n", code: EXIT.USAGE };
      }
      const result = await runRm(
        {
          repo: value(invocation.options, "repo"),
          target,
          force: flag(invocation.options, "force", false),
          deleteBranch: invocation.options["delete-branch"] as
            | boolean
            | undefined,
        },
        context,
      );

      if (context.json) {
        return {
          stdout: `${JSON.stringify(result, null, 2)}\n`,
          code:
            result.kind === "removed" || result.kind === "planned"
              ? EXIT.OK
              : EXIT.ERROR,
        };
      }
      const text = renderRm(result);
      return result.kind === "removed" || result.kind === "planned"
        ? { stdout: text, code: EXIT.OK }
        : { stderr: text, code: EXIT.ERROR };
    }

    case "status": {
      const result = await runStatus(
        {
          repo: value(invocation.options, "repo"),
          target: invocation.positionals.target,
        },
        context,
      );

      if (context.json) {
        return {
          stdout: `${JSON.stringify(result, null, 2)}\n`,
          code: result.kind === "ok" ? EXIT.OK : EXIT.ERROR,
        };
      }
      const text = renderStatus(result);
      return result.kind === "ok"
        ? { stdout: text, code: EXIT.OK }
        : { stderr: text, code: EXIT.ERROR };
    }

    case "prune": {
      const result = await runLs(
        { repo: value(invocation.options, "repo"), all: true },
        context,
      );
      if (result.kind !== "ok") {
        return { stderr: renderLs(result), code: EXIT.ERROR };
      }
      const { orphans, pruned } = result.report;
      const report = [
        pruned ? "Pruned stale git entries." : "No stale git entries.",
        ...(orphans.length === 0
          ? []
          : [
              "",
              "Directories git does not know about (left alone):",
              ...orphans.map((orphan) => `  ${orphan.path}`),
            ]),
        "",
      ].join("\n");
      return { stdout: report, code: EXIT.OK };
    }

    case "doctor": {
      const report = await doctor(context);
      if (context.json) {
        return {
          stdout: `${JSON.stringify(report, null, 2)}\n`,
          code: EXIT.OK,
        };
      }
      const unhealthy =
        report.git.kind !== "ok" ||
        report.topology === undefined ||
        report.topology.kind === "error" ||
        report.topology.topology.guards.some((guard) => guard.violated);
      return {
        stdout: renderDoctor(report),
        code: unhealthy ? EXIT.ERROR : EXIT.OK,
      };
    }

    default:
      return {
        stderr: `wt ${invocation.spec.name}: not implemented yet.\n`,
        code: EXIT.ERROR,
      };
  }
};
