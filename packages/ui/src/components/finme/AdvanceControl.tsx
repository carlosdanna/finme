import type { Granularity } from '@finme/engine';
import { Button } from '@/components/ui/button';
import { GRANULARITY_LABEL } from '@/lib/granularity';
import { TAB_BAR_CLEARANCE } from './TabBar';

/**
 * The advance control.
 *
 * The most-pressed control in the game by an order of magnitude, so it sits in
 * the bottom-right thumb zone, above the tab bar, reachable one-handed. Its
 * granularity is player-set and cycles by tapping the label above it.
 */
export function AdvanceControl({
  granularity,
  onAdvance,
  onCycleGranularity,
  disabled = false,
}: {
  granularity: Granularity;
  onAdvance: () => void;
  onCycleGranularity: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="fixed right-4 z-40 flex flex-col items-end gap-2"
      style={{ bottom: `calc(${TAB_BAR_CLEARANCE} + 1rem)` }}
    >
      <button
        type="button"
        onClick={onCycleGranularity}
        className="flex h-11 items-center rounded-full border bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur"
        aria-label={`Advance granularity: ${GRANULARITY_LABEL[granularity]}. Tap to change.`}
      >
        {GRANULARITY_LABEL[granularity]}
      </button>
      <Button
        type="button"
        size="lg"
        onClick={onAdvance}
        disabled={disabled}
        // 56px: the most-pressed control in the game, comfortably over the
        // 44px minimum. `size="lg"` alone is h-10, which is under it.
        className="h-14 rounded-full px-6 text-base shadow-lg"
      >
        Advance
      </Button>
    </div>
  );
}
