export type LayoutError = {
  message: string;
  /** Byte offset into the source where the caret goes. */
  at: number;
  help?: string;
};

export const layoutError = (
  message: string,
  at: number,
  help?: string,
): LayoutError => ({ message, at, help });

/**
 * rustc-style: the source, a caret under the offending character, and one line
 * of help. The caret is the whole point — "expected @parent: or @wt:" is
 * useless on a layout with four leaves.
 */
export const formatLayoutError = (
  source: string,
  error: LayoutError,
): string => {
  const caretAt = Math.min(Math.max(error.at, 0), source.length);
  return [
    `wt: layout: ${error.message}`,
    `  ${source}`,
    `  ${" ".repeat(caretAt)}^`,
    ...(error.help === undefined ? [] : [`  help: ${error.help}`]),
  ].join("\n");
};
