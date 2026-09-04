import { glossaryTerm } from '@finme/content';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * A glossary term — GDD §7, resolved per BUILD-PLAN Part 2b.
 *
 * The GDD specifies hover tooltips. **Phones have no hover.** If the glossary
 * were a `title` attribute or a hover-triggered popover, the single system the
 * GDD calls central to its educational goal would be invisible to the primary
 * audience.
 *
 * So: a dotted underline that opens a popover **on tap**. Desktop hover is not
 * implemented at all rather than implemented as the primary path — there is one
 * interaction, and it works everywhere. Never a `title` attribute.
 *
 * The trigger is a real button, so it is keyboard reachable and screen-reader
 * announced, and it carries a 44px touch target through vertical padding that
 * does not disturb the line box.
 */
export function Term({
  id,
  children,
  className,
}: {
  id: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const term = glossaryTerm(id);
  const label = children ?? term?.label ?? id;

  // An unknown id still renders its text; a missing definition must never blank
  // out a sentence.
  if (term === undefined) return <>{label}</>;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'relative inline cursor-help border-b border-dotted border-current/60 text-left',
          // 44px touch target without changing the text's line box.
          'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          className,
        )}
        aria-label={`${term.label}: what this means`}
        data-slot="term"
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="max-w-[19rem] text-sm leading-relaxed" side="top" align="start">
        <p className="mb-1 font-medium">{term.label}</p>
        <p className="text-muted-foreground">{term.definition}</p>
      </PopoverContent>
    </Popover>
  );
}
