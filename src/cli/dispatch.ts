import { doctor } from "../commands/doctor.js";
import { runNew } from "../commands/new.js";
import type { CommandContext } from "../commands/context.js";
import { renderDoctor } from "../format/doctor.js";
import { renderNew } from "../format/new.js";
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
