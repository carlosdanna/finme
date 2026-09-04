import { useState } from 'react';
import {
  type RunState,
  WEEKS_PER_YEAR,
  monthOfYear,
  yearIndex,
} from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { NetWorthChart } from '@/components/finme/NetWorthChart';
import { Stat } from '@/components/finme/Stat';
import { Term } from '@/components/finme/Term';
import { formatRunDate } from '@/lib/format';

/**
 * The dashboard.
 *
 * Net worth, the chart, and the four figures that matter week to week. No
 * scores, no grades, no ranks, and nothing that tells the player how they are
 * doing relative to anyone but their own past.
 */
export function DashboardPanel({ state }: { state: RunState }) {
  const [inspected, setInspected] = useState<number | null>(null);
  const history = state.netWorthHistory;
  const current = history.at(-1) ?? 0;
  const shown = inspected === null ? current : (history[inspected] ?? current);
  const age = state.startAge + yearIndex(state.weekIndex);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">
          {formatRunDate(yearIndex(state.weekIndex), monthOfYear(state.weekIndex % WEEKS_PER_YEAR))}
          {' · '}
          {age} years old
        </p>
        <h2 className="mt-1 text-3xl font-semibold">
          <Money amountCents={shown} />
        </h2>
        <p className="text-xs text-muted-foreground">
          <Term id="net-worth">net worth</Term>
          {inspected !== null && ` · week ${inspected}`}
        </p>
      </header>

      <NetWorthChart values={history} onInspect={setInspected} />

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Cash" value={<Money amountCents={state.cashCents} />} />
        <Stat
          label={<Term id="emergency-fund">Emergency fund</Term>}
          value={<Money amountCents={state.emergencyFundCents} />}
        />
        <Stat label="Energy" value={Math.round(state.energy)} />
        <Stat label="Mood" value={Math.round(state.mood)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Job"
          value={<span className="text-base">{state.job?.jobId ?? 'Not working'}</span>}
          hint={state.job === null ? undefined : <Money amountCents={state.job.weeklyGrossCents} />}
        />
        <Stat
          label={<Term id="credit-score">Credit score</Term>}
          value={state.credit.score ?? <span className="text-base">No credit history</span>}
        />
      </div>
    </div>
  );
}
