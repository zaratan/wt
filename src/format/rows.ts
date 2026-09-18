import { basename } from "node:path";
import type { Unpublished, WorktreeStatus } from "../lib/git/status.js";
import type { OpenSpace, SpaceIndex } from "../commands/spaces.js";

export type RowSeverity = "clean" | "notes" | "gone";

export type WorktreeRow = {
  status: WorktreeStatus;
  /** Which repository it belongs to, shown only when a listing spans several. */
  repo: string;
  /** Passed back to every command: the cwd alone cannot say which repo. */
  repoRoot: string;
  name: string;
  branch: string;
  severity: RowSeverity;
  notes: readonly string[];
  space?: OpenSpace;
  /** The worktree the command was run from, if it is one of these. */
  here: boolean;
};

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

/**
 * What `WorktreeStatus` alone can tell. `wt rm` also refuses on a live process
 * in the tree, which no status carries, so a refusal can still surprise a row
 * that looks clean — the caller must show what `runRm` answered.
 */
export const rowNotes = (status: WorktreeStatus): readonly string[] => {
  const out: string[] = [];
  if (status.missing) out.push("MISSING");
  if (status.prunable) out.push("prunable");
  if (status.operation !== undefined) {
    out.push(`${status.operation} in progress`);
  }
  if (status.modified > 0) out.push(`${String(status.modified)} modified`);
  if (status.untracked > 0) out.push(`${String(status.untracked)} untracked`);

  const unpublished = unpublishedNote(status.unpublished);
  if (unpublished !== undefined) out.push(unpublished);
  if (!status.managed && !status.isMain) out.push("unmanaged");
  return out;
};

export const rowSeverity = (status: WorktreeStatus): RowSeverity => {
  if (status.missing || status.prunable) return "gone";
  return rowNotes(status).length > 0 ? "notes" : "clean";
};

const inside = (cwd: string, path: string): boolean =>
  cwd === path || cwd.startsWith(`${path}/`);

export const worktreeRows = (
  listed: readonly {
    topology: { repoName: string; repoRoot: string };
    status: WorktreeStatus;
  }[],
  spaces: SpaceIndex,
  cwd: string,
): readonly WorktreeRow[] =>
  listed.map(({ topology, status }) => ({
    status,
    repo: topology.repoName,
    repoRoot: topology.repoRoot,
    name: status.isMain
      ? `${basename(status.path)} (main)`
      : basename(status.path),
    branch: status.detached ? "(detached)" : (status.branch ?? "(no branch)"),
    severity: rowSeverity(status),
    notes: rowNotes(status),
    space: spaces.byCheckout?.get(status.path),
    here: inside(cwd, status.path),
  }));

export const spaceNote = (space: OpenSpace | undefined): string | undefined => {
  if (space === undefined) return undefined;
  const state = space.focused ? "space focused" : "space open";
  return space.label === undefined ? state : `${state} (${space.label})`;
};

/** The one description of a row's trailing text, shared by every renderer. */
export const rowDetail = (
  row: WorktreeRow,
  withRepo: boolean,
): readonly string[] => [
  // Never on a main checkout: its directory name already IS the repository.
  ...(withRepo && !row.status.isMain ? [row.repo] : []),
  ...(row.here ? ["here"] : []),
  ...(spaceNote(row.space) === undefined ? [] : [spaceNote(row.space) ?? ""]),
  ...row.notes,
];
