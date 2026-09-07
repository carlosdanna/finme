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
  cardVariant,
  pendingEventWeek,
  defaultGranularity,
  parseSave,
  planLoad,
  tick,
  yearIndex,
} from '@finme/engine';
import { createScenarioRun, DEFAULT_ALLOCATION } from '@finme/content';
import type { Allocation, EventDef } from '@finme/engine';
import { create } from 'zustand';
import { eventDisplayVars } from '@/lib/eventVars';

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
  /** Drawn when the card was presented, fed back into the resolving tick. */
  readonly roll: number;
  /** `{{placeholder}}` values for the card, already formatted. */
  readonly vars: Readonly<Record<string, string>>;
  /** The card variant for this firing — still holding its `{{placeholders}}`. */
  readonly title: string;
  readonly body: string;
}

interface GameStore {
  run: Run | null;
  tab: Tab;
  panel: Panel;
  granularity: Granularity;
  allocation: Allocation;
  interrupts: readonly Interrupt[];
  pendingEvent: PendingEvent | null;
  /** §14's non-blocking ruleset-mismatch banner, or null when versions match. */
  rulesetBanner: string | null;

  start: (seed: string) => void;
  setTab: (tab: Tab) => void;
  openPanel: (panel: Panel) => void;
  setGranularity: (granularity: Granularity) => void;
  setAllocation: (allocation: Allocation) => void;
  advanceTime: () => void;
  resolveEvent: (choiceId: string) => void;
  loadSave: (raw: string) => void;
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
  rulesetBanner: null,

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
    const { run, granularity, allocation, pendingEvent: awaiting } = get();
    if (run === null) return;
    // A second advance would take another `eventMagnitude` draw for an
    // unresolved event. The control is disabled while a card is up; this guards
    // every other way in.
    if (awaiting !== null) return;

    let capturedEvent: EventDef | null = null;
    let capturedChoiceIds: readonly string[] = [];
    let stateAtWeekStart: RunState = run.state;

    const result = advance(run, granularity, (state) => {
      stateAtWeekStart = state;
      return {
        allocation,
        // Decline, so the week comes back untouched for the modal to ask
        // about. A default here would commit a week the player never chose.
        chooseEvent: (eventId, choiceIds) => {
          const event = run.world.eventDefs.find((definition) => definition.id === eventId);
          if (event !== undefined) {
            capturedEvent = event;
            capturedChoiceIds = choiceIds;
          }
          return null;
        },
      };
    });

    const event: EventDef | null = capturedEvent;
    const roll = result.eventRoll;
    const pendingEvent: PendingEvent | null =
      event === null || roll === null
        ? null
        : {
            event,
            choiceIds: capturedChoiceIds,
            roll,
            vars: eventDisplayVars(event, stateAtWeekStart, run.world, roll),
            // Keyed on the firing week, so a repeat reads differently.
            ...cardVariant(event, pendingEventWeek(stateAtWeekStart)),
          };

    set({ run: result.run, interrupts: result.interrupts, pendingEvent });
  },

  loadSave: (raw: string) => {
    const save = parseSave(raw);
    if (save === null) return;
    const plan = planLoad(save);
    // The engine decides whether a mismatch means replay or checkpoint-only;
    // the store only carries the banner it produced.
    set({ rulesetBanner: plan.banner });
  },

  resolveEvent: (choiceId) => {
    const { run, allocation } = get();
    if (run === null) return;
    // The week `advanceTime` left uncommitted, with the real choice and the
    // roll the card quoted. Its first and only run, so its interrupts stand.
    const pending = get().pendingEvent;
    const input: TickInput = {
      allocation,
      chooseEvent: () => choiceId,
      eventRoll: pending?.roll,
    };
    const result = tick(run.world, run.streams, run.state, input);
    set({
      run: { ...run, state: result.state },
      interrupts: result.interrupts,
      pendingEvent: null,
    });
  },
}));

/** Derived helpers. Read-only views of engine state — never new logic. */
export function selectYearsElapsed(state: RunState): number {
  return yearIndex(state.weekIndex);
}

export function suggestedGranularity(state: RunState): Granularity {
  return defaultGranularity(yearIndex(state.weekIndex));
}
