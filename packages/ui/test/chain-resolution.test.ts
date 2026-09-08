/**
 * Chain steps through the store.
 *
 * A chain card is presented and resolved across two ticks, exactly like an
 * event, and gets the split wrong in exactly the same invisible ways: a week
 * committed the player never chose, a second magnitude draw, or a card that
 * quotes a price the tick will not charge.
 */
import { WEEKS_PER_YEAR, chainById, interpolate, pendingChainContext, resolveMagnitude } from '@finme/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatCents } from '../src/lib/format.ts';
import { useGameStore } from '../src/store/useGameStore.ts';

/** Start a search and advance until its first card is waiting. */
function advanceToChainCard(chainId: string, target: string, maxSteps = 60): boolean {
  useGameStore.getState().startChain(chainId, target);
  for (let step = 0; step < maxSteps; step++) {
    useGameStore.getState().advanceTime();
    const { pendingChainStep, pendingEvent, run } = useGameStore.getState();
    if (pendingChainStep !== null) return true;
    // A slot event takes the week; answer it and carry on.
    if (pendingEvent !== null) {
      useGameStore.getState().resolveEvent(pendingEvent.choiceIds[0]);
      continue;
    }
    if (run === null || run.state.chains.length === 0) return false;
    if (run.state.weekIndex >= WEEKS_PER_YEAR * 30 - 1) return false;
  }
  return false;
}

describe('starting and stopping a search', () => {
  beforeEach(() => {
    useGameStore.getState().start('4F2A9C1B');
  });

  it('opens a chain the engine accepts, and records it for replay', () => {
    useGameStore.getState().startChain('HOME_SEARCH', 'rent-2');
    const state = useGameStore.getState().run!.state;

    expect(state.chains).toHaveLength(1);
    expect(state.chains[0].chainId).toBe('HOME_SEARCH');
    expect(state.chains[0].target).toBe('rent-2');
    // A save is the seed plus the decision log, so the start has to be in it.
    expect(state.decisionLog.at(-1)).toMatchObject({ t: 'chainStart', k: 'HOME_SEARCH' });
  });

  it('does not open a second search on top of the first', () => {
    useGameStore.getState().startChain('HOME_SEARCH', 'rent-2');
    useGameStore.getState().startChain('HOME_SEARCH', 'rent-3');

    const state = useGameStore.getState().run!.state;
    expect(state.chains).toHaveLength(1);
    expect(state.chains[0].target).toBe('rent-2');
  });

  it('clears the search when the player stops looking', () => {
    useGameStore.getState().startChain('JOB_SEARCH', 'retail-associate');
    expect(useGameStore.getState().run!.state.chains).toHaveLength(1);

    useGameStore.getState().abandonChain('JOB_SEARCH');
    const state = useGameStore.getState().run!.state;

    expect(state.chains).toEqual([]);
    expect(state.chainHistory.JOB_SEARCH).toHaveLength(1);
    expect(state.decisionLog.at(-1)).toMatchObject({ t: 'chainAbandon', k: 'JOB_SEARCH' });
  });
});

