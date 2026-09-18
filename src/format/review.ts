import type { Detected } from "../lib/config/detect.js";
import type { UmbrellaReason, UmbrellaVerdict } from "../lib/git/topology.js";

export type ReviewGroup = {
  reason: string;
  held: boolean;
  entries: readonly { path: string; measure?: string }[];
};

const HELD_HEADING = "too big to copy blindly — off unless you say so";

/**
 * Grouped by reason rather than one reason per line: the reasons come from a
 * fixed table and repeat, and a reason trailing a path of variable length stops
 * being read by the third row.
 */
export const reviewGroups = (detected: Detected): readonly ReviewGroup[] => {
  const byReason = new Map<string, ReviewGroup>();

  for (const entry of detected.copy) {
    const held = entry.held !== undefined;
    const reason = held ? HELD_HEADING : entry.reason;
    const group = byReason.get(reason) ?? { reason, held, entries: [] };
    byReason.set(reason, {
      ...group,
      entries: [...group.entries, { path: entry.path, measure: entry.held }],
    });
  }

  const groups = [...byReason.values()];
  return [
    ...groups.filter((group) => !group.held),
    ...groups.filter((group) => group.held),
  ];
};

export const detectedSummary = (
  detected: Detected,
): readonly { label: string; value: string }[] =>
  [
    { label: "install", value: detected.installCommand },
    { label: "dev", value: detected.devCommand },
    { label: "base", value: detected.defaultBase },
    { label: "remote", value: detected.remote },
  ].filter(
    (row): row is { label: string; value: string } => row.value !== undefined,
  );

export const umbrellaSentence = (
  repoName: string,
  verdict: UmbrellaVerdict,
  reason: UmbrellaReason,
): string =>
  verdict === "umbrella"
    ? `${repoName} sits under a working folder (${reason}), so its config goes there.`
    : `${repoName} stands alone (${reason}), so its config goes in the repository.`;
