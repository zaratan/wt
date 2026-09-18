import { readFile, rename, writeFile } from "node:fs/promises";
import { okStdout, type Git } from "../git/exec.js";

export type ProvisionState = "ok" | "failed" | "running" | "interrupted";

export type WorktreeState = {
  schema: 1;
  as?: string;
  layout?: string;
  createdAt?: string;
  provision: {
    state: ProvisionState;
    failedStep?: string;
    onceDone: readonly string[];
    startedAt?: string;
    heartbeatAt?: string;
  };
};

export const EMPTY_STATE: WorktreeState = {
  schema: 1,
  provision: { state: "ok", onceDone: [] },
};

/**
 * One file per worktree, inside the worktree's own git dir. `git worktree
 * remove` and `git worktree prune` are then the garbage collector, and two wt
 * runs never write the same file.
 */
export const statePath = async (
  git: Git,
  worktreePath: string,
): Promise<string | undefined> =>
  okStdout(
    await git(["rev-parse", "--git-path", "wt.json"], { cwd: worktreePath }),
  );

/** Older than this with no heartbeat means the run was killed, not running. */
export const HEARTBEAT_STALE_MS = 10_000;

export const readState = async (path: string): Promise<WorktreeState> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as WorktreeState;
    if (parsed.provision.state !== "running") return parsed;

    const beat = Date.parse(parsed.provision.heartbeatAt ?? "");
    const stale = Number.isNaN(beat) || Date.now() - beat > HEARTBEAT_STALE_MS;
    return stale
      ? { ...parsed, provision: { ...parsed.provision, state: "interrupted" } }
      : parsed;
  } catch {
    return EMPTY_STATE;
  }
};

export const writeState = async (
  path: string,
  state: WorktreeState,
): Promise<void> => {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, path);
};

/**
 * A step is skipped only when it previously SUCCEEDED. Otherwise a killed
 * `pnpm install` leaves a partial node_modules that `if-missing:` reads as
 * success, and the failure becomes permanent.
 */
export const shouldRun = async (
  when: string,
  state: WorktreeState,
  run: string,
  exists: (path: string) => Promise<boolean>,
  worktreePath: string,
): Promise<boolean> => {
  const lastRunSucceeded = state.provision.state === "ok";

  if (when === "once") {
    return !(lastRunSucceeded && state.provision.onceDone.includes(run));
  }
  if (when.startsWith("if-missing:")) {
    if (!lastRunSucceeded) return true;
    return !(await exists(
      `${worktreePath}/${when.slice("if-missing:".length)}`,
    ));
  }
  return true;
};
