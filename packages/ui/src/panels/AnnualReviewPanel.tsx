import type { AnnualSnapshot } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Pct } from '@/components/finme/Pct';
import { Term } from '@/components/finme/Term';
import { cn } from '@/lib/utils';

/**
 * The annual review — GDD §4.2, the game's main reflective beat.
 *
 * **The player is compared to their own past and to nothing else.** The
 * comparison-to-optimal-play scoring was removed from the design because it
 * contradicted the no-green-checkmarks philosophy and punished the harder
 * starting scenarios. So: no grade, no rank, no percentage of optimal, and no
 * adjective anywhere on this screen.
 *
 * The year-over-year table scrolls horizontally with a **pinned first column**
 * below `md:`. A table of eight years of figures cannot compress into 390px, and
 * without the pinned column the reader loses which row they are on.
 */
const ROWS = [
  { key: 'netWorthCents', label: <Term id="net-worth">Net worth</Term> },
  { key: 'assetsCents', label: 'Assets' },
  { key: 'liabilitiesCents', label: 'Liabilities' },
  { key: 'incomeCents', label: 'Income' },
  { key: 'taxPaidCents', label: 'Tax paid' },
  { key: 'interestPaidCents', label: 'Interest paid' },
  { key: 'cashCents', label: 'Cash' },
] as const;

/** Restate a nominal figure in year-0 money. */
function real(cents: number, cpi: number): number {
  return Math.round(cents / cpi);
}

export function AnnualReviewPanel({
  snapshots,
  showReal = true,
}: {
  snapshots: readonly AnnualSnapshot[];
  showReal?: boolean;
}) {
  if (snapshots.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        The first review arrives at the end of year one.
      </p>
    );
  }

  const latest = snapshots.at(-1)!;
  const previous = snapshots.at(-2);
  const savingsRate =
    latest.incomeCents <= 0
      ? 0
      : (latest.netWorthCents - (previous?.netWorthCents ?? 0)) / latest.incomeCents;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted-foreground">Year {latest.year}</p>
        <h2 className="mt-1 text-2xl font-semibold">
          <Money amountCents={latest.netWorthCents} />
        </h2>
        <p className="text-xs text-muted-foreground">
          <Money amountCents={real(latest.netWorthCents, latest.cpi)} /> in{' '}
          <Term id="real-terms">real terms</Term>
        </p>
      </header>

      {/* Year over year. Horizontally scrollable, first column pinned. */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Against your own past</h3>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-background py-2 pr-4 text-left font-medium"
                >
                  <span className="sr-only">Figure</span>
                </th>
                {snapshots.map((snapshot) => (
                  <th
                    key={snapshot.year}
                    scope="col"
                    className="px-3 py-2 text-right font-medium tabular-nums"
                  >
                    Y{snapshot.year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-t bg-background py-2 pr-4 text-left font-normal text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  {snapshots.map((snapshot) => (
                    <td key={snapshot.year} className="border-t px-3 py-2 text-right">
                      <Money amountCents={snapshot[row.key]} compact />
                      {showReal && (
                        <span className="block text-xs text-muted-foreground">
                          <Money amountCents={real(snapshot[row.key], snapshot.cpi)} compact />
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showReal && (
          <p className="mt-2 text-xs text-muted-foreground">
            Upper figure <Term id="nominal">nominal</Term>, lower figure in{' '}
            <Term id="real-terms">real terms</Term>.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">This year</h3>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Income</dt>
            <dd className="tabular-nums">
              <Money amountCents={latest.incomeCents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Savings rate</dt>
            <dd className="tabular-nums">
              <Pct value={savingsRate} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tax paid</dt>
            <dd className="tabular-nums">
              <Money amountCents={latest.taxPaidCents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Interest paid</dt>
            <dd className="tabular-nums">
              <Money amountCents={latest.interestPaidCents} />
            </dd>
          </div>
        </dl>
      </section>

      <Counterfactuals snapshot={latest} />
    </div>
  );
}

/**
 * Two or three concrete counterfactuals, drawn from what the player actually
 * did, **stated as arithmetic and nothing else** (GDD §4.2).
 *
 * No adjectives. No verdict. Each line says what happened and what a different
 * choice would have come to, and then stops.
 */
function Counterfactuals({ snapshot }: { snapshot: AnnualSnapshot }) {
  const lines: React.ReactNode[] = [];

  if (snapshot.matchForgoneCents > 0) {
    lines.push(
      <>
        You contributed{' '}
        <Money amountCents={snapshot.retirementContributedCents} /> to the retirement account this
        year. The <Term id="employer-match">employer match</Term> you did not take was{' '}
        <Money amountCents={snapshot.matchForgoneCents} />.
      </>,
    );
  }

  if (snapshot.interestPaidCents > 0) {
    lines.push(
      <>
        You paid <Money amountCents={snapshot.interestPaidCents} /> in interest this year. Your cash
        balance at year end was <Money amountCents={snapshot.cashCents} />.
      </>,
    );
  }

  const realIncome = real(snapshot.incomeCents, snapshot.cpi);
  if (snapshot.cpi > 1) {
    lines.push(
      <>
        Your income was <Money amountCents={snapshot.incomeCents} />. In year-one money that is{' '}
        <Money amountCents={realIncome} />.
      </>,
    );
  }

  if (lines.length === 0) return null;

  return (
    <section>
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">The arithmetic</h3>
      <ul className="space-y-3">
        {lines.slice(0, 3).map((line, index) => (
          <li key={index} className={cn('border-l-2 pl-4 text-sm leading-relaxed')}>
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}
