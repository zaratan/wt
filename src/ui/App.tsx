import { Box, Text, useApp, useInput } from "ink";
import { APP_VERSION } from "../version.js";

export type AppProps = { cwd: string };

export const App = ({ cwd }: AppProps): React.JSX.Element => {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      process.exit(130);
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>wt v{APP_VERSION}</Text>
      <Text dimColor>Working directory: {cwd}</Text>
      <Text>Scaffold only — the dashboard lands in a later phase.</Text>
      <Text dimColor>Ctrl+C to quit.</Text>
    </Box>
  );
};
