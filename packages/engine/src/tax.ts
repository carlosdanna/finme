/**
 * Taxes — TDD §6.3.
 *
 * Brackets are CPI-indexed, so inflation alone never pushes a player into a
 * higher bracket. Withholding applies to employment income only; side hustle
 * income, dividends and realized gains arrive unwithheld and produce a year-end
 * bill. That is intentional and is one of the game's best "wait, what?" moments
 * — do not add withholding to them as a quality-of-life improvement.
 */
import type { AssetId } from './market.ts';
import { WEEKS_PER_YEAR } from './time.ts';

export interface TaxBracket {
  /** Upper bound in year-0 cents, indexed by CPI at point of use. */
  readonly upTo: number;
  readonly rate: number;
}

/** [T] Year-0 bracket thresholds, in cents. */
export const BRACKETS: readonly TaxBracket[] = [
  { upTo: 1_500_000, rate: 0.0 },
  { upTo: 4_000_000, rate: 0.12 },
  { upTo: 9_000_000, rate: 0.22 },
  { upTo: Infinity, rate: 0.32 },
];

/** [F] A lot held this long or longer is taxed at the long-term rate. */
export const LONG_TERM_HOLDING_WEEKS = 52;

/** [F] The long-term capital gains rate. */
export const LONG_TERM_GAINS_RATE = 0.15;

/** [T] Annual penalty rate on a tax bill the player could not pay. */
export const UNPAID_BILL_PENALTY_APR = 0.06;

/**
 * Progressive income tax on taxable income, with every threshold scaled by CPI.
 *
 * Returns integer cents. Negative taxable income owes nothing.
 */
export function incomeTaxCents(taxableCents: number, cpi: number): number {
  if (taxableCents <= 0) return 0;

  let tax = 0;
  let prev = 0;
  for (const bracket of BRACKETS) {
    const cap = bracket.upTo === Infinity ? Infinity : bracket.upTo * cpi;
    if (taxableCents <= prev) break;
    tax += (Math.min(taxableCents, cap) - prev) * bracket.rate;
    prev = cap;
  }
  return Math.round(tax);
}

/**
 * The rate the *next* cent of income would be taxed at.
 *
 * At a bracket boundary the next cent falls in the higher bracket, so income
 * sitting exactly on a threshold reports the higher marginal rate.
 */
export function marginalRate(taxableCents: number, cpi: number): number {
  if (taxableCents < 0) return BRACKETS[0].rate;
  for (const bracket of BRACKETS) {
    const cap = bracket.upTo === Infinity ? Infinity : bracket.upTo * cpi;
    if (taxableCents < cap) return bracket.rate;
  }
  return BRACKETS[BRACKETS.length - 1].rate;
}

/** Total tax as a share of taxable income. Zero income has a zero average rate. */
export function averageRate(taxableCents: number, cpi: number): number {
  if (taxableCents <= 0) return 0;
  return incomeTaxCents(taxableCents, cpi) / taxableCents;
}

/**
 * Weekly withholding, annualizing this week's employment gross.
 *
 * Employment income only — see the file header.
 */
export function weeklyWithholdingCents(weeklyEmploymentGrossCents: number, cpi: number): number {
  return Math.round(incomeTaxCents(weeklyEmploymentGrossCents * WEEKS_PER_YEAR, cpi) / WEEKS_PER_YEAR);
}

// --- Capital gains, FIFO tax lots -------------------------------------------

export interface TaxLot {
  readonly assetId: AssetId;
  readonly shares: number;
  readonly purchasedWeek: number;
  /** What the shares in this lot cost, integer cents. */
  readonly costBasisCents: number;
}

export interface RealizedGain {
  readonly assetId: AssetId;
  readonly shares: number;
  readonly proceedsCents: number;
  readonly costBasisCents: number;
  /** Negative on a loss. */
  readonly gainCents: number;
  readonly holdingWeeks: number;
  readonly longTerm: boolean;
}

export interface SaleResult {
  /** The lots that survive the sale, still in FIFO order. */
  readonly lots: readonly TaxLot[];
  readonly realized: readonly RealizedGain[];
  /** Gross proceeds, integer cents. */
  readonly proceedsCents: number;
  /** Shares that could not be sold because the holding was too small. */
  readonly unsoldShares: number;
}

/** [F] A lot is long-term at 52 weeks, not 51. */
export function isLongTerm(holdingWeeks: number): boolean {
  return holdingWeeks >= LONG_TERM_HOLDING_WEEKS;
}

/**
 * Sell shares of one asset, oldest lot first.
 *
 * Lots are kept in an ordered array and consumed front to back. Never sort this
 * by anything but insertion order — FIFO order is what decides which lots are
 * long-term, and therefore the tax bill.
 */
