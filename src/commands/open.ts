import { basename } from "node:path";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { preflight } from "../lib/herdr/preflight.js";
import { findSpaceFor } from "../lib/herdr/workspace.js";
import type { Topology, WorktreeEntry } from "../lib/git/topology.js";
import { gitFor } from "./ls.js";
import { matchesTarget } from "./status.js";
import { openSpaceFor, type SpaceOutcome } from "./space.js";
import type { CommandContext } from "./context.js";

export type OpenInput = {
  repo?: string;
  target: string;
  focus: boolean;
  layout?: string;
};

export type OpenResult =
  | {
      kind: "focused";
      label: string;
      worktreePath: string;
      workspaceId: string;
    }
  | { kind: "opened"; label: string; worktreePath: string; space: SpaceOutcome }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

const labelFor = (topology: Topology, entry: WorktreeEntry): string => {
  const short = entry.branch?.split("/").pop() ?? basename(entry.path);
  const prefix =
    topology.umbrella === "umbrella"
      ? basename(topology.parent)
      : topology.repoName;
  return `${prefix} - ${short}`;
};

export const runOpen = async (
  input: OpenInput,
  context: CommandContext,
): Promise<OpenResult> => {
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

  const entry = matched[0];
  if (entry === undefined) {
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
      hint: matched.map((candidate) => candidate.path).join(", "),
    };
  }

  const label = labelFor(topology, entry);

  // herdr is the registry: if it already has a space bound to this checkout,
  // focusing it is the whole job — even if the user renamed it since.
  const health = await preflight({
    env: context.env,
    cwd: context.cwd,
    trace: context.trace,
  });
  if (health.kind === "ok") {
    const existing = await findSpaceFor(health.client, entry.path);
    if (existing !== undefined) {
      if (input.focus) {
        await health.client.call("workspace.focus", {
          workspace_id: existing.workspace_id,
        });
      }
      return {
        kind: "focused",
        label: existing.label ?? label,
        worktreePath: entry.path,
        workspaceId: existing.workspace_id,
      };
    }
  }

  return {
    kind: "opened",
    label,
    worktreePath: entry.path,
    space: await openSpaceFor(
      {
        topology,
        worktreePath: entry.path,
        label,
        layoutSource: input.layout,
        focus: input.focus,
        runCommands: true,
      },
      context,
    ),
  };
};
