import type { LayoutNode, LeafNode } from "./parser.js";

export type HerdrPane = {
  type: "pane";
  cwd: string;
  label: string;
  env?: Record<string, string>;
};

export type HerdrSplit = {
  type: "split";
  direction: "right" | "down";
  ratio: number;
  first: HerdrLayout;
  second: HerdrLayout;
};

export type HerdrLayout = HerdrPane | HerdrSplit;

export type Resolver = {
  parent: string;
  worktree: string;
  env?: Record<string, string>;
};

export type PaneAssignment = {
  label: string;
  cwd: string;
  command: string;
  /** `claude` and `shell` are not commands to run; see `paneKind`. */
  kind: "agent" | "shell" | "command";
};

export const paneKind = (command: string): PaneAssignment["kind"] => {
  if (command === "claude") return "agent";
  if (command === "shell") return "shell";
  return "command";
};

/**
 * Even thirds, not 50/25/25.
 *
 * Splitting `[A,B,C]` as A then (B,C) with the default 0.5 ratio gives A half
 * the width. The k-th split of n children must take 1/(n-k+1).
 */
const binarize = (
  children: readonly LayoutNode[],
  direction: "right" | "down",
  build: (node: LayoutNode) => HerdrLayout,
): HerdrLayout => {
  const [head, ...rest] = children;
  if (head === undefined) throw new Error("layout: empty split");
  if (rest.length === 0) return build(head);

  return {
    type: "split",
    direction,
    ratio: 1 / (rest.length + 1),
    first: build(head),
    second: binarize(rest, direction, build),
  };
};

export type Translation = {
  layout: HerdrLayout;
  /** In tree order, which is the order `label` indices follow. */
  panes: readonly PaneAssignment[];
};

export const toHerdrLayout = (
  root: LayoutNode,
  resolver: Resolver,
): Translation => {
  const panes: PaneAssignment[] = [];

  const buildLeaf = (leaf: LeafNode): HerdrPane => {
    const label = `wt:${String(panes.length)}`;
    const cwd = leaf.target === "parent" ? resolver.parent : resolver.worktree;
    panes.push({
      label,
      cwd,
      command: leaf.command,
      kind: paneKind(leaf.command),
    });
    // No `command` on the node: every pane is born a bare shell, then
    // agent.start or pane.run types into the user's interactive shell, so
    // mise/asdf and .zshrc apply exactly as they would by hand.
    return {
      type: "pane",
      cwd,
      label,
      ...(resolver.env === undefined ? {} : { env: resolver.env }),
    };
  };

  const build = (node: LayoutNode): HerdrLayout =>
    node.kind === "leaf"
      ? buildLeaf(node)
      : binarize(node.children, node.kind === "row" ? "right" : "down", build);

  return { layout: build(root), panes };
};
