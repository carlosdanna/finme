import { describe, expect, it } from 'vitest';
import {
  AUTO_LOAN_BASE_APR,
  BNPL_COLLECTIONS_CREDIT_IMPACT,
  BNPL_FREEZE_WEEKS,
  BNPL_INSTALLMENTS,
  BNPL_LATE_FEE_CENTS,
  BNPL_MISS_CREDIT_IMPACT,
  CARD_MIN_PAYMENT_FLOOR_CENTS,
  MORTGAGE_MIN_CREDIT_SCORE,
  PAYDAY_EFFECTIVE_APR,
  PAYDAY_FEE_RATE,
  PAYDAY_TERM_WEEKS,
  PERSONAL_LOAN_BASE_APR,
  STUDENT_LOAN_APR,
  amortizationSchedule,
  availableCreditCents,
  canOpenNewPlan,
  cardPayoffMonths,
  chargeCard,
  closeStatement,
  creditQuality,
  feesAsShareOfPrincipal,
  installmentAmountCents,
  installmentDueWeeks,
  loanApr,
  minimumPaymentCents,
  missInstallment,
  monthlyPaymentCents,
  mortgageEligible,
  openAmortizingLoan,
  openBnplPlan,
  openCreditCard,
  openPaydayLoan,
  payInstallment,
  payoffMonths,
  rollover,
  statementInterestCents,
  totalLiabilitiesCents,
} from '../src/debt/index.ts';

describe('credit card (TDD §5.1)', () => {
  const card = () => openCreditCard({ id: 'cc', creditLimitCents: 500_000, openedWeek: 0 });

  it('prices between 18% and 27%', () => {
    expect(openCreditCard({ id: 'a', creditLimitCents: 1, openedWeek: 0 }).aprAnnual).toBe(0.18);
    expect(
      openCreditCard({ id: 'b', creditLimitCents: 1, openedWeek: 0, creditRateAdjustment: 0.09 })
        .aprAnnual,
    ).toBeCloseTo(0.27, 12);
    // Out-of-range adjustments clamp rather than escaping the band.
    expect(
      openCreditCard({ id: 'c', creditLimitCents: 1, openedWeek: 0, creditRateAdjustment: 5 })
        .aprAnnual,
    ).toBeCloseTo(0.27, 12);
  });

  it('charges no interest while the grace period holds', () => {
    // A card used well is genuinely free — which is what makes it a trap rather
    // than an obvious mistake.
    let c = chargeCard(card(), 100_000)!;
    expect(c.balanceCents).toBe(100_000);
    expect(statementInterestCents(c)).toBe(0);

    const first = closeStatement(c, 100_000);
    expect(first.interestChargedCents).toBe(0);
    expect(first.paidInFull).toBe(true);
    expect(first.card.balanceCents).toBe(0);

    // Second month, paid in full again: still free.
    c = chargeCard(first.card, 50_000)!;
    const second = closeStatement(c, 50_000);
    expect(second.interestChargedCents).toBe(0);
  });

  it('charges interest on the statement balance once grace is broken', () => {
    const c = chargeCard(card(), 100_000)!;
    // Pay less than the full statement: grace ends.
    const missed = closeStatement(c, 20_000);
    expect(missed.paidInFull).toBe(false);
    expect(missed.card.balanceCents).toBe(80_000);
    expect(missed.card.inGracePeriod).toBe(false);

    // Next month interest lands on the carried balance.
    const carried = closeStatement(missed.card, 0);
    expect(carried.interestChargedCents).toBe(Math.round(80_000 * (0.18 / 12)));
    expect(carried.card.balanceCents).toBe(80_000 + carried.interestChargedCents);
  });

  it('restores grace only when the whole statement is cleared', () => {
    const c = chargeCard(card(), 100_000)!;
    const missed = closeStatement(c, 20_000);
    const cleared = closeStatement(missed.card, missed.card.balanceCents + 1_200);
    expect(cleared.paidInFull).toBe(true);
    expect(cleared.card.inGracePeriod).toBe(true);
    expect(cleared.card.balanceCents).toBe(0);
  });

  it('takes the minimum payment as max($25, 2% + interest)', () => {
    const small = closeStatement(chargeCard(card(), 50_000)!, 0);
    // 2% of $500 is $10, so the $25 floor binds.
    expect(minimumPaymentCents(small.card)).toBe(CARD_MIN_PAYMENT_FLOOR_CENTS);

    const large = closeStatement(chargeCard(card(), 400_000)!, 0);
    const balance = large.card.balanceCents;
    expect(minimumPaymentCents(large.card)).toBe(
      Math.round(balance * 0.02) + statementInterestCents(large.card),
    );
    expect(minimumPaymentCents(large.card)).toBeGreaterThan(CARD_MIN_PAYMENT_FLOOR_CENTS);
  });

  it('owes nothing on a cleared card', () => {
    expect(minimumPaymentCents(card())).toBe(0);
  });

  it('refuses a charge beyond the limit rather than silently allowing it', () => {
    expect(availableCreditCents(card())).toBe(500_000);
    expect(chargeCard(card(), 500_001)).toBeNull();
    expect(chargeCard(card(), 500_000)!.balanceCents).toBe(500_000);
  });

  it('does not create a credit balance on overpayment', () => {
    const c = chargeCard(card(), 10_000)!;
    expect(closeStatement(c, 999_999).card.balanceCents).toBe(0);
  });
});

