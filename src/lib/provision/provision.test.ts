import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, readFile, stat, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { createGit } from "../git/exec.js";
import { provision } from "./run.js";
import { shouldRun, EMPTY_STATE, type WorktreeState } from "./state.js";
import { DEFAULT_CONFIG, type WtConfig } from "../config/schema.js";
import {
  addWorktree,
  makeRepo,
  makeSandbox,
  type Sandbox,
} from "../../test/fixtures/git.js";

let sandbox: Sandbox;

const env = { PATH: process.env.PATH, HOME: process.env.HOME };
const gitAt = (cwd: string) => createGit({ cwd, env });

const configWith = (overrides: Partial<WtConfig["provision"]>): WtConfig => ({
  ...DEFAULT_CONFIG,
  provision: { ...DEFAULT_CONFIG.provision, ...overrides },
});

const setup = async (name: string) => {
  const parent = join(sandbox.root, name);
  await mkdir(parent, { recursive: true });
  const repo = await makeRepo(parent, "app");
  const worktree = await addWorktree(
    repo,
    join(parent, ".worktrees", "app-feat"),
    "feat/x",
  );
  return { repo, worktree };
};

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("shouldRun", () => {
  const never = () => Promise.resolve(false);
  const always = () => Promise.resolve(true);

  it("skips an if-missing step when the path is there and the last run worked", async () => {
    expect(
      await shouldRun(
        "if-missing:node_modules",
        EMPTY_STATE,
        "x",
        always,
        "/w",
      ),
    ).toBe(false);
  });

  it("runs an if-missing step when the path is absent", async () => {
    expect(
      await shouldRun("if-missing:node_modules", EMPTY_STATE, "x", never, "/w"),
    ).toBe(true);
  });

  it("re-runs an if-missing step after an interrupted run, despite the path existing", async () => {
    const interrupted: WorktreeState = {
      schema: 1,
      provision: { state: "interrupted", onceDone: [] },
    };
    expect(
      await shouldRun(
        "if-missing:node_modules",
        interrupted,
        "x",
        always,
        "/w",
      ),
    ).toBe(true);
  });

  it("re-runs a once step after a failure", async () => {
    const failed: WorktreeState = {
      schema: 1,
      provision: { state: "failed", onceDone: ["x"] },
    };
    expect(await shouldRun("once", failed, "x", never, "/w")).toBe(true);
  });

  it("skips a once step that already succeeded", async () => {
    const done: WorktreeState = {
      schema: 1,
      provision: { state: "ok", onceDone: ["x"] },
    };
    expect(await shouldRun("once", done, "x", never, "/w")).toBe(false);
  });
});

