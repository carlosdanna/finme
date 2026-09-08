import { describe, expect, it } from 'vitest';
import {
  type ActiveChain,
  CHAIN_END,
  CHAIN_MAX_STEPS,
  type ChainDef,
  advanceChain,
  chainById,
  dueChain,
  recordChainEnd,
  slipChain,
  startBlockedReason,
  startChain,
  stepById,
  withChain,
} from '../src/chains/index.ts';
import type { EventDef, EventState } from '../src/events/index.ts';

const card = (id: string): EventDef => ({
  id,
  category: 'career',
  baseWeight: 100,
  cooldownWeeks: 0,
  gates: [],
  multipliers: [],
  title: 'A step',
  body: 'Something is happening.',
  choices: [{ id: 'go', label: 'Go on', effects: [], noop: true, logbookKey: 'quiet' }],
});

const chain = (partial: Partial<ChainDef> = {}): ChainDef => ({
  id: 'TEST_SEARCH',
  stream: 'chain',
  startGates: [],
  startEffects: [],
  firstStepId: 'first',
  steps: [
    { id: 'first', gapWeeks: 1, card: card('TST_FIRST') },
    { id: 'second', gapWeeks: 2, card: card('TST_SECOND') },
    { id: 'loop', gapWeeks: 1, card: card('TST_LOOP') },
  ],
  cooldownWeeks: 26,
  abandonEffects: [],
  logbookKeyStart: 'search_started',
  logbookKeyAbandon: 'search_abandoned',
  ...partial,
});

const state = (partial: Partial<EventState> = {}): EventState => ({
  weekIndex: 100,
  age: 25,
  employed: true,
  ownsCar: false,
  ownsHome: false,
  lifeStage: 'early-career',
  flags: new Set<string>(),
  debtTypes: new Set<string>(),
  heldAssets: new Set<string>(),
  stats: { cashCents: 500_000, mood: 60 },
  ...partial,
});

const active = (partial: Partial<ActiveChain> = {}): ActiveChain => ({
  chainId: 'TEST_SEARCH',
  stepId: 'first',
  dueWeek: 101,
  startedWeek: 100,
  stepsTaken: 0,
  target: null,
  ...partial,
});

describe('starting a chain (TDD §9.6)', () => {
  it('lands the first step a gap away, not the same week', () => {
    // Deciding to look for something is not the same week as the first thing
    // happening. The gap is where the "takes time" lives.
    const opened = startChain(chain(), 100, 'office-admin')!;

    expect(opened.stepId).toBe('first');
    expect(opened.dueWeek).toBe(101);
    expect(opened.startedWeek).toBe(100);
    expect(opened.stepsTaken).toBe(0);
    expect(opened.target).toBe('office-admin');
  });

  it('stores dueWeek as an absolute week, never a countdown', () => {
    // TDD §0: weekIndex is the only representation of time.
    expect(startChain(chain(), 500, null)!.dueWeek).toBe(501);
  });

  it('refuses a chain that is unknown, running, gated out, or cooling down', () => {
    const chains = [chain()];
    const now = state({ weekIndex: 100 });

    expect(startBlockedReason(chains, [], {}, 'NOPE', now)).toBe('unknown');
    expect(startBlockedReason(chains, [active()], {}, 'TEST_SEARCH', now)).toBe('already-active');
    expect(
      startBlockedReason(
        [chain({ startGates: [{ type: 'employed', value: false }] })],
        [],
        {},
        'TEST_SEARCH',
        now,
      ),
    ).toBe('gated');
    expect(startBlockedReason(chains, [], { TEST_SEARCH: [90] }, 'TEST_SEARCH', now)).toBe(
      'cooling-down',
    );
  });

  it('allows a restart once the cooldown has elapsed', () => {
    const chains = [chain()];
    const now = state({ weekIndex: 130 });
    expect(startBlockedReason(chains, [], { TEST_SEARCH: [100] }, 'TEST_SEARCH', now)).toBeNull();
  });

  it('returns null when the first step id does not resolve', () => {
    expect(startChain(chain({ firstStepId: 'missing' }), 100, null)).toBeNull();
  });
});

