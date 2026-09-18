import { createGit, type Git } from "../lib/git/exec.js";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { worktreeStatus, type WorktreeStatus } from "../lib/git/status.js";
import { prune } from "../lib/git/worktree.js";
import type { Probes, Topology } from "../lib/git/topology.js";
import { indexSpaces, type SpaceIndex } from "./spaces.js";
import type { CommandContext } from "./context.js";

export type LsInput = {
  repo?: string;
  /** Include worktrees wt does not manage, such as herdr's own. */
  all: boolean;
  /** Typed here rather than read out of the CLI option bag by its name. */
  prune?: boolean;
};

export type OrphanDirectory = { path: string };

/** A worktree knows which repository it belongs to: a working folder holds several. */
export type Listed = { topology: Topology; status: WorktreeStatus };

export type LsReport = {
  /** The first repository, or the only one. Kept for what needs a single root. */
  topology: Topology;
  /** More than one when the listing covers a working folder. */
  repos: readonly Topology[];
  worktrees: readonly Listed[];
  spaces: SpaceIndex;
  /** Directories under the worktrees root that git does not know about. */
  orphans: readonly OrphanDirectory[];
  pruned: boolean;
};

export type LsResult =
  | { kind: "ok"; report: LsReport }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

export const gitFor = (context: CommandContext, cwd: string): Git => {
  const trace = context.trace;
  return createGit({
    cwd,
    env: context.env,
    signal: context.signal,
    trace:
      trace === undefined
        ? undefined
        : (args, at) => {
            trace(`+ git ${args.join(" ")}  (in ${at})`);
          },
  });
};

/**
 * Runs before most commands. Cheap, and it is what stops a stale entry — like
 * the one pointing at a deleted scratchpad — hanging around forever.
 */
export const pruneIfStale = async (
  git: Git,
  topology: Topology,
  probes: Probes,
): Promise<boolean> => {
  const entries = (await probes.git.worktrees(topology.repoRoot)) ?? [];
  if (!entries.some((entry) => entry.prunable)) return false;
  await prune(git, topology.repoRoot);
  return true;
};

const findOrphans = async (
  topology: Topology,
  known: readonly string[],
  probes: Probes,
): Promise<readonly OrphanDirectory[]> => {
  const entries = await probes.fs.listEntries(topology.worktreesRoot);
  if (entries === undefined) return [];

  const found = await Promise.all(
    entries.map(async (name) => {
      const path = `${topology.worktreesRoot}/${name}`;
      if (!(await probes.fs.isDirectory(path))) return undefined;
      const real = (await probes.fs.realpath(path)) ?? path;
      return known.includes(real) ? undefined : { path: real };
    }),
  );
  return found.filter((entry): entry is OrphanDirectory => entry !== undefined);
};

const listAcross = async (
  candidates: readonly RepoCandidate[],
  input: LsInput,
  context: CommandContext,
): Promise<LsResult> => {
  const reports = await Promise.all(
    candidates.map((candidate) =>
      runLs({ ...input, repo: candidate.path }, { ...context, json: true }),
    ),
  );
  const ok = reports.filter(
    (one): one is Extract<LsResult, { kind: "ok" }> => one.kind === "ok",
  );

  const first = ok[0];
  if (first === undefined) {
    return {
      kind: "error",
      message: `no repository under ${context.cwd} could be read`,
    };
  }

  return {
    kind: "ok",
    report: {
      topology: first.report.topology,
      repos: ok.map((one) => one.report.topology),
      worktrees: ok.flatMap((one) => one.report.worktrees),
      spaces: first.report.spaces,
      orphans: ok.flatMap((one) => one.report.orphans),
      pruned: ok.some((one) => one.report.pruned),
    },
  };
};

export const runLs = async (
  input: LsInput,
  context: CommandContext,
): Promise<LsResult> => {
  const git = gitFor(context, context.cwd);
  const probes = createProbes(git);

  const resolution = await resolveRepo(
    { startDir: context.cwd, repoArg: input.repo },
    probes,
  );

  // A working folder holds several repositories, and listing is the one thing
  // that should span them all rather than make you pick one first.
  if (resolution.kind === "choose") {
    return await listAcross(resolution.candidates, input, context);
  }
  if (resolution.kind !== "ok") return resolution;

  const { topology } = resolution;
  const repoGit = gitFor(context, topology.repoRoot);
  const repoProbes = createProbes(repoGit);

  const pruned =
    context.dryRun || input.prune === false || context.options.prune === false
      ? false
      : await pruneIfStale(repoGit, topology, repoProbes);

  const entries = (await repoProbes.git.worktrees(topology.repoRoot)) ?? [];

  const statuses = await Promise.all(
    entries.map((entry) =>
      worktreeStatus(repoGit, {
        entry,
        repoRoot: topology.repoRoot,
        worktreesRoot: topology.worktreesRoot,
        exists: repoProbes.fs.exists,
      }),
    ),
  );

  const visible = input.all
    ? statuses
    : statuses.filter((status) => status.managed || status.isMain);

  return {
    kind: "ok",
    report: {
      topology,
      repos: [topology],
      worktrees: visible.map((status) => ({ topology, status })),
      spaces: context.dryRun ? {} : await indexSpaces(context),
      orphans: await findOrphans(
        topology,
        entries.map((entry) => entry.path),
        repoProbes,
      ),
      pruned,
    },
  };
};
