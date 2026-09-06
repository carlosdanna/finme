import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Every piece of text in the game renders through this.
 *
 * The type scale had drifted into one-off values — `text-[15px]`, `text-[11px]`,
 * `text-[2.125rem]`, `text-lg`, `text-base` — chosen per screen, so nothing
 * lined up between panels. There are six steps and no others.
 *
 * `variant` picks the step and the element. `as` changes the element without
 * changing the step, for the cases where the two disagree: a figure that reads
 * as `h1` but is not a heading, or a heading that must be an `h2` for document
 * order while looking like an `h3`. `size` changes the step without changing the
 * element, for the reverse.
 *
 * **On `warning` / `success` / `error`:** they exist, and they must never be
 * applied to a financial figure. Red-for-negative and green-for-positive are
 * judgements, and this game does not judge (GDD §1) — `Money` and `Pct` render
 * every value identically whatever its sign, and neither accepts a colour. These
 * three are for system state: a save that failed, an export that finished. If you
 * are reaching for `error` to mark a number, the answer is no.
 */
const SIZES = {
  h1: 'font-heading text-[2.125rem] leading-10 font-semibold tracking-tight',
  h2: 'font-heading text-2xl leading-8 font-semibold tracking-tight',
  h3: 'font-heading text-[1.1875rem] leading-7 font-semibold tracking-tight',
  h4: 'font-heading text-base leading-6 font-medium',
  body: 'text-sm leading-5 font-normal',
  caption: 'text-xs leading-4 font-normal',
} as const;

const typographyVariants = cva('', {
  variants: {
    variant: SIZES,
    size: SIZES,
    color: {
      default: 'text-foreground',
      // For text inside an already-coloured surface — the point suffix on a
      // selected segment, a label inside a filled button. Without it, `default`
      // paints `text-foreground` over the surface's own foreground and the text
      // goes dark on a dark fill. Not a colour: the absence of one.
      inherit: 'text-inherit',
      muted: 'text-muted-foreground',
      warning: 'text-warning',
      success: 'text-success',
      error: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'body',
    color: 'default',
  },
});

/** The element each variant renders as when `as` is not given. */
const DEFAULT_TAG = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  body: 'p',
  caption: 'span',
} as const;

export type TypographyVariant = keyof typeof SIZES;

type TypographyProps = React.ComponentProps<'p'> &
  VariantProps<typeof typographyVariants> & {
    /** Render as a different element. Does not change the type step. */
    as?: React.ElementType;
  };

export function Typography({
  variant = 'body',
  size,
  color = 'default',
  as,
  className,
  ...props
}: TypographyProps) {
  // `size` wins over `variant` for the step; `variant` still picks the element.
  //
  // Passing the resolved step as `variant` rather than leaving it `undefined`:
  // `undefined` falls through to cva's `defaultVariants`, which put `body`'s
  // classes into the output alongside the requested size and left the outcome
  // riding on tailwind-merge resolving the conflict in the right direction.
  const Component = as ?? DEFAULT_TAG[variant ?? 'body'];
  return (
    <Component
      data-slot="typography"
      className={cn(typographyVariants({ variant: size ?? variant, size, color }), className)}
      {...props}
    />
  );
}
