/**
 * Owned assets — TDD §8. Car and home.
 *
 * A financed car is the canonical **underwater** demonstration: the balance
 * sheet shows a loan larger than the thing it bought, plainly and without
 * comment, for about the first half of a 60-month term.
 */
import { type Rng, normal } from './rng.ts';
import { WEEKS_PER_YEAR } from './time.ts';

// --- Car (§8.1) -------------------------------------------------------------

/** [T] Lost the moment it leaves the lot. */
export const CAR_OFF_LOT_DROP = 0.12;

/** [T] Continuous annual depreciation after the off-lot drop. */
export const CAR_DEPRECIATION_RATE = 0.16;

/** [T] Scrap value: a car never becomes worthless. */
export const CAR_SCRAP_FLOOR = 0.08;

export interface Car {
  readonly purchasePriceCents: number;
  readonly purchasedWeek: number;
}

/**
 * `purchasePrice · (1 − 0.12) · exp(−0.16 · yearsOwned)`, floored at scrap.
 *
 * The floor binds at about 15 years owned.
 */
export function carValueCents(car: Car, weekIndex: number): number {
  const yearsOwned = Math.max(0, (weekIndex - car.purchasedWeek) / WEEKS_PER_YEAR);
  const depreciated =
    car.purchasePriceCents * (1 - CAR_OFF_LOT_DROP) * Math.exp(-CAR_DEPRECIATION_RATE * yearsOwned);
  return Math.round(Math.max(car.purchasePriceCents * CAR_SCRAP_FLOOR, depreciated));
}

/** What the car is worth the instant it is driven away — 88% of what was paid. */
export function carValueAtPurchaseCents(purchasePriceCents: number): number {
  return Math.round(purchasePriceCents * (1 - CAR_OFF_LOT_DROP));
}

// --- Home (§8.2, v2) --------------------------------------------------------

/** [T] Annual nominal appreciation. */
export const HOME_DRIFT = 0.03;

/** [T] Annual volatility. Far below equities, but not zero. */
export const HOME_VOLATILITY = 0.06;

/** [T] Annual maintenance, as a share of current value. */
export const HOME_MAINTENANCE_RATE = 0.01;

/** [T] Annual property tax, as a share of current value. */
export const HOME_PROPERTY_TAX_RATE = 0.011;

/**
 * [T] Agent fees and closing costs on sale. Together with maintenance and tax,
 * this is what makes buy-vs-rent genuinely non-obvious over short horizons and
 * clearly favourable over long ones — arithmetic, not copy.
 */
export const HOME_SALE_TRANSACTION_COST = 0.06;

export interface Home {
  readonly purchasePriceCents: number;
  readonly purchasedWeek: number;
}

/**
 * The cumulative log path housing follows, generated once at init.
 *
 * Uses the same convention as the market GBM (§3.2): the quoted drift is a
 * nominal annual return, converted with the −σ²/2 correction, so the *median*
 * path grows a little slower than 3%. σ is small enough that the correction is
 * 0.18%/yr.
 *
 * Drawn from the `market` stream **last**, after every asset's shocks, so that
 * adding it leaves every price series and the inflation path untouched.
 */
export function generateHomeValuePath(rng: Rng, weeks: number): Float64Array {
  const muWeekly =
    (Math.log(1 + HOME_DRIFT) - (HOME_VOLATILITY * HOME_VOLATILITY) / 2) / WEEKS_PER_YEAR;
  const sigmaWeekly = HOME_VOLATILITY / Math.sqrt(WEEKS_PER_YEAR);

  const path = new Float64Array(weeks);
  for (let t = 1; t < weeks; t++) {
    path[t] = path[t - 1] + muWeekly + sigmaWeekly * normal(rng);
  }
  return path;
}

/**
 * Value at `weekIndex`, relative to what the market did since the purchase.
 *
 * The path is a property of the world, not of the player, so buying in a
 * different week gives a different outcome from the same seed — but the world
 * itself is identical either way.
 */
export function homeValueCents(home: Home, path: Float64Array, weekIndex: number): number {
  const from = path[Math.min(home.purchasedWeek, path.length - 1)];
  const to = path[Math.min(Math.max(weekIndex, home.purchasedWeek), path.length - 1)];
  return Math.round(home.purchasePriceCents * Math.exp(to - from));
}

/** One week of maintenance, at 1.0%/yr of current value. */
export function homeMaintenanceWeeklyCents(valueCents: number): number {
  return Math.round((valueCents * HOME_MAINTENANCE_RATE) / WEEKS_PER_YEAR);
}

/** One week of property tax, at 1.1%/yr of current value. */
export function homePropertyTaxWeeklyCents(valueCents: number): number {
  return Math.round((valueCents * HOME_PROPERTY_TAX_RATE) / WEEKS_PER_YEAR);
}

/** One week of carrying costs, excluding the mortgage payment. */
export function homeCarryingCostWeeklyCents(valueCents: number): number {
  return homeMaintenanceWeeklyCents(valueCents) + homePropertyTaxWeeklyCents(valueCents);
}

/** What the sale actually puts in the player's pocket, after the 6% and the loan. */
export function homeSaleProceedsCents(valueCents: number, mortgageBalanceCents: number): number {
  const afterCosts = Math.round(valueCents * (1 - HOME_SALE_TRANSACTION_COST));
  return afterCosts - mortgageBalanceCents;
}
