import type { CommandSpec, OptionSpec } from "./spec.js";
import { COMMANDS, GLOBAL_OPTIONS, findCommand } from "./spec.js";

export type OptionValues = Readonly<Record<string, string | boolean>>;

export type Invocation = {
  spec: CommandSpec;
  positionals: Readonly<Record<string, string | undefined>>;
  options: OptionValues;
  /** Everything after `--`. */
  rest: readonly string[];
};

export type ParseResult =
  | { kind: "run"; invocation: Invocation }
  | { kind: "help"; topic?: string }
  | { kind: "version" }
  | { kind: "error"; message: string; hint?: string; helpTopic?: string };

const optionKey = (option: OptionSpec): string => option.long;

const describeOptions = (options: readonly OptionSpec[]): string =>
  options
    .flatMap((option) => [
      `--${option.long}`,
      ...(option.negatable === true ? [`--no-${option.long}`] : []),
      ...(option.short === undefined ? [] : [`-${option.short}`]),
    ])
    .join(", ");

const matchOption = (
  token: string,
  available: readonly OptionSpec[],
): { option: OptionSpec; negated: boolean } | undefined => {
  if (token.startsWith("--")) {
    const name = token.slice(2);
    const direct = available.find((option) => option.long === name);
    if (direct !== undefined) return { option: direct, negated: false };

    if (name.startsWith("no-")) {
      const negated = available.find(
        (option) => option.negatable === true && option.long === name.slice(3),
      );
      if (negated !== undefined) return { option: negated, negated: true };
    }
    return undefined;
  }

  const short = available.find((option) => option.short === token.slice(1));
  return short === undefined ? undefined : { option: short, negated: false };
};

/**
 * `new [repo] <branch>` binds a lone value to `branch`; `config <action> [repo]`
 * binds it to `action`. The leading slot's optionality decides.
 */
const anchorsRight = (spec: CommandSpec): boolean =>
  spec.positionals[0]?.required === false;

type Assignment =
  | { kind: "ok"; values: Record<string, string | undefined> }
  | { kind: "error"; message: string };

const assignPositionals = (
  spec: CommandSpec,
  values: readonly string[],
): Assignment => {
  const slots = spec.positionals;
  if (values.length > slots.length) {
    const shape = slots
      .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
      .join(" ");
    return {
      kind: "error",
      message: `wt ${spec.name}: too many arguments (expected \`${shape}\`, got ${String(values.length)})`,
    };
  }

  const offset = anchorsRight(spec) ? slots.length - values.length : 0;
  const assigned: Record<string, string | undefined> = {};
  values.forEach((value, index) => {
    const slot = slots[index + offset];
    if (slot !== undefined) assigned[slot.name] = value;
  });

  return { kind: "ok", values: assigned };
};

/** Runs after `--repo`/`--branch` merge in: those supply no positional at all. */
const validatePositionals = (
  spec: CommandSpec,
  assigned: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  for (const slot of spec.positionals) {
    const supplied = assigned[slot.name];
    if (slot.required && supplied === undefined) {
      return `wt ${spec.name}: missing <${slot.name}>`;
    }
    if (
      supplied !== undefined &&
      slot.choices !== undefined &&
      !slot.choices.includes(supplied)
    ) {
      return `wt ${spec.name}: unknown ${slot.name} '${supplied}' (expected ${slot.choices.join(", ")})`;
    }
  }
  return undefined;
};

const DEFAULT_COMMAND = "ls";

/**
 * Skips the VALUE of a global option given before the command. Without this,
 * `wt --repo new ls` dispatches `new` with branch `ls`, and creates it.
 */
const OPTIONS_TAKING_A_VALUE: readonly OptionSpec[] = [
  ...GLOBAL_OPTIONS,
  ...COMMANDS.flatMap((command) => command.options),
].filter((option) => option.arity === "required");

const findCommandToken = (head: readonly string[]): string | undefined => {
  for (let index = 0; index < head.length; index += 1) {
    const token = head[index];
    if (token === undefined) continue;

    if (!token.startsWith("-") || token === "-") return token;
    if (token.includes("=")) continue;
    if (matchOption(token, OPTIONS_TAKING_A_VALUE) !== undefined) index += 1;
  }
  return undefined;
};