export function sellLotsFifo(
  lots: readonly TaxLot[],
  assetId: AssetId,
  sharesToSell: number,
  currentWeek: number,
  priceCents: number,
): SaleResult {
  const remaining: TaxLot[] = [];
  const realized: RealizedGain[] = [];
  let outstanding = sharesToSell;
  let proceedsCents = 0;

  for (const lot of lots) {
    if (lot.assetId !== assetId || outstanding <= 0) {
      remaining.push(lot);
      continue;
    }

    const sold = Math.min(lot.shares, outstanding);
    const fraction = sold / lot.shares;
    const costBasisCents = Math.round(lot.costBasisCents * fraction);
    const saleProceeds = Math.round(sold * priceCents);
    const holdingWeeks = currentWeek - lot.purchasedWeek;

    realized.push({
      assetId,
      shares: sold,
      proceedsCents: saleProceeds,
      costBasisCents,
      gainCents: saleProceeds - costBasisCents,
      holdingWeeks,
      longTerm: isLongTerm(holdingWeeks),
    });

    proceedsCents += saleProceeds;
    outstanding -= sold;

    if (sold < lot.shares) {
      remaining.push({
        ...lot,
        shares: lot.shares - sold,
        costBasisCents: lot.costBasisCents - costBasisCents,
      });
    }
  }

  return { lots: remaining, realized, proceedsCents, unsoldShares: Math.max(0, outstanding) };
}

/** Net short-term gains. Negative if losses dominate. */
export function shortTermGainsCents(realized: readonly RealizedGain[]): number {
  return realized.filter((r) => !r.longTerm).reduce((sum, r) => sum + r.gainCents, 0);
}

/** Net long-term gains. Negative if losses dominate. */
export function longTermGainsCents(realized: readonly RealizedGain[]): number {
  return realized.filter((r) => r.longTerm).reduce((sum, r) => sum + r.gainCents, 0);
}

/**
 * Tax on long-term gains only, at the flat 15% rate.
 *
 * Short-term gains are *not* taxed here — they enter taxable income and are
 * taxed at the player's marginal rate through `incomeTaxCents`, which is what
 * TDD §6.3's `rate = marginalIncomeRate` describes. Taxing them in both places
 * would double-count. Net losses produce no tax and no refund.
 */
export function longTermGainsTaxCents(realized: readonly RealizedGain[]): number {
  return Math.round(Math.max(0, longTermGainsCents(realized)) * LONG_TERM_GAINS_RATE);
}

// --- Annual settlement -------------------------------------------------------

export interface AnnualTaxInput {
  readonly employmentGrossCents: number;
  readonly sideHustleGrossCents: number;
  readonly dividendsCents: number;
  /** Net short-term realized gains for the year. Negative on a net loss. */
  readonly shortTermGainsCents: number;
  /** Net long-term realized gains for the year. Negative on a net loss. */
  readonly longTermGainsCents: number;
  /** Employee retirement contributions, which reduce taxable income. */
  readonly retirementContributionsCents: number;
  /** Everything withheld from employment income across the year. */
  readonly withheldCents: number;
  readonly cpi: number;
}

export interface AnnualTaxSettlement {
  readonly taxableIncomeCents: number;
  readonly incomeTaxCents: number;
  readonly capitalGainsTaxCents: number;
  readonly totalOwedCents: number;
  readonly withheldCents: number;
  /** Positive is a refund; negative is a bill due. */
  readonly settlementCents: number;
  readonly marginalRate: number;
  readonly averageRate: number;
}

/**
 * Settle the year at a year boundary (TDD §6.3).
 *
 * A bill exceeding available cash becomes an `accruedUnpaidBills` liability at
 * `UNPAID_BILL_PENALTY_APR` — that part lives in the bankruptcy model (§13).
 */
export function settleAnnualTax(input: AnnualTaxInput): AnnualTaxSettlement {
  const taxableIncomeCents = Math.round(
    input.employmentGrossCents +
      input.sideHustleGrossCents +
      input.dividendsCents +
      input.shortTermGainsCents -
      input.retirementContributionsCents,
  );

  const income = incomeTaxCents(taxableIncomeCents, input.cpi);
  const gains = Math.round(Math.max(0, input.longTermGainsCents) * LONG_TERM_GAINS_RATE);
  const totalOwedCents = income + gains;

  return {
    taxableIncomeCents,
    incomeTaxCents: income,
    capitalGainsTaxCents: gains,
    totalOwedCents,
    withheldCents: input.withheldCents,
    settlementCents: input.withheldCents - totalOwedCents,
    marginalRate: marginalRate(taxableIncomeCents, input.cpi),
    averageRate: averageRate(taxableIncomeCents, input.cpi),
  };
}

/** One week of penalty interest on an unpaid tax bill. */
export function unpaidBillPenaltyCents(balanceCents: number): number {
  return Math.round((balanceCents * UNPAID_BILL_PENALTY_APR) / WEEKS_PER_YEAR);
}
