import { Box, Text } from "ink";

export type Hint = { key: string; label: string };

/**
 * Bare keys, three spaces apart, one bar per screen. Rendering nothing for an
 * empty list is deliberate: a screen that cannot be interrupted must not
 * advertise a key that does nothing.
 */
export const Footer = ({
  hints,
}: {
  hints: readonly Hint[];
}): React.JSX.Element | null =>
  hints.length === 0 ? null : (
    <Box marginTop={1}>
      <Text dimColor>
        {`  ${hints.map((hint) => `${hint.key} ${hint.label}`).join("   ")}`}
      </Text>
    </Box>
  );
