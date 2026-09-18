import { render } from "ink";
import { App } from "./App.js";
import type { InkHeld, PromptStreams } from "./prompt.js";
import type { CommandContext } from "../commands/context.js";
import type { Leaving } from "./App.js";

/**
 * The dashboard owns the terminal for its whole life, unlike a question. It
 * unmounts before anything is printed, so a message it leaves behind lands in
 * a terminal Ink has already given back.
 */
export const runDashboard = async (
  base: CommandContext,
  held: InkHeld,
  streams: PromptStreams = {},
): Promise<Leaving> => {
  let leaving: Leaving = {};

  held.current = true;
  const instance = render(
    <App
      base={base}
      onLeave={(asked) => {
        leaving = asked;
      }}
    />,
    { ...streams, exitOnCtrlC: false },
  );

  try {
    await instance.waitUntilExit();
    return leaving;
  } finally {
    instance.clear();
    instance.unmount();
    held.current = false;
  }
};
