import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectTopology, MAX_UMBRELLA_SIBLINGS } from "./topology.js";
import type { Topology, TopologyResult, UmbrellaAsk } from "./topology.js";
import { createGit } from "./exec.js";
import { createProbes } from "./probes.js";
import {
  addWorktree,
  git,
  makeBareRepo,
  makeRepo,
  makeSandbox,
  makeSuperproject,
  makeUnbornRepo,
  type Sandbox,
} from "../../test/fixtures/git.js";

let sandbox: Sandbox;

const pollutedEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_DIR: join(sandbox.root, "poison", ".git"),
  GIT_WORK_TREE: join(sandbox.root, "poison"),
});

const detectAt = async (
  startDir: string,
  extra: { forceUmbrella?: boolean; askUmbrella?: UmbrellaAsk } = {},
): Promise<TopologyResult> => {
  const gitRunner = createGit({ cwd: startDir, env: pollutedEnv() });
  return detectTopology({ startDir, ...extra }, createProbes(gitRunner));
};

const expectOk = (result: TopologyResult): Topology => {
  if (result.kind !== "ok") {
    throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  }
  return result.topology;
};

beforeAll(async () => {
  sandbox = await makeSandbox();
  await makeRepo(sandbox.root, "poison");
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("detectTopology", () => {
  describe("finding the main checkout", () => {
    it("resolves a plain repository to itself", async () => {
      const parent = join(sandbox.root, "plain");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");

      const topology = expectOk(await detectAt(repo));
      expect(topology.repoRoot).toContain("/app");
      expect(topology.repoName).toBe("app");
      expect(topology.startedInLinkedWorktree).toBe(false);
    });

    it("resolves a LINKED worktree to the main checkout, not to itself", async () => {
      const parent = join(sandbox.root, "linked");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");
      const linked = await addWorktree(
        repo,
        join(parent, ".worktrees", "app", "feat-x"),
        "feat/x",
      );

      const topology = expectOk(await detectAt(linked));
      expect(topology.repoRoot).toBe(topology.repoRoot);
      expect(topology.repoName).toBe("app");
      expect(topology.startedInLinkedWorktree).toBe(true);
      expect(topology.worktreesBase).toBe(join(parent, ".worktrees"));
      expect(topology.worktreesRoot).toBe(join(parent, ".worktrees", "app"));
    });

    it("refuses a bare repository instead of crashing", async () => {
      const parent = join(sandbox.root, "bare");
      await mkdir(parent, { recursive: true });
      const bare = await makeBareRepo(parent, "svc");

      const result = await detectAt(bare);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.code).toBe("bare-repo");
    });

    it("reports a directory that is not a repository", async () => {
      const outside = join(sandbox.root, "not-a-repo");
      await mkdir(outside, { recursive: true });

      const result = await detectAt(outside);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.code).toBe("not-a-repo");
    });

    it("handles a submodule checkout, whose .git is a file", async () => {
      const parent = join(sandbox.root, "super");
      await mkdir(parent, { recursive: true });
      const { submodule } = await makeSuperproject(parent, "top");

      const topology = expectOk(await detectAt(submodule));
      expect(topology.repoName).toBe("sub");
      expect(topology.repoRoot).not.toContain("/.git/");
    });

    it("works in a repository with no commit yet", async () => {
      const parent = join(sandbox.root, "unborn");
      await mkdir(parent, { recursive: true });
      const repo = await makeUnbornRepo(parent, "fresh");

      const topology = expectOk(await detectAt(repo));
      expect(topology.repoName).toBe("fresh");
    });
  });

  describe("umbrella verdict", () => {
    it("says plain for a folder with too many siblings", async () => {
      const parent = join(sandbox.root, "projects");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");
      for (let i = 0; i <= MAX_UMBRELLA_SIBLINGS; i += 1) {
        await mkdir(join(parent, `sibling-${String(i)}`), { recursive: true });
      }

      const topology = expectOk(await detectAt(repo));
      expect(topology.umbrella).toBe("plain");
      expect(topology.umbrellaReason).toBe("too-many-siblings");
      expect(topology.contextRoot).toBe(topology.repoRoot);
    });

    it("says umbrella when the parent declares .wt/", async () => {
      const parent = join(sandbox.root, "declared");
      await mkdir(join(parent, ".wt"), { recursive: true });
      const repo = await makeRepo(parent, "app");

      const topology = expectOk(await detectAt(repo));
      expect(topology.umbrella).toBe("umbrella");
      expect(topology.umbrellaReason).toBe("declared-parent");
      expect(topology.contextRoot).toBe(parent);
      expect(topology.configRoot).toBe(parent);
    });

    it("says plain when the repo itself declares .wt/", async () => {
      const parent = join(sandbox.root, "declared-repo");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");
      await mkdir(join(repo, ".wt"), { recursive: true });

      const topology = expectOk(await detectAt(repo));
      expect(topology.umbrella).toBe("plain");
      expect(topology.umbrellaReason).toBe("declared-repo");
    });

    it("says umbrella when a git parent gitignores the child repo", async () => {
      const parent = await makeRepo(sandbox.root, "fepem-like");
      await writeFile(join(parent, ".gitignore"), "/platform/\n");
      await git(parent, "add", ".gitignore");
      await git(parent, "commit", "--quiet", "-m", "ignore platform");
      const repo = await makeRepo(parent, "platform");

      const topology = expectOk(await detectAt(repo));
      expect(topology.umbrella).toBe("umbrella");
      expect(topology.umbrellaReason).toBe("parent-ignores-repo");
      expect(topology.parentIsRepo).toBe(true);
    });

    it("stays plain when nothing decides it and nobody can be asked", async () => {
      const parent = join(sandbox.root, "undecided");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");

      const topology = expectOk(await detectAt(repo));
      expect(topology.umbrella).toBe("plain");
      expect(topology.umbrellaReason).toBe("undecided");
    });

    it("takes the answer when there is someone to ask", async () => {
      const parent = join(sandbox.root, "answered");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");
      const asked: string[] = [];

      const topology = expectOk(
        await detectAt(repo, {
          askUmbrella: (question) => {
            asked.push(question.parent);
            return Promise.resolve(true);
          },
        }),
      );
      expect(topology.umbrella).toBe("umbrella");
      expect(topology.umbrellaReason).toBe("answered");
      expect(asked).toHaveLength(1);
    });

    it("never asks once a .wt/ directory has recorded the answer", async () => {
      const parent = join(sandbox.root, "remembered");
      await mkdir(join(parent, ".wt"), { recursive: true });
      const repo = await makeRepo(parent, "app");
      let asked = 0;

      const topology = expectOk(
        await detectAt(repo, {
          askUmbrella: () => {
            asked += 1;
            return Promise.resolve(false);
          },
        }),
      );
      expect(topology.umbrella).toBe("umbrella");
      expect(asked).toBe(0);
    });

    it("lets --umbrella / --no-umbrella override everything", async () => {
      const parent = join(sandbox.root, "forced");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");

      const forced = expectOk(await detectAt(repo, { forceUmbrella: true }));
      expect(forced.umbrella).toBe("umbrella");
      expect(forced.umbrellaReason).toBe("forced");

      const refused = expectOk(await detectAt(repo, { forceUmbrella: false }));
      expect(refused.umbrella).toBe("plain");
    });
  });

  describe("worktrees root guards", () => {
    it("passes for a normal layout", async () => {
      const parent = join(sandbox.root, "guards-ok");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");

      const topology = expectOk(await detectAt(repo));
      expect(topology.guards.filter((g) => g.violated)).toEqual([]);
    });

    it("refuses a worktrees root that is itself a repository", async () => {
      const parent = join(sandbox.root, "guards-repo");
      await mkdir(parent, { recursive: true });
      const repo = await makeRepo(parent, "app");
      await makeRepo(parent, ".worktrees");

      const topology = expectOk(await detectAt(repo));
      const ids = topology.guards.filter((g) => g.violated).map((g) => g.id);
      expect(ids).toContain("worktrees-root-is-a-repo");
    });
  });
});

describe("where worktrees live", () => {
  it("groups them by repository under a shared base", async () => {
    const parent = join(sandbox.root, "grouped");
    await mkdir(parent, { recursive: true });
    const one = await makeRepo(parent, "one");
    const two = await makeRepo(parent, "two");

    const first = expectOk(await detectAt(one));
    const second = expectOk(await detectAt(two));

    expect(first.worktreesBase).toBe(second.worktreesBase);
    expect(first.worktreesRoot).toBe(join(parent, ".worktrees", "one"));
    expect(second.worktreesRoot).toBe(join(parent, ".worktrees", "two"));
  });

  it("keeps the base outside every git tree, so git clean cannot reach it", async () => {
    const parent = join(sandbox.root, "outside");
    await mkdir(parent, { recursive: true });
    const repo = await makeRepo(parent, "app");

    const topology = expectOk(await detectAt(repo));
    expect(topology.worktreesRoot.startsWith(`${topology.repoRoot}/`)).toBe(
      false,
    );
  });
});
