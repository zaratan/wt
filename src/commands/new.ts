import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { createGit } from "../lib/git/exec.js";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { resolveBranch, type BranchPlan } from "../lib/git/branch.js";
import {
  disambiguator,
  sameDirName,
  slugify,
  worktreeDirName,
} from "../lib/git/slug.js";
import { ensureIgnored, type IgnoreOutcome } from "../lib/git/ignore.js";
import {
  addWorktree,
  hasSubmodules,
  initSubmodules,
  prune,
  worktreeAddArgs,
  worktreePathFor,
} from "../lib/git/worktree.js";
import { WORKTREES_DIR, violatedGuards } from "../lib/git/topology.js";
import type { Topology } from "../lib/git/topology.js";
import type { CommandContext } from "./context.js";

export type NewInput = {
  repo?: string;
  branch: string;
  as?: string;
  from?: string;
  fetch: boolean;
  gitignore: boolean;
  forceUmbrella?: boolean;
};

export type NewPlan = {
  topology: Topology;
  branchPlan: Exclude<BranchPlan, { kind: "occupied" }>;
  worktreePath: string;
  label: string;
  gitArgs: readonly string[];
  willIgnore: boolean;
  willInitSubmodules: boolean;
};

export type NewResult =
  | { kind: "planned"; plan: NewPlan; notices: readonly string[] }
  | {
      kind: "created";
      plan: NewPlan;
      notices: readonly string[];
      ignore?: IgnoreOutcome;
      submodules?: { ok: boolean; message?: string };
    }
  | { kind: "exists"; plan: NewPlan; notices: readonly string[] }
  | {
      kind: "choose";
      from: string;
      branch: string;
      candidates: readonly RepoCandidate[];
    }
  | { kind: "error"; message: string; hint?: string };

const labelFor = (topology: Topology, branch: string, as?: string): string => {
  const short = as ?? branch.split("/").pop() ?? branch;
  const prefix =
    topology.umbrella === "umbrella"
      ? basename(topology.parent)
      : topology.repoName;
  return `${prefix} - ${short}`;
};

export const runNew = async (
  input: NewInput,
  context: CommandContext,
): Promise<NewResult> => {
  const notices: string[] = [];
  const trace = context.trace;
  const git = createGit({
    cwd: context.cwd,
    env: context.env,
    trace:
      trace === undefined
        ? undefined
        : (args, cwd) => {
            trace(`+ git ${args.join(" ")}  (in ${cwd})`);
          },
  });

  const resolution = await resolveRepo(
    {
      startDir: context.cwd,
      repoArg: input.repo,
      forceUmbrella: input.forceUmbrella,
    },
    createProbes(git),
  );

  if (resolution.kind === "error") return resolution;
  if (resolution.kind === "choose") {
    return { ...resolution, branch: input.branch };
  }

  const { topology } = resolution;

  const blocking = violatedGuards(topology);
  const firstBlocker = blocking[0];
  if (firstBlocker !== undefined) {
    return {
      kind: "error",
      message: firstBlocker.message,
      hint: "set another location with worktree.dir, or move this repository",
    };
  }

  const repoGit = createGit({
    cwd: topology.repoRoot,
    env: context.env,
    trace:
      trace === undefined
        ? undefined
        : (args, cwd) => {
            trace(`+ git ${args.join(" ")}  (in ${cwd})`);
          },
  });

  if (!context.dryRun) await prune(repoGit, topology.repoRoot);

  const slug = slugify(input.branch);
  if (slug.kind === "error") {
    return { kind: "error", message: slug.message };
  }

  const branchResolution = await resolveBranch(repoGit, {
    branch: input.branch,
    base: input.from,
    fetch: input.fetch,
    onNotice: (message) => notices.push(message),
  });

  if (branchResolution.kind === "error") return branchResolution;

  const probes = createProbes(repoGit);
  const existingWorktrees =
    (await probes.git.worktrees(topology.repoRoot)) ?? [];

  let dirName = worktreeDirName(topology.repoName, slug.slug);
  const taken = existingWorktrees.find(
    (entry) =>
      sameDirName(basename(entry.path), dirName) &&
      entry.branch !== input.branch,
  );
  if (taken !== undefined) {
    dirName = `${dirName}-${disambiguator(input.branch)}`;
    notices.push(
      `${basename(taken.path)} already belongs to '${taken.branch ?? "another branch"}', using ${dirName}`,
    );
  }

  const worktreePath = worktreePathFor(topology.worktreesRoot, dirName);

  // A rerun sees its own worktree holding the branch. That is `open`, not a
  // conflict — only a DIFFERENT checkout is one.
  const holdsOurBranch =
    branchResolution.kind === "occupied" &&
    (await probes.fs.realpath(branchResolution.by)) ===
      (await probes.fs.realpath(worktreePath));

  const effectivePlan: Exclude<BranchPlan, { kind: "occupied" }> =
    branchResolution.kind === "occupied"
      ? { kind: "checkout-local", branch: input.branch }
      : branchResolution;

  const plan: NewPlan = {
    topology,
    branchPlan: effectivePlan,
    worktreePath,
    label: labelFor(topology, input.branch, input.as),
    gitArgs: worktreeAddArgs(effectivePlan, worktreePath),
    willIgnore: input.gitignore && topology.parentIsRepo,
    willInitSubmodules: await hasSubmodules(repoGit, topology.repoRoot),
  };

  if (holdsOurBranch) return { kind: "exists", plan, notices };

  if (branchResolution.kind === "occupied") {
    const isLinked = branchResolution.by !== topology.repoRoot;
    return {
      kind: "error",
      message: `branch '${input.branch}' is already checked out at ${branchResolution.by}`,
      hint: isLinked
        ? `open it with \`wt open ${input.branch}\``
        : "pick another branch, or use --from to start a new one",
    };
  }

  if (context.dryRun) return { kind: "planned", plan, notices };

  await mkdir(topology.worktreesRoot, { recursive: true });

  const added = await addWorktree(repoGit, effectivePlan, worktreePath);
  if (added.kind === "failed") {
    return { kind: "error", message: added.message };
  }

  const ignore = plan.willIgnore
    ? await ensureIgnored(repoGit, topology.parent, WORKTREES_DIR)
    : undefined;

  const submodules = plan.willInitSubmodules
    ? await initSubmodules(repoGit, worktreePath)
    : undefined;

  return { kind: "created", plan, notices, ignore, submodules };
};
