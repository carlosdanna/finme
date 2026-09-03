/**
 * Payday loan — TDD §5.4.
 *
 * Fee-structured rather than APR-structured, because that is how the real
 * product hides its cost. The Debts panel shows the fee prominently and the
 * effective APR in the same size type, without comment.
 */
import type { Debt } from './types.ts';

/** [T] $15 per $100 borrowed. */
export const PAYDAY_FEE_RATE = 0.15;

/** [F] A two-week term. */
export const PAYDAY_TERM_WEEKS = 2;

/** The APR the fee implies: 0.15 × (52 / 2) = 390%. */
export const PAYDAY_EFFECTIVE_APR = PAYDAY_FEE_RATE * (52 / PAYDAY_TERM_WEEKS);

export interface PaydayLoan extends Debt {
  readonly kind: 'payday';
  /** Untouched by rollovers. That is the entire point of the instrument. */
  readonly principalCents: number;
  /** The fee due at the current term. */
  readonly feeCents: number;
  /** Fees handed over across every rollover so far. */
  readonly feesPaidCents: number;
  readonly rollovers: number;
  readonly dueWeek: number;
}

export function paydayFeeCents(principalCents: number): number {
  return Math.round(principalCents * PAYDAY_FEE_RATE);
}

export function openPaydayLoan(options: {
  id: string;
  principalCents: number;
  weekIndex: number;
}): PaydayLoan {
  const feeCents = paydayFeeCents(options.principalCents);
  return {
    id: options.id,
    kind: 'payday',
    balanceCents: options.principalCents + feeCents,
    aprAnnual: PAYDAY_EFFECTIVE_APR,
    openedWeek: options.weekIndex,
    principalCents: options.principalCents,
    feeCents,
    feesPaidCents: 0,
    rollovers: 0,
    dueWeek: options.weekIndex + PAYDAY_TERM_WEEKS,
  };
}

/**
 * Roll the loan over at term: pay this term's fee, and a fresh fee is charged on
 * the full principal for another two weeks.
 *
 * Three rollovers and the player has paid 45% of principal in fees with the
 * principal untouched. The Logbook notices this dryly and says nothing else.
 */
export function rollover(loan: PaydayLoan): { loan: PaydayLoan; feePaidCents: number } {
  const feePaidCents = loan.feeCents;
  // The new fee is charged on the full principal, which never went down.
  const feeCents = paydayFeeCents(loan.principalCents);

  return {
    loan: {
      ...loan,
      feesPaidCents: loan.feesPaidCents + feePaidCents,
      feeCents,
      rollovers: loan.rollovers + 1,
      dueWeek: loan.dueWeek + PAYDAY_TERM_WEEKS,
      balanceCents: loan.principalCents + feeCents,
    },
    feePaidCents,
  };
}

/** Clear the loan: principal plus the fee owed at the current term. */
export function repayInFullCents(loan: PaydayLoan): number {
  return loan.principalCents + loan.feeCents;
}

/** Every fee this loan has cost, including the one currently owed. */
export function totalFeeCostCents(loan: PaydayLoan): number {
  return loan.feesPaidCents + loan.feeCents;
}

/** Fees paid so far as a share of principal — 0.45 after three rollovers. */
export function feesAsShareOfPrincipal(loan: PaydayLoan): number {
  if (loan.principalCents === 0) return 0;
  return loan.feesPaidCents / loan.principalCents;
}
