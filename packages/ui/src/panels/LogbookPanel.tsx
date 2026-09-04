import { useState } from 'react';
import type { AnnualSnapshot, LogbookEntry } from '@finme/engine';
import { WEEKS_PER_YEAR, monthOfYear, yearIndex } from '@finme/engine';
import { AnnualReviewPanel } from './AnnualReviewPanel';
import { Money } from '@/components/finme/Money';
import { formatRunDate } from '@/lib/format';

/**
 * The Logbook — scrollable, newest first, with **annual reviews pinned inline**
 * at the year they close.
 *
 * No icons, no severity, no colour coding. The Logbook narrates what happened
 * and never says whether it was smart (GDD §1). The reviews are available here
 * on demand afterwards, as GDD §4.2 requires.
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
  const [openReview, setOpenReview] = useState<number | null>(null);

  if (entries.length === 0 && snapshots.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nothing written yet.</p>;
  }

  // Reviews sit at the year boundary they close, interleaved by week.
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
    <ol className="space-y-4">
      {rows.map((row, index) =>
        row.kind === 'review' ? (
          <li key={`review-${row.snapshot.year}`} className="rounded-lg border p-4">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
              onClick={() =>
                setOpenReview(openReview === row.snapshot.year ? null : row.snapshot.year)
              }
              aria-expanded={openReview === row.snapshot.year}
            >
              <span>
                <span className="block text-xs text-muted-foreground">
                  End of year {row.snapshot.year}
                </span>
                <span className="text-base font-medium">Annual review</span>
              </span>
              <Money amountCents={row.snapshot.netWorthCents} className="text-lg font-semibold" />
            </button>
            {openReview === row.snapshot.year && (
              <div className="mt-4 border-t pt-4">
                <AnnualReviewPanel
                  snapshots={snapshots.filter((s) => s.year <= row.snapshot.year)}
                />
              </div>
            )}
          </li>
        ) : (
          <li key={`entry-${row.weekIndex}-${index}`} className="border-l-2 pl-4">
            <p className="text-xs text-muted-foreground">
              {formatRunDate(
                yearIndex(row.weekIndex),
                monthOfYear(row.weekIndex % WEEKS_PER_YEAR),
              )}
            </p>
            <p className="mt-1 text-sm leading-relaxed">{row.entry.text}</p>
          </li>
        ),
      )}
    </ol>
  );
}
