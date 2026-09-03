import { describe, expect, it } from 'vitest';
import {
  INFLATION_MAX,
  INFLATION_MIN,
  INFLATION_PERSISTENCE,
  INFLATION_SHOCK_SD,
  INFLATION_TARGET,
  applyInflationSpike,
  buildCpi,
  cpiAt,
  generateInflationPath,
  realValueCents,
} from '../src/inflation.ts';
import { stream } from '../src/rng.ts';
import { WEEKS_PER_YEAR } from '../src/time.ts';

const YEARS = 30;
const path = () => generateInflationPath(stream('4F2A9C1B', 'market'), YEARS);

describe('the AR(1) inflation path (TDD §3.6)', () => {
  it('starts at 2%', () => {
    expect(path().annualRate[0]).toBe(INFLATION_TARGET);
  });

  it('reverts toward target with the specified persistence and shock size', () => {
    const { annualRate } = path();
    for (let y = 1; y < YEARS; y++) {
      const reverted = INFLATION_TARGET + INFLATION_PERSISTENCE * (annualRate[y - 1] - INFLATION_TARGET);
      // Only the shock separates the realized rate from the reverted one, and a
      // shock beyond 6 sd would mean normal() is not standard normal.
      const shock = annualRate[y] - reverted;
      const atBound = annualRate[y] === INFLATION_MIN || annualRate[y] === INFLATION_MAX;
      if (!atBound) expect(Math.abs(shock / INFLATION_SHOCK_SD)).toBeLessThan(6);
    }
  });

  it('clamps every year into the band', () => {
    for (let i = 0; i < 200; i++) {
      const { annualRate } = generateInflationPath(stream(`S${i}`, 'market'), YEARS);
      for (const rate of annualRate) {
        expect(rate).toBeGreaterThanOrEqual(INFLATION_MIN);
        expect(rate).toBeLessThanOrEqual(INFLATION_MAX);
      }
    }
  });

  it('stays near target on average over many runs', () => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 500; i++) {
      for (const rate of generateInflationPath(stream(`S${i}`, 'market'), YEARS).annualRate) {
        sum += rate;
        count++;
      }
    }
    expect(sum / count).toBeGreaterThan(0.015);
    expect(sum / count).toBeLessThan(0.025);
  });

  it('is deterministic for a given stream', () => {
    expect([...path().annualRate]).toEqual([...path().annualRate]);
  });
});

describe('the CPI deflator (TDD §3.6)', () => {
  it('starts at 1.0 and compounds the prior year rate', () => {
    const { annualRate, cpi } = path();
    expect(cpi[0]).toBe(1);
    for (let y = 1; y <= YEARS; y++) {
      expect(cpi[y]).toBeCloseTo(cpi[y - 1] * (1 + annualRate[y - 1]), 12);
    }
  });

  it('is addressable at the final year boundary', () => {
    expect(path().cpi).toHaveLength(YEARS + 1);
  });

  it('resolves the deflator in force at a given week', () => {
    const p = path();
    expect(cpiAt(p, 0)).toBe(1);
    expect(cpiAt(p, WEEKS_PER_YEAR - 1)).toBe(p.cpi[0]);
    expect(cpiAt(p, WEEKS_PER_YEAR)).toBe(p.cpi[1]);
    expect(cpiAt(p, WEEKS_PER_YEAR * 5)).toBe(p.cpi[5]);
  });

  it('converts nominal cents to real cents, staying an integer', () => {
    expect(realValueCents(10_000, 1)).toBe(10_000);
    expect(realValueCents(10_000, 1.25)).toBe(8000);
    expect(Number.isInteger(realValueCents(123_457, 1.037))).toBe(true);
  });

  it('erodes purchasing power over a 30-year run', () => {
    const p = path();
    expect(p.cpi[YEARS]).toBeGreaterThan(1.2);
    expect(realValueCents(100_000, p.cpi[YEARS])).toBeLessThan(100_000);
  });

  it('builds the same deflator from a bare rate array', () => {
    const p = path();
    expect([...buildCpi(p.annualRate)]).toEqual([...p.cpi]);
  });
});

describe('inflation spike override (TDD §3.6, §9)', () => {
  it('rewrites one year and rebuilds every later deflator', () => {
    const original = path();
    const spiked = applyInflationSpike(original, 10, 0.07);

    expect(spiked.annualRate[10]).toBe(0.07);
    expect([...spiked.annualRate.slice(0, 10)]).toEqual([...original.annualRate.slice(0, 10)]);
    // Years before the spike are untouched; every year after it is lifted.
    for (let y = 0; y <= 10; y++) expect(spiked.cpi[y]).toBe(original.cpi[y]);
    for (let y = 11; y <= YEARS; y++) expect(spiked.cpi[y]).toBeGreaterThan(original.cpi[y]);
  });

  it('does not mutate the original path', () => {
    const original = path();
    const before = [...original.annualRate];
    applyInflationSpike(original, 5, 0.08);
    expect([...original.annualRate]).toEqual(before);
  });

  it('clamps an override into the band like any other year', () => {
    expect(applyInflationSpike(path(), 3, 0.5).annualRate[3]).toBe(INFLATION_MAX);
  });
});