describe('resolving a chain step from the modal', () => {
  beforeEach(() => {
    useGameStore.getState().start('4F2A9C1B');
  });

  it('presents the step as a card with its choices', () => {
    expect(advanceToChainCard('HOME_SEARCH', 'rent-2')).toBe(true);

    const pending = useGameStore.getState().pendingChainStep!;
    expect(pending.chainId).toBe('HOME_SEARCH');
    expect(pending.choiceIds.length).toBeGreaterThanOrEqual(2);
    expect(pending.title.length).toBeGreaterThan(0);
    // Only the choices the engine says are available this week.
    const chain = chainById(useGameStore.getState().run!.world.chainDefs, 'HOME_SEARCH')!;
    const step = chain.steps.find((s) => s.id === pending.stepId)!;
    for (const id of pending.choiceIds) {
      expect(step.card.choices.map((c) => c.id)).toContain(id);
    }
  });

  it('resolves in the week the step landed, and records the choice', () => {
    expect(advanceToChainCard('HOME_SEARCH', 'rent-2')).toBe(true);

    const before = useGameStore.getState().run!.state.weekIndex;
    const pending = useGameStore.getState().pendingChainStep!;
    useGameStore.getState().resolveChainStep(pending.choiceIds[0]);

    const state = useGameStore.getState().run!.state;
    expect(state.weekIndex).toBe(before + 1);

    const log = state.decisionLog.filter((entry) => entry.t === 'chainStep');
    expect(log.at(-1)).toMatchObject({
      k: 'HOME_SEARCH',
      s: pending.stepId,
      c: pending.choiceIds[0],
    });
    expect(useGameStore.getState().pendingChainStep).toBeNull();
  });

  it('ignores a second advance while a step card is open', () => {
    expect(advanceToChainCard('HOME_SEARCH', 'rent-2')).toBe(true);

    const before = useGameStore.getState().run!.state.weekIndex;
    const pending = useGameStore.getState().pendingChainStep!;
    useGameStore.getState().advanceTime();

    // Same week, same card, same roll: no second week abandoned, no second draw.
    expect(useGameStore.getState().run!.state.weekIndex).toBe(before);
    expect(useGameStore.getState().pendingChainStep!.roll).toBe(pending.roll);
    expect(useGameStore.getState().pendingChainStep!.stepId).toBe(pending.stepId);
  });

  it('refuses to start or abandon a search while a card is open', () => {
    expect(advanceToChainCard('HOME_SEARCH', 'rent-2')).toBe(true);
    const before = useGameStore.getState().run!.state.weekIndex;

    useGameStore.getState().startChain('JOB_SEARCH', 'retail-associate');
    useGameStore.getState().abandonChain('HOME_SEARCH');

    // Both would have run a tick and committed the abandoned week.
    expect(useGameStore.getState().run!.state.weekIndex).toBe(before);
    expect(useGameStore.getState().run!.state.chains).toHaveLength(1);
  });

  it('renders every placeholder — no step card shows raw {{mustache}}', () => {
    let cards = 0;
    for (const target of ['rent-3', 'buy-2']) {
      useGameStore.getState().start('4F2A9C1B');
      for (let step = 0; step < 30 && cards < 20; step++) {
        if (useGameStore.getState().run!.state.chains.length === 0) {
          useGameStore.getState().startChain('HOME_SEARCH', target);
        }
        useGameStore.getState().advanceTime();
        const pending = useGameStore.getState().pendingChainStep;
        if (pending === null) {
          const event = useGameStore.getState().pendingEvent;
          if (event !== null) useGameStore.getState().resolveEvent(event.choiceIds[0]);
          continue;
        }
        const vars = { ...pending.vars, friendName: 'X', advisorName: 'Y' };
        for (const field of [pending.title, pending.body]) {
          expect(interpolate(field, vars), `${pending.event.id}: ${field}`).not.toMatch(/\{\{/);
        }
        cards++;
        useGameStore.getState().resolveChainStep(pending.choiceIds[0]);
      }
    }
    expect(cards).toBeGreaterThan(0);
  });

  it('quotes on the card the number the tick will charge', () => {
    // The chain equivalent of the event test: catches the card being evaluated
    // a week early, or against the wrong chain's target.
    const wrong: string[] = [];
    let checked = 0;

    for (const target of ['rent-3', 'buy-2']) {
      useGameStore.getState().start('4F2A9C1B');
      for (let step = 0; step < 40; step++) {
        if (useGameStore.getState().run!.state.chains.length === 0) {
          useGameStore.getState().startChain('HOME_SEARCH', target);
        }
        useGameStore.getState().advanceTime();
        const pending = useGameStore.getState().pendingChainStep;
        if (pending === null) {
          const event = useGameStore.getState().pendingEvent;
          if (event !== null) useGameStore.getState().resolveEvent(event.choiceIds[0]);
          continue;
        }

        const { state, world } = useGameStore.getState().run!;
        const active = state.chains.find((c) => c.chainId === pending.chainId)!;
        const charged = pendingChainContext(state, world, active, pending.roll);

        for (const [key, spec] of Object.entries(pending.event.displayVars ?? {})) {
          checked++;
          const value = resolveMagnitude(spec.value, charged);
          const expected =
            spec.as === 'money'
              ? formatCents(Math.round(value))
              : value.toFixed(spec.precision ?? 0);
          if (pending.vars[key] !== expected) {
            wrong.push(
              `${target} w${state.weekIndex} ${pending.event.id}.${key}: card ${pending.vars[key]}, charged ${expected}`,
            );
          }
        }
        useGameStore.getState().resolveChainStep(pending.choiceIds[0]);
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });
});

/**
 * The path the suite had no coverage on, and the one that shipped broken:
 * tapping a panel control on a week that is holding a card.
 *
 * Both store actions used to call `tick` with no chooser, and `tick` falls back
 * to `available[0]` when nobody answers — so the tap resolved that week's event
 * or chain step with its first-listed choice and the player never saw it.
 */
describe('panel actions on a week that is holding a card', () => {
  beforeEach(() => {
    useGameStore.getState().start('4F2A9C1B');
  });

  /**
   * Walk to the week before this seed's first event slot, a week at a time so
   * we stop *short* of the card rather than with it already open. The store
   * refuses to start a search while a card is up, so the bug's scenario is the
   * tap that happens the week before one lands.
   */
  function walkToSlotEve(): number {
    const slotWeek = useGameStore.getState().run!.world.events.slots[0];
    useGameStore.getState().setGranularity('week');
    while (useGameStore.getState().run!.state.weekIndex < slotWeek - 1) {
      useGameStore.getState().advanceTime();
      expect(useGameStore.getState().pendingEvent).toBeNull();
    }
    return slotWeek;
  }

  it('starting a search does not consume the slot event waiting that week', () => {
    const slotWeek = walkToSlotEve();
    const before = useGameStore.getState().run!.state;

    useGameStore.getState().startChain('HOME_SEARCH', 'rent-2');
    const after = useGameStore.getState().run!.state;

    // No week passed, no event fired, nothing was answered on the player's behalf.
    expect(after.weekIndex).toBe(before.weekIndex);
    expect(after.eventHistory).toEqual(before.eventHistory);
    expect(after.decisionLog.filter((e) => e.t === 'event')).toEqual(
      before.decisionLog.filter((e) => e.t === 'event'),
    );
    expect(after.chains).toHaveLength(1);

    // And the event is still ahead of the player: advancing presents it.
    useGameStore.getState().advanceTime();
    expect(useGameStore.getState().pendingEvent).not.toBeNull();
    expect(useGameStore.getState().run!.state.weekIndex).toBe(slotWeek - 1);
  });

  it('starting a second search does not answer a step the first search has due', () => {
    useGameStore.getState().setGranularity('week');
    useGameStore.getState().startChain('JOB_SEARCH', 'retail-associate');
    const due = useGameStore.getState().run!.state.chains[0].dueWeek;
    while (useGameStore.getState().run!.state.weekIndex < due - 1) {
      useGameStore.getState().advanceTime();
    }

    const before = useGameStore.getState().run!.state;
    useGameStore.getState().startChain('HOME_SEARCH', 'rent-2');
    const after = useGameStore.getState().run!.state;

    expect(after.weekIndex).toBe(before.weekIndex);
    expect(after.decisionLog.filter((e) => e.t === 'chainStep')).toEqual([]);
    expect(after.chains.find((c) => c.chainId === 'JOB_SEARCH')!.stepId).toBe('prepare');
  });

  it('stopping a search does not consume the week either', () => {
    walkToSlotEve();
    useGameStore.getState().startChain('HOME_SEARCH', 'rent-2');
    const before = useGameStore.getState().run!.state;

    useGameStore.getState().abandonChain('HOME_SEARCH');
    const after = useGameStore.getState().run!.state;

    expect(after.weekIndex).toBe(before.weekIndex);
    expect(after.chains).toEqual([]);
    expect(after.eventHistory).toEqual(before.eventHistory);
  });
});
