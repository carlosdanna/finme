/** Debt instruments — TDD §5.1-5.4. One file per instrument, one shared shape. */
export type { Debt, DebtKind } from './types.ts';
export { monthlyRate, totalLiabilitiesCents, creditQuality } from './types.ts';

export { payoffMonths, totalPaidCents } from './payoff.ts';

export {
  CARD_BASE_APR,
  CARD_MAX_RATE_ADJUSTMENT,
  CARD_MIN_PAYMENT_PCT,
  CARD_MIN_PAYMENT_FLOOR_CENTS,
  cardApr,
  openCreditCard,
  statementInterestCents,
  minimumPaymentCents,
  availableCreditCents,
  chargeCard,
  closeStatement,
  cardPayoffMonths,
} from './creditCard.ts';
export type { CreditCard, StatementResult } from './creditCard.ts';

export {
  PERSONAL_LOAN_BASE_APR,
  AUTO_LOAN_BASE_APR,
  STUDENT_LOAN_APR,
  MORTGAGE_BASE_APR,
  MORTGAGE_MIN_DOWN_PAYMENT_PCT,
  MORTGAGE_MIN_CREDIT_SCORE,
  loanApr,
  monthlyPaymentCents,
  openAmortizingLoan,
  payMonth,
  amortizationSchedule,
  totalInterestCents,
  mortgageEligible,
  capitalizeStudentInterest,
} from './amortizing.ts';
export type { AmortizingLoan, AmortizationEntry, LoanType } from './amortizing.ts';

export {
  BNPL_INSTALLMENTS,
  BNPL_INSTALLMENT_WEEKS,
  BNPL_LATE_FEE_CENTS,
  BNPL_FREEZE_WEEKS,
  BNPL_MISS_CREDIT_IMPACT,
  BNPL_COLLECTIONS_CREDIT_IMPACT,
  BNPL_STRIKES_TO_COLLECTIONS,
  openBnplPlan,
  installmentDueWeeks,
  installmentAmountCents,
  payInstallment,
  missInstallment,
  canOpenNewPlan,
} from './bnpl.ts';
export type { BnplPlan, BnplStatus, MissResult } from './bnpl.ts';

export {
  PAYDAY_FEE_RATE,
  PAYDAY_TERM_WEEKS,
  PAYDAY_EFFECTIVE_APR,
  paydayFeeCents,
  openPaydayLoan,
  rollover,
  repayInFullCents,
  totalFeeCostCents,
  feesAsShareOfPrincipal,
} from './payday.ts';
export type { PaydayLoan } from './payday.ts';
