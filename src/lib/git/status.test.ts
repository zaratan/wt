import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createGit } from "./exec.js";
import { createProbes } from "./probes.js";
import { worktreeStatus, isClean, hasUnsavedWork } from "./status.js";
import type { WorktreeStatus } from "./status.js";
import {
  addWorktree,
  git,
  makeRepo,
  makeSandbox,
  makeSingleBranchClone,
  makeUnbornRepo,
  type Sandbox,
} from "../../test/fixtures/git.js";

let sandbox: Sandbox;

const gitAt = (cwd: string) =>
  createGit({
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" },
  });

const statusOf = async (
  repoRoot: string,
  worktreePath = repoRoot,
): Promise<WorktreeStatus> => {
  const runner = gitAt(repoRoot);
  const probes = createProbes(runner);
  const entries = (await probes.git.worktrees(repoRoot)) ?? [];
  const entry = entries.find((candidate) => candidate.path === worktreePath);
  if (entry === undefined) throw new Error(`no worktree at ${worktreePath}`);

  return worktreeStatus(runner, {
    entry,
    repoRoot,
    worktreesRoot: join(repoRoot, "..", ".worktrees"),
    exists: probes.fs.exists,
  });
};

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("worktreeStatus", () => {
  it("reports a clean checkout as clean", async () => {
    const repo = await makeRepo(sandbox.root, "clean");
    const status = await statusOf(repo);

    expect(status.modified).toBe(0);
    expect(status.untracked).toBe(0);
    expect(status.isMain).toBe(true);
    expect(isClean(status)).toBe(true);
  });

  it("counts modified and untracked files apart", async () => {
    const repo = await makeRepo(sandbox.root, "dirty");
    await writeFile(join(repo, "README.md"), "changed\n");
    await writeFile(join(repo, "extra.txt"), "new\n");

    const status = await statusOf(repo);
    expect(status.modified).toBe(1);
    expect(status.untracked).toBe(1);
    expect(isClean(status)).toBe(false);
  });

  it("says `never published` rather than a count when there is no remote", async () => {
    const repo = await makeRepo(sandbox.root, "noremote");
    const status = await statusOf(repo);

    expect(status.unpublished.kind).toBe("no-remote");
    if (status.unpublished.kind !== "no-remote") throw new Error("kind");
    expect(status.unpublished.count).toBeGreaterThan(0);
  });

  it("does not crash on a repository with no commit", async () => {
    const repo = await makeUnbornRepo(sandbox.root, "unborn");
    const status = await statusOf(repo);
    expect(status.unpublished.kind).toBe("unborn");
  });

  it("counts commits that exist on no remote ref", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "unpushed");
    await writeFile(join(clone, "local.txt"), "x\n");
    await git(clone, "add", "local.txt");
    await git(clone, "commit", "--quiet", "-m", "local work");

    const status = await statusOf(clone);
    expect(status.unpublished.kind).toBe("count");
    if (status.unpublished.kind !== "count") throw new Error("kind");
    expect(status.unpublished.count).toBe(1);
    expect(status.unpublished.sample[0]).toContain("local work");
  });

  it("sees a rebase in progress inside a LINKED worktree", async () => {
    const repo = await makeRepo(sandbox.root, "rebasing");
    await writeFile(join(repo, "f.txt"), "one\n");
    await git(repo, "add", "f.txt");
    await git(repo, "commit", "--quiet", "-m", "one");

    const worktree = await addWorktree(
      repo,
      join(sandbox.root, "rebasing-wt"),
      "feat/rebase",
    );
    await writeFile(join(worktree, "f.txt"), "theirs\n");
    await git(worktree, "commit", "--quiet", "-am", "theirs");

    await git(repo, "checkout", "--quiet", "main");
    await writeFile(join(repo, "f.txt"), "ours\n");
    await git(repo, "commit", "--quiet", "-am", "ours");

    const rebase = await git(worktree, "rebase", "main").catch(
      (error: unknown) => error,
    );
    expect(rebase).toBeInstanceOf(Error);

    const status = await statusOf(repo, worktree);
    expect(status.operation).toBe("rebase");
    expect(isClean(status)).toBe(false);

    await git(worktree, "rebase", "--abort");
  });

  it("reports a worktree whose directory was deleted by hand", async () => {
    const repo = await makeRepo(sandbox.root, "vanished");
    const worktree = await addWorktree(
      repo,
      join(sandbox.root, "vanished-wt"),
      "feat/gone",
    );
    await rm(worktree, { recursive: true, force: true });

    const status = await statusOf(repo, worktree);
    expect(status.missing).toBe(true);
  });

  it("marks a worktree outside the managed root as unmanaged", async () => {
    const parent = join(sandbox.root, "mixed");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const inside = await addWorktree(
      repo,
      join(parent, ".worktrees", "app-feat"),
      "feat/inside",
    );
    const outside = await addWorktree(
      repo,
      join(sandbox.root, "elsewhere"),
      "feat/outside",
    );

    const runner = gitAt(repo);
    const probes = createProbes(runner);
    const entries = (await probes.git.worktrees(repo)) ?? [];
    const statusFor = async (path: string) =>
      worktreeStatus(runner, {
        entry:
          entries.find((entry) => entry.path === path) ??
          (() => {
            throw new Error(path);
          })(),
        repoRoot: repo,
        worktreesRoot: join(parent, ".worktrees"),
        exists: probes.fs.exists,
      });

    expect((await statusFor(inside)).managed).toBe(true);
    expect((await statusFor(outside)).managed).toBe(false);
  });
});

describe("hasUnsavedWork", () => {
  it("is true for a repo with no remote and local commits", async () => {
    const repo = await makeRepo(sandbox.root, "unsaved-noremote");
    expect(hasUnsavedWork(await statusOf(repo))).toBe(true);
  });

  it("is false once everything is published", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "published");
    expect(hasUnsavedWork(await statusOf(clone))).toBe(false);
  });

  it("is true for an untracked file alone", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "stray");
    await writeFile(join(clone, "stray.txt"), "x\n");
    expect(hasUnsavedWork(await statusOf(clone))).toBe(true);
  });
});
