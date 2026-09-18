import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGit } from "./exec.js";
import { ensureIgnored, isIgnored } from "./ignore.js";
import {
  makeRepo,
  makeSandbox,
  type Sandbox,
} from "../../test/fixtures/git.js";

let sandbox: Sandbox;

const gitAt = (cwd: string) =>
  createGit({
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" },
  });

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("isIgnored", () => {
  it("sees a trailing-slash pattern even before the directory exists", async () => {
    const repo = await makeRepo(sandbox.root, "slash");
    await writeFile(join(repo, ".gitignore"), "/.worktrees/\n");

    expect(await isIgnored(gitAt(repo), repo, ".worktrees")).toBe(true);
  });

  it("returns undefined outside a repository rather than `not ignored`", async () => {
    expect(await isIgnored(gitAt(sandbox.root), sandbox.root, "x")).toBe(
      undefined,
    );
  });
});

describe("ensureIgnored", () => {
  it("adds the entry once and is a no-op afterwards", async () => {
    const repo = await makeRepo(sandbox.root, "once");

    const first = await ensureIgnored(gitAt(repo), repo, ".worktrees");
    expect(first.kind).toBe("added");

    const second = await ensureIgnored(gitAt(repo), repo, ".worktrees");
    expect(second.kind).toBe("already");

    const third = await ensureIgnored(gitAt(repo), repo, ".worktrees");
    expect(third.kind).toBe("already");

    const contents = await readFile(join(repo, ".gitignore"), "utf8");
    expect(contents.match(/\/\.worktrees\//g)).toHaveLength(1);
  });

  it("does not glue its entry onto a file with no trailing newline", async () => {
    const repo = await makeRepo(sandbox.root, "nonewline");
    await writeFile(join(repo, ".gitignore"), "node_modules");

    await ensureIgnored(gitAt(repo), repo, ".worktrees");

    const lines = (await readFile(join(repo, ".gitignore"), "utf8")).split(
      "\n",
    );
    expect(lines).toContain("node_modules");
    expect(lines).toContain("/.worktrees/");
  });

  it("leaves an entry the user already wrote in another spelling", async () => {
    const repo = await makeRepo(sandbox.root, "spelled");
    await writeFile(join(repo, ".gitignore"), ".worktrees\n");

    expect((await ensureIgnored(gitAt(repo), repo, ".worktrees")).kind).toBe(
      "already",
    );
  });

  it("skips a directory that is not a repository", async () => {
    const outcome = await ensureIgnored(
      gitAt(sandbox.root),
      sandbox.root,
      ".worktrees",
    );
    expect(outcome.kind).toBe("skipped");
  });
});
