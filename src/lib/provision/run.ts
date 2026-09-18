import {
  appendFile,
  chmod,
  copyFile,
  cp,
  mkdir,
  stat,
  lstat,
  readlink,
  symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { run } from "../exec/run.js";
import { scrubEnv } from "../exec/env.js";
import { createRing } from "../exec/ring.js";
import { acquire, type LockHolder } from "./lock.js";
import type { WtConfig } from "../config/schema.js";
import {
  readState,
  shouldRun,
  statePath,
  writeState,
  type WorktreeState,
} from "./state.js";
import type { Git } from "../git/exec.js";

export type CopyReport = {
  path: string;
  outcome: "copied" | "skipped" | "missing" | "failed";
  detail?: string;
};

export type CommandReport = {
  run: string;
  outcome: "ran" | "skipped" | "failed" | "timed-out" | "interrupted";
  code?: number;
  tail?: readonly string[];
};

export type ProvisionReport = {
  copies: readonly CopyReport[];
  commands: readonly CommandReport[];
  ok: boolean;
  logPath?: string;
  /** Set when another wt was already provisioning this worktree. */
  blockedBy?: LockHolder;
};

export type ProvisionInput = {
  repoRoot: string;
  pid?: number;
  worktreePath: string;
  config: WtConfig;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** lstat, so a broken symlink counts as present and EEXIST never repeats. */
const present = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Preserves mode, and copies a symlink as a link. A relative link is rewritten
 * against its original directory: copied verbatim it would re-anchor on the
 * worktree and point at nothing.
 */
const copyEntry = async (
  from: string,
  to: string,
): Promise<CopyReport["outcome"]> => {
  const info = await lstat(from);
  await mkdir(dirname(to), { recursive: true });

  if (info.isSymbolicLink()) {
    const target = await readlink(from);
    await symlink(
      isAbsolute(target) ? target : resolve(dirname(from), target),
      to,
    );
    return "copied";
  }
  if (info.isDirectory()) {
    await cp(from, to, {
      recursive: true,
      preserveTimestamps: true,
      force: false,
    });
    return "copied";
  }
  await copyFile(from, to);
  await chmod(to, info.mode & 0o7777);
  return "copied";
};

export const provision = async (
  git: Git,
  input: ProvisionInput,
): Promise<ProvisionReport> => {
  const { config, worktreePath, repoRoot } = input;
  const path = await statePath(git, worktreePath);
  const logPath = path === undefined ? undefined : `${path}.log`;

  const lock =
    path === undefined
      ? undefined
      : await acquire(`${path}.lock`, input.pid ?? 0);
  if (lock?.kind === "taken") {
    return { copies: [], commands: [], ok: false, blockedBy: lock.by };
  }

  const state: WorktreeState =
    path === undefined
      ? { schema: 1, provision: { state: "ok", onceDone: [] } }
      : await readState(path);

  // Serialised, and the chain never rejects: fired-and-forgotten heartbeats
  // would otherwise land after the final write and leave the worktree marked
  // `running` forever, and one failed write would silence every later one.
  let writes: Promise<void> = Promise.resolve();
  const save = (next: WorktreeState): Promise<void> => {
    writes = writes
      .then(async () => {
        if (path !== undefined) await writeState(path, next);
      })
      .catch(() => undefined);
    return writes;
  };

  const copies: CopyReport[] = [];
  for (const relative of config.provision.copy) {
    const from = join(repoRoot, relative);
    const to = join(worktreePath, relative);

    if (!(await present(from))) {
      copies.push({ path: relative, outcome: "missing" });
      continue;
    }
    if (await present(to)) {
      copies.push({ path: relative, outcome: "skipped" });
      continue;
    }
    try {
      copies.push({ path: relative, outcome: await copyEntry(from, to) });
      input.onProgress?.(`copied ${relative}`);
    } catch (error) {
      copies.push({
        path: relative,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const childEnv = scrubEnv(input.env, {
    WT_WORKTREE: worktreePath,
    WT_REPO: repoRoot,
  });

  const onceDone = [...state.provision.onceDone];
  const commands: CommandReport[] = [];
  let ok = copies.every((entry) => entry.outcome !== "failed");

  for (const step of config.provision.commands) {
    if (!(await shouldRun(step.when, state, step.run, exists, worktreePath))) {
      commands.push({ run: step.run, outcome: "skipped" });
      continue;
    }

    await save({
      ...state,
      provision: {
        ...state.provision,
        state: "running",
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        onceDone,
      },
    });

    const heartbeat = setInterval(() => {
      void save({
        ...state,
        provision: {
          ...state.provision,
          state: "running",
          heartbeatAt: new Date().toISOString(),
          onceDone,
        },
      });
    }, 2_000);
    heartbeat.unref();

    const ring = createRing(200);
    // Chained rather than fired and forgotten: concurrent appendFile calls
    // interleave, so the log would not match what the command printed.
    let logged: Promise<void> = Promise.resolve();
    const append = (chunk: string): void => {
      ring.push(chunk);
      if (logPath === undefined) return;
      logged = logged.then(() => appendFile(logPath, chunk));
      logged.catch(() => undefined);
    };

    input.onProgress?.(`$ ${step.run}`);
    const result = await run({
      argv: ["/bin/sh", "-c", step.run],
      cwd: worktreePath,
      env: childEnv,
      timeoutMs: config.provision.timeoutMs,
      signal: input.signal,
      capture: false,
      killProcessGroup: true,
      onStdout: append,
      onStderr: append,
    });
    clearInterval(heartbeat);
    await logged.catch(() => undefined);

    if (result.kind === "ok" && result.outcome.aborted) {
      commands.push({
        run: step.run,
        outcome: "interrupted",
        tail: ring.lines().slice(-20),
      });
      ok = false;
      break;
    }
    if (result.kind === "error") {
      commands.push({ run: step.run, outcome: "failed", tail: ring.lines() });
      ok = false;
      break;
    }
    if (result.outcome.timedOut) {
      commands.push({
        run: step.run,
        outcome: "timed-out",
        tail: ring.lines(),
      });
      ok = false;
      break;
    }
    if (result.outcome.code !== 0) {
      commands.push({
        run: step.run,
        outcome: "failed",
        code: result.outcome.code ?? undefined,
        tail: ring.lines().slice(-20),
      });
      ok = false;
      break;
    }

    if (step.when === "once") onceDone.push(step.run);
    commands.push({ run: step.run, outcome: "ran" });
  }

  const stopped = commands.find(
    (entry) =>
      entry.outcome === "failed" ||
      entry.outcome === "timed-out" ||
      entry.outcome === "interrupted",
  );

  await save({
    ...state,
    provision: {
      state: ok
        ? "ok"
        : stopped?.outcome === "interrupted"
          ? "interrupted"
          : "failed",
      failedStep: stopped?.run,
      onceDone,
      startedAt: state.provision.startedAt,
      heartbeatAt: undefined,
    },
  });

  if (lock?.kind === "held") await lock.release();
  return { copies, commands, ok, logPath };
};
