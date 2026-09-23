import { basename, join } from "node:path";
import type { Git } from "./exec.js";
import type { BranchPlan } from "./branch.js";
import type { WorktreeEntry } from "./topology.js";

export type AddOutcome =
  | { kind: "created"; path: string }
  | { kind: "failed"; message: string };

export const worktreeAddArgs = (
  plan: Exclude<BranchPlan, { kind: "occupied" }>,
  path: string,
): readonly string[] => {
  switch (plan.kind) {
    case "checkout-local":
      return ["worktree", "add", path, plan.branch];
    case "track-remote":
      return [
        "worktree",
        "add",
        "--track",
        "-b",
        plan.branch,
        path,
        `${plan.remote}/${plan.branch}`,
      ];
    case "create":
      // --no-track: branching from origin/develop otherwise inherits it as
      // upstream (branch.autoSetupMerge), so the first `git push` lands on
      // develop instead of on the new branch. A branch nobody has pushed has
      // no upstream; `git push -u` is what gives it one.
      return [
        "worktree",
        "add",
        "--no-track",
        "-b",
        plan.branch,
        path,
        plan.base,
      ];
  }
};

export const addWorktree = async (
  git: Git,
  plan: Exclude<BranchPlan, { kind: "occupied" }>,
  path: string,
): Promise<AddOutcome> => {
  const outcome = await git(worktreeAddArgs(plan, path), {
    timeoutMs: 120_000,
  });
  if (outcome.kind !== "ran") {
    return { kind: "failed", message: outcome.message };
  }
  if (outcome.code !== 0) {
    return { kind: "failed", message: outcome.stderr.trim() };
  }
  return { kind: "created", path };
};

export const hasSubmodules = async (
  git: Git,
  repoRoot: string,
): Promise<boolean> => {
  const outcome = await git(["ls-files", "--error-unmatch", ".gitmodules"], {
    cwd: repoRoot,
  });
  return outcome.kind === "ran" && outcome.code === 0;
};

/** `git worktree add` leaves submodules empty, which breaks any setup script. */
export const initSubmodules = async (
  git: Git,
  worktreePath: string,
): Promise<{ ok: boolean; message?: string }> => {
  const outcome = await git(["submodule", "update", "--init", "--recursive"], {
    cwd: worktreePath,
    timeoutMs: 300_000,
  });
  if (outcome.kind !== "ran") return { ok: false, message: outcome.message };
  return outcome.code === 0
    ? { ok: true }
    : { ok: false, message: outcome.stderr.trim() };
};

export const prune = async (git: Git, repoRoot: string): Promise<void> => {
  await git(["worktree", "prune"], { cwd: repoRoot });
};

export type Selection =
  | { kind: "one"; entry: WorktreeEntry }
  | { kind: "none" }
  | { kind: "many"; paths: readonly string[] };

/** Any handle `wt ls` prints: the branch, the directory name, or a path. */
export const matchesTarget = (
  entry: WorktreeEntry,
  target: string,
): boolean => {
  const name = basename(entry.path);
  return (
    entry.branch === target ||
    name === target ||
    entry.path === target ||
    entry.path.endsWith(`/${target}`)
  );
};

export const selectWorktree = (
  entries: readonly WorktreeEntry[],
  target: string,
): Selection => {
  const matched = entries.filter((entry) => matchesTarget(entry, target));
  const first = matched[0];
  if (first === undefined) return { kind: "none" };
  if (matched.length > 1) {
    return { kind: "many", paths: matched.map((entry) => entry.path) };
  }
  return { kind: "one", entry: first };
};

export const worktreePathFor = (
  worktreesRoot: string,
  dirName: string,
): string => join(worktreesRoot, dirName);
