import { relative } from "node:path";
import type { NewPlan, NewResult } from "../commands/new.js";
import { spaceLines } from "./space.js";
import { provisionLines } from "./provision.js";

const shorten = (path: string, base: string): string => {
  const rel = relative(base, path);
  return rel !== "" && !rel.startsWith("..") ? rel : path;
};

const branchLine = (plan: NewPlan): string => {
  switch (plan.branchPlan.kind) {
    case "checkout-local":
      return `branch  ${plan.branchPlan.branch} (existing local branch)`;
    case "track-remote":
      return `branch  ${plan.branchPlan.branch} (tracking ${plan.branchPlan.remote}/${plan.branchPlan.branch})`;
    case "create":
      return `branch  ${plan.branchPlan.branch} (new, from ${plan.branchPlan.base})`;
  }
};

const planLines = (plan: NewPlan, cwd: string): string[] => [
  `  repo    ${plan.topology.repoName}  (${shorten(plan.topology.repoRoot, cwd)})`,
  `  ${branchLine(plan)}`,
  `  path    ${shorten(plan.worktreePath, cwd)}`,
  `  label   ${plan.label}`,
];

export const renderNew = (result: NewResult, cwd: string): string => {
  const lines: string[] = [];

  switch (result.kind) {
    case "choose":
      lines.push(
        `Several repositories live under ${result.from}:`,
        "",
        ...result.candidates.map((candidate) => `  ${candidate.name}`),
        "",
        "Name one:",
        `  wt new ${result.candidates[0]?.name ?? "<repo>"} ${result.branch}`,
      );
      break;

    case "error":
      lines.push(`wt new: ${result.message}`);
      if (result.hint !== undefined) lines.push(`  ${result.hint}`);
      break;

    case "planned":
      lines.push("Would create:", ...planLines(result.plan, cwd), "");
      lines.push(`  git ${result.plan.gitArgs.join(" ")}`);
      if (result.plan.willIgnore) {
        lines.push(
          `  ensure /.worktrees/ is ignored by ${result.plan.topology.parent}`,
        );
      }
      if (result.plan.willInitSubmodules) {
        lines.push("  git submodule update --init --recursive");
      }
      break;

    case "exists":
      lines.push(
        "Already there:",
        ...planLines(result.plan, cwd),
        "",
        `Open it with \`wt open ${result.plan.branchPlan.branch}\`.`,
      );
      lines.push(...spaceLines(result.space));
      break;

    case "created":
      lines.push("Created:", ...planLines(result.plan, cwd));
      if (result.ignore?.kind === "added") {
        lines.push(`  ignored /.worktrees/ in ${result.ignore.file}`);
      }
      if (result.submodules?.ok === true) {
        lines.push("  submodules initialised");
      }
      if (result.submodules?.ok === false) {
        lines.push(`  submodules FAILED: ${result.submodules.message ?? ""}`);
      }
      if (result.configWritten !== undefined) {
        lines.push(`  config  written to ${result.configWritten}`);
      }
      lines.push(...provisionLines(result.provisioning));
      lines.push(...spaceLines(result.space));
      for (const warning of result.warnings ?? []) lines.push(`  ! ${warning}`);
      lines.push("", `  cd ${shorten(result.plan.worktreePath, cwd)}`);
      break;
  }

  if ("notices" in result) {
    for (const notice of result.notices) lines.push(`  ! ${notice}`);
  }

  return `${lines.join("\n")}\n`;
};
