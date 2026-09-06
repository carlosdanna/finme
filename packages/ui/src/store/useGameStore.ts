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
  /**
   * The event's magnitude roll, drawn when the card was presented and fed back
   * into the resolving tick so the player is charged the number they read.
   */
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
    const { run, granularity, allocation } = get();
    if (run === null) return;

    let capturedEvent: EventDef | null = null;
    let capturedChoiceIds: readonly string[] = [];
    let stateAtWeekStart: RunState = run.state;

    const result = advance(run, granularity, (state) => {
      stateAtWeekStart = state;
      return {
        allocation,
        // Decline to choose. The engine abandons the week untouched and hands
        // it back; the modal asks, and `resolveEvent` ticks that same week once
        // with the real answer. Returning a default here instead would commit a
        // week the player never agreed to and then tick a second one on top.
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
            // Evaluated against the *event's own* week — the one about to be
            // ticked — and the roll it will be charged with.
            vars: eventDisplayVars(event, stateAtWeekStart, run.world, roll),
            // The week the event fires in, so the same event reads differently
            // on its second and third visit.
            ...cardVariant(event, stateAtWeekStart.weekIndex + 1),
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
    // Tick the event's own week — the one `advanceTime` left uncommitted — with
    // the player's actual choice. This is the first and only time that week
    // runs, so its interrupts are the ones to surface. The roll comes back from
    // the presenting tick, so the choice is charged what the card quoted.
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
