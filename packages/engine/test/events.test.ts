import { describe, expect, it } from 'vitest';
import {
  type EventDef,
  type EventState,
  FORMULA_FUNCTIONS,
  FormulaError,
  SLOT_GAP_MAX,
  SLOT_GAP_MIN,
  applyEffects,
  cooldownExpired,
  eligibleEvents,
  evaluateFormula,
  eventWeight,
  generateEventSchedule,
  interpolate,
  multiplierProduct,
  passesGate,
  recordFiring,
  resolveChoice,
  rollOutcome,
  selectEvent,
} from '../src/events/index.ts';
import { stream } from '../src/rng.ts';
import { totalWeeks } from '../src/time.ts';

const WEEKS = totalWeeks(30);

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

const event = (partial: Partial<EventDef> & Pick<EventDef, 'id'>): EventDef => ({
  category: 'emergency',
  baseWeight: 100,
  cooldownWeeks: 0,
  gates: [],
  multipliers: [],
  title: 'Something happened',
  body: 'A thing occurred.',
  choices: [{ id: 'ok', label: 'Deal with it', effects: [], logbookKey: 'ok' }],
  ...partial,
});

describe('slot scheduling (TDD §9.1)', () => {
  const schedule = () =>
    generateEventSchedule(stream('4F2A9C1B', 'eventSlots'), stream('4F2A9C1B', 'eventSelection'), WEEKS);

  it('produces identical slot weeks for the same seed regardless of player state', () => {
    // The whole schedule is drawn at init from streams nothing else touches, so
    // no amount of play can move it.
    const a = schedule();
    const b = schedule();
    expect(a.slots).toEqual(b.slots);
    expect(a.slotTickets).toEqual(b.slotTickets);

    // Draining every in-play stream cannot shift it either.
    for (const name of ['eventOutcome', 'jobApplication', 'flavor'] as const) {
      const rng = stream('4F2A9C1B', name);
      for (let i = 0; i < 5_000; i++) rng();
    }
    expect(schedule().slots).toEqual(a.slots);
  });

  it('keeps every gap inside 3-10 weeks', () => {
    const { slots } = schedule();
    expect(slots[0]).toBeGreaterThanOrEqual(SLOT_GAP_MIN);
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i] - slots[i - 1];
      expect(gap).toBeGreaterThanOrEqual(SLOT_GAP_MIN);
      expect(gap).toBeLessThanOrEqual(SLOT_GAP_MAX);
    }
  });

  it('fires 8.2 slots a year at the specified lambda — below both docs\' targets', () => {
    // Measured. §9.1's own comment claims "mean ~4.5, ~11.5 slots/year, ~345
    // over a 30-year run", but its formula adds 3 to floor(exponential), giving
    // a 6.16-week mean gap: 8.4 slots/year and ~253 per run. GDD §5.3 asks for
    // one event every 4-6 weeks, ~10/year, ~300 per run.
    //
    // Implemented as specified and pinned here rather than retuned; lambda 0.34
    // would hit both targets. See docs/DECISIONS.md.
    const { slots } = schedule();
    expect(slots).toHaveLength(247);
    expect(slots.length / 30).toBeCloseTo(8.23, 1);

    const gaps = slots.slice(1).map((week, i) => week - slots[i]);
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(meanGap).toBeGreaterThan(6);
    expect(meanGap).toBeLessThan(6.4);
  });

  it('pre-draws exactly one ticket per slot from the eventSelection stream', () => {
    const { slots, slotTickets } = schedule();
    expect(slotTickets).toHaveLength(slots.length);

    // The tickets are the stream's own draws, in order — not a constant, and
    // not derived from anything the player did.
    const selection = stream('4F2A9C1B', 'eventSelection');
    const expected = slots.map(() => selection());
    expect([...slotTickets]).toEqual(expected);

    // And they genuinely vary, so selection is not pinned to one point.
    expect(new Set(slotTickets).size).toBeGreaterThan(slots.length / 2);
  });

  it('diverges for a different seed', () => {
    const other = generateEventSchedule(
      stream('4F2A9C1C', 'eventSlots'),
      stream('4F2A9C1C', 'eventSelection'),
      WEEKS,
    );
    expect(other.slots).not.toEqual(schedule().slots);
  });
});

