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
