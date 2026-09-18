import { Box, Text, useInput } from "ink";
import { Footer } from "../Footer.js";

export type StatusViewProps = {
  text: string;
  onBack: () => void;
};

export const StatusView = ({
  text,
  onBack,
}: StatusViewProps): React.JSX.Element => {
  useInput((input, key) => {
    if (key.escape || key.return || input === "q") onBack();
  });

  return (
    <Box flexDirection="column">
      {text
        .trimEnd()
        .split("\n")
        .map((line, at) => (
          <Text key={`${String(at)}:${line}`} wrap="truncate-end">
            {line === "" ? " " : line}
          </Text>
        ))}
      <Footer hints={[{ key: "esc", label: "back" }]} />
    </Box>
  );
};
