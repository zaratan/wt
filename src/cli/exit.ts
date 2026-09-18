export const EXIT = {
  OK: 0,
  ERROR: 1,
  /** 2 is what herdr uses for CLI syntax errors. */
  USAGE: 2,
  /** The worktree exists but is not ready: an agent branches on this. */
  PARTIAL: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
