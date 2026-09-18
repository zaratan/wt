import { createServer, type Server } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Handler = (request: {
  id: string;
  method: string;
  params: Record<string, unknown>;
}) => unknown;

export type FakeHerdr = {
  socketPath: string;
  /** Requests received, in order. */
  seen: readonly { method: string; params: Record<string, unknown> }[];
  stop: () => Promise<void>;
};

export type FakeOptions = {
  /** Replies per method. Returning undefined makes the server answer an error. */
  handler: Handler;
  /**
   * Real herdr closes the socket after one reply. Set false to test a server
   * that keeps it open.
   */
  oneShot?: boolean;
  /** Reply in this many chunks, to exercise partial reads. */
  chunks?: number;
  /** Never reply, to exercise the call timeout. */
  silent?: boolean;
  /** Close without replying at all. */
  hangUp?: boolean;
};

export const startFakeHerdr = async (
  options: FakeOptions,
): Promise<FakeHerdr> => {
  const dir = await mkdtemp(join(tmpdir(), "wt-herdr-"));
  const socketPath = join(dir, "herdr.sock");
  const seen: { method: string; params: Record<string, unknown> }[] = [];

  const server: Server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        const request = JSON.parse(line) as {
          id: string;
          method: string;
          params?: Record<string, unknown>;
        };
        seen.push({ method: request.method, params: request.params ?? {} });

        if (options.hangUp === true) {
          socket.destroy();
          return;
        }
        if (options.silent === true) return;

        const result = options.handler({
          id: request.id,
          method: request.method,
          params: request.params ?? {},
        });

        const reply =
          result === undefined
            ? JSON.stringify({
                id: request.id,
                error: { code: "unknown_method", message: request.method },
              })
            : JSON.stringify({ id: request.id, result });

        const full = `${reply}\n`;
        const pieces = options.chunks ?? 1;
        const size = Math.ceil(full.length / pieces);
        for (let index = 0; index < full.length; index += size) {
          socket.write(full.slice(index, index + size));
        }

        if (options.oneShot !== false) socket.end();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(socketPath, resolve);
  });

  return {
    socketPath,
    seen,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await rm(dir, { recursive: true, force: true });
    },
  };
};
