/**
 * Event resolution through the store.
 *
 * The store is the only place where an event's *presentation* is separated from
 * its *resolution*: the engine's `tick` resolves a choice synchronously, but the
 * player needs to see the card first. Getting that split wrong is invisible in
 * the engine tests, because the engine is never wrong — it is asked twice.
 */
import { WEEKS_PER_YEAR, formulaContextFrom, interpolate, resolveMagnitude } from '@finme/engine';
import { formatCents } from '../src/lib/format.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../src/store/useGameStore.ts';

/** Advance until an event card is waiting, or give up. */
function advanceToEvent(maxSteps = 400): boolean {
  for (let step = 0; step < maxSteps; step++) {
    useGameStore.getState().advanceTime();
    if (useGameStore.getState().pendingEvent !== null) return true;
    const run = useGameStore.getState().run;
    if (run === null || run.state.weekIndex >= WEEKS_PER_YEAR * 30 - 1) return false;
  }
  return false;
}

describe('resolving an event from the modal', () => {
  beforeEach(() => {
    useGameStore.getState().start('4F2A9C1B');
  });

  it('resolves the event in the week it fired, not the week after', () => {
    expect(advanceToEvent()).toBe(true);

    const before = useGameStore.getState().run!.state.weekIndex;
    const pending = useGameStore.getState().pendingEvent!;
    useGameStore.getState().resolveEvent(pending.choiceIds[pending.choiceIds.length - 1]);
    const state = useGameStore.getState().run!.state;

    // Exactly one week is ticked for one decision, and it is *the event's own*
    // week. Committing a speculative tick and then ticking again also advances
    // by one, which is why the week counter alone cannot catch it — but it
    // leaves the event recorded a week behind where the run now sits, and
    // charges two weeks of bills for one card.
    expect(state.weekIndex).toBe(before + 1);
    expect(state.eventHistory[pending.event.id]).toContain(state.weekIndex);
  });

  it('applies the choice the player made, not the first one', () => {
    expect(advanceToEvent()).toBe(true);

    const pending = useGameStore.getState().pendingEvent!;
    // Only meaningful where the event actually offers an alternative.
    if (pending.choiceIds.length < 2) return;
    const chosen = pending.choiceIds[pending.choiceIds.length - 1];

    useGameStore.getState().resolveEvent(chosen);

    const log = useGameStore.getState().run!.state.decisionLog.filter((entry) => entry.t === 'event');
    const last = log[log.length - 1];
    expect(last.e).toBe(pending.event.id);
    expect(last.c).toBe(chosen);
  });

  it('records the event exactly once', () => {
    expect(advanceToEvent()).toBe(true);

    const pending = useGameStore.getState().pendingEvent!;
    useGameStore.getState().resolveEvent(pending.choiceIds[0]);

    const state = useGameStore.getState().run!.state;
    const log = state.decisionLog.filter(
      (entry) => entry.t === 'event' && entry.e === pending.event.id,
    );
    expect(log).toHaveLength(1);
    expect(state.eventHistory[pending.event.id] ?? []).toHaveLength(1);
  });

  it('renders every placeholder — no card shows the player raw {{mustache}}', () => {
    // How this shipped: `interpolate` leaves an unknown key as literal text,
    // and the app supplied only friendName/advisorName, so all eight events
    // printed things like "The shop says {{repairCost}}."
    let cards = 0;
    for (let step = 0; step < 400 && cards < 12; step++) {
      if (!advanceToEvent(1)) continue;
      const pending = useGameStore.getState().pendingEvent!;
      const vars = { ...pending.vars, friendName: 'X', advisorName: 'Y' };

      // The variant actually chosen for this firing, not the whole pool.
      for (const field of [pending.title, pending.body]) {
        expect(interpolate(field, vars), `${pending.event.id}: ${field}`).not.toMatch(/\{\{/);
      }
      cards++;
      useGameStore.getState().resolveEvent(pending.choiceIds[0]);
    }
    expect(cards).toBeGreaterThan(0);
  });

  it('quotes on the card the number the tick will charge', () => {
    // Two ways this goes wrong, both seen for real:
    //   1. `displayVars` and the effect drift apart as formula strings. That is
    //      caught statically in @finme/content, over the whole pool.
    //   2. The card is evaluated a week early. `advanceTime` holds the state
    //      from *before* the event's tick, and step 1 of the pipeline
    //      increments `weekIndex` before anything reads it — so quoting from
    //      the un-incremented state is off by a week, and by a whole year of
    //      inflation whenever the event lands on a year boundary. This test
    //      covers that one, which is invisible to a static check.
    //
    // The comparison must build its own context from `weekIndex + 1`. Reusing
    // the store's own context would compare the card against itself.
    let cards = 0;
    const wrong: string[] = [];

    for (const seed of ['4F2A9C1B', 'BBBB2222']) {
      useGameStore.getState().start(seed);
      for (let step = 0; step < 1600; step++) {
        useGameStore.getState().advanceTime();
        const pending = useGameStore.getState().pendingEvent;
        if (pending === null) continue;

        const { state, world } = useGameStore.getState().run!;
        const charged = formulaContextFrom(
          { ...state, weekIndex: state.weekIndex + 1 },
          world,
          pending.roll,
        );

        for (const [key, spec] of Object.entries(pending.event.displayVars ?? {})) {
          cards++;
          const value = resolveMagnitude(spec.value, charged);
          const expected =
            spec.as === 'money'
              ? formatCents(Math.round(value))
              : value.toFixed(spec.precision ?? 0);
          if (pending.vars[key] !== expected) {
            wrong.push(`${seed} w${state.weekIndex} ${pending.event.id}.${key}: card ${pending.vars[key]}, charged ${expected}`);
          }
        }
        useGameStore.getState().resolveEvent(pending.choiceIds[0]);
      }
    }

    expect(cards).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  });

  it('ignores a second advance while a card is open', () => {
    expect(advanceToEvent()).toBe(true);
    const before = useGameStore.getState().run!.state.weekIndex;
    const pending = useGameStore.getState().pendingEvent!;

    useGameStore.getState().advanceTime();

    // Same week, same card, same roll: no second week abandoned and no second
    // `eventMagnitude` draw taken for an event that has not resolved.
    expect(useGameStore.getState().run!.state.weekIndex).toBe(before);
    expect(useGameStore.getState().pendingEvent!.roll).toBe(pending.roll);
    expect(useGameStore.getState().pendingEvent!.event.id).toBe(pending.event.id);
  });

  it('clears the pending event once resolved', () => {
    expect(advanceToEvent()).toBe(true);
    useGameStore.getState().resolveEvent(useGameStore.getState().pendingEvent!.choiceIds[0]);
    expect(useGameStore.getState().pendingEvent).toBeNull();
  });
});
