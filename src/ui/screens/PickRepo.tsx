import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Footer } from "../Footer.js";
import type { RepoChoice } from "../../lib/git/resolve.js";

export type PickRepoProps = {
  choice: RepoChoice;
  onPick: (path: string | undefined) => void;
};

export const PickRepo = ({
  choice,
  onPick,
}: PickRepoProps): React.JSX.Element => {
  const [focused, setFocused] = useState(0);
  const { candidates } = choice;

  useInput((input, key) => {
    if (key.upArrow) {
      setFocused((at) => (at === 0 ? candidates.length - 1 : at - 1));
      return;
    }
    if (key.downArrow) {
      setFocused((at) => (at + 1) % candidates.length);
      return;
    }
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      onPick(undefined);
      return;
    }
    if (key.return) onPick(candidates[focused]?.path);
  });

  return (
    <Box flexDirection="column">
      <Text>
        Several repositories live under <Text bold>{choice.from}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {candidates.map((candidate, at) => (
          <Box key={candidate.path}>
            <Text color={at === focused ? "cyan" : undefined}>
              {at === focused ? "▸ " : "  "}
            </Text>
            <Text bold={at === focused}>{candidate.name}</Text>
          </Box>
        ))}
      </Box>
      <Footer
        hints={[
          { key: "↑↓", label: "move" },
          { key: "enter", label: "pick" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </Box>
  );
};
