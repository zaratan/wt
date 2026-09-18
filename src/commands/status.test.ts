import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runNew } from "./new.js";
import { runStatus, type StatusResult } from "./status.js";
import { renderStatus } from "../format/status.js";
import type { CommandContext } from "./context.js";
import { createGit, okStdout } from "../lib/git/exec.js";
import { makeRepo, makeSandbox, type Sandbox } from "../test/fixtures/git.js";

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

const expectOk = (result: StatusResult) => {
  if (result.kind !== "ok") {
    throw new Error(
      `expected ok, got ${result.kind}: ${"message" in result ? result.message : ""}`,
    );
  }
  return result;
};

const setup = async (
  name: string,
): Promise<{ repo: string; worktree: string }> => {
  const parent = join(sandbox.root, name);
  await mkdir(parent, { recursive: true });
  const repo = await makeRepo(parent, "app");
  const created = await runNew(
    {
      branch: "feat/x",
      fetch: false,
      gitignore: false,
      open: false,
      focus: false,
      provision: false,
    },
    contextAt(repo),
  );
  if (created.kind !== "created") throw new Error(`setup: ${created.kind}`);
  return { repo, worktree: created.plan.worktreePath };
};

const stateFileOf = async (worktree: string): Promise<string> => {
  const git = createGit({
    cwd: worktree,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: "C" },
  });
  const answer = okStdout(
    await git(["rev-parse", "--git-path", "wt.json"], { cwd: worktree }),
  );
  if (answer === undefined) throw new Error("no state path");
  return answer.startsWith("/") ? answer : join(worktree, answer);
};

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("runStatus", () => {
  it("reports a worktree whose provisioning never ran", async () => {
    const { repo } = await setup("never");

    const result = expectOk(
      await runStatus({ target: "feat/x" }, contextAt(repo)),
    );
    const detail = result.report.details[0];
    expect(detail?.state.provision.state).toBe("never");
    expect(renderStatus(result)).toContain("never run");
  });

  it("surfaces a provisioning killed mid-run as interrupted, with the replay command", async () => {
    const { repo, worktree } = await setup("killed");
    await writeFile(
      await stateFileOf(worktree),
      JSON.stringify({
        schema: 1,
        provision: {
          state: "running",
          failedStep: "pnpm install",
          onceDone: [],
          heartbeatAt: new Date(Date.now() - 600_000).toISOString(),
        },
      }),
    );

    const result = expectOk(
      await runStatus({ target: "feat/x" }, contextAt(repo)),
    );
    expect(result.report.details[0]?.state.provision.state).toBe("interrupted");
    expect(renderStatus(result)).toContain("wt provision feat/x");
  });

  it("says herdr could not be reached rather than claiming no space is open", async () => {
    const { repo } = await setup("no-herdr");

    const result = expectOk(
      await runStatus(
        { target: "feat/x" },
        contextAt(repo, {
          env: {
            PATH: process.env.PATH,
            HERDR_SOCKET_PATH: "/nowhere/wt.sock",
          },
        }),
      ),
    );
    expect(result.report.spaces.byCheckout).toBeUndefined();
    expect(renderStatus(result)).toContain("herdr not reachable");
  });
});
