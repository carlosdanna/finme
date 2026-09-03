/**
 * Credit card — TDD §5.1.
 *
 * The grace period is what makes this a trap rather than an obvious mistake: a
 * card paid in full every month is genuinely free. The cost only appears once a
 * statement carries.
 */
import { type Debt, monthlyRate } from './types.ts';
import { payoffMonths } from './payoff.ts';

/** [T] Base APR. `creditRateAdjustment` runs 0..0.09, giving 18%..27%. */
export const CARD_BASE_APR = 0.18;
export const CARD_MAX_RATE_ADJUSTMENT = 0.09;

/** [T] Minimum payment is 2% of balance plus interest, with a $25 floor. */
export const CARD_MIN_PAYMENT_PCT = 0.02;
export const CARD_MIN_PAYMENT_FLOOR_CENTS = 2_500;

export interface CreditCard extends Debt {
  readonly kind: 'credit-card';
  readonly creditLimitCents: number;
  /** The balance interest is charged on — what the last statement closed at. */
  readonly statementBalanceCents: number;
  /** Purchases since the last statement closed. */
  readonly newChargesCents: number;
  /**
   * True when the previous statement was paid in full, so new purchases accrue
   * no interest.
   */
  readonly inGracePeriod: boolean;
}

export function cardApr(creditRateAdjustment: number): number {
  return CARD_BASE_APR + Math.min(Math.max(creditRateAdjustment, 0), CARD_MAX_RATE_ADJUSTMENT);
}

export function openCreditCard(options: {
  id: string;
  creditLimitCents: number;
  openedWeek: number;
  creditRateAdjustment?: number;
}): CreditCard {
  return {
    id: options.id,
    kind: 'credit-card',
    balanceCents: 0,
    aprAnnual: cardApr(options.creditRateAdjustment ?? 0),
    openedWeek: options.openedWeek,
    creditLimitCents: options.creditLimitCents,
    statementBalanceCents: 0,
    newChargesCents: 0,
    // A new card has nothing carried, so its first purchases are in grace.
    inGracePeriod: true,
  };
}

/** Interest that will be charged when the statement closes. */
export function statementInterestCents(card: CreditCard): number {
  if (card.inGracePeriod) return 0;
  return Math.round(card.statementBalanceCents * monthlyRate(card.aprAnnual));
}

/** The minimum due: `max($25, 2% of balance + interest)`. */
export function minimumPaymentCents(card: CreditCard): number {
  if (card.balanceCents <= 0) return 0;
  const scheduled =
    Math.round(card.balanceCents * CARD_MIN_PAYMENT_PCT) + statementInterestCents(card);
  return Math.min(card.balanceCents, Math.max(CARD_MIN_PAYMENT_FLOOR_CENTS, scheduled));
}

/** Available headroom, floored at zero. */
export function availableCreditCents(card: CreditCard): number {
  return Math.max(0, card.creditLimitCents - card.balanceCents);
}

/**
 * Put a purchase on the card. Rejected if it would exceed the limit — the
 * caller decides what to do about that.
 */
export function chargeCard(card: CreditCard, amountCents: number): CreditCard | null {
  if (amountCents <= 0) return card;
  if (amountCents > availableCreditCents(card)) return null;
  return {
    ...card,
    newChargesCents: card.newChargesCents + amountCents,
    balanceCents: card.balanceCents + amountCents,
  };
}

export interface StatementResult {
  readonly card: CreditCard;
  readonly interestChargedCents: number;
  readonly paidCents: number;
  /** True when the payment cleared the whole statement, extending grace. */
  readonly paidInFull: boolean;
}

/**
 * Close a statement at a month boundary (TDD §5.1):
 *
 *   interest   = statementBalance · monthlyRate   (nil while in grace)
 *   newBalance = statementBalance + interest + newCharges − payment
 */
export function closeStatement(card: CreditCard, paymentCents: number): StatementResult {
  const interestChargedCents = statementInterestCents(card);

  // The statement that closes is everything carried, plus interest on it, plus
  // what was charged during the cycle.
  const owedCents = card.statementBalanceCents + interestChargedCents + card.newChargesCents;
  // Overpaying clears the card; it does not create a credit balance.
  const paidCents = Math.min(Math.max(paymentCents, 0), owedCents);
  const balanceCents = owedCents - paidCents;

  // Grace continues only when the statement was cleared outright. Paying the
  // carried balance but not this cycle's purchases is not paying in full.
  const paidInFull = balanceCents === 0;

  return {
    card: {
      ...card,
      balanceCents,
      statementBalanceCents: balanceCents,
      newChargesCents: 0,
      inGracePeriod: paidInFull,
    },
    interestChargedCents,
    paidCents,
    paidInFull,
  };
}

/**
 * Months until the card clears at a fixed monthly payment, or `null` for
 * "Never" — see payoff.ts.
 */
export function cardPayoffMonths(card: CreditCard, paymentCents: number): number | null {
  return payoffMonths(card.balanceCents, monthlyRate(card.aprAnnual), paymentCents);
}
