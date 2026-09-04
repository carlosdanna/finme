/**
 * Buy-vs-rent probe — informs the open §5.2 mortgage-rate question.
 *
 * Both households spend the same each month: whoever pays less invests the
 * difference in SAFE, dividends reinvested. The buyer puts 20% down; the renter
 * invests that down payment instead. Rent escalates with CPI; the mortgage
 * payment does not, which is where inflation quietly helps the borrower.
 *
 * Run: `pnpm -F @finme/sim housing`
 */
import {
  ASSETS,
  HOME_SALE_TRANSACTION_COST,
  type MarketHistory,
  amortizationSchedule,
  generateMarket,
  homeCarryingCostWeeklyCents,
  homeValueCents,
  monthlyPaymentCents,
  openAmortizingLoan,
  WEEKS_PER_YEAR,
} from '@finme/engine';
import { describe, formatCents } from '../stats.ts';

export const HOME_PRICE_CENTS = 32_000_000; // $320,000
export const DOWN_PAYMENT_PCT = 0.2;
export const TERM_MONTHS = 360;
export const RUN_YEARS = 30;

/** Annual rent as `price / PRICE_TO_RENT`. 18x is mid-range for the US. */
export const PRICE_TO_RENT = 18;

const MONTHS = RUN_YEARS * 12;
const weekOfMonth = (month: number) => Math.min(Math.round((month * WEEKS_PER_YEAR) / 12), 1_559);

export interface HousingOutcome {
  /** Net worth if the home is sold at this horizon, paying the 6%. */
  readonly buyerSoldCents: number;
  /** Net worth marking the home to value, as the balance sheet shows it. */
  readonly buyerHeldCents: number;
  readonly renterCents: number;
}

/** One 30-year run at one mortgage rate, sampled at each horizon in `horizons`. */
export function runHousing(
  history: MarketHistory,
  aprAnnual: number,
  horizons: readonly number[],
): Map<number, HousingOutcome> {
  const downCents = Math.round(HOME_PRICE_CENTS * DOWN_PAYMENT_PCT);
  const principalCents = HOME_PRICE_CENTS - downCents;
  const schedule = amortizationSchedule(
    openAmortizingLoan({
      id: 'mortgage',
      loanType: 'mortgage',
      principalCents,
      aprAnnual,
      termMonths: TERM_MONTHS,
      openedWeek: 0,
    }),
  );
  const mortgagePaymentCents = monthlyPaymentCents(principalCents, aprAnnual, TERM_MONTHS);

  const home = { purchasePriceCents: HOME_PRICE_CENTS, purchasedWeek: 0 };
  const safe = history.series.SAFE.priceCents;

  // The renter starts by investing what the buyer put down.
  let renterShares = downCents / safe[0];
  let buyerShares = 0;
  const out = new Map<number, HousingOutcome>();

  for (let month = 1; month <= MONTHS; month++) {
    const week = weekOfMonth(month);
    const price = safe[week];
    const value = homeValueCents(home, history.homeValuePath, week);

    // Quarterly dividends, reinvested for both households.
    if (month % 3 === 0) {
      const perShare = (price * ASSETS.SAFE.dividendYield) / 4;
      renterShares += (renterShares * perShare) / price;
      buyerShares += (buyerShares * perShare) / price;
    }

    const carryingCents = homeCarryingCostWeeklyCents(value) * (WEEKS_PER_YEAR / 12);
    const ownerOutflow = mortgagePaymentCents + carryingCents;

    // Rent tracks inflation; the mortgage payment does not.
    const cpi = history.inflation.cpi[Math.min(Math.floor((month - 1) / 12), RUN_YEARS)];
    const renterOutflow = ((HOME_PRICE_CENTS / PRICE_TO_RENT) * cpi) / 12;

    const difference = ownerOutflow - renterOutflow;
    if (difference > 0) renterShares += difference / price;
    else buyerShares += -difference / price;

    if (month % 12 === 0 && horizons.includes(month / 12)) {
      const mortgageBalance = schedule[month - 1].balanceAfterCents;
      const buyerPortfolio = buyerShares * price;
      out.set(month / 12, {
        buyerHeldCents: Math.round(value - mortgageBalance + buyerPortfolio),
        buyerSoldCents: Math.round(
          value * (1 - HOME_SALE_TRANSACTION_COST) - mortgageBalance + buyerPortfolio,
        ),
        renterCents: Math.round(renterShares * price),
      });
    }
  }

  return out;
}

export function runHousingProbe(seedCount = 500): string {
  const horizons = [3, 5, 10, 20, 30];
  const rates = [0.05, 0.055, 0.06, 0.065, 0.07, 0.075];
  const seeds = Array.from({ length: seedCount }, (_, i) => `H${i}`);
  const histories = seeds.map((seed) => generateMarket(seed, RUN_YEARS));

  const lines = [
    'Buy vs rent — the §5.2 mortgage-rate question',
    '='.repeat(92),
    `${seedCount} seeds | ${formatCents(HOME_PRICE_CENTS)} home, ${DOWN_PAYMENT_PCT * 100}% down, ` +
      `30-year term | rent at 1/${PRICE_TO_RENT} of price, CPI-linked`,
    'Both households spend the same; the one paying less invests the difference in SAFE.',
    '',
    'Median buyer advantage, selling at the horizon (pays the 6%):',
    '-'.repeat(92),
    ['APR'.padEnd(8), ...horizons.map((h) => `${h}y`.padStart(16))].join(''),
  ];

  for (const apr of rates) {
    const cells = horizons.map((h) => {
      const gaps = histories.map((history) => {
        const outcome = runHousing(history, apr, horizons).get(h)!;
        return outcome.buyerSoldCents - outcome.renterCents;
      });
      const median = describe(gaps).p50;
      return `${median >= 0 ? '+' : '-'}${formatCents(Math.abs(median))}`.padStart(16);
    });
    lines.push([`${(apr * 100).toFixed(1)}%`.padEnd(8), ...cells].join(''));
  }

  lines.push('');
  lines.push('Median buyer advantage, staying put (home marked to value):');
  lines.push('-'.repeat(92));
  lines.push(['APR'.padEnd(8), ...horizons.map((h) => `${h}y`.padStart(16))].join(''));

  for (const apr of rates) {
    const cells = horizons.map((h) => {
      const gaps = histories.map((history) => {
        const outcome = runHousing(history, apr, horizons).get(h)!;
        return outcome.buyerHeldCents - outcome.renterCents;
      });
      const median = describe(gaps).p50;
      return `${median >= 0 ? '+' : '-'}${formatCents(Math.abs(median))}`.padStart(16);
    });
    lines.push([`${(apr * 100).toFixed(1)}%`.padEnd(8), ...cells].join(''));
  }

  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(runHousingProbe(Number(process.argv[2] ?? 500)));
}
