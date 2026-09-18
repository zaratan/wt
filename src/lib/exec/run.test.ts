import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, succeeded } from "./run.js";
import { scrubEnv } from "./env.js";

const env = scrubEnv({ PATH: process.env.PATH, GIT_DIR: "/leaked/repo/.git" });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wt-run-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sh = (script: string) => ["/bin/sh", "-c", script] as const;

describe("run", () => {
  it("captures stdout of a successful command", async () => {
    const result = await run({ argv: sh("echo hello"), cwd: dir, env });
    expect(succeeded(result)).toBe(true);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.stdout).toBe("hello\n");
    expect(result.outcome.code).toBe(0);
  });

  it("treats a non-zero exit as a verdict, not an error", async () => {
    const result = await run({ argv: sh("exit 3"), cwd: dir, env });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.code).toBe(3);
    expect(succeeded(result)).toBe(false);
  });

  it("captures stderr separately", async () => {
    const result = await run({ argv: sh("echo oops >&2"), cwd: dir, env });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.stderr).toBe("oops\n");
    expect(result.outcome.stdout).toBe("");
  });

  it("runs in the requested cwd", async () => {
    const result = await run({ argv: sh("pwd -P"), cwd: dir, env });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.stdout.trim()).toBe(
      await import("node:fs/promises").then((fs) => fs.realpath(dir)),
    );
  });

  it("does not leak inherited git state to the child", async () => {
    const result = await run({
      argv: sh('echo "[${GIT_DIR:-unset}]"'),
      cwd: dir,
      env,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.stdout.trim()).toBe("[unset]");
  });

  it("reports a spawn failure instead of throwing", async () => {
    const result = await run({
      argv: ["definitely-not-a-real-binary-xyz"],
      cwd: dir,
      env,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.code).toBe("spawn_failed");
  });

  it("reports a cwd that is a file instead of crashing", async () => {
    const file = join(dir, "not-a-dir");
    await writeFile(file, "");
    const result = await run({ argv: sh("pwd"), cwd: file, env });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.code).toBe("spawn_failed");
  });

  it("feeds stdin when provided", async () => {
    const result = await run({ argv: sh("cat"), cwd: dir, env, stdin: "ping" });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.stdout).toBe("ping");
  });

  it("streams chunks to the callbacks", async () => {
    const seen: string[] = [];
    await run({
      argv: sh("echo a; echo b"),
      cwd: dir,
      env,
      capture: false,
      onStdout: (chunk) => seen.push(chunk),
    });
    expect(seen.join("")).toBe("a\nb\n");
  });

  it("skips capture when asked, so a huge output stays out of memory", async () => {
    const result = await run({
      argv: sh("echo noise"),
      cwd: dir,
      env,
      capture: false,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.stdout).toBe("");
  });

  it("kills a command that overruns its timeout", async () => {
    const result = await run({
      argv: sh("sleep 10"),
      cwd: dir,
      env,
      timeoutMs: 150,
      killGraceMs: 50,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.timedOut).toBe(true);
    expect(result.outcome.code).not.toBe(0);
    expect(result.outcome.durationMs).toBeLessThan(5000);
  });

  it("stops on abort without waiting for the command", async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 100);
    const result = await run({
      argv: sh("sleep 10"),
      cwd: dir,
      env,
      signal: controller.signal,
      killGraceMs: 50,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.aborted).toBe(true);
    expect(result.outcome.durationMs).toBeLessThan(5000);
  });

  it("returns immediately when the signal is already aborted", async () => {
    const result = await run({
      argv: sh("echo never"),
      cwd: dir,
      env,
      signal: AbortSignal.abort(),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.aborted).toBe(true);
    expect(result.outcome.stdout).toBe("");
  });

  it("kills grandchildren too when killProcessGroup is set", async () => {
    const marker = join(dir, "grandchild.log");
    await writeFile(marker, "");
    const script = `
      ( while :; do printf x >> ${JSON.stringify(marker)}; sleep 0.05; done ) &
      wait
    `;

    const result = await run({
      argv: sh(script),
      cwd: dir,
      env,
      timeoutMs: 200,
      killGraceMs: 50,
      killProcessGroup: true,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.outcome.timedOut).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const sizeAfterKill = (await stat(marker)).size;
    expect(sizeAfterKill).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await stat(marker)).size).toBe(sizeAfterKill);
    expect((await readFile(marker, "utf8")).length).toBe(sizeAfterKill);
  });
});
