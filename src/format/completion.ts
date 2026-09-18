import {
  COMMANDS,
  GLOBAL_OPTIONS,
  type CommandSpec,
  type OptionSpec,
} from "../cli/spec.js";

const escape = (text: string): string =>
  text.replace(/'/g, "'\\''").replace(/:/g, "\\:");

const optionSpecs = (options: readonly OptionSpec[]): string[] =>
  options.flatMap((option) => {
    const argument = option.arity === "required" ? ":value:" : "";
    const entries = [
      `'--${option.long}[${escape(option.help)}]${argument}'`,
      ...(option.short === undefined
        ? []
        : [`'-${option.short}[${escape(option.help)}]${argument}'`]),
      ...(option.negatable === true
        ? [
            `'--no-${option.long}[${escape(`do not ${option.help.toLowerCase()}`)}]'`,
          ]
        : []),
    ];
    return entries;
  });

const commandBlock = (spec: CommandSpec): string => {
  const options = [...spec.options, ...GLOBAL_OPTIONS];
  return [
    `    ${spec.name})`,
    "      _arguments \\",
    ...optionSpecs(options).map((entry) => `        ${entry} \\`),
    "        '*:: :->args'",
    "      ;;",
  ].join("\n");
};

/**
 * Generated from the same table the parser reads, so completion cannot offer an
 * option the parser would reject.
 */
export const zshCompletion = (): string =>
  [
    "#compdef wt",
    "",
    "_wt() {",
    "  local context state state_descr line",
    "  typeset -A opt_args",
    "",
    "  _arguments -C \\",
    "    '1: :_wt_commands' \\",
    "    '*:: :->command' && return 0",
    "",
    "  case $state in",
    "    command)",
    "      case $words[1] in",
    ...COMMANDS.map((spec) => commandBlock(spec)),
    "      esac",
    "      ;;",
    "  esac",
    "}",
    "",
    "_wt_commands() {",
    "  local -a commands",
    "  commands=(",
    ...COMMANDS.flatMap((spec) => [
      `    '${spec.name}:${escape(spec.summary)}'`,
      ...(spec.aliases ?? []).map(
        (alias) => `    '${alias}:${escape(spec.summary)}'`,
      ),
    ]),
    "  )",
    "  _describe -t commands 'wt command' commands",
    "}",
    "",
    '_wt "$@"',
    "",
  ].join("\n");
