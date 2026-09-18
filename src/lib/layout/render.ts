import type { LayoutNode } from "./parser.js";

type Box = { lines: string[]; width: number; height: number };

const WIDTH = 60;
const HEIGHT = 13;

const centre = (text: string, width: number): string => {
  const clipped = text.length > width ? `${text.slice(0, width - 1)}…` : text;
  const left = Math.max(0, Math.floor((width - clipped.length) / 2));
  return (
    " ".repeat(left) +
    clipped +
    " ".repeat(Math.max(0, width - left - clipped.length))
  );
};

const leafBox = (
  label: string,
  detail: string,
  width: number,
  height: number,
): Box => {
  const inner = Math.max(1, width - 2);
  const lines: string[] = [`┌${"─".repeat(inner)}┐`];
  const body = Math.max(1, height - 2);
  const labelRow = Math.floor((body - 1) / 2);

  for (let row = 0; row < body; row += 1) {
    const text =
      row === labelRow
        ? centre(label, inner)
        : row === labelRow + 1
          ? centre(detail, inner)
          : " ".repeat(inner);
    lines.push(`│${text}│`);
  }
  lines.push(`└${"─".repeat(inner)}┘`);
  return { lines, width, height: lines.length };
};

const sideBySide = (boxes: readonly Box[]): Box => {
  const height = Math.max(...boxes.map((box) => box.height));
  const lines: string[] = [];
  for (let row = 0; row < height; row += 1) {
    lines.push(
      boxes.map((box) => box.lines[row] ?? " ".repeat(box.width)).join(""),
    );
  }
  return {
    lines,
    width: boxes.reduce((sum, box) => sum + box.width, 0),
    height,
  };
};

const stacked = (boxes: readonly Box[]): Box => {
  const lines = boxes.flatMap((box) => box.lines);
  return {
    lines,
    width: Math.max(...boxes.map((box) => box.width)),
    height: lines.length,
  };
};

const draw = (node: LayoutNode, width: number, height: number): Box => {
  if (node.kind === "leaf") {
    return leafBox(node.command, `@${node.target}`, width, height);
  }

  const count = node.children.length;
  if (node.kind === "row") {
    const share = Math.max(6, Math.floor(width / count));
    return sideBySide(node.children.map((child) => draw(child, share, height)));
  }

  const share = Math.max(3, Math.floor(height / count));
  return stacked(node.children.map((child) => draw(child, width, share)));
};

/** ASCII preview, so `wt layout check` shows the shape without touching herdr. */
export const renderLayout = (node: LayoutNode): string =>
  draw(node, WIDTH, HEIGHT).lines.join("\n");

/** Canonical form, for round-trip checks and for writing a layout back out. */
export const printLayout = (node: LayoutNode): string => {
  if (node.kind === "leaf") return `@${node.target}:${node.command}`;
  const separator = node.kind === "row" ? " | " : " _ ";
  const inner = node.children
    .map((child) => printLayout(child))
    .join(separator);
  return `(${inner})`;
};
