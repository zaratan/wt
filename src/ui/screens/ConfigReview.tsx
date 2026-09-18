import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Footer } from "../Footer.js";
import {
  detectedSummary,
  reviewGroups,
  umbrellaSentence,
} from "../../format/review.js";
import { initialSelection } from "../../lib/config/review.js";
import type { ConfigDecision, ConfigReview } from "../../lib/config/review.js";

export type ConfigReviewProps = {
  review: ConfigReview;
  onDecide: (decision: ConfigDecision) => void;
};

type Row = { path: string; measure?: string; group: number };

export const ConfigReviewScreen = ({
  review,
  onDecide,
}: ConfigReviewProps): React.JSX.Element => {
  const groups = useMemo(() => reviewGroups(review.detected), [review]);
  const rows = useMemo<readonly Row[]>(
    () =>
      groups.flatMap((group, index) =>
        group.entries.map((entry) => ({ ...entry, group: index })),
      ),
    [groups],
  );

  const [focused, setFocused] = useState(0);
  const [kept, setKept] = useState<readonly string[]>(() =>
    initialSelection(review.detected),
  );

  const toggle = (paths: readonly string[], on: boolean): void => {
    setKept((current) =>
      on
        ? [...new Set([...current, ...paths])]
        : current.filter((path) => !paths.includes(path)),
    );
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setFocused((at) => (at === 0 ? Math.max(rows.length - 1, 0) : at - 1));
      return;
    }
    if (key.downArrow) {
      setFocused((at) => (rows.length === 0 ? 0 : (at + 1) % rows.length));
      return;
    }
    if (input === " ") {
      const row = rows[focused];
      if (row !== undefined) toggle([row.path], !kept.includes(row.path));
      return;
    }
    if (input === "a") {
      const row = rows[focused];
      if (row === undefined) return;
      const paths = (groups[row.group]?.entries ?? []).map((one) => one.path);
      toggle(paths, !paths.every((path) => kept.includes(path)));
      return;
    }
    if (key.escape || (key.ctrl && input === "c")) {
      onDecide({ kind: "skip" });
      return;
    }
    if (key.return) onDecide({ kind: "write", copy: kept });
  });

  let row = -1;
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{review.repoName}</Text>
        <Text dimColor> — first worktree, no config yet</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Detected</Text>
        {detectedSummary(review.detected).map((entry) => (
          <Text key={entry.label}>
            {`  ${entry.label.padEnd(9)}`}
            <Text color="cyan">{entry.value}</Text>
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Copy into every new worktree</Text>
        {groups.map((group) => (
          <Box key={group.reason} flexDirection="column" marginTop={1}>
            <Text>{`  ${group.reason}`}</Text>
            {group.entries.map((entry) => {
              row += 1;
              const here = row === focused;
              return (
                <Text key={entry.path}>
                  <Text color={here ? "cyan" : undefined}>
                    {here ? "  ▸ " : "    "}
                  </Text>
                  <Text bold={here}>
                    {`[${kept.includes(entry.path) ? "x" : " "}] ${entry.path}`}
                  </Text>
                  {entry.measure === undefined ? null : (
                    <Text dimColor>{`   ${entry.measure}`}</Text>
                  )}
                </Text>
              );
            })}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {umbrellaSentence(
            review.repoName,
            review.umbrella,
            review.umbrellaReason,
          )}
        </Text>
      </Box>

      <Footer
        hints={[
          { key: "↑↓", label: "move" },
          { key: "space", label: "toggle" },
          { key: "a", label: "toggle group" },
          { key: "enter", label: "write config" },
          { key: "esc", label: "continue without one" },
        ]}
      />
    </Box>
  );
};
