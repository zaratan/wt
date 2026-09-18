import { Box, Text, useInput } from "ink";
import { Footer } from "../Footer.js";
import type { RemovalIntent } from "../../format/removal.js";

export type RemovePanelProps = {
  intent: RemovalIntent;
  onAnswer: (remove: boolean) => void;
};

export const RemovePanel = ({
  intent,
  onAnswer,
}: RemovePanelProps): React.JSX.Element => {
  const blocked = intent.findings.length > 0;

  useInput((input, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      onAnswer(false);
      return;
    }
    // No enter binding while blocked: refusing beats confirming, and forcing
    // is deliberately something you leave the screen to do.
    if (key.return && !blocked) onAnswer(true);
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {blocked ? (
        <Text>
          <Text bold>{intent.row.name}</Text> is not ready to be removed
        </Text>
      ) : (
        <Text>
          Remove <Text bold>{intent.row.name}</Text>
        </Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text>
          {"  worktree  "}
          <Text dimColor>{intent.row.status.path}</Text>
        </Text>
        {intent.branch === undefined ? null : (
          <Text>
            {"  branch    "}
            {intent.branch}
            <Text dimColor>{`   ${intent.branchPlan}`}</Text>
          </Text>
        )}
        {intent.row.space === undefined ? null : (
          <Text>
            {"  space     "}
            <Text dimColor>closed with it</Text>
          </Text>
        )}
      </Box>

      {blocked ? (
        <Box flexDirection="column" marginTop={1}>
          {intent.findings.map((finding) => (
            <Text key={finding} color="yellow">{`  ${finding}`}</Text>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              {"  --force discards this. wt will not do it for you:"}
            </Text>
            <Text color="cyan" bold>{`    ${intent.forceCommand}`}</Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>{"  Nothing uncommitted, nothing unpublished."}</Text>
        </Box>
      )}

      <Footer
        hints={
          blocked
            ? [{ key: "esc", label: "back" }]
            : [
                { key: "enter", label: "remove" },
                { key: "esc", label: "cancel" },
              ]
        }
      />
    </Box>
  );
};
