import { describe, it, expect } from "vitest";
import { parseLayout, leaves, type LayoutNode } from "./parser.js";
import { formatLayoutError } from "./errors.js";
import { toHerdrLayout, type HerdrLayout } from "./toHerdr.js";
import { printLayout, renderLayout } from "./render.js";

const CANONICAL = "(@parent:claude | (@wt:shell _ @wt:bin/dev))";

const parseOk = (source: string): LayoutNode => {
  const result = parseLayout(source);
  if (result.kind !== "ok") {
    throw new Error(`expected ok: ${formatLayoutError(source, result.error)}`);
  }
  return result.root;
};

const parseErr = (source: string) => {
  const result = parseLayout(source);
  if (result.kind !== "error") throw new Error("expected an error");
  return result.error;
};

const caretColumn = (source: string): number => {
  const rendered = formatLayoutError(source, parseErr(source));
  const line = rendered.split("\n")[2] ?? "";
  return line.indexOf("^") - 2;
};

describe("parsing", () => {
  it("parses the canonical layout", () => {
    const root = parseOk(CANONICAL);
    expect(root.kind).toBe("row");
    expect(leaves(root).map((leaf) => leaf.command)).toEqual([
      "claude",
      "shell",
      "bin/dev",
    ]);
  });

  it("parses a single pane", () => {
    expect(leaves(parseOk("@wt:shell"))).toHaveLength(1);
  });

  it("keeps a command that contains spaces", () => {
    expect(leaves(parseOk("@wt:pnpm dev"))[0]?.command).toBe("pnpm dev");
    expect(leaves(parseOk("(@wt:pnpm dev | @parent:claude)"))[0]?.command).toBe(
      "pnpm dev",
    );
  });

  it("does not cut a command on an underscore", () => {
    expect(leaves(parseOk("@wt:bin/dev_server"))[0]?.command).toBe(
      "bin/dev_server",
    );
    expect(leaves(parseOk("@wt:make test_all"))[0]?.command).toBe(
      "make test_all",
    );
    expect(leaves(parseOk("@parent:./run_me.sh"))[0]?.command).toBe(
      "./run_me.sh",
    );
  });

  it("does not read a trailing :2 as a ratio", () => {
    expect(leaves(parseOk("@wt:pnpm run test:2"))[0]?.command).toBe(
      "pnpm run test:2",
    );
  });

  it("keeps a pipe inside a quoted command", () => {
    expect(leaves(parseOk('@wt:"a | b"'))[0]?.command).toBe("a | b");
  });

  it("keeps a sed expression intact", () => {
    expect(leaves(parseOk("@wt:sed s/a:b/c/"))[0]?.command).toBe(
      "sed s/a:b/c/",
    );
  });

  it("flattens an n-ary row", () => {
    const root = parseOk("(@wt:a | @wt:b | @wt:c)");
    expect(root.kind === "row" && root.children).toHaveLength(3);
  });

  it("round-trips through its own printer", () => {
    expect(printLayout(parseOk(CANONICAL))).toBe(CANONICAL);
  });
});

describe("syntax errors", () => {
  it("refuses a leaf with no target, pointing at it", () => {
    const source = "(@parent:claude | (shell _ @wt:bin/dev))";
    expect(parseErr(source).message).toContain("@parent:");
    expect(caretColumn(source)).toBe(source.indexOf("shell"));
  });

  it("refuses mixing | and _ at one level, pointing at the operator", () => {
    const source = "@wt:a | @wt:b _ @wt:c";
    const error = parseErr(source);
    expect(error.message).toContain("cannot follow");
    expect(caretColumn(source)).toBe(source.indexOf("_"));
  });

  it("names a ratio as unsupported rather than as a syntax error", () => {
    expect(parseErr("(@wt:shell :50% | @wt:x)").message).toContain(
      "not supported yet",
    );
  });

  it("reports an unclosed group", () => {
    expect(parseErr("(@wt:shell | @wt:x").message).toContain("never closed");
  });

  it("reports a stray closing paren", () => {
    expect(parseErr("@wt:shell)").message).toContain("no group open");
  });

  it("reports an unknown target", () => {
    expect(parseErr("@nope:shell").message).toContain("unknown target");
  });

  it("reports a target with no command", () => {
    expect(parseErr("@wt:").message).toContain("no command");
  });

  it("reports an empty layout", () => {
    expect(parseErr("").message).toContain("ends where a pane was expected");
  });
});

