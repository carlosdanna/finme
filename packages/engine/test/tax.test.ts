import { describe, expect, it } from 'vitest';
import {
  BRACKETS,
  LONG_TERM_GAINS_RATE,
  LONG_TERM_HOLDING_WEEKS,
  type TaxLot,
  averageRate,
  incomeTaxCents,
  isLongTerm,
  longTermGainsTaxCents,
  marginalRate,
  sellLotsFifo,
  settleAnnualTax,
  shortTermGainsCents,
  unpaidBillPenaltyCents,
  weeklyWithholdingCents,
} from '../src/tax.ts';
import { buildCpi } from '../src/inflation.ts';
import { WEEKS_PER_YEAR } from '../src/time.ts';

const NO_INFLATION = 1;

/** Year-0 bracket edges in cents: $15,000 / $40,000 / $90,000. */
const EDGE_0 = BRACKETS[0].upTo;
const EDGE_1 = BRACKETS[1].upTo;
const EDGE_2 = BRACKETS[2].upTo;

describe('progressive brackets (TDD §6.3)', () => {
  it('owes nothing inside the zero bracket', () => {
    expect(incomeTaxCents(0, NO_INFLATION)).toBe(0);
    expect(incomeTaxCents(1_000_000, NO_INFLATION)).toBe(0);
    expect(incomeTaxCents(EDGE_0, NO_INFLATION)).toBe(0);
  });

  it('owes nothing on negative taxable income', () => {
    expect(incomeTaxCents(-500_000, NO_INFLATION)).toBe(0);
  });

  it('taxes each band at its own rate, not the whole income at the top rate', () => {
    // $40,000: the first $15,000 free, the next $25,000 at 12%.
    expect(incomeTaxCents(EDGE_1, NO_INFLATION)).toBe(Math.round((EDGE_1 - EDGE_0) * 0.12));

    // $90,000: adds $50,000 at 22%.
    const at90k = (EDGE_1 - EDGE_0) * 0.12 + (EDGE_2 - EDGE_1) * 0.22;
    expect(incomeTaxCents(EDGE_2, NO_INFLATION)).toBe(Math.round(at90k));

    // $120,000: adds $30,000 at 32%.
    expect(incomeTaxCents(12_000_000, NO_INFLATION)).toBe(
      Math.round(at90k + (12_000_000 - EDGE_2) * 0.32),
    );
  });

  it('computes the marginal rate correctly at every bracket boundary', () => {
    // Income sitting exactly on a threshold: the next cent is in the higher band.
    expect(marginalRate(EDGE_0 - 1, NO_INFLATION)).toBe(0.0);
    expect(marginalRate(EDGE_0, NO_INFLATION)).toBe(0.12);
    expect(marginalRate(EDGE_1 - 1, NO_INFLATION)).toBe(0.12);
    expect(marginalRate(EDGE_1, NO_INFLATION)).toBe(0.22);
    expect(marginalRate(EDGE_2 - 1, NO_INFLATION)).toBe(0.22);
    expect(marginalRate(EDGE_2, NO_INFLATION)).toBe(0.32);
    expect(marginalRate(50_000_000, NO_INFLATION)).toBe(0.32);
  });

  it('charges the marginal rate on the next cent, at every boundary', () => {
    for (const edge of [EDGE_0, EDGE_1, EDGE_2]) {
      const step = incomeTaxCents(edge + 100, NO_INFLATION) - incomeTaxCents(edge, NO_INFLATION);
      expect(step).toBe(Math.round(100 * marginalRate(edge, NO_INFLATION)));
    }
  });

  it('keeps the average rate below the marginal rate at every boundary', () => {
    for (const edge of [EDGE_1, EDGE_2, 20_000_000]) {
      expect(averageRate(edge, NO_INFLATION)).toBeLessThan(marginalRate(edge, NO_INFLATION));
    }
    expect(averageRate(0, NO_INFLATION)).toBe(0);
  });

  it('computes the average rate as tax over income', () => {
    const income = 7_500_000;
    expect(averageRate(income, NO_INFLATION)).toBeCloseTo(
      incomeTaxCents(income, NO_INFLATION) / income,
      12,
    );
  });
});

describe('CPI indexing (TDD §6.3)', () => {
  it('does not drift a player into a higher bracket on inflation alone', () => {
    // A salary that grows exactly with inflation is the same salary in real
    // terms, and must be taxed identically in real terms.
    const rates = Float64Array.from(Array.from({ length: 30 }, () => 0.03));
    const cpi = buildCpi(rates);
    const baseIncome = 3_900_000; // just under the 12% -> 22% edge at $40,000

    const baseMarginal = marginalRate(baseIncome, cpi[0]);
    const baseAverage = averageRate(baseIncome, cpi[0]);

    for (let year = 0; year <= 29; year++) {
      const nominalIncome = Math.round(baseIncome * cpi[year]);
      expect(marginalRate(nominalIncome, cpi[year])).toBe(baseMarginal);
      // The real tax burden is unchanged, to within rounding.
      expect(averageRate(nominalIncome, cpi[year])).toBeCloseTo(baseAverage, 6);
    }
  });

  it('taxes a real raise more, even when nominal income is flat', () => {
    // Deflation makes a flat nominal salary a real raise; brackets shrink with it.
    const cpi = 0.9;
    expect(incomeTaxCents(5_000_000, cpi)).toBeGreaterThan(incomeTaxCents(5_000_000, 1));
  });

  it('scales the whole bracket table by CPI', () => {
    const cpi = 1.5;
    expect(marginalRate(EDGE_1 * cpi - 1, cpi)).toBe(0.12);
    expect(marginalRate(EDGE_1 * cpi, cpi)).toBe(0.22);
    expect(incomeTaxCents(EDGE_1 * cpi, cpi)).toBe(Math.round(incomeTaxCents(EDGE_1, 1) * cpi));
  });
});

