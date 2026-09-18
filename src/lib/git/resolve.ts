import { basename, isAbsolute, join, resolve as resolvePath } from "node:path";
import {
  MAX_UMBRELLA_SIBLINGS,
  detectTopology,
  type Probes,
  type Topology,
  type UmbrellaAsk,
} from "./topology.js";

export type RepoCandidate = { name: string; path: string };

export type RepoResolution =
  | { kind: "ok"; topology: Topology }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

export type ResolveInput = {
  startDir: string;
  repoArg?: string;
  forceUmbrella?: boolean;
  worktreesDir?: string;
  askUmbrella?: UmbrellaAsk;
};

const isMainCheckout = async (
  path: string,
  probes: Probes,
): Promise<boolean> => {
  if (!(await probes.fs.isDirectory(path))) return false;
  if ((await probes.git.isBare(path)) !== false) return false;
  const worktrees = await probes.git.worktrees(path);
  const first = worktrees?.[0];
  if (first === undefined) return false;
  const real = await probes.fs.realpath(path);
  return real !== undefined && (await probes.fs.realpath(first.path)) === real;
};

/**
 * Depth 1 only. It is what keeps FEPEM's 22 `gitlab_sources/*` repos out of the
 * list without a special case, and a folder past the umbrella veto is a projects
 * folder where offering a choice of 61 makes no sense.
 */
const siblingRepos = async (
  dir: string,
  probes: Probes,
): Promise<readonly RepoCandidate[]> => {
  const entries = await probes.fs.listEntries(dir);
  if (entries === undefined || entries.length > MAX_UMBRELLA_SIBLINGS) {
    return [];
  }

  const visible = entries.filter((name) => !name.startsWith("."));
  const found = await Promise.all(
    visible.map(async (name) => {
      const path = join(dir, name);
      return (await isMainCheckout(path, probes)) ? { name, path } : undefined;
    }),
  );
  return found.filter((entry): entry is RepoCandidate => entry !== undefined);
};

const describeCandidates = (candidates: readonly RepoCandidate[]): string =>
  candidates.map((candidate) => candidate.name).join(", ");

export const resolveRepo = async (
  input: ResolveInput,
  probes: Probes,
): Promise<RepoResolution> => {
  const { startDir, repoArg } = input;
  const topologyFor = async (dir: string): Promise<RepoResolution> => {
    const result = await detectTopology(
      {
        startDir: dir,
        forceUmbrella: input.forceUmbrella,
        worktreesDir: input.worktreesDir,
        askUmbrella: input.askUmbrella,
      },
      probes,
    );
    return result.kind === "ok"
      ? { kind: "ok", topology: result.topology }
      : { kind: "error", message: result.message };
  };

  if (repoArg !== undefined) {
    const direct = isAbsolute(repoArg)
      ? repoArg
      : resolvePath(startDir, repoArg);

    if (await isMainCheckout(direct, probes)) return topologyFor(direct);

    const here = await detectTopology({ startDir }, probes);
    if (here.kind === "ok") {
      const sibling = join(here.topology.parent, repoArg);
      if (await isMainCheckout(sibling, probes)) return topologyFor(sibling);
    }

    const searchIn = here.kind === "ok" ? here.topology.parent : startDir;
    const candidates = await siblingRepos(searchIn, probes);
    return {
      kind: "error",
      message: `unknown repository '${repoArg}' under ${searchIn}`,
      hint:
        candidates.length === 0
          ? `no git repository found directly under ${searchIn}`
          : `available: ${describeCandidates(candidates)}`,
    };
  }

  const here = await detectTopology(
    {
      startDir,
      forceUmbrella: input.forceUmbrella,
      worktreesDir: input.worktreesDir,
      askUmbrella: input.askUmbrella,
    },
    probes,
  );
  if (here.kind === "ok") return { kind: "ok", topology: here.topology };
  if (here.code !== "not-a-repo") {
    return { kind: "error", message: here.message };
  }

  const candidates = await siblingRepos(startDir, probes);
  if (candidates.length === 0) {
    return {
      kind: "error",
      message: here.message,
      hint: `no git repository found directly under ${startDir} either`,
    };
  }
  if (candidates.length === 1) {
    const only = candidates[0];
    if (only !== undefined) return topologyFor(only.path);
  }
  return { kind: "choose", from: startDir, candidates };
};

export const candidateNames = (
  candidates: readonly RepoCandidate[],
): readonly string[] => candidates.map((candidate) => basename(candidate.path));
