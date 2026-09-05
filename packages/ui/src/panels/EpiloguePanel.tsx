import { useMemo, useState } from 'react';
import {
  ASSET_IDS,
  type EpilogueProjection,
  type RunState,
  type RunWorld,
  WEEKS_PER_YEAR,
  projectEpilogue,
  yearIndex,
} from '@finme/engine';
import { EpilogueChart } from '@/components/finme/EpilogueChart';
import { Money } from '@/components/finme/Money';
import { Stat } from '@/components/finme/Stat';
import { Term } from '@/components/finme/Term';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The end-of-run screen — TDD §12.
 *
 * **No letter grade, no rank, no percentage of optimal.** Two numbers and a
 * chart. The gap between the projection and the all-cash counterfactual is the
 * single most important output the game produces, and it is presented without a
 * single adjective.
 */
export function EpiloguePanel({ state, world }: { state: RunState; world: RunWorld }) {
  const [inspected, setInspected] = useState<number | null>(null);

  const projection: EpilogueProjection = useMemo(() => {
    const week = Math.min(state.weekIndex, world.market.weeks - 1);
    const prices = Object.fromEntries(
      ASSET_IDS.map((id) => [id, world.market.series[id].priceCents[week]]),
    );
    const weights = Object.fromEntries(
      ASSET_IDS.map((id) => [id, state.holdings[id].shares * prices[id]]),
    );

    const liquid =
      state.cashCents +
      state.savingsCents +
      state.emergencyFundCents +
      ASSET_IDS.reduce((sum, id) => sum + state.holdings[id].shares * prices[id], 0);

    return projectEpilogue(
      {
        startingWealthCents: Math.round(liquid + state.retirement.balanceCents),
        annualContributionCents: Math.round(
          (state.standingOrders.savingsWeeklyCents +
            state.standingOrders.emergencyFundWeeklyCents +
            (state.standingOrders.autoInvest?.weeklyCents ?? 0)) *
            WEEKS_PER_YEAR,
        ),
        endAge: state.startAge + yearIndex(state.weekIndex),
        weights,
        finalCpi: world.market.inflation.cpi[Math.min(yearIndex(state.weekIndex), state.runLengthYears)],
      },
      // §12: unseeded, because this is an illustration and not the simulation.
      Math.random,
    );
  }, [state, world]);

  const shown = inspected === null ? projection.bands.at(-1) : projection.bands[inspected];

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">If nothing else changed</CardTitle>
          <CardDescription>
            {projection.paths.toLocaleString('en-US')} projections from where you finished, to age{' '}
            {(shown?.age ?? 65).toString()}, under your final allocation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EpilogueChart bands={projection.bands} onInspect={setInspected} />
        </CardContent>
      </Card>

      {shown !== undefined && (
        <div className="grid grid-cols-2 gap-3">
          <Stat
            className="col-span-2"
            label={`Middle outcome at ${shown.age}`}
            value={<Money amountCents={shown.p50Cents} className="text-2xl" />}
          />
          <Stat label="Lower tenth" value={<Money amountCents={shown.p10Cents} />} />
          <Stat label="Upper tenth" value={<Money amountCents={shown.p90Cents} />} />
          <Stat
            className="col-span-2"
            label="The same contributions held entirely in cash"
            value={<Money amountCents={shown.allCashCents} />}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            In <Term id="real-terms">real terms</Term>, at today's prices
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Stat label="Middle outcome" value={<Money amountCents={projection.realP50Cents} />} />
          <Stat label="Held in cash" value={<Money amountCents={projection.realAllCashCents} />} />
        </CardContent>
      </Card>
    </div>
  );
}
