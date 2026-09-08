import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  HOME_PRICE_TO_RENT,
  HOUSING_TIER_RENT_CENTS,
  emptyAllocation,
  emptyBalanceSheetInput,
  balanceSheet,
  openCreditCard,
  chargeCard,
  closeStatement,
  openAmortizingLoan,
  beginChain,
  tierRentCents,
} from '@finme/engine';
import { createScenarioRun } from '@finme/content';
import { formatCents } from '@/lib/format';
import { DebtsPanel } from '@/panels/DebtsPanel';
import { AllocationPanel } from '@/panels/AllocationPanel';
import { BalanceSheetPanel } from '@/panels/BalanceSheetPanel';
import { LogbookPanel } from '@/panels/LogbookPanel';
import { HousingPanel } from '@/panels/HousingPanel';
import { JobsPanel } from '@/panels/JobsPanel';
import { Term } from '@/components/finme/Term';
import { Money } from '@/components/finme/Money';

/** A card carrying a balance, with the grace period broken. */
function carryingCard() {
  const card = openCreditCard({ id: 'card', creditLimitCents: 5_000_000, openedWeek: 0 });
  return closeStatement(chargeCard(card, 4_000_000)!, 0).card;
}

/**
 * A fixed payment below the monthly interest — the only way "Never" arises.
 * §5.1's minimum is 2% of balance *plus* interest, so it always clears eventually.
 */
const payingTooLittle = () => 30_000;

describe('the Debts panel (BUILD-PLAN Part 2b)', () => {
  it('renders the payoff projection in both the card list and the table', () => {
    // The panel where the game does its most important teaching cannot be the
    // one that degrades worst, so both layouts carry the projection.
    const { container } = render(
      <DebtsPanel debts={[carryingCard()]} paymentFor={payingTooLittle} />,
    );

    // Queried by role and slot rather than tag name, so swapping the markup
    // for shadcn primitives cannot silently make this vacuous.
    const cardList = container.querySelector('[data-slot="item-group"]');
    const table = container.querySelector('table');
    expect(cardList).not.toBeNull();
    expect(table).not.toBeNull();

    expect(within(cardList as HTMLElement).getByText('Never')).toBeDefined();
    expect(within(table as HTMLElement).getByText('Never')).toBeDefined();
  });

  it('renders "Never" with no destructive styling of any kind', () => {
    // GDD §1: `destructive` is reserved for destructive *user actions*. The
    // single most educational word in the game is styled like any other number.
    const { container } = render(
      <DebtsPanel debts={[carryingCard()]} paymentFor={payingTooLittle} />,
    );

    for (const node of screen.getAllByText('Never')) {
      const classes = `${node.className} ${(node.parentElement?.className ?? '')}`;
      expect(classes).not.toMatch(/destructive|text-red|bg-red|danger|warning/);
    }
    // And nothing anywhere in the panel is destructive-styled.
    expect(container.innerHTML).not.toMatch(/destructive|text-red-|bg-red-/);
  });

  it('applies no sign colouring to any figure', () => {
    const loan = openAmortizingLoan({
      id: 'auto',
      loanType: 'auto',
      principalCents: 2_000_000,
      aprAnnual: 0.086,
      termMonths: 60,
      openedWeek: 0,
    });
    const { container } = render(<DebtsPanel debts={[carryingCard(), loan]} />);
    for (const money of container.querySelectorAll('[data-slot="money"]')) {
      expect(money.className).toContain('tabular-nums');
      expect(money.className).not.toMatch(/red|green|destructive|success|danger/);
    }
  });

  it('never shows "Never" for a card being paid its minimum', () => {
    // §5.1's minimum is 2% of the balance *plus* the interest, so it always
    // touches principal. Showing the minimum's projection everywhere would hide
    // the case the panel exists to teach; the panel uses the actual payment.
    render(<DebtsPanel debts={[carryingCard()]} />);
    expect(screen.queryByText('Never')).toBeNull();
  });

  it('says so plainly when nothing is owed', () => {
    render(<DebtsPanel debts={[]} />);
    expect(screen.getByText('Nothing owed.')).toBeDefined();
  });
});

