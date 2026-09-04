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
import { Term } from '@/components/finme/Term';

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
      <header>
        <h2 className="text-2xl font-semibold">If nothing else changed</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {projection.paths.toLocaleString('en-US')} projections from where you finished, to age{' '}
          {(shown?.age ?? 65).toString()}, under your final allocation.
        </p>
      </header>

      <EpilogueChart bands={projection.bands} onInspect={setInspected} />

      {shown !== undefined && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Middle outcome at {shown.age}</dt>
            <dd className="text-2xl font-semibold">
              <Money amountCents={shown.p50Cents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lower tenth</dt>
            <dd className="text-lg tabular-nums">
              <Money amountCents={shown.p10Cents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Upper tenth</dt>
            <dd className="text-lg tabular-nums">
              <Money amountCents={shown.p90Cents} />
            </dd>
          </div>
          <div className="col-span-2 border-t pt-3">
            <dt className="text-xs text-muted-foreground">
              The same contributions held entirely in cash
            </dt>
            <dd className="text-lg tabular-nums">
              <Money amountCents={shown.allCashCents} />
            </dd>
          </div>
        </dl>
      )}

      <section className="space-y-2 border-t pt-4 text-sm">
        <p className="text-muted-foreground">
          In <Term id="real-terms">real terms</Term>, at today's prices:
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <dt className="text-xs text-muted-foreground">Middle outcome</dt>
            <dd className="tabular-nums">
              <Money amountCents={projection.realP50Cents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Held in cash</dt>
            <dd className="tabular-nums">
              <Money amountCents={projection.realAllCashCents} />
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
