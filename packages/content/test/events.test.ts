import { describe, expect, it } from 'vitest';
import {
  EVENT_CATEGORIES,
  type EventState,
  applyEffects,
  eligibleEvents,
  evaluateFormula,
  eventWeight,
  resolveChoice,
  selectEvent,
  stream,
} from '@finme/engine';
import {
  ALLOWED_FORMULA_FUNCTIONS,
  EVENTS,
  collectFormulas,
  eventById,
  eventsFileSchema,
  referencedLogbookKeys,
} from '../src/events.ts';

/** A formula context with every variable the MVP content references. */
const formulaContext = {
  vars: {
    cpi: 1.0,
    monthlyIncome: 400_000,
    carScrapValue: 192_000,
    performanceNorm: 0.6,
  },
  price: (assetId: string) => ({ SAFE: 12_345, CRYP: 640, MOON: 8_000 })[assetId] ?? Number.NaN,
};

const state = (partial: Partial<EventState> = {}): EventState => ({
  weekIndex: 300,
  age: 27,
  employed: true,
  ownsCar: false,
  ownsHome: false,
  lifeStage: 'early-career',
  flags: new Set<string>(),
  debtTypes: new Set<string>(),
  heldAssets: new Set<string>(),
  stats: {
    mood: 60,
    carAgeYears: 3,
    emergencyFundMonths: 2,
    cryptoPriceChange52w: 0.1,
    weeksInCurrentJob: 20,
    lastRaisePct: 0.02,
    inflationThisYear: 0.02,
  },
  ...partial,
});

