/**
 * Persistence — TDD §14.
 *
 * **A save is the seed plus the decision log, not a state dump.** That makes
 * saves small, makes bug reports perfectly reproducible, and makes "share your
 * run" a matter of sharing a JSON blob.
 *
 * A checkpoint every 100 weeks bounds replay cost; loading replays from the
 * nearest one. Everything goes through the `StorageAdapter` — no file outside an
 * adapter implementation may touch `indexedDB`, `localStorage` or `window`, and
 * a test asserts it.
 */
import type { Allocation } from './vitals.ts';
import type { RunState, StandingOrders } from './state.ts';
import type { StorageAdapter } from './storage.ts';
import { RULESET_VERSION } from './version.ts';

/** [T] Checkpoint cadence, in weeks. Bounds how far a load has to replay. */
export const CHECKPOINT_INTERVAL_WEEKS = 100;

/** [T] Autosave every 4 weeks of simulated time, and on every event resolution. */
export const AUTOSAVE_INTERVAL_WEEKS = 4;

/** [T] Mobile Safari evicts storage at about 7 days; warn before that. */
export const INACTIVITY_WARNING_DAYS = 5;

export const SAVE_KEY_PREFIX = 'finme:run:';

/**
 * One decision, as recorded for replay. Deliberately terse — a 30-year run can
 * hold hundreds of these and they travel in a shared JSON blob.
 */
export type DecisionRecord =
  | { readonly w: number; readonly t: 'alloc'; readonly v: readonly number[] }
  | { readonly w: number; readonly t: 'event'; readonly e: string; readonly c: string }
  | { readonly w: number; readonly t: 'orders'; readonly v: StandingOrders }
  | { readonly w: number; readonly t: 'bankruptcy'; readonly c: string };

/** The allocation encoding used by `alloc` records: work mode plus six counts. */
export const ALLOC_WORK_MODES = ['none', 'part-time', 'full-time'] as const;

export function encodeAllocation(allocation: Allocation): number[] {
  return [
    ALLOC_WORK_MODES.indexOf(allocation.work),
    allocation.overtime,
    allocation.rest,
    allocation.paidSocial,
    allocation.freeSocial,
    allocation.study,
    allocation.sideHustle,
  ];
}

export function decodeAllocation(values: readonly number[]): Allocation {
  return {
    work: ALLOC_WORK_MODES[values[0]] ?? 'none',
    overtime: values[1] ?? 0,
    rest: values[2] ?? 0,
    paidSocial: values[3] ?? 0,
    freeSocial: values[4] ?? 0,
    study: values[5] ?? 0,
    sideHustle: values[6] ?? 0,
  };
}

export interface Checkpoint {
  readonly weekIndex: number;
  readonly state: RunState;
}

export interface RunSave {
  readonly seed: string;
  readonly rulesetVersion: string;
  readonly weekIndex: number;
  readonly decisionLog: readonly DecisionRecord[];
  readonly standingOrders: StandingOrders;
  readonly checkpoint: Checkpoint | null;
  /** Epoch millis of the last write, for the inactivity warning. */
  readonly savedAt: number;
}

export function saveKey(seed: string): string {
  return `${SAVE_KEY_PREFIX}${seed}`;
}

/** Whether this week should take a checkpoint. */
export function isCheckpointWeek(weekIndex: number): boolean {
  return weekIndex > 0 && weekIndex % CHECKPOINT_INTERVAL_WEEKS === 0;
}

export function shouldAutosave(weekIndex: number): boolean {
  return weekIndex > 0 && weekIndex % AUTOSAVE_INTERVAL_WEEKS === 0;
}

/** Build a save from a run's current position. */
export function buildSave(options: {
  state: RunState;
  decisionLog: readonly DecisionRecord[];
  checkpoint: Checkpoint | null;
  now: number;
}): RunSave {
  return {
    seed: options.state.seed,
    rulesetVersion: options.state.rulesetVersion,
    weekIndex: options.state.weekIndex,
    decisionLog: options.decisionLog,
    standingOrders: options.state.standingOrders,
    checkpoint: options.checkpoint,
    savedAt: options.now,
  };
}

