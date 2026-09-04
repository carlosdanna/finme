import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/format';

/**
 * Every currency figure in the game renders through this.
 *
 * `tabular-nums` so columns of figures line up. **No sign colouring:** a
 * negative net worth is rendered exactly like a positive one. Red-for-negative
 * is a judgement, and this game does not judge (GDD §1). `destructive` styling
 * is reserved for destructive *actions* — deleting a save, confirming
 * bankruptcy — and never for a number.
 */
export function Money({
  amountCents,
  showCents = false,
  compact = false,
  signed = false,
  className,
}: {
  amountCents: number;
  showCents?: boolean;
  compact?: boolean;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('tabular-nums', className)} data-slot="money">
      {formatCents(amountCents, { cents: showCents, compact, signed })}
    </span>
  );
}
