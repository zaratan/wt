/**
 * The real probes: git commands and the filesystem, behind the interfaces
 * `topology.ts` reasons over.
 */
import { readdir, realpath as fsRealpath, stat } from "node:fs/promises";
import type { Git } from "./exec.js";
import type { FsProbe, GitProbe, Probes, WorktreeEntry } from "./topology.js";

/**
 * Parses `git worktree list --porcelain`.
 *
 * Records are blank-line separated; the first is always the main worktree.
 * `branch` is a full ref, `detached` and `prunable` are bare markers.
 */
export const parseWorktreePorcelain = (
  stdout: string,
): readonly WorktreeEntry[] => {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;

  for (const line of stdout.split("\n")) {
    if (line === "") {
      if (current !== undefined) entries.push(current);
      current = undefined;
      continue;
    }
    const spaceAt = line.indexOf(" ");
    const key = spaceAt === -1 ? line : line.slice(0, spaceAt);
    const rest = spaceAt === -1 ? "" : line.slice(spaceAt + 1);

    switch (key) {
      case "worktree":
        current = {
          path: rest,
          bare: false,
          detached: false,
          prunable: false,
        };
        break;
      case "branch":
        if (current !== undefined) {
          current.branch = rest.replace(/^refs\/heads\//, "");
        }
        break;
      case "bare":
        if (current !== undefined) current.bare = true;
        break;
      case "detached":
        if (current !== undefined) current.detached = true;
        break;
      case "prunable":
        if (current !== undefined) current.prunable = true;
        break;
      default:
        break;
    }
  }
  if (current !== undefined) entries.push(current);
  return entries;
};

export const createGitProbe = (git: Git): GitProbe => ({
  isBare: async (cwd) => {
    const outcome = await git(["rev-parse", "--is-bare-repository"], { cwd });
    if (outcome.kind !== "ran" || outcome.code !== 0) return undefined;
    return outcome.stdout.trim() === "true";
  },

  worktrees: async (cwd) => {
    const outcome = await git(["worktree", "list", "--porcelain"], { cwd });
    if (outcome.kind !== "ran" || outcome.code !== 0) return undefined;
    return parseWorktreePorcelain(outcome.stdout);
  },

  showToplevel: async (cwd) => {
    const outcome = await git(["rev-parse", "--show-toplevel"], { cwd });
    if (outcome.kind !== "ran" || outcome.code !== 0) return undefined;
    const path = outcome.stdout.trim();
    return path === "" ? undefined : path;
  },

  checkIgnore: async (cwd, path) => {
    const outcome = await git(["check-ignore", "-q", "--", path], { cwd });
    if (outcome.kind !== "ran") return "outside-repo";
    // 0 = ignored, 1 = not ignored, 128 = not a repo. Testing `!== 0` would
    // read "not ignored" out of "not a repo".
    if (outcome.code === 0) return "ignored";
    if (outcome.code === 1) return "not-ignored";
    return "outside-repo";
  },
});

export const createFsProbe = (): FsProbe => ({
  realpath: async (path) => {
    try {
      // macOS resolves /tmp through a symlink, so an unnormalised path and a
      // normalised one silently stop comparing equal.
      return await fsRealpath(path);
    } catch {
      return undefined;
    }
  },

  exists: async (path) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },

  listEntries: async (path) => {
    try {
      return await readdir(path);
    } catch {
      return undefined;
    }
  },
});

export const createProbes = (git: Git): Probes => ({
  git: createGitProbe(git),
  fs: createFsProbe(),
});
