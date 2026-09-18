import { basename } from "node:path";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { preflight } from "../lib/herdr/preflight.js";
import { findSpaceFor, focusSpace } from "../lib/herdr/workspace.js";
import { spaceLabel } from "../lib/config/label.js";
import { readCreation } from "../lib/provision/state.js";
import { configFor } from "./provision.js";
import { selectWorktree } from "../lib/git/worktree.js";
import { gitFor } from "./ls.js";

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
  | { kind: "planned"; label: string; worktreePath: string }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

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
  const selected = selectWorktree(entries, input.target);
  if (selected.kind === "none") {
    return {
      kind: "error",
      message: `no worktree matches '${input.target}'`,
      hint: "run `wt ls` to see what is there",
    };
  }
  if (selected.kind === "many") {
    return {
      kind: "error",
      message: `'${input.target}' matches ${String(selected.paths.length)} worktrees`,
      hint: selected.paths.join(", "),
    };
  }
  const entry = selected.entry;

  const remembered = await readCreation(repoGit, entry.path);
  const loaded = await configFor(topology, context);
  const label = spaceLabel(
    loaded.kind === "ok" ? loaded.config.space.label : undefined,
    {
      topology,
      branch: entry.branch ?? basename(entry.path),
      slug: basename(entry.path),
      as: remembered.as,
    },
  );

  if (context.dryRun) {
    return { kind: "planned", label, worktreePath: entry.path };
  }

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
      if (input.focus) await focusSpace(health.client, existing.workspace_id);
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
        layoutSource:
          input.layout ??
          remembered.layout ??
          (loaded.kind === "ok" ? loaded.config.space.layout : undefined),
        focus: input.focus,
        runCommands: true,
      },
      context,
    ),
  };
};
