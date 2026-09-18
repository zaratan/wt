/**
 * Invocation → command → output.
 *
 * Commands return data; this layer turns it into bytes and an exit code, so a
 * command never formats and `--json` stays a rendering decision.
 */
import { doctor } from "../commands/doctor.js";
import type { CommandContext } from "../commands/context.js";
import { renderDoctor } from "../format/doctor.js";
import { EXIT } from "./exit.js";
import type { ExitCode } from "./exit.js";
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
