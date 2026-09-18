import { layoutError, type LayoutError } from "./errors.js";

export type TokenKind =
  | "lparen"
  | "rparen"
  | "pipe"
  | "under"
  | "target"
  | "command"
  | "weight"
  | "eof";

export type Token = {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
};

export type LexResult =
  | { kind: "ok"; tokens: readonly Token[] }
  | { kind: "error"; error: LayoutError };

export const TARGETS = ["parent", "wt"] as const;
export type Target = (typeof TARGETS)[number];

const isSpace = (character: string | undefined): boolean =>
  character === " " || character === "\t" || character === "\n";

/**
 * `|` and `_` are operators ONLY when surrounded by spaces. Otherwise
 * `@wt:bin/dev_server`, `@wt:make test_all` and `@parent:./run_me.sh` are each
 * cut in half — `_` is everywhere in command names.
 */
const operatorAt = (
  source: string,
  index: number,
): "pipe" | "under" | undefined => {
  const character = source[index];
  if (character !== "|" && character !== "_") return undefined;
  if (!isSpace(source[index - 1]) || !isSpace(source[index + 1])) {
    return undefined;
  }
  return character === "|" ? "pipe" : "under";
};

/** ` :50%` — a leading space is what keeps `test:2` a command. */
const weightAt = (
  source: string,
  index: number,
): { text: string; end: number } | undefined => {
  if (source[index] !== ":" || !isSpace(source[index - 1])) return undefined;
  let cursor = index + 1;
  while (/[0-9.]/.test(source[cursor] ?? "")) cursor += 1;
  if (cursor === index + 1) return undefined;
  if (source[cursor] === "%") cursor += 1;
  return { text: source.slice(index, cursor), end: cursor };
};

const readQuoted = (
  source: string,
  start: number,
): { value: string; end: number } | undefined => {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return undefined;
  const closing = source.indexOf(quote, start + 1);
  if (closing === -1) return undefined;
  return { value: source.slice(start + 1, closing), end: closing + 1 };
};

/**
 * Everything up to the next real operator, closing paren, weight or end.
 * Commands hold spaces (`pnpm dev`), so they cannot be a single word.
 */
const readCommand = (
  source: string,
  start: number,
): { value: string; end: number } => {
  const quoted = readQuoted(source, start);
  if (quoted !== undefined) return quoted;

  let cursor = start;
  while (cursor < source.length) {
    if (source[cursor] === ")") break;
    if (operatorAt(source, cursor) !== undefined) break;
    if (weightAt(source, cursor) !== undefined) break;
    cursor += 1;
  }
  return { value: source.slice(start, cursor).trimEnd(), end: cursor };
};

export const lex = (source: string): LexResult => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const weight = weightAt(source, index);
    if (weight !== undefined) {
      tokens.push({
        kind: "weight",
        value: weight.text,
        start: index,
        end: weight.end,
      });
      index = weight.end;
      continue;
    }

    if (isSpace(source[index])) {
      index += 1;
      continue;
    }

    const operator = operatorAt(source, index);
    if (operator !== undefined) {
      tokens.push({
        kind: operator,
        value: source[index] ?? "",
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }

    if (source[index] === "(") {
      tokens.push({ kind: "lparen", value: "(", start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (source[index] === ")") {
      tokens.push({ kind: "rparen", value: ")", start: index, end: index + 1 });
      index += 1;
      continue;
    }

    if (source[index] === "@") {
      let after = index + 1;
      while (/[A-Za-z]/.test(source[after] ?? "")) after += 1;
      const name = source.slice(index + 1, after);

      // `@wt` with no colon is a bare shell there, which is the common case.
      if (source[after] !== ":") {
        if (!TARGETS.includes(name as Target)) {
          return {
            kind: "error",
            error: layoutError(
              `unknown target '@${name}'`,
              index,
              `use ${TARGETS.map((target) => `@${target}`).join(" or ")}`,
            ),
          };
        }
        tokens.push({ kind: "target", value: name, start: index, end: after });
        tokens.push({
          kind: "command",
          value: "shell",
          start: after,
          end: after,
        });
        index = after;
        continue;
      }

      const colon = after;
      if (!TARGETS.includes(name as Target)) {
        return {
          kind: "error",
          error: layoutError(
            `unknown target '@${name}:'`,
            index,
            `use ${TARGETS.map((target) => `@${target}:`).join(" or ")}`,
          ),
        };
      }
      tokens.push({
        kind: "target",
        value: name,
        start: index,
        end: colon + 1,
      });

      const command = readCommand(source, colon + 1);
      if (command.value === "") {
        return {
          kind: "error",
          error: layoutError(
            `'@${name}:' has no command after it`,
            colon + 1,
            "for example @wt:shell",
          ),
        };
      }
      tokens.push({
        kind: "command",
        value: command.value,
        start: colon + 1,
        end: command.end,
      });
      index = command.end;
      continue;
    }

    const stray = readCommand(source, index);
    return {
      kind: "error",
      error: layoutError(
        `expected '@parent:' or '@wt:' before '${stray.value}'`,
        index,
        "every leaf must declare its working directory, e.g. @wt:shell",
      ),
    };
  }

  tokens.push({
    kind: "eof",
    value: "",
    start: source.length,
    end: source.length,
  });
  return { kind: "ok", tokens };
};
