import { createConnection, type Socket } from "node:net";

export type HerdrError = { code: string; message: string };

export type HerdrResponse<T> =
  | { kind: "ok"; result: T }
  /** The server answered, and said no. `code` is a free-form string. */
  | { kind: "error"; error: HerdrError }
  /** No answer: not running, wrong socket, timed out. */
  | { kind: "unreachable"; message: string };

export type CallOptions = {
  socketPath: string;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  trace?: (line: string) => void;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 500;
const DEFAULT_CALL_TIMEOUT_MS = 5_000;

const parseEnvelope = <T>(line: string): HerdrResponse<T> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      kind: "unreachable",
      message: `unparseable reply: ${line.slice(0, 120)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "unreachable", message: "reply was not an object" };
  }

  const envelope = parsed as {
    result?: unknown;
    error?: { code?: unknown; message?: unknown };
  };

  if (envelope.error !== undefined) {
    return {
      kind: "error",
      error: {
        code:
          typeof envelope.error.code === "string"
            ? envelope.error.code
            : "unknown",
        message:
          typeof envelope.error.message === "string"
            ? envelope.error.message
            : "",
      },
    };
  }
  return { kind: "ok", result: envelope.result as T };
};

/**
 * One request, one reply, one connection.
 *
 * Measured: herdr closes the socket after answering, so a second request on the
 * same connection takes EPIPE. Multiplexing over a kept-open socket, which the
 * protocol shape suggests, does not work.
 */
export const herdrCall = async <T>(
  method: string,
  params: Record<string, unknown>,
  options: CallOptions,
): Promise<HerdrResponse<T>> => {
  const {
    socketPath,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
    trace,
  } = options;

  const socket = await new Promise<Socket | undefined>((resolve) => {
    const candidate = createConnection(socketPath);
    const timer = setTimeout(() => {
      candidate.destroy();
      resolve(undefined);
    }, connectTimeoutMs);
    timer.unref();

    candidate.once("connect", () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });

  if (socket === undefined) {
    return {
      kind: "unreachable",
      message: `no herdr server answering on ${socketPath}`,
    };
  }

  const payload = JSON.stringify({ id: `wt:${method}`, method, params });
  trace?.(`→ ${payload}`);

  return new Promise<HerdrResponse<T>>((resolve) => {
    let buffer = "";
    let settled = false;

    const finish = (response: HerdrResponse<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      trace?.(`← ${JSON.stringify(response).slice(0, 400)}`);
      resolve(response);
    };

    const timer = setTimeout(() => {
      finish({
        kind: "unreachable",
        message: `${method} timed out after ${String(callTimeoutMs)}ms`,
      });
    }, callTimeoutMs);
    timer.unref();

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline !== -1) finish(parseEnvelope<T>(buffer.slice(0, newline)));
    });

    socket.on("close", () => {
      // A reply with no trailing newline still counts.
      if (buffer.trim() !== "") finish(parseEnvelope<T>(buffer.trim()));
      else
        finish({
          kind: "unreachable",
          message: "herdr closed without replying",
        });
    });

    socket.on("error", (error: Error) => {
      finish({ kind: "unreachable", message: error.message });
    });

    socket.write(`${payload}\n`);
  });
};

export type HerdrClient = {
  call: <T>(
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<HerdrResponse<T>>;
  socketPath: string;
};

export const createHerdrClient = (options: CallOptions): HerdrClient => ({
  socketPath: options.socketPath,
  call: (method, params) => herdrCall(method, params ?? {}, options),
});
