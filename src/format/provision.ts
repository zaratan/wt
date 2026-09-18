import type { ProvisionReport } from "../lib/provision/run.js";
import type { ProvisionResult } from "../commands/provision.js";

export const interruptedIn = (report: ProvisionReport): boolean =>
  report.commands.some((command) => command.outcome === "interrupted");

export const provisionLines = (
  report: ProvisionReport | undefined,
): string[] => {
  if (report === undefined) return [];

  const blocked = report.blockedBy;
  if (blocked !== undefined) {
    return [
      `  another wt (pid ${String(blocked.pid)}) is already provisioning this worktree`,
      `  started ${blocked.since}`,
    ];
  }

  const lines: string[] = [];
  const copied = report.copies.filter((entry) => entry.outcome === "copied");
  if (copied.length > 0) {
    lines.push(`  copied  ${copied.map((entry) => entry.path).join(", ")}`);
  }
  for (const entry of report.copies) {
    if (entry.outcome === "failed") {
      lines.push(`  ! copy ${entry.path} failed: ${entry.detail ?? ""}`);
    }
  }

  for (const command of report.commands) {
    switch (command.outcome) {
      case "ran":
        lines.push(`  ran     ${command.run}`);
        break;
      case "skipped":
        lines.push(`  skipped ${command.run}`);
        break;
      case "timed-out":
        lines.push(`  ! ${command.run} timed out`);
        break;
      case "failed":
        lines.push(
          `  ! ${command.run} failed${command.code === undefined ? "" : ` (exit ${String(command.code)})`}`,
        );
        for (const line of (command.tail ?? []).slice(-20)) {
          lines.push(`      ${line}`);
        }
        break;
      case "interrupted":
        lines.push(`  ! ${command.run} interrupted`);
        break;
      default: {
        // An outcome with no branch printed nothing at all: `interrupted`
        // vanished this way, leaving `wt new` announcing a plain success.
        const unhandled: never = command.outcome;
        lines.push(`  ! ${command.run}: ${String(unhandled)}`);
      }
    }
  }

  if (!report.ok && report.logPath !== undefined) {
    lines.push(`  full output: ${report.logPath}`);
  }
  return lines;
};

export const renderProvision = (report: ProvisionReport): string =>
  `${[
    report.ok
      ? "Provisioned."
      : report.blockedBy !== undefined
        ? "Not provisioned: another wt holds it."
        : interruptedIn(report)
          ? "Provisioning interrupted."
          : "Provisioning failed.",
    ...provisionLines(report),
  ].join("\n")}\n`;

export const renderProvisionFailure = (
  result: Extract<ProvisionResult, { kind: "error" | "choose" }>,
): string =>
  result.kind === "error"
    ? [
        `wt provision: ${result.message}`,
        ...(result.hint === undefined ? [] : [`  ${result.hint}`]),
        "",
      ].join("\n")
    : [
        `Several repositories live under ${result.from}:`,
        "",
        ...result.candidates.map((candidate) => `  ${candidate.name}`),
        "",
        `Name one:  wt provision ${result.candidates[0]?.name ?? "<repo>"} <branch>`,
        "",
      ].join("\n");
