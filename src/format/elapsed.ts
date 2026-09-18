/** Coarse on purpose: a clock that ticks is the point, not the precision. */
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} min ${String(seconds % 60)} s`;
};