describe('gates and multipliers (TDD §9.2)', () => {
  it('evaluates every gate type', () => {
    const s = state({
      age: 40,
      ownsCar: true,
      flags: new Set(['had_scare']),
      debtTypes: new Set(['CREDIT_CARD']),
      heldAssets: new Set(['CRYP']),
      lifeStage: 'mid-career',
      stats: { mood: 35 },
    });

    expect(passesGate({ type: 'age', op: '>', value: 30 }, s)).toBe(true);
    expect(passesGate({ type: 'age', op: '<', value: 30 }, s)).toBe(false);
    expect(passesGate({ type: 'flag', value: 'had_scare' }, s)).toBe(true);
    expect(passesGate({ type: 'notFlag', value: 'had_scare' }, s)).toBe(false);
    expect(passesGate({ type: 'employed' }, s)).toBe(true);
    expect(passesGate({ type: 'employed', value: false }, s)).toBe(false);
    expect(passesGate({ type: 'ownsCar' }, s)).toBe(true);
    expect(passesGate({ type: 'ownsHome' }, s)).toBe(false);
    expect(passesGate({ type: 'hasDebtType', value: 'CREDIT_CARD' }, s)).toBe(true);
    expect(passesGate({ type: 'hasDebtType', value: 'PAYDAY' }, s)).toBe(false);
    expect(passesGate({ type: 'holdsAsset', value: 'CRYP' }, s)).toBe(true);
    expect(passesGate({ type: 'lifeStage', value: 'mid-career' }, s)).toBe(true);
    expect(passesGate({ type: 'stat', stat: 'mood', op: '<', value: 40 }, s)).toBe(true);
  });

  it('fails a gate on an unknown stat rather than throwing', () => {
    // A content typo should quietly stop an event firing, not crash a run.
    expect(passesGate({ type: 'stat', stat: 'nonsense', op: '>', value: 0 }, state())).toBe(false);
  });

  it('multiplies the factors whose gate passes', () => {
    const multipliers = [
      { when: { type: 'stat', stat: 'mood', op: '<', value: 40 } as const, factor: 1.3 },
      { when: { type: 'ownsCar' } as const, factor: 2.0 },
    ];
    expect(multiplierProduct(multipliers, state({ stats: { mood: 60 } }))).toBe(1);
    expect(multiplierProduct(multipliers, state({ stats: { mood: 30 } }))).toBeCloseTo(1.3, 10);
    expect(multiplierProduct(multipliers, state({ stats: { mood: 30 }, ownsCar: true }))).toBeCloseTo(2.6, 10);
  });

  it('honours cooldowns and once-per-run', () => {
    const e = event({ id: 'A', cooldownWeeks: 60 });
    expect(cooldownExpired(e, undefined, 100)).toBe(true);
    expect(cooldownExpired(e, [50], 100)).toBe(false);
    expect(cooldownExpired(e, [40], 100)).toBe(true);

    const once = event({ id: 'B', oncePerRun: true });
    expect(eligibleEvents([once], state(), {})).toHaveLength(1);
    expect(eligibleEvents([once], state(), { B: [10] })).toHaveLength(0);
  });
});

