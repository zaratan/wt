import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGit } from "../git/exec.js";
import { provision } from "./run.js";
import { statePath } from "./state.js";
import { DEFAULT_CONFIG } from "../config/schema.js";
import type { WorktreeState } from "./state.js";
import {
  addWorktree,
  makeRepo,
  makeSandbox,
  type Sandbox,
} from "../../test/fixtures/git.js";

let sandbox: Sandbox;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" };

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("provisioning I/O", () => {
  it("records `interrupted`, not a success the next run would skip", async () => {
    const repo = await makeRepo(sandbox.root, "sigint");
    const worktree = join(sandbox.root, "sigint-wt");
    await addWorktree(repo, worktree, "feat/x");
    const git = createGit({ cwd: repo, env });

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 300).unref();

    const report = await provision(git, {
      repoRoot: repo,
      worktreePath: worktree,
      env,
      signal: controller.signal,
      config: {
        ...DEFAULT_CONFIG,
        provision: {
          copy: [],
          timeoutMs: 30_000,
          commands: [{ run: "sleep 20", when: "always" }],
        },
      },
    });

    expect(report.ok).toBe(false);
    expect(report.commands[0]?.outcome).toBe("interrupted");

    const path = await statePath(git, worktree);
    if (path === undefined) throw new Error("no state path");
    const written = JSON.parse(await readFile(path, "utf8")) as WorktreeState;
    expect(written.provision.state).toBe("interrupted");
    expect(written.provision.heartbeatAt).toBeUndefined();
  });

  it("writes the command output to the log in the order it was printed", async () => {
    const repo = await makeRepo(sandbox.root, "ordered");
    const worktree = join(sandbox.root, "ordered-wt");
    await addWorktree(repo, worktree, "feat/y");
    const git = createGit({ cwd: repo, env });

    const report = await provision(git, {
      repoRoot: repo,
      worktreePath: worktree,
      env,
      config: {
        ...DEFAULT_CONFIG,
        provision: {
          copy: [],
          timeoutMs: 30_000,
          commands: [
            {
              run: "for i in $(seq 1 400); do echo line$i; done",
              when: "always",
            },
          ],
        },
      },
    });

    expect(report.ok).toBe(true);
    if (report.logPath === undefined) throw new Error("no log path");
    const written = (await readFile(report.logPath, "utf8"))
      .split("\n")
      .filter((line) => line.startsWith("line"));
    expect(written).toHaveLength(400);
    expect(written[0]).toBe("line1");
    expect(written[399]).toBe("line400");
  });
});

describe("two provisionings of the same worktree", () => {
  it("lets one through and tells the other who holds it", async () => {
    const repo = await makeRepo(sandbox.root, "concurrent");
    const worktree = join(sandbox.root, "concurrent-wt");
    await addWorktree(repo, worktree, "feat/z");
    const git = createGit({ cwd: repo, env });

    const config = {
      ...DEFAULT_CONFIG,
      provision: {
        copy: [],
        timeoutMs: 30_000,
        commands: [{ run: "sleep 1", when: "always" as const }],
      },
    };
    const start = (pid: number) =>
      provision(git, {
        repoRoot: repo,
        worktreePath: worktree,
        env,
        pid,
        config,
      });

    // Both pids must be alive: a holder whose process is gone is deliberately
    // evicted, so a made-up pid would let the loser steal the lock.
    const [first, second] = await Promise.all([
      start(process.pid),
      start(process.pid),
    ]);

    const reports = [first, second];
    expect(reports.filter((one) => one.blockedBy !== undefined)).toHaveLength(
      1,
    );
    expect(reports.filter((one) => one.ok)).toHaveLength(1);
  }, 20_000);
});

describe("the progress channel", () => {
  it("announces each step and the command's own output, tagged", async () => {
    const repo = await makeRepo(sandbox.root, "events");
    const worktree = join(sandbox.root, "events-wt");
    await addWorktree(repo, worktree, "feat/e");
    const git = createGit({ cwd: repo, env });
    const seen: string[] = [];

    await provision(git, {
      repoRoot: repo,
      worktreePath: worktree,
      env,
      onEvent: (event) => {
        seen.push(
          event.kind === "output" ? `output:${event.line}` : event.kind,
        );
      },
      config: {
        ...DEFAULT_CONFIG,
        provision: {
          copy: [],
          timeoutMs: 30_000,
          commands: [{ run: "echo hello", when: "always" }],
        },
      },
    });

    expect(seen).toContain("step-start");
    expect(seen).toContain("step-done");
    expect(seen).toContain("output:hello");
  });

  it("emits nothing about steps it skipped beyond saying so", async () => {
    const repo = await makeRepo(sandbox.root, "skipping");
    const worktree = join(sandbox.root, "skipping-wt");
    await addWorktree(repo, worktree, "feat/s");
    await mkdir(join(worktree, "node_modules"), { recursive: true });
    const git = createGit({ cwd: repo, env });
    const outcomes: string[] = [];

    await provision(git, {
      repoRoot: repo,
      worktreePath: worktree,
      env,
      onEvent: (event) => {
        if (event.kind === "step-done") outcomes.push(event.outcome);
      },
      config: {
        ...DEFAULT_CONFIG,
        provision: {
          copy: [],
          timeoutMs: 30_000,
          commands: [{ run: "echo never", when: "if-missing:node_modules" }],
        },
      },
    });

    expect(outcomes).toEqual(["skipped"]);
  });
});
