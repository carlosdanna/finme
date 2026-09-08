/**
 * Opening a debt from the instrument name an event or chain declares.
 *
 * Content names a *product* (`"PERSONAL_LOAN"`), not a schedule and not a rate.
 * This is where that name becomes a real instrument, priced against the credit
 * score the player actually has — which is what makes "your credit score gates
 * your borrowing costs" a thing the player can feel rather than be told.
 */
import { DEFAULT_LOAN_TERM_MONTHS, type LoanType, loanApr, openAmortizingLoan } from './amortizing.ts';
import { openBnplPlan } from './bnpl.ts';
import { type CreditCard, availableCreditCents, chargeCard } from './creditCard.ts';
import { openPaydayLoan } from './payday.ts';
import type { Debt, DebtInstrument } from './types.ts';

const LOAN_TYPE_FOR: Readonly<Partial<Record<DebtInstrument, LoanType>>> = {
  PERSONAL_LOAN: 'personal',
  AUTO_LOAN: 'auto',
  MORTGAGE: 'mortgage',
};

export interface OpenDebtOptions {
  readonly weekIndex: number;
  readonly creditScore: number | null;
  /**
   * Disambiguates two debts opened in the same week, so ids stay unique and
   * stable across a replay. The caller passes the index within the outcome.
   */
  readonly sequence: number;
}

export interface OpenDebtResult {
  readonly debts: readonly Debt[];
  /**
   * What no instrument could absorb — a card charge with no card, or one past
   * its limit. The caller books it as an unpaid bill rather than dropping it:
   * a declined card does not make the cost go away.
   */
  readonly unabsorbedCents: number;
}

/**
 * Open (or draw on) the named instrument for `principalCents`.
 *
 * `CREDIT_CARD` is the one instrument that draws on something existing rather
 * than opening something new — "put it on the card" means the card the player
 * already has. Every other instrument is a new line.
 */
export function openDebtFromInstrument(
  debts: readonly Debt[],
  instrument: DebtInstrument,
  principalCents: number,
  options: OpenDebtOptions,
): OpenDebtResult {
  const amount = Math.round(principalCents);
  if (amount <= 0) return { debts, unabsorbedCents: 0 };

  const id = `${instrument.toLowerCase()}-${options.weekIndex}-${options.sequence}`;

  if (instrument === 'CREDIT_CARD') {
    // In open order, never sorted by balance: payment and charge order must not
    // depend on how the market moved.
    const index = debts.findIndex(
      (debt) => debt.kind === 'credit-card' && availableCreditCents(debt as CreditCard) >= amount,
    );
    if (index === -1) return { debts, unabsorbedCents: amount };

    const charged = chargeCard(debts[index] as CreditCard, amount);
    if (charged === null) return { debts, unabsorbedCents: amount };
    return { debts: debts.map((debt, i) => (i === index ? charged : debt)), unabsorbedCents: 0 };
  }

  if (instrument === 'BNPL') {
    return {
      debts: [...debts, openBnplPlan({ id, purchaseAmountCents: amount, purchaseWeek: options.weekIndex })],
      unabsorbedCents: 0,
    };
  }

  if (instrument === 'PAYDAY') {
    return {
      debts: [...debts, openPaydayLoan({ id, principalCents: amount, weekIndex: options.weekIndex })],
      unabsorbedCents: 0,
    };
  }

  const loanType = LOAN_TYPE_FOR[instrument]!;
  return {
    debts: [
      ...debts,
      openAmortizingLoan({
        id,
        loanType,
        principalCents: amount,
        aprAnnual: loanApr(loanType, options.creditScore),
        termMonths: DEFAULT_LOAN_TERM_MONTHS[loanType],
        openedWeek: options.weekIndex,
      }),
    ],
    unabsorbedCents: 0,
  };
}
