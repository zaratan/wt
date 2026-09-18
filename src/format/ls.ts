import { basename } from "node:path";
import type { LsResult } from "../commands/ls.js";
import type { Unpublished, WorktreeStatus } from "../lib/git/status.js";

const pad = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - text.length));

const unpublishedNote = (unpublished: Unpublished): string | undefined => {
  switch (unpublished.kind) {
    case "count":
      return unpublished.count === 0
        ? undefined
        : `${String(unpublished.count)} unpublished`;
    case "no-remote":
      return unpublished.count === 0 ? undefined : "never published";
    case "unborn":
      return "no commit yet";
    case "unknown":
      return undefined;
  }
};

const notes = (status: WorktreeStatus): string[] => {
  const out: string[] = [];
  if (status.missing) out.push("MISSING");
  if (status.prunable) out.push("prunable");
  if (status.operation !== undefined)
    out.push(`${status.operation} in progress`);
  if (status.modified > 0) out.push(`${String(status.modified)} modified`);
  if (status.untracked > 0) out.push(`${String(status.untracked)} untracked`);

  const unpublished = unpublishedNote(status.unpublished);
  if (unpublished !== undefined) out.push(unpublished);
  if (!status.managed && !status.isMain) out.push("unmanaged");
  return out;
};

const marker = (status: WorktreeStatus): string => {
  if (status.missing || status.prunable) return "✗";
  if (notes(status).length > 0) return "•";
  return "·";
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
      detail: notes(status),
    }));

    const nameWidth = Math.max(...rows.map((row) => row.name.length));
    const branchWidth = Math.max(...rows.map((row) => row.branch.length));

    for (const row of rows) {
      const space =
        row.space === undefined
          ? []
          : [
              `space ${row.space.focused ? "focused" : "open"}${
                row.space.label === undefined ? "" : ` (${row.space.label})`
              }`,
            ];
      lines.push(
        `  ${marker(row.status)} ${pad(row.name, nameWidth)}  ${pad(row.branch, branchWidth)}  ${[...space, ...row.detail].join(", ")}`.trimEnd(),
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
