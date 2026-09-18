import type { CommandContext } from "../commands/context.js";
import type { ConfigDecision, ConfigReview } from "../lib/config/review.js";
import type { ProvisionEvent } from "../lib/provision/run.js";
import type { ProgressTitle } from "../commands/context.js";

export type Subscribe = (listen: (event: ProvisionEvent) => void) => () => void;

/** A screen the running command is waiting on, rendered by the app that asked. */
export type Pending =
  | { kind: "confirm"; question: string; answer: (yes: boolean) => void }
  | {
      kind: "review";
      review: ConfigReview;
      answer: (decision: ConfigDecision) => void;
    }
  | { kind: "progress"; title: ProgressTitle; subscribe: Subscribe };

/**
 * Resolvers that render INSIDE the running app rather than mounting Ink of
 * their own. The one-shot CLI path mounts per question and unmounts; a TUI
 * stays a TUI until the user leaves it.
 */
export const inAppResolvers = (
  show: (pending: Pending | undefined) => void,
): Pick<CommandContext, "confirm" | "reviewConfig" | "withProgress"> => ({
  confirm: (question) =>
    new Promise<boolean>((resolve) => {
      show({
        kind: "confirm",
        question,
        answer: (yes) => {
          show(undefined);
          resolve(yes);
        },
      });
    }),

  reviewConfig: (review) =>
    new Promise<ConfigDecision>((resolve) => {
      show({
        kind: "review",
        review,
        answer: (decision) => {
          show(undefined);
          resolve(decision);
        },
      });
    }),

  withProgress: async (title, work) => {
    const listeners = new Set<(event: ProvisionEvent) => void>();
    show({
      kind: "progress",
      title,
      subscribe: (listen) => {
        listeners.add(listen);
        return () => listeners.delete(listen);
      },
    });
    try {
      return await work((event) => {
        for (const listen of listeners) listen(event);
      });
    } finally {
      show(undefined);
    }
  },
});