describe('the payoff projection (TDD §5.1)', () => {
  it('returns "Never" when the payment does not cover the interest', () => {
    const balance = 500_000; // $5,000
    const rate = 0.18 / 12;
    const monthlyInterest = balance * rate; // $75

    // Below, and exactly at, the interest: the balance never moves.
    expect(payoffMonths(balance, rate, Math.floor(monthlyInterest) - 1)).toBeNull();
    expect(payoffMonths(balance, rate, monthlyInterest)).toBeNull();
    // A single cent more and it clears — eventually.
    expect(payoffMonths(balance, rate, monthlyInterest + 1)).not.toBeNull();
  });

  it('returns "Never" for a minimum payment that trails the interest', () => {
    const card = closeStatement(
      chargeCard(openCreditCard({ id: 'cc', creditLimitCents: 2_000_000, openedWeek: 0 }), 1_500_000)!,
      0,
    ).card;
    // Paying the interest and not a cent more.
    expect(cardPayoffMonths(card, statementInterestCents(card))).toBeNull();
  });

  it('projects a finite payoff for a payment that touches principal', () => {
    const months = payoffMonths(500_000, 0.18 / 12, 25_000);
    expect(months).not.toBeNull();
    expect(months!).toBeGreaterThan(20);
    expect(months!).toBeLessThan(30);
  });

  it('takes longer as the payment shrinks toward the interest', () => {
    const rate = 0.18 / 12;
    const at500 = payoffMonths(500_000, rate, 50_000)!;
    const at250 = payoffMonths(500_000, rate, 25_000)!;
    const at100 = payoffMonths(500_000, rate, 10_000)!;
    expect(at250).toBeGreaterThan(at500);
    expect(at100).toBeGreaterThan(at250);
  });

  it('handles the trivial cases', () => {
    expect(payoffMonths(0, 0.18 / 12, 10_000)).toBe(0);
    expect(payoffMonths(100_000, 0.18 / 12, 0)).toBeNull();
    expect(payoffMonths(100_000, 0, 10_000)).toBe(10); // interest-free
  });
});

