/**
 * Market model — TDD §3.
 *
 * The entire price history for every asset, for every week of the run, is
 * generated at initialization from the `market` stream and materialized into
 * arrays. Prices are never rolled during play. This is what guarantees the
 * GDD §13 promise that two players sharing a seed live in the same world
 * regardless of how either of them behaves.
 *
 * **The draw order below is contractual.** It is part of the ruleset version.
 * Reordering it, or inserting a draw in the middle, changes what every existing
 * seed produces. See docs/DECISIONS.md.
 */
import { type InflationPath, generateInflationPath } from './inflation.ts';
import { type Rng, intIn, normal, stream, uniform } from './rng.ts';
import { WEEKS_PER_YEAR, isQuarterBoundary, totalWeeks } from './time.ts';

export type AssetId = 'BOND' | 'SAFE' | 'BLUE' | 'MOON' | 'CRYP';

/**
 * [F] Iteration order for everything that consumes randomness per asset.
 *
 * New assets go on the **end**. Because Z draws are asset-major (all of one
 * asset's weeks, then the next), appending leaves every existing asset's series
 * untouched; inserting in the middle does not.
 */
export const ASSET_IDS: readonly AssetId[] = ['BOND', 'SAFE', 'BLUE', 'MOON', 'CRYP'];

export interface AssetParams {
  readonly id: AssetId;
  readonly name: string;
  /** [T] Annual price drift, excluding dividends. */
  readonly drift: number;
  /** [T] Annual volatility. */
  readonly volatility: number;
  /** [T] Annual dividend yield. Total expected return = drift + dividendYield. */
  readonly dividendYield: number;
  /** [T] Sensitivity to the regime overlay. Negative on bonds: flight to quality. */
  readonly regimeBeta: number;
}

/** [T] TDD §3.1. */
export const ASSETS: Readonly<Record<AssetId, AssetParams>> = {
  BOND: { id: 'BOND', name: 'Bond Fund', drift: 0.0, volatility: 0.04, dividendYield: 0.04, regimeBeta: -0.15 },
  SAFE: { id: 'SAFE', name: 'SafeCo Index', drift: 0.052, volatility: 0.16, dividendYield: 0.018, regimeBeta: 1.0 },
  BLUE: { id: 'BLUE', name: 'BlueChip Corp', drift: 0.045, volatility: 0.22, dividendYield: 0.03, regimeBeta: 0.9 },
  MOON: { id: 'MOON', name: 'Moonshot Tech', drift: 0.06, volatility: 0.45, dividendYield: 0.0, regimeBeta: 1.8 },
  CRYP: { id: 'CRYP', name: 'Crypto-ish Token', drift: 0.04, volatility: 0.7, dividendYield: 0.0, regimeBeta: 2.5 },
};

/** [F] Every asset starts at an index value of 100.00, so charts are comparable. */
export const STARTING_PRICE_CENTS = 10_000;

/** [T] Crash arrival rate, per year. ~3.1 crashes in a 30-year run. */
export const CRASH_LAMBDA = 0.11;
/** [T] Boom arrival rate, per year. */
export const BOOM_LAMBDA = 0.09;
/** [T] Minimum years between two episodes of the same kind. */
export const MIN_EPISODE_SEPARATION_YEARS = 3;
/**
 * [T] Fraction of a crash's log decline undone by the recovery boost. Below 1 on
 * purpose: the remainder has to come from ordinary drift, which is why recovery
 * takes years and why sequence-of-returns risk is real.
 */
export const CRASH_RECOVERY_FACTOR = 0.72;

export const CRASH_DECLINE_WEEKS_MIN = 8;
export const CRASH_DECLINE_WEEKS_MAX = 20;
export const CRASH_RECOVERY_WEEKS_MIN = 20;
export const CRASH_RECOVERY_WEEKS_MAX = 90;
export const CRASH_DEPTH_MIN = 0.22;
export const CRASH_DEPTH_MAX = 0.45;
/** Booms are the same machinery with a negative depth and no recovery phase. */
export const BOOM_DEPTH_MIN = -0.3;
export const BOOM_DEPTH_MAX = -0.15;

export type RegimeKind = 'crash' | 'boom' | 'sector';

export interface RegimeEpisode {
  readonly kind: RegimeKind;
  /** First week of the decline phase. */
  readonly startWeek: number;
  readonly declineWeeks: number;
  /** 0 for booms, which have no recovery phase. */
  readonly recoveryWeeks: number;
  /** Market-wide depth on the SAFE reference. Negative for booms. */
  readonly depth: number;
  /**
   * `null` for market-wide episodes. A sector event names a single asset and is
   * applied with beta 1.0 regardless of that asset's own beta (TDD §3.4).
   */
  readonly assetId: AssetId | null;
}

