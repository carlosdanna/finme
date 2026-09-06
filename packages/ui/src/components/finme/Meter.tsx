import { Typography } from '@/components/finme/Typography';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * A 0-100 vital, shown as a bar and a number.
 *
 * The bar is a single neutral colour at every level. A meter that turned red
 * when low would be the interface passing judgement on a state the player is
 * already living in — and §7.4 guarantees that state is recoverable, so alarm
 * would also be misleading.
 *
 * **`Progress` supplies its own track.** It renders `{children}` *and* a default
 * `ProgressTrack`, so passing one as a child drew the bar twice. The height is
 * set on the track it renders instead.
 */
export function Meter({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: number;
  className?: string;
}) {
  const rounded = Math.round(value);
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Typography variant="caption" color="muted">
          {label}
        </Typography>
        <Typography variant="body" as="span" className="tabular-nums">
          {rounded}
        </Typography>
      </div>
      <Progress
        value={rounded}
        className="[&_[data-slot=progress-track]]:h-2"
        aria-label={typeof label === 'string' ? label : undefined}
      />
    </div>
  );
}
