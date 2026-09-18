/**
 * Exit codes, aligned with herdr's own (2 = CLI syntax).
 *
 * `PARTIAL` exists for agents: it says "the worktree is there but it is not
 * ready", which is a different decision from "nothing happened".
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  PARTIAL: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
