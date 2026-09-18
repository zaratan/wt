import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "./parse.js";
import { dispatch } from "./dispatch.js";
import { runNew } from "../commands/new.js";
import type { CommandContext } from "../commands/context.js";
import { makeRepo, makeSandbox, type Sandbox } from "../test/fixtures/git.js";

let sandbox: Sandbox;
let repo: string;

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

const codeOf = async (
  argv: readonly string[],
  overrides: Partial<CommandContext> = {},
): Promise<number> => {
  const parsed = parse([...argv]);
  if (parsed.kind !== "run")
    throw new Error(`${argv.join(" ")}: ${parsed.kind}`);
  const output = await dispatch(parsed.invocation, contextAt(repo, overrides));
  return output.code;
};

beforeAll(async () => {
  sandbox = await makeSandbox();
  const parent = join(sandbox.root, "codes");
  await mkdir(parent, { recursive: true });
  repo = await makeRepo(parent, "app");
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
  if (created.kind !== "created") throw new Error(created.kind);
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("wt provision exit codes", () => {
  it("reports a successful dry run as success, not as partial", async () => {
    expect(
      await codeOf(["provision", "feat/x", "--dry-run"], { dryRun: true }),
    ).toBe(0);
    expect(
      await codeOf(["provision", "feat/x", "--dry-run", "--json"], {
        dryRun: true,
        json: true,
      }),
    ).toBe(0);
  });

  it("reports a target that matches nothing as an error, not as partial", async () => {
    expect(await codeOf(["provision", "no/such/branch"])).toBe(1);
    expect(
      await codeOf(["provision", "no/such/branch", "--json"], { json: true }),
    ).toBe(1);
  });

  it("agrees between the text and the json surface", async () => {
    for (const argv of [
      ["provision", "feat/x", "--dry-run"],
      ["provision", "no/such/branch"],
    ]) {
      const text = await codeOf(argv, { dryRun: argv.includes("--dry-run") });
      const json = await codeOf([...argv, "--json"], {
        dryRun: argv.includes("--dry-run"),
        json: true,
      });
      expect(json).toBe(text);
    }
  });
});
