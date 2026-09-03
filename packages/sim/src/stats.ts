/** Distribution summaries for balance-test reporting. */

/**
 * Percentile by linear interpolation between order statistics.
 * `p` is a fraction: 0.5 is the median.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface Distribution {
  readonly n: number;
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
  readonly max: number;
}

export function describe(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

/** Format integer cents as a currency string, e.g. `$1,234,567`. */
export function formatCents(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}
