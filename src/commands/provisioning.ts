import {
  provision,
  type ProvisionInput,
  type ProvisionReport,
} from "../lib/provision/run.js";
import { describeEvent } from "../format/provision.js";
import type { Git } from "../lib/git/exec.js";
import type { CommandContext, ProgressTitle } from "./context.js";

/**
 * One place decides whether a provisioning run is watched. Without a screen it
 * still traces under --verbose, and without either it is silent as before.
 */
export const runProvisioning = async (
  git: Git,
  input: Omit<ProvisionInput, "onEvent">,
  title: ProgressTitle,
  context: CommandContext,
): Promise<ProvisionReport> => {
  const trace = context.trace;
  const watch = context.withProgress;

  if (watch === undefined) {
    return await provision(git, {
      ...input,
      onEvent:
        trace === undefined
          ? undefined
          : (event) => {
              const line = describeEvent(event);
              if (line !== undefined) trace(line);
            },
    });
  }

  return await watch(title, (emit) =>
    provision(git, {
      ...input,
      onEvent: (event) => {
        emit(event);
        const line = trace === undefined ? undefined : describeEvent(event);
        if (line !== undefined) trace?.(line);
      },
    }),
  );
};