export const parse = (argv: readonly string[]): ParseResult => {
  const separator = argv.indexOf("--");
  const head = separator === -1 ? argv : argv.slice(0, separator);
  const rest = separator === -1 ? [] : argv.slice(separator + 1);

  // Winning wherever they appear is what stops `--help` becoming a branch name.
  const wantsHelp = head.includes("--help") || head.includes("-h");
  const wantsVersion = head.includes("--version") || head.includes("-V");

  const commandToken = findCommandToken(head);

  if (wantsVersion) return { kind: "version" };

  if (commandToken === undefined) {
    if (wantsHelp) return { kind: "help" };
    const fallback = findCommand(DEFAULT_COMMAND);
    if (fallback === undefined) {
      return {
        kind: "error",
        message: "wt: internal error: no default command",
      };
    }
    return {
      kind: "run",
      invocation: {
        spec: fallback,
        positionals: {},
        options: {},
        rest,
      },
    };
  }

  const spec = findCommand(commandToken);
  if (spec === undefined) {
    return {
      kind: "error",
      message: `wt: unknown command '${commandToken}'`,
      hint: `known commands: ${COMMANDS.map((c) => c.name).join(", ")}`,
    };
  }

  if (spec.name === "help") {
    const topic = head.filter((t) => !t.startsWith("-"))[1];
    return { kind: "help", topic };
  }

  const available = [...GLOBAL_OPTIONS, ...spec.options];
  const options: Record<string, string | boolean> = {};
  const positionalValues: string[] = [];
  let commandSeen = false;

  for (let index = 0; index < head.length; index += 1) {
    const token = head[index];
    if (token === undefined) continue;

    if (!token.startsWith("-") || token === "-") {
      if (!commandSeen && token === commandToken) {
        commandSeen = true;
        continue;
      }
      positionalValues.push(token);
      continue;
    }

    const equals = token.indexOf("=");
    const flagPart = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);

    const matched = matchOption(flagPart, available);
    if (matched === undefined) {
      const own = describeOptions(spec.options);
      return {
        kind: "error",
        message: `wt ${spec.name}: unknown option '${flagPart}'`,
        hint:
          own === ""
            ? `\`wt ${spec.name}\` takes no options of its own`
            : `options of \`wt ${spec.name}\`: ${own}`,
        helpTopic: spec.name,
      };
    }

    const { option, negated } = matched;

    if (option.arity === "none") {
      if (inlineValue !== undefined) {
        return {
          kind: "error",
          message: `wt ${spec.name}: '--${option.long}' takes no value`,
        };
      }
      options[optionKey(option)] = !negated;
      continue;
    }

    const value = inlineValue ?? head[index + 1];
    if (
      value === undefined ||
      (inlineValue === undefined && value.startsWith("-"))
    ) {
      return {
        kind: "error",
        message:
          `wt ${spec.name}: '--${option.long}' needs a value ${option.placeholder ?? ""}`.trim(),
      };
    }
    options[optionKey(option)] = value;
    if (inlineValue === undefined) index += 1;
  }

  if (wantsHelp) return { kind: "help", topic: spec.name };

  const assignment = assignPositionals(spec, positionalValues);
  if (assignment.kind === "error") {
    return { kind: "error", message: assignment.message };
  }
  const assigned = assignment.values;

  // Both forms at once is a contradiction, not a precedence question.
  for (const name of ["repo", "branch"] as const) {
    const flagValue = options[name];
    const positional = assigned[name];
    if (typeof flagValue === "string" && positional !== undefined) {
      return {
        kind: "error",
        message: `wt ${spec.name}: ${name} given twice, as '${positional}' and as --${name} ${flagValue}`,
      };
    }
    if (typeof flagValue === "string") assigned[name] = flagValue;
  }

  const invalid = validatePositionals(spec, assigned);
  if (invalid !== undefined) return { kind: "error", message: invalid };

  return {
    kind: "run",
    invocation: { spec, positionals: assigned, options, rest },
  };
};

export const flag = (
  options: OptionValues,
  name: string,
  fallback: boolean,
): boolean => {
  const value = options[name];
  return typeof value === "boolean" ? value : fallback;
};

export const value = (
  options: OptionValues,
  name: string,
): string | undefined => {
  const raw = options[name];
  return typeof raw === "string" ? raw : undefined;
};
