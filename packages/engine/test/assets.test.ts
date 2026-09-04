import { describe, expect, it } from 'vitest';
import {
  CAR_DEPRECIATION_RATE,
  CAR_OFF_LOT_DROP,
  CAR_SCRAP_FLOOR,
  type Car,
  HOME_MAINTENANCE_RATE,
  HOME_PROPERTY_TAX_RATE,
  HOME_SALE_TRANSACTION_COST,
  carValueAtPurchaseCents,
  carValueCents,
  generateHomeValuePath,
  homeCarryingCostWeeklyCents,
  homeMaintenanceWeeklyCents,
  homePropertyTaxWeeklyCents,
  homeSaleProceedsCents,
  homeValueCents,
} from '../src/assets.ts';
import { amortizationSchedule, loanApr, openAmortizingLoan } from '../src/debt/index.ts';
import { generateMarket } from '../src/market.ts';
import { stream } from '../src/rng.ts';
import { WEEKS_PER_YEAR } from '../src/time.ts';
import { balanceSheet, emptyBalanceSheetInput, netWorthCents } from '../src/netWorth.ts';

const CAR_PRICE = 2_400_000; // $24,000
const car: Car = { purchasePriceCents: CAR_PRICE, purchasedWeek: 0 };

describe('car depreciation (TDD §8.1)', () => {
  it('loses 12% the moment it leaves the lot', () => {
    expect(carValueCents(car, 0)).toBe(Math.round(CAR_PRICE * (1 - CAR_OFF_LOT_DROP)));
    expect(carValueAtPurchaseCents(CAR_PRICE)).toBe(carValueCents(car, 0));
  });

  it('decays continuously at 16% a year after the drop', () => {
    for (const years of [1, 2, 3, 5]) {
      const expected = Math.round(
        CAR_PRICE * (1 - CAR_OFF_LOT_DROP) * Math.exp(-CAR_DEPRECIATION_RATE * years),
      );
      expect(carValueCents(car, years * WEEKS_PER_YEAR)).toBe(expected);
    }
    // A quarter of the value is gone inside the first year.
    expect(carValueCents(car, WEEKS_PER_YEAR) / CAR_PRICE).toBeCloseTo(0.75, 2);
  });

  it('never falls below scrap value', () => {
    const floor = Math.round(CAR_PRICE * CAR_SCRAP_FLOOR);
    expect(carValueCents(car, 20 * WEEKS_PER_YEAR)).toBe(floor);
    expect(carValueCents(car, 50 * WEEKS_PER_YEAR)).toBe(floor);
    // The floor binds at about 15 years.
    expect(carValueCents(car, 14 * WEEKS_PER_YEAR)).toBeGreaterThan(floor);
  });

  it('never increases, and is an integer number of cents', () => {
    let previous = Infinity;
    for (let week = 0; week < 30 * WEEKS_PER_YEAR; week += 13) {
      const value = carValueCents(car, week);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('is worth its purchase price before it is bought', () => {
    const bought = { purchasePriceCents: CAR_PRICE, purchasedWeek: 100 };
    expect(carValueCents(bought, 100)).toBe(Math.round(CAR_PRICE * 0.88));
    // Weeks before the purchase clamp to the purchase week rather than inflating.
    expect(carValueCents(bought, 50)).toBe(carValueCents(bought, 100));
  });
});

describe('the underwater car (TDD §8.1)', () => {
  /** Months for which the loan exceeds the car's value. */
  function monthsUnderwater(downPct: number, creditScore: number | null): number {
    const loan = openAmortizingLoan({
      id: 'auto',
      loanType: 'auto',
      principalCents: Math.round(CAR_PRICE * (1 - downPct)),
      aprAnnual: loanApr('auto', creditScore),
      termMonths: 60,
      openedWeek: 0,
    });
    const schedule = amortizationSchedule(loan);

    let last = 0;
    for (let month = 1; month <= 60; month++) {
      const value = carValueCents(car, Math.round((month * WEEKS_PER_YEAR) / 12));
      if (schedule[month - 1].balanceAfterCents > value) last = month;
    }
    return last;
  }

  it('leaves a 60-month, 5%-down car underwater for the first third of its term', () => {
    // §8.1 says "roughly the first 30 months". Measured, the TDD's own
    // parameters give 17-22 months depending on credit — about a third of the
    // term rather than a half. Recorded, not retuned; see docs/DECISIONS.md.
    for (const score of [null, 620, 700, 850]) {
      const months = monthsUnderwater(0.05, score);
      expect(months).toBeGreaterThanOrEqual(15);
      expect(months).toBeLessThanOrEqual(25);
    }
    expect(monthsUnderwater(0.05, 700)).toBe(20);
    expect(monthsUnderwater(0.05, null)).toBe(22); // worse credit, longer underwater
  });

  it('stays underwater longer the smaller the down payment', () => {
    expect(monthsUnderwater(0.0, 700)).toBeGreaterThan(monthsUnderwater(0.05, 700));
    expect(monthsUnderwater(0.05, 700)).toBeGreaterThan(monthsUnderwater(0.1, 700));
    // A fifth down and the car is never worth less than the loan.
    expect(monthsUnderwater(0.2, 700)).toBe(0);
  });

  it('decreases net worth on the purchase, by exactly the off-lot drop', () => {
    const downCents = Math.round(CAR_PRICE * 0.05);
    const loan = openAmortizingLoan({
      id: 'auto',
      loanType: 'auto',
      principalCents: CAR_PRICE - downCents,
      aprAnnual: loanApr('auto', 700),
      termMonths: 60,
      openedWeek: 0,
    });

    const before = { ...emptyBalanceSheetInput(), cashCents: 500_000 };
    const after = {
      ...before,
      cashCents: before.cashCents - downCents,
      carValueCents: carValueCents(car, 0),
      debts: [loan],
    };

    const delta = netWorthCents(after) - netWorthCents(before);
    expect(delta).toBeLessThan(0);
    // The loss is the 12% that evaporates off the lot — and it does not depend
    // on how much was put down.
    expect(delta).toBe(-Math.round(CAR_PRICE * CAR_OFF_LOT_DROP));

    const bigDown = Math.round(CAR_PRICE * 0.5);
    const cashBuyer = {
      ...before,
      cashCents: before.cashCents - bigDown,
      carValueCents: carValueCents(car, 0),
      debts: [
        openAmortizingLoan({
          id: 'auto',
          loanType: 'auto',
          principalCents: CAR_PRICE - bigDown,
          aprAnnual: loanApr('auto', 700),
          termMonths: 60,
          openedWeek: 0,
        }),
      ],
    };
    expect(netWorthCents(cashBuyer) - netWorthCents(before)).toBe(
      -Math.round(CAR_PRICE * CAR_OFF_LOT_DROP),
    );
  });
});

describe('the home model (TDD §8.2)', () => {
  const HOME_PRICE = 32_000_000; // $320,000
  const path = () => generateHomeValuePath(stream('4F2A9C1B', 'market'), 1_560);

  it('is generated once at init and is identical for a seed', () => {
    expect([...path()]).toEqual([...path()]);
  });

  it('rides the world path from the week of purchase', () => {
    const p = path();
    const home = { purchasePriceCents: HOME_PRICE, purchasedWeek: 200 };

    expect(homeValueCents(home, p, 200)).toBe(HOME_PRICE);
    expect(homeValueCents(home, p, 400)).toBe(
      Math.round(HOME_PRICE * Math.exp(p[400] - p[200])),
    );
    // Weeks before the purchase clamp rather than back-projecting.
    expect(homeValueCents(home, p, 100)).toBe(HOME_PRICE);
  });

  it('is a property of the world, not of when the player bought', () => {
    // Two buyers in the same world see the same appreciation over the same weeks.
    const p = path();
    const early = { purchasePriceCents: HOME_PRICE, purchasedWeek: 100 };
    const late = { purchasePriceCents: HOME_PRICE, purchasedWeek: 300 };

    const earlyGrowth = homeValueCents(early, p, 300) / HOME_PRICE;
    const lateGrowth = homeValueCents(late, p, 500) / HOME_PRICE;
    expect(earlyGrowth).toBeCloseTo(Math.exp(p[300] - p[100]), 6);
    expect(lateGrowth).toBeCloseTo(Math.exp(p[500] - p[300]), 6);
  });

  it('appreciates at roughly 3% a year in the median', () => {
    const growths: number[] = [];
    for (let i = 0; i < 400; i++) {
      const p = generateHomeValuePath(stream(`S${i}`, 'market'), 1_560);
      growths.push((p[1_559] - p[0]) / 30);
    }
    growths.sort((a, b) => a - b);
    const medianAnnualLog = growths[200];
    // The median is the drift less sigma^2/2, per the §3.2 convention.
    expect(medianAnnualLog).toBeGreaterThan(0.024);
    expect(medianAnnualLog).toBeLessThan(0.032);
  });

  it('is far less volatile than equities', () => {
    const p = path();
    let maxWeeklyMove = 0;
    for (let t = 1; t < p.length; t++) maxWeeklyMove = Math.max(maxWeeklyMove, Math.abs(p[t] - p[t - 1]));
    // sigma 0.06/yr is under 1% a week even at four standard deviations.
    expect(maxWeeklyMove).toBeLessThan(0.05);
  });

  it('charges maintenance and property tax on current value', () => {
    const value = 32_000_000;
    expect(homeMaintenanceWeeklyCents(value)).toBe(
      Math.round((value * HOME_MAINTENANCE_RATE) / WEEKS_PER_YEAR),
    );
    expect(homePropertyTaxWeeklyCents(value)).toBe(
      Math.round((value * HOME_PROPERTY_TAX_RATE) / WEEKS_PER_YEAR),
    );
    expect(homeCarryingCostWeeklyCents(value)).toBe(
      homeMaintenanceWeeklyCents(value) + homePropertyTaxWeeklyCents(value),
    );
    // 2.1% of value a year, before any mortgage payment.
    expect(homeCarryingCostWeeklyCents(value) * WEEKS_PER_YEAR).toBeCloseTo(value * 0.021, -3);
  });

  it('takes 6% off the top on sale, before the mortgage is settled', () => {
    const value = 40_000_000;
    expect(homeSaleProceedsCents(value, 0)).toBe(Math.round(value * (1 - HOME_SALE_TRANSACTION_COST)));
    expect(homeSaleProceedsCents(value, 30_000_000)).toBe(
      Math.round(value * 0.94) - 30_000_000,
    );
    // Selling while underwater hands back a negative number rather than zero.
    expect(homeSaleProceedsCents(value, 39_000_000)).toBeLessThan(0);
  });

  it('is pre-generated on every run, bought or not', () => {
    // Otherwise buying a home would consume draws and shift every other system.
    const history = generateMarket('4F2A9C1B', 30);
    expect(history.homeValuePath).toHaveLength(history.weeks);
    expect(history.homeValuePath[0]).toBe(0);
  });
});

describe('net worth (TDD §4.2)', () => {
  it('sums every asset and subtracts every liability', () => {
    const input = {
      ...emptyBalanceSheetInput(),
      cashCents: 100_000,
      savingsCents: 200_000,
      emergencyFundCents: 300_000,
      portfolioValueCents: 1_000_000,
      retirementBalanceCents: 2_000_000,
      carValueCents: 500_000,
      homeValueCents: 30_000_000,
      accruedUnpaidBillsCents: 50_000,
      debts: [
        openAmortizingLoan({
          id: 'mortgage',
          loanType: 'mortgage',
          principalCents: 25_000_000,
          aprAnnual: 0.065,
          termMonths: 360,
          openedWeek: 0,
        }),
      ],
    };

    const sheet = balanceSheet(input);
    expect(sheet.assetsCents).toBe(34_100_000);
    expect(sheet.liabilitiesCents).toBe(25_050_000);
    expect(sheet.netWorthCents).toBe(9_050_000);
  });

  it('counts a mortgage once, not twice', () => {
    // §4.2 writes liabilities as sum(debts) + unpaidBills + mortgagePrincipal,
    // but the mortgage is one of the debts in that sum.
    const mortgage = openAmortizingLoan({
      id: 'mortgage',
      loanType: 'mortgage',
      principalCents: 25_000_000,
      aprAnnual: 0.065,
      termMonths: 360,
      openedWeek: 0,
    });
    const input = { ...emptyBalanceSheetInput(), homeValueCents: 32_000_000, debts: [mortgage] };
    expect(balanceSheet(input).liabilitiesCents).toBe(25_000_000);
    expect(netWorthCents(input)).toBe(7_000_000);
  });

  it('counts retirement in full, penalties notwithstanding', () => {
    // Haircutting it would make the highest-value action in the game look less
    // valuable on the headline number.
    const input = { ...emptyBalanceSheetInput(), retirementBalanceCents: 5_000_000 };
    expect(netWorthCents(input)).toBe(5_000_000);
  });

  it('goes negative when debts exceed assets, without special-casing', () => {
    const input = {
      ...emptyBalanceSheetInput(),
      cashCents: 10_000,
      accruedUnpaidBillsCents: 500_000,
    };
    expect(netWorthCents(input)).toBe(-490_000);
  });

  it('itemizes only the lines that carry a balance', () => {
    const sheet = balanceSheet({
      ...emptyBalanceSheetInput(),
      cashCents: 100_000,
      accruedUnpaidBillsCents: 5_000,
    });
    expect(sheet.assetLines).toEqual([{ label: 'Cash', cents: 100_000 }]);
    expect(sheet.liabilityLines).toEqual([{ label: 'Unpaid bills', cents: 5_000 }]);
  });

  it('is zero for an empty sheet', () => {
    expect(netWorthCents(emptyBalanceSheetInput())).toBe(0);
    expect(balanceSheet(emptyBalanceSheetInput()).assetLines).toEqual([]);
  });
});
