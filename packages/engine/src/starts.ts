/**
 * Starting positions — GDD §3.7.
 *
 * The player is **assigned** a start, never offered one: a chosen start breaks
 * seed reproducibility on turn 1. The assignment is therefore a **hash, not a
 * draw**. `startingDraw` is consumed in a contractual order (names, then the
 * entry credit score) and inserting a draw there would shift the credit score of
 * every existing seed; `fnv1a` over the seed consumes nothing and still changes
 * when Reroll changes the seed.
 *
 * The type and the arithmetic live here for the same reason `JobDef` does:
 * content owns `starts.json` and its schema, the engine owns what a start *is*.
 * Nothing in this file is allowed to touch an RNG stream.
 */
import { DEFAULT_LOAN_TERM_MONTHS, type LoanType, loanApr, openAmortizingLoan } from './debt/amortizing.ts';
import { openCreditCard } from './debt/creditCard.ts';
import type { Debt } from './debt/types.ts';
import { fnv1a } from './rng.ts';

/**
 * A debt a start opens with.
 *
 * `student` is a `LoanType` but not a `DebtInstrument`, so this is built
 * directly rather than through `openDebtFromInstrument` — which is also why the
 * instrument vocabulary is not reused here.
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

/** The part of a start that is the position itself, rather than its name. */
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
   * Alternative positions this start may deal, on top of the declared one.
   *
   * Only §3.7's Life Draw row has any. The draw is over *whole positions* rather
   * than over each field independently, so every life it deals is a coherent
   * one rather than an arithmetic accident.
   */
  readonly variants?: readonly Partial<StartPosition>[];
}

/** Which start a seed is dealt. A pure function of the seed — it draws nothing. */
export function assignedStart(starts: readonly StartDef[], seed: string): StartDef {
  return starts[fnv1a(`${seed}:start`) % starts.length];
}

/** The position a start deals for this seed, after any variant it may carry. */
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
 * Build the debts a start opens with.
 *
 * Priced against a null credit score, because at week 0 there is no file to
 * price against — the same treatment a thin file gets everywhere else (§5.5).
 * `createRun` folds an `openCreditLine` in for each of these, so a run that
 * begins owing money begins with a credit file that knows about it.
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
