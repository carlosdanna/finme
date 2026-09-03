import { describe, expect, it } from 'vitest';
import {
  ASSETS,
  ASSET_IDS,
  type AssetId,
  type AssetSeries,
  BOOM_DEPTH_MAX,
  BOOM_DEPTH_MIN,
  CRASH_DECLINE_WEEKS_MAX,
  CRASH_DECLINE_WEEKS_MIN,
  CRASH_DEPTH_MAX,
  CRASH_DEPTH_MIN,
  CRASH_RECOVERY_FACTOR,
  CRASH_RECOVERY_WEEKS_MAX,
  CRASH_RECOVERY_WEEKS_MIN,
  MIN_EPISODE_SEPARATION_YEARS,
  STARTING_PRICE_CENTS,
  annualLogDrift,
  dividendPaymentCents,
  generateMarket,
  generateMarketFrom,
  isDividendWeek,
} from '../src/market.ts';
import { type Rng, stream } from '../src/rng.ts';
import { WEEKS_PER_YEAR, isQuarterBoundary, totalWeeks } from '../src/time.ts';

const SEED = '4F2A9C1B';
const YEARS = 30;

function bytes(array: Float64Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

describe('determinism (TDD §3, GDD §13)', () => {
  it('produces a byte-identical price series for the same seed', () => {
    const a = generateMarket(SEED, YEARS);
    const b = generateMarket(SEED, YEARS);

    for (const id of ASSET_IDS) {
      expect(bytes(a.series[id].priceCents)).toEqual(bytes(b.series[id].priceCents));
      expect(bytes(a.series[id].logPrice)).toEqual(bytes(b.series[id].logPrice));
      expect(bytes(a.series[id].baseLogPrice)).toEqual(bytes(b.series[id].baseLogPrice));
    }
    expect(bytes(a.inflation.annualRate)).toEqual(bytes(b.inflation.annualRate));
    expect(bytes(a.inflation.cpi)).toEqual(bytes(b.inflation.cpi));
    expect(a.episodes).toEqual(b.episodes);
  });

  it('produces a different world for a different seed', () => {
    const a = generateMarket('4F2A9C1B', YEARS);
    const b = generateMarket('4F2A9C1C', YEARS);
    for (const id of ASSET_IDS) {
      expect(bytes(a.series[id].priceCents)).not.toEqual(bytes(b.series[id].priceCents));
    }
  });

  it('consumes the market stream entirely during initialization', () => {
    let draws = 0;
    const real = stream(SEED, 'market');
    const rng: Rng = () => {
      draws++;
      return real();
    };

    const history = generateMarketFrom(rng, SEED, YEARS);
    const drawsAtInit = draws;
    expect(drawsAtInit).toBeGreaterThan(0);

    // Touching every materialized field must not roll a single further die.
    for (const id of ASSET_IDS) {
      void history.series[id].priceCents[history.weeks - 1];
      void history.series[id].logPrice[0];
    }
    void history.inflation.cpi[YEARS];
    void history.episodes.length;
    void dividendPaymentCents(history, 'SAFE', 100, 13);

    expect(draws).toBe(drawsAtInit);
  });

  it('draws assets in a stable order, so appending an asset cannot shift the others', () => {
    // Asset-major consumption is what makes this true. Guard the order itself.
    expect([...ASSET_IDS]).toEqual(['BOND', 'SAFE', 'BLUE', 'MOON', 'CRYP']);
  });
});

describe('base price process (TDD §3.2)', () => {
  it('starts every asset at an index value of 100.00', () => {
    const history = generateMarket(SEED, YEARS);
    for (const id of ASSET_IDS) {
      expect(history.series[id].priceCents[0]).toBe(STARTING_PRICE_CENTS);
      expect(history.series[id].logPrice[0]).toBe(Math.log(100));
    }
  });

  it('stores prices as integer cents, never float dollars', () => {
    const history = generateMarket(SEED, YEARS);
    for (const id of ASSET_IDS) {
      for (const price of history.series[id].priceCents) {
        expect(Number.isInteger(price)).toBe(true);
        expect(Number.isFinite(price)).toBe(true);
      }
    }
  });

  it('covers exactly one price point per week of the run', () => {
    for (const years of [10, 30, 50]) {
      const history = generateMarket(SEED, years);
      expect(history.weeks).toBe(totalWeeks(years));
      for (const id of ASSET_IDS) {
        expect(history.series[id].priceCents).toHaveLength(totalWeeks(years));
      }
    }
  });

  it('computes mu_log as ln(1 + mu) - sigma^2/2, matching the §3.3 table', () => {
    const published: Record<AssetId, number> = {
      BOND: -0.0008,
      SAFE: 0.0379,
      BLUE: 0.0198,
      MOON: -0.043,
      CRYP: -0.2058,
    };
    for (const id of ASSET_IDS) {
      expect(annualLogDrift(ASSETS[id])).toBeCloseTo(published[id], 4);
    }
  });

  it('keeps MOON below the drift where speculation would stop losing', () => {
    // §3.3: "at mu_log > 0 the game starts rewarding gambling."
    expect(annualLogDrift(ASSETS.MOON)).toBeLessThan(0);
    expect(annualLogDrift(ASSETS.CRYP)).toBeLessThan(0);
    expect(ASSETS.MOON.drift).toBeLessThanOrEqual(0.09);
  });

  it('steps the base path by mu_w + sigma_w*Z with no overlay applied', () => {
    const history = generateMarket(SEED, YEARS);
    for (const id of ASSET_IDS) {
      const { baseLogPrice } = history.series[id];
      const muWeekly = annualLogDrift(ASSETS[id]) / WEEKS_PER_YEAR;
      const sigmaWeekly = ASSETS[id].volatility / Math.sqrt(WEEKS_PER_YEAR);

      // Every step must be explainable as drift plus a plausible normal shock.
      for (let t = 1; t < 200; t++) {
        const z = (baseLogPrice[t] - baseLogPrice[t - 1] - muWeekly) / sigmaWeekly;
        expect(Math.abs(z)).toBeLessThan(6);
      }
    }
  });
});

describe('regime overlay (TDD §3.4)', () => {
  const history = generateMarket(SEED, YEARS);

  it('draws crash and boom shapes inside their specified ranges', () => {
    for (const episode of history.episodes) {
      expect(episode.declineWeeks).toBeGreaterThanOrEqual(CRASH_DECLINE_WEEKS_MIN);
      expect(episode.declineWeeks).toBeLessThanOrEqual(CRASH_DECLINE_WEEKS_MAX);

      if (episode.kind === 'crash') {
        expect(episode.depth).toBeGreaterThanOrEqual(CRASH_DEPTH_MIN);
        expect(episode.depth).toBeLessThan(CRASH_DEPTH_MAX);
        expect(episode.recoveryWeeks).toBeGreaterThanOrEqual(CRASH_RECOVERY_WEEKS_MIN);
        expect(episode.recoveryWeeks).toBeLessThanOrEqual(CRASH_RECOVERY_WEEKS_MAX);
      } else {
        expect(episode.depth).toBeGreaterThanOrEqual(BOOM_DEPTH_MIN);
        expect(episode.depth).toBeLessThan(BOOM_DEPTH_MAX);
        expect(episode.recoveryWeeks).toBe(0); // booms have no recovery phase
      }
    }
  });

  it('keeps episodes of the same kind at least 3 years apart', () => {
    for (const kind of ['crash', 'boom'] as const) {
      const starts = history.episodes.filter((e) => e.kind === kind).map((e) => e.startWeek);
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(
          MIN_EPISODE_SEPARATION_YEARS * WEEKS_PER_YEAR,
        );
      }
    }
  });

  it('applies the full log decline over the decline phase, scaled by beta', () => {
    const crash = firstIsolatedCrash();
    const logMove = Math.log(1 - crash.depth);

    for (const id of ASSET_IDS) {
      // overlay[t] applies to the step *into* week t, so the decline phase spans
      // the transitions from startWeek-1 through startWeek+declineWeeks-1.
      const applied = overlayBetween(history.series[id], crash.startWeek - 1, crash.startWeek + crash.declineWeeks - 1);
      expect(applied).toBeCloseTo(ASSETS[id].regimeBeta * logMove, 10);
    }
  });

  it('recovers only CRASH_RECOVERY_FACTOR of the decline, leaving the rest to drift', () => {
    const crash = firstIsolatedCrash();
    const logMove = Math.log(1 - crash.depth);

    const applied = overlayBetween(
      history.series.SAFE,
      crash.startWeek - 1,
      crash.startWeek + crash.declineWeeks + crash.recoveryWeeks - 1,
    );

    expect(applied).toBeCloseTo((1 - CRASH_RECOVERY_FACTOR) * logMove, 10);
    expect(applied).toBeLessThan(0); // a crash is not undone by the overlay alone
  });

  it('moves bonds the opposite way from equities during a crash', () => {
    const crash = firstIsolatedCrash();
    const overlayFor = (id: AssetId) =>
      overlayBetween(history.series[id], crash.startWeek - 1, crash.startWeek + crash.declineWeeks - 1);

    expect(overlayFor('SAFE')).toBeLessThan(0);
    expect(overlayFor('BOND')).toBeGreaterThan(0); // flight to quality
    // Higher beta means a harder fall.
    expect(overlayFor('CRYP')).toBeLessThan(overlayFor('MOON'));
    expect(overlayFor('MOON')).toBeLessThan(overlayFor('SAFE'));
  });

  /**
   * The overlay is exactly the gap between the overlaid and base log paths, so
   * it can be measured without re-deriving it.
   */
  function overlayBetween(series: AssetSeries, from: number, to: number): number {
    return (
      series.logPrice[to] - series.logPrice[from] - (series.baseLogPrice[to] - series.baseLogPrice[from])
    );
  }

  /** A crash whose decline and recovery are not overlapped by another episode. */
  function firstIsolatedCrash() {
    const crash = history.episodes.find((e) => {
      if (e.kind !== 'crash' || e.startWeek < 1) return false;
      const end = e.startWeek + e.declineWeeks + e.recoveryWeeks;
      return (
        end < history.weeks &&
        history.episodes.every(
          (other) =>
            other === e ||
            other.startWeek >= end ||
            other.startWeek + other.declineWeeks + other.recoveryWeeks <= e.startWeek,
        )
      );
    });
    expect(crash).toBeDefined();
    return crash!;
  }
});

