/**
 * Bankruptcy — TDD §13, GDD §4.3.
 *
 * Rev 1's automatic rescue arc was exploitable: max out every line, spend it,
 * get bailed out. So bankruptcy is a **player choice with no free option**, and
 * the continue branch applies a `DireState` that persists and is not quietly
 * forgiven.
 *
 * The arithmetic must be worse than never having got there, or the mechanic
 * teaches the opposite of its intent. C2 is the test that holds that line.
 */
import { clamp } from './math.ts';
import { WEEKS_PER_YEAR } from './time.ts';

/** [F] All three conditions must hold (§13, step 6e). */
export const BANKRUPTCY_DTI_MULTIPLE = 2.0;
export const BANKRUPTCY_MISSED_MONTHS = 3;

/** [T] The dire state's parameters. */
export const DIRE_CREDIT_SCORE_FLOOR = 450;
export const DIRE_CREDIT_RECOVERY_PER_YEAR = 15;
export const DIRE_CREDIT_RECOVERY_YEARS = 7;
export const DIRE_NO_NEW_CREDIT_WEEKS = 104;
export const DIRE_FORCED_BUDGET_WEEKS = 52;
export const DIRE_JOB_BLOCK_WEEKS = 260;
export const DIRE_GARNISHMENT_PCT = 0.15;
export const DIRE_INVESTING_BLOCKED_UNTIL_CASH_MONTHS = 1.0;

/** [T] Job tiers barred after a discharge. */
export const DIRE_BLOCKED_JOB_TIERS: readonly string[] = ['professional', 'specialist'];

export interface BankruptcyTriggerInput {
  readonly unsecuredDebtCents: number;
  readonly annualGrossCents: number;
  readonly cashCents: number;
  readonly monthlyExpensesCents: number;
  readonly consecutiveMissedPaymentMonths: number;
}

/**
 * All three conditions, together. Any one of them alone is a bad month, not a
 * bankruptcy — which is what stops the trigger firing on a single missed bill.
 */
export function bankruptcyTriggered(input: BankruptcyTriggerInput): boolean {
  const overLeveraged =
    input.annualGrossCents > 0
      ? input.unsecuredDebtCents > BANKRUPTCY_DTI_MULTIPLE * input.annualGrossCents
      : input.unsecuredDebtCents > 0;

  return (
    overLeveraged &&
    input.cashCents < input.monthlyExpensesCents &&
    input.consecutiveMissedPaymentMonths >= BANKRUPTCY_MISSED_MONTHS
  );
}

/** GDD §4.3. There is no free option. */
export type BankruptcyChoice = 'end-run' | 'start-over' | 'continue';

export interface DireState {
  readonly dischargedAtWeek: number;
  readonly creditScoreOverride: number;
  readonly noNewCreditUntilWeek: number;
  readonly forcedBudgetUntilWeek: number;
  readonly housingForcedTier: number;
  readonly investingBlockedUntilCashMonths: number;
  readonly garnishmentPct: number;
  readonly jobTiersBlockedUntilWeek: number;
  readonly jobTiersBlocked: readonly string[];
}

/** Build the dire state a discharge leaves behind (§13). */
export function enterDireState(weekIndex: number, housingTier: number): DireState {
  return {
    dischargedAtWeek: weekIndex,
    creditScoreOverride: DIRE_CREDIT_SCORE_FLOOR,
    noNewCreditUntilWeek: weekIndex + DIRE_NO_NEW_CREDIT_WEEKS,
    forcedBudgetUntilWeek: weekIndex + DIRE_FORCED_BUDGET_WEEKS,
    housingForcedTier: Math.max(0, housingTier - 1),
    investingBlockedUntilCashMonths: DIRE_INVESTING_BLOCKED_UNTIL_CASH_MONTHS,
    garnishmentPct: DIRE_GARNISHMENT_PCT,
    jobTiersBlockedUntilWeek: weekIndex + DIRE_JOB_BLOCK_WEEKS,
    jobTiersBlocked: DIRE_BLOCKED_JOB_TIERS,
  };
}

/**
 * The credit ceiling after a discharge: 450, rising ~15 points a year, for seven
 * years. Recovery is capped rather than merely slowed, so a discharged player
 * cannot borrow their way back quickly however well they behave afterwards.
 */
export function direCreditCeiling(dire: DireState, weekIndex: number): number {
  const years = Math.min(
    (weekIndex - dire.dischargedAtWeek) / WEEKS_PER_YEAR,
    DIRE_CREDIT_RECOVERY_YEARS,
  );
  return Math.round(DIRE_CREDIT_SCORE_FLOOR + DIRE_CREDIT_RECOVERY_PER_YEAR * Math.max(0, years));
}

export function direNoNewCredit(dire: DireState | null, weekIndex: number): boolean {
  return dire !== null && weekIndex < dire.noNewCreditUntilWeek;
}

export function direForcedBudget(dire: DireState | null, weekIndex: number): boolean {
  return dire !== null && weekIndex < dire.forcedBudgetUntilWeek;
}

export function direJobBlocked(dire: DireState | null, tier: string, weekIndex: number): boolean {
  if (dire === null || weekIndex >= dire.jobTiersBlockedUntilWeek) return false;
  return dire.jobTiersBlocked.includes(tier);
}

/**
 * Investing is barred while cash reserves sit under one month of expenses.
 *
 * Not a blanket ban: the player who rebuilds a cushion may invest again, which
 * is what makes the comeback arc reachable rather than merely long.
 */
export function direInvestingBlocked(
  dire: DireState | null,
  weekIndex: number,
  cashCents: number,
  monthlyExpensesCents: number,
): boolean {
  if (!direForcedBudget(dire, weekIndex)) return false;
  if (monthlyExpensesCents <= 0) return false;
  return cashCents / monthlyExpensesCents < (dire?.investingBlockedUntilCashMonths ?? 0);
}

/** Wage garnishment on gross pay while secured debt is outstanding. */
export function garnishmentCents(
  dire: DireState | null,
  weeklyGrossCents: number,
  securedDebtOutstanding: boolean,
): number {
  if (dire === null || !securedDebtOutstanding) return 0;
  return Math.round(weeklyGrossCents * dire.garnishmentPct);
}

/**
 * Apply the credit ceiling to a computed score.
 *
 * **Retirement balances are protected from discharge** (§13), and the
 * early-withdrawal option stays available and is deliberately surfaced during
 * forced budget mode — taking it is the trap inside the trap.
 */
export function applyDireCreditCeiling(
  score: number | null,
  dire: DireState | null,
  weekIndex: number,
): number | null {
  if (score === null || dire === null) return score;
  return clamp(score, 0, direCreditCeiling(dire, weekIndex));
}
