/**
 * Net worth and the balance sheet — TDD §4.2.
 *
 * `retirementBalance` counts in full despite early-withdrawal penalties.
 * Haircutting it would be more "accurate" and much worse pedagogy: it would make
 * the highest-value action in the game look less valuable on the headline number.
 */
import type { Debt } from './debt/types.ts';
import { totalLiabilitiesCents } from './debt/types.ts';
import type { AssetId, MarketHistory } from './market.ts';

/** Fractional share counts, by asset. Anything omitted is zero. */
export type Holdings = Partial<Record<AssetId, number>>;

export interface BalanceSheetInput {
  readonly cashCents: number;
  readonly savingsCents: number;
  readonly emergencyFundCents: number;
  readonly portfolioValueCents: number;
  readonly retirementBalanceCents: number;
  readonly carValueCents: number;
  readonly homeValueCents: number;
  /**
   * Every debt the player holds, the mortgage included.
   *
   * §4.2 writes liabilities as `Σ_d balance_d + accruedUnpaidBills +
   * mortgagePrincipal`, but a mortgage is one of the `Debt`s in that sum — adding
   * it again double-counts. It belongs in this array and nowhere else.
   */
  readonly debts: readonly Debt[];
  readonly accruedUnpaidBillsCents: number;
}

export interface BalanceSheet {
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
  readonly netWorthCents: number;
  /** Itemized for the balance sheet panel. */
  readonly assetLines: readonly { readonly label: string; readonly cents: number }[];
  readonly liabilityLines: readonly { readonly label: string; readonly cents: number }[];
}

/** Mark a portfolio to market at a given week. */
export function portfolioValueCents(
  holdings: Holdings,
  history: MarketHistory,
  weekIndex: number,
): number {
  let total = 0;
  // Iterate the stable asset order, never the object's own keys.
  for (const id of Object.keys(history.series) as AssetId[]) {
    const shares = holdings[id] ?? 0;
    if (shares === 0) continue;
    total += shares * history.series[id].priceCents[weekIndex];
  }
  return Math.round(total);
}

export function assetsCents(input: BalanceSheetInput): number {
  return (
    input.cashCents +
    input.savingsCents +
    input.emergencyFundCents +
    input.portfolioValueCents +
    input.retirementBalanceCents +
    input.carValueCents +
    input.homeValueCents
  );
}

export function liabilitiesCents(input: BalanceSheetInput): number {
  return totalLiabilitiesCents(input.debts) + input.accruedUnpaidBillsCents;
}

export function netWorthCents(input: BalanceSheetInput): number {
  return assetsCents(input) - liabilitiesCents(input);
}

/** The itemized view the balance sheet panel renders. */
export function balanceSheet(input: BalanceSheetInput): BalanceSheet {
  const assetLines = [
    { label: 'Cash', cents: input.cashCents },
    { label: 'Savings', cents: input.savingsCents },
    { label: 'Emergency fund', cents: input.emergencyFundCents },
    { label: 'Investments', cents: input.portfolioValueCents },
    { label: 'Retirement', cents: input.retirementBalanceCents },
    { label: 'Car', cents: input.carValueCents },
    { label: 'Home', cents: input.homeValueCents },
  ].filter((line) => line.cents !== 0);

  const liabilityLines = [
    ...input.debts.map((debt) => ({ label: debt.id, cents: debt.balanceCents })),
    { label: 'Unpaid bills', cents: input.accruedUnpaidBillsCents },
  ].filter((line) => line.cents !== 0);

  return {
    assetsCents: assetsCents(input),
    liabilitiesCents: liabilitiesCents(input),
    netWorthCents: netWorthCents(input),
    assetLines,
    liabilityLines,
  };
}

/** An empty balance sheet, for a run that has not started buying anything. */
export function emptyBalanceSheetInput(): BalanceSheetInput {
  return {
    cashCents: 0,
    savingsCents: 0,
    emergencyFundCents: 0,
    portfolioValueCents: 0,
    retirementBalanceCents: 0,
    carValueCents: 0,
    homeValueCents: 0,
    debts: [],
    accruedUnpaidBillsCents: 0,
  };
}
