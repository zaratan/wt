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
  // No `enter` binding: it means "do the thing" on every other screen, and a
  // label does not undo that reflex on the one screen where the thing is
  // irreversible. The answer is spelled out.
  useInput((input, key) => {
    if (input === "y" || input === "Y") {
      onAnswer(true);
      return;
    }
    if (
      key.escape ||
      input === "n" ||
      input === "N" ||
      input === "q" ||
      (key.ctrl && input === "c")
    ) {
      onAnswer(false);
    }
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
          { key: "n", label: "no" },
          { key: "esc", label: "no" },
        ]}
      />
    </Box>
  );
};