describe('dividends (TDD §3.5)', () => {
  const history = generateMarket(SEED, YEARS);

  it('pays at quarter boundaries', () => {
    for (let w = 1; w < WEEKS_PER_YEAR * 2; w++) {
      expect(isDividendWeek(w)).toBe(isQuarterBoundary(w));
    }
    expect(isDividendWeek(13)).toBe(true);
    expect(isDividendWeek(14)).toBe(false);
  });

  it('pays nothing on week 0, where nothing has been held yet', () => {
    expect(isDividendWeek(0)).toBe(false);
    expect(dividendPaymentCents(history, 'SAFE', 1000, 0)).toBe(0);
  });

  it('pays shares * price * (annualYield / 4), in integer cents', () => {
    const shares = 137;
    const week = 26;
    const price = history.series.SAFE.priceCents[week];
    const expected = Math.round((shares * price * ASSETS.SAFE.dividendYield) / 4);

    const paid = dividendPaymentCents(history, 'SAFE', shares, week);
    expect(paid).toBe(expected);
    expect(Number.isInteger(paid)).toBe(true);
  });

  it('pays nothing on the assets with no dividend', () => {
    for (const id of ['MOON', 'CRYP'] as const) {
      expect(ASSETS[id].dividendYield).toBe(0);
      expect(dividendPaymentCents(history, id, 1000, 26)).toBe(0);
    }
  });

  it('pays four times a year after the first week', () => {
    let payingWeeks = 0;
    for (let w = 0; w < WEEKS_PER_YEAR * 3; w++) if (isDividendWeek(w)) payingWeeks++;
    expect(payingWeeks).toBe(11); // 12 quarter boundaries in 3 years, less week 0
  });
});
