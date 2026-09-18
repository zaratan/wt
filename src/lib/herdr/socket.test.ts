import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { herdrCall } from "./socket.js";
import {
  startFakeHerdr,
  type FakeHerdr,
} from "../../test/fixtures/herdrServer.js";

let server: FakeHerdr | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("herdrCall", () => {
  it("sends a method with its params and returns the result", async () => {
    server = await startFakeHerdr({
      handler: ({ method }) =>
        method === "ping" ? { type: "pong", version: "0.9.1" } : undefined,
    });

    const response = await herdrCall<{ version: string }>(
      "ping",
      {},
      { socketPath: server.socketPath },
    );
    expect(response.kind).toBe("ok");
    if (response.kind !== "ok") throw new Error("expected ok");
    expect(response.result.version).toBe("0.9.1");
    expect(server.seen[0]?.method).toBe("ping");
  });

  it("passes params through untouched", async () => {
    server = await startFakeHerdr({ handler: () => ({ done: true }) });

    await herdrCall(
      "worktree.open",
      { cwd: "/repo", path: "/repo/../wt", focus: false },
      { socketPath: server.socketPath },
    );
    expect(server.seen[0]?.params).toEqual({
      cwd: "/repo",
      path: "/repo/../wt",
      focus: false,
    });
  });

  it("surfaces a server error as data, not as a throw", async () => {
    server = await startFakeHerdr({ handler: () => undefined });

    const response = await herdrCall(
      "nope",
      {},
      { socketPath: server.socketPath },
    );
    expect(response.kind).toBe("error");
    if (response.kind !== "error") throw new Error("expected error");
    expect(response.error.code).toBe("unknown_method");
  });

  it("reassembles a reply split across chunks", async () => {
    server = await startFakeHerdr({
      handler: () => ({ payload: "x".repeat(500) }),
      chunks: 7,
    });

    const response = await herdrCall<{ payload: string }>(
      "big",
      {},
      { socketPath: server.socketPath },
    );
    if (response.kind !== "ok") throw new Error("expected ok");
    expect(response.result.payload).toHaveLength(500);
  });

  it("works against a server that closes after one reply, like the real one", async () => {
    server = await startFakeHerdr({
      handler: () => ({ ok: 1 }),
      oneShot: true,
    });

    const first = await herdrCall("a", {}, { socketPath: server.socketPath });
    const second = await herdrCall("b", {}, { socketPath: server.socketPath });
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    expect(server.seen.map((entry) => entry.method)).toEqual(["a", "b"]);
  });

  it("reports an unreachable socket instead of hanging", async () => {
    const response = await herdrCall(
      "ping",
      {},
      {
        socketPath: join(tmpdir(), "wt-definitely-absent.sock"),
        connectTimeoutMs: 200,
      },
    );
    expect(response.kind).toBe("unreachable");
  });

  it("times out a server that never replies", async () => {
    server = await startFakeHerdr({ handler: () => ({}), silent: true });

    const response = await herdrCall(
      "ping",
      {},
      { socketPath: server.socketPath, callTimeoutMs: 300 },
    );
    expect(response.kind).toBe("unreachable");
    if (response.kind !== "unreachable")
      throw new Error("expected unreachable");
    expect(response.message).toContain("timed out");
  });

  it("reports a server that hangs up without replying", async () => {
    server = await startFakeHerdr({ handler: () => ({}), hangUp: true });

    const response = await herdrCall(
      "ping",
      {},
      { socketPath: server.socketPath, callTimeoutMs: 2000 },
    );
    expect(response.kind).toBe("unreachable");
  });
});
