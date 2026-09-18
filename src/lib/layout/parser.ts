import { layoutError, type LayoutError } from "./errors.js";
import { lex, type Target, type Token } from "./lexer.js";

export type LeafNode = {
  kind: "leaf";
  target: Target;
  command: string;
  start: number;
  end: number;
};

export type SplitNode = {
  kind: "row" | "column";
  children: readonly LayoutNode[];
  start: number;
  end: number;
};

export type LayoutNode = LeafNode | SplitNode;

export type ParseResult =
  | { kind: "ok"; root: LayoutNode }
  | { kind: "error"; error: LayoutError };

class LayoutSyntaxError extends Error {
  constructor(readonly detail: LayoutError) {
    super(detail.message);
  }
}

function fail(message: string, at: number, help?: string): never {
  throw new LayoutSyntaxError(layoutError(message, at, help));
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) throw new Error("layout: ran past EOF");
    return token;
  }

  private take(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  parse(): LayoutNode {
    const node = this.expr();
    const next = this.peek();
    if (next.kind !== "eof") {
      fail(
        next.kind === "rparen"
          ? "')' with no group open here"
          : `unexpected '${next.value}'`,
        next.start,
        next.kind === "rparen"
          ? "remove it, or open a group earlier"
          : undefined,
      );
    }
    return node;
  }

  /**
   * Mixing `|` and `_` at one level is a syntax error, not a precedence
   * question: the first operator fixes the level, and the caret lands on the
   * one that disagrees.
   */
  private expr(): LayoutNode {
    const first = this.primary();
    const operator = this.peek();
    if (operator.kind !== "pipe" && operator.kind !== "under") return first;

    const level = operator.kind;
    const children: LayoutNode[] = [first];

    for (;;) {
      const next = this.peek();
      if (next.kind !== "pipe" && next.kind !== "under") break;
      if (next.kind !== level) {
        fail(
          `'${next.value}' cannot follow '${level === "pipe" ? "|" : "_"}' at the same level`,
          next.start,
          "put one of them in parentheses to say which groups first",
        );
      }
      this.take();
      children.push(this.primary());
    }

    const last = children[children.length - 1];
    return {
      kind: level === "pipe" ? "row" : "column",
      children,
      start: first.start,
      end: last?.end ?? first.end,
    };
  }

  private primary(): LayoutNode {
    const token = this.peek();

    if (token.kind === "weight") {
      fail(
        "ratios are not supported yet",
        token.start,
        "drop the ratio; panes are split evenly",
      );
    }

    if (token.kind === "lparen") {
      this.take();
      const inner = this.expr();
      const closing = this.peek();
      if (closing.kind !== "rparen") {
        fail("this group is never closed", token.start, "add the matching ')'");
      }
      this.take();
      this.rejectWeight();
      return { ...inner, start: token.start, end: closing.end };
    }

    if (token.kind === "target") {
      this.take();
      const command = this.take();
      if (command.kind !== "command") {
        fail(
          `'@${token.value}:' has no command after it`,
          token.end,
          "for example @wt:shell",
        );
      }
      this.rejectWeight();
      return {
        kind: "leaf",
        target: token.value as Target,
        command: command.value,
        start: token.start,
        end: command.end,
      };
    }

    fail(
      token.kind === "eof"
        ? "the layout ends where a pane was expected"
        : `expected a pane, found '${token.value}'`,
      token.start,
      "a pane looks like @wt:shell",
    );
  }

  private rejectWeight(): void {
    const next = this.peek();
    if (next.kind === "weight") {
      fail(
        "ratios are not supported yet",
        next.start,
        "drop the ratio; panes are split evenly",
      );
    }
  }
}

export const parseLayout = (source: string): ParseResult => {
  const lexed = lex(source);
  if (lexed.kind === "error") return lexed;

  try {
    return { kind: "ok", root: new Parser(lexed.tokens).parse() };
  } catch (error) {
    if (error instanceof LayoutSyntaxError) {
      return { kind: "error", error: error.detail };
    }
    throw error;
  }
};

export const leaves = (node: LayoutNode): readonly LeafNode[] =>
  node.kind === "leaf"
    ? [node]
    : node.children.flatMap((child) => leaves(child));
