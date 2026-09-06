import type { Granularity } from '@finme/engine';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Typography } from '@/components/finme/Typography';
import { GRANULARITY_LABEL } from '@/lib/granularity';

/**
 * The advance control.
 *
 * The most-pressed control in the game by an order of magnitude, so it sits at
 * the bottom of the screen in the thumb zone, reachable one-handed. Its
 * granularity is player-set and cycles by tapping the label beside it.
 *
 * A row in the shell's column. It was a fixed FAB, then a fixed bar; both
 * floated over the scrolling content and needed a `z-index` to stay on top of
 * it. In normal flow there is nothing to be on top of.
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
    <div className="flex-none border-t bg-card">
      <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-3 px-4">
        <button
          type="button"
          onClick={onCycleGranularity}
          className="flex h-11 min-w-0 items-center gap-1.5 rounded-full border bg-muted px-4"
          aria-label={`Advance granularity: ${GRANULARITY_LABEL[granularity]}. Tap to change.`}
        >
          <Typography variant="caption" color="muted" className="truncate font-medium">
            {GRANULARITY_LABEL[granularity]}
          </Typography>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} className="shrink-0" />
        </button>
        <Button
          type="button"
          onClick={onAdvance}
          disabled={disabled}
          className="h-11 shrink-0 rounded-full px-6 text-sm"
        >
          Advance
        </Button>
      </div>
    </div>
  );
}
