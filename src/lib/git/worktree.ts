import { join } from "node:path";
import type { Git } from "./exec.js";
import type { BranchPlan } from "./branch.js";

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
      return ["worktree", "add", "-b", plan.branch, path, plan.base];
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

export const worktreePathFor = (
  worktreesRoot: string,
  dirName: string,
): string => join(worktreesRoot, dirName);
