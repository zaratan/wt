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
 */
export const candidateSocketPaths = (env: NodeJS.ProcessEnv): string[] => {
  const fromEnv = env.HERDR_SOCKET_PATH;
  const home = env.HOME ?? homedir();
  const fallback = join(home, ".config", "herdr", "herdr.sock");
  return fromEnv === undefined || fromEnv === ""
    ? [fallback]
    : [fromEnv, fallback];
};

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
};

export const preflight = async (
  options: PreflightOptions,
): Promise<HerdrHealth> => {
  const tried: string[] = [];

  const attempt = async (
    socketPath: string,
  ): Promise<HerdrHealth | undefined> => {
    tried.push(socketPath);
    const client = createHerdrClient({ socketPath, trace: options.trace });
    const pong = await client.call<Pong>("ping");
    return pong.kind === "ok"
      ? { kind: "ok", socketPath, pong: pong.result, client }
      : undefined;
  };

  for (const path of candidateSocketPaths(options.env)) {
    const health = await attempt(path);
    if (health !== undefined) return health;
  }

  const fromStatus = await socketFromStatus(options.env, options.cwd);
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

/**
 * Gate on capabilities, never on a protocol number: that number moves with
 * every upgrade and produces a warning nobody reads three weeks later.
 */
export const supports = (pong: Pong, capability: string): boolean => {
  const value = pong.capabilities?.[capability];
  return value === true || typeof value === "object";
};
