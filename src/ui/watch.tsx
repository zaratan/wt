import { render } from "ink";
import { Provisioning } from "./screens/Provisioning.js";
import type { InkHeld, PromptStreams } from "./prompt.js";
import type { ProvisionEvent } from "../lib/provision/run.js";
import type { ProgressTitle } from "../commands/context.js";

/**
 * Mounts a screen for the duration of the work rather than until an answer,
 * and takes it down before the caller prints anything. The child writes to a
 * pipe, never to our stdout, so there is nothing to contend with.
 */
export const watchProgress = async <T,>(
  title: ProgressTitle,
  work: (emit: (event: ProvisionEvent) => void) => Promise<T>,
  held: InkHeld,
  streams: PromptStreams = {},
): Promise<T> => {
  const listeners = new Set<(event: ProvisionEvent) => void>();
  const subscribe = (listen: (event: ProvisionEvent) => void): (() => void) => {
    listeners.add(listen);
    return () => listeners.delete(listen);
  };

  held.current = true;
  const instance = render(
    <Provisioning title={title} subscribe={subscribe} />,
    { ...streams, exitOnCtrlC: false },
  );

  try {
    return await work((event) => {
      for (const listen of listeners) listen(event);
    });
  } finally {
    instance.clear();
    instance.unmount();
    held.current = false;
  }
};
