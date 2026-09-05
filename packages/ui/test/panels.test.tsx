import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  emptyAllocation,
  emptyBalanceSheetInput,
  balanceSheet,
  openCreditCard,
  chargeCard,
  closeStatement,
  openAmortizingLoan,
} from '@finme/engine';
import { DebtsPanel } from '@/panels/DebtsPanel';
import { AllocationPanel } from '@/panels/AllocationPanel';
import { BalanceSheetPanel } from '@/panels/BalanceSheetPanel';
import { LogbookPanel } from '@/panels/LogbookPanel';
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
      <AllocationPanel allocation={emptyAllocation()} energy={70} mood={60} onChange={() => {}} />,
    );

    const plus = screen.getAllByLabelText('One more point of Rest')[0];
    const minus = screen.getAllByLabelText('One less point of Rest')[0];
    // size-11 is 44px in Tailwind's 4px scale.
    expect(plus.className).toContain('size-11');
    expect(minus.className).toContain('size-11');

    // Nothing draggable anywhere.
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it('shows the week budget and the projected cost of the split', () => {
    render(
      <AllocationPanel
        allocation={{ ...emptyAllocation(), work: 'full-time', rest: 3 }}
        energy={70}
        mood={60}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('8 of 10 points')).toBeDefined();
    expect(screen.getAllByText('Energy after this week').length).toBeGreaterThan(0);
  });

  it('disables the minus stepper at zero rather than allowing negatives', () => {
    render(<AllocationPanel allocation={emptyAllocation()} energy={70} mood={60} onChange={() => {}} />);
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
