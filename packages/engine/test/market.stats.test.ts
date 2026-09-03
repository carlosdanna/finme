import { describe, expect, it } from 'vitest';
import { ASSETS, ASSET_IDS, type AssetId, annualLogDrift, generateMarket } from '../src/market.ts';
import { median } from '../src/math.ts';

const YEARS = 30;

/**
 * These are seeded, so they are deterministic — not flaky. They are slow only
 * because they generate thousands of full runs.
 */
const SLOW = { timeout: 60_000 };

function seeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `S${i}`);
}

/**
 * Count distinct peak-to-trough declines of at least `threshold`. A new episode
 * can only begin once the series has made a fresh high.
 */
function countDrawdowns(price: Float64Array, threshold: number): number {
  let peak = price[0];
  let trough = price[0];
  let inDrawdown = false;
  let count = 0;

  for (let t = 1; t < price.length; t++) {
    const p = price[t];
    if (p > peak) {
      peak = p;
      trough = p;
      inDrawdown = false;
    } else if (p < trough) {
      trough = p;
      if (!inDrawdown && trough <= peak * (1 - threshold)) {
        inDrawdown = true;
        count++;
      }
    }
  }
  return count;
}

describe('the median-vs-mean property (TDD §3.3) — the C1 safeguard', () => {
  /**
   * The published table is a property of the *base* GBM process, so that is what
   * this measures. The regime overlay shifts the realized median on top of it;
   * the test below measures that shift separately.
   *
   * 4,000 seeds rather than the 1,000 originally specified: the median standard
   * error for CRYP at sigma=0.70 over 30 years is ~0.51pp, which is larger than
   * the 0.5pp tolerance itself. At 1,000 seeds CRYP misses by 0.77pp on sampling
   * noise alone; by 4,000 every asset is inside 0.09pp. See docs/DECISIONS.md.
   */
  it(
    'realizes a median annual log-return within 0.5pp of the mu_log table',
    SLOW,
    () => {
      const realized: Record<string, number[]> = {};
      for (const id of ASSET_IDS) realized[id] = [];

      for (const seed of seeds(4000)) {
        const history = generateMarket(seed, YEARS);
        for (const id of ASSET_IDS) {
          const { baseLogPrice } = history.series[id];
          realized[id].push((baseLogPrice[history.weeks - 1] - baseLogPrice[0]) / YEARS);
        }
      }

      for (const id of ASSET_IDS) {
        const target = annualLogDrift(ASSETS[id]);
        expect(Math.abs(median(realized[id]) - target)).toBeLessThan(0.005);
      }
    },
  );

  it(
    'keeps the speculative assets on a losing median even with the overlay applied',
    SLOW,
    () => {
      const realized: Record<string, number[]> = {};
      for (const id of ASSET_IDS) realized[id] = [];

      for (const seed of seeds(1000)) {
        const history = generateMarket(seed, YEARS);
        for (const id of ASSET_IDS) {
          const { logPrice } = history.series[id];
          realized[id].push((logPrice[history.weeks - 1] - logPrice[0]) / YEARS);
        }
      }

      // The overlay lifts high-beta assets, because booms have no recovery phase
      // while crashes do. It is not enough to reverse the design property: MOON
      // and CRYP still lose in the median, and still lose to SAFE.
      expect(median(realized.MOON)).toBeLessThan(0);
      expect(median(realized.CRYP)).toBeLessThan(0);
      expect(median(realized.MOON)).toBeLessThan(median(realized.SAFE));
      expect(median(realized.CRYP)).toBeLessThan(median(realized.MOON));

      // The subsidy scales with beta. If this grows, C1 is the test that will
      // notice — recheck it before touching BOOM_LAMBDA or the boom depth range.
      const subsidy = (id: AssetId) => median(realized[id]) - annualLogDrift(ASSETS[id]);
      expect(subsidy('CRYP')).toBeGreaterThan(subsidy('SAFE'));
      expect(subsidy('CRYP')).toBeLessThan(0.03);
    },
  );

  it('has a mean far above its median for the speculative assets', SLOW, () => {
    const terminal: number[] = [];
    for (const seed of seeds(1000)) {
      const history = generateMarket(seed, YEARS);
      const { priceCents } = history.series.MOON;
      terminal.push(priceCents[history.weeks - 1]);
    }
    const mean = terminal.reduce((a, b) => a + b, 0) / terminal.length;
    // Attractive mean, losing median: the whole point of the asset.
    expect(mean).toBeGreaterThan(median(terminal) * 2);
    expect(median(terminal)).toBeLessThan(10_000); // below the 100.00 start
  });
});

describe('crash overlay behaviour (TDD §3.4)', () => {
  it('gives a 30-year run 2-5 major drawdowns on SAFE in the median case', SLOW, () => {
    const counts = seeds(1000).map((seed) =>
      countDrawdowns(generateMarket(seed, YEARS).series.SAFE.priceCents, 0.2),
    );

    // The typical run sits inside the 2-5 band. Individual runs range wider,
    // because SAFE's own volatility produces >=20% declines on top of the ~3
    // scheduled crashes — see docs/DECISIONS.md.
    expect(median(counts)).toBeGreaterThanOrEqual(2);
    expect(median(counts)).toBeLessThanOrEqual(5);

    const inBand = counts.filter((c) => c >= 2 && c <= 5).length / counts.length;
    expect(inBand).toBeGreaterThan(0.65);
  });

  it('schedules 2-5 crash episodes in the median 30-year run', SLOW, () => {
    const counts = seeds(1000).map(
      (seed) => generateMarket(seed, YEARS).episodes.filter((e) => e.kind === 'crash').length,
    );
    expect(median(counts)).toBeGreaterThanOrEqual(2);
    expect(median(counts)).toBeLessThanOrEqual(5);
    // TDD §3.4 sizes lambda at "approximately 3.3 crashes per 30-year run".
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(2.5);
    expect(mean).toBeLessThan(4);
  });

  it('rises on bonds through at least 60% of equity crash windows', SLOW, () => {
    let windows = 0;
    let positive = 0;

    for (const seed of seeds(1000)) {
      const history = generateMarket(seed, YEARS);
      for (const episode of history.episodes) {
        if (episode.kind !== 'crash') continue;
        const start = episode.startWeek;
        const end = Math.min(start + episode.declineWeeks, history.weeks - 1);
        if (end <= start) continue;

        windows++;
        const bond = history.series.BOND.priceCents;
        if (bond[end] > bond[start]) positive++;
      }
    }

    expect(windows).toBeGreaterThan(2000);
    // Flight to quality: this is what makes 60/40 discoverable through play
    // rather than through a tooltip.
    expect(positive / windows).toBeGreaterThan(0.6);
  });
});
