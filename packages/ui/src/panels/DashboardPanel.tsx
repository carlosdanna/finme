import { useState } from 'react';
import { type RunState, formatSeedString, weekOfMonth } from '@finme/engine';
import { Meter } from '@/components/finme/Meter';
import { Money } from '@/components/finme/Money';
import { NetWorthChart } from '@/components/finme/NetWorthChart';
import { Term } from '@/components/finme/Term';
import { Typography } from '@/components/finme/Typography';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The dashboard.
 *
 * Net worth, the chart, and the figures that matter week to week. No scores, no
 * grades, no ranks, and nothing that tells the player how they are doing
 * relative to anyone but their own past.
 *
 * The six figures share one card divided by hairlines rather than sitting in six
 * separate outlined boxes. Six equally-weighted containers gave the hero nothing
 * to be a hero against; the figures and their order are unchanged.
 */

/**
 * One figure in the vitals grid.
 *
 * The grid supplies its own 16px cell padding, so the card is `py-0` — `Card`'s
 * default 24px block padding on top of that left a band of dead space above the
 * first row and below the last.
 */
function Cell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-col gap-0.5 p-4', className)}>{children}</div>;
}

export function DashboardPanel({ state }: { state: RunState }) {
  const [inspected, setInspected] = useState<number | null>(null);
  const history = state.netWorthHistory;
  const current = history.at(-1) ?? 0;
  const shown = inspected === null ? current : (history[inspected] ?? current);

  // Net worth at the first week of the current month. The 4-4-5 calendar means
  // "a month ago" is 4 or 5 weeks depending on the month, so the month's own
  // start week is the only honest anchor — never a fixed 4-week lookback.
  const monthStart = state.weekIndex - weekOfMonth(state.weekIndex);
  const monthStartValue = monthStart >= 0 ? history[monthStart] : undefined;
  const monthDelta =
    monthStartValue === undefined || monthStart === state.weekIndex
      ? null
      : current - monthStartValue;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-6">
        <div className="space-y-1">
          {/* In the §2.3 display form, version and all: GDD §13 makes the seed
              the unit of sharing, and a seed without its ruleset is not one. */}
          <Typography
            variant="caption"
            color="muted"
            className="flex flex-wrap items-baseline gap-x-2"
          >
            {state.playerName !== '' && <span>{state.playerName}</span>}
            <span className="font-mono tabular-nums">
              {formatSeedString(state.seed, state.rulesetVersion)}
            </span>
          </Typography>
          <Typography variant="h1" as="p" className="tabular-nums">
            <Money amountCents={shown} />
          </Typography>
          <Typography variant="body" color="muted" className="flex flex-wrap items-baseline gap-2">
            <Term id="net-worth">net worth</Term>
            {inspected !== null ? (
              <span>· week {inspected}</span>
            ) : (
              monthDelta !== null && (
                <>
                  <span aria-hidden="true" className="opacity-50">
                    ·
                  </span>
                  {/* Unsigned by colour, signed by glyph. A change of any
                      direction renders identically (GDD §1). */}
                  <span className="tabular-nums">
                    <Money amountCents={monthDelta} signed /> this month
                  </span>
                </>
              )
            )}
          </Typography>
        </div>
        <div className="mt-4">
          <NetWorthChart values={history} onInspect={setInspected} />
        </div>
      </Card>

      <Card className="py-0">
        <div className="grid grid-cols-2">
          <Cell className="border-r border-b">
            <Typography variant="caption" color="muted">
              Cash
            </Typography>
            <Typography variant="h4" as="p" className="tabular-nums">
              <Money amountCents={state.cashCents} />
            </Typography>
          </Cell>
          <Cell className="border-b">
            <Typography variant="caption" color="muted">
              <Term id="emergency-fund">Emergency fund</Term>
            </Typography>
            <Typography variant="h4" as="p" className="tabular-nums">
              <Money amountCents={state.emergencyFundCents} />
            </Typography>
          </Cell>

          <Cell className="gap-1.5 border-r border-b">
            <Meter label="Energy" value={state.energy} />
          </Cell>
          <Cell className="gap-1.5 border-b">
            <Meter label="Mood" value={state.mood} />
          </Cell>

          <Cell className="border-r">
            <Typography variant="caption" color="muted">
              Job
            </Typography>
            <Typography variant="h4" as="p">
              {state.job?.jobId ?? 'Not working'}
            </Typography>
            {state.job !== null && (
              <Typography variant="caption" color="muted" className="tabular-nums">
                <Money amountCents={state.job.weeklyGrossCents} /> a week
              </Typography>
            )}
          </Cell>
          <Cell>
            <Typography variant="caption" color="muted">
              <Term id="credit-score">Credit score</Term>
            </Typography>
            <Typography variant="h4" as="p" className="tabular-nums">
              {state.credit.score ?? 'No credit history'}
            </Typography>
          </Cell>
        </div>
      </Card>
    </div>
  );
}
