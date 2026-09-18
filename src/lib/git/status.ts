import { sep } from "node:path";
import { lines, okStdout, type Git } from "./exec.js";
import type { WorktreeEntry } from "./topology.js";

export type GitOperation =
  | "rebase"
  | "merge"
  | "cherry-pick"
  | "revert"
  | "bisect";

/**
 * `rev-list --count HEAD --not --remotes` is the only count that works without
 * an upstream, but it needs framing: with no remote everything counts, and on an
 * unborn or detached HEAD the plain reading is wrong.
 */
export type Unpublished =
  | { kind: "count"; count: number; sample: readonly string[] }
  | { kind: "no-remote"; count: number }
  | { kind: "unborn" }
  | { kind: "unknown" };

export type WorktreeStatus = {
  path: string;
  branch?: string;
  detached: boolean;
  prunable: boolean;
  isMain: boolean;
  /** Under the worktrees root wt manages, as opposed to herdr's or a manual one. */
  managed: boolean;
  missing: boolean;
  modified: number;
  untracked: number;
  unpublished: Unpublished;
  operation?: GitOperation;
  /** How long ago the freshest remote ref moved; a stale cache fakes a clean tree. */
  remoteRefAge?: string;
};

const OPERATION_MARKERS: readonly (readonly [GitOperation, string])[] = [
  ["rebase", "rebase-merge"],
  ["rebase", "rebase-apply"],
  ["merge", "MERGE_HEAD"],
  ["cherry-pick", "CHERRY_PICK_HEAD"],
  ["revert", "REVERT_HEAD"],
  ["bisect", "BISECT_LOG"],
];

/**
 * These live in the worktree's own git dir, not the common one. Joining them to
 * the common dir passes every test written against the main checkout and sees
 * nothing in a linked worktree — the only place the guard matters.
 */
const operationInProgress = async (
  git: Git,
  worktreePath: string,
  exists: (path: string) => Promise<boolean>,
): Promise<GitOperation | undefined> => {
  for (const [operation, marker] of OPERATION_MARKERS) {
    const path = okStdout(
      await git(["rev-parse", "--git-path", marker], { cwd: worktreePath }),
    );
    if (path !== undefined && (await exists(path))) return operation;
  }
  return undefined;
};

const countWorkingTree = (
  porcelain: string,
): { modified: number; untracked: number } => {
  let modified = 0;
  let untracked = 0;
  for (const line of lines(porcelain)) {
    if (line.startsWith("??")) untracked += 1;
    else modified += 1;
  }
  return { modified, untracked };
};

const unpublishedCommits = async (
  git: Git,
  worktreePath: string,
): Promise<Unpublished> => {
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd: worktreePath,
  });
  if (head.kind !== "ran" || head.code !== 0) return { kind: "unborn" };

  const counted = okStdout(
    await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], {
      cwd: worktreePath,
    }),
  );
  if (counted === undefined) return { kind: "unknown" };

  const count = Number.parseInt(counted, 10);
  if (Number.isNaN(count)) return { kind: "unknown" };

  const remotes = okStdout(await git(["remote"], { cwd: worktreePath }));
  if (remotes === undefined || remotes === "") {
    return { kind: "no-remote", count };
  }

  const sample =
    count === 0
      ? []
      : lines(
          okStdout(
            await git(
              ["log", "--oneline", "-n", "5", "HEAD", "--not", "--remotes"],
              { cwd: worktreePath },
            ),
          ) ?? "",
        );

  return { kind: "count", count, sample };
};

const freshestRemoteRefAge = async (
  git: Git,
  worktreePath: string,
): Promise<string | undefined> => {
  const age = okStdout(
    await git(
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--count=1",
        "--format=%(committerdate:relative)",
        "refs/remotes",
      ],
      { cwd: worktreePath },
    ),
  );
  return age === undefined || age === "" ? undefined : age;
};

export type StatusInput = {
  entry: WorktreeEntry;
  repoRoot: string;
  worktreesRoot: string;
  exists: (path: string) => Promise<boolean>;
};

export const worktreeStatus = async (
  git: Git,
  input: StatusInput,
): Promise<WorktreeStatus> => {
  const { entry, repoRoot, worktreesRoot, exists } = input;
  const isMain = entry.path === repoRoot;
  const managed = entry.path.startsWith(worktreesRoot + sep);
  const missing = !(await exists(entry.path));

  const base: WorktreeStatus = {
    path: entry.path,
    branch: entry.branch,
    detached: entry.detached,
    prunable: entry.prunable,
    isMain,
    managed,
    missing,
    modified: 0,
    untracked: 0,
    unpublished: { kind: "unknown" },
  };

  if (missing) return base;

  const porcelain = okStdout(
    await git(["status", "--porcelain=v1", "--untracked-files=normal"], {
      cwd: entry.path,
    }),
  );

  const [counts, unpublished, operation, remoteRefAge] = await Promise.all([
    Promise.resolve(
      porcelain === undefined
        ? { modified: 0, untracked: 0 }
        : countWorkingTree(porcelain),
    ),
    unpublishedCommits(git, entry.path),
    operationInProgress(git, entry.path, exists),
    freshestRemoteRefAge(git, entry.path),
  ]);

  return { ...base, ...counts, unpublished, operation, remoteRefAge };
};

/** The working tree only. Publication is a separate question. */
export const isClean = (status: WorktreeStatus): boolean =>
  status.modified === 0 &&
  status.untracked === 0 &&
  status.operation === undefined;

/**
 * What `wt rm` refuses over. Commits that exist on no remote count even with no
 * remote configured — especially then, since there is nowhere to recover from.
 */
export const hasUnsavedWork = (status: WorktreeStatus): boolean => {
  if (!isClean(status)) return true;
  switch (status.unpublished.kind) {
    case "count":
    case "no-remote":
      return status.unpublished.count > 0;
    case "unborn":
    case "unknown":
      return false;
  }
};
