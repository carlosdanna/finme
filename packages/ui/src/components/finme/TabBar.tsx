import { cn } from '@/lib/utils';
import type { Tab } from '@/store/useGameStore';

/**
 * Bottom tab bar — the four primary destinations.
 *
 * Not a sidebar: six-to-eight panels do not fit in a phone sidebar, and the
 * bottom edge is where a thumb reaches. Secondary panels open as sheets over
 * whichever tab is showing.
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
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => (
          <li key={tab.id} className="flex-1">
            <button
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={active === tab.id ? 'page' : undefined}
              className={cn(
                'flex h-14 w-full items-center justify-center text-sm font-medium transition-colors',
                active === tab.id ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Height of the bar plus its safe-area inset, for content padding. */
export const TAB_BAR_CLEARANCE = 'calc(3.5rem + env(safe-area-inset-bottom))';
