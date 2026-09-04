/**
 * The Logbook engine — TDD §11.
 *
 * The Logbook narrates what happened. It never editorializes, never approves,
 * and never says whether a decision was smart (GDD §1). It can be wry.
 */
import { interpolate } from '../events/effects.ts';
import { type Rng, intIn } from '../rng.ts';
import { type PendingEntry, QUIET_GAP_MAX, QUIET_GAP_MIN, type Trigger, selectPending } from './triggers.ts';
import { type VariantMemory, emptyVariantMemory, selectVariant } from './variants.ts';

/** Template pools, keyed by logbook key. Three variants per key at minimum. */
export type TemplatePools = Readonly<Record<string, readonly string[]>>;

/**
 * Names drawn once at run init from `startingDraw` and stable for the run — the
 * friend who invites you to things in year 2 is the same friend whose wedding
 * you attend in year 6. Cheap continuity, disproportionate narrative payoff.
 */
export interface RunNames {
  readonly friendName: string;
  readonly advisorName: string;
}

export interface LogbookEntry {
  readonly weekIndex: number;
  readonly key: string;
  readonly variantIndex: number;
  readonly text: string;
  readonly trigger: Trigger;
}

export interface LogbookState {
  readonly memory: VariantMemory;
  /** Weeks since the last entry of any kind. */
  readonly weeksSinceEntry: number;
  /** Weeks of silence before a quiet entry is due. Redrawn each time one fires. */
  readonly quietGap: number;
}

/**
 * Open a Logbook. Draws the first quiet gap, which is the only `flavor` draw
 * that happens outside an emission.
 */
export function openLogbook(rng: Rng): LogbookState {
  return {
    memory: emptyVariantMemory(),
    weeksSinceEntry: 0,
    quietGap: intIn(rng, QUIET_GAP_MIN, QUIET_GAP_MAX),
  };
}

/** Whether a quiet entry is due this week (§11.1). */
export function quietEntryDue(state: LogbookState): boolean {
  return state.weeksSinceEntry >= state.quietGap;
}

export interface EmitResult {
  readonly entries: readonly LogbookEntry[];
  readonly state: LogbookState;
}

/**
 * Emit this week's entries.
 *
 * Runs at step 13 of the tick. Triggers are capped and prioritized first, then a
 * variant is drawn per surviving entry. If nothing fired and the silence has run
 * long enough, a quiet entry fills the gap.
 *
 * Every draw comes from `rng`, which must be the `flavor` stream.
 */
export function emitEntries(
  pending: readonly PendingEntry[],
  weekIndex: number,
  templates: TemplatePools,
  vars: Readonly<Record<string, string>>,
  rng: Rng,
  state: LogbookState,
): EmitResult {
  let chosen = selectPending(pending);

  if (chosen.length === 0) {
    if (!quietEntryDue(state)) {
      return { entries: [], state: { ...state, weeksSinceEntry: state.weeksSinceEntry + 1 } };
    }
    chosen = [{ trigger: { k: 'quiet' }, key: 'quiet' }];
  }

  let memory = state.memory;
  const entries: LogbookEntry[] = [];

  for (const item of chosen) {
    const pool = templates[item.key];
    // A missing pool emits nothing rather than throwing: content arrives in
    // batches, and a key without prose yet should not end a 30-year run.
    if (pool === undefined || pool.length === 0) continue;

    const picked = selectVariant(item.key, pool.length, rng, memory);
    memory = picked.memory;
    entries.push({
      weekIndex,
      key: item.key,
      variantIndex: picked.index,
      text: interpolate(pool[picked.index], vars),
      trigger: item.trigger,
    });
  }

  if (entries.length === 0) {
    return { entries: [], state: { ...state, memory, weeksSinceEntry: state.weeksSinceEntry + 1 } };
  }

  return {
    entries,
    state: { memory, weeksSinceEntry: 0, quietGap: intIn(rng, QUIET_GAP_MIN, QUIET_GAP_MAX) },
  };
}

/** Every template variable available to any entry (§11.3). */
export const TEMPLATE_VARIABLES = [
  'amount',
  'jobTitle',
  'age',
  'netWorth',
  'cash',
  'assetName',
  'pct',
  'monthName',
  'yearsIn',
  'friendName',
  'advisorName',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
