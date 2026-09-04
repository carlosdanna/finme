import { describe, expect, it } from 'vitest';
import {
  EPILOGUE_PATHS,
  EPILOGUE_TARGET_AGE,
  marketLoading,
  normalizedWeights,
  projectEpilogue,
} from '../src/epilogue.ts';
import { stream } from '../src/rng.ts';

// Seeded here so the tests are reproducible. In the game §12 passes
// `Math.random`, deliberately — the engine never calls it itself.
const rng = () => stream('4F2A9C1B', 'flavor');

const base = {
  startingWealthCents: 5_000_000,
  annualContributionCents: 600_000,
  endAge: 52,
  weights: { SAFE: 1 },
  finalCpi: 1.8,
};

describe('the epilogue projection (TDD §12)', () => {
  it('projects to 65 and orders the percentiles', () => {
    const projection = projectEpilogue(base, rng());

    expect(projection.years).toBe(EPILOGUE_TARGET_AGE - base.endAge);
    expect(projection.paths).toBe(EPILOGUE_PATHS);
    expect(projection.bands).toHaveLength(projection.years);
    expect(projection.bands.at(-1)?.age).toBe(EPILOGUE_TARGET_AGE);

    for (const band of projection.bands) {
      expect(band.p10Cents).toBeLessThanOrEqual(band.p50Cents);
      expect(band.p50Cents).toBeLessThanOrEqual(band.p90Cents);
    }
  });

  it('never calls Math.random itself — the rng is a parameter', () => {
    // §12 says use Math.random; CLAUDE.md bans it in the engine. Both hold
    // because the caller supplies it. A seeded stream must be reproducible.
    const a = projectEpilogue(base, rng());
    const b = projectEpilogue(base, rng());
    expect(b.p50Cents).toBe(a.p50Cents);
    expect(b.bands).toEqual(a.bands);
  });

  it('deflates the cash counterfactual at 2% a year', () => {
    const idle = projectEpilogue({ ...base, annualContributionCents: 0 }, rng());
    // No contributions, so cash only loses ground.
    expect(idle.allCashCents).toBeLessThan(base.startingWealthCents);
    const expected = base.startingWealthCents * Math.pow(0.98, idle.years);
    expect(idle.allCashCents).toBeCloseTo(expected, -3);
  });

  it('beats cash in the median for a diversified allocation', () => {
    // The gap between these two numbers is the most important output the game
    // produces. It is reported, never editorialized.
    const projection = projectEpilogue({ ...base, weights: { SAFE: 0.6, BOND: 0.4 } }, rng());
    expect(projection.p50Cents).toBeGreaterThan(projection.allCashCents);
  });

  it('keeps a speculative allocation wide and cash-like in the median', () => {
    const safe = projectEpilogue({ ...base, weights: { SAFE: 1 } }, rng());
    const cryp = projectEpilogue({ ...base, weights: { CRYP: 1 } }, rng());

    // Far wider spread, and a much worse middle — the §3.3 property surviving
    // into the projection.
    const spread = (p: { p90Cents: number; p10Cents: number }) => p.p90Cents / Math.max(1, p.p10Cents);
    expect(spread(cryp)).toBeGreaterThan(spread(safe));
    expect(cryp.p50Cents).toBeLessThan(safe.p50Cents);
  });

  it('reports real terms as the nominal figure deflated by final CPI', () => {
    const projection = projectEpilogue(base, rng());
    expect(projection.realP50Cents).toBe(Math.round(projection.p50Cents / base.finalCpi));
    expect(projection.realP50Cents).toBeLessThan(projection.p50Cents);
  });

  it('loads assets on the shared market factor by their regime beta', () => {
    // Bonds load negative — the flight to quality the market model produces.
    expect(marketLoading('BOND')).toBeLessThan(0);
    expect(marketLoading('SAFE')).toBeGreaterThan(0);
    expect(marketLoading('CRYP')).toBeGreaterThan(marketLoading('MOON'));
    expect(marketLoading('CRYP')).toBeLessThanOrEqual(1);
  });

  it('normalizes an allocation to weights summing to one', () => {
    const weights = normalizedWeights({ SAFE: 3, BOND: 1 });
    expect(weights.SAFE).toBeCloseTo(0.75, 10);
    expect(weights.BOND).toBeCloseTo(0.25, 10);
    expect(weights.MOON).toBe(0);

    // An empty allocation is all cash, not a divide by zero.
    const empty = normalizedWeights({});
    expect(Object.values(empty).every((w) => w === 0)).toBe(true);
  });

  it('handles a player who finished at or past the target age', () => {
    const done = projectEpilogue({ ...base, endAge: 65 }, rng());
    expect(done.years).toBe(0);
    expect(done.bands).toEqual([]);
    expect(done.p50Cents).toBe(base.startingWealthCents);
  });

  it('runs fast enough to sit at the end of a run', () => {
    // §12 requires it in-browser at run end. `Date.now` rather than
    // `performance.now`: the engine's tsconfig has no DOM lib, and performance
    // is a host global — the purity guard rejects it, correctly.
    const started = Date.now();
    projectEpilogue({ ...base, endAge: 25, weights: { SAFE: 0.6, BOND: 0.4 } }, rng());
    expect(Date.now() - started).toBeLessThan(500);
  });
});