export interface AssetSeries {
  readonly id: AssetId;
  /** Log price including the regime overlay. */
  readonly logPrice: Float64Array;
  /** Price in integer cents, rounded once from `logPrice`. Never a float dollar. */
  readonly priceCents: Float64Array;
  /**
   * Log price from the base GBM process alone, with no overlay.
   *
   * Kept so the §3.3 median-vs-mean property — the mathematical guarantee behind
   * the C1 safeguard — stays directly testable for the life of the project. It
   * is a validation hook, not gameplay data: never show it to the player.
   */
  readonly baseLogPrice: Float64Array;
}

export interface MarketHistory {
  readonly seed: string;
  readonly runLengthYears: number;
  readonly weeks: number;
  readonly series: Readonly<Record<AssetId, AssetSeries>>;
  /** In construction order: crashes, then booms, then sector events. */
  readonly episodes: readonly RegimeEpisode[];
  readonly inflation: InflationPath;
}

/**
 * Generate the whole world's market history from a seed.
 *
 * Draw order (contractual, part of the ruleset version):
 *   1. crash timeline    — per crash: gap, declineWeeks, recoveryWeeks, depth
 *   2. boom timeline     — per boom:  gap, declineWeeks, depth
 *   3. sector events     — currently consumes nothing; see docs/DECISIONS.md
 *   4. inflation path    — 2 draws per year after the first
 *   5. GBM shocks        — asset-major, then week-major; 2 draws per Z
 */
export function generateMarket(seed: string, runLengthYears: number): MarketHistory {
  return generateMarketFrom(stream(seed, 'market'), seed, runLengthYears);
}

/**
 * The generator, given an already-derived stream. Exported so tests can count
 * draws and prove the stream is consumed entirely during initialization.
 */
export function generateMarketFrom(rng: Rng, seed: string, runLengthYears: number): MarketHistory {
  const weeks = totalWeeks(runLengthYears);

  const episodes: RegimeEpisode[] = [
    ...scheduleEpisodes(rng, weeks, 'crash'),
    ...scheduleEpisodes(rng, weeks, 'boom'),
    // 3. Sector events would be scheduled here. They are not, yet — TDD §3.4
    //    names the beta and duration but not the arrival rate or depth range,
    //    and inventing those would move C1. See docs/DECISIONS.md.
  ];

  const inflation = generateInflationPath(rng, runLengthYears);
  const overlay = buildOverlay(episodes, weeks);

  const series: Record<AssetId, AssetSeries> = {} as Record<AssetId, AssetSeries>;
  for (const id of ASSET_IDS) {
    series[id] = generateSeries(rng, ASSETS[id], overlay[id], weeks);
  }

  return { seed, runLengthYears, weeks, series, episodes, inflation };
}

/**
 * Draw a timeline of episodes of one kind until the run is covered.
 *
 * Inter-arrival in years is exponential with rate λ, floored at a 3-year
 * separation: `gap = max(3, -ln(U) / λ)`.
 */
function scheduleEpisodes(rng: Rng, weeks: number, kind: 'crash' | 'boom'): RegimeEpisode[] {
  const lambda = kind === 'crash' ? CRASH_LAMBDA : BOOM_LAMBDA;
  const episodes: RegimeEpisode[] = [];

  let week = 0;
  for (;;) {
    const u = Math.max(rng(), Number.MIN_VALUE);
    const gapYears = Math.max(MIN_EPISODE_SEPARATION_YEARS, -Math.log(u) / lambda);
    week += Math.round(gapYears * WEEKS_PER_YEAR);
    if (week >= weeks) break;

    const declineWeeks = intIn(rng, CRASH_DECLINE_WEEKS_MIN, CRASH_DECLINE_WEEKS_MAX);
    // Booms have no recovery phase, so they draw no recovery length.
    const recoveryWeeks =
      kind === 'crash' ? intIn(rng, CRASH_RECOVERY_WEEKS_MIN, CRASH_RECOVERY_WEEKS_MAX) : 0;
    const depth =
      kind === 'crash'
        ? uniform(rng, CRASH_DEPTH_MIN, CRASH_DEPTH_MAX)
        : uniform(rng, BOOM_DEPTH_MIN, BOOM_DEPTH_MAX);

    episodes.push({ kind, startWeek: week, declineWeeks, recoveryWeeks, depth, assetId: null });
  }

  return episodes;
}

/**
 * Accumulate every episode's per-week additive log effect, per asset.
 *
 * Episodes are summed in construction order. Floating-point addition is not
 * associative, so the order this runs in is part of the determinism contract —
 * do not sort this array before summing.
 */
