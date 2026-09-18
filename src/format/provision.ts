import type { ProvisionReport } from "../lib/provision/run.js";

export const provisionLines = (
  report: ProvisionReport | undefined,
): string[] => {
  if (report === undefined) return [];

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
    }
  }

  if (!report.ok && report.logPath !== undefined) {
    lines.push(`  full output: ${report.logPath}`);
  }
  return lines;
};

export const renderProvision = (report: ProvisionReport): string =>
  `${[
    report.ok ? "Provisioned." : "Provisioning failed.",
    ...provisionLines(report),
  ].join("\n")}\n`;
