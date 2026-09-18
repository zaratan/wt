import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "../exec/run.js";
import { scrubEnv } from "../exec/env.js";
import { createHerdrClient, type HerdrClient } from "./socket.js";

export type Pong = {
  version?: string;
  protocol?: number;
  capabilities?: Record<string, unknown>;
};

export type HerdrHealth =
  | { kind: "ok"; socketPath: string; pong: Pong; client: HerdrClient }
  | { kind: "down"; message: string; triedPaths: readonly string[] };

/**
 * The socket belongs to the invocation, never to stored state: a worktree
 * created under one named session and reopened from another would otherwise
 * aim at a dead socket.
 *
 * An explicit HERDR_SOCKET_PATH is the ONLY candidate. Falling back to the
 * default socket when it is dead silently opens spaces in whichever session
 * happens to be running — it did, in another session's window.
 */
export const candidateSocketPaths = (env: NodeJS.ProcessEnv): string[] => {
  const fromEnv = env.HERDR_SOCKET_PATH;
  if (fromEnv !== undefined && fromEnv !== "") return [fromEnv];
  const home = env.HOME ?? homedir();
  return [join(home, ".config", "herdr", "herdr.sock")];
};

export const socketWasPinned = (env: NodeJS.ProcessEnv): boolean =>
  env.HERDR_SOCKET_PATH !== undefined && env.HERDR_SOCKET_PATH !== "";

export const socketFromStatus = async (
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string | undefined> => {
  const result = await run({
    argv: ["herdr", "status", "--json"],
    cwd,
    env: scrubEnv(env),
    timeoutMs: 3_000,
  });
  if (result.kind === "error" || result.outcome.code !== 0) return undefined;

  try {
    const parsed = JSON.parse(result.outcome.stdout) as {
      server?: { socket?: unknown };
    };
    const socket = parsed.server?.socket;
    return typeof socket === "string" ? socket : undefined;
  } catch {
    return undefined;
  }
};

export type PreflightOptions = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  trace?: (line: string) => void;
  /** Read-only commands decorate their output with herdr; they do not wait for it. */
  callTimeoutMs?: number;
  skipStatusFallback?: boolean;
};

export const preflight = async (
  options: PreflightOptions,
): Promise<HerdrHealth> => {
  const tried: string[] = [];

  const attempt = async (
    socketPath: string,
  ): Promise<HerdrHealth | undefined> => {
    tried.push(socketPath);
    const client = createHerdrClient({
      socketPath,
      trace: options.trace,
      callTimeoutMs: options.callTimeoutMs,
    });
    const pong = await client.call<Pong>("ping");
    return pong.kind === "ok"
      ? { kind: "ok", socketPath, pong: pong.result, client }
      : undefined;
  };

  for (const path of candidateSocketPaths(options.env)) {
    const health = await attempt(path);
    if (health !== undefined) return health;
  }

  // `herdr status` answers for the default session, so asking it would
  // undo the pin just as surely.
  const fromStatus =
    socketWasPinned(options.env) || options.skipStatusFallback === true
      ? undefined
      : await socketFromStatus(options.env, options.cwd);
  if (fromStatus !== undefined && !tried.includes(fromStatus)) {
    const health = await attempt(fromStatus);
    if (health !== undefined) return health;
  }

  return {
    kind: "down",
    message: "herdr is not answering",
    triedPaths: tried,
  };
};