describe('advancing a chain', () => {
  it('moves to the named step, a gap away, counting the step taken', () => {
    const next = advanceChain(chain(), active(), 'second', 110)!;

    expect(next.stepId).toBe('second');
    expect(next.dueWeek).toBe(112); // second declares gapWeeks 2
    expect(next.stepsTaken).toBe(1);
    // The target and start week ride along — a search is still the same search.
    expect(next.startedWeek).toBe(100);
  });

  it('ends on `end`, and on a goto nothing declared', () => {
    expect(advanceChain(chain(), active(), CHAIN_END, 110)).toBeNull();
    // A content typo must not strand the player in a search that can never
    // produce another card. Ending is the only option that cannot hang.
    expect(advanceChain(chain(), active(), 'typo', 110)).toBeNull();
    expect(advanceChain(chain(), active(), null, 110)).toBeNull();
  });

  it('forces an end at the step cap, however hard the content loops', () => {
    // `loop` points at itself, so without the cap this never terminates.
    let current: ActiveChain | null = active({ stepId: 'loop' });
    let steps = 0;
    while (current !== null && steps < 100) {
      current = advanceChain(chain(), current, 'loop', 200 + steps);
      steps++;
    }
    expect(current).toBeNull();
    expect(steps).toBe(CHAIN_MAX_STEPS);
  });
});

describe('scheduling and bookkeeping', () => {
  it('presents the earliest-due chain, tie-broken by id, never by start order', () => {
    // A draw is taken for whichever card is presented, so the pick must not
    // depend on the order the player happened to start them (TDD §2.2).
    const first = active({ chainId: 'ZZZ_LATER', dueWeek: 100 });
    const second = active({ chainId: 'AAA_EARLIER', dueWeek: 100 });

    expect(dueChain([first, second], 100)?.chainId).toBe('AAA_EARLIER');
    expect(dueChain([second, first], 100)?.chainId).toBe('AAA_EARLIER');
  });

  it('presents nothing before the due week', () => {
    expect(dueChain([active({ dueWeek: 105 })], 104)).toBeNull();
    expect(dueChain([active({ dueWeek: 105 })], 105)).not.toBeNull();
    // A step that slipped past its week is still due, not skipped.
    expect(dueChain([active({ dueWeek: 105 })], 108)).not.toBeNull();
  });

  it('slips a step by exactly one week', () => {
    expect(slipChain(active({ dueWeek: 100 }), 100).dueWeek).toBe(101);
  });

  it('keeps the active list sorted by id so serialization is stable', () => {
    let chains = withChain([], 'ZZZ', active({ chainId: 'ZZZ' }));
    chains = withChain(chains, 'AAA', active({ chainId: 'AAA' }));
    chains = withChain(chains, 'MMM', active({ chainId: 'MMM' }));

    expect(chains.map((c) => c.chainId)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('replaces rather than duplicates, and removes on null', () => {
    const chains = withChain([active()], 'TEST_SEARCH', active({ stepId: 'second' }));
    expect(chains).toHaveLength(1);
    expect(chains[0].stepId).toBe('second');
    expect(withChain(chains, 'TEST_SEARCH', null)).toEqual([]);
  });

  it('records every ending, so a second search cools down from the last one', () => {
    let history = recordChainEnd({}, 'TEST_SEARCH', 100);
    history = recordChainEnd(history, 'TEST_SEARCH', 200);
    expect(history.TEST_SEARCH).toEqual([100, 200]);
  });
});

describe('lookups', () => {
  it('finds chains and steps by id, and reports a miss as undefined', () => {
    expect(chainById([chain()], 'TEST_SEARCH')?.id).toBe('TEST_SEARCH');
    expect(chainById([chain()], 'NOPE')).toBeUndefined();
    expect(stepById(chain(), 'second')?.gapWeeks).toBe(2);
    expect(stepById(chain(), 'nope')).toBeUndefined();
  });
});
