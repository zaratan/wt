import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../lib/exec/run.js";
import { scrubGitEnv } from "../../lib/exec/env.js";

/** Isolated from the machine, or the suite passes or fails per laptop. */
const FIXTURE_ENV = scrubGitEnv(
  { PATH: process.env.PATH, HOME: process.env.HOME },
  {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "wt fixtures",
    GIT_AUTHOR_EMAIL: "fixtures@example.invalid",
    GIT_COMMITTER_NAME: "wt fixtures",
    GIT_COMMITTER_EMAIL: "fixtures@example.invalid",
  },
);

export const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await run({
    argv: [
      "git",
      "-c",
      "init.defaultBranch=main",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ] as unknown as readonly [string, ...string[]],
    cwd,
    env: FIXTURE_ENV,
    timeoutMs: 30_000,
  });
  if (result.kind === "error") {
    throw new Error(`fixture git spawn failed: ${result.message}`);
  }
  if (result.outcome.code !== 0) {
    throw new Error(
      `fixture git ${args.join(" ")} failed (${String(result.outcome.code)}): ${result.outcome.stderr}`,
    );
  }
  return result.outcome.stdout;
};

export type Sandbox = {
  root: string;
  cleanup: () => Promise<void>;
};

export const makeSandbox = async (): Promise<Sandbox> => {
  // macOS: mkdtemp gives /var/..., git gives back /private/var/....
  const root = await realpath(await mkdtemp(join(tmpdir(), "wt-fixture-")));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

export const makeRepo = async (
  parent: string,
  name: string,
): Promise<string> => {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  await git(path, "init", "--quiet");
  await writeFile(join(path, "README.md"), `# ${name}\n`);
  await git(path, "add", "README.md");
  await git(path, "commit", "--quiet", "-m", "initial");
  return path;
};

export const makeBareRepo = async (
  parent: string,
  name: string,
): Promise<string> => {
  const source = await makeRepo(parent, `${name}-source`);
  const path = join(parent, `${name}.git`);
  await git(parent, "clone", "--bare", "--quiet", source, path);
  return path;
};

export const addWorktree = async (
  repoRoot: string,
  at: string,
  branch: string,
): Promise<string> => {
  await git(repoRoot, "worktree", "add", "--quiet", "-b", branch, at);
  return at;
};

/** A remote with a restricted refspec: where a plain `git fetch` lies. */
export const makeSingleBranchClone = async (
  parent: string,
  name: string,
): Promise<{ clone: string; origin: string }> => {
  const origin = await makeRepo(parent, `${name}-origin`);
  await git(origin, "branch", "feature/extra");
  const clone = join(parent, name);
  await git(
    parent,
    "clone",
    "--quiet",
    "--single-branch",
    "--branch",
    "main",
    origin,
    clone,
  );
  return { clone, origin };
};

export const makeSuperproject = async (
  parent: string,
  name: string,
): Promise<{ superproject: string; submodule: string }> => {
  const child = await makeRepo(parent, `${name}-child`);
  const superproject = await makeRepo(parent, name);
  await git(
    superproject,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "--quiet",
    "add",
    child,
    "sub",
  );
  await git(superproject, "commit", "--quiet", "-m", "add submodule");
  return { superproject, submodule: join(superproject, "sub") };
};

export const makeUnbornRepo = async (
  parent: string,
  name: string,
): Promise<string> => {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  await git(path, "init", "--quiet");
  return path;
};
