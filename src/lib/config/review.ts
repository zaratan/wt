import type { Detected } from "./detect.js";
import type { UmbrellaReason, UmbrellaVerdict } from "../git/topology.js";

export type ConfigReview = {
  repoName: string;
  /** Where the file would land, so the screen can say it out loud. */
  path: string;
  detected: Detected;
  umbrella: UmbrellaVerdict;
  umbrellaReason: UmbrellaReason;
};

export type ConfigDecision =
  /** `copy` holds the paths kept, resolved — never an index into the list. */
  { kind: "write"; copy: readonly string[] } | { kind: "skip" };

export type ReviewConfig = (review: ConfigReview) => Promise<ConfigDecision>;

/** What the screen starts from: everything but the entries held for their size. */
export const initialSelection = (detected: Detected): readonly string[] =>
  detected.copy
    .filter((entry) => entry.held === undefined)
    .map((entry) => entry.path);

/**
 * Turning an entry on clears its `held` mark: the size was the reason it was
 * proposed commented out, and the user has just overruled that.
 */
export const applyDecision = (
  detected: Detected,
  copy: readonly string[],
): Detected => ({
  ...detected,
  copy: detected.copy
    .filter((entry) => copy.includes(entry.path))
    .map((entry) => ({ ...entry, held: undefined })),
});
