import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { createGit } from "./exec.js";
import { resolveBranch, fetchBranch, defaultBase } from "./branch.js";
import {
  addWorktree,
  git,
  makeRepo,
  makeSandbox,
  makeSingleBranchClone,
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

describe("resolveBranch", () => {
  it("checks out an existing local branch", async () => {
    const repo = await makeRepo(sandbox.root, "local");
    await git(repo, "branch", "feat/x");

    const plan = await resolveBranch(gitAt(repo), {
      branch: "feat/x",
      fetch: false,
    });
    expect(plan.kind).toBe("checkout-local");
  });

  it("creates a new branch from the current head when nothing exists", async () => {
    const repo = await makeRepo(sandbox.root, "fresh");

    const plan = await resolveBranch(gitAt(repo), {
      branch: "feat/new",
      fetch: false,
    });
    expect(plan.kind).toBe("create");
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.base).toBe("main");
  });

  it("honours --from for a branch that does not exist", async () => {
    const repo = await makeRepo(sandbox.root, "based");

    const plan = await resolveBranch(gitAt(repo), {
      branch: "feat/based",
      base: "HEAD",
      fetch: false,
    });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.base).toBe("HEAD");
  });

  it("rejects --from when the branch already exists, instead of ignoring it", async () => {
    const repo = await makeRepo(sandbox.root, "conflict");
    await git(repo, "branch", "feat/there");

    const plan = await resolveBranch(gitAt(repo), {
      branch: "feat/there",
      base: "main",
      fetch: false,
    });
    expect(plan.kind).toBe("error");
  });

  it("reports the worktree already holding the branch", async () => {
    const repo = await makeRepo(sandbox.root, "held");
    await addWorktree(repo, join(sandbox.root, "held-wt"), "feat/held");

    const plan = await resolveBranch(gitAt(repo), {
      branch: "feat/held",
      fetch: false,
    });
    expect(plan.kind).toBe("occupied");
    if (plan.kind !== "occupied") throw new Error("expected occupied");
    expect(plan.by).toContain("held-wt");
  });

  it("reports the main checkout as holder, the common `wt new repo main` case", async () => {
    const repo = await makeRepo(sandbox.root, "mainheld");

    const plan = await resolveBranch(gitAt(repo), {
      branch: "main",
      fetch: false,
    });
    expect(plan.kind).toBe("occupied");
  });

  it("tracks a branch that only exists upstream", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "tracking");

    const plan = await resolveBranch(gitAt(clone), {
      branch: "feature/extra",
      fetch: true,
    });
    expect(plan.kind).toBe("track-remote");
    if (plan.kind !== "track-remote") throw new Error("expected track-remote");
    expect(plan.remote).toBe("origin");
  });

  it("creates locally, with no notice, for a branch absent upstream", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "absent");
    const notices: string[] = [];

    const plan = await resolveBranch(gitAt(clone), {
      branch: "feature/never-pushed",
      fetch: true,
      onNotice: (message) => notices.push(message),
    });
    expect(plan.kind).toBe("create");
    expect(notices).toEqual([]);
  });

  it("warns loudly when the remote is unreachable", async () => {
    const repo = await makeRepo(sandbox.root, "offline");
    await git(repo, "remote", "add", "origin", "/nowhere/at/all.git");
    const notices: string[] = [];

    const plan = await resolveBranch(gitAt(repo), {
      branch: "feat/offline",
      fetch: true,
      onNotice: (message) => notices.push(message),
    });
    expect(plan.kind).toBe("create");
    expect(notices.join(" ")).toContain("diverge");
  });
});

describe("fetchBranch", () => {
  it("creates the tracking ref on a single-branch clone, where a plain fetch does not", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "refspec");
    const runner = gitAt(clone);

    const before = await runner([
      "rev-parse",
      "--verify",
      "--quiet",
      "refs/remotes/origin/feature/extra",
    ]);
    expect(before.kind === "ran" && before.code).not.toBe(0);

    const report = await fetchBranch(runner, "origin", "feature/extra");
    expect(report.kind).toBe("found");

    const after = await runner([
      "rev-parse",
      "--verify",
      "--quiet",
      "refs/remotes/origin/feature/extra",
    ]);
    expect(after.kind === "ran" && after.code).toBe(0);
  });

  it("reports a branch the remote does not have, without an error", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "missing");
    const report = await fetchBranch(gitAt(clone), "origin", "no/such/branch");
    expect(report.kind).toBe("absent");
  });
});

describe("defaultBase", () => {
  it("falls back to the current branch with no remote", async () => {
    const repo = await makeRepo(sandbox.root, "nobase");
    expect(await defaultBase(gitAt(repo), undefined)).toBe("main");
  });
});
