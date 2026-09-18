import { readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { okStdout, type Git } from "../git/exec.js";

export type ProvisionState =
  | "never"
  | "ok"
  | "failed"
  | "running"
  | "interrupted";

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

/** What a worktree with no readable state really is, for anything but `shouldRun`. */
export const NEVER_STATE: WorktreeState = {
  schema: 1,
  provision: { state: "never", onceDone: [] },
};

/**
 * One file per worktree, inside the worktree's own git dir. `git worktree
 * remove` and `git worktree prune` are then the garbage collector, and two wt
 * runs never write the same file.
 */
export const statePath = async (
  git: Git,
  worktreePath: string,
): Promise<string | undefined> => {
  const answer = okStdout(
    await git(["rev-parse", "--git-path", "wt.json"], { cwd: worktreePath }),
  );
  if (answer === undefined) return undefined;
  return isAbsolute(answer) ? answer : resolve(worktreePath, answer);
};

/** Older than this with no heartbeat means the run was killed, not running. */
export const HEARTBEAT_STALE_MS = 10_000;

export type StateRead =
  | { kind: "read"; state: WorktreeState }
  /** No file, or one we could not parse: never guess that provisioning ran. */
  | { kind: "absent" };

export const loadState = async (path: string): Promise<StateRead> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as WorktreeState;
    if (parsed.provision.state !== "running")
      return { kind: "read", state: parsed };

    const beat = Date.parse(parsed.provision.heartbeatAt ?? "");
    const stale = Number.isNaN(beat) || Date.now() - beat > HEARTBEAT_STALE_MS;
    return {
      kind: "read",
      state: stale
        ? {
            ...parsed,
            provision: { ...parsed.provision, state: "interrupted" },
          }
        : parsed,
    };
  } catch {
    return { kind: "absent" };
  }
};

export const readState = async (path: string): Promise<WorktreeState> => {
  const loaded = await loadState(path);
  return loaded.kind === "read" ? loaded.state : EMPTY_STATE;
};

export const writeState = async (
  path: string,
  state: WorktreeState,
): Promise<boolean> => {
  try {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, path);
    return true;
  } catch {
    return false;
  }
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

/** Keeps `--as` and the layout so `wt open` rebuilds the same space later. */
export const rememberCreation = async (
  git: Git,
  worktreePath: string,
  fields: { as?: string; layout?: string },
): Promise<void> => {
  const path = await statePath(git, worktreePath);
  if (path === undefined) return;
  const loaded = await loadState(path);
  const current = loaded.kind === "read" ? loaded.state : EMPTY_STATE;
  await writeState(path, {
    ...current,
    as: fields.as ?? current.as,
    layout: fields.layout ?? current.layout,
    createdAt: current.createdAt ?? new Date().toISOString(),
    provision:
      loaded.kind === "read"
        ? current.provision
        : { ...current.provision, state: "never" },
  });
};

export const readCreation = async (
  git: Git,
  worktreePath: string,
): Promise<WorktreeState> => {
  const path = await statePath(git, worktreePath);
  if (path === undefined) return NEVER_STATE;
  const loaded = await loadState(path);
  return loaded.kind === "read" ? loaded.state : NEVER_STATE;
};
