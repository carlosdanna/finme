import { describe, expect, it } from 'vitest';
import {
  BANKRUPTCY_DTI_MULTIPLE,
  BANKRUPTCY_MISSED_MONTHS,
  DIRE_CREDIT_RECOVERY_YEARS,
  DIRE_CREDIT_SCORE_FLOOR,
  DIRE_NO_NEW_CREDIT_WEEKS,
  applyDireCreditCeiling,
  bankruptcyTriggered,
  direCreditCeiling,
  direForcedBudget,
  direInvestingBlocked,
  direJobBlocked,
  direNoNewCredit,
  enterDireState,
  garnishmentCents,
} from '../src/bankruptcy.ts';
import { WEEKS_PER_YEAR } from '../src/time.ts';

const trigger = (partial: Partial<Parameters<typeof bankruptcyTriggered>[0]> = {}) => ({
  unsecuredDebtCents: 12_000_000,
  annualGrossCents: 5_000_000,
  cashCents: 10_000,
  monthlyExpensesCents: 200_000,
  consecutiveMissedPaymentMonths: 3,
  ...partial,
});

describe('the bankruptcy trigger (TDD §13)', () => {
  it('needs all three conditions together', () => {
    expect(bankruptcyTriggered(trigger())).toBe(true);

    // Any one of them alone is a bad month, not a bankruptcy.
    expect(bankruptcyTriggered(trigger({ unsecuredDebtCents: 5_000_000 }))).toBe(false);
    expect(bankruptcyTriggered(trigger({ cashCents: 500_000 }))).toBe(false);
    expect(bankruptcyTriggered(trigger({ consecutiveMissedPaymentMonths: 2 }))).toBe(false);
  });

  it('sets the leverage bar at 2x annual gross', () => {
    const gross = 5_000_000;
    expect(bankruptcyTriggered(trigger({ unsecuredDebtCents: gross * BANKRUPTCY_DTI_MULTIPLE }))).toBe(false);
    expect(bankruptcyTriggered(trigger({ unsecuredDebtCents: gross * BANKRUPTCY_DTI_MULTIPLE + 1 }))).toBe(true);
  });

  it('needs three consecutive missed months, not one bad one', () => {
    expect(BANKRUPTCY_MISSED_MONTHS).toBe(3);
    for (const months of [0, 1, 2]) {
      expect(bankruptcyTriggered(trigger({ consecutiveMissedPaymentMonths: months }))).toBe(false);
    }
  });

  it('treats any unsecured debt as over-leveraged when there is no income', () => {
    expect(bankruptcyTriggered(trigger({ annualGrossCents: 0, unsecuredDebtCents: 1 }))).toBe(true);
    expect(bankruptcyTriggered(trigger({ annualGrossCents: 0, unsecuredDebtCents: 0 }))).toBe(false);
  });
});

describe('the dire state (GDD §4.3, TDD §13)', () => {
  const dire = enterDireState(500, 2);

  it('drops the score to the floor and caps its recovery', () => {
    expect(dire.creditScoreOverride).toBe(DIRE_CREDIT_SCORE_FLOOR);
    expect(direCreditCeiling(dire, 500)).toBe(450);
    expect(direCreditCeiling(dire, 500 + WEEKS_PER_YEAR)).toBe(465);
    expect(direCreditCeiling(dire, 500 + WEEKS_PER_YEAR * 3)).toBe(495);

    // The ceiling stops rising after seven years.
    const ceiling = direCreditCeiling(dire, 500 + WEEKS_PER_YEAR * DIRE_CREDIT_RECOVERY_YEARS);
    expect(direCreditCeiling(dire, 500 + WEEKS_PER_YEAR * 20)).toBe(ceiling);
    expect(ceiling).toBe(450 + 15 * 7);
  });

  it('caps a well-behaved player rather than merely slowing them', () => {
    // A discharged player cannot borrow their way back quickly however well
    // they behave — that is what stops the exploit being cheap.
    expect(applyDireCreditCeiling(800, dire, 500 + WEEKS_PER_YEAR)).toBe(465);
    expect(applyDireCreditCeiling(440, dire, 500 + WEEKS_PER_YEAR)).toBe(440);
    expect(applyDireCreditCeiling(null, dire, 500)).toBeNull();
    expect(applyDireCreditCeiling(700, null, 500)).toBe(700);
  });

  it('bars new credit for 24 months', () => {
    expect(direNoNewCredit(dire, 500)).toBe(true);
    expect(direNoNewCredit(dire, 500 + DIRE_NO_NEW_CREDIT_WEEKS - 1)).toBe(true);
    expect(direNoNewCredit(dire, 500 + DIRE_NO_NEW_CREDIT_WEEKS)).toBe(false);
    expect(direNoNewCredit(null, 500)).toBe(false);
  });

  it('forces a budget for 12 months and downgrades housing one tier', () => {
    expect(direForcedBudget(dire, 500)).toBe(true);
    expect(direForcedBudget(dire, 500 + 52)).toBe(false);
    expect(dire.housingForcedTier).toBe(1);
    // Tier 0 cannot be downgraded below the floor.
    expect(enterDireState(500, 0).housingForcedTier).toBe(0);
  });

  it('blocks investing only while the cushion is under a month of expenses', () => {
    // Not a blanket ban: rebuilding a cushion re-opens it, which is what makes
    // the comeback arc reachable rather than merely long.
    expect(direInvestingBlocked(dire, 500, 100_000, 200_000)).toBe(true);
    expect(direInvestingBlocked(dire, 500, 250_000, 200_000)).toBe(false);
    // And it lifts entirely once forced budget mode ends.
    expect(direInvestingBlocked(dire, 500 + 52, 0, 200_000)).toBe(false);
  });

  it('garnishes 15% while secured debt is outstanding', () => {
    expect(garnishmentCents(dire, 100_000, true)).toBe(15_000);
    expect(garnishmentCents(dire, 100_000, false)).toBe(0);
    expect(garnishmentCents(null, 100_000, true)).toBe(0);
  });

  it('bars the higher job tiers for five years', () => {
    expect(direJobBlocked(dire, 'professional', 500)).toBe(true);
    expect(direJobBlocked(dire, 'entry', 500)).toBe(false);
    expect(direJobBlocked(dire, 'professional', 500 + 260)).toBe(false);
    expect(direJobBlocked(null, 'professional', 500)).toBe(false);
  });
});
