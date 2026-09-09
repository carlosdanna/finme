import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SEED_ALPHABET, isValidSeed } from '@finme/engine';
import { DEFAULT_ALLOCATION, STARTS, assignedStartId } from '@finme/content';
import {
  allocationPoints,
  availableTimePoints,
  isValidAllocation,
  nextEnergy,
  nextMood,
  tick,
} from '@finme/engine';
import { normalizeSeedInput, randomSeed } from '@/lib/seed';
import { NewRunPanel } from '@/panels/NewRunPanel';
import { defaultSetup, useGameStore } from '@/store/useGameStore';

describe('seed generation (TDD §2.3)', () => {
  it('mints seeds the engine validator accepts', () => {
    // The generator and the validator live in different packages; they share
    // the alphabet constant so they cannot drift.
    for (let attempt = 0; attempt < 200; attempt++) {
      const seed = randomSeed();
      expect(seed).toHaveLength(8);
      expect(isValidSeed(seed)).toBe(true);
    }
  });

  it('draws every character of the alphabet and nothing outside it', () => {
    const seen = new Set([...Array.from({ length: 400 }, () => randomSeed()).join('')]);
    expect([...seen].every((character) => SEED_ALPHABET.includes(character))).toBe(true);
    // A generator stuck on a subset would still pass the validator above.
    expect(seen.size).toBe(SEED_ALPHABET.length);
  });
});

describe('seed input cleanup', () => {
  it('accepts the form a seed is shared in', () => {
    expect(normalizeSeedInput('4F2A9C1B/v0.5.0')).toBe('4F2A9C1B');
    expect(normalizeSeedInput('  4f2a9c1b/V0.5.0  ')).toBe('4F2A9C1B');
  });

  it('survives the ways a seed gets written down', () => {
    expect(normalizeSeedInput('4f2a9c1b')).toBe('4F2A9C1B');
    expect(normalizeSeedInput('4F2A-9C1B')).toBe('4F2A9C1B');
    expect(normalizeSeedInput('4F2A 9C1B')).toBe('4F2A9C1B');
  });

  it('applies Crockford decode aliases rather than dropping the letters', () => {
    expect(normalizeSeedInput('IO')).toBe('10');
    expect(normalizeSeedInput('LOL')).toBe('101');
    // U has no digit behind it; it is excluded for a different reason.
    expect(normalizeSeedInput('4U2')).toBe('42');
  });

  it('never returns something the validator would reject', () => {
    for (const raw of ['4F2A-9C1B', 'hello world', '!!!', 'iou', '4f2a9c1b/v9.9.9']) {
      const cleaned = normalizeSeedInput(raw);
      if (cleaned !== '') expect(isValidSeed(cleaned), raw).toBe(true);
    }
  });
});

describe('the new-run screen', () => {
  it('opens on a rerollable seed rather than a fixed one', () => {
    // A screen that opened on a constant would be the auto-start bug in a form.
    const { unmount } = render(<NewRunPanel onBegin={() => {}} />);
    const first = (screen.getByLabelText('Seed') as HTMLInputElement).value;
    unmount();

    render(<NewRunPanel onBegin={() => {}} />);
    const second = (screen.getByLabelText('Seed') as HTMLInputElement).value;

    expect(isValidSeed(first)).toBe(true);
    expect(isValidSeed(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('rerolls to a different seed', () => {
    render(<NewRunPanel onBegin={() => {}} />);
    const field = screen.getByLabelText('Seed') as HTMLInputElement;
    const before = field.value;

    fireEvent.click(screen.getByLabelText('Reroll the seed'));
    expect(field.value).not.toBe(before);
    expect(isValidSeed(field.value)).toBe(true);
  });

  it('hands back exactly what the player set', () => {
    const onBegin = vi.fn();
    render(<NewRunPanel onBegin={onBegin} />);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Rosa' } });
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '4f2a-9c1b' } });
    fireEvent.click(screen.getByRole('button', { name: '50 yr' }));
    fireEvent.click(screen.getByLabelText('One year older'));
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));

    expect(onBegin).toHaveBeenCalledWith({
      seed: '4F2A9C1B',
      playerName: 'Rosa',
      runLengthYears: 50,
      startAge: 23,
      chosenStartId: null,
    });
  });

  it('will not begin a run on a seed that is not one', () => {
    const onBegin = vi.fn();
    render(<NewRunPanel onBegin={onBegin} />);

    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));

    expect(onBegin).not.toHaveBeenCalled();
  });

  it('holds the age inside its bounds', () => {
    render(<NewRunPanel onBegin={() => {}} />);
    const younger = screen.getByLabelText('One year younger');

    for (let press = 0; press < 12; press++) fireEvent.click(younger);
    expect(screen.getByText('18')).toBeDefined();
    expect((younger as HTMLButtonElement).disabled).toBe(true);
  });

  it('says nothing about which choice is the better one', () => {
    // Against the copy, not the markup: the vendored `Input` carries its own
    // `aria-invalid:border-destructive`, which is validation, not a judgement.
    // Our source is swept for classes by `shadcn-usage.test.ts`.
    const { container } = render(<NewRunPanel onBegin={() => {}} />);
    expect(container.textContent).not.toMatch(
      /recommended|suggested|best|optimal|easier|harder|safer|riskier|should/i,
    );
  });
});

