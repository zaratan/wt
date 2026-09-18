import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runNew } from "./new.js";
import { runRm, findings, type RmResult } from "./rm.js";
import type { CommandContext } from "./context.js";
import { createGit } from "../lib/git/exec.js";
import { createProbes } from "../lib/git/probes.js";
import { hasUnsavedWork, worktreeStatus } from "../lib/git/status.js";
import {
  git,
  makeRepo,
  makeSandbox,
  makeSingleBranchClone,
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

const addWorktreeTo = async (repo: string, branch: string): Promise<string> => {
  const created = await runNew(
    {
      branch,
      fetch: false,
      gitignore: false,
      open: false,
      focus: false,
      provision: false,
    },
    contextAt(repo),
  );
  if (created.kind !== "created") throw new Error(`setup: ${created.kind}`);
  return created.plan.worktreePath;
};

const makeWorktree = async (
  name: string,
  branch = "feat/x",
): Promise<{ repo: string; worktree: string }> => {
  const parent = join(sandbox.root, name);
  await mkdir(parent, { recursive: true });
  const { clone } = await makeSingleBranchClone(parent, "app");
  return { repo: clone, worktree: await addWorktreeTo(clone, branch) };
};

const makeWorktreeWithoutRemote = async (
  name: string,
  branch = "feat/x",
): Promise<{ repo: string; worktree: string }> => {
  const parent = join(sandbox.root, name);
  await mkdir(parent, { recursive: true });
  const repo = await makeRepo(parent, "app");
  return { repo, worktree: await addWorktreeTo(repo, branch) };
};

const writeRepoConfig = async (repo: string, body: string): Promise<void> => {
  await mkdir(join(repo, ".wt"), { recursive: true });
  await writeFile(join(repo, ".wt", "app.toml"), `schema = 1\n${body}\n`);
};

const expectRemoved = (result: RmResult) => {
  if (result.kind !== "removed") {
    throw new Error(
      `expected removed, got ${result.kind}: ${"message" in result ? result.message : ""}`,
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

describe("wt rm", () => {
  it("removes a clean worktree and keeps its branch", async () => {
    const { repo, worktree } = await makeWorktree("clean-rm");

    const result = expectRemoved(
      await runRm({ target: "feat/x", force: false }, contextAt(repo)),
    );

    await expect(stat(worktree)).rejects.toThrow();
    expect(result.branch.kind).toBe("kept");
    const branches = await git(repo, "branch", "--list", "feat/x");
    expect(branches).toContain("feat/x");
  });

  it("prints the command to delete the branch later", async () => {
    const { repo } = await makeWorktree("hint-rm");

    const result = expectRemoved(
      await runRm({ target: "feat/x", force: false }, contextAt(repo)),
    );
    if (result.branch.kind !== "kept") throw new Error("expected kept");
    expect(result.branch.command).toContain("branch -d feat/x");
  });

  it("deletes the branch on --delete-branch", async () => {
    const { repo } = await makeWorktree("delete-rm");

    const result = expectRemoved(
      await runRm(
        { target: "feat/x", force: false, deleteBranch: true },
        contextAt(repo),
      ),
    );
    expect(result.branch.kind).toBe("deleted");
    expect(await git(repo, "branch", "--list", "feat/x")).toBe("");
  });

  it("keeps a branch git refuses to delete safely, and says why", async () => {
    const { repo, worktree } = await makeWorktree("unmerged-rm");
    await writeFile(join(worktree, "work.txt"), "x\n");
    await git(worktree, "add", "work.txt");
    await git(worktree, "commit", "--quiet", "-m", "work");

    const result = expectRemoved(
      await runRm(
        { target: "feat/x", force: true, deleteBranch: true },
        contextAt(repo),
      ),
    );
    expect(result.branch.kind).toBe("deleted");
  });

  it("refuses when the working tree has uncommitted changes", async () => {
    const { repo, worktree } = await makeWorktree("dirty-rm");
    await writeFile(join(worktree, "README.md"), "changed\n");

    const result = await runRm(
      { target: "feat/x", force: false },
      contextAt(repo),
    );
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("expected blocked");
    expect(result.findings.join(" ")).toContain("uncommitted");
    expect((await stat(worktree)).isDirectory()).toBe(true);
  });

  it("refuses over an untracked file alone", async () => {
    const { repo, worktree } = await makeWorktree("untracked-rm");
    await writeFile(join(worktree, "scratch.txt"), "x\n");

    const result = await runRm(
      { target: "feat/x", force: false },
      contextAt(repo),
    );
    expect(result.kind).toBe("blocked");
  });

  it("lists the unpublished commits rather than just counting them", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "unpub-rm");
    const created = await runNew(
      {
        branch: "feat/work",
        fetch: false,
        gitignore: false,
        open: false,
        focus: false,
        provision: false,
      },
      contextAt(clone),
    );
    if (created.kind !== "created") throw new Error("setup");
    await writeFile(join(created.plan.worktreePath, "w.txt"), "x\n");
    await git(created.plan.worktreePath, "add", "w.txt");
    await git(created.plan.worktreePath, "commit", "--quiet", "-m", "wip work");

    const result = await runRm(
      { target: "feat/work", force: false },
      contextAt(clone),
    );
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("expected blocked");
    expect(result.findings.join("\n")).toContain("wip work");
  });

  it("says `never published` when there is no remote at all", async () => {
    const { repo } = await makeWorktreeWithoutRemote("noremote-rm");

    const result = await runRm(
      { target: "feat/x", force: false },
      contextAt(repo),
    );
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("expected blocked");
    expect(result.findings.join(" ")).toContain("no remote is configured");
  });

  it("removes anyway with --force", async () => {
    const { repo, worktree } = await makeWorktree("force-rm");
    await writeFile(join(worktree, "README.md"), "changed\n");

    const result = expectRemoved(
      await runRm({ target: "feat/x", force: true }, contextAt(repo)),
    );
    expect(result.forced).toBe(true);
    await expect(stat(worktree)).rejects.toThrow();
  });

  it("refuses to remove the main checkout", async () => {
    const { repo } = await makeWorktree("main-rm");

    const result = await runRm(
      { target: "main", force: true },
      contextAt(repo),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.message).toContain("main checkout");
  });

  it("changes nothing under --dry-run, and says it would be refused", async () => {
    const { repo, worktree } = await makeWorktree("dry-rm");
    await writeFile(join(worktree, "README.md"), "changed\n");

    const result = await runRm(
      { target: "feat/x", force: false },
      contextAt(repo, { dryRun: true }),
    );
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") throw new Error("expected planned");
    expect(result.findings.length).toBeGreaterThan(0);
    expect((await stat(worktree)).isDirectory()).toBe(true);
  });

  it("accepts the directory name as a target, not only the branch", async () => {
    const { repo, worktree } = await makeWorktree("byname-rm");

    expectRemoved(
      await runRm({ target: "app-feat-x", force: false }, contextAt(repo)),
    );
    await expect(stat(worktree)).rejects.toThrow();
  });

  it("reports a target that matches nothing", async () => {
    const { repo } = await makeWorktree("nomatch-rm");

    const result = await runRm(
      { target: "no/such/thing", force: false },
      contextAt(repo),
    );
    expect(result.kind).toBe("error");
  });
});

describe("findings", () => {
  it("is non-empty exactly when hasUnsavedWork is true", async () => {
    const { clone } = await makeSingleBranchClone(sandbox.root, "agree");
    const runner = createGit({
      cwd: clone,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" },
    });
    const probes = createProbes(runner);

    const statusNow = async () => {
      const entries = (await probes.git.worktrees(clone)) ?? [];
      const entry = entries[0];
      if (entry === undefined) throw new Error("no entry");
      return worktreeStatus(runner, {
        entry,
        repoRoot: clone,
        worktreesRoot: join(clone, "..", ".worktrees"),
        exists: probes.fs.exists,
      });
    };

    const clean = await statusNow();
    expect(findings(clean).length > 0).toBe(hasUnsavedWork(clean));

    await writeFile(join(clone, "dirty.txt"), "x\n");
    const dirty = await statusNow();
    expect(findings(dirty).length > 0).toBe(hasUnsavedWork(dirty));
  });
});

describe("remove.delete_branch", () => {
  it("deletes the branch on its own when the config says always", async () => {
    const { repo, worktree } = await makeWorktreeWithoutRemote("policy-always");
    await writeRepoConfig(repo, '[remove]\ndelete_branch = "always"');
    await git(worktree, "commit", "--allow-empty", "-m", "work");

    const result = expectRemoved(
      await runRm(
        { target: "feat/x", force: true, keepSpace: true },
        contextAt(repo),
      ),
    );
    expect(result.branch.kind).toBe("deleted");
  });

  it("keeps the branch when the config says never, even on a TTY", async () => {
    const { repo } = await makeWorktreeWithoutRemote("policy-never");
    await writeRepoConfig(repo, '[remove]\ndelete_branch = "never"');

    const result = expectRemoved(
      await runRm(
        { target: "feat/x", force: true, keepSpace: true },
        contextAt(repo, { confirm: () => Promise.resolve(true) }),
      ),
    );
    expect(result.branch.kind).toBe("kept");
  });

  it("asks before deleting when the config says ask", async () => {
    const { repo } = await makeWorktreeWithoutRemote("policy-ask");
    await writeRepoConfig(repo, '[remove]\ndelete_branch = "ask"');
    const asked: string[] = [];

    const result = expectRemoved(
      await runRm(
        { target: "feat/x", force: true, keepSpace: true },
        contextAt(repo, {
          confirm: (question) => {
            asked.push(question);
            return Promise.resolve(true);
          },
        }),
      ),
    );
    expect(asked).toHaveLength(1);
    expect(result.branch.kind).toBe("deleted");
  });

  it("keeps the branch when ask has nobody to ask", async () => {
    const { repo } = await makeWorktreeWithoutRemote("policy-ask-headless");
    await writeRepoConfig(repo, '[remove]\ndelete_branch = "ask"');

    const result = expectRemoved(
      await runRm(
        { target: "feat/x", force: true, keepSpace: true },
        contextAt(repo),
      ),
    );
    expect(result.branch.kind).toBe("kept");
  });

  it("obeys --keep-branch over an always policy", async () => {
    const { repo } = await makeWorktreeWithoutRemote("policy-override");
    await writeRepoConfig(repo, '[remove]\ndelete_branch = "always"');

    const result = expectRemoved(
      await runRm(
        {
          target: "feat/x",
          force: true,
          keepSpace: true,
          deleteBranch: false,
        },
        contextAt(repo),
      ),
    );
    expect(result.branch.kind).toBe("kept");
  });
});
