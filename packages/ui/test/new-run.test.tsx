import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SEED_ALPHABET, isValidSeed } from '@finme/engine';
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
