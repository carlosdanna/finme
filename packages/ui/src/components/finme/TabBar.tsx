import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Tab } from '@/store/useGameStore';

/**
 * Bottom tab bar — the four primary destinations, on shadcn `Tabs`.
 *
 * `Tabs` rather than hand-rolled buttons because it brings the roving-tabindex
 * keyboard model and `aria-selected` with it. Not a sidebar: six-to-eight panels
 * do not fit in a phone sidebar, and the bottom edge is where a thumb reaches.
 *
 * Fixed to the bottom with `env(safe-area-inset-bottom)` so it clears the home
 * indicator, and each target is 56px tall — comfortably over the 44px minimum.
 */
const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'money', label: 'Money' },
  { id: 'life', label: 'Life' },
  { id: 'logbook', label: 'Logbook' },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <Tabs value={active} onValueChange={(value) => onChange(value as Tab)}>
        <TabsList className="mx-auto h-14 w-full max-w-2xl justify-between rounded-none border-0 bg-transparent p-0">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="h-14 flex-1 rounded-none text-sm data-[selected]:bg-transparent"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}

/** Height of the bar plus its safe-area inset, for content padding. */
export const TAB_BAR_CLEARANCE = 'calc(3.5rem + env(safe-area-inset-bottom))';
