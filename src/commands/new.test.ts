import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runNew, type NewResult } from "./new.js";
import { readCreation } from "../lib/provision/state.js";
import { createGit } from "../lib/git/exec.js";
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
    pid: process.pid,
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
  it("creates the worktree under <parent>/.worktrees/<repo>/<slug>", async () => {
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
      join(parent, ".worktrees", "app", "investigations-import-cmdb"),
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

describe("config drives wt new", () => {
  it("labels the space from space.label rather than the built-in shape", async () => {
    const parent = join(sandbox.root, "label-template");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");
    await mkdir(join(repo, ".wt"), { recursive: true });
    await writeFile(
      join(repo, ".wt", "app.toml"),
      'schema = 1\n[space]\nlabel = "{repo}:{as} <{branch}>"\n',
    );

    const created = await runNew(
      {
        branch: "feat/x",
        as: "X",
        fetch: false,
        gitignore: false,
        open: false,
        focus: false,
        provision: false,
      },
      contextAt(repo),
    );
    if (created.kind !== "created") throw new Error(created.kind);
    expect(created.plan.label).toBe("app:X <feat/x>");
  });

  it("branches from repo.default_base when --from is absent", async () => {
    const parent = join(sandbox.root, "based");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");
    await git(repo, "branch", "develop");
    await git(repo, "checkout", "develop");
    await git(repo, "commit", "--allow-empty", "-m", "only on develop");
    await git(repo, "checkout", "main");
    await mkdir(join(repo, ".wt"), { recursive: true });
    await writeFile(
      join(repo, ".wt", "app.toml"),
      'schema = 1\n[repo]\ndefault_base = "develop"\n',
    );

    const created = await runNew(
      {
        branch: "feat/from-develop",
        fetch: false,
        gitignore: false,
        open: false,
        focus: false,
        provision: false,
      },
      contextAt(repo),
    );
    if (created.kind !== "created") throw new Error(created.kind);
    if (created.plan.branchPlan.kind !== "create") {
      throw new Error(created.plan.branchPlan.kind);
    }
    expect(created.plan.branchPlan.base).toBe("develop");
  });
});

describe("the very first worktree of a repository", () => {
  it("opens the layout it just detected, not the built-in default", async () => {
    const parent = join(sandbox.root, "first-run");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "app", scripts: { dev: "vite" } }),
    );
    await writeFile(join(repo, "pnpm-lock.yaml"), "");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "dev script");

    const created = await runNew(
      {
        branch: "feat/first",
        fetch: false,
        gitignore: false,
        open: false,
        focus: false,
        provision: false,
      },
      contextAt(repo),
    );

    if (created.kind !== "created") throw new Error(created.kind);
    expect(created.configWritten).toBeDefined();

    const remembered = await readCreation(
      createGit({
        cwd: repo,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" },
      }),
      created.plan.worktreePath,
    );
    expect(remembered.layout).toContain("pnpm dev");
  });
});

describe("the config review", () => {
  const withDevScript = async (name: string): Promise<string> => {
    const parent = join(sandbox.root, name);
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");
    await writeFile(join(repo, ".gitignore"), ".env\n");
    await writeFile(join(repo, ".env"), "SECRET=1\n");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "app", scripts: { dev: "vite" } }),
    );
    await writeFile(join(repo, "pnpm-lock.yaml"), "");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "setup");
    return repo;
  };

  const create = (repo: string, overrides: Partial<CommandContext>) =>
    runNew(
      {
        branch: "feat/x",
        fetch: false,
        gitignore: false,
        open: false,
        focus: false,
        provision: false,
      },
      contextAt(repo, overrides),
    );

  it("is never asked when there is no screen to show it on", async () => {
    const repo = await withDevScript("no-screen");
    const created = await create(repo, {});
    if (created.kind !== "created") throw new Error(created.kind);
    expect(created.configWritten).toBeDefined();
  });

  it("writes what the user kept, not what was detected", async () => {
    const repo = await withDevScript("kept");
    const created = await create(repo, {
      reviewConfig: () => Promise.resolve({ kind: "write", copy: [] }),
    });

    if (created.kind !== "created") throw new Error(created.kind);
    if (created.configWritten === undefined) throw new Error("nothing written");
    const written = await readFile(created.configWritten, "utf8");
    expect(written).toContain("copy = []");
    expect(written).not.toContain('".env"');
  });

  it("writes nothing at all when the user continues without a config", async () => {
    const repo = await withDevScript("skipped");
    const created = await create(repo, {
      reviewConfig: () => Promise.resolve({ kind: "skip" }),
    });

    if (created.kind !== "created") throw new Error(created.kind);
    expect(created.configWritten).toBeUndefined();
    await expect(
      readFile(join(repo, ".wt", "app.toml"), "utf8"),
    ).rejects.toThrow();
  });

  it("asks before the worktree exists, so abandoning leaves nothing behind", async () => {
    const repo = await withDevScript("ordering");
    let existedWhenAsked = true;

    await create(repo, {
      reviewConfig: async () => {
        existedWhenAsked = await stat(
          join(sandbox.root, "ordering", ".worktrees"),
        )
          .then(() => true)
          .catch(() => false);
        return { kind: "skip" };
      },
    });

    expect(existedWhenAsked).toBe(false);
  });
});
