import { HugeiconsIcon } from '@hugeicons/react';
import {
  Analytics01Icon,
  Book02Icon,
  FavouriteIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { Typography } from '@/components/finme/Typography';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Tab } from '@/store/useGameStore';

/**
 * Bottom tab bar — the four primary destinations, on shadcn `Tabs`.
 *
 * `Tabs` rather than hand-rolled buttons because it brings the roving-tabindex
 * keyboard model and `aria-selected` with it. Not a sidebar: six-to-eight panels
 * do not fit in a phone sidebar, and the bottom edge is where a thumb reaches.
 *
 * The last row in the shell's column. Each target is 56px tall — over the 44px
 * minimum — sitting inside 4px of head room and 8px of foot room.
 *
 * That foot room is *added to* `env(safe-area-inset-bottom)` rather than left to
 * it. The inset is 0 on any device without a home indicator, and on those the
 * labels sat flush against the bottom edge of the screen.
 *
 * **Opaque, and not fixed.** This was `fixed ... z-40` over a translucent
 * `bg-background/95 backdrop-blur`, which let scrolled content ghost through the
 * labels and required the page to reserve space for a bar that had left the flow.
 * A destination bar is chrome: it sits at the end of the column and nothing
 * passes behind it.
 */
const TABS: readonly { readonly id: Tab; readonly label: string; readonly icon: typeof Analytics01Icon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Analytics01Icon },
  { id: 'money', label: 'Money', icon: Wallet01Icon },
  { id: 'life', label: 'Life', icon: FavouriteIcon },
  { id: 'logbook', label: 'Logbook', icon: Book02Icon },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav
      className="flex-none border-t bg-card pt-1"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      aria-label="Primary"
    >
      <Tabs value={active} onValueChange={(value) => onChange(value as Tab)}>
        {/* The height override has to carry the same variant scope as the one it
            replaces: `tabsListVariants` sets `group-data-horizontal/tabs:h-9`, and
            a bare `h-14` is a different scope, so both survive the merge and the
            list stays 36px while the triggers overflow it. */}
        <TabsList className="mx-auto w-full max-w-2xl justify-between rounded-none border-0 bg-transparent p-0 group-data-horizontal/tabs:h-14">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              // `data-active`, not `data-selected` — the Base UI attribute. The
              // old selector never matched, which went unnoticed only because
              // the trigger's default `data-active:bg-background` was the same
              // white as the bar. On a tinted canvas it paints a grey box.
              className="h-14 flex-1 flex-col gap-0.5 rounded-none font-normal text-muted-foreground data-active:bg-transparent data-active:font-medium data-active:text-primary"
            >
              <HugeiconsIcon icon={tab.icon} className="size-[22px]" strokeWidth={2} />
              <Typography variant="caption">{tab.label}</Typography>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}
