import { PickRepo } from "./screens/PickRepo.js";
import { ConfigReviewScreen } from "./screens/ConfigReview.js";
import { Confirm } from "./screens/Confirm.js";
import { watchProgress } from "./watch.js";
import { prompt, type InkHeld } from "./prompt.js";
import type { ChooseRepo } from "../lib/git/resolve.js";
import type { CommandContext } from "../commands/context.js";
import type { ConfigDecision, ReviewConfig } from "../lib/config/review.js";

/**
 * The resolvers a terminal can answer. Absent ones leave every command on its
 * text path, which is what keeps `--json` and non-TTY runs byte-identical.
 */
export const interactiveResolvers = (
  held: InkHeld,
): {
  chooseRepo: ChooseRepo;
  reviewConfig: ReviewConfig;
  confirm: (question: string) => Promise<boolean>;
  withProgress: NonNullable<CommandContext["withProgress"]>;
} => ({
  withProgress: (title, work) => watchProgress(title, work, held),
  // Ink, not readline: mixing the two in one command hands stdin back and forth
  // between a line reader and a raw-mode consumer, and whatever is left in the
  // buffer lands in whichever mounts next.
  confirm: (question) =>
    prompt<boolean>(
      (done) => <Confirm question={question} onAnswer={done} />,
      held,
    ),
  chooseRepo: (choice) =>
    prompt<string | undefined>(
      (done) => <PickRepo choice={choice} onPick={done} />,
      held,
    ),
  reviewConfig: (review) =>
    prompt<ConfigDecision>(
      (done) => <ConfigReviewScreen review={review} onDecide={done} />,
      held,
    ),
});
