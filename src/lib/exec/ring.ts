/**
 * Line ring buffer for command output.
 *
 * Provisioning commands (`pnpm install`, `bin/setup`) can print megabytes. The
 * screen only ever shows the tail, so we keep a bounded window in memory. The
 * full output goes to a log file — the ring is for display, never the archive.
 */

export type Ring = {
  /** Feed a raw chunk; partial lines are held until their newline arrives. */
  push: (chunk: string) => void;
  /** Complete lines kept, oldest first, plus any trailing partial line. */
  lines: () => string[];
  /** Lines seen since creation, including the ones dropped from the window. */
  totalLines: () => number;
};

export const createRing = (limit: number): Ring => {
  if (limit < 1)
    throw new RangeError(`ring limit must be >= 1, got ${String(limit)}`);

  const kept: string[] = [];
  let pending = "";
  let total = 0;

  const keep = (line: string): void => {
    kept.push(line);
    total += 1;
    if (kept.length > limit) kept.shift();
  };

  return {
    push: (chunk) => {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        keep(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    },
    lines: () => (pending === "" ? [...kept] : [...kept, pending]),
    totalLines: () => (pending === "" ? total : total + 1),
  };
};
