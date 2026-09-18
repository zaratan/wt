import { formatLayoutError } from "../lib/layout/errors.js";
import { parseLayout } from "../lib/layout/parser.js";
import { renderLayout, printLayout } from "../lib/layout/render.js";
import { toHerdrLayout } from "../lib/layout/toHerdr.js";

export type LayoutCheck = { text: string; ok: boolean };

export const checkLayout = (source: string): LayoutCheck => {
  const parsed = parseLayout(source);
  if (parsed.kind === "error") {
    return { ok: false, text: `${formatLayoutError(source, parsed.error)}\n` };
  }

  const { panes } = toHerdrLayout(parsed.root, {
    parent: "<parent>",
    worktree: "<worktree>",
  });

  const width = Math.max(...panes.map((pane) => pane.label.length));
  return {
    ok: true,
    text: [
      printLayout(parsed.root),
      "",
      renderLayout(parsed.root),
      "",
      "Panes:",
      ...panes.map(
        (pane) =>
          `  ${pane.label.padEnd(width)}  ${pane.cwd.padEnd(11)}  ${pane.kind.padEnd(7)}  ${pane.command}`,
      ),
      "",
    ].join("\n"),
  };
};
