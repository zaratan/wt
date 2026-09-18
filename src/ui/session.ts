import type { CommandContext } from "../commands/context.js";

export type Outcome<T> =
  | { kind: "done"; value: T }
  | { kind: "failed"; message: string };

/**
 * A fresh AbortController per action. The one index.tsx builds lives for the
 * whole process, so after a first Ctrl-C every later action from a live screen
 * would fail instantly with nothing to explain it.
 *
 * The resolvers are all stripped: a screen answers its own questions before
 * calling a command, so nothing reaches for stdin behind Ink's back.
 */
export const actionContext = (base: CommandContext): CommandContext => ({
  ...base,
  confirm: undefined,
  chooseRepo: undefined,
  reviewConfig: undefined,
  withProgress: undefined,
});

/**
 * Every command the dashboard runs goes through here, so a thrown error lands
 * on screen instead of killing the process over a frame that Ink still owns,
 * and so the caller always holds a way to abort.
 */
export const runAction = async <T>(
  base: CommandContext,
  work: (context: CommandContext) => Promise<T>,
  hold: (abort: () => void) => void,
): Promise<Outcome<T>> => {
  const aborter = new AbortController();
  hold(() => {
    aborter.abort();
  });

  try {
    const value = await work({
      ...actionContext(base),
      signal: aborter.signal,
    });
    return { kind: "done", value };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