function buildOverlay(
  episodes: readonly RegimeEpisode[],
  weeks: number,
): Record<AssetId, Float64Array> {
  const overlay = {} as Record<AssetId, Float64Array>;
  for (const id of ASSET_IDS) overlay[id] = new Float64Array(weeks);

  for (const episode of episodes) {
    // ln(1 - depth): negative for a crash, positive for a boom.
    const logMove = Math.log(1 - episode.depth);
    const targets = episode.assetId === null ? ASSET_IDS : [episode.assetId];

    for (const id of targets) {
      // A sector event is applied at beta 1.0 regardless of the asset's own beta.
      const beta = episode.assetId === null ? ASSETS[id].regimeBeta : 1;
      const drag = (beta * logMove) / episode.declineWeeks;
      const declineEnd = Math.min(episode.startWeek + episode.declineWeeks, weeks);
      for (let t = episode.startWeek; t < declineEnd; t++) overlay[id][t] += drag;

      if (episode.recoveryWeeks === 0) continue;
      const boost = (-CRASH_RECOVERY_FACTOR * beta * logMove) / episode.recoveryWeeks;
      const recoveryStart = episode.startWeek + episode.declineWeeks;
      const recoveryEnd = Math.min(recoveryStart + episode.recoveryWeeks, weeks);
      for (let t = recoveryStart; t < recoveryEnd; t++) overlay[id][t] += boost;
    }
  }

  return overlay;
}

/**
 * Geometric Brownian motion in log space, weekly steps (TDD §3.2):
 *
 *   μ_w = (ln(1 + μ) − σ²/2) / 52     σ_w = σ / √52
 *   logP[t] = logP[t−1] + μ_w + σ_w·Z_t   (+ the regime overlay for week t)
 */
function generateSeries(
  rng: Rng,
  params: AssetParams,
  overlay: Float64Array,
  weeks: number,
): AssetSeries {
  const muWeekly = annualLogDrift(params) / WEEKS_PER_YEAR;
  const sigmaWeekly = params.volatility / Math.sqrt(WEEKS_PER_YEAR);

  const logPrice = new Float64Array(weeks);
  const baseLogPrice = new Float64Array(weeks);
  const priceCents = new Float64Array(weeks);

  const startLog = Math.log(STARTING_PRICE_CENTS / 100);
  logPrice[0] = startLog;
  baseLogPrice[0] = startLog;
  priceCents[0] = STARTING_PRICE_CENTS;

  for (let t = 1; t < weeks; t++) {
    const step = muWeekly + sigmaWeekly * normal(rng);
    baseLogPrice[t] = baseLogPrice[t - 1] + step;
    logPrice[t] = logPrice[t - 1] + step + overlay[t];
    // Rounded once, from the float log path — so rounding never compounds.
    // Floored at one cent: a price below the smallest representable currency
    // unit is not a price. Without it, a collapsed asset divides by zero at
    // every share-count site downstream — CRYP reaches it in 21% of 30-year
    // runs. The float log path keeps falling underneath, so a recovery still
    // has to climb all the way back.
    priceCents[t] = Math.max(1, Math.round(Math.exp(logPrice[t]) * 100));
  }

  return { id: params.id, logPrice, priceCents, baseLogPrice };
}

/**
 * μ_log = ln(1 + μ) − σ²/2 — the annual *median* log return (TDD §3.3).
 *
 * This is the C1 safeguard in one line: high volatility drags the median down
 * even with attractive drift, so speculation has an attractive mean and a losing
 * median. Do not raise MOON's drift above ~0.09 without recomputing §3.3's table.
 */
export function annualLogDrift(params: AssetParams): number {
  return Math.log(1 + params.drift) - (params.volatility * params.volatility) / 2;
}

/** Dividends pay at quarter boundaries (TDD §3.5). */
export function isDividendWeek(weekIndex: number): boolean {
  // Week 0 is a quarter boundary but pays nothing: a player who buys on the
  // opening tick has held for no time and must not collect a full quarter.
  return weekIndex > 0 && isQuarterBoundary(weekIndex);
}

/**
 * A quarter's dividend on a holding, in integer cents:
 * `shares · P[t] · (annualYield / 4)`.
 *
 * Taxable as ordinary income in the year received, including when auto-reinvest
 * immediately spends it (§6.3) — which is how auto-reinvest can produce a
 * year-end tax bill with no cash behind it.
 */
export function dividendPaymentCents(
  history: MarketHistory,
  assetId: AssetId,
  shares: number,
  weekIndex: number,
): number {
  if (!isDividendWeek(weekIndex)) return 0;
  const perShare = history.series[assetId].priceCents[weekIndex];
  return Math.round((shares * perShare * ASSETS[assetId].dividendYield) / 4);
}

/** Price of one share, in integer cents. */
export function priceCentsAt(history: MarketHistory, assetId: AssetId, weekIndex: number): number {
  return history.series[assetId].priceCents[weekIndex];
}
