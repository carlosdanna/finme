/**
 * The shape every debt instrument shares — TDD §5.
 *
 * Rates are stored annualized nominal and converted at point of use; balances
 * are integer cents. Every operation in this directory is pure: it returns new
 * state rather than mutating, so a tick can be replayed.
 */

export type DebtKind = 'credit-card' | 'amortizing' | 'bnpl' | 'payday' | 'collections';

/**
 * The instruments an event or chain may name when it opens a debt.
 *
 * Declared once, here, with the type derived from it and the content Zod enum
 * deriving from the same array — the `CREDIT_EVENT_KINDS` pattern. Spelled out
 * separately in three places, adding one type-checked in two of them and was
 * rejected at content load by the third.
 *
 * This is the *product* vocabulary, not `DebtKind`'s *mechanics* vocabulary:
 * a personal loan and a mortgage are both `kind: 'amortizing'` and amortize
 * identically, but they are not the same product and do not price the same.
 */
export const DEBT_INSTRUMENTS = [
  'CREDIT_CARD',
  'PERSONAL_LOAN',
  'AUTO_LOAN',
  'MORTGAGE',
  'BNPL',
  'PAYDAY',
] as const;

export type DebtInstrument = (typeof DEBT_INSTRUMENTS)[number];

export interface Debt {
  readonly id: string;
  readonly kind: DebtKind;
  /** What would have to be paid today to clear it. Never negative. */
  readonly balanceCents: number;
  /**
   * Annualized nominal rate. For a payday loan this is the effective APR its
   * fee implies — the number the Debts panel shows beside the fee, same size
   * type, no comment.
   */
  readonly aprAnnual: number;
  readonly openedWeek: number;
}

/** Monthly rate from an annual one. Never mix the two within an instrument. */
export function monthlyRate(aprAnnual: number): number {
  return aprAnnual / 12;
}

/** Everything owed, for the balance sheet (§4.2). */
export function totalLiabilitiesCents(debts: readonly Debt[]): number {
  return debts.reduce((sum, debt) => sum + debt.balanceCents, 0);
}

/**
 * Credit quality in 0..1, from a credit score. Drives the rate on every
 * amortizing loan (§5.2).
 *
 * A thin file — no score yet, before 26 weeks (§5.5) — is treated as the worst
 * quality rather than the average. A lender with no history prices for risk.
 */
export function creditQuality(score: number | null): number {
  if (score === null) return 0;
  return Math.min(Math.max((score - 580) / 270, 0), 1);
}
