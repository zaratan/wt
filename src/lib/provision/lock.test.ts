import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire } from "./lock.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "wt-lock-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("acquire", () => {
  it("refuses a second holder while the first is alive", async () => {
    const path = join(dir, "a.lock");
    const first = await acquire(path, process.pid);
    expect(first.kind).toBe("held");

    const second = await acquire(path, process.pid + 1);
    expect(second.kind).toBe("taken");
    if (second.kind !== "taken") throw new Error("expected taken");
    expect(second.by.pid).toBe(process.pid);

    if (first.kind === "held") await first.release();
  });

  it("takes over from a holder whose process is gone, with no manual repair", async () => {
    const path = join(dir, "b.lock");
    await writeFile(
      path,
      JSON.stringify({ pid: 999_999, since: new Date().toISOString() }),
    );

    const taken = await acquire(path, process.pid);
    expect(taken.kind).toBe("held");
    if (taken.kind === "held") await taken.release();
  });

  it("takes over from an unreadable lock file rather than wedging forever", async () => {
    const path = join(dir, "c.lock");
    await writeFile(path, "not json");

    const taken = await acquire(path, process.pid);
    expect(taken.kind).toBe("held");
    if (taken.kind === "held") await taken.release();
  });

  it("frees the lock on release, so the next run proceeds", async () => {
    const path = join(dir, "d.lock");
    const first = await acquire(path, process.pid);
    if (first.kind !== "held") throw new Error("expected held");
    await first.release();

    const second = await acquire(path, process.pid + 1);
    expect(second.kind).toBe("held");
    if (second.kind === "held") await second.release();
  });

  it("grants exactly one of many acquirers racing for the same lock", async () => {
    const path = join(dir, "e.lock");
    const tries = await Promise.all(
      Array.from({ length: 8 }, () => acquire(path, process.pid)),
    );

    const held = tries.filter((one) => one.kind === "held");
    expect(held).toHaveLength(1);
    for (const one of held) if (one.kind === "held") await one.release();
  });
});
