import type { LogbookEntry } from '@finme/engine';
import { WEEKS_PER_YEAR, monthOfYear, yearIndex } from '@finme/engine';
import { formatRunDate } from '@/lib/format';

/**
 * The Logbook.
 *
 * Newest first. No icons, no severity, no colour coding — the Logbook narrates
 * what happened and never says whether it was smart (GDD §1).
 */
export function LogbookPanel({ entries }: { entries: readonly LogbookEntry[] }) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nothing written yet.</p>;
  }

  return (
    <ol className="space-y-4">
      {[...entries].reverse().map((entry, index) => (
        <li key={`${entry.weekIndex}-${entry.key}-${index}`} className="border-l-2 pl-4">
          <p className="text-xs text-muted-foreground">
            {formatRunDate(yearIndex(entry.weekIndex), monthOfYear(entry.weekIndex % WEEKS_PER_YEAR))}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{entry.text}</p>
        </li>
      ))}
    </ol>
  );
}
