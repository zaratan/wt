/**
 * Running git.
 *
 * Every call goes through `lib/exec/run.ts` with a scrubbed environment. Two
 * measured reasons that matters:
 *
 *   GIT_DIR=/other/repo/.git git -C /here worktree list
 *
 * operates on /other/repo, returns exit 0, and says nothing. Hooks,
 * `git rebase -x` and `git bisect run` all export it. And git speaks the
 * machine's locale — French here — so `LC_ALL=C` is what makes any
 * message-based reasoning possible at all.
 */
import { run } from "../exec/run.js";
import { scrubGitEnv } from "../exec/env.js";

export type GitOutcome =
  /** git ran and returned a verdict. A non-zero code is an answer, not a failure. */
  | { kind: "ran"; code: number; stdout: string; stderr: string }
  /** git could not be executed at all. */
  | { kind: "unavailable"; message: string };

export type GitOptions = {
  /** Base directory; each call may override it. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called before each invocation, for `--verbose`. */
  trace?: (args: readonly string[], cwd: string) => void;
};

export type Git = (
  args: readonly string[],
  overrides?: { cwd?: string; timeoutMs?: number },
) => Promise<GitOutcome>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const createGit = (options: GitOptions): Git => {
  const env = scrubGitEnv(options.env);

  return async (args, overrides) => {
    const cwd = overrides?.cwd ?? options.cwd;
    options.trace?.(args, cwd);

    const result = await run({
      argv: ["git", ...args] as unknown as readonly [string, ...string[]],
      cwd,
      env,
      timeoutMs:
        overrides?.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
    });

    if (result.kind === "error") {
      return { kind: "unavailable", message: result.message };
    }
    if (result.outcome.timedOut) {
      return {
        kind: "unavailable",
        message: `git ${args.join(" ")} timed out`,
      };
    }
    return {
      kind: "ran",
      code: result.outcome.code ?? 1,
      stdout: result.outcome.stdout,
      stderr: result.outcome.stderr,
    };
  };
};

/** stdout with trailing whitespace removed, or undefined when git said no. */
export const okStdout = (outcome: GitOutcome): string | undefined =>
  outcome.kind === "ran" && outcome.code === 0
    ? outcome.stdout.trimEnd()
    : undefined;

export const lines = (text: string): string[] =>
  text.split("\n").filter((line) => line !== "");