describe('FIFO tax lots and the holding-period split (TDD §6.3)', () => {
  const lot = (purchasedWeek: number, shares: number, costBasisCents: number): TaxLot => ({
    assetId: 'SAFE',
    shares,
    purchasedWeek,
    costBasisCents,
  });

  it('taxes a lot held 51 weeks at ordinary rates and 52 weeks at 15%', () => {
    expect(isLongTerm(51)).toBe(false);
    expect(isLongTerm(LONG_TERM_HOLDING_WEEKS)).toBe(true);

    // Same lot, same gain, sold one week apart.
    const held51 = sellLotsFifo([lot(0, 100, 1_000_000)], 'SAFE', 100, 51, 15_000);
    const held52 = sellLotsFifo([lot(0, 100, 1_000_000)], 'SAFE', 100, 52, 15_000);

    expect(held51.realized[0].longTerm).toBe(false);
    expect(held52.realized[0].longTerm).toBe(true);

    const gain = 1_500_000 - 1_000_000;
    expect(held51.realized[0].gainCents).toBe(gain);
    expect(held52.realized[0].gainCents).toBe(gain);

    // At 51 weeks the gain is ordinary income and no capital gains tax is due
    // here; at 52 it is taxed at the flat 15% and never touches the brackets.
    expect(longTermGainsTaxCents(held51.realized)).toBe(0);
    expect(shortTermGainsCents(held51.realized)).toBe(gain);

    expect(longTermGainsTaxCents(held52.realized)).toBe(Math.round(gain * LONG_TERM_GAINS_RATE));
    expect(shortTermGainsCents(held52.realized)).toBe(0);
  });

  it('consumes the oldest lot first', () => {
    const lots = [lot(0, 10, 100_000), lot(60, 10, 200_000), lot(90, 10, 300_000)];
    const result = sellLotsFifo(lots, 'SAFE', 15, 100, 25_000);

    expect(result.realized).toHaveLength(2);
    expect(result.realized[0].shares).toBe(10);
    expect(result.realized[0].costBasisCents).toBe(100_000);
    expect(result.realized[1].shares).toBe(5);
    expect(result.realized[1].costBasisCents).toBe(100_000); // half of the second lot

    // The partially consumed lot keeps its purchase week and its residual basis.
    expect(result.lots).toHaveLength(2);
    expect(result.lots[0]).toEqual({
      assetId: 'SAFE',
      shares: 5,
      purchasedWeek: 60,
      costBasisCents: 100_000,
    });
    expect(result.lots[1].purchasedWeek).toBe(90);
  });

  it('splits a sale across the holding-period boundary by lot, not in aggregate', () => {
    // Sold at week 60: the week-0 lot is long-term, the week-20 lot is not.
    const lots = [lot(0, 10, 100_000), lot(20, 10, 100_000)];
    const result = sellLotsFifo(lots, 'SAFE', 20, 60, 20_000);

    expect(result.realized.map((r) => r.longTerm)).toEqual([true, false]);
    expect(result.realized[0].holdingWeeks).toBe(60);
    expect(result.realized[1].holdingWeeks).toBe(40);
  });

  it('leaves other assets untouched', () => {
    const lots: TaxLot[] = [
      { assetId: 'MOON', shares: 5, purchasedWeek: 0, costBasisCents: 50_000 },
      lot(0, 10, 100_000),
    ];
    const result = sellLotsFifo(lots, 'SAFE', 10, 100, 15_000);

    expect(result.realized).toHaveLength(1);
    expect(result.realized[0].assetId).toBe('SAFE');
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].assetId).toBe('MOON');
  });

  it('reports shares it could not sell rather than inventing them', () => {
    const result = sellLotsFifo([lot(0, 10, 100_000)], 'SAFE', 25, 100, 15_000);
    expect(result.unsoldShares).toBe(15);
    expect(result.realized[0].shares).toBe(10);
    expect(result.lots).toHaveLength(0);
  });

  it('records losses as negative gains and taxes them at nothing', () => {
    const result = sellLotsFifo([lot(0, 10, 200_000)], 'SAFE', 10, 100, 10_000);
    expect(result.realized[0].gainCents).toBe(-100_000);
    expect(longTermGainsTaxCents(result.realized)).toBe(0);
  });

  it('does not mutate the lots it was given', () => {
    const lots = [lot(0, 10, 100_000)];
    const snapshot = lots.map((l) => ({ ...l }));
    sellLotsFifo(lots, 'SAFE', 5, 100, 15_000);
    expect(lots).toEqual(snapshot);
  });
});

