import { parseLayout } from "../lib/layout/parser.js";
import { formatLayoutError } from "../lib/layout/errors.js";
import { toHerdrLayout } from "../lib/layout/toHerdr.js";
import { preflight } from "../lib/herdr/preflight.js";
import { openSpace, type OpenSpaceResult } from "../lib/herdr/workspace.js";
import type { Topology } from "../lib/git/topology.js";
import type { CommandContext } from "./context.js";

export const DEFAULT_LAYOUT = "(@parent:claude | @wt:shell)";

export type SpaceOutcome =
  | { kind: "opened"; result: OpenSpaceResult }
  | { kind: "skipped"; reason: string }
  /** herdr is down or refused: git succeeded, so this is a partial success. */
  | { kind: "unavailable"; message: string; manual: readonly string[] };

export type SpaceInput = {
  topology: Topology;
  worktreePath: string;
  label: string;
  layoutSource?: string;
  focus: boolean;
  runCommands: boolean;
};

/** Barrel three: herdr is gone, so print what to type by hand. */
const manualCommands = (input: SpaceInput): readonly string[] => [
  `herdr worktree open --cwd ${input.topology.repoRoot} --path ${input.worktreePath} --label "${input.label}"`,
];

/**
 * A space whose layout was refused is not ready, even though `worktree.open`
 * succeeded. Focus is the exception: failing to raise a window costs nothing.
 */
export const spaceIsReady = (outcome: SpaceOutcome | undefined): boolean => {
  if (outcome === undefined) return true;
  if (outcome.kind !== "opened") return false;
  return outcome.result.steps.every(
    (step) => step.ok || step.step === "workspace.focus",
  );
};

export const openSpaceFor = async (
  input: SpaceInput,
  context: CommandContext,
): Promise<SpaceOutcome> => {
  const source = input.layoutSource ?? DEFAULT_LAYOUT;
  const parsed = parseLayout(source);
  if (parsed.kind === "error") {
    return {
      kind: "skipped",
      reason: formatLayoutError(source, parsed.error),
    };
  }

  const { layout, panes } = toHerdrLayout(parsed.root, {
    parent: input.topology.contextRoot,
    worktree: input.worktreePath,
    env: {
      WT_WORKTREE: input.worktreePath,
      WT_REPO: input.topology.repoRoot,
    },
  });

  const health = await preflight({
    env: context.env,
    cwd: context.cwd,
    trace: context.trace,
  });
  if (health.kind !== "ok") {
    return {
      kind: "unavailable",
      message: health.message,
      manual: manualCommands(input),
    };
  }

  const result = await openSpace(health.client, {
    repoRoot: input.topology.repoRoot,
    worktreePath: input.worktreePath,
    label: input.label,
    layout,
    panes,
    focus: input.focus,
    runCommands: input.runCommands,
    agentName: input.label,
  });

  return { kind: "opened", result };
};
