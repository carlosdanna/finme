/**
 * Inflation — TDD §3.6.
 *
 * The whole path is drawn once, annually, at init from the `market` stream and
 * materialized. Nothing here rolls a die during play.
 *
 * Inflation is applied to fixed expenses, tax brackets, wage floors, tuition and
 * event magnitudes — and deliberately *not* to existing fixed-rate debt, which
 * is why inflation quietly helps a fixed-rate borrower.
 */
import { clamp } from './math.ts';
import { type Rng, normal } from './rng.ts';
import { yearIndex } from './time.ts';

/** [T] Long-run anchor the AR(1) process reverts toward. */
export const INFLATION_TARGET = 0.02;

/** [T] AR(1) persistence. */
export const INFLATION_PERSISTENCE = 0.6;

/** [T] Annual shock standard deviation. */
export const INFLATION_SHOCK_SD = 0.008;

/** [T] The path is clamped to this band every year. */
export const INFLATION_MIN = -0.005;
export const INFLATION_MAX = 0.09;

/** [T] MKT_INFLATION_SPIKE (§9) overrides a year's rate into this range. */
export const INFLATION_SPIKE_MIN = 0.05;
export const INFLATION_SPIKE_MAX = 0.08;

export interface InflationPath {
  /** i[y] — the inflation rate realized during year y. Length: runLengthYears. */
  readonly annualRate: Float64Array;
  /**
   * CPI[y] — the cumulative deflator at the *start* of year y, CPI[0] = 1.
   * Length is runLengthYears + 1, so the final year boundary is addressable.
   */
  readonly cpi: Float64Array;
}

/**
 * Draw the AR(1) inflation path.
 *
 * i[0] is fixed at 2%, so the first shock is drawn for year 1. This consumes
 * exactly `2 * (years - 1)` draws — `normal()` takes two apiece.
 */
export function generateInflationPath(rng: Rng, runLengthYears: number): InflationPath {
  const annualRate = new Float64Array(runLengthYears);
  annualRate[0] = INFLATION_TARGET;

  for (let y = 1; y < runLengthYears; y++) {
    const reverted = INFLATION_TARGET + INFLATION_PERSISTENCE * (annualRate[y - 1] - INFLATION_TARGET);
    const shocked = reverted + INFLATION_SHOCK_SD * normal(rng);
    annualRate[y] = clamp(shocked, INFLATION_MIN, INFLATION_MAX);
  }

  return { annualRate, cpi: buildCpi(annualRate) };
}

/**
 * CPI[0] = 1; CPI[y] = CPI[y-1] * (1 + i[y-1]).
 *
 * Exported because an inflation spike event rewrites a year's rate mid-run and
 * the deflator has to be rebuilt from it forward.
 */
export function buildCpi(annualRate: Float64Array | readonly number[]): Float64Array {
  const years = annualRate.length;
  const cpi = new Float64Array(years + 1);
  cpi[0] = 1;
  for (let y = 1; y <= years; y++) {
    cpi[y] = cpi[y - 1] * (1 + annualRate[y - 1]);
  }
  return cpi;
}

/**
 * Return a new path with year `year`'s rate overridden — MKT_INFLATION_SPIKE
 * (TDD §3.6, §9). The original is not mutated, and the deflator is rebuilt so
 * every later year reflects the spike.
 *
 * The spike rate comes from the event's own stream, not from `market`: the
 * market stream is fully consumed at init and never touched again.
 */
export function applyInflationSpike(
  path: InflationPath,
  year: number,
  rate: number,
): InflationPath {
  const annualRate = Float64Array.from(path.annualRate);
  annualRate[year] = clamp(rate, INFLATION_MIN, INFLATION_MAX);
  return { annualRate, cpi: buildCpi(annualRate) };
}

/** The deflator in force at a given week. */
export function cpiAt(path: InflationPath, weekIndex: number): number {
  return path.cpi[Math.min(yearIndex(weekIndex), path.cpi.length - 1)];
}

/**
 * Convert nominal cents to year-0 cents. Returns integer cents — real values are
 * money and money is never a float.
 */
export function realValueCents(nominalCents: number, cpi: number): number {
  return Math.round(nominalCents / cpi);
}
