import { render } from "ink";
import { App } from "./App.js";
import type { InkHeld, PromptStreams } from "./prompt.js";
import type { CommandContext } from "../commands/context.js";

/**
 * The dashboard owns the terminal for its whole life, unlike a question. It
 * unmounts before anything is printed, so a message it leaves behind lands in
 * a terminal Ink has already given back.
 */
export const runDashboard = async (
  base: CommandContext,
  held: InkHeld,
  streams: PromptStreams = {},
): Promise<string | undefined> => {
  let leaving: string | undefined;

  held.current = true;
  const instance = render(
    <App
      base={base}
      onLeave={(message) => {
        leaving = message;
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
