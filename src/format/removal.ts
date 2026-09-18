import type { WorktreeRow } from "./rows.js";
import type { WtConfig } from "../lib/config/schema.js";

export type BranchPlan = "deleted" | "kept";

export type RemovalIntent = {
  row: WorktreeRow;
  findings: readonly string[];
  /** Refusals --force cannot lift, so the panel must not offer it. */
  refused?: string;
  branch?: string;
  branchPlan: BranchPlan;
  /** What to type when wt refuses and the user still wants it gone. */
  forceCommand: string;
};

/**
 * Resolved before the panel is drawn, and passed to `runRm` explicitly, so the
 * removal never reaches `context.confirm` and never fights Ink for stdin.
 */
export const branchPlanFor = (config: WtConfig): BranchPlan =>
  config.remove.deleteBranch === "always" ? "deleted" : "kept";

/** `runRm` refuses the main checkout outright, and no flag changes that. */
const refusal = (row: WorktreeRow): string | undefined =>
  row.status.isMain
    ? "that is the main checkout, not a worktree wt created"
    : undefined;

export const removalIntent = (
  row: WorktreeRow,
  findings: readonly string[],
  config: WtConfig,
): RemovalIntent => ({
  row,
  findings,
  refused: refusal(row),
  branch: row.status.branch,
  branchPlan: branchPlanFor(config),
  forceCommand: `wt rm ${row.status.branch ?? row.name} --force`,
});
