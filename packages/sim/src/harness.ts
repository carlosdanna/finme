/**
 * Headless balance harness.
 *
 * Runs scripted strategies against seeded market histories from @finme/engine.
 * This is the thing that tells us whether the game accidentally teaches
 * gambling, so it imports the engine and nothing else — no UI, no DOM.
 *
 * At this stage there is no player, no events, no jobs and no tax: just capital
 * deployed at t=0, a fixed annual contribution, and an allocation rule. That is
 * deliberate — C1 asks a question about the *market model*, and adding systems
 * on top of it would only make the answer harder to attribute.
 */
import {
  ASSET_IDS,
  type AssetId,
  type MarketHistory,
  dividendPaymentCents,
  generateMarket,
  isDividendWeek,
  isYearBoundary,
} from '@finme/engine';

export interface HarnessConfig {
  readonly runLengthYears: number;
  /** Deployed at week 0. */
  readonly initialCapitalCents: number;
  /** Added at every year boundary. Nominal — not indexed to inflation. */
  readonly annualContributionCents: number;
}

export const DEFAULT_CONFIG: HarnessConfig = {
  runLengthYears: 30,
  initialCapitalCents: 500_000, // $5,000
  annualContributionCents: 600_000, // $6,000
};

/** Target portfolio weights. Anything omitted is zero. Must sum to 1. */
export type Weights = Partial<Record<AssetId, number>>;

export interface StrategyContext {
  readonly history: MarketHistory;
  readonly weekIndex: number;
}

export interface Strategy {
  readonly id: string;
  readonly name: string;
  /** The allocation this strategy wants at a given point in the run. */
  targetWeights(ctx: StrategyContext): Weights;
  /**
   * Weeks on which the portfolio is sold down and rebuilt to target. Week 0 is
   * always a rebalance — that is where the initial capital is deployed.
   */
  rebalancesOn(weekIndex: number): boolean;
}

/** Share counts are fractional; every cash amount is integer cents. */
interface Portfolio {
  shares: Record<AssetId, number>;
  cashCents: number;
}

export interface RunResult {
  readonly seed: string;
  readonly strategyId: string;
  /** Portfolio value on the final week, in integer cents. */
  readonly terminalCents: number;
  /** Initial capital plus every annual contribution, in integer cents. */
  readonly contributedCents: number;
}

/** Total contributed over a run: the initial deployment plus each year boundary. */
export function totalContributedCents(config: HarnessConfig): number {
  // Year boundaries exclude week 0, so a 30-year run has 29 of them.
  return config.initialCapitalCents + config.annualContributionCents * (config.runLengthYears - 1);
}

function emptyPortfolio(): Portfolio {
  const shares = {} as Record<AssetId, number>;
  for (const id of ASSET_IDS) shares[id] = 0;
  return { shares, cashCents: 0 };
}

function valueCents(portfolio: Portfolio, history: MarketHistory, week: number): number {
  let total = portfolio.cashCents;
  for (const id of ASSET_IDS) {
    total += portfolio.shares[id] * history.series[id].priceCents[week];
  }
  return total;
}

/** Sell everything and rebuild at the target weights. Leaves no cash behind. */
function rebalance(portfolio: Portfolio, history: MarketHistory, week: number, weights: Weights): void {
  const total = valueCents(portfolio, history, week);
  portfolio.cashCents = 0;
  for (const id of ASSET_IDS) {
    const weight = weights[id] ?? 0;
    portfolio.shares[id] = weight === 0 ? 0 : (total * weight) / history.series[id].priceCents[week];
  }
}

/** Put available cash to work at the target weights, without selling anything. */
function deployCash(portfolio: Portfolio, history: MarketHistory, week: number, weights: Weights): void {
  const cash = portfolio.cashCents;
  if (cash <= 0) return;
  portfolio.cashCents = 0;
  for (const id of ASSET_IDS) {
    const weight = weights[id] ?? 0;
    if (weight === 0) continue;
    portfolio.shares[id] += (cash * weight) / history.series[id].priceCents[week];
  }
}

/**
 * Run one strategy against one market history.
 *
 * Dividends auto-reinvest into the paying asset (TDD §3.5's `autoReinvest`
 * standing order), so no strategy is penalized by cash drag it did not choose.
 * There is no tax here — see docs/DECISIONS.md.
 */
export function runStrategy(
  history: MarketHistory,
  strategy: Strategy,
  config: HarnessConfig,
): RunResult {
  const portfolio = emptyPortfolio();
  const lastWeek = history.weeks - 1;

  portfolio.cashCents = config.initialCapitalCents;
  rebalance(portfolio, history, 0, strategy.targetWeights({ history, weekIndex: 0 }));

  for (let week = 1; week <= lastWeek; week++) {
    if (isDividendWeek(week)) {
      for (const id of ASSET_IDS) {
        const shares = portfolio.shares[id];
        if (shares === 0) continue;
        const paid = dividendPaymentCents(history, id, shares, week);
        if (paid > 0) portfolio.shares[id] += paid / history.series[id].priceCents[week];
      }
    }

    if (isYearBoundary(week)) {
      portfolio.cashCents += config.annualContributionCents;
    }

    if (strategy.rebalancesOn(week)) {
      rebalance(portfolio, history, week, strategy.targetWeights({ history, weekIndex: week }));
    } else if (portfolio.cashCents > 0) {
      deployCash(portfolio, history, week, strategy.targetWeights({ history, weekIndex: week }));
    }
  }

  const terminalCents = Math.round(valueCents(portfolio, history, lastWeek));
  if (!Number.isFinite(terminalCents)) {
    // A non-finite result means a divide-by-zero somewhere upstream, usually a
    // collapsed asset price. Fail loudly: silently it just prints as $NaN and
    // quietly corrupts every percentile in the report.
    throw new Error(
      `non-finite terminal wealth for strategy '${strategy.id}' on seed '${history.seed}'`,
    );
  }

  return {
    seed: history.seed,
    strategyId: strategy.id,
    terminalCents,
    contributedCents: totalContributedCents(config),
  };
}

/**
 * Run every strategy against N seeded histories.
 *
 * Each history is generated once and shared across strategies, which is both
 * much faster and the fairer comparison: every strategy faces the same world.
 */
export function runHarness(
  strategies: readonly Strategy[],
  seeds: readonly string[],
  config: HarnessConfig = DEFAULT_CONFIG,
): Map<string, RunResult[]> {
  const results = new Map<string, RunResult[]>();
  for (const strategy of strategies) results.set(strategy.id, []);

  for (const seed of seeds) {
    const history = generateMarket(seed, config.runLengthYears);
    for (const strategy of strategies) {
      results.get(strategy.id)!.push(runStrategy(history, strategy, config));
    }
  }

  return results;
}

/** Deterministic seed set, so a harness run is reproducible run to run. */
export function harnessSeeds(n: number, prefix = 'C1'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}