/**
 * GDD §3.7: the player is dealt a start, not offered one, and the game does not
 * editorialize about which start is harder. The list is therefore a statement,
 * and every row of it looks the same.
 */
describe('the six starting positions', () => {
  const rows = (container: HTMLElement) =>
    [...container.querySelectorAll('li > div, li > button')] as HTMLElement[];

  it('lists all six in declaration order', () => {
    const { container } = render(<NewRunPanel onBegin={() => {}} />);
    expect(rows(container).length).toBe(STARTS.length);
    for (const start of STARTS) expect(screen.getByText(start.label)).toBeDefined();
  });

  it('gives every option identical styling, and no destructive class anywhere', () => {
    const { container } = render(<NewRunPanel onBegin={() => {}} />);
    const classNames = rows(container).map((row) =>
      row.className.replace(/\s*ring-2 ring-ring/, '').trim(),
    );
    expect(new Set(classNames).size).toBe(1);
    // Scoped to the rows: the vendored `Input` and `Switch` carry their own
    // `aria-invalid:border-destructive`, which is validation, not a judgement.
    for (const row of rows(container)) expect(row.outerHTML).not.toMatch(/destructive/);
  });

  it('marks the one the seed dealt, and nothing else', () => {
    const { container } = render(<NewRunPanel onBegin={() => {}} />);
    const seed = (screen.getByLabelText('Seed') as HTMLInputElement).value;
    const marked = rows(container).filter((row) => row.getAttribute('aria-current') === 'true');
    expect(marked.length).toBe(1);
    expect(marked[0].textContent).toContain(
      STARTS.find((start) => start.id === assignedStartId(seed))!.label,
    );
  });

  it('deals a different start when the seed is rerolled to one that has another', () => {
    render(<NewRunPanel onBegin={() => {}} />);
    const field = screen.getByLabelText('Seed') as HTMLInputElement;

    fireEvent.change(field, { target: { value: '4F2A9C1B' } });
    const first = screen.getAllByText('This seed').length;
    expect(first).toBe(1);

    // Two seeds that §3.7 deals different rows to; the screen must follow.
    const seeds = ['4F2A9C1B', '4F2A9C1C', 'QUIET1', 'ZZZZ0001', 'ABCDEFGH'];
    const dealt = new Set(
      seeds.map((seed) => {
        fireEvent.change(field, { target: { value: seed } });
        return screen
          .getAllByRole('listitem')
          .find((row) => row.textContent?.includes('This seed'))!.textContent;
      }),
    );
    expect(dealt.size).toBeGreaterThan(1);
  });

  it('is a statement until the player asks to choose, and a control after', () => {
    const { container } = render(<NewRunPanel onBegin={() => {}} />);
    expect(container.querySelectorAll('li > button').length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'I choose' }));
    expect(container.querySelectorAll('li > button').length).toBe(STARTS.length);
  });

  it('hands back the chosen start, and null when the seed is deciding', () => {
    const onBegin = vi.fn();
    render(<NewRunPanel onBegin={onBegin} />);
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '4F2A9C1B' } });

    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    expect(onBegin.mock.calls[0][0].chosenStartId).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'I choose' }));
    const other = STARTS.find((start) => start.id !== assignedStartId('4F2A9C1B'))!;
    fireEvent.click(screen.getByText(other.label));
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    expect(onBegin.mock.calls[1][0].chosenStartId).toBe(other.id);
  });

  it('states the non-comparability as a fact about the run, not a warning', () => {
    const { container } = render(<NewRunPanel onBegin={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'I choose' }));
    expect(container.textContent).toMatch(/not comparable/i);
    expect(container.textContent).not.toMatch(/warning|cheat|invalid|unfair|careful/i);
  });
});

