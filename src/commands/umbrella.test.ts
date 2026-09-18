import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { umbrellaAsker } from "./umbrella.js";
import type { CommandContext } from "./context.js";
import { makeRepo, makeSandbox, type Sandbox } from "../test/fixtures/git.js";
import { resolveRepo } from "../lib/git/resolve.js";
import { createProbes } from "../lib/git/probes.js";
import { createGit } from "../lib/git/exec.js";

let sandbox: Sandbox;

const contextWith = (overrides: Partial<CommandContext>) =>
  ({
    cwd: "/",
    env: {},
    options: {},
    json: false,
    yes: false,
    verbose: false,
    dryRun: false,
    interactive: true,
    pid: process.pid,
    ...overrides,
  }) satisfies CommandContext;

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("umbrellaAsker", () => {
  it("records a yes by creating .wt/ in the parent", async () => {
    const parent = join(sandbox.root, "yes");
    const repoRoot = join(parent, "app");
    await mkdir(repoRoot, { recursive: true });

    const ask = umbrellaAsker(
      contextWith({ confirm: () => Promise.resolve(true) }),
    );
    expect(await ask?.({ parent, repoRoot })).toBe(true);
    expect(await isDirectory(join(parent, ".wt"))).toBe(true);
    expect(await isDirectory(join(repoRoot, ".wt"))).toBe(false);
  });

  it("records a no by creating .wt/ in the repository", async () => {
    const parent = join(sandbox.root, "no");
    const repoRoot = join(parent, "app");
    await mkdir(repoRoot, { recursive: true });

    const ask = umbrellaAsker(
      contextWith({ confirm: () => Promise.resolve(false) }),
    );
    expect(await ask?.({ parent, repoRoot })).toBe(false);
    expect(await isDirectory(join(repoRoot, ".wt"))).toBe(true);
    expect(await isDirectory(join(parent, ".wt"))).toBe(false);
  });

  it("stays silent with no terminal to question", () => {
    expect(umbrellaAsker(contextWith({}))).toBeUndefined();
  });

  it("asks nothing under --dry-run, which must not write anything", () => {
    expect(
      umbrellaAsker(
        contextWith({ dryRun: true, confirm: () => Promise.resolve(true) }),
      ),
    ).toBeUndefined();
  });

  it("is asked when wt runs from inside the repository, the common case", async () => {
    const parent = join(sandbox.root, "from-inside");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");
    const asked: string[] = [];

    const resolution = await resolveRepo(
      {
        startDir: repo,
        askUmbrella: (question) => {
          asked.push(question.parent);
          return Promise.resolve(true);
        },
      },
      createProbes(
        createGit({
          cwd: repo,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" },
        }),
      ),
    );

    if (resolution.kind !== "ok") throw new Error(resolution.kind);
    expect(asked).toEqual([parent]);
    expect(resolution.topology.umbrella).toBe("umbrella");
    expect(resolution.topology.umbrellaReason).toBe("answered");
  });
});
