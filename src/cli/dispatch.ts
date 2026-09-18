import { doctor } from "../commands/doctor.js";
import { runNew } from "../commands/new.js";
import { runLs } from "../commands/ls.js";
import { runStatus } from "../commands/status.js";
import { runRm } from "../commands/rm.js";
import { runOpen } from "../commands/open.js";
import { runProvision } from "../commands/provision.js";
import type { CommandContext } from "../commands/context.js";
import { renderDoctor } from "../format/doctor.js";
import { renderNew } from "../format/new.js";
import { renderLs } from "../format/ls.js";
import { renderStatus } from "../format/status.js";
import { renderRm } from "../format/rm.js";
import { checkLayout } from "../format/layout.js";
import { renderOpen } from "../format/open.js";
import { renderProvision } from "../format/provision.js";
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
          open: flag(invocation.options, "open", true),
          provision: flag(invocation.options, "provision", true),
          focus: flag(invocation.options, "focus", context.interactive),
          layout: value(invocation.options, "layout"),
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

    case "provision": {
      const branch = invocation.positionals.branch;
      if (branch === undefined) {
        return { stderr: "wt provision: missing <branch>\n", code: EXIT.USAGE };
      }
      const result = await runProvision(
        { repo: value(invocation.options, "repo"), branch },
        context,
      );
      if (context.json) {
        return {
          stdout: `${JSON.stringify(result, null, 2)}\n`,
          code:
            result.kind === "ok" && result.report.ok ? EXIT.OK : EXIT.PARTIAL,
        };
      }
      if (result.kind !== "ok") {
        return {
          stderr: `wt provision: ${result.kind === "error" ? result.message : "pick a repository"}\n`,
          code: EXIT.ERROR,
        };
      }
      return {
        stdout: renderProvision(result.report),
        code: result.report.ok ? EXIT.OK : EXIT.PARTIAL,
      };
    }

    case "open": {
      const target = invocation.positionals.target;
      if (target === undefined) {
        return { stderr: "wt open: missing <target>\n", code: EXIT.USAGE };
      }
      const result = await runOpen(
        {
          repo: value(invocation.options, "repo"),
          target,
          focus: flag(invocation.options, "focus", context.interactive),
          layout: value(invocation.options, "layout"),
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
      const text = renderOpen(result);
      return result.kind === "error" || result.kind === "choose"
        ? { stderr: text, code: EXIT.ERROR }
        : { stdout: text, code: EXIT.OK };
    }

    case "layout": {
      const dsl = invocation.positionals.dsl;
      if (dsl === undefined) {
        return { stderr: "wt layout: missing <dsl>\n", code: EXIT.USAGE };
      }
      const checked = checkLayout(dsl);
      return checked.ok
        ? { stdout: checked.text, code: EXIT.OK }
        : { stderr: checked.text, code: EXIT.USAGE };
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
          keepSpace: flag(invocation.options, "keep-space", false),
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
