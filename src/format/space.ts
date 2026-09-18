import type { SpaceOutcome } from "../commands/space.js";

export const spaceLines = (space: SpaceOutcome | undefined): string[] => {
  if (space === undefined) return [];

  switch (space.kind) {
    case "skipped":
      return [
        "",
        "  space not opened:",
        ...space.reason.split("\n").map((l) => `  ${l}`),
      ];

    case "unavailable":
      return [
        "",
        `  space not opened: ${space.message}`,
        ...space.manual.map((command) => `    ${command}`),
      ];

    case "opened": {
      const { result } = space;
      const failed = result.steps.filter((step) => !step.ok);
      const lines = [
        result.workspaceId === undefined
          ? "  space not opened"
          : `  space   ${result.workspaceId}${result.alreadyOpen ? " (already open)" : ""}`,
      ];
      for (const step of failed) {
        lines.push(`  ! ${step.step} failed: ${step.detail ?? ""}`);
      }
      const agent = result.steps.find(
        (step) => step.step === "agent.start" && step.ok,
      );
      if (agent?.detail !== undefined) {
        lines.push(`  agent   ${agent.detail}`);
      }
      for (const held of result.deferred) {
        lines.push(`  held    ${held.command} (run it after provisioning)`);
      }
      return lines;
    }
  }
};
