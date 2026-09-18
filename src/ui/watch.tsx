import { render } from "ink";
import { Provisioning } from "./screens/Provisioning.js";
import type { InkHeld, PromptStreams } from "./prompt.js";
import type { ProvisionEvent } from "../lib/provision/run.js";
import type { ProgressTitle } from "../commands/context.js";

/**
 * Mounts a screen for the duration of the work rather than until an answer,
 * and takes it down before the caller prints anything. The child writes to a
 * pipe, so it never contends for stdout; the --verbose trace would, which is
 * why runProvisioning drops it while this is mounted.
 */
export const watchProgress = async <T,>(
  title: ProgressTitle,
  work: (emit: (event: ProvisionEvent) => void) => Promise<T>,
  held: InkHeld,
  streams: PromptStreams = {},
  stopping?: { requested: boolean },
): Promise<T> => {
  const listeners = new Set<(event: ProvisionEvent) => void>();
  const subscribe = (listen: (event: ProvisionEvent) => void): (() => void) => {
    listeners.add(listen);
    return () => listeners.delete(listen);
  };

  held.current = true;
  const draw = (): void => {
    instance.rerender(
      <Provisioning
        title={title}
        subscribe={subscribe}
        stopping={stopping?.requested === true}
      />,
    );
  };
  const instance = render(
    <Provisioning title={title} subscribe={subscribe} stopping={false} />,
    { ...streams, exitOnCtrlC: false },
  );
  const watchStop = setInterval(draw, 200);
  watchStop.unref();

  try {
    return await work((event) => {
      for (const listen of listeners) listen(event);
    });
  } finally {
    clearInterval(watchStop);
    instance.clear();
    instance.unmount();
    held.current = false;
  }
};