describe('withholding and annual settlement (TDD §6.3)', () => {
  const baseYear = {
    sideHustleGrossCents: 0,
    dividendsCents: 0,
    shortTermGainsCents: 0,
    longTermGainsCents: 0,
    retirementContributionsCents: 0,
    cpi: NO_INFLATION,
  };

  it('withholds against annualized employment gross', () => {
    const weeklyGross = 100_000; // $1,000/wk = $52,000/yr
    const weekly = weeklyWithholdingCents(weeklyGross, NO_INFLATION);
    expect(weekly * WEEKS_PER_YEAR).toBeCloseTo(
      incomeTaxCents(weeklyGross * WEEKS_PER_YEAR, NO_INFLATION),
      -2,
    );
  });

  it('settles to roughly zero for a pure-salary year', () => {
    const weeklyGross = 100_000;
    const employmentGrossCents = weeklyGross * WEEKS_PER_YEAR;
    const withheldCents = weeklyWithholdingCents(weeklyGross, NO_INFLATION) * WEEKS_PER_YEAR;

    const settlement = settleAnnualTax({ ...baseYear, employmentGrossCents, withheldCents });
    // Within a few cents of square: withholding is exactly the right answer when
    // employment income is the only income.
    expect(Math.abs(settlement.settlementCents)).toBeLessThan(100);
  });

  it('produces an under-withholding bill in a side-hustle-heavy year', () => {
    const weeklyGross = 100_000;
    const employmentGrossCents = weeklyGross * WEEKS_PER_YEAR;
    const withheldCents = weeklyWithholdingCents(weeklyGross, NO_INFLATION) * WEEKS_PER_YEAR;

    const settlement = settleAnnualTax({
      ...baseYear,
      employmentGrossCents,
      // $18,000 of unwithheld side hustle income on top of a $52,000 salary.
      sideHustleGrossCents: 1_800_000,
      withheldCents,
    });

    // Nothing was withheld on the side hustle, so the whole of its tax is due.
    expect(settlement.settlementCents).toBeLessThan(0);
    const billCents = -settlement.settlementCents;
    expect(billCents).toBeGreaterThan(300_000); // over $3,000 owed in April
    expect(billCents).toBeCloseTo(
      incomeTaxCents(employmentGrossCents + 1_800_000, NO_INFLATION) -
        incomeTaxCents(employmentGrossCents, NO_INFLATION),
      -2,
    );
  });

  it('produces a bill for unwithheld dividends and short-term gains too', () => {
    const employmentGrossCents = 5_200_000;
    const withheldCents = incomeTaxCents(employmentGrossCents, NO_INFLATION);

    for (const extra of [{ dividendsCents: 400_000 }, { shortTermGainsCents: 400_000 }]) {
      const settlement = settleAnnualTax({
        ...baseYear,
        employmentGrossCents,
        withheldCents,
        ...extra,
      });
      expect(settlement.settlementCents).toBeLessThan(0);
    }
  });

  it('taxes long-term gains at 15% outside the brackets', () => {
    const settlement = settleAnnualTax({
      ...baseYear,
      employmentGrossCents: 5_200_000,
      longTermGainsCents: 1_000_000,
      withheldCents: 0,
    });

    expect(settlement.capitalGainsTaxCents).toBe(Math.round(1_000_000 * LONG_TERM_GAINS_RATE));
    // Long-term gains stay out of taxable income entirely.
    expect(settlement.taxableIncomeCents).toBe(5_200_000);
  });

  it('reduces taxable income by retirement contributions', () => {
    const withContribution = settleAnnualTax({
      ...baseYear,
      employmentGrossCents: 5_200_000,
      retirementContributionsCents: 520_000,
      withheldCents: 0,
    });
    const without = settleAnnualTax({
      ...baseYear,
      employmentGrossCents: 5_200_000,
      withheldCents: 0,
    });

    expect(withContribution.taxableIncomeCents).toBe(4_680_000);
    expect(withContribution.totalOwedCents).toBeLessThan(without.totalOwedCents);
  });

  it('refunds when more was withheld than owed', () => {
    const settlement = settleAnnualTax({
      ...baseYear,
      employmentGrossCents: 3_000_000,
      withheldCents: 1_000_000,
    });
    expect(settlement.settlementCents).toBeGreaterThan(0);
  });

  it('accrues weekly penalty interest on an unpaid bill', () => {
    const balance = 1_000_000; // $10,000 owed
    const weekly = unpaidBillPenaltyCents(balance);
    expect(weekly).toBe(Math.round((balance * 0.06) / WEEKS_PER_YEAR));
    expect(weekly * WEEKS_PER_YEAR).toBeCloseTo(balance * 0.06, -2);
  });
});
