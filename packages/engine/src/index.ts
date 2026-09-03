/**
 * Public API surface of the FinMe simulation engine.
 *
 * Pure TypeScript. No React, no DOM, no browser globals, no `Math.random`,
 * no float dollars. Runs identically in Node and the browser — that is what
 * makes the balance harness in packages/sim possible.
 */
export { RULESET_VERSION } from './version.ts';

export { MemoryStorageAdapter } from './storage.ts';
export type { StorageAdapter } from './storage.ts';

// Time and the 4-4-5 calendar (TDD §1).
export {
  WEEKS_PER_YEAR,
  WEEKS_PER_QUARTER,
  MONTHS_PER_YEAR,
  MONTH_LENGTHS,
  MONTH_START_WEEK,
  QUARTER_START_WEEK,
  totalWeeks,
  yearIndex,
  weekOfYear,
  age,
  monthOfYear,
  quarterOfYear,
  weeksInMonth,
  weekOfMonth,
  isMonthBoundary,
  isYearBoundary,
  isQuarterBoundary,
} from './time.ts';

// Deterministic RNG (TDD §2).
export {
  PRE_DRAWN_STREAMS,
  IN_PLAY_STREAMS,
  STREAM_NAMES,
  mulberry32,
  fnv1a,
  stream,
  uniform,
  intIn,
  normal,
  pick,
} from './rng.ts';
export type { Rng, StreamName, PreDrawnStream, InPlayStream } from './rng.ts';

// Market model (TDD §3).
export {
  ASSETS,
  ASSET_IDS,
  STARTING_PRICE_CENTS,
  CRASH_LAMBDA,
  BOOM_LAMBDA,
  CRASH_RECOVERY_FACTOR,
  MIN_EPISODE_SEPARATION_YEARS,
  generateMarket,
  generateMarketFrom,
  annualLogDrift,
  isDividendWeek,
  dividendPaymentCents,
  priceCentsAt,
} from './market.ts';
export type {
  AssetId,
  AssetParams,
  AssetSeries,
  MarketHistory,
  RegimeEpisode,
  RegimeKind,
} from './market.ts';

// Inflation (TDD §3.6).
export {
  INFLATION_TARGET,
  INFLATION_PERSISTENCE,
  INFLATION_SHOCK_SD,
  INFLATION_MIN,
  INFLATION_MAX,
  INFLATION_SPIKE_MIN,
  INFLATION_SPIKE_MAX,
  generateInflationPath,
  buildCpi,
  applyInflationSpike,
  cpiAt,
  realValueCents,
} from './inflation.ts';
export type { InflationPath } from './inflation.ts';

// Income (TDD §6.1, §6.2, §6.4).
export {
  OVERTIME_THRESHOLD_HOURS,
  OVERTIME_MULTIPLIER,
  RAISE_INFLATION_FACTOR,
  RAISE_PERFORMANCE_SPAN,
  CAREER_CURVE,
  JOB_HOP_RAISE_MIN,
  JOB_HOP_RAISE_MAX,
  DEFAULT_CONTRIBUTION_PCT,
  EMPLOYER_MATCH_CAP_PCT,
  EARLY_WITHDRAWAL_PENALTY_RATE,
  EARLY_WITHDRAWAL_AGE,
  weeklyGrossHourlyCents,
  weeklyGrossSalariedCents,
  overtimeHoursFor,
  careerCurveRate,
  performanceBonusRate,
  annualRaiseRate,
  applyRaiseCents,
  jobHopRaiseRate,
  retirementContributionCents,
  earlyWithdrawalPenaltyCents,
} from './income.ts';
export type { RetirementContribution } from './income.ts';

// Taxes (TDD §6.3).
export {
  BRACKETS,
  LONG_TERM_HOLDING_WEEKS,
  LONG_TERM_GAINS_RATE,
  UNPAID_BILL_PENALTY_APR,
  incomeTaxCents,
  marginalRate,
  averageRate,
  weeklyWithholdingCents,
  isLongTerm,
  sellLotsFifo,
  shortTermGainsCents,
  longTermGainsCents,
  longTermGainsTaxCents,
  settleAnnualTax,
  unpaidBillPenaltyCents,
} from './tax.ts';
export type {
  TaxBracket,
  TaxLot,
  RealizedGain,
  SaleResult,
  AnnualTaxInput,
  AnnualTaxSettlement,
} from './tax.ts';

// Debt instruments (TDD §5.1-5.4).
export * from './debt/index.ts';

// Numeric helpers.
export { clamp, median } from './math.ts';

// Seed format (TDD §2.3).
export { isValidSeed, formatSeedString, parseSeedString, isCurrentRuleset } from './seed.ts';
export type { ParsedSeed } from './seed.ts';
