import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { createGit } from "../lib/git/exec.js";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { spaceLabel } from "../lib/config/label.js";
import { umbrellaAsker } from "./umbrella.js";
import { rememberCreation } from "../lib/provision/state.js";
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
import { openSpaceFor, type SpaceOutcome } from "./space.js";
import { configFor } from "./provision.js";
import { writeGenerated } from "./config.js";
import { provision, type ProvisionReport } from "../lib/provision/run.js";
import type { CommandContext } from "./context.js";

export type NewInput = {
  repo?: string;
  branch: string;
  as?: string;
  from?: string;
  fetch: boolean;
  gitignore: boolean;
  forceUmbrella?: boolean;
  open: boolean;
  focus: boolean;
  layout?: string;
  provision: boolean;
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
      space?: SpaceOutcome;
      provisioning?: ProvisionReport;
      configWritten?: string;
      warnings?: readonly string[];
    }
  | {
      kind: "exists";
      plan: NewPlan;
      notices: readonly string[];
      space?: SpaceOutcome;
    }
  | {
      kind: "choose";
      from: string;
      branch: string;
      candidates: readonly RepoCandidate[];
    }
  | { kind: "error"; message: string; hint?: string };

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
      askUmbrella: umbrellaAsker(context),
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
      hint: firstBlocker.fix,
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

  const loaded = await configFor(topology, context);
  if (loaded.kind === "error") {
    return { kind: "error", message: loaded.message };
  }

  const slug = slugify(input.branch);
  if (slug.kind === "error") {
    return { kind: "error", message: slug.message };
  }

  const branchResolution = await resolveBranch(repoGit, {
    branch: input.branch,
    base: input.from ?? loaded.config.repo.defaultBase,
    remote: loaded.config.repo.remote,
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
    label: spaceLabel(loaded.config.space.label, {
      topology,
      branch: input.branch,
      slug: slug.slug,
      as: input.as,
    }),
    gitArgs: worktreeAddArgs(effectivePlan, worktreePath),
    willIgnore: input.gitignore && topology.parentIsRepo,
    willInitSubmodules: await hasSubmodules(repoGit, topology.repoRoot),
  };

  if (holdsOurBranch) {
    if (context.dryRun) return { kind: "exists", plan, notices };
    return {
      kind: "exists",
      plan,
      notices,
      space: input.open
        ? await openSpaceFor(
            {
              topology,
              worktreePath,
              label: plan.label,
              layoutSource: input.layout,
              focus: input.focus,
              runCommands: true,
            },
            context,
          )
        : undefined,
    };
  }

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

  await rememberCreation(repoGit, worktreePath, {
    as: input.as,
    layout: input.layout ?? loaded.config.space.layout,
  });

  // First worktree for this repo: write the detected config so the next run is
  // deterministic rather than re-detected.
  const configWritten =
    loaded.generated === undefined
      ? undefined
      : await writeGenerated(
          topology.configRoot,
          topology.repoName,
          loaded.generated,
        );

  const provisioning = input.provision
    ? await provision(repoGit, {
        repoRoot: topology.repoRoot,
        worktreePath,
        config: loaded.config,
        env: context.env,
        onProgress: context.trace,
      })
    : undefined;

  // The space opens either way: a failed provisioning is exactly when a
  // terminal is wanted. Only the pane commands wait for success.
  const space = input.open
    ? await openSpaceFor(
        {
          topology,
          worktreePath,
          label: plan.label,
          layoutSource: input.layout ?? loaded.config.space.layout,
          focus: input.focus,
          runCommands: provisioning === undefined || provisioning.ok,
        },
        context,
      )
    : undefined;

  return {
    kind: "created",
    plan,
    notices,
    ignore,
    submodules,
    space,
    provisioning,
    configWritten,
    warnings: loaded.warnings,
  };
};
