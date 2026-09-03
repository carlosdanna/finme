/**
 * Amortizing loans — TDD §5.2. Personal, auto, student, mortgage.
 *
 * The Debts panel shows the interest/principal split on every payment. On a
 * 30-year mortgage the first payment is about 78% interest; that is the
 * amortization lesson and it needs no commentary.
 */
import { type Debt, creditQuality, monthlyRate } from './types.ts';

export type LoanType = 'personal' | 'auto' | 'student' | 'mortgage';

/** [T] Rate tables from §5.2. Better credit buys a lower rate. */
export const PERSONAL_LOAN_BASE_APR = 0.13;
export const PERSONAL_LOAN_CREDIT_DISCOUNT = 0.06;
export const AUTO_LOAN_BASE_APR = 0.11;
export const AUTO_LOAN_CREDIT_DISCOUNT = 0.055;
export const STUDENT_LOAN_APR = 0.045;
export const MORTGAGE_BASE_APR = 0.075;
export const MORTGAGE_CREDIT_DISCOUNT = 0.02;

/** [T] A mortgage needs at least 10% down and a score of 620. */
export const MORTGAGE_MIN_DOWN_PAYMENT_PCT = 0.1;
export const MORTGAGE_MIN_CREDIT_SCORE = 620;

export interface AmortizingLoan extends Debt {
  readonly kind: 'amortizing';
  readonly loanType: LoanType;
  readonly originalPrincipalCents: number;
  readonly termMonths: number;
  readonly monthlyPaymentCents: number;
  readonly monthsPaid: number;
}

/** The APR a given loan type is offered at, for a given credit score. */
export function loanApr(loanType: LoanType, creditScore: number | null): number {
  const quality = creditQuality(creditScore);
  switch (loanType) {
    case 'personal':
      return PERSONAL_LOAN_BASE_APR - PERSONAL_LOAN_CREDIT_DISCOUNT * quality;
    case 'auto':
      return AUTO_LOAN_BASE_APR - AUTO_LOAN_CREDIT_DISCOUNT * quality;
    case 'student':
      return STUDENT_LOAN_APR;
    case 'mortgage':
      return MORTGAGE_BASE_APR - MORTGAGE_CREDIT_DISCOUNT * quality;
  }
}

/**
 * The level monthly payment that retires `principal` over `termMonths`:
 *
 *   payment = principal · r / (1 − (1 + r)^(−n))
 */
export function monthlyPaymentCents(
  principalCents: number,
  aprAnnual: number,
  termMonths: number,
): number {
  if (termMonths <= 0) return principalCents;
  const rate = monthlyRate(aprAnnual);
  // An interest-free loan just divides.
  if (rate === 0) return Math.round(principalCents / termMonths);
  return Math.round((principalCents * rate) / (1 - Math.pow(1 + rate, -termMonths)));
}

export function openAmortizingLoan(options: {
  id: string;
  loanType: LoanType;
  principalCents: number;
  aprAnnual: number;
  termMonths: number;
  openedWeek: number;
}): AmortizingLoan {
  return {
    id: options.id,
    kind: 'amortizing',
    loanType: options.loanType,
    balanceCents: options.principalCents,
    originalPrincipalCents: options.principalCents,
    aprAnnual: options.aprAnnual,
    termMonths: options.termMonths,
    monthlyPaymentCents: monthlyPaymentCents(
      options.principalCents,
      options.aprAnnual,
      options.termMonths,
    ),
    monthsPaid: 0,
    openedWeek: options.openedWeek,
  };
}

export interface AmortizationEntry {
  /** 1-based. */
  readonly month: number;
  readonly paymentCents: number;
  readonly interestCents: number;
  readonly principalCents: number;
  readonly balanceAfterCents: number;
}

/**
 * Apply one scheduled monthly payment.
 *
 * The final payment absorbs the rounding remainder, so the loan retires in
 * exactly `termMonths` rather than leaving a few cents outstanding.
 */
export function payMonth(loan: AmortizingLoan): { loan: AmortizingLoan; entry: AmortizationEntry } {
  const rate = monthlyRate(loan.aprAnnual);
  const interestCents = Math.round(loan.balanceCents * rate);
  const isFinalMonth = loan.monthsPaid + 1 >= loan.termMonths;

  const paymentCents = isFinalMonth
    ? loan.balanceCents + interestCents
    : Math.min(loan.monthlyPaymentCents, loan.balanceCents + interestCents);

  const principalCents = paymentCents - interestCents;
  const balanceAfterCents = Math.max(0, loan.balanceCents - principalCents);

  return {
    loan: { ...loan, balanceCents: balanceAfterCents, monthsPaid: loan.monthsPaid + 1 },
    entry: {
      month: loan.monthsPaid + 1,
      paymentCents,
      interestCents,
      principalCents,
      balanceAfterCents,
    },
  };
}

/** The whole schedule, for the Debts panel's interest/principal split. */
export function amortizationSchedule(loan: AmortizingLoan): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  let current = loan;
  while (current.monthsPaid < current.termMonths) {
    const result = payMonth(current);
    entries.push(result.entry);
    current = result.loan;
  }
  return entries;
}

/** Total interest paid across the life of the loan. */
export function totalInterestCents(loan: AmortizingLoan): number {
  return amortizationSchedule(loan).reduce((sum, entry) => sum + entry.interestCents, 0);
}

/** Whether a mortgage can be written at all (§5.2). */
export function mortgageEligible(
  downPaymentCents: number,
  homePriceCents: number,
  creditScore: number | null,
): boolean {
  if (creditScore === null || creditScore < MORTGAGE_MIN_CREDIT_SCORE) return false;
  return downPaymentCents >= homePriceCents * MORTGAGE_MIN_DOWN_PAYMENT_PCT;
}

/**
 * Student loan interest accrues during study and capitalizes when repayment
 * starts — the balance the player begins repaying is larger than the amount
 * borrowed (§5.2).
 */
export function capitalizeStudentInterest(
  principalCents: number,
  weeksInStudy: number,
  aprAnnual = STUDENT_LOAN_APR,
): number {
  const months = weeksInStudy / (52 / 12);
  return Math.round(principalCents * Math.pow(1 + monthlyRate(aprAnnual), months));
}