describe("provision", () => {
  it("copies a file and preserves its mode", async () => {
    const { repo, worktree } = await setup("modes");
    await writeFile(join(repo, "secret.key"), "s3cret\n", { mode: 0o600 });

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({ copy: ["secret.key"] }),
      env,
    });

    expect(report.copies[0]?.outcome).toBe("copied");
    const mode = (await stat(join(worktree, "secret.key"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("creates intermediate directories", async () => {
    const { repo, worktree } = await setup("nested");
    await mkdir(join(repo, "apps", "web", "certificates"), { recursive: true });
    await writeFile(join(repo, "apps/web/certificates/dev.pem"), "cert\n");

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({ copy: ["apps/web/certificates"] }),
      env,
    });

    expect(report.copies[0]?.outcome).toBe("copied");
    expect(
      await readFile(join(worktree, "apps/web/certificates/dev.pem"), "utf8"),
    ).toBe("cert\n");
  });

  it("reports a missing source without failing the run", async () => {
    const { repo, worktree } = await setup("absent");

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({ copy: [".env"] }),
      env,
    });

    expect(report.copies[0]?.outcome).toBe("missing");
    expect(report.ok).toBe(true);
  });

  it("does not overwrite a file already in the worktree", async () => {
    const { repo, worktree } = await setup("existing");
    await writeFile(join(repo, ".env"), "from repo\n");
    await writeFile(join(worktree, ".env"), "mine\n");

    await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({ copy: [".env"] }),
      env,
    });

    expect(await readFile(join(worktree, ".env"), "utf8")).toBe("mine\n");
  });

  it("runs commands in the worktree, with WT_ variables set", async () => {
    const { repo, worktree } = await setup("commands");

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({
        commands: [
          { run: "pwd -P > where.txt", when: "always" },
          { run: 'printf "%s" "$WT_WORKTREE" > env.txt', when: "always" },
        ],
      }),
      env,
    });

    expect(report.ok).toBe(true);
    expect((await readFile(join(worktree, "where.txt"), "utf8")).trim()).toBe(
      worktree,
    );
    expect(await readFile(join(worktree, "env.txt"), "utf8")).toBe(worktree);
  });

  it("stops at the first failure and keeps its output", async () => {
    const { repo, worktree } = await setup("failing");

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({
        commands: [
          { run: "echo boom >&2; exit 4", when: "always" },
          { run: "touch never.txt", when: "always" },
        ],
      }),
      env,
    });

    expect(report.ok).toBe(false);
    expect(report.commands[0]?.outcome).toBe("failed");
    expect(report.commands[0]?.code).toBe(4);
    expect(report.commands[0]?.tail?.join("")).toContain("boom");
    expect(report.commands).toHaveLength(1);
  });

  it("writes the full output to a log beside the state", async () => {
    const { repo, worktree } = await setup("logging");

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({
        commands: [{ run: "echo line-one; echo line-two", when: "always" }],
      }),
      env,
    });

    expect(report.logPath).toBeDefined();
    const log = await readFile(report.logPath ?? "", "utf8");
    expect(log).toContain("line-one");
    expect(log).toContain("line-two");
  });

  it("is idempotent: a second run skips what already succeeded", async () => {
    const { repo, worktree } = await setup("idempotent");

    const config = configWith({
      commands: [
        { run: "mkdir -p node_modules", when: "if-missing:node_modules" },
      ],
    });

    const first = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config,
      env,
    });
    const second = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config,
      env,
    });

    expect(first.commands[0]?.outcome).toBe("ran");
    expect(second.commands[0]?.outcome).toBe("skipped");
  });

  it("re-runs an if-missing step after a failed run, even though the path exists", async () => {
    const { repo, worktree } = await setup("retry");

    const failing = configWith({
      commands: [
        { run: "mkdir -p node_modules", when: "if-missing:node_modules" },
        { run: "exit 1", when: "always" },
      ],
    });
    await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: failing,
      env,
    });

    const retry = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: failing,
      env,
    });
    expect(retry.commands[0]?.outcome).toBe("ran");
  });

  it("kills a command that overruns its timeout", async () => {
    const { repo, worktree } = await setup("timeout");

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({
        commands: [{ run: "sleep 30", when: "always" }],
        timeoutMs: 300,
      }),
      env,
    });

    expect(report.ok).toBe(false);
    expect(report.commands[0]?.outcome).toBe("timed-out");
  });

  it("copies a symlink as a link, not as its target", async () => {
    const { repo, worktree } = await setup("symlink");
    await writeFile(join(sandbox.root, "vault-env"), "secret\n");
    const { symlink } = await import("node:fs/promises");
    await symlink(join(sandbox.root, "vault-env"), join(repo, ".env"));

    await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({ copy: [".env"] }),
      env,
    });

    const { lstat } = await import("node:fs/promises");
    expect((await lstat(join(worktree, ".env"))).isSymbolicLink()).toBe(true);
  });

  it("runs an executable script from the repo", async () => {
    const { repo, worktree } = await setup("script");
    await mkdir(join(worktree, "bin"), { recursive: true });
    await writeFile(join(worktree, "bin/setup"), "#!/bin/sh\ntouch done.txt\n");
    await chmod(join(worktree, "bin/setup"), 0o755);

    const report = await provision(gitAt(repo), {
      repoRoot: repo,
      worktreePath: worktree,
      config: configWith({ commands: [{ run: "bin/setup", when: "always" }] }),
      env,
    });

    expect(report.ok).toBe(true);
    expect((await stat(join(worktree, "done.txt"))).isFile()).toBe(true);
  });
});
