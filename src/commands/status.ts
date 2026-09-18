import { basename } from "node:path";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { worktreeStatus, type WorktreeStatus } from "../lib/git/status.js";
import type { Topology, WorktreeEntry } from "../lib/git/topology.js";
import { gitFor, pruneIfStale } from "./ls.js";
import type { CommandContext } from "./context.js";

export type StatusInput = {
  repo?: string;
  /** A branch, a directory slug, or a path. */
  target?: string;
};

export type StatusReport = {
  topology: Topology;
  statuses: readonly WorktreeStatus[];
};

export type StatusResult =
  | { kind: "ok"; report: StatusReport }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

/**
 * Accepts whichever handle is at hand: the branch, the directory name, or a
 * path. `wt ls` prints all three, so anything copied from it works.
 */
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

export const runStatus = async (
  input: StatusInput,
  context: CommandContext,
): Promise<StatusResult> => {
  const git = gitFor(context, context.cwd);
  const resolution = await resolveRepo(
    { startDir: context.cwd, repoArg: input.repo },
    createProbes(git),
  );
  if (resolution.kind !== "ok") return resolution;

  const { topology } = resolution;
  const repoGit = gitFor(context, topology.repoRoot);
  const repoProbes = createProbes(repoGit);

  if (!context.dryRun && context.options.prune !== false) {
    await pruneIfStale(repoGit, topology, repoProbes);
  }

  const entries = (await repoProbes.git.worktrees(topology.repoRoot)) ?? [];
  const selected =
    input.target === undefined
      ? entries
      : entries.filter((entry) => matchesTarget(entry, input.target ?? ""));

  if (selected.length === 0) {
    return {
      kind: "error",
      message: `no worktree matches '${input.target ?? ""}'`,
      hint: "run `wt ls` to see what is there",
    };
  }

  const statuses = await Promise.all(
    selected.map((entry) =>
      worktreeStatus(repoGit, {
        entry,
        repoRoot: topology.repoRoot,
        worktreesRoot: topology.worktreesRoot,
        exists: repoProbes.fs.exists,
      }),
    ),
  );

  return { kind: "ok", report: { topology, statuses } };
};