describe('the allocation panel', () => {
  it('uses +/- steppers with 44px targets, not drag-and-drop', () => {
    const { container } = render(
      <AllocationPanel
        allocation={emptyAllocation()}
        energy={70}
        mood={60}
        housingTier={1}
        onChange={() => {}}
      />,
    );

    const plus = screen.getAllByLabelText('One more point of Rest')[0];
    const minus = screen.getAllByLabelText('One less point of Rest')[0];
    // The visible circle is 36px (size-9), but the touch target is still 44px:
    // `after:size-11` is a centred pseudo-element that extends the hit area past
    // the circle's edge. Assert the target explicitly — a bare `size-11` check
    // passes on the `after:` prefix alone and would not catch losing it.
    for (const stepper of [plus, minus]) {
      expect(stepper.className).toContain('after:size-11');
      expect(stepper.className).toContain('size-9');
    }

    // Nothing draggable anywhere.
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it('shows the week budget and the projected cost of the split', () => {
    render(
      <AllocationPanel
        allocation={{ ...emptyAllocation(), work: 'full-time', rest: 3 }}
        energy={70}
        mood={60}
        housingTier={1}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('8 of 10 points')).toBeDefined();
    // The projection is a labelled footer group now, so the meters read "Energy"
    // and "Mood" under one "After this week" heading rather than repeating it.
    expect(screen.getByText('After this week')).toBeDefined();
    expect(screen.getAllByText('Energy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mood').length).toBeGreaterThan(0);
  });

  it('disables the minus stepper at zero rather than allowing negatives', () => {
    render(
      <AllocationPanel
        allocation={emptyAllocation()}
        energy={70}
        mood={60}
        housingTier={1}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByLabelText('One less point of Rest')[0]).toHaveProperty('disabled', true);
  });
});

describe('the balance sheet', () => {
  it('renders a negative net worth exactly like a positive one', () => {
    const negative = balanceSheet({ ...emptyBalanceSheetInput(), accruedUnpaidBillsCents: 500_000 });
    const { container } = render(<BalanceSheetPanel sheet={negative} />);

    const figures = container.querySelectorAll('[data-slot="money"]');
    expect(figures.length).toBeGreaterThan(0);
    for (const figure of figures) {
      expect(figure.className).not.toMatch(/destructive|red/);
    }
    expect(screen.getByText('-$5,000')).toBeDefined();
  });
});

describe('the Term component (GDD §7, resolved in BUILD-PLAN Part 2b)', () => {
  it('is a tappable button, never a title attribute', () => {
    // Phones have no hover. A `title` attribute would make the glossary
    // invisible to the primary audience.
    const { container } = render(<Term id="apr" />);
    const trigger = container.querySelector('[data-slot="term"]');

    expect(trigger).not.toBeNull();
    expect(trigger?.tagName).toBe('BUTTON');
    expect(trigger?.getAttribute('title')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('carries a dotted underline and a 44px touch target', () => {
    const { container } = render(<Term id="apr" />);
    const trigger = container.querySelector('[data-slot="term"]') as HTMLElement;
    expect(trigger.className).toContain('border-dotted');
    expect(trigger.className).toContain('after:h-11');
  });

  it('renders its text even for an unknown term', () => {
    render(<Term id="not-a-real-term">inflation</Term>);
    expect(screen.getByText('inflation')).toBeDefined();
  });

  it('uses the glossary label when no children are given', () => {
    render(<Term id="net-worth" />);
    expect(screen.getByText('net worth')).toBeDefined();
  });
});

describe('shared figures', () => {
  it('renders every currency figure with tabular-nums', () => {
    const { container } = render(<Money amountCents={123_456} />);
    expect(container.querySelector('[data-slot="money"]')?.className).toContain('tabular-nums');
  });
});

describe('the Logbook panel', () => {
  it('lists entries newest first with no icons or severity', () => {
    const { container } = render(
      <LogbookPanel
        entries={[
          { weekIndex: 4, key: 'a', variantIndex: 0, text: 'The first thing.', trigger: { k: 'quiet' } },
          { weekIndex: 60, key: 'b', variantIndex: 0, text: 'The later thing.', trigger: { k: 'quiet' } },
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('The later thing.')).toBeLessThan(text.indexOf('The first thing.'));
    expect(container.innerHTML).not.toMatch(/destructive|text-red|✓|✔/);
  });
});

/**
 * The Jobs and Housing panels are where the game first asks the player to
 * choose between options that cost real money, so they are the easiest place
 * to accidentally start ranking things.
 */
describe('the Jobs panel', () => {
  const run = () => createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });

  it('gives every listing the same button, in the same variant', () => {
    // GDD §1: nothing may mark one job as the one to take.
    const { world, state } = run();
    const { container } = render(
      <JobsPanel state={state} world={world} onApply={() => {}} onStopLooking={() => {}} />,
    );

    const buttons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Apply',
    );
    expect(buttons.length).toBeGreaterThan(0);
    const variants = new Set(buttons.map((button) => button.className));
    expect(variants.size).toBe(1);
  });

  it('keeps every touch target at 44px', () => {
    const { world, state } = run();
    const { container } = render(
      <JobsPanel state={state} world={world} onApply={() => {}} onStopLooking={() => {}} />,
    );
    for (const button of container.querySelectorAll('button')) {
      expect(button.className).toMatch(/min-h-11|size-11|after:size-11|\bh-11\b/);
    }
  });

  it('states a requirement as a fact, never as a judgement about the player', () => {
    const { world, state } = run();
    // No education or experience, and no car: every gated role shows a reason.
    const { container } = render(
      <JobsPanel state={state} world={world} onApply={() => {}} onStopLooking={() => {}} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/unqualified|not good enough|too junior|you should/i);
  });

  it('carries no destructive styling on any figure', () => {
    const { world, state } = run();
    const { container } = render(
      <JobsPanel state={state} world={world} onApply={() => {}} onStopLooking={() => {}} />,
    );
    for (const node of container.querySelectorAll('[data-slot="money"], [data-slot="pct"]')) {
      const classes = `${node.className} ${node.parentElement?.className ?? ''}`;
      expect(classes).not.toMatch(/destructive|text-red|bg-red|danger|warning/);
    }
  });

  it('shows the search in progress once one is running', () => {
    const base = run();
    const started = beginChain(base.world, base.streams, base.state, 'JOB_SEARCH', 'retail-associate').state;

    render(
      <JobsPanel
        state={started}
        world={base.world}
        onApply={() => {}}
        onStopLooking={() => {}}
      />,
    );
    expect(screen.getByText('You are looking')).toBeDefined();
    expect(screen.getByText('Stop looking')).toBeDefined();
  });
});

describe('the Housing panel', () => {
  const run = () => createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });

  it('offers renting and buying with the same control and no commentary', () => {
    const { world, state } = run();
    const { container } = render(
      <HousingPanel state={state} world={world} onLook={() => {}} onStopLooking={() => {}} />,
    );

    expect(screen.getByText('Renting')).toBeDefined();
    expect(screen.getByText('Buying')).toBeDefined();

    const looks = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Look',
    );
    // Every tier is available to rent; buying starts at tier 1, because a room
    // in a shared flat is not something anyone buys.
    expect(looks.length).toBe(HOUSING_TIER_RENT_CENTS.length * 2 - 1);
    expect(new Set(looks.map((button) => button.className)).size).toBe(1);
  });

  it('prices a home off the rent it replaces, per §8.2', () => {
    // The two numbers must be the same number seen twice, or the buy-vs-rent
    // comparison stops teaching the right thing.
    const { world, state } = run();
    const cpi = world.market.inflation.cpi[0];
    render(<HousingPanel state={state} world={world} onLook={() => {}} onStopLooking={() => {}} />);

    const tier = 2;
    const price = Math.round(tierRentCents(tier) * cpi * 12 * HOME_PRICE_TO_RENT);
    expect(screen.getAllByText(formatCents(price)).length).toBeGreaterThan(0);
  });

  it('carries no destructive styling on any figure', () => {
    const { world, state } = run();
    const { container } = render(
      <HousingPanel state={state} world={world} onLook={() => {}} onStopLooking={() => {}} />,
    );
    for (const node of container.querySelectorAll('[data-slot="money"], [data-slot="pct"]')) {
      const classes = `${node.className} ${node.parentElement?.className ?? ''}`;
      expect(classes).not.toMatch(/destructive|text-red|bg-red|danger|warning/);
    }
  });

  it('keeps every touch target at 44px', () => {
    const { world, state } = run();
    const { container } = render(
      <HousingPanel state={state} world={world} onLook={() => {}} onStopLooking={() => {}} />,
    );
    for (const button of container.querySelectorAll('button')) {
      expect(button.className).toMatch(/min-h-11|size-11|after:size-11|\bh-11\b/);
    }
  });
});
