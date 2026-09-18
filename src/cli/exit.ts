export const EXIT = {
  OK: 0,
  ERROR: 1,
  /** 2 is what herdr uses for CLI syntax errors. */
  USAGE: 2,
  /** The worktree exists but is not ready: an agent branches on this. */
  PARTIAL: 3,
  /** Killed by Ctrl-C, after unwinding. 128 + SIGINT, what a shell expects. */
  INTERRUPTED: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
