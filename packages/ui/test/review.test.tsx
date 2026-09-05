import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AnnualSnapshot, LogbookEntry } from '@finme/engine';
import { AnnualReviewPanel } from '@/panels/AnnualReviewPanel';
import { LogbookPanel } from '@/panels/LogbookPanel';

const snapshot = (partial: Partial<AnnualSnapshot> & Pick<AnnualSnapshot, 'year'>): AnnualSnapshot => ({
  age: 22 + partial.year,
  cpi: 1 + 0.02 * partial.year,
  assetsCents: 1_000_000,
  liabilitiesCents: 0,
  netWorthCents: 1_000_000,
  incomeCents: 3_900_000,
  taxPaidCents: 280_000,
  interestPaidCents: 0,
  retirementContributedCents: 0,
  employerMatchedCents: 0,
  matchForgoneCents: 0,
  cashCents: 500_000,
  investedCents: 0,
  ...partial,
});

describe('the annual review (GDD §4.2)', () => {
  const years = [1, 2, 3].map((year) =>
    snapshot({ year, netWorthCents: 1_000_000 * year, matchForgoneCents: 156_000 }),
  );

  it('carries no grade, rank, or percentage of optimal', () => {
    // The comparison-to-optimal-play scoring was removed from the design. The
    // player is compared to their own past and to nothing else.
    const { container } = render(<AnnualReviewPanel snapshots={years} />);
    const text = container.textContent ?? '';

    for (const banned of ['grade', 'rank', 'optimal', 'score', 'rating', 'A+', 'percentile of']) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    expect(container.innerHTML).not.toMatch(/destructive|text-red|text-green|✓|✔|★/);
  });

  it('shows every prior year, not just the latest', () => {
    render(<AnnualReviewPanel snapshots={years} />);
    for (const year of years) {
      expect(screen.getByText(`Y${year.year}`)).toBeDefined();
    }
  });

  it('pins the first column so the row label survives a 390px screen', () => {
    const { container } = render(<AnnualReviewPanel snapshots={years} />);
    const rowHeaders = container.querySelectorAll('tbody th');

    expect(rowHeaders.length).toBeGreaterThan(0);
    for (const header of rowHeaders) {
      expect(header.className).toContain('sticky');
      expect(header.className).toContain('left-0');
    }
    // And the table scrolls rather than compressing.
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
    expect(container.querySelector('table')?.className).toContain('min-w-max');
  });

  it('states nominal and real on every figure', () => {
    const { container } = render(<AnnualReviewPanel snapshots={years} />);
    const cells = container.querySelectorAll('tbody td');
    for (const cell of cells) {
      // Two figures per cell: nominal above, real below.
      expect(cell.querySelectorAll('[data-slot="money"]').length).toBe(2);
    }
    expect(screen.getByText(/Upper figure/)).toBeDefined();
  });

  it('states counterfactuals as arithmetic, with no adjective or verdict', () => {
    render(<AnnualReviewPanel snapshots={years} />);
    // Scope to the whole card, not the title's parent — the title lives in
    // CardHeader and the lines live in CardContent.
    const section = screen.getByText('The arithmetic').closest('[data-slot="card"]')!;
    const text = section.textContent ?? '';

    expect(text).toContain('employer match');
    expect(text).toContain('did not take');
    // No verdict language anywhere in the counterfactual.
    for (const banned of ['should', 'mistake', 'wisely', 'better', 'worse', 'unfortunately']) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });

  it('says when there is nothing to review yet', () => {
    render(<AnnualReviewPanel snapshots={[]} />);
    expect(screen.getByText(/first review arrives/)).toBeDefined();
  });
});

describe('the Logbook with reviews pinned inline', () => {
  const entries: LogbookEntry[] = [
    { weekIndex: 10, key: 'a', variantIndex: 0, text: 'Early on.', trigger: { k: 'quiet' } },
    { weekIndex: 100, key: 'b', variantIndex: 0, text: 'Later.', trigger: { k: 'quiet' } },
  ];

  it('interleaves annual reviews with entries, newest first', () => {
    const { container } = render(
      <LogbookPanel entries={entries} snapshots={[snapshot({ year: 1 })]} />,
    );
    // Week 100 entry, then the year-1 review at week 52, then the week-10
    // entry. Asserted by reading order rather than by element type, so the
    // markup can change without the ordering guarantee going untested.
    const text = container.textContent ?? '';
    const later = text.indexOf('Later.');
    const review = text.indexOf('Annual review');
    const early = text.indexOf('Early on.');

    expect(later).toBeGreaterThanOrEqual(0);
    expect(review).toBeGreaterThan(later);
    expect(early).toBeGreaterThan(review);
  });

  it('opens a review on demand, as §4.2 requires', () => {
    render(<LogbookPanel entries={entries} snapshots={[snapshot({ year: 1 })]} />);
    const toggle = screen.getByRole('button', { name: /Annual review/ });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.className).toContain('min-h-11');
  });

  it('keeps the Logbook free of severity styling', () => {
    const { container } = render(
      <LogbookPanel entries={entries} snapshots={[snapshot({ year: 1 })]} />,
    );
    expect(container.innerHTML).not.toMatch(/destructive|text-red|text-green|✓|✔/);
  });
});
