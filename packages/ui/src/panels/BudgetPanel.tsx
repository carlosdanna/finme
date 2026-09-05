import {
  BASE_MONTHLY_EXPENSES_CENTS,
  type RunState,
  type RunWorld,
  WEEKS_PER_YEAR,
  tierRentCents,
  yearIndex,
} from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Stat } from '@/components/finme/Stat';
import { Term } from '@/components/finme/Term';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';

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
  const outgoings =
    rent + living + state.recurringExpenses.reduce((sum, expense) => sum + expense.cents, 0);

  const lines = [
    ...(rent > 0 ? [{ label: 'Rent', cents: rent }] : []),
    { label: 'Living costs', cents: living },
    ...state.recurringExpenses.map((expense) => ({ label: expense.category, cents: expense.cents })),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Monthly income" value={<Money amountCents={monthlyGross} />} hint="before tax" />
        <Stat label="Monthly outgoings" value={<Money amountCents={outgoings} />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Where it goes</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-0">
            {lines.map((line, index) => (
              <Item key={`${line.label}-${index}`} size="xs">
                <ItemContent>
                  <ItemTitle className="font-normal capitalize">{line.label}</ItemTitle>
                </ItemContent>
                <Money amountCents={line.cents} className="text-sm" />
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 text-sm">
          These are <Term id="nominal">nominal</Term> figures — what things cost this year. Prices
          have moved <Money amountCents={Math.round((cpi - 1) * 10_000)} /> per{' '}
          <Money amountCents={10_000} /> since the run began.
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
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
