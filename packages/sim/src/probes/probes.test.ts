import { describe, expect, it } from 'vitest';
import { generateMarket, loanApr } from '@finme/engine';
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

  it('holds §8.2\'s design goal at the chosen rent level', () => {
    // "Genuinely non-obvious over short horizons and clearly favourable over
    // long ones." This is the property HOME_PRICE_TO_RENT was chosen to produce,
    // so it is guarded rather than left as a note. If it fails, re-run
    // `pnpm -F @finme/sim housing` before touching anything.
    //
    // 250 seeds: the buyer-vs-renter gap is very widely dispersed, because the
    // renter's portfolio rides SAFE for 30 years. A 60-seed median moves by six
    // figures on sampling noise alone.
    const seeds = Array.from({ length: 250 }, (_, i) => `H${i}`);
    const histories = seeds.map((seed) => generateMarket(seed, 30));
    const medianGap = (apr: number, horizon: number) => {
      const gaps = histories
        .map((history) => {
          const outcome = runHousing(history, apr, [horizon]).get(horizon)!;
          return outcome.buyerSoldCents - outcome.renterCents;
        })
        .sort((a, b) => a - b);
      return gaps[125];
    };

    const best = loanApr('mortgage', 850); // 5.5%
    const thin = loanApr('mortgage', null); // 7.5%

    // Non-obvious early: even the best rate is behind at five years.
    expect(medianGap(best, 5)).toBeLessThan(0);
    // Clearly favourable late, for a borrower with the credit to earn the rate.
    expect(medianGap(best, 30)).toBeGreaterThan(5_000_000); // over $50k
    // And a thin file never gets there — which is what ties the housing
    // decision to the credit system, with no special-casing.
    expect(medianGap(thin, 30)).toBeLessThan(0);
    expect(medianGap(best, 30)).toBeGreaterThan(medianGap(thin, 30));
  }, 60_000);

  it('costs the buyer the 6% transaction fee to realize', () => {
    const history = generateMarket('H0', 30);
    const outcome = runHousing(history, 0.065, [10]).get(10)!;
    expect(outcome.buyerHeldCents).toBeGreaterThan(outcome.buyerSoldCents);
    for (const value of Object.values(outcome)) expect(Number.isFinite(value)).toBe(true);
  });
});
