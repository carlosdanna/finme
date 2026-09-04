import {
  BASE_MONTHLY_EXPENSES_CENTS,
  type RunState,
  type RunWorld,
  WEEKS_PER_YEAR,
  tierRentCents,
  yearIndex,
} from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Term } from '@/components/finme/Term';
import { Stat } from '@/components/finme/Stat';

/**
 * The Budget panel — money in against money out, at today's prices.
 *
 * Every figure is nominal and labelled as such. The real-versus-nominal
 * comparison belongs to the annual review, where a year of context makes it
 * mean something.
 */
export function BudgetPanel({ state, world }: { state: RunState; world: RunWorld }) {
  const cpi = world.market.inflation.cpi[Math.min(yearIndex(state.weekIndex), state.runLengthYears)];
  const monthlyGross = Math.round((state.job?.weeklyGrossCents ?? 0) * (WEEKS_PER_YEAR / 12));
  const rent = state.home === null ? Math.round(tierRentCents(state.housingTier) * cpi) : 0;
  const living = Math.round(BASE_MONTHLY_EXPENSES_CENTS * cpi);
  const recurring = state.recurringExpenses.reduce((sum, expense) => sum + expense.cents, 0);
  const outgoings = rent + living + recurring;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Monthly income" value={<Money amountCents={monthlyGross} />} hint="before tax" />
        <Stat label="Monthly outgoings" value={<Money amountCents={outgoings} />} />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Where it goes</h3>
        <dl className="space-y-1.5 text-sm">
          {rent > 0 && (
            <div className="flex justify-between gap-4">
              <dt>Rent</dt>
              <dd>
                <Money amountCents={rent} />
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt>Living costs</dt>
            <dd>
              <Money amountCents={living} />
            </dd>
          </div>
          {state.recurringExpenses.map((expense, index) => (
            <div key={`${expense.category}-${index}`} className="flex justify-between gap-4">
              <dt className="capitalize">{expense.category}</dt>
              <dd>
                <Money amountCents={expense.cents} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border p-4">
        <p className="text-sm">
          These are <Term id="nominal">nominal</Term> figures — what things cost this year. Prices
          have moved <Money amountCents={Math.round((cpi - 1) * 10_000)} /> per{' '}
          <Money amountCents={10_000} /> since the run began.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Cash" value={<Money amountCents={state.cashCents} />} />
        <Stat
          label={<Term id="emergency-fund">Emergency fund</Term>}
          value={<Money amountCents={state.emergencyFundCents} />}
          hint={
            outgoings > 0
              ? `${(state.emergencyFundCents / outgoings).toFixed(1)} months of outgoings`
              : undefined
          }
        />
      </div>
    </div>
  );
}
