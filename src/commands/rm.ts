import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { worktreeStatus, type WorktreeStatus } from "../lib/git/status.js";
import { prune } from "../lib/git/worktree.js";
import { preflight } from "../lib/herdr/preflight.js";
import { closeSpace, findSpaceFor } from "../lib/herdr/workspace.js";
import type { Topology } from "../lib/git/topology.js";
import { gitFor } from "./ls.js";
import { matchesTarget } from "./status.js";
import type { CommandContext } from "./context.js";

export type RmInput = {
  repo?: string;
  target: string;
  force: boolean;
  /** Undefined means "keep it", which is the default. */
  deleteBranch?: boolean;
  keepSpace?: boolean;
};

export type SpaceClosure =
  | { kind: "closed"; workspaceId: string }
  | { kind: "none" }
  | { kind: "kept" }
  | { kind: "failed"; detail: string };

export type BranchOutcome =
  | { kind: "kept"; command?: string }
  | { kind: "deleted" }
  | { kind: "refused"; message: string };

export type RmResult =
  | {
      kind: "removed";
      status: WorktreeStatus;
      branch: BranchOutcome;
      forced: boolean;
      space: SpaceClosure;
    }
  | { kind: "planned"; status: WorktreeStatus; findings: readonly string[] }
  | { kind: "blocked"; status: WorktreeStatus; findings: readonly string[] }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

/**
 * The blocking criterion and its explanation, from one place: a guard that
 * blocks without saying why, or explains without blocking, is worse than none.
 * Kept in step with `hasUnsavedWork` by rm.test.ts.
 */
export const findings = (status: WorktreeStatus): readonly string[] => {
  const out: string[] = [];

  if (status.operation !== undefined) {
    out.push(`a ${status.operation} is in progress`);
  }
  if (status.modified > 0) {
    out.push(`${String(status.modified)} uncommitted change(s)`);
  }
  if (status.untracked > 0) {
    out.push(`${String(status.untracked)} untracked file(s)`);
  }

  switch (status.unpublished.kind) {
    case "count":
      if (status.unpublished.count > 0) {
        const age =
          status.remoteRefAge === undefined
            ? ""
            : ` (freshest remote ref here: ${status.remoteRefAge})`;
        out.push(
          `${String(status.unpublished.count)} commit(s) on no remote${age}:`,
          ...status.unpublished.sample.map((line) => `    ${line}`),
        );
      }
      break;
    case "no-remote":
      if (status.unpublished.count > 0) {
        out.push(
          `${String(status.unpublished.count)} commit(s), and no remote is configured — nothing here has ever been published`,
        );
      }
      break;
    case "unborn":
    case "unknown":
      break;
  }

  return out;
};

const deleteBranch = async (
  git: ReturnType<typeof gitFor>,
  topology: Topology,
  branch: string,
  force: boolean,
): Promise<BranchOutcome> => {
  const outcome = await git(["branch", force ? "-D" : "-d", branch], {
    cwd: topology.repoRoot,
  });
  if (outcome.kind === "ran" && outcome.code === 0) return { kind: "deleted" };
  return {
    kind: "refused",
    message: outcome.kind === "ran" ? outcome.stderr.trim() : outcome.message,
  };
};

const closeBoundSpace = async (
  input: RmInput,
  worktreePath: string,
  context: CommandContext,
): Promise<SpaceClosure> => {
  if (input.keepSpace === true) return { kind: "kept" };

  const health = await preflight({
    env: context.env,
    cwd: context.cwd,
    trace: context.trace,
  });
  if (health.kind !== "ok") return { kind: "none" };

  const existing = await findSpaceFor(health.client, worktreePath);
  if (existing === undefined) return { kind: "none" };

  const closed = await closeSpace(health.client, existing.workspace_id);
  return closed.ok
    ? { kind: "closed", workspaceId: existing.workspace_id }
    : { kind: "failed", detail: closed.detail ?? "" };
};

export const runRm = async (
  input: RmInput,
  context: CommandContext,
): Promise<RmResult> => {
  const git = gitFor(context, context.cwd);
  const resolution = await resolveRepo(
    { startDir: context.cwd, repoArg: input.repo },
    createProbes(git),
  );
  if (resolution.kind !== "ok") return resolution;

  const { topology } = resolution;
  const repoGit = gitFor(context, topology.repoRoot);
  const probes = createProbes(repoGit);

  const entries = (await probes.git.worktrees(topology.repoRoot)) ?? [];
  const matched = entries.filter((entry) => matchesTarget(entry, input.target));

  if (matched.length === 0) {
    return {
      kind: "error",
      message: `no worktree matches '${input.target}'`,
      hint: "run `wt ls` to see what is there",
    };
  }
  if (matched.length > 1) {
    return {
      kind: "error",
      message: `'${input.target}' matches ${String(matched.length)} worktrees`,
      hint: matched.map((entry) => entry.path).join(", "),
    };
  }

  const entry = matched[0];
  if (entry === undefined) {
    return { kind: "error", message: "internal: no entry" };
  }
  if (entry.path === topology.repoRoot) {
    return {
      kind: "error",
      message: "that is the main checkout, not a worktree wt created",
      hint: "wt only removes linked worktrees",
    };
  }

  const status = await worktreeStatus(repoGit, {
    entry,
    repoRoot: topology.repoRoot,
    worktreesRoot: topology.worktreesRoot,
    exists: probes.fs.exists,
  });

  const found = findings(status);
  if (context.dryRun) return { kind: "planned", status, findings: found };
  if (found.length > 0 && !input.force) {
    return { kind: "blocked", status, findings: found };
  }

  // Close the space BEFORE removing the checkout: herdr holds panes whose cwd
  // is about to vanish.
  const space = await closeBoundSpace(input, entry.path, context);

  const removed = await repoGit(
    ["worktree", "remove", ...(input.force ? ["--force"] : []), entry.path],
    { cwd: topology.repoRoot, timeoutMs: 60_000 },
  );
  if (removed.kind !== "ran" || removed.code !== 0) {
    return {
      kind: "error",
      message: removed.kind === "ran" ? removed.stderr.trim() : removed.message,
      hint: input.force ? undefined : "add --force to remove it anyway",
    };
  }

  await prune(repoGit, topology.repoRoot);

  const branchName = status.branch;
  let branch: BranchOutcome = { kind: "kept" };
  if (branchName !== undefined) {
    branch =
      input.deleteBranch === true
        ? await deleteBranch(repoGit, topology, branchName, input.force)
        : {
            kind: "kept",
            command: `git -C ${topology.repoRoot} branch -d ${branchName}`,
          };
  }

  return { kind: "removed", status, branch, forced: input.force, space };
};
