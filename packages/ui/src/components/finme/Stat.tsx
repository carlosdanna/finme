import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { cn } from '@/lib/utils';

/**
 * A labelled figure, built on `Item`. The label may contain `<Term>`s.
 *
 * Deliberately has no "good" or "bad" variant — `Item`'s `outline` is the only
 * one used here. Every stat looks the same whatever its value (GDD §1).
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
    <Item variant="outline" size="sm" className={cn('items-start', className)}>
      <ItemContent className="gap-0.5">
        <ItemDescription className="text-xs">{label}</ItemDescription>
        <ItemTitle className="text-lg font-semibold tabular-nums">{value}</ItemTitle>
        {hint !== undefined && <ItemDescription className="text-xs">{hint}</ItemDescription>}
      </ItemContent>
    </Item>
  );
}
