/**
 * Event resolution through the store — the only place where an event's
 * presentation is split from its resolution. Getting that split wrong is
 * invisible to the engine tests, because the engine is never asked wrongly.
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

    // A speculative tick plus a re-tick also advances by one, so the counter
    // alone cannot catch it — but it records the event a week behind.
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
    // All eight events shipped printing "The shop says {{repairCost}}."
    let cards = 0;
    for (let step = 0; step < 400 && cards < 12; step++) {
      if (!advanceToEvent(1)) continue;
      const pending = useGameStore.getState().pendingEvent!;
      const vars = { ...pending.vars, friendName: 'X', advisorName: 'Y' };

      for (const field of [pending.title, pending.body]) {
        expect(interpolate(field, vars), `${pending.event.id}: ${field}`).not.toMatch(/\{\{/);
      }
      cards++;
      useGameStore.getState().resolveEvent(pending.choiceIds[0]);
    }
    expect(cards).toBeGreaterThan(0);
  });

  it('quotes on the card the number the tick will charge', () => {
    // Catches the card being evaluated a week early — off by a whole year of
    // inflation when the event lands on a year boundary. The context below is
    // built independently; reusing the store's compares the card to itself.
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

    // Same week, card and roll: no second week abandoned, no second draw.
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
