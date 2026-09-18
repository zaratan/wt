import { preflight } from "../lib/herdr/preflight.js";
import { listSpaces } from "../lib/herdr/workspace.js";
import { canonical } from "../lib/fs/canonical.js";
import type { CommandContext } from "./context.js";

export type OpenSpace = { label?: string; focused: boolean };

/**
 * A listing decorated with herdr must not wait on it: a wedged server answers
 * its socket and then nothing, so the default 5 s call budget is the hang.
 */
const DECORATION_TIMEOUT_MS = 400;

export type SpaceIndex = {
  /** Undefined when herdr could not be reached, which is not an error here. */
  byCheckout?: ReadonlyMap<string, OpenSpace>;
  unavailable?: string;
};

export const indexSpaces = async (
  context: CommandContext,
): Promise<SpaceIndex> => {
  const health = await preflight({
    env: context.env,
    cwd: context.cwd,
    trace: context.trace,
    callTimeoutMs: DECORATION_TIMEOUT_MS,
    skipStatusFallback: true,
  });
  if (health.kind !== "ok") return { unavailable: health.message };

  const spaces = await listSpaces(health.client);
  if (spaces === undefined)
    return { unavailable: "herdr refused workspace.list" };

  const byCheckout = new Map<string, OpenSpace>();
  for (const space of spaces) {
    const path = space.worktree?.checkout_path;
    if (path === undefined) continue;
    const open = { label: space.label, focused: space.focused === true };
    // herdr's spelling and git's need not match: on macOS /tmp is /private/tmp.
    // Both are keys, so a lookup by either one finds the space.
    byCheckout.set(path, open);
    byCheckout.set(await canonical(path), open);
  }
  return { byCheckout };
};
