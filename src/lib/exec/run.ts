import { spawn } from "node:child_process";
import type { EnvMap } from "./env.js";

export type RunOptions = {
  /** Program plus arguments, never a shell string. */
  argv: readonly [string, ...string[]];
  cwd: string;
  env: EnvMap;
  timeoutMs?: number;
  signal?: AbortSignal;
  stdin?: string;
  capture?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /**
   * `child.kill()` leaves grandchildren running: a killed `pnpm install` keeps
   * writing into node_modules. A process group reaches the whole tree.
   */
  killProcessGroup?: boolean;
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
    // Bun throws ENOTDIR from spawn() synchronously when cwd is not a
    // directory, where Node would emit an "error" event.
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        detached: killProcessGroup,
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        kind: "error",
        code: "spawn_failed",
        message: error instanceof Error ? error.message : String(error),
        durationMs: elapsed(),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const kill = (sig: NodeJS.Signals): void => {
      try {
        if (killProcessGroup && child.pid !== undefined) {
          process.kill(-child.pid, sig);
        } else {
          child.kill(sig);
        }
      } catch {
        // Already gone.
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
