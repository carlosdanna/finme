import { describe, expect, it } from 'vitest';
import { generateMarket } from '@finme/engine';
import { CAREERS, CURVE_REDUCED, CURVE_SPEC, runCareer } from './wages.ts';
import { runHousing } from './housing.ts';

/**
 * Smoke tests. These probes are diagnostic instruments for the open tuning
 * questions in DECISIONS.md, not balance gates — they are here so a refactor
 * cannot silently break them before those questions are settled.
 */
describe('wage probe', () => {
  it('ranks careers the way the model implies', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `W${i}`);
    const median = (id: string) => {
      const spec = CAREERS.find((c) => c.id === id)!;
      const values = seeds.map((s) => runCareer(s, spec).realMultiple).sort((a, b) => a - b);
      return values[20];
    };

    expect(median('hop-3')).toBeGreaterThan(median('hop-5'));
    expect(median('hop-5')).toBeGreaterThan(median('stay-avg'));
    expect(median('stay-strong')).toBeGreaterThan(median('stay-avg'));
    expect(median('stay-avg')).toBeGreaterThan(median('stay-weak'));
  });

  it('erodes real income for a weak performer but not an average one', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `W${i}`);
    const median = (id: string) => {
      const spec = CAREERS.find((c) => c.id === id)!;
      const values = seeds.map((s) => runCareer(s, spec).realMultiple).sort((a, b) => a - b);
      return values[20];
    };
    expect(median('stay-weak')).toBeLessThan(1);
    expect(median('stay-avg')).toBeGreaterThan(1);
  });

  it('erodes an average performer under the proposed reduced curve', () => {
    const spec = { ...CAREERS[0], curve: CURVE_REDUCED };
    const seeds = Array.from({ length: 40 }, (_, i) => `W${i}`);
    const values = seeds.map((s) => runCareer(s, spec).realMultiple).sort((a, b) => a - b);
    expect(values[20]).toBeLessThan(1);
    expect(CURVE_SPEC(25)).toBeGreaterThan(CURVE_REDUCED(25));
  });
});

describe('housing probe', () => {
  it('makes buying worse as the mortgage rate rises', () => {
    const history = generateMarket('H0', 30);
    const gapAt = (apr: number) => {
      const outcome = runHousing(history, apr, [30]).get(30)!;
      return outcome.buyerSoldCents - outcome.renterCents;
    };
    expect(gapAt(0.05)).toBeGreaterThan(gapAt(0.065));
    expect(gapAt(0.065)).toBeGreaterThan(gapAt(0.075));
  });

  it('costs the buyer the 6% transaction fee to realize', () => {
    const history = generateMarket('H0', 30);
    const outcome = runHousing(history, 0.065, [10]).get(10)!;
    expect(outcome.buyerHeldCents).toBeGreaterThan(outcome.buyerSoldCents);
    for (const value of Object.values(outcome)) expect(Number.isFinite(value)).toBe(true);
  });
});
