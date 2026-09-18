import { Box, Text, useInput } from "ink";
import { Footer } from "../Footer.js";

export type ConfirmProps = {
  question: string;
  onAnswer: (yes: boolean) => void;
};

export const Confirm = ({
  question,
  onAnswer,
}: ConfirmProps): React.JSX.Element => {
  useInput((input, key) => {
    if (input === "y" || input === "Y" || input === "o" || input === "O") {
      onAnswer(true);
      return;
    }
    if (key.return || key.escape || input === "n" || input === "N") {
      onAnswer(false);
      return;
    }
    if (key.ctrl && input === "c") onAnswer(false);
  });

  return (
    <Box flexDirection="column">
      {/* A blank line needs a space, or Ink gives the row no height. */}
      {question.split("\n").map((line, at) => (
        <Text key={`${String(at)}:${line}`}>{line === "" ? " " : line}</Text>
      ))}
      <Footer
        hints={[
          { key: "y", label: "yes" },
          { key: "n/enter", label: "no" },
        ]}
      />
    </Box>
  );
};
