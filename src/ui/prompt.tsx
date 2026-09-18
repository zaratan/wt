import { render } from "ink";

export type InkHeld = { current: boolean };

export type PromptStreams = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
};

/**
 * Mounts Ink only while a question is on screen, and unmounts before the caller
 * writes anything: stdout belongs to one of them at a time, never both.
 *
 * `waitUntilExit()` is deliberately not awaited — measured on ink 6.6, it never
 * resolves after `unmount()`, which left the answered screen on display forever.
 */
export const prompt = async <T,>(
  screen: (done: (value: T) => void) => React.JSX.Element,
  held: InkHeld,
  streams: PromptStreams = {},
): Promise<T> => {
  let settle: ((value: T) => void) | undefined;
  const answer = new Promise<T>((resolve) => {
    settle = resolve;
  });

  held.current = true;
  const instance = render(
    screen((value) => {
      settle?.(value);
    }),
    { ...streams, exitOnCtrlC: false },
  );

  try {
    return await answer;
  } finally {
    // A question is not output: wipe it so the command's own result is not
    // preceded by a dead screen and its key hints.
    instance.clear();
    instance.unmount();
    held.current = false;
  }
};
