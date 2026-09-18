/**
 * Help text, rendered from the command table.
 *
 * `wt help`, `wt help new` and `wt new --help` all land here, so there is no
 * second copy of the surface to keep in sync.
 */
import type { CommandSpec, OptionGroup, OptionSpec } from "./spec.js";
import {
  COMMANDS,
  GLOBAL_OPTIONS,
  GROUP_TITLES,
  SECTION_TITLES,
  findCommand,
} from "./spec.js";

const INDENT = "  ";

const pad = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - text.length));

/** `--as <label>, -a` */
const optionSignature = (option: OptionSpec): string => {
  const forms = [
    option.short === undefined ? undefined : `-${option.short}`,
    `--${option.long}`,
  ].filter((form): form is string => form !== undefined);

  const negated = option.negatable === true ? `/--no-${option.long}` : "";
  const argument =
    option.arity === "required" ? ` ${option.placeholder ?? "<value>"}` : "";
  return `${forms.join(", ")}${negated}${argument}`;
};

const renderOptionGroup = (
  title: string,
  options: readonly OptionSpec[],
  width: number,
): string[] => {
  if (options.length === 0) return [];
  return [
    `${title}:`,
    ...options.map(
      (option) =>
        `${INDENT}${pad(optionSignature(option), width)}  ${option.help}`,
    ),
    "",
  ];
};

const byGroup = (
  options: readonly OptionSpec[],
  group: OptionGroup,
): readonly OptionSpec[] => options.filter((option) => option.group === group);

const usageLine = (spec: CommandSpec): string => {
  const positionals = spec.positionals
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(" ");
  const tail = positionals === "" ? "" : ` ${positionals}`;
  return `wt ${spec.name}${tail} [options]`;
};

export const renderCommandHelp = (spec: CommandSpec): string => {
  const options = [...spec.options, ...GLOBAL_OPTIONS];
  const width = Math.max(...options.map((o) => optionSignature(o).length));

  const aliases =
    spec.aliases === undefined || spec.aliases.length === 0
      ? []
      : [`Aliases: ${spec.aliases.join(", ")}`, ""];

  const positionals =
    spec.positionals.length === 0
      ? []
      : [
          "Arguments:",
          ...spec.positionals.map((p) => {
            const name = p.required ? `<${p.name}>` : `[${p.name}]`;
            const choices =
              p.choices === undefined
                ? ""
                : ` (one of: ${p.choices.join(", ")})`;
            return `${INDENT}${pad(name, width)}  ${p.help}${choices}`;
          }),
          "",
        ];

  const groups: OptionGroup[] = ["selection", "behaviour", "output"];

  return [
    usageLine(spec),
    "",
    spec.description,
    "",
    ...aliases,
    ...positionals,
    ...groups.flatMap((group) =>
      renderOptionGroup(GROUP_TITLES[group], byGroup(options, group), width),
    ),
    "Examples:",
    ...spec.examples.map((example) => `${INDENT}${example}`),
    "",
  ].join("\n");
};

export const renderIndex = (): string => {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const sections: CommandSpec["section"][] = [
    "create",
    "navigate",
    "clean",
    "configure",
  ];

  return [
    "wt — Git worktree manager integrated with herdr",
    "",
    "Usage: wt <command> [options]",
    "       wt help <command>",
    "",
    ...sections.flatMap((section) => {
      const commands = COMMANDS.filter((c) => c.section === section);
      if (commands.length === 0) return [];
      return [
        `${SECTION_TITLES[section]}:`,
        ...commands.map((c) => `${INDENT}${pad(c.name, width)}  ${c.summary}`),
        "",
      ];
    }),
    "Run `wt help <command>` for the options of one command.",
    "",
  ].join("\n");
};

export const renderHelp = (topic?: string): string => {
  if (topic === undefined) return renderIndex();
  const spec = findCommand(topic);
  if (spec === undefined) {
    return [`wt: unknown command '${topic}'`, "", renderIndex()].join("\n");
  }
  return renderCommandHelp(spec);
};
