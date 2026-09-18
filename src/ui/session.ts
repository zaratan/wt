import type { CommandContext } from "../commands/context.js";

/**
 * A fresh AbortController per action. The one index.tsx builds lives for the
 * whole process, so after a first Ctrl-C every later action from a live screen
 * would fail instantly with nothing to explain it.
 *
 * `confirm` is deliberately absent: a screen resolves its own questions before
 * calling a command, so nothing ever reaches for stdin behind Ink's back.
 */
export const actionContext = (
  base: CommandContext,
): { context: CommandContext; abort: () => void } => {
  const aborter = new AbortController();
  return {
    context: {
      ...base,
      signal: aborter.signal,
      confirm: undefined,
      chooseRepo: undefined,
      reviewConfig: undefined,
      withProgress: undefined,
    },
    abort: () => {
      aborter.abort();
    },
  };
};
