import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * A 0-100 vital, shown as a bar and a number.
 *
 * The bar is a single neutral colour at every level. A meter that turned red
 * when low would be the interface passing judgement on a state the player is
 * already living in — and §7.4 guarantees that state is recoverable, so alarm
 * would also be misleading.
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
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm tabular-nums">{rounded}</span>
      </div>
      <Progress value={rounded} aria-label={typeof label === 'string' ? label : undefined}>
        <ProgressTrack className="h-2">
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </div>
  );
}