describe('event selection (TDD §9.2)', () => {
  const pool = [
    event({ id: 'CAR_TROUBLE', gates: [{ type: 'ownsCar' }] }),
    event({ id: 'RENT_HIKE', gates: [{ type: 'ownsHome', value: false }] }),
    event({ id: 'BONUS', gates: [{ type: 'employed' }] }),
  ];

  it('maps the same ticket to different events from different states', () => {
    // This is the reconciliation: the seed fixes *when*, state decides *what*.
    const ticket = 0.5;
    const withCar = selectEvent(pool, state({ ownsCar: true }), {}, ticket);
    const withoutCar = selectEvent(pool, state({ ownsCar: false }), {}, ticket);

    expect(withCar).not.toBeNull();
    expect(withoutCar).not.toBeNull();
    expect(withCar!.id).not.toBe(withoutCar!.id);
  });

  it('passes a slot silently when nothing is eligible', () => {
    // Not an error, and never backfilled with something inappropriate.
    const gated = [event({ id: 'X', gates: [{ type: 'ownsHome' }] })];
    expect(selectEvent(gated, state({ ownsHome: false }), {}, 0.5)).toBeNull();
    expect(selectEvent([], state(), {}, 0.5)).toBeNull();
    // A pool whose every weight is zero also passes rather than throwing.
    expect(selectEvent([event({ id: 'Z', baseWeight: 0 })], state(), {}, 0.5)).toBeNull();
  });

  it('selects from a stably id-sorted pool', () => {
    // The sort is load-bearing: without it the same ticket maps to different
    // events across engine versions and every shared seed breaks.
    const forward = [event({ id: 'AAA' }), event({ id: 'BBB' }), event({ id: 'CCC' })];
    const shuffled = [forward[2], forward[0], forward[1]];

    for (const ticket of [0.0, 0.1, 0.34, 0.5, 0.67, 0.99]) {
      expect(selectEvent(shuffled, state(), {}, ticket)!.id).toBe(
        selectEvent(forward, state(), {}, ticket)!.id,
      );
    }
    expect(eligibleEvents(shuffled, state(), {}).map((e) => e.id)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('walks the cumulative weights in order', () => {
    const three = [event({ id: 'A' }), event({ id: 'B' }), event({ id: 'C' })];
    expect(selectEvent(three, state(), {}, 0.0)!.id).toBe('A');
    expect(selectEvent(three, state(), {}, 0.32)!.id).toBe('A');
    expect(selectEvent(three, state(), {}, 0.34)!.id).toBe('B');
    expect(selectEvent(three, state(), {}, 0.67)!.id).toBe('C');
    expect(selectEvent(three, state(), {}, 0.999)!.id).toBe('C');
  });

  it('weights a multiplied event more often', () => {
    const pair = [
      event({ id: 'PLAIN' }),
      event({
        id: 'BOOSTED',
        multipliers: [{ when: { type: 'stat', stat: 'mood', op: '<', value: 40 }, factor: 4 }],
      }),
    ];
    const low = state({ stats: { mood: 20 } });
    expect(eventWeight(pair[1], low)).toBe(400);

    let boosted = 0;
    for (let i = 0; i < 1_000; i++) {
      if (selectEvent(pair, low, {}, i / 1_000)!.id === 'BOOSTED') boosted++;
    }
    expect(boosted / 1_000).toBeCloseTo(0.8, 1);
  });

  it('records firings for cooldown bookkeeping', () => {
    let history = {};
    history = recordFiring(history, 'A', 10);
    history = recordFiring(history, 'A', 80);
    expect(history).toEqual({ A: [10, 80] });
  });
});

describe('the formula evaluator (TDD §9.3)', () => {
  const context = {
    vars: { cpi: 1.25, monthlyIncome: 400_000, carScrapValue: 192_000 },
    price: (assetId: string) => ({ SAFE: 12_345, CRYP: 640 })[assetId] ?? Number.NaN,
  };

  it('evaluates the formulas from §9.3 and §9.4', () => {
    expect(evaluateFormula('cpi * 45000', context)).toBe(56_250);
    expect(evaluateFormula('0.35 * monthlyIncome', context)).toBe(140_000);
    expect(evaluateFormula('clamp(0.5*monthlyIncome, cpi*20000, cpi*250000)', context)).toBe(200_000);
    expect(evaluateFormula('-clamp(0.6*monthlyIncome, cpi*40000, cpi*180000)', context)).toBe(-225_000);
    expect(evaluateFormula("monthlyIncome / price('CRYP')", context)).toBe(625);
    expect(evaluateFormula("(0.15*monthlyIncome)/price('CRYP')", context)).toBeCloseTo(93.75, 10);
    expect(evaluateFormula('carScrapValue', context)).toBe(192_000);
  });

  it('respects precedence, parentheses and unary minus', () => {
    expect(evaluateFormula('2 + 3 * 4', context)).toBe(14);
    expect(evaluateFormula('(2 + 3) * 4', context)).toBe(20);
    expect(evaluateFormula('-5 + 2', context)).toBe(-3);
    expect(evaluateFormula('10 / 4', context)).toBe(2.5);
    expect(evaluateFormula('max(1, 2, 3)', context)).toBe(3);
    expect(evaluateFormula('round(2.5)', context)).toBe(3);
    expect(evaluateFormula('abs(0 - 7)', context)).toBe(7);
  });

  it('rejects anything outside the whitelisted function set', () => {
    // Content is data. It must never be able to reach the runtime.
    // Assert the *reason* — an unknown call must be rejected by the whitelist,
    // not incidentally by some later finiteness check.
    for (const source of [
      'eval(1)',
      'require(1)',
      'sqrt(4)',
      'random()',
      'exit(1)',
      'fetch(1)',
      'alert(1)',
    ]) {
      expect(() => evaluateFormula(source, context)).toThrow(/unknown function/);
    }

    // Bare identifiers that are not variables are rejected as variables.
    for (const source of ['constructor', 'globalThis', '__proto__', 'process']) {
      expect(() => evaluateFormula(source, context)).toThrow(/unknown variable/);
    }

    // Property access is not in the grammar at all.
    for (const source of ['Math.random()', 'process.exit(1)', 'a.b']) {
      expect(() => evaluateFormula(source, context)).toThrow(FormulaError);
    }

    // Every whitelisted name does resolve, so the list is the whole surface.
    expect(FORMULA_FUNCTIONS).toContain('clamp');
    for (const name of FORMULA_FUNCTIONS) {
      const call = name === 'price' ? "price('SAFE')" : `${name}(1, 2, 3)`;
      expect(() => evaluateFormula(call, context)).not.toThrow(/unknown function/);
    }
  });

  it('rejects unknown variables rather than reading them as zero', () => {
    expect(() => evaluateFormula('nonexistentVar * 2', context)).toThrow(/unknown variable/);
    expect(() => evaluateFormula('cpi * missing', context)).toThrow(/unknown variable/);
  });

  it('rejects malformed syntax', () => {
    for (const source of ['1 +', '(1', '1)', '', 'clamp(1,2)', 'round(1,2)', '1 2', '@', '1 / 0']) {
      expect(() => evaluateFormula(source, context)).toThrow(FormulaError);
    }
  });

  it('refuses price() when the context does not provide one', () => {
    expect(() => evaluateFormula("price('SAFE')", { vars: {} })).toThrow(/not available/);
    expect(() => evaluateFormula("price('NOPE')", context)).toThrow(/no price/);
  });
});

describe('effect application (TDD §9.3)', () => {
  const context = { vars: { cpi: 1.2, monthlyIncome: 300_000 }, price: () => 10_000 };

  it('folds effects into a diff rather than mutating anything', () => {
    const out = applyEffects(
      [
        { k: 'cash', cents: '-cpi * 50000' },
        { k: 'mood', delta: -8 },
        { k: 'energy', delta: -5 },
        { k: 'flag', add: 'had_repair', remove: 'owns_car' },
        { k: 'debt', instrument: 'CREDIT_CARD', principalCents: '0.5 * monthlyIncome' },
        { k: 'expense', category: 'insurance', cents: 12_000, recurring: true },
        { k: 'creditEvent', kind: 'inquiry' },
        { k: 'jobOffer', jobId: 'line-cook' },
      ],
      context,
    );

    expect(out.cashDeltaCents).toBe(-60_000);
    expect(out.moodDelta).toBe(-8);
    expect(out.energyDelta).toBe(-5);
    expect(out.flagsAdded).toEqual(['had_repair']);
    expect(out.flagsRemoved).toEqual(['owns_car']);
    expect(out.debtsOpened).toEqual([{ instrument: 'CREDIT_CARD', principalCents: 150_000 }]);
    expect(out.expenses).toEqual([{ category: 'insurance', cents: 12_000, recurring: true }]);
    expect(out.creditEvents).toEqual(['inquiry']);
    expect(out.jobOffers).toEqual(['line-cook']);
  });

  it('resolves money to integer cents', () => {
    const out = applyEffects([{ k: 'cash', cents: 'cpi * 1234.567' }], context);
    expect(Number.isInteger(out.cashDeltaCents)).toBe(true);
  });

  it('schedules deferred effects forward from the firing week', () => {
    const out = resolveChoice(
      {
        id: 'scrap',
        label: 'Let it go',
        effects: [{ k: 'mood', delta: -8 }],
        deferred: [
          {
            afterWeeks: 1,
            condition: { type: 'flag', value: 'job_requires_vehicle' },
            effects: [{ k: 'flag', add: 'job_at_risk_no_vehicle' }],
          },
        ],
        logbookKey: 'car_scrapped',
      },
      context,
      420,
      stream('4F2A9C1B', 'eventOutcome'),
    );

    expect(out.deferred).toHaveLength(1);
    expect(out.deferred[0].dueWeek).toBe(421);
    expect(out.logbookKeys).toEqual(['car_scrapped']);
  });

  it('consumes no draws for a choice without an outcome roll', () => {
    let draws = 0;
    const real = stream('4F2A9C1B', 'eventOutcome');
    const counting = () => {
      draws++;
      return real();
    };

    resolveChoice({ id: 'a', label: 'A', effects: [], logbookKey: 'a' }, context, 10, counting);
    expect(draws).toBe(0);

    resolveChoice(
      {
        id: 'b',
        label: 'B',
        effects: [],
        logbookKey: 'b',
        outcomeRoll: {
          stream: 'eventOutcome',
          branches: [
            { p: 0.5, effects: [], logbookKey: 'good' },
            { p: 0.5, effects: [], logbookKey: 'bad' },
          ],
        },
      },
      context,
      10,
      counting,
    );
    expect(draws).toBe(1);
  });

  it('rolls outcome branches at their stated probabilities', () => {
    const rng = stream('4F2A9C1B', 'eventOutcome');
    const roll = {
      stream: 'eventOutcome' as const,
      branches: [
        { p: 0.7, effects: [], logbookKey: 'likely' },
        { p: 0.3, effects: [], logbookKey: 'unlikely' },
      ],
    };
    let likely = 0;
    for (let i = 0; i < 10_000; i++) if (rollOutcome(roll, rng).logbookKey === 'likely') likely++;
    expect(likely / 10_000).toBeGreaterThan(0.68);
    expect(likely / 10_000).toBeLessThan(0.72);
  });

  it('interpolates {{var}} in an event body', () => {
    expect(interpolate('The shop says {{repairCost}}.', { repairCost: '$1,240' })).toBe(
      'The shop says $1,240.',
    );
    // An unknown placeholder is left visible rather than becoming "undefined".
    expect(interpolate('{{missing}}', {})).toBe('{{missing}}');
  });
});
