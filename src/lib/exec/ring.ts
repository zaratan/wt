/** A bounded tail of a command's output, for display. The archive is the log file. */
export type Ring = {
  push: (chunk: string) => void;
  lines: () => string[];
  totalLines: () => number;
};

export const createRing = (limit: number): Ring => {
  if (limit < 1)
    throw new RangeError(`ring limit must be >= 1, got ${String(limit)}`);

  const kept: string[] = [];
  let pending = "";
  let total = 0;

  const afterLastRedraw = (line: string): string =>
    line.slice(line.lastIndexOf("\r") + 1);

  const keep = (line: string): void => {
    kept.push(afterLastRedraw(line));
    total += 1;
    if (kept.length > limit) kept.shift();
  };

  return {
    push: (chunk) => {
      // A carriage return redraws a line rather than starting a new one, so
      // only what a terminal would still show is kept. Without this a progress
      // bar grows without bound: `pnpm install` alone emits thousands.
      pending += chunk.replace(/\r\n/g, "\n");
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        keep(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
      const redraw = pending.lastIndexOf("\r");
      if (redraw !== -1) pending = pending.slice(redraw + 1);
    },
    lines: () => (pending === "" ? [...kept] : [...kept, pending]),
    totalLines: () => (pending === "" ? total : total + 1),
  };
};
