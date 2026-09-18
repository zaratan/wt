import type { ConfigResult } from "../commands/config.js";

export const renderConfig = (result: ConfigResult): string => {
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
      lines.push(`wt config: ${result.message}`);
      if (result.hint !== undefined) lines.push(`  ${result.hint}`);
      break;

    case "paths":
      for (const path of result.paths) {
        lines.push(`${path === result.active ? "* " : "  "}${path}`);
      }
      break;

    case "written":
      lines.push(`Wrote ${result.path}`);
      break;

    case "edit":
      lines.push(result.path);
      break;

    case "shown": {
      const { config } = result;
      lines.push(
        result.sources.length === 0
          ? "No config file; these are the built-in defaults."
          : `From: ${result.sources.join(", ")}`,
        "",
        `  layout        ${config.space.layout ?? "(default)"}`,
        `  copy          ${config.provision.copy.length === 0 ? "(nothing)" : config.provision.copy.join(", ")}`,
        `  timeout       ${String(Math.round(config.provision.timeoutMs / 1000))}s`,
      );
      for (const command of config.provision.commands) {
        lines.push(`  run           ${command.run}   (${command.when})`);
      }
      for (const warning of result.warnings) lines.push(`  ! ${warning}`);
      break;
    }
  }

  lines.push("");
  return lines.join("\n");
};
