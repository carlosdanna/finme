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

// Credit score (TDD §5.5).
export {
  THIN_FILE_WEEKS,
  ENTRY_SCORE_MIN,
  ENTRY_SCORE_MAX,
  SCORE_FLOOR,
  SCORE_SPAN,
  MAX_MONTHLY_MOVE,
  PAYMENT_DECAY_PER_WEEK,
  MISSED_PAYMENT_WEIGHT,
  COMPONENT_WEIGHTS,
  emptyCreditState,
  drawEntryScore,
  hasFile,
  openCreditLine,
  recordOnTimePayment,
  recordMissedPayment,
  recordCollection,
  recordBankruptcy,
  decayWeek,
  paymentHistoryScore,
  utilizationScore,
  utilization,
  ageScore,
  mixScore,
  derogatoryScore,
  compositeScore,
  targetScore,
  updateMonthly,
} from './credit.ts';
export type { CreditState, CreditInputs } from './credit.ts';

// Owned assets (TDD §8).
export {
  CAR_OFF_LOT_DROP,
  CAR_DEPRECIATION_RATE,
  CAR_SCRAP_FLOOR,
  HOME_DRIFT,
  HOME_VOLATILITY,
  HOME_MAINTENANCE_RATE,
  HOME_PROPERTY_TAX_RATE,
  HOME_SALE_TRANSACTION_COST,
  HOME_PRICE_TO_RENT,
  equivalentAnnualRentCents,
  carValueCents,
  carValueAtPurchaseCents,
  generateHomeValuePath,
  homeValueCents,
  homeMaintenanceWeeklyCents,
  homePropertyTaxWeeklyCents,
  homeCarryingCostWeeklyCents,
  homeSaleProceedsCents,
} from './assets.ts';
export type { Car, Home } from './assets.ts';

// Net worth (TDD §4.2).
export {
  portfolioValueCents,
  assetsCents,
  liabilitiesCents,
  netWorthCents,
  balanceSheet,
  emptyBalanceSheetInput,
} from './netWorth.ts';
export type { BalanceSheet, BalanceSheetInput, Holdings } from './netWorth.ts';

// Energy, mood and performance (TDD §7).
export {
  TIME_POINTS_PER_WEEK,
  WORK_TIME_POINTS,
  ENERGY_BASELINE_RECOVERY,
  ENERGY_PER_REST,
  ENERGY_FULL_TIME,
  ENERGY_PART_TIME,
  ENERGY_PER_OVERTIME,
  ENERGY_PER_STUDY,
  ENERGY_PER_SIDE_HUSTLE,
  ENERGY_PER_PAID_SOCIAL,
  ENERGY_PER_FREE_SOCIAL,
  MOOD_PER_PAID_SOCIAL,
  MOOD_PER_FREE_SOCIAL,
  MOOD_PER_REST,
  MOOD_FULL_TIME,
  MOOD_PART_TIME,
  MOOD_PER_OVERTIME,
  MOOD_PER_STUDY,
  MOOD_PER_SIDE_HUSTLE,
  MOOD_DECAY,
  MOOD_DECAY_LOW,
  MOOD_DECAY_THRESHOLD,
  HOUSING_MOOD_MODIFIER,
  PERFORMANCE_WARNING_THRESHOLD,
  PERFORMANCE_FIRING_THRESHOLD,
  PERFORMANCE_WARNING_CLEAR_THRESHOLD,
  FIRING_NOTICE_WEEKS,
  REACH_OUT_MOOD_THRESHOLD,
  REACH_OUT_CONSECUTIVE_WEEKS,
  REACH_OUT_COOLDOWN_WEEKS,
  REACH_OUT_MOOD_GRANT,
  emptyAllocation,
  allocationPoints,
  availableTimePoints,
  isValidAllocation,
  moodEnergyCoupling,
  nextEnergy,
  discretionarySatisfaction,
  housingMoodModifier,
  debtStress,
  moodDecay,
  nextMood,
  nextPerformance,
  clearTrack,
  evaluatePerformanceTrack,
  shouldForceReachOut,
} from './vitals.ts';
export type {
  Allocation,
  WorkMode,
  MoodContext,
  PerformanceContext,
  PerformanceTrack,
  EmploymentStanding,
} from './vitals.ts';

// Employment (GDD §3.1, TDD §6.2).
export {
  JOB_TIERS,
  OPENINGS_PER_YEAR,
  OPENING_WEEKS_MIN,
  OPENING_WEEKS_MAX,
  APPLICATION_BASE,
  APPLICATION_PER_EXPERIENCE_YEAR,
  APPLICATION_EXPERIENCE_CAP,
  APPLICATION_NETWORKING_BONUS,
  APPLICATION_LONG_UNEMPLOYED_PENALTY,
  LONG_UNEMPLOYMENT_WEEKS,
  APPLICATION_MIN_PROBABILITY,
  APPLICATION_MAX_PROBABILITY,
  APPLICATION_TIME_POINTS,
  APPLICATION_FAILURE_MOOD_COST,
  tierRank,
  weeklyGrossCents,
  ineligibleReasons,
  isEligible,
  applicationProbability,
  rollApplication,
  generateJobTimeline,
  availableJobIds,
  applicableJobs,
} from './jobs.ts';
export type {
  JobDef,
  JobTier,
  JobPay,
  JobRequirements,
  JobOpening,
  Applicant,
  ApplicationContext,
  ApplicationResult,
  IneligibleReason,
} from './jobs.ts';

// Event system (TDD §9.1-9.3).
export * from './events/index.ts';

// Logbook engine (TDD §11).
export * from './logbook/index.ts';

// Numeric helpers.
export { clamp, median } from './math.ts';

// Seed format (TDD §2.3).
export { isValidSeed, formatSeedString, parseSeedString, isCurrentRuleset } from './seed.ts';
export type { ParsedSeed } from './seed.ts';
