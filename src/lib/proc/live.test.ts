import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { run } from "../exec/run.js";
import { processesIn, describeProcesses } from "./live.js";

let dir: string;
const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "wt-live-")));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("processesIn", () => {
  it("finds a command running with its working directory inside the tree", async () => {
    const controller = new AbortController();
    const running = run({
      argv: ["/bin/sleep", "10"],
      cwd: dir,
      env,
      signal: controller.signal,
      timeoutMs: 15_000,
    });

    try {
      let found = await processesIn(dir, env);
      for (let tries = 0; found.length === 0 && tries < 20; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        found = await processesIn(dir, env);
      }
      expect(found.map((entry) => entry.command)).toContain("sleep");
      expect(describeProcesses(found)).toContain("sleep");
    } finally {
      controller.abort();
      await running;
    }
  });

  it("reports nothing for a tree nobody is working in", async () => {
    expect(await processesIn(join(dir, "empty"), env)).toEqual([]);
    expect(describeProcesses([])).toBeUndefined();
  });
});
