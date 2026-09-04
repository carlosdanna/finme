/**
 * The Zustand store.
 *
 * **Contains zero simulation logic.** Every state change comes from the engine;
 * this is a subscription layer and a place to keep which panel is open. If a
 * calculation is needed here, it belongs in `@finme/engine` instead.
 *
 * **No navigation state in the URL.** Panel routing lives here because URL
 * routing behaves differently inside a native webview and is the most common
 * source of port friction (BUILD-PLAN Part 2b).
 */
import {
  type Granularity,
  type Interrupt,
  type Run,
  type RunState,
  type TickInput,
  advance,
  defaultGranularity,
  tick,
  yearIndex,
} from '@finme/engine';
import { createScenarioRun, DEFAULT_ALLOCATION } from '@finme/content';
import type { Allocation, EventDef } from '@finme/engine';
import { create } from 'zustand';

/** The four primary destinations in the bottom tab bar. */
export type Tab = 'dashboard' | 'money' | 'life' | 'logbook';

/** Secondary panels, opened as sheets over the current tab. */
export type Panel =
  | 'budget'
  | 'debts'
  | 'investing'
  | 'balance-sheet'
  | 'allocation'
  | 'annual-review'
  | 'epilogue'
  | null;

export interface PendingEvent {
  readonly event: EventDef;
  readonly choiceIds: readonly string[];
}

interface GameStore {
  run: Run | null;
  tab: Tab;
  panel: Panel;
  granularity: Granularity;
  allocation: Allocation;
  interrupts: readonly Interrupt[];
  pendingEvent: PendingEvent | null;

  start: (seed: string) => void;
  setTab: (tab: Tab) => void;
  openPanel: (panel: Panel) => void;
  setGranularity: (granularity: Granularity) => void;
  setAllocation: (allocation: Allocation) => void;
  advanceTime: () => void;
  resolveEvent: (choiceId: string) => void;
  dismissInterrupts: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  run: null,
  tab: 'dashboard',
  panel: null,
  granularity: 'until-something-happens',
  allocation: DEFAULT_ALLOCATION,
  interrupts: [],
  pendingEvent: null,

  start: (seed) => {
    const run = createScenarioRun({ seed, runLengthYears: 30 });
    set({ run, interrupts: [], pendingEvent: null, tab: 'dashboard', panel: null });
  },

  setTab: (tab) => set({ tab, panel: null }),
  openPanel: (panel) => set({ panel }),
  setGranularity: (granularity) => set({ granularity }),
  setAllocation: (allocation) => set({ allocation }),
  dismissInterrupts: () => set({ interrupts: [] }),

  advanceTime: () => {
    const { run, granularity, allocation } = get();
    if (run === null) return;

    let captured: PendingEvent | null = null;
    const result = advance(run, granularity, () => ({
      allocation,
      // Capture the event instead of choosing for the player; the modal asks.
      chooseEvent: (eventId, choiceIds) => {
        const event = run.world.eventDefs.find((definition) => definition.id === eventId);
        if (event !== undefined) captured = { event, choiceIds };
        return choiceIds[0];
      },
    }));

    set({ run: result.run, interrupts: result.interrupts, pendingEvent: captured });
  },

  resolveEvent: (choiceId) => {
    const { run, allocation } = get();
    if (run === null) return;
    // Re-run the event's week with the player's actual choice.
    const input: TickInput = { allocation, chooseEvent: () => choiceId };
    const result = tick(run.world, run.streams, run.state, input);
    set({ run: { ...run, state: result.state }, pendingEvent: null });
  },
}));

/** Derived helpers. Read-only views of engine state — never new logic. */
export function selectYearsElapsed(state: RunState): number {
  return yearIndex(state.weekIndex);
}

export function suggestedGranularity(state: RunState): Granularity {
  return defaultGranularity(yearIndex(state.weekIndex));
}
