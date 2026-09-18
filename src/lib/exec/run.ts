/**
 * The single sub-process bottleneck.
 *
 * Every child process in `wt` goes through here — git, the provisioning
 * commands, `$EDITOR`. `node:child_process` is banned everywhere else by
 * eslint, so environment scrubbing, timeouts and abort handling are written
 * once instead of at each call site.
 */
import { spawn } from "node:child_process";
import type { EnvMap } from "./env.js";

export type RunOptions = {
  /** Program plus arguments. Never a shell string: no quoting, no injection. */
  argv: readonly [string, ...string[]];
  cwd: string;
  /** Already scrubbed by the caller (`scrubEnv` / `scrubGitEnv`). */
  env: EnvMap;
  timeoutMs?: number;
  signal?: AbortSignal;
  stdin?: string;
  /** Keep stdout/stderr in memory. Off when streaming a large output. */
  capture?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /**
   * Run in its own process group so a timeout kills the whole tree.
   * `pnpm install` spawns grandchildren that outlive a plain `child.kill()`
   * and keep writing into `node_modules` after we have given up on it.
   */
  killProcessGroup?: boolean;
  /** Grace period between SIGTERM and SIGKILL when killing. Default 3000ms. */
  killGraceMs?: number;
};

export type RunOutcome = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
};

export type RunResult =
  | { kind: "ok"; outcome: RunOutcome }
  | {
      kind: "error";
      code: "spawn_failed";
      message: string;
      durationMs: number;
    };

/** True when the command ran to completion with exit status 0. */
export const succeeded = (result: RunResult): boolean =>
  result.kind === "ok" && result.outcome.code === 0;

export const run = async (options: RunOptions): Promise<RunResult> => {
  const {
    argv,
    cwd,
    env,
    timeoutMs,
    signal,
    stdin,
    capture = true,
    onStdout,
    onStderr,
    killProcessGroup = false,
    killGraceMs = 3000,
  } = options;

  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  if (signal?.aborted) {
    return {
      kind: "ok",
      outcome: {
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
        durationMs: 0,
      },
    };
  }

  const [command, ...args] = argv;

  return new Promise<RunResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: killProcessGroup,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const kill = (sig: NodeJS.Signals): void => {
      // A detached child leads its own group; the negative pid reaches every
      // descendant. Without a pid the process is already gone.
      try {
        if (killProcessGroup && child.pid !== undefined) {
          process.kill(-child.pid, sig);
        } else {
          child.kill(sig);
        }
      } catch {
        // Already dead, or the group vanished between the check and the call.
      }
    };

    const terminate = (): void => {
      kill("SIGTERM");
      graceTimer = setTimeout(() => {
        kill("SIGKILL");
      }, killGraceMs);
      graceTimer.unref();
    };

    const onAbort = (): void => {
      aborted = true;
      terminate();
    };

    const cleanup = (): void => {
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      signal?.removeEventListener("abort", onAbort);
    };

    const settle = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    if (timeoutMs !== undefined) {
      killTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
      killTimer.unref();
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (capture) stdout += chunk;
      onStdout?.(chunk);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (capture) stderr += chunk;
      onStderr?.(chunk);
    });

    child.on("error", (error: Error) => {
      settle({
        kind: "error",
        code: "spawn_failed",
        message: error.message,
        durationMs: elapsed(),
      });
    });

    child.on("close", (code, closeSignal) => {
      settle({
        kind: "ok",
        outcome: {
          code,
          signal: closeSignal,
          stdout,
          stderr,
          timedOut,
          aborted,
          durationMs: elapsed(),
        },
      });
    });

    if (stdin !== undefined && child.stdin !== null) {
      child.stdin.end(stdin);
    }
  });
};
