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
import type { ActiveChain, Allocation, EventDef } from '@finme/engine';
import { abandonChain, beginChain, chainById, stepById } from '@finme/engine';
import { create } from 'zustand';
import { chainDisplayVars, eventDisplayVars } from '@/lib/eventVars';

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
  | 'jobs'
  | 'housing'
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

/**
 * A chain step waiting on the player. The same shape as `PendingEvent` plus
 * which chain it belongs to, because a week presents at most one card and the
 * modal renders either one identically.
 */
export interface PendingChainStep {
  readonly chainId: string;
  readonly stepId: string;
  readonly event: EventDef;
  readonly choiceIds: readonly string[];
  readonly roll: number;
  readonly vars: Readonly<Record<string, string>>;
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
  pendingChainStep: PendingChainStep | null;
  /** §14's non-blocking ruleset-mismatch banner, or null when versions match. */
  rulesetBanner: string | null;

  start: (seed: string) => void;
  setTab: (tab: Tab) => void;
  openPanel: (panel: Panel) => void;
  setGranularity: (granularity: Granularity) => void;
  setAllocation: (allocation: Allocation) => void;
  advanceTime: () => void;
  resolveEvent: (choiceId: string) => void;
  startChain: (chainId: string, target?: string) => void;
  abandonChain: (chainId: string) => void;
  resolveChainStep: (choiceId: string) => void;
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
  pendingChainStep: null,
  rulesetBanner: null,

  start: (seed) => {
    const run = createScenarioRun({ seed, runLengthYears: 30 });
    set({
      run,
      interrupts: [],
      pendingEvent: null,
      pendingChainStep: null,
      tab: 'dashboard',
      panel: null,
    });
  },

  setTab: (tab) => set({ tab, panel: null }),
  openPanel: (panel) => set({ panel }),
  setGranularity: (granularity) => set({ granularity }),
  setAllocation: (allocation) => set({ allocation }),
  dismissInterrupts: () => set({ interrupts: [] }),

  advanceTime: () => {
    const { run, granularity, allocation, pendingEvent, pendingChainStep } = get();
    if (run === null) return;
    // A second advance would take another magnitude draw for an unresolved
    // card. The control is disabled while one is up; this guards every other
    // way in.
    if (pendingEvent !== null || pendingChainStep !== null) return;

    let capturedEvent: EventDef | null = null;
    let capturedChoiceIds: readonly string[] = [];
    let capturedChainChoiceIds: readonly string[] = [];
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
        chooseChainStep: (_chainId, _stepId, choiceIds) => {
          capturedChainChoiceIds = choiceIds;
          return null;
        },
      };
    });

    const event: EventDef | null = capturedEvent;
    const roll = result.eventRoll;
    const nextEvent: PendingEvent | null =
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

    set({
      run: result.run,
      interrupts: result.interrupts,
      pendingEvent: nextEvent,
      pendingChainStep: buildPendingChainStep(
        result.run,
        stateAtWeekStart,
        result.awaitingChainStep,
        result.chainRoll,
        capturedChainChoiceIds,
      ),
    });
  },

  startChain: (chainId, target) => {
    const { run, pendingEvent, pendingChainStep } = get();
    if (run === null || pendingEvent !== null || pendingChainStep !== null) return;
    // An engine *action*, not a tick. Starting a search happens inside the week
    // the player is already in: it must not advance time, and it must not touch
    // whatever card that week is holding. Routing this through `tick` did both —
    // with no chooser supplied the tick fell back to the first available choice,
    // so tapping Apply on a slot week resolved that week's event unseen.
    //
    // The engine still decides whether the search may begin; gates, cooldown and
    // "already looking" all live there, not here.
    const result = beginChain(run.world, run.streams, run.state, chainId, target ?? null);
    set({ run: { ...run, state: result.state }, interrupts: result.interrupts });
  },

  abandonChain: (chainId) => {
    const { run, pendingEvent, pendingChainStep } = get();
    if (run === null || pendingEvent !== null || pendingChainStep !== null) return;
    // A floor crossed by the action is reported here; the next tick's
    // edge-trigger would see it as already below and say nothing.
    const result = abandonChain(run.world, run.streams, run.state, chainId);
    set({ run: { ...run, state: result.state }, interrupts: result.interrupts });
  },

  resolveChainStep: (choiceId) => {
    const { run, allocation } = get();
    if (run === null) return;
    // The week `advanceTime` left uncommitted, with the real choice and the
    // roll the card quoted.
    const pending = get().pendingChainStep;
    const result = tick(run.world, run.streams, run.state, {
      allocation,
      chooseChainStep: () => choiceId,
      chainRoll: pending?.roll,
    });
    set({
      run: { ...run, state: result.state },
      interrupts: result.interrupts,
      pendingChainStep: null,
    });
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

/**
 * Build the card for a declined chain step, or `null` when none is waiting.
 *
 * `state` is the week before the step's own, exactly as for an event — the
 * engine owns that offset in `pendingChainContext`.
 */
function buildPendingChainStep(
  run: Run,
  state: RunState,
  awaiting: { readonly chainId: string; readonly stepId: string } | null,
  roll: number | null,
  choiceIds: readonly string[],
): PendingChainStep | null {
  if (awaiting === null || roll === null) return null;

  const chain = chainById(run.world.chainDefs, awaiting.chainId);
  const step = chain === undefined ? undefined : stepById(chain, awaiting.stepId);
  if (chain === undefined || step === undefined) return null;

  const active = state.chains.find((entry) => entry.chainId === awaiting.chainId);
  if (active === undefined) return null;

  return {
    chainId: chain.id,
    stepId: step.id,
    event: step.card,
    choiceIds,
    roll,
    vars: chainDisplayVars(step.card, state, run.world, active, roll),
    ...cardVariant(step.card, pendingEventWeek(state)),
  };
}

/** The chain in flight for a given id, or `null`. */
export function activeChain(state: RunState, chainId: string): ActiveChain | null {
  return state.chains.find((entry) => entry.chainId === chainId) ?? null;
}

/** Derived helpers. Read-only views of engine state — never new logic. */
export function selectYearsElapsed(state: RunState): number {
  return yearIndex(state.weekIndex);
}

export function suggestedGranularity(state: RunState): Granularity {
  return defaultGranularity(yearIndex(state.weekIndex));
}