const collectRatios = (layout: HerdrLayout): number[] =>
  layout.type === "pane"
    ? []
    : [
        layout.ratio,
        ...collectRatios(layout.first),
        ...collectRatios(layout.second),
      ];

describe("translation to herdr", () => {
  const resolver = { parent: "/parent", worktree: "/wt" };

  it("resolves each leaf's cwd from its target", () => {
    const { panes } = toHerdrLayout(parseOk(CANONICAL), resolver);
    expect(panes.map((pane) => pane.cwd)).toEqual(["/parent", "/wt", "/wt"]);
  });

  it("labels panes in tree order", () => {
    const { panes } = toHerdrLayout(parseOk(CANONICAL), resolver);
    expect(panes.map((pane) => pane.label)).toEqual(["wt:0", "wt:1", "wt:2"]);
  });

  it("classifies claude, shell and a plain command apart", () => {
    const { panes } = toHerdrLayout(parseOk(CANONICAL), resolver);
    expect(panes.map((pane) => pane.kind)).toEqual([
      "agent",
      "shell",
      "command",
    ]);
  });

  it("never puts a command on a pane node", () => {
    const { layout } = toHerdrLayout(parseOk(CANONICAL), resolver);
    const hasCommand = (node: HerdrLayout): boolean =>
      node.type === "pane"
        ? "command" in node
        : hasCommand(node.first) || hasCommand(node.second);
    expect(hasCommand(layout)).toBe(false);
  });

  it("gives three children even thirds, not 50/25/25", () => {
    const { layout } = toHerdrLayout(
      parseOk("(@wt:a | @wt:b | @wt:c)"),
      resolver,
    );
    expect(collectRatios(layout)).toEqual([1 / 3, 1 / 2]);
  });

  it("gives four children a quarter, a third, then a half", () => {
    const { layout } = toHerdrLayout(
      parseOk("(@wt:a | @wt:b | @wt:c | @wt:d)"),
      resolver,
    );
    expect(collectRatios(layout)).toEqual([1 / 4, 1 / 3, 1 / 2]);
  });

  it("maps | to right and _ to down", () => {
    const { layout } = toHerdrLayout(parseOk(CANONICAL), resolver);
    if (layout.type !== "split") throw new Error("expected split");
    expect(layout.direction).toBe("right");
    expect(layout.second.type === "split" && layout.second.direction).toBe(
      "down",
    );
  });
});

describe("preview", () => {
  it("draws one box per pane", () => {
    const drawing = renderLayout(parseOk(CANONICAL));
    expect(drawing).toContain("claude");
    expect(drawing).toContain("bin/dev");
    expect(drawing.split("\n").length).toBeGreaterThan(5);
  });
});

describe("bare targets", () => {
  it("reads @wt as a shell in the worktree", () => {
    const leaf = leaves(parseOk("@wt"))[0];
    expect(leaf?.target).toBe("wt");
    expect(leaf?.command).toBe("shell");
  });

  it("reads @parent as a shell in the parent", () => {
    const leaf = leaves(parseOk("@parent"))[0];
    expect(leaf?.target).toBe("parent");
    expect(leaf?.command).toBe("shell");
  });

  it("mixes bare and explicit targets", () => {
    const root = parseOk("(@parent:claude | (@wt _ @wt:bin/dev))");
    expect(leaves(root).map((leaf) => leaf.command)).toEqual([
      "claude",
      "shell",
      "bin/dev",
    ]);
  });

  it("still rejects an unknown bare target", () => {
    expect(parseErr("@nope").message).toContain("unknown target");
  });
});
