import { basename } from "node:path";
import type { RmResult } from "../commands/rm.js";

export const renderRm = (result: RmResult): string => {
  const lines: string[] = [];

  switch (result.kind) {
    case "choose":
      lines.push(
        `Several repositories live under ${result.from}:`,
        "",
        ...result.candidates.map((candidate) => `  ${candidate.name}`),
      );
      break;

    case "error":
      lines.push(`wt rm: ${result.message}`);
      if (result.hint !== undefined) lines.push(`  ${result.hint}`);
      break;

    case "blocked":
      lines.push(
        `wt rm: ${basename(result.status.path)} is not ready to be removed:`,
        "",
        ...result.findings.map((finding) => `  ${finding}`),
        "",
        "  --force removes it anyway: unsaved work is discarded, and a running",
        "  process is NOT stopped — it can recreate files while git deletes them",
        "  and leave the removal half done.",
      );
      break;

    case "detached":
      lines.push(
        `wt rm: git removed ${basename(result.status.path)} from its worktree list,`,
        "       but could not delete the directory:",
        "",
        `  ${result.message}`,
        "",
        "  A dev server writing into the tree is the usual cause: it recreates",
        "  files faster than git deletes them. Stop it, then:",
        "",
        `      rm -rf ${result.leftover}`,
        "",
        `  The branch ${result.status.branch ?? "(detached)"} was kept.`,
      );
      break;

    case "planned":
      lines.push(
        `Would remove ${result.status.path}`,
        `  branch  ${result.status.branch ?? "(detached)"}  — kept unless --delete-branch`,
      );
      if (result.findings.length > 0) {
        lines.push(
          "",
          "  but it would be refused, because it holds:",
          ...result.findings.map((finding) => `  ${finding}`),
        );
      }
      break;

    case "removed": {
      lines.push(
        `Removed ${result.status.path}${result.forced ? "  (forced)" : ""}`,
      );
      switch (result.space.kind) {
        case "closed":
          lines.push(`  space   ${result.space.workspaceId} closed`);
          break;
        case "failed":
          lines.push(`  space   NOT closed: ${result.space.detail}`);
          break;
        case "kept":
          lines.push("  space   left open");
          break;
        case "none":
          break;
      }
      switch (result.branch.kind) {
        case "deleted":
          lines.push(`  branch  ${result.status.branch ?? ""} deleted`);
          break;
        case "refused":
          lines.push(`  branch  kept: ${result.branch.message}`);
          break;
        case "kept":
          lines.push(`  branch  ${result.status.branch ?? "(detached)"} kept`);
          if (result.branch.command !== undefined) {
            lines.push(`          ${result.branch.command}`);
          }
          break;
      }
      break;
    }
  }

  lines.push("");
  return lines.join("\n");
};