describe('amortizing loans (TDD §5.2)', () => {
  it('fully retires principal in exactly termMonths', () => {
    const cases = [
      { loanType: 'personal' as const, principalCents: 1_000_000, aprAnnual: 0.13, termMonths: 24 },
      { loanType: 'auto' as const, principalCents: 2_500_000, aprAnnual: 0.075, termMonths: 60 },
      { loanType: 'student' as const, principalCents: 3_000_000, aprAnnual: STUDENT_LOAN_APR, termMonths: 120 },
      { loanType: 'mortgage' as const, principalCents: 32_000_000, aprAnnual: 0.065, termMonths: 360 },
      { loanType: 'mortgage' as const, principalCents: 32_000_000, aprAnnual: 0.065, termMonths: 180 },
    ];

    for (const spec of cases) {
      const loan = openAmortizingLoan({ id: 'l', openedWeek: 0, ...spec });
      const schedule = amortizationSchedule(loan);

      expect(schedule).toHaveLength(spec.termMonths);
      expect(schedule[spec.termMonths - 1].balanceAfterCents).toBe(0);
      // And not a month early either.
      expect(schedule[spec.termMonths - 2].balanceAfterCents).toBeGreaterThan(0);

      // Principal portions sum to exactly the amount borrowed.
      const principalPaid = schedule.reduce((sum, e) => sum + e.principalCents, 0);
      expect(principalPaid).toBe(spec.principalCents);
    }
  });

  /** The first payment's interest share, for a 30-year mortgage at `apr`. */
  const firstPaymentInterestShare = (aprAnnual: number, termMonths = 360, principalCents = 32_000_000) => {
    const loan = openAmortizingLoan({
      id: 'm',
      loanType: 'mortgage',
      principalCents,
      aprAnnual,
      termMonths,
      openedWeek: 0,
    });
    const first = amortizationSchedule(loan)[0];
    return first.interestCents / first.paymentCents;
  };

  it('makes a 30-year mortgage first payment 75-80% interest at a 2010s-era rate', () => {
    // The share is exactly 1 - (1+r)^-n, so the band 75-80% is the APR band
    // 4.63%-5.38%. §5.2 originally claimed "~78%", which is 5.06% — a rate the
    // table cannot reach. The amortization math is right; §5.2 has since been
    // corrected to the 81-89% the table actually produces.
    expect(firstPaymentInterestShare(0.0506)).toBeGreaterThan(0.75);
    expect(firstPaymentInterestShare(0.0506)).toBeLessThan(0.8);
    expect(firstPaymentInterestShare(0.0506)).toBeCloseTo(0.78, 2);

    expect(firstPaymentInterestShare(0.0463)).toBeCloseTo(0.75, 2);
    expect(firstPaymentInterestShare(0.0538)).toBeCloseTo(0.8, 2);
  });

  it('is 81-90% interest at the rates §5.2 actually offers', () => {
    // The rate table floors at 5.5% for perfect credit, which is already 80.7%,
    // and runs to 89.4% on a thin file. §5.2 now states this.
    expect(firstPaymentInterestShare(loanApr('mortgage', 850))).toBeCloseTo(0.807, 2);
    expect(firstPaymentInterestShare(loanApr('mortgage', 715))).toBeCloseTo(0.857, 2);
    expect(firstPaymentInterestShare(loanApr('mortgage', 620))).toBeCloseTo(0.884, 2);
    expect(firstPaymentInterestShare(loanApr('mortgage', null))).toBeCloseTo(0.894, 2);
  });

  it('sets the interest share by rate and term alone, not by how much is borrowed', () => {
    // 1 - (1+r)^-n has no principal term in it. A $100k and a $900k mortgage
    // at the same rate front-load identically.
    const apr = loanApr('mortgage', 715);
    const rate = apr / 12;
    const expected = 1 - Math.pow(1 + rate, -360);

    for (const principal of [10_000_000, 32_000_000, 90_000_000]) {
      expect(firstPaymentInterestShare(apr, 360, principal)).toBeCloseTo(expected, 4);
    }
  });

  it('front-loads a 15-year mortgage far less than a 30-year', () => {
    // Half the term, and much less of the first payment goes to the lender.
    const apr = loanApr('mortgage', 715);
    expect(firstPaymentInterestShare(apr, 180)).toBeLessThan(firstPaymentInterestShare(apr, 360));
    expect(firstPaymentInterestShare(apr, 180)).toBeCloseTo(0.63, 1);
  });

  it('shifts the split from interest toward principal over the term', () => {
    const loan = openAmortizingLoan({
      id: 'm',
      loanType: 'mortgage',
      principalCents: 32_000_000,
      aprAnnual: 0.065,
      termMonths: 360,
      openedWeek: 0,
    });
    const schedule = amortizationSchedule(loan);

    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].interestCents).toBeLessThanOrEqual(schedule[i - 1].interestCents);
    }
    // The last payment is nearly all principal.
    expect(schedule[359].interestCents / schedule[359].paymentCents).toBeLessThan(0.01);
  });

  it('holds the scheduled payment level except for the final rounding month', () => {
    const loan = openAmortizingLoan({
      id: 'a',
      loanType: 'auto',
      principalCents: 2_500_000,
      aprAnnual: 0.075,
      termMonths: 60,
      openedWeek: 0,
    });
    const schedule = amortizationSchedule(loan);
    for (let i = 0; i < schedule.length - 1; i++) {
      expect(schedule[i].paymentCents).toBe(loan.monthlyPaymentCents);
    }
    // The final payment absorbs the rounding remainder.
    expect(Math.abs(schedule[59].paymentCents - loan.monthlyPaymentCents)).toBeLessThan(200);
  });

  it('divides evenly when there is no interest', () => {
    expect(monthlyPaymentCents(120_000, 0, 12)).toBe(10_000);
  });

  it('prices each loan type from credit quality', () => {
    expect(creditQuality(580)).toBe(0);
    expect(creditQuality(850)).toBe(1);
    expect(creditQuality(715)).toBeCloseTo(0.5, 10);
    // A thin file is priced as the worst quality, not the average.
    expect(creditQuality(null)).toBe(0);

    expect(loanApr('personal', 580)).toBeCloseTo(PERSONAL_LOAN_BASE_APR, 12); // 13%
    expect(loanApr('personal', 850)).toBeCloseTo(0.07, 12); // 7%
    expect(loanApr('auto', 580)).toBeCloseTo(AUTO_LOAN_BASE_APR, 12); // 11%
    expect(loanApr('auto', 850)).toBeCloseTo(0.055, 12); // 5.5%
    expect(loanApr('mortgage', 850)).toBeCloseTo(0.055, 12);
    // Student loans are priced the same for everyone.
    expect(loanApr('student', 580)).toBe(STUDENT_LOAN_APR);
    expect(loanApr('student', 850)).toBe(STUDENT_LOAN_APR);
  });

  it('gates a mortgage on 10% down and a 620 score', () => {
    const price = 30_000_000;
    expect(mortgageEligible(3_000_000, price, 700)).toBe(true);
    expect(mortgageEligible(2_999_999, price, 700)).toBe(false); // under 10% down
    expect(mortgageEligible(3_000_000, price, MORTGAGE_MIN_CREDIT_SCORE)).toBe(true);
    expect(mortgageEligible(3_000_000, price, 619)).toBe(false);
    expect(mortgageEligible(3_000_000, price, null)).toBe(false); // thin file
  });
});

