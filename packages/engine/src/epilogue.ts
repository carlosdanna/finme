/**
 * Epilogue projection — TDD §12.
 *
 * A Monte Carlo run at the end of a run, projecting the player's final position
 * forward to 65 under their final allocation, against the same contributions
 * held entirely in cash.
 *
 * **The gap between those two numbers is the single most important output the
 * game produces.** It is presented as two numbers and a chart, with no
 * adjectives whatsoever — no grade, no rank, no percentage of optimal.
 *
 * §12 says to use `Math.random()` rather than a seeded stream, because this is a
 * post-run illustration and seeding it would imply a determinism it does not
 * need. CLAUDE.md bans `Math.random()` in the engine. Both hold here: the rng is
 * a **parameter**. The caller passes `Math.random`; the engine never calls it,
 * and tests pass a seeded stream so they are reproducible.
 */
import { ASSETS, ASSET_IDS, type AssetId, annualLogDrift } from './market.ts';
import { clamp, median } from './math.ts';
import { type Rng, normal } from './rng.ts';

/** [T] Paths per projection. Well under 100ms in-browser. */
export const EPILOGUE_PATHS = 2_000;

/** [T] The age every projection runs to. */
export const EPILOGUE_TARGET_AGE = 65;

/** [T] Contributions are assumed to grow with inflation. */
export const EPILOGUE_CONTRIBUTION_GROWTH = 0.02;

/** [T] The cash counterfactual is deflated at the same rate. */
export const EPILOGUE_CASH_DEFLATION = 0.02;

/**
 * [T] How strongly each asset loads on the single shared market factor.
 *
 * Derived from the §3.1 regime betas, scaled by the largest of them, so the
 * ordering and the sign both carry over: bonds load slightly *negative*, which
 * is the flight-to-quality the market model already produces.
 */
export function marketLoading(assetId: AssetId): number {
  return clamp(ASSETS[assetId].regimeBeta / 2.5, -1, 1);
}

export interface EpilogueInput {
  /** Liquid net worth plus the retirement balance, in integer cents. */
  readonly startingWealthCents: number;
  /** What the player was contributing a year, at the end of the run. */
  readonly annualContributionCents: number;
  readonly endAge: number;
  /** The player's final allocation, by asset. Anything omitted is zero. */
  readonly weights: Partial<Record<AssetId, number>>;
  /** The deflator at run end, so real terms are stated in year-0 money. */
  readonly finalCpi: number;
  readonly targetAge?: number;
}

export interface EpilogueBand {
  readonly age: number;
  readonly p10Cents: number;
  readonly p50Cents: number;
  readonly p90Cents: number;
  /** The same contributions held entirely in cash, losing 2%/yr. */
  readonly allCashCents: number;
}

export interface EpilogueProjection {
  readonly bands: readonly EpilogueBand[];
  /** Terminal figures, nominal. */
  readonly p10Cents: number;
  readonly p50Cents: number;
  readonly p90Cents: number;
  readonly allCashCents: number;
  /** The same figures deflated to year-0 money. */
  readonly realP10Cents: number;
  readonly realP50Cents: number;
  readonly realP90Cents: number;
  readonly realAllCashCents: number;
  readonly years: number;
  readonly paths: number;
}

/** Normalize an allocation to weights summing to 1. All cash if it is empty. */
export function normalizedWeights(
  weights: Partial<Record<AssetId, number>>,
): Record<AssetId, number> {
  const total = ASSET_IDS.reduce((sum, id) => sum + Math.max(0, weights[id] ?? 0), 0);
  const out = {} as Record<AssetId, number>;
  for (const id of ASSET_IDS) out[id] = total <= 0 ? 0 : Math.max(0, weights[id] ?? 0) / total;
  return out;
}

/**
 * Project forward to `targetAge`.
 *
 * Each year draws one shared market factor plus one idiosyncratic shock per
 * asset, so the assets move together to the degree their regime betas imply.
 */
export function projectEpilogue(input: EpilogueInput, rng: Rng): EpilogueProjection {
  const targetAge = input.targetAge ?? EPILOGUE_TARGET_AGE;
  const years = Math.max(0, targetAge - input.endAge);
  const weights = normalizedWeights(input.weights);

  // Pre-compute the per-asset parameters once rather than per path per year.
  const assets = ASSET_IDS.map((id) => ({
    id,
    weight: weights[id],
    // Total return: price drift plus the dividend the asset pays.
    muLog: annualLogDrift(ASSETS[id]) + ASSETS[id].dividendYield,
    sigma: ASSETS[id].volatility,
    loading: marketLoading(id),
  })).filter((asset) => asset.weight > 0);

  // wealth[path] as the projection walks forward, and a per-year snapshot.
  const wealth = new Float64Array(EPILOGUE_PATHS).fill(input.startingWealthCents);
  const bands: EpilogueBand[] = [];

  let cash = input.startingWealthCents;
  const yearly = new Array<number>(EPILOGUE_PATHS);

  for (let year = 1; year <= years; year++) {
    const contribution = input.annualContributionCents * Math.pow(1 + EPILOGUE_CONTRIBUTION_GROWTH, year - 1);

    for (let path = 0; path < EPILOGUE_PATHS; path++) {
      const marketFactor = normal(rng);
      let portfolioReturn = 0;

      for (const asset of assets) {
        const idiosyncratic = normal(rng);
        const z = asset.loading * marketFactor + Math.sqrt(1 - asset.loading * asset.loading) * idiosyncratic;
        portfolioReturn += asset.weight * (Math.exp(asset.muLog + asset.sigma * z) - 1);
      }

      wealth[path] = wealth[path] * (1 + portfolioReturn) + contribution;
      yearly[path] = wealth[path];
    }

    // The counterfactual: the same contributions, held in cash, losing ground.
    cash = cash * (1 - EPILOGUE_CASH_DEFLATION) + contribution;

    const sorted = [...yearly].sort((a, b) => a - b);
    bands.push({
      age: input.endAge + year,
      p10Cents: Math.round(percentileOf(sorted, 0.1)),
      p50Cents: Math.round(percentileOf(sorted, 0.5)),
      p90Cents: Math.round(percentileOf(sorted, 0.9)),
      allCashCents: Math.round(cash),
    });
  }

  const terminal = bands.at(-1) ?? {
    age: input.endAge,
    p10Cents: input.startingWealthCents,
    p50Cents: input.startingWealthCents,
    p90Cents: input.startingWealthCents,
    allCashCents: input.startingWealthCents,
  };

  const deflate = (cents: number): number => Math.round(cents / Math.max(input.finalCpi, 1e-9));

  return {
    bands,
    p10Cents: terminal.p10Cents,
    p50Cents: terminal.p50Cents,
    p90Cents: terminal.p90Cents,
    allCashCents: terminal.allCashCents,
    realP10Cents: deflate(terminal.p10Cents),
    realP50Cents: deflate(terminal.p50Cents),
    realP90Cents: deflate(terminal.p90Cents),
    realAllCashCents: deflate(terminal.allCashCents),
    years,
    paths: EPILOGUE_PATHS,
  };
}

function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export { median };
