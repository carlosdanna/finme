import type { AnnualSnapshot, LogbookEntry } from '@finme/engine';
import { WEEKS_PER_YEAR, monthOfYear, yearIndex } from '@finme/engine';
import { AnnualReviewPanel } from './AnnualReviewPanel';
import { Money } from '@/components/finme/Money';
import { Nothing } from '@/components/finme/Nothing';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item';
import { formatRunDate } from '@/lib/format';

/**
 * The Logbook — scrollable, newest first, with **annual reviews pinned inline**
 * at the year they close.
 *
 * No icons, no severity, no colour coding. The Logbook narrates what happened
 * and never says whether it was smart (GDD §1). The reviews are available here
 * on demand afterwards, as GDD §4.2 requires, via `Collapsible`.
 */
type Row =
  | { readonly kind: 'entry'; readonly weekIndex: number; readonly entry: LogbookEntry }
  | { readonly kind: 'review'; readonly weekIndex: number; readonly snapshot: AnnualSnapshot };

export function LogbookPanel({
  entries,
  snapshots = [],
}: {
  entries: readonly LogbookEntry[];
  snapshots?: readonly AnnualSnapshot[];
}) {
  if (entries.length === 0 && snapshots.length === 0) {
    return <Nothing title="Nothing written yet." />;
  }

  const rows: Row[] = [
    ...entries.map((entry): Row => ({ kind: 'entry', weekIndex: entry.weekIndex, entry })),
    ...snapshots.map(
      (snapshot): Row => ({
        kind: 'review',
        weekIndex: snapshot.year * WEEKS_PER_YEAR,
        snapshot,
      }),
    ),
  ].sort((a, b) => b.weekIndex - a.weekIndex);

  return (
    <ItemGroup className="gap-3">
      {rows.map((row, index) =>
        row.kind === 'review' ? (
          <Card key={`review-${row.snapshot.year}`}>
            <Collapsible>
              <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 p-4 text-left">
                <span>
                  <span className="block text-xs text-muted-foreground">
                    End of year {row.snapshot.year}
                  </span>
                  <span className="text-base font-medium">Annual review</span>
                </span>
                <Money amountCents={row.snapshot.netWorthCents} className="text-lg font-semibold" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="border-t pt-4">
                  <AnnualReviewPanel
                    snapshots={snapshots.filter((s) => s.year <= row.snapshot.year)}
                  />
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ) : (
          <Item key={`entry-${row.weekIndex}-${index}`} size="sm" className="border-l-2 pl-4">
            <ItemContent className="gap-1">
              <ItemDescription className="text-xs">
                {formatRunDate(
                  yearIndex(row.weekIndex),
                  monthOfYear(row.weekIndex % WEEKS_PER_YEAR),
                )}
              </ItemDescription>
              <ItemTitle className="text-sm font-normal leading-relaxed whitespace-normal">
                {row.entry.text}
              </ItemTitle>
            </ItemContent>
          </Item>
        ),
      )}
    </ItemGroup>
  );
}
