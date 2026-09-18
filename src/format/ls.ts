import { basename } from "node:path";
import type { LsResult } from "../commands/ls.js";
import { rowNotes, rowSeverity, spaceNote } from "./rows.js";
import type { WorktreeStatus } from "../lib/git/status.js";

const pad = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - text.length));

const marker = (status: WorktreeStatus): string => {
  const severity = rowSeverity(status);
  return severity === "gone" ? "✗" : severity === "notes" ? "•" : "·";
};

export const renderLs = (result: LsResult): string => {
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
  const lines: string[] = [report.topology.repoName, ""];

  if (report.worktrees.length === 0) {
    lines.push("  no worktrees");
  } else {
    const spaces = report.spaces.byCheckout;
    const rows = report.worktrees.map((status) => ({
      status,
      space: spaces?.get(status.path),
      name: status.isMain
        ? `${basename(status.path)} (main)`
        : basename(status.path),
      branch: status.detached ? "(detached)" : (status.branch ?? "(no branch)"),
      detail: [
        ...(spaceNote(spaces?.get(status.path)) === undefined
          ? []
          : [spaceNote(spaces?.get(status.path)) ?? ""]),
        ...rowNotes(status),
      ],
    }));

    const nameWidth = Math.max(...rows.map((row) => row.name.length));
    const branchWidth = Math.max(...rows.map((row) => row.branch.length));

    for (const row of rows) {
      lines.push(
        `  ${marker(row.status)} ${pad(row.name, nameWidth)}  ${pad(row.branch, branchWidth)}  ${row.detail.join(", ")}`.trimEnd(),
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
