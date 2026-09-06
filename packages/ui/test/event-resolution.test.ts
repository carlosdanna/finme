/**
 * Event resolution through the store.
 *
 * The store is the only place where an event's *presentation* is separated from
 * its *resolution*: the engine's `tick` resolves a choice synchronously, but the
 * player needs to see the card first. Getting that split wrong is invisible in
 * the engine tests, because the engine is never wrong — it is asked twice.
 */
import { WEEKS_PER_YEAR, formulaContextFrom, interpolate, resolveMagnitude } from '@finme/engine';
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

      for (const field of [pending.event.title, pending.event.body]) {
        expect(interpolate(field, vars), `${pending.event.id}: ${field}`).not.toMatch(/\{\{/);
      }
      cards++;
      useGameStore.getState().resolveEvent(pending.choiceIds[0]);
    }
    expect(cards).toBeGreaterThan(0);
  });

  it('quotes on the card exactly what the choice charges', () => {
    // The failure this guards: `displayVars` and the effect are two separate
    // formula strings, so a card can promise one number and the choice take
    // another. They are only equal because they are written the same and are
    // evaluated against the same state and the same `roll` — which is why the
    // roll is drawn when the card appears and fed back into the resolving tick,
    // rather than drawn fresh at resolution.
    let checked = 0;
    for (let step = 0; step < 400 && checked < 6; step++) {
      if (!advanceToEvent(1)) continue;
      const pending = useGameStore.getState().pendingEvent!;
      const { state, world } = useGameStore.getState().run!;
      const context = formulaContextFrom(state, world, pending.roll);

      for (const [key, spec] of Object.entries(pending.event.displayVars ?? {})) {
        if (spec.as !== 'money') continue;
        // Every cash effect across the event's choices that quotes this price.
        const quoted = resolveMagnitude(spec.value, context);
        // Cash and recurring expenses both count: HOU_RENT_INCREASE quotes a
        // monthly rent rise, which lands as an `expense`, not a `cash` effect.
        const charged = pending.event.choices
          .flatMap((choice) => [
            ...choice.effects,
            ...(choice.outcomeRoll?.branches ?? []).flatMap((branch) => branch.effects),
          ])
          .filter((effect) => effect.k === 'cash' || effect.k === 'expense')
          .map((effect) => Math.abs(resolveMagnitude(effect.cents, context)));

        if (charged.length === 0) continue;
        expect(charged, `${pending.event.id}.${key}`).toContain(Math.abs(quoted));
        checked++;
      }
      useGameStore.getState().resolveEvent(pending.choiceIds[0]);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('clears the pending event once resolved', () => {
    expect(advanceToEvent()).toBe(true);
    useGameStore.getState().resolveEvent(useGameStore.getState().pendingEvent!.choiceIds[0]);
    expect(useGameStore.getState().pendingEvent).toBeNull();
  });
});