describe('BNPL (TDD §5.3)', () => {
  const plan = () => openBnplPlan({ id: 'bnpl', purchaseAmountCents: 40_000, purchaseWeek: 10 });

  it('appears as a liability from the moment of purchase', () => {
    // The whole lesson: it is debt that does not feel like debt.
    const p = plan();
    expect(p.balanceCents).toBe(40_000);
    expect(p.installmentsPaid).toBe(0);
    expect(p.missedCount).toBe(0);
    expect(totalLiabilitiesCents([p])).toBe(40_000);
  });

  it('splits into four installments at weeks 0, 2, 4 and 6', () => {
    const p = plan();
    expect(installmentDueWeeks(p)).toEqual([10, 12, 14, 16]);
    expect(p.installmentCents).toBe(10_000);

    const total = Array.from({ length: BNPL_INSTALLMENTS }, (_, i) => installmentAmountCents(p, i));
    expect(total.reduce((a, b) => a + b, 0)).toBe(40_000);
  });

  it('makes the last installment absorb the rounding remainder', () => {
    const odd = openBnplPlan({ id: 'x', purchaseAmountCents: 10_001, purchaseWeek: 0 });
    const parts = Array.from({ length: BNPL_INSTALLMENTS }, (_, i) => installmentAmountCents(odd, i));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_001);
  });

  it('draws the liability down as installments are paid', () => {
    let p = plan();
    for (let i = 1; i <= BNPL_INSTALLMENTS; i++) {
      p = payInstallment(p).plan;
      expect(p.balanceCents).toBe(40_000 - 10_000 * i);
    }
    expect(p.status).toBe('settled');
  });

  it('charges a fee and dings credit on the first miss', () => {
    const result = missInstallment(plan(), 12);
    expect(result.feeChargedCents).toBe(BNPL_LATE_FEE_CENTS);
    expect(result.creditImpact).toBe(BNPL_MISS_CREDIT_IMPACT);
    expect(result.plan.balanceCents).toBe(40_000 + BNPL_LATE_FEE_CENTS);
    expect(result.plan.status).toBe('active');
  });

  it('freezes the account on the second miss', () => {
    const first = missInstallment(plan(), 12);
    const second = missInstallment(first.plan, 14);

    expect(second.feeChargedCents).toBe(BNPL_LATE_FEE_CENTS);
    expect(second.plan.status).toBe('frozen');
    expect(second.plan.frozenUntilWeek).toBe(14 + BNPL_FREEZE_WEEKS);
    expect(second.plan.balanceCents).toBe(40_000 + BNPL_LATE_FEE_CENTS * 2);

    expect(canOpenNewPlan([second.plan], 14)).toBe(false);
    expect(canOpenNewPlan([second.plan], 14 + BNPL_FREEZE_WEEKS - 1)).toBe(false);
    expect(canOpenNewPlan([second.plan], 14 + BNPL_FREEZE_WEEKS)).toBe(true);
  });

  it('sends the balance to collections on the third miss', () => {
    const p1 = missInstallment(plan(), 12).plan;
    const p2 = missInstallment(p1, 14).plan;
    const third = missInstallment(p2, 16);

    expect(third.plan.status).toBe('collections');
    expect(third.creditImpact).toBe(BNPL_COLLECTIONS_CREDIT_IMPACT);
    // No further fee, but the debt persists.
    expect(third.feeChargedCents).toBe(0);
    expect(third.plan.balanceCents).toBe(40_000 + BNPL_LATE_FEE_CENTS * 2);
    expect(canOpenNewPlan([third.plan], 500)).toBe(false);
  });

  it('stops accruing anything once in collections', () => {
    let p = plan();
    for (const week of [12, 14, 16]) p = missInstallment(p, week).plan;
    const balanceAtCollections = p.balanceCents;

    const further = missInstallment(p, 18);
    expect(further.plan.balanceCents).toBe(balanceAtCollections);
    expect(further.feeChargedCents).toBe(0);
    expect(further.creditImpact).toBe(0);
  });

  it('charges no interest — the cost is the fees', () => {
    expect(plan().aprAnnual).toBe(0);
  });
});

