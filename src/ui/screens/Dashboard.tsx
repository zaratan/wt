import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Footer } from "../Footer.js";
import { spaceNote, type WorktreeRow } from "../../format/rows.js";

export type DashboardAction = "open" | "status" | "remove" | "refresh" | "quit";

export type DashboardProps = {
  repoName: string;
  rows: readonly WorktreeRow[];
  orphans: readonly string[];
  herdrUnavailable?: string;
  busy?: string;
  focused: number;
  onFocus: (at: number) => void;
  onAct: (action: DashboardAction, row?: WorktreeRow) => void;
};

const GLYPH: Record<WorktreeRow["severity"], { mark: string; color?: string }> =
  {
    // Clean gets no glyph: you scan this for trouble, and clean is the majority.
    clean: { mark: "  " },
    notes: { mark: "• ", color: "yellow" },
    gone: { mark: "✗ ", color: "red" },
  };

const pad = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - text.length));

export const Dashboard = ({
  repoName,
  rows,
  orphans,
  herdrUnavailable,
  busy,
  focused,
  onFocus,
  onAct,
}: DashboardProps): React.JSX.Element => {
  const [width] = useState(() =>
    Math.max(...rows.map((row) => row.name.length), 8),
  );
  const branchWidth = Math.max(...rows.map((row) => row.branch.length), 6);

  useInput((input, key) => {
    if (busy !== undefined) return;
    if (key.upArrow) {
      onFocus(focused === 0 ? Math.max(rows.length - 1, 0) : focused - 1);
      return;
    }
    if (key.downArrow) {
      onFocus(rows.length === 0 ? 0 : (focused + 1) % rows.length);
      return;
    }
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      onAct("quit");
      return;
    }
    if (input === "r") {
      onAct("refresh");
      return;
    }
    const row = rows[focused];
    if (key.return) onAct("open", row);
    if (input === "s") onAct("status", row);
    if (input === "d") onAct("remove", row);
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{repoName}</Text>
        <Text dimColor>
          {herdrUnavailable === undefined
            ? "   herdr ok"
            : `   herdr unreachable: ${herdrUnavailable}`}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 && busy === undefined ? (
          <Text dimColor>{"  no worktrees"}</Text>
        ) : null}
        {rows.map((row, at) => {
          const glyph = GLYPH[row.severity];
          const detail = [
            ...(spaceNote(row.space) === undefined
              ? []
              : [spaceNote(row.space) ?? ""]),
            ...row.notes,
          ].join(", ");
          return (
            <Text key={row.status.path}>
              <Text color={at === focused ? "cyan" : undefined}>
                {at === focused ? "▸ " : "  "}
              </Text>
              <Text color={glyph.color}>{glyph.mark}</Text>
              <Text bold={row.here}>{pad(row.name, width)}</Text>
              <Text dimColor={!row.here}>{row.here ? " ·" : "  "}</Text>
              <Text>{` ${pad(row.branch, branchWidth)}`}</Text>
              <Text dimColor>{detail === "" ? "" : `  ${detail}`}</Text>
            </Text>
          );
        })}
      </Box>

      {orphans.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          {orphans.map((path) => (
            <Text key={path} dimColor>{`  ? ${path}`}</Text>
          ))}
        </Box>
      )}

      {busy === undefined ? (
        <Footer
          hints={[
            { key: "enter", label: "open" },
            { key: "s", label: "status" },
            { key: "d", label: "remove" },
            { key: "r", label: "refresh" },
            { key: "q", label: "quit" },
          ]}
        />
      ) : (
        <Box marginTop={1}>
          <Text dimColor>{`  ${busy}…`}</Text>
        </Box>
      )}
    </Box>
  );
};
