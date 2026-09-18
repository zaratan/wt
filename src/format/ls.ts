import type { LsResult } from "../commands/ls.js";
import { basename } from "node:path";
import { rowDetail, rowSeverity, worktreeRows } from "./rows.js";
import type { WorktreeStatus } from "../lib/git/status.js";

const pad = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - text.length));

const marker = (status: WorktreeStatus): string => {
  const severity = rowSeverity(status);
  return severity === "gone" ? "✗" : severity === "notes" ? "•" : "·";
};

export const renderLs = (result: LsResult, cwd = ""): string => {
  if (result.kind === "choose") {
    return [
      `Several repositories live under ${result.from}:`,
      "",
      ...result.candidates.map((candidate) => `  ${candidate.name}`),
      "",
      `Name one:  wt ls --repo ${result.candidates[0]?.name ?? "<repo>"}`,
      "",
    ].join("\n");
  }

  if (result.kind === "error") {
    return [
      `wt ls: ${result.message}`,
      ...(result.hint === undefined ? [] : [`  ${result.hint}`]),
      "",
    ].join("\n");
  }

  const { report } = result;
  // A listing that spans a working folder is named after the folder, not after
  // whichever repository happened to be resolved first.
  const lines: string[] = [
    report.repos.length > 1
      ? basename(report.topology.parent)
      : report.topology.repoName,
    "",
  ];

  if (report.worktrees.length === 0) {
    lines.push("  no worktrees");
  } else {
    const rows = worktreeRows(report.worktrees, report.spaces, cwd);
    const several = report.repos.length > 1;

    const nameWidth = Math.max(...rows.map((row) => row.name.length));
    const branchWidth = Math.max(...rows.map((row) => row.branch.length));

    for (const row of rows) {
      const detail = rowDetail(row, several).join(", ");
      lines.push(
        `  ${marker(row.status)} ${pad(row.name, nameWidth)}  ${pad(row.branch, branchWidth)}  ${detail}`.trimEnd(),
      );
    }
  }

  if (report.orphans.length > 0) {
    lines.push("", "Directories git does not know about:");
    for (const orphan of report.orphans) lines.push(`  ? ${orphan.path}`);
  }

  const unavailable = report.spaces.unavailable;
  if (unavailable !== undefined) {
    lines.push("", `  herdr not reachable, spaces unknown: ${unavailable}`);
  }

  if (report.pruned) lines.push("", "  (pruned stale entries)");

  lines.push("");
  return lines.join("\n");
};
