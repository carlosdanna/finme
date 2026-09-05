import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_INTERVAL_WEEKS,
  CHECKPOINT_INTERVAL_WEEKS,
  INACTIVITY_WARNING_DAYS,
  type RunSave,
  buildSave,
  decisionsFrom,
  decodeAllocation,
  deleteSave,
  encodeAllocation,
  exportSave,
  isCheckpointWeek,
  listSaves,
  parseSave,
  planLoad,
  readSave,
  saveKey,
  shouldAutosave,
  shouldWarnInactive,
  writeSave,
} from '../src/persistence.ts';
import { MemoryStorageAdapter } from '../src/storage.ts';
import { RULESET_VERSION } from '../src/version.ts';
import { emptyAllocation } from '../src/vitals.ts';
import { defaultStandingOrders } from '../src/state.ts';

const save = (partial: Partial<RunSave> = {}): RunSave => ({
  seed: '4F2A9C1B',
  rulesetVersion: RULESET_VERSION,
  weekIndex: 412,
  decisionLog: [
    { w: 3, t: 'alloc', v: [2, 0, 3, 0, 2, 0, 0] },
    { w: 7, t: 'event', e: 'EMG_CAR_BREAKDOWN', c: 'repair' },
  ],
  standingOrders: defaultStandingOrders(),
  checkpoint: null,
  savedAt: 1_700_000_000_000,
  ...partial,
});

describe('the save format (TDD §14.1)', () => {
  it('is the seed plus the decision log, not a state dump', () => {
    const written = save();
    // Small enough to paste into a bug report or a message.
    expect(JSON.stringify(written).length).toBeLessThan(2_000);
    expect(written.decisionLog).toHaveLength(2);
  });

  it('round-trips through a StorageAdapter', async () => {
    const adapter = new MemoryStorageAdapter();
    await writeSave(adapter, save());

    const read = await readSave(adapter, '4F2A9C1B');
    expect(read).toEqual(save());
    expect(await listSaves(adapter)).toEqual(['4F2A9C1B']);

    await deleteSave(adapter, '4F2A9C1B');
    expect(await readSave(adapter, '4F2A9C1B')).toBeNull();
    expect(await listSaves(adapter)).toEqual([]);
  });

  it('ignores keys that are not ours', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.set('something:else', 'not a save');
    await writeSave(adapter, save());
    expect(await listSaves(adapter)).toEqual(['4F2A9C1B']);
  });

  it('namespaces its keys', () => {
    expect(saveKey('ABC')).toBe('finme:run:ABC');
  });

  it('checkpoints every 100 weeks and autosaves every 4', () => {
    expect(CHECKPOINT_INTERVAL_WEEKS).toBe(100);
    expect(isCheckpointWeek(0)).toBe(false);
    expect(isCheckpointWeek(100)).toBe(true);
    expect(isCheckpointWeek(101)).toBe(false);
    expect(isCheckpointWeek(400)).toBe(true);

    expect(AUTOSAVE_INTERVAL_WEEKS).toBe(4);
    expect(shouldAutosave(4)).toBe(true);
    expect(shouldAutosave(5)).toBe(false);
  });

  it('encodes an allocation compactly and round-trips it', () => {
    const allocation = { ...emptyAllocation(), work: 'full-time' as const, rest: 3, freeSocial: 2 };
    const encoded = encodeAllocation(allocation);
    expect(encoded).toHaveLength(7);
    expect(decodeAllocation(encoded)).toEqual(allocation);
    // A truncated record decodes to something valid rather than throwing.
    expect(decodeAllocation([])).toEqual(emptyAllocation());
  });
});

describe('export and import (TDD §14.2)', () => {
  it('exports readable JSON and parses it back', () => {
    const exported = exportSave(save());
    expect(exported).toContain('4F2A9C1B');
    expect(parseSave(exported)).toEqual(save());
  });

  it('returns null on anything malformed rather than throwing', () => {
    // An imported file is untrusted input; a bad paste must not end the session.
    for (const bad of ['', 'not json', '{}', '[]', 'null', '{"seed":""}', '{"seed":"A"}']) {
      expect(parseSave(bad)).toBeNull();
    }
    expect(parseSave(JSON.stringify({ ...save(), weekIndex: 1.5 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save(), decisionLog: 'nope' }))).toBeNull();
  });
});

describe('the ruleset mismatch banner (TDD §14.1)', () => {
  it('replays when the ruleset matches', () => {
    const plan = planLoad(save());
    expect(plan.mode).toBe('replay');
    expect(plan.rulesetMismatch).toBe(false);
    expect(plan.banner).toBeNull();
    expect(plan.nonComparable).toBe(false);
  });

  it('loads from the checkpoint and marks the run non-comparable on a mismatch', () => {
    // Replay-based loading means the ruleset must match exactly or the replay
    // diverges. Loading the checkpoint directly is the safe fallback.
    const plan = planLoad(save({ rulesetVersion: '0.1.0', checkpoint: { weekIndex: 400, state: {} as never } }));

    expect(plan.mode).toBe('checkpoint-only');
    expect(plan.rulesetMismatch).toBe(true);
    expect(plan.nonComparable).toBe(true);
    expect(plan.replayFromWeek).toBe(400);
  });

  it('states the mismatch without alarm or apology', () => {
    const plan = planLoad(save({ rulesetVersion: '0.1.0' }));
    expect(plan.banner).toBe('This run was created under ruleset v0.1.0. Outcomes may differ.');
    // Non-blocking: it reports a fact and does not tell the player what to do.
    expect(plan.banner).not.toMatch(/error|warning|sorry|unfortunately|should/i);
  });

  it('replays only the decisions after the checkpoint', () => {
    const log = save().decisionLog;
    expect(decisionsFrom(log, 0)).toHaveLength(2);
    expect(decisionsFrom(log, 3)).toHaveLength(1);
    expect(decisionsFrom(log, 7)).toHaveLength(0);
  });
});

describe('the inactivity warning (TDD §14.2)', () => {
  it('warns after five days, since mobile Safari evicts at about seven', () => {
    expect(INACTIVITY_WARNING_DAYS).toBe(5);
    const day = 1000 * 60 * 60 * 24;
    const savedAt = 1_700_000_000_000;

    expect(shouldWarnInactive(save({ savedAt }), savedAt + day * 4)).toBe(false);
    expect(shouldWarnInactive(save({ savedAt }), savedAt + day * 5)).toBe(true);
    // A save with no timestamp does not warn spuriously.
    expect(shouldWarnInactive(save({ savedAt: 0 }), savedAt + day * 30)).toBe(false);
  });
});

describe('buildSave', () => {
  it('takes the seed, version and week from the state itself', () => {
    const state = {
      seed: 'ZZZ',
      rulesetVersion: RULESET_VERSION,
      weekIndex: 55,
      standingOrders: defaultStandingOrders(),
    } as never;

    const built = buildSave({ state, decisionLog: [], checkpoint: null, now: 42 });
    expect(built.seed).toBe('ZZZ');
    expect(built.weekIndex).toBe(55);
    expect(built.savedAt).toBe(42);
  });
});
