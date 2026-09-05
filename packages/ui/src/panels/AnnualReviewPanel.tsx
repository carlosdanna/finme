import type { AnnualSnapshot } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Nothing } from '@/components/finme/Nothing';
import { Pct } from '@/components/finme/Pct';
import { Stat } from '@/components/finme/Stat';
import { Term } from '@/components/finme/Term';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';

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
    return <Nothing title="The first review arrives at the end of year one." />;
  }

  const latest = snapshots.at(-1)!;
  const previous = snapshots.at(-2);
  const savingsRate =
    latest.incomeCents <= 0
      ? 0
      : (latest.netWorthCents - (previous?.netWorthCents ?? 0)) / latest.incomeCents;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardDescription>Year {latest.year}</CardDescription>
          <CardTitle className="text-2xl">
            <Money amountCents={latest.netWorthCents} />
          </CardTitle>
          <CardDescription>
            <Money amountCents={real(latest.netWorthCents, latest.cpi)} /> in{' '}
            <Term id="real-terms">real terms</Term>
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Year over year. Horizontally scrollable, first column pinned. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Against your own past
          </CardTitle>
        </CardHeader>
        <CardContent>
        <div className="-mx-2 overflow-x-auto px-2">
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Income" value={<Money amountCents={latest.incomeCents} />} />
        <Stat label="Savings rate" value={<Pct value={savingsRate} />} />
        <Stat label="Tax paid" value={<Money amountCents={latest.taxPaidCents} />} />
        <Stat label="Interest paid" value={<Money amountCents={latest.interestPaidCents} />} />
      </div>

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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">The arithmetic</CardTitle>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          {lines.slice(0, 3).map((line, index) => (
            <Item key={index} size="sm" className="border-l-2">
              <ItemContent>
                <ItemTitle className="text-sm font-normal leading-relaxed whitespace-normal">
                  {line}
                </ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