describe('the MVP event batch', () => {
  it('validates against the schema at load', () => {
    expect(EVENTS.length).toBe(8);
    for (const id of ['EMG_CAR_BREAKDOWN', 'SCM_COWORKER_CRYPTO', 'CAR_RAISE_BELOW_INFLATION']) {
      expect(eventById(id), `TDD §9.4 specifies ${id}`).toBeDefined();
    }
  });

  it('spans different categories', () => {
    const categories = new Set(EVENTS.map((event) => event.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);
    for (const category of categories) expect(EVENT_CATEGORIES).toContain(category);
  });

  it('parses every formula in the content against the whitelist', () => {
    const formulas = collectFormulas();
    expect(formulas.length).toBeGreaterThan(10);
    for (const { eventId, source } of formulas) {
      expect(() => evaluateFormula(source, formulaContext), `${eventId}: ${source}`).not.toThrow();
    }
  });

  it('references only whitelisted functions', () => {
    for (const { eventId, source } of collectFormulas()) {
      for (const [, name] of source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        expect(ALLOWED_FORMULA_FUNCTIONS, `${eventId} calls ${name}()`).toContain(name);
      }
    }
  });

  it('never signals which choice is correct', () => {
    // GDD §1: no label may rank the options for the player.
    const judging = /\b(best|worst|smart|dumb|wise|foolish|correct|wrong|recommended|should)\b/i;
    for (const event of EVENTS) {
      for (const choice of event.choices) {
        expect(choice.label, `${event.id}/${choice.id}`).not.toMatch(judging);
      }
    }
  });
});

describe('the content lint', () => {
  const valid = eventsFileSchema.parse({ events: [EVENTS[0]] });

  it('requires a logbookKey on every choice', () => {
    for (const event of EVENTS) {
      for (const choice of event.choices) {
        expect(choice.logbookKey, `${event.id}/${choice.id}`).toBeTruthy();
        for (const branch of choice.outcomeRoll?.branches ?? []) {
          expect(branch.logbookKey).toBeTruthy();
        }
      }
    }
    const stripped = structuredCloneish(valid.events[0]);
    delete (stripped.choices[0] as { logbookKey?: string }).logbookKey;
    expect(() => eventsFileSchema.parse({ events: [stripped] })).toThrow();
  });

  it('rejects a choice that does nothing and does not say so', () => {
    const event = structuredCloneish(valid.events[0]);
    event.choices[0].effects = [];
    delete event.choices[0].outcomeRoll;
    delete event.choices[0].deferred;
    expect(() => eventsFileSchema.parse({ events: [event] })).toThrow(/has no effects/);

    // The same choice marked as deliberate passes.
    event.choices[0].noop = true;
    expect(() => eventsFileSchema.parse({ events: [event] })).not.toThrow();
  });

  it('allows the deliberately empty choice §9.4 specifies', () => {
    // CAR_RAISE_BELOW_INFLATION's "Say thank you" does nothing mechanically,
    // and that is the point.
    const accept = eventById('CAR_RAISE_BELOW_INFLATION')!.choices.find((c) => c.id === 'accept')!;
    expect(accept.effects).toHaveLength(0);
    expect(accept.noop).toBe(true);
    expect(accept.logbookKey).toBe('raise_accepted');
  });

  it('rejects a colliding event id', () => {
    expect(() => eventsFileSchema.parse({ events: [EVENTS[0], EVENTS[0]] })).toThrow(
      /duplicate event id/,
    );
  });

  it('rejects a colliding choice id within an event', () => {
    const event = structuredCloneish(valid.events[0]);
    event.choices[1].id = event.choices[0].id;
    expect(() => eventsFileSchema.parse({ events: [event] })).toThrow(/duplicate choice id/);
  });

  it('rejects an id that would be unstable across a rename', () => {
    const event = structuredCloneish(valid.events[0]);
    event.id = 'lowercase_id';
    expect(() => eventsFileSchema.parse({ events: [event] })).toThrow();
  });

  it('requires at least two choices', () => {
    const event = structuredCloneish(valid.events[0]);
    event.choices = [event.choices[0]];
    expect(() => eventsFileSchema.parse({ events: [event] })).toThrow();
  });

  it('collects every logbook key the content needs written', () => {
    const keys = referencedLogbookKeys();
    expect(keys.length).toBeGreaterThan(15);
    expect(keys).toContain('car_repair_paid');
    expect(keys).toContain('raise_negotiated_win');
    expect(keys).toContain('dental_postponed_worse');
    expect([...keys]).toEqual([...keys].sort());
  });
});

describe('golden: fixed seed, fixed state, exact selection and delta', () => {
  it('maps one fixed ticket to different events from different states', () => {
    // The whole point of the ticket mechanism: the seed fixes when, state
    // decides what. Ticket 0.05 lands on the first event in the id-sorted
    // eligible pool, and which event that is depends entirely on the state.
    const newJob = state({ ownsCar: true });
    expect(newJob.stats.weeksInCurrentJob).toBeLessThan(52); // raise event gated out
    expect(selectEvent(EVENTS, newJob, {}, 0.05)?.id).toBe('EMG_CAR_BREAKDOWN');

    const tenured = state({
      ownsCar: true,
      stats: { ...newJob.stats, weeksInCurrentJob: 104, lastRaisePct: 0.016 },
    });
    expect(selectEvent(EVENTS, tenured, {}, 0.05)?.id).toBe('CAR_RAISE_BELOW_INFLATION');

    // And with no car and a new job, the same ticket lands elsewhere again.
    const renter = state({ ownsCar: false });
    expect(selectEvent(EVENTS, renter, {}, 0.05)?.id).toBe('HLT_UNEXPECTED_DENTAL');
  });

  it('gates the car event on owning a car', () => {
    expect(eligibleEvents(EVENTS, state({ ownsCar: false }), {}).map((e) => e.id)).not.toContain(
      'EMG_CAR_BREAKDOWN',
    );
    expect(eligibleEvents(EVENTS, state({ ownsCar: true }), {}).map((e) => e.id)).toContain(
      'EMG_CAR_BREAKDOWN',
    );
  });

  it('produces the exact delta for EMG_CAR_BREAKDOWN / repair', () => {
    const repair = eventById('EMG_CAR_BREAKDOWN')!.choices.find((c) => c.id === 'repair')!;
    const out = resolveChoice(repair, formulaContext, 300, stream('4F2A9C1B', 'eventOutcome'));

    // clamp(0.6 * 400000, 1.0*40000, 1.0*180000) = clamp(240000, 40000, 180000)
    expect(out.cashDeltaCents).toBe(-180_000);
    expect(out.moodDelta).toBe(0);
    expect(out.debtsOpened).toEqual([]);
    expect(out.logbookKeys).toEqual(['car_repair_paid']);
    expect(out.deferred).toEqual([]);
  });

  it('produces the exact delta for EMG_CAR_BREAKDOWN / scrap, deferred included', () => {
    const scrap = eventById('EMG_CAR_BREAKDOWN')!.choices.find((c) => c.id === 'scrap')!;
    const out = resolveChoice(scrap, formulaContext, 412, stream('4F2A9C1B', 'eventOutcome'));

    expect(out.cashDeltaCents).toBe(192_000);
    expect(out.moodDelta).toBe(-8);
    expect(out.flagsRemoved).toEqual(['owns_car']);
    expect(out.deferred).toEqual([
      {
        dueWeek: 413,
        condition: { type: 'flag', value: 'job_requires_vehicle' },
        effects: [{ k: 'flag', add: 'job_at_risk_no_vehicle' }],
        logbookKey: undefined,
      },
    ]);
  });

  it('produces the exact delta for SCM_COWORKER_CRYPTO / in_big', () => {
    const inBig = eventById('SCM_COWORKER_CRYPTO')!.choices.find((c) => c.id === 'in_big')!;
    const out = resolveChoice(inBig, formulaContext, 300, stream('4F2A9C1B', 'eventOutcome'));

    // A month's pay at CRYP 640c a share.
    expect(out.cashDeltaCents).toBe(-400_000);
    expect(out.assetTrades).toEqual([{ assetId: 'CRYP', sharesDelta: 625 }]);
    expect(out.logbookKeys).toEqual(['crypto_in_big']);
  });

  it('weights SCM_COWORKER_CRYPTO up after a crypto run and a bad mood', () => {
    const calm = state();
    const tempted = state({ stats: { ...calm.stats, cryptoPriceChange52w: 0.9, mood: 30 } });

    const crypto = eventById('SCM_COWORKER_CRYPTO')!;
    // 2.5 x 1.3 = 3.25x the weight when the player is most susceptible.
    expect(eventWeight(crypto, calm)).toBe(100);
    expect(eventWeight(crypto, tempted)).toBeCloseTo(325, 10);

    // The realized *share* rises by less than the weight ratio, because the
    // denominator is the whole eligible pool.
    const shareIn = (s: EventState) => {
      let hits = 0;
      for (let i = 0; i < 1_000; i++) {
        if (selectEvent(EVENTS, s, {}, i / 1_000)?.id === 'SCM_COWORKER_CRYPTO') hits++;
      }
      return hits / 1_000;
    };
    expect(shareIn(calm)).toBeCloseTo(0.204, 2);
    expect(shareIn(tempted)).toBeCloseTo(0.455, 2);
    expect(shareIn(tempted)).toBeGreaterThan(shareIn(calm) * 2);
  });

  it('produces the exact delta for CAR_RAISE_BELOW_INFLATION / negotiate on a fixed seed', () => {
    const negotiate = eventById('CAR_RAISE_BELOW_INFLATION')!.choices.find((c) => c.id === 'negotiate')!;
    const rng = stream('4F2A9C1B', 'eventOutcome');

    // p(win) = 0.25 + 0.3 * 0.6 = 0.43; the first draw for this seed is 0.4266.
    const out = resolveChoice(negotiate, formulaContext, 520, rng);
    expect(out.logbookKeys).toEqual(['raise_negotiate_attempt', 'raise_negotiated_win']);
    expect(out.flagsAdded).toEqual(['raise_negotiated']);
    expect(out.performanceDelta).toBe(0);
  });

  it('gates CAR_RAISE_BELOW_INFLATION on the raise actually trailing inflation', () => {
    const tenured = { ...state().stats, weeksInCurrentJob: 104 };
    const behind = state({ stats: { ...tenured, lastRaisePct: 0.016, inflationThisYear: 0.02 } });
    const ahead = state({ stats: { ...tenured, lastRaisePct: 0.03, inflationThisYear: 0.02 } });

    expect(eligibleEvents(EVENTS, behind, {}).map((e) => e.id)).toContain('CAR_RAISE_BELOW_INFLATION');
    expect(eligibleEvents(EVENTS, ahead, {}).map((e) => e.id)).not.toContain(
      'CAR_RAISE_BELOW_INFLATION',
    );
  });

  it('produces the exact delta for HLT_UNEXPECTED_DENTAL / postpone', () => {
    const postpone = eventById('HLT_UNEXPECTED_DENTAL')!.choices.find((c) => c.id === 'postpone')!;
    const out = resolveChoice(postpone, formulaContext, 100, stream('4F2A9C1B', 'eventOutcome'));

    expect(out.moodDelta).toBe(-3);
    expect(out.cashDeltaCents).toBe(0); // nothing today
    expect(out.deferred[0].dueWeek).toBe(126);
    expect(out.deferred[0].logbookKey).toBe('dental_postponed_worse');

    // Half a year later it costs more than paying today would have.
    const later = applyEffects(out.deferred[0].effects, formulaContext);
    const payNow = eventById('HLT_UNEXPECTED_DENTAL')!.choices.find((c) => c.id === 'pay')!;
    const nowCost = applyEffects(payNow.effects, formulaContext).cashDeltaCents;
    expect(later.cashDeltaCents).toBeLessThan(nowCost);
  });

  it('honours cooldowns across a run', () => {
    const owner = state({ ownsCar: true, weekIndex: 340 });
    const recent = { EMG_CAR_BREAKDOWN: [300] };
    expect(eligibleEvents(EVENTS, owner, recent).map((e) => e.id)).not.toContain('EMG_CAR_BREAKDOWN');

    const old = { EMG_CAR_BREAKDOWN: [200] };
    expect(eligibleEvents(EVENTS, owner, old).map((e) => e.id)).toContain('EMG_CAR_BREAKDOWN');
  });
});

/** A structured clone that keeps the object mutable and typed loosely enough to break. */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