export async function writeSave(adapter: StorageAdapter, save: RunSave): Promise<void> {
  await adapter.set(saveKey(save.seed), JSON.stringify(save));
}

export async function readSave(adapter: StorageAdapter, seed: string): Promise<RunSave | null> {
  const raw = await adapter.get(saveKey(seed));
  return raw === null ? null : parseSave(raw);
}

export async function listSaves(adapter: StorageAdapter): Promise<string[]> {
  const keys = await adapter.keys();
  return keys
    .filter((key) => key.startsWith(SAVE_KEY_PREFIX))
    .map((key) => key.slice(SAVE_KEY_PREFIX.length))
    .sort();
}

export async function deleteSave(adapter: StorageAdapter, seed: string): Promise<void> {
  await adapter.remove(saveKey(seed));
}

/**
 * Parse a save. Returns `null` on anything malformed rather than throwing — an
 * imported file is untrusted input, and a bad paste must not end the session.
 */
export function parseSave(raw: string): RunSave | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<RunSave>;
  if (typeof candidate.seed !== 'string' || candidate.seed.length === 0) return null;
  if (typeof candidate.rulesetVersion !== 'string') return null;
  if (typeof candidate.weekIndex !== 'number' || !Number.isInteger(candidate.weekIndex)) return null;
  if (!Array.isArray(candidate.decisionLog)) return null;

  return {
    seed: candidate.seed,
    rulesetVersion: candidate.rulesetVersion,
    weekIndex: candidate.weekIndex,
    decisionLog: candidate.decisionLog as DecisionRecord[],
    standingOrders: candidate.standingOrders as StandingOrders,
    checkpoint: candidate.checkpoint ?? null,
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : 0,
  };
}

/** Export a run as a JSON blob, per GDD §8. */
export function exportSave(save: RunSave): string {
  return JSON.stringify(save, null, 2);
}

export type LoadMode = 'replay' | 'checkpoint-only';

export interface LoadPlan {
  readonly save: RunSave;
  readonly mode: LoadMode;
  /** True when the save's ruleset differs from this build's. */
  readonly rulesetMismatch: boolean;
  /** Non-blocking banner copy, or null when the versions match. */
  readonly banner: string | null;
  /** True when outcomes cannot be compared to other runs of this seed. */
  readonly nonComparable: boolean;
  /** The week replay starts from. */
  readonly replayFromWeek: number;
}

/**
 * Decide how to load a save (§14.1).
 *
 * **Replay-based loading means the ruleset version must match exactly or the
 * replay diverges.** On a mismatch the run loads from `checkpoint.state`
 * directly and is marked non-comparable, rather than silently replaying into a
 * different world.
 */
export function planLoad(save: RunSave, currentVersion: string = RULESET_VERSION): LoadPlan {
  const rulesetMismatch = save.rulesetVersion !== currentVersion;

  if (!rulesetMismatch) {
    return {
      save,
      mode: 'replay',
      rulesetMismatch: false,
      banner: null,
      nonComparable: false,
      replayFromWeek: save.checkpoint?.weekIndex ?? 0,
    };
  }

  return {
    save,
    mode: 'checkpoint-only',
    rulesetMismatch: true,
    // Non-blocking, and states the fact without apology or alarm.
    banner: `This run was created under ruleset v${save.rulesetVersion}. Outcomes may differ.`,
    nonComparable: true,
    replayFromWeek: save.checkpoint?.weekIndex ?? 0,
  };
}

/** Decisions at or after a given week, for replaying from a checkpoint. */
export function decisionsFrom(
  log: readonly DecisionRecord[],
  fromWeek: number,
): DecisionRecord[] {
  return log.filter((record) => record.w > fromWeek);
}

/** Whether the player should be warned that storage may be evicted. */
export function shouldWarnInactive(save: RunSave, now: number): boolean {
  if (save.savedAt <= 0) return false;
  const days = (now - save.savedAt) / (1000 * 60 * 60 * 24);
  return days >= INACTIVITY_WARNING_DAYS;
}
