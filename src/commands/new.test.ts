import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runNew, type NewResult } from "./new.js";
import type { CommandContext } from "./context.js";
import {
  git,
  makeRepo,
  makeSandbox,
  type Sandbox,
} from "../test/fixtures/git.js";

let sandbox: Sandbox;

const contextAt = (cwd: string, overrides: Partial<CommandContext> = {}) =>
  ({
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    options: {},
    json: false,
    yes: true,
    verbose: false,
    dryRun: false,
    interactive: false,
    ...overrides,
  }) satisfies CommandContext;

const defaults = {
  fetch: false,
  gitignore: true,
  open: false,
  focus: false,
  provision: false,
};

const expectCreated = (result: NewResult) => {
  if (result.kind !== "created") {
    throw new Error(
      `expected created, got ${result.kind}: ${"message" in result ? result.message : ""}`,
    );
  }
  return result;
};

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("wt new", () => {
  it("creates the worktree under <parent>/.worktrees/<repo>-<slug>", async () => {
    const parent = join(sandbox.root, "basic");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const result = expectCreated(
      await runNew(
        { branch: "investigations/import-cmdb", ...defaults },
        contextAt(repo),
      ),
    );

    expect(result.plan.worktreePath).toBe(
      join(parent, ".worktrees", "app-investigations-import-cmdb"),
    );
    expect((await stat(result.plan.worktreePath)).isDirectory()).toBe(true);
  });

  it("names the space after the repo when the parent is not an umbrella", async () => {
    const parent = join(sandbox.root, "labelled");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const result = expectCreated(
      await runNew(
        { branch: "feat/thing", as: "Thing", ...defaults },
        contextAt(repo),
      ),
    );
    expect(result.plan.label).toBe("app - Thing");
  });

  it("names the space after the umbrella when there is one", async () => {
    const parent = join(sandbox.root, "tercio-like");
    await mkdir(join(parent, ".wt"), { recursive: true });
    const repo = await makeRepo(parent, "tercioapp");

    const result = expectCreated(
      await runNew(
        { branch: "investigations/import-cmdb", as: "CMDB", ...defaults },
        contextAt(repo),
      ),
    );
    expect(result.plan.label).toBe("tercio-like - CMDB");
  });

  it("defaults the label to the last branch segment", async () => {
    const parent = join(sandbox.root, "autolabel");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const result = expectCreated(
      await runNew({ branch: "feat/deep/name", ...defaults }, contextAt(repo)),
    );
    expect(result.plan.label).toBe("app - name");
  });

  it("gitignores the worktrees directory when the parent is a repo", async () => {
    const parent = await makeRepo(sandbox.root, "gitparent");
    await writeFile(join(parent, ".gitignore"), "/app/\n");
    await git(parent, "add", ".gitignore");
    await git(parent, "commit", "--quiet", "-m", "ignore app");
    const repo = await makeRepo(parent, "app");

    const result = expectCreated(
      await runNew({ branch: "feat/x", ...defaults }, contextAt(repo)),
    );
    expect(result.ignore?.kind).toBe("added");

    const contents = await readFile(join(parent, ".gitignore"), "utf8");
    expect(contents).toContain("/.worktrees/");

    const status = await git(parent, "status", "--porcelain");
    expect(status).not.toContain(".worktrees");
  });

  it("does not touch a .gitignore when the parent is not a repo", async () => {
    const parent = join(sandbox.root, "plainparent");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const result = expectCreated(
      await runNew({ branch: "feat/x", ...defaults }, contextAt(repo)),
    );
    expect(result.ignore).toBeUndefined();
  });

  it("is idempotent: a second run reports the existing worktree", async () => {
    const parent = join(sandbox.root, "twice");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    await runNew({ branch: "feat/again", ...defaults }, contextAt(repo));
    const second = await runNew(
      { branch: "feat/again", ...defaults },
      contextAt(repo),
    );
    expect(second.kind).toBe("exists");
  });

  it("refuses a branch already checked out, and points at wt open", async () => {
    const parent = join(sandbox.root, "occupied");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const result = await runNew(
      { branch: "main", ...defaults },
      contextAt(repo),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.message).toContain("already checked out");
  });

  it("disambiguates two branches that slug to the same directory", async () => {
    const parent = join(sandbox.root, "collide");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const first = expectCreated(
      await runNew({ branch: "a/b", ...defaults }, contextAt(repo)),
    );
    const second = expectCreated(
      await runNew({ branch: "a-b", ...defaults }, contextAt(repo)),
    );

    expect(first.plan.worktreePath).not.toBe(second.plan.worktreePath);
    expect(second.notices.join(" ")).toContain("a/b");
  });

  it("changes nothing under --dry-run", async () => {
    const parent = join(sandbox.root, "dry");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const result = await runNew(
      { branch: "feat/dry", ...defaults },
      contextAt(repo, { dryRun: true }),
    );
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") throw new Error("expected planned");
    await expect(stat(result.plan.worktreePath)).rejects.toThrow();
  });

  it("offers the candidates when started from a parent holding several repos", async () => {
    const parent = join(sandbox.root, "several");
    await mkdir(parent, { recursive: true });
    await makeRepo(parent, "one");
    await makeRepo(parent, "two");

    const result = await runNew(
      { branch: "feat/x", ...defaults },
      contextAt(parent),
    );
    expect(result.kind).toBe("choose");
    if (result.kind !== "choose") throw new Error("expected choose");
    expect(result.candidates.map((c) => c.name).sort()).toEqual(["one", "two"]);
  });

  it("skips the choice when the repo is named", async () => {
    const parent = join(sandbox.root, "named");
    await mkdir(parent, { recursive: true });
    await makeRepo(parent, "one");
    await makeRepo(parent, "two");

    const result = expectCreated(
      await runNew(
        { repo: "two", branch: "feat/x", ...defaults },
        contextAt(parent),
      ),
    );
    expect(result.plan.topology.repoName).toBe("two");
  });

  it("lists the candidates when the named repo does not exist", async () => {
    const parent = join(sandbox.root, "wrongname");
    await mkdir(parent, { recursive: true });
    await makeRepo(parent, "one");

    const result = await runNew(
      { repo: "nope", branch: "feat/x", ...defaults },
      contextAt(parent),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.hint).toContain("one");
  });

  it("resolves the repo by name from inside a sibling", async () => {
    const parent = join(sandbox.root, "sibling");
    await mkdir(parent, { recursive: true });
    const one = await makeRepo(parent, "one");
    await makeRepo(parent, "two");

    const result = expectCreated(
      await runNew(
        { repo: "two", branch: "feat/y", ...defaults },
        contextAt(one),
      ),
    );
    expect(result.plan.topology.repoName).toBe("two");
  });
});