describe('the start reaches the run', () => {
  it('deals the seed\'s start when the player did not choose', () => {
    useGameStore.getState().start(defaultSetup('4F2A9C1B'));
    expect(useGameStore.getState().run!.state.startId).toBe(assignedStartId('4F2A9C1B'));
  });

  it('carries a chosen start through instead', () => {
    const chosen = STARTS.find((start) => start.id !== assignedStartId('4F2A9C1B'))!;
    useGameStore.getState().start({ ...defaultSetup('4F2A9C1B'), chosenStartId: chosen.id });

    const state = useGameStore.getState().run!.state;
    expect(state.startId).toBe(chosen.id);
    // Which is exactly how the run is known to be non-comparable — no flag.
    expect(state.startId).not.toBe(assignedStartId(state.seed));
  });
});

/**
 * The clamp binds `tick`, and the screen has to agree with it. A panel that
 * projects a mood the tick will not produce is worse than no projection: the
 * panel's whole job is to say what next week looks like.
 */
describe('a start that commits time reaches the screen too', () => {
  // Dealt caregiver by the hash — no hand-picking, and if that ever stops being
  // true `starts.test.ts`'s seed→start literal fails first and says so.
  const CAREGIVER_SEED = 'QUIET1';

  it('opens on an allocation that fits the run\'s budget, not the flat ten', () => {
    useGameStore.getState().start(defaultSetup(CAREGIVER_SEED));
    const { run, allocation } = useGameStore.getState();

    expect(run!.state.committedTimePoints).toBe(2);
    expect(allocationPoints(allocation)).toBe(availableTimePoints(2));
    expect(isValidAllocation(allocation, run!.state.committedTimePoints)).toBe(true);
  });

  it('projects the mood and energy the tick actually produces', () => {
    useGameStore.getState().start(defaultSetup(CAREGIVER_SEED));
    const { run, allocation } = useGameStore.getState();
    const state = run!.state;

    // What the panel renders, computed exactly as AllocationPanel does.
    const projectedEnergy = nextEnergy(state.energy, state.mood, allocation);
    const projectedMood = nextMood(state.mood, allocation, {
      discretionarySpendCents: 0,
      discretionaryBaselineCents: 40_000,
      housingTier: state.housingTier,
      unsecuredDebtCents: 0,
      annualGrossCents: 0,
    });

    // What the week actually does with it.
    const after = tick(run!.world, run!.streams, state, { allocation }).state;

    expect(projectedEnergy).toBe(after.energy);
    expect(projectedMood).toBe(after.mood);
  });

  it('never lets an over-budget allocation into the store', () => {
    useGameStore.getState().start(defaultSetup(CAREGIVER_SEED));
    // The flat ten-point week, pushed in past the panel's own arithmetic.
    useGameStore.getState().setAllocation(DEFAULT_ALLOCATION);

    const { run, allocation } = useGameStore.getState();
    expect(allocationPoints(allocation)).toBeLessThanOrEqual(availableTimePoints(2));
    expect(isValidAllocation(allocation, run!.state.committedTimePoints)).toBe(true);
  });

  it('leaves a run that commits nothing on the full ten', () => {
    // The regression guard in the other direction: this must not quietly shrink
    // every other run's week.
    useGameStore.getState().start(defaultSetup('4F2A9C1B'));
    const { run, allocation } = useGameStore.getState();
    expect(run!.state.committedTimePoints).toBe(0);
    expect(allocation).toEqual(DEFAULT_ALLOCATION);
  });
});

describe('the setup reaches the run', () => {
  it('carries the name, length and age into engine state', () => {
    useGameStore.getState().start({
      ...defaultSetup('4F2A9C1B'),
      playerName: 'Rosa',
      runLengthYears: 10,
      startAge: 30,
    });

    const state = useGameStore.getState().run!.state;
    expect(state.playerName).toBe('Rosa');
    expect(state.runLengthYears).toBe(10);
    expect(state.startAge).toBe(30);
    // The run length sizes the pre-drawn world, not just the label.
    expect(useGameStore.getState().run!.world.market.runLengthYears).toBe(10);
  });
});
