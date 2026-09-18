import type { OpenResult } from "../commands/open.js";
import { spaceLines } from "./space.js";

export const renderOpen = (result: OpenResult): string => {
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
      lines.push(`wt open: ${result.message}`);
      if (result.hint !== undefined) lines.push(`  ${result.hint}`);
      break;
    case "focused":
      lines.push(
        `Focused "${result.label}"`,
        `  space   ${result.workspaceId}`,
        `  path    ${result.worktreePath}`,
      );
      break;
    case "opened":
      lines.push(
        `Opened "${result.label}"`,
        `  path    ${result.worktreePath}`,
      );
      lines.push(...spaceLines(result.space));
      break;
  }

  lines.push("");
  return lines.join("\n");
};
