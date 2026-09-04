/**
 * Logbook triggers — TDD §11.1.
 *
 * Entries are emitted only when a trigger fires. **Most weeks emit nothing**
 * (GDD §12) — the Logbook narrates what happened, it does not narrate every rent
 * payment, and it never says whether any of it was smart.
 */

export type Trigger =
  | { readonly k: 'event'; readonly eventId: string; readonly choiceId: string; readonly branch?: string }
  | { readonly k: 'firstTime'; readonly action: string }
  | {
      readonly k: 'threshold';
      readonly metric: string;
      readonly crossed: number;
      readonly direction: 'up' | 'down';
    }
  | { readonly k: 'delta'; readonly metric: string; readonly pctChange: number }
  | { readonly k: 'streakBreak'; readonly streak: string }
  | { readonly k: 'lifeStage'; readonly stage: string }
  | { readonly k: 'quiet' };

export type TriggerKind = Trigger['k'];

/** [F] Highest priority first. Used to pick which triggers survive the cap. */
export const TRIGGER_PRIORITY: readonly TriggerKind[] = [
  'event',
  'threshold',
  'streakBreak',
  'firstTime',
  'delta',
  'quiet',
];

/** [T] At most two entries a week, however many triggers fired. */
export const MAX_ENTRIES_PER_WEEK = 2;

/** [T] A delta trigger needs a move of more than 10%. */
export const DELTA_THRESHOLD_PCT = 0.1;

/** [T] Quiet entries fill a gap of 6-10 weeks with no entry at all. */
export const QUIET_GAP_MIN = 6;
export const QUIET_GAP_MAX = 10;

export function triggerRank(kind: TriggerKind): number {
  const rank = TRIGGER_PRIORITY.indexOf(kind);
  // `lifeStage` is not in §11.1's priority list; rank it just above quiet.
  return rank === -1 ? TRIGGER_PRIORITY.length - 1 : rank;
}

/** Whether a metric move is large enough to be worth narrating. */
export function isSignificantDelta(pctChange: number): boolean {
  return Math.abs(pctChange) > DELTA_THRESHOLD_PCT;
}

/**
 * The template key a trigger reads from.
 *
 * Event triggers carry their key on the choice, so the tick supplies it
 * directly; everything else derives one here. §11 does not specify the
 * derivation — see docs/DECISIONS.md.
 */
export function logbookKeyFor(trigger: Trigger): string {
  switch (trigger.k) {
    case 'event':
      return `${trigger.eventId}.${trigger.choiceId}${trigger.branch === undefined ? '' : `.${trigger.branch}`}`;
    case 'firstTime':
      return `first_${trigger.action}`;
    case 'threshold':
      return `threshold_${trigger.metric}_${trigger.direction}`;
    case 'delta':
      return `delta_${trigger.metric}_${trigger.pctChange >= 0 ? 'up' : 'down'}`;
    case 'streakBreak':
      return `streak_${trigger.streak}`;
    case 'lifeStage':
      return `stage_${trigger.stage}`;
    case 'quiet':
      return 'quiet';
  }
}

export interface PendingEntry {
  readonly trigger: Trigger;
  /** Which template pool to draw from. */
  readonly key: string;
}

/**
 * Apply the priority order and the two-per-week cap.
 *
 * The sort is stable within a priority band, so triggers that fired in the same
 * week keep the order the tick produced them in.
 */
export function selectPending(pending: readonly PendingEntry[]): PendingEntry[] {
  return [...pending]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const rank = triggerRank(a.entry.trigger.k) - triggerRank(b.entry.trigger.k);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .slice(0, MAX_ENTRIES_PER_WEEK)
    .map(({ entry }) => entry);
}
