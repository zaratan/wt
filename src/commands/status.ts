import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { worktreeStatus, type WorktreeStatus } from "../lib/git/status.js";
import { matchesTarget } from "../lib/git/worktree.js";
import type { Topology } from "../lib/git/topology.js";
import { gitFor, pruneIfStale } from "./ls.js";
import { readCreation, type WorktreeState } from "../lib/provision/state.js";
import { indexSpaces, type OpenSpace, type SpaceIndex } from "./spaces.js";
import type { CommandContext } from "./context.js";

export type StatusInput = {
  repo?: string;
  /** A branch, a directory slug, or a path. */
  target?: string;
};

export type WorktreeDetail = {
  status: WorktreeStatus;
  state: WorktreeState;
  space?: OpenSpace;
};

export type StatusReport = {
  topology: Topology;
  details: readonly WorktreeDetail[];
  spaces: SpaceIndex;
};

export type StatusResult =
  | { kind: "ok"; report: StatusReport }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

export const runStatus = async (
  input: StatusInput,
  context: CommandContext,
): Promise<StatusResult> => {
  const git = gitFor(context, context.cwd);
  const resolution = await resolveRepo(
    {
      startDir: context.cwd,
      repoArg: input.repo,
      chooseRepo: context.chooseRepo,
    },
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

  const spaces = context.dryRun ? {} : await indexSpaces(context);

  const details = await Promise.all(
    selected.map(async (entry): Promise<WorktreeDetail> => {
      const status = await worktreeStatus(repoGit, {
        entry,
        repoRoot: topology.repoRoot,
        worktreesRoot: topology.worktreesRoot,
        exists: repoProbes.fs.exists,
      });
      const state = await readCreation(repoGit, entry.path);
      return {
        status,
        state,
        space: spaces.byCheckout?.get(status.path),
      };
    }),
  );

  return { kind: "ok", report: { topology, details, spaces } };
};
