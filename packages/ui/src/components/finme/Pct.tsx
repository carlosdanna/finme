import { cn } from '@/lib/utils';
import { formatPct } from '@/lib/format';

/** Percentages, with the same no-judgement rule as `<Money>`. */
export function Pct({
  value,
  decimals = 1,
  signed = false,
  className,
}: {
  value: number;
  decimals?: number;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('tabular-nums', className)} data-slot="pct">
      {formatPct(value, { decimals, signed })}
    </span>
  );
}
