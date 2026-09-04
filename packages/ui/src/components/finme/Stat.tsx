import { cn } from '@/lib/utils';

/**
 * A labelled figure. The label may contain `<Term>`s.
 *
 * Deliberately has no "good" or "bad" variant. Every stat looks the same
 * whatever its value.
 */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
