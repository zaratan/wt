import type { WorktreeRow } from "./rows.js";
import type { WtConfig } from "../lib/config/schema.js";

export type BranchPlan = "deleted" | "kept";

export type RemovalIntent = {
  row: WorktreeRow;
  findings: readonly string[];
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

export const removalIntent = (
  row: WorktreeRow,
  findings: readonly string[],
  config: WtConfig,
): RemovalIntent => ({
  row,
  findings,
  branch: row.status.branch,
  branchPlan: branchPlanFor(config),
  forceCommand: `wt rm ${row.status.branch ?? row.name} --force`,
});
