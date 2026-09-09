/**
 * Starting positions — GDD §3.7.
 *
 * The assignment is a **hash, not a draw**. `startingDraw` is consumed in a
 * contractual order, so a draw inserted here would shift the entry credit score
 * of every existing seed; `fnv1a` over the seed consumes nothing and still
 * changes when Reroll changes it. Nothing in this file may touch an RNG stream.
 *
 * Content owns `starts.json` and its schema; the engine owns what a start is,
 * the same split `JobDef` has.
 */
import { DEFAULT_LOAN_TERM_MONTHS, type LoanType, loanApr, openAmortizingLoan } from './debt/amortizing.ts';
import { openCreditCard } from './debt/creditCard.ts';
import type { Debt } from './debt/types.ts';
import { fnv1a } from './rng.ts';

/**
 * A debt a start opens with. `student` is a `LoanType` but not a
 * `DebtInstrument`, so these are built directly rather than through
 * `openDebtFromInstrument`.
 */
export type StartingDebtDef =
  | {
      readonly kind: 'credit-card';
      readonly balanceCents: number;
      readonly creditLimitCents: number;
    }
  | {
      readonly kind: 'loan';
      readonly loanType: LoanType;
      readonly principalCents: number;
      readonly termMonths?: number;
    };

export interface StartPosition {
  readonly startingCashCents: number;
  /** `null` starts the run out of work. Granted directly: no application. */
  readonly startingJobId: string | null;
  readonly educationYears: number;
  readonly committedTimePoints: number;
  readonly debts: readonly StartingDebtDef[];
}

export interface StartDef extends StartPosition {
  /** Stable forever. Renaming one silently changes what a seed deals. */
  readonly id: string;
  readonly label: string;
  /** One plain sentence. It states the position; it never rates it (GDD §1). */
  readonly blurb: string;
  /**
   * Alternative positions this start may deal — only §3.7's Life Draw has any.
   * Whole positions rather than per-field draws, so every life dealt is coherent.
   */
  readonly variants?: readonly Partial<StartPosition>[];
}

export function assignedStart(starts: readonly StartDef[], seed: string): StartDef {
  return starts[fnv1a(`${seed}:start`) % starts.length];
}

export function resolveStart(start: StartDef, seed: string): StartPosition {
  const positions: readonly Partial<StartPosition>[] = [{}, ...(start.variants ?? [])];
  const variant = positions[fnv1a(`${seed}:start:variant`) % positions.length];
  return {
    startingCashCents: variant.startingCashCents ?? start.startingCashCents,
    startingJobId: variant.startingJobId === undefined ? start.startingJobId : variant.startingJobId,
    educationYears: variant.educationYears ?? start.educationYears,
    committedTimePoints: variant.committedTimePoints ?? start.committedTimePoints,
    debts: variant.debts ?? start.debts,
  };
}

/**
 * Priced against a null credit score: at week 0 there is no file to price
 * against, the same thin-file treatment §5.5 gives everywhere else.
 */
export function buildStartingDebts(
  defs: readonly StartingDebtDef[],
  openedWeek = 0,
): readonly Debt[] {
  return defs.map((def, index) => {
    const id = `start-${index}`;
    if (def.kind === 'credit-card') {
      return openCreditCard({
        id,
        creditLimitCents: def.creditLimitCents,
        openedWeek,
        carriedBalanceCents: def.balanceCents,
      });
    }
    return openAmortizingLoan({
      id,
      loanType: def.loanType,
      principalCents: def.principalCents,
      aprAnnual: loanApr(def.loanType, null),
      termMonths: def.termMonths ?? DEFAULT_LOAN_TERM_MONTHS[def.loanType],
      openedWeek,
    });
  });
}
