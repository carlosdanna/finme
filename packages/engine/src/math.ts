/** Small numeric helpers shared across the engine. */

/** Constrain `value` to [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * The median of a numeric sample. Sorts a copy, so the caller's array is left
 * alone. Even-length samples average the two middle values.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
