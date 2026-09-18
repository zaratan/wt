import type { Detected } from "./detect.js";

export type GenerateInput = {
  repoName: string;
  /** Relative to the directory holding `.wt/`, or "." for a plain repo. */
  repoPath: string;
  detected: Detected;
  umbrella: boolean;
  devCommandInLayout: boolean;
};

const quote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

const copyBlock = (detected: Detected): string[] => {
  const kept = detected.copy.filter((entry) => entry.held === undefined);
  const held = detected.copy.filter((entry) => entry.held !== undefined);

  const lines: string[] = [];
  if (kept.length === 0) {
    lines.push("copy = []");
  } else {
    lines.push("copy = [");
    for (const entry of kept) {
      lines.push(`  ${quote(entry.path)},  # ${entry.reason}`);
    }
    lines.push("]");
  }
  for (const entry of held) {
    lines.push(
      `# ${quote(entry.path)},  # ${entry.reason}, but ${entry.held ?? "too big"}`,
    );
  }
  return lines;
};

const layoutFor = (input: GenerateInput): string =>
  input.devCommandInLayout && input.detected.devCommand !== undefined
    ? `(@parent:claude | (@wt _ @wt:${input.detected.devCommand}))`
    : "(@parent:claude | @wt)";

export const generateConfig = (input: GenerateInput): string => {
  const { detected } = input;

  const commands =
    detected.installCommand === undefined
      ? ["commands = []"]
      : [
          "commands = [",
          `  { run = ${quote(detected.installCommand)}, when = ${quote(
            detected.installCommand === "bin/setup"
              ? "always"
              : "if-missing:node_modules",
          )} },`,
          "]",
        ];

  return [
    "schema = 1",
    "",
    "[repo]",
    `path = ${quote(input.repoPath)}`,
    ...(detected.defaultBase === undefined
      ? []
      : [`default_base = ${quote(detected.defaultBase)}`]),
    ...(detected.remote === undefined
      ? []
      : [`remote = ${quote(detected.remote)}`]),
    "",
    "[space]",
    `label = ${quote(input.umbrella ? "{parent} - {as}" : "{repo} - {as}")}`,
    `layout = ${quote(layoutFor(input))}`,
    "",
    "[provision]",
    ...copyBlock(detected),
    ...commands,
    "",
    "[remove]",
    'delete_branch = "ask"',
    "",
    "# Ports and databases are NOT isolated: two worktrees of this repo share",
    "# the dev database and the same ports.",
    "",
  ].join("\n");
};