describe('payday loan (TDD §5.4)', () => {
  const PRINCIPAL = 30_000; // $300
  const loan = () => openPaydayLoan({ id: 'pd', principalCents: PRINCIPAL, weekIndex: 100 });

  it('charges $15 per $100 on a two-week term', () => {
    const l = loan();
    expect(l.feeCents).toBe(Math.round(PRINCIPAL * PAYDAY_FEE_RATE));
    expect(l.feeCents).toBe(4_500);
    expect(l.dueWeek).toBe(100 + PAYDAY_TERM_WEEKS);
    expect(l.balanceCents).toBe(PRINCIPAL + 4_500);
  });

  it('reports an effective APR of 390%', () => {
    expect(PAYDAY_EFFECTIVE_APR).toBeCloseTo(3.9, 12);
    expect(loan().aprAnnual).toBeCloseTo(3.9, 12);
  });

  it('costs 45% of principal over three rollovers with the principal untouched', () => {
    let l = loan();
    for (let i = 0; i < 3; i++) l = rollover(l).loan;

    expect(l.rollovers).toBe(3);
    expect(l.feesPaidCents).toBe(Math.round(PRINCIPAL * 0.45));
    expect(feesAsShareOfPrincipal(l)).toBeCloseTo(0.45, 12);
    // The whole point of the instrument: none of that touched what is owed.
    expect(l.principalCents).toBe(PRINCIPAL);
    expect(l.balanceCents).toBe(PRINCIPAL + l.feeCents);
  });

  it('charges each new fee on the full principal', () => {
    let l = loan();
    for (let i = 0; i < 5; i++) {
      const result = rollover(l);
      expect(result.feePaidCents).toBe(Math.round(PRINCIPAL * PAYDAY_FEE_RATE));
      l = result.loan;
    }
    expect(l.principalCents).toBe(PRINCIPAL);
    expect(feesAsShareOfPrincipal(l)).toBeCloseTo(0.75, 12);
  });

  it('pushes the due date out two weeks per rollover', () => {
    let l = loan();
    expect(l.dueWeek).toBe(102);
    l = rollover(l).loan;
    expect(l.dueWeek).toBe(104);
    l = rollover(l).loan;
    expect(l.dueWeek).toBe(106);
  });
});

describe('the shared Debt shape (TDD §5)', () => {
  it('sums every instrument into one liability total', () => {
    const debts = [
      closeStatement(chargeCard(openCreditCard({ id: 'cc', creditLimitCents: 500_000, openedWeek: 0 }), 100_000)!, 0).card,
      openAmortizingLoan({ id: 'auto', loanType: 'auto', principalCents: 2_000_000, aprAnnual: 0.08, termMonths: 60, openedWeek: 0 }),
      openBnplPlan({ id: 'bnpl', purchaseAmountCents: 40_000, purchaseWeek: 0 }),
      openPaydayLoan({ id: 'pd', principalCents: 30_000, weekIndex: 0 }),
    ];

    expect(totalLiabilitiesCents(debts)).toBe(100_000 + 2_000_000 + 40_000 + 34_500);
    expect(totalLiabilitiesCents([])).toBe(0);
    for (const debt of debts) {
      expect(Number.isInteger(debt.balanceCents)).toBe(true);
      expect(debt.balanceCents).toBeGreaterThanOrEqual(0);
    }
  });
});
