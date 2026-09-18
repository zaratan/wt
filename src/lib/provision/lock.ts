import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { HEARTBEAT_STALE_MS } from "./state.js";

export type LockHolder = { pid: number; since: string };

export type Lock =
  | { kind: "held"; release: () => Promise<void> }
  | { kind: "taken"; by: LockHolder };

const readHolder = async (path: string): Promise<LockHolder | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as LockHolder;
    return typeof parsed.pid === "number" ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const alive = (pid: number): boolean => {
  // Signal 0 on pid 0 targets our own process group, which would read as
  // "someone else holds it" forever.
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const stale = (holder: LockHolder): boolean => {
  if (!alive(holder.pid)) return true;
  const since = Date.parse(holder.since);
  return Number.isNaN(since) || Date.now() - since > HEARTBEAT_STALE_MS * 60;
};

/**
 * Written first, then linked into place. `open(path, "wx")` would publish an
 * empty file and only then fill it, and a rival acquiring in that window reads
 * no holder, calls the lock garbage and steals it — both runs then proceed.
 */
const write = async (path: string, pid: number): Promise<Lock | undefined> => {
  // Random, not pid+timestamp: two acquirers in the same millisecond would
  // otherwise share a staging file and each destroy the other's.
  const staging = `${path}.${randomUUID()}`;
  try {
    await writeFile(
      staging,
      JSON.stringify({ pid, since: new Date().toISOString() }),
      { flag: "wx" },
    );
    await link(staging, path);
    return {
      kind: "held",
      release: async () => {
        await unlink(path).catch(() => undefined);
      },
    };
  } catch {
    return undefined;
  } finally {
    await unlink(staging).catch(() => undefined);
  }
};

/**
 * O_EXCL on a file beside the worktree state. A holder whose process is gone
 * is cleared: a machine that lost power must not need manual repair, and pid
 * reuse is covered by the timestamp.
 */
export const acquire = async (path: string, pid: number): Promise<Lock> => {
  const first = await write(path, pid);
  if (first !== undefined) return first;

  const holder = await readHolder(path);
  if (holder !== undefined && !stale(holder)) {
    return { kind: "taken", by: holder };
  }

  await unlink(path).catch(() => undefined);
  const second = await write(path, pid);
  return second ?? { kind: "taken", by: holder ?? { pid: 0, since: "" } };
};
