import { describe, expect, it } from 'vitest';
import { formatCents, formatPayoff, formatPct, formatRunDate } from '../src/lib/format.ts';

describe('money formatting', () => {
  it('renders integer cents as dollars', () => {
    expect(formatCents(0)).toBe('$0');
    expect(formatCents(123_456)).toBe('$1,235');
    expect(formatCents(123_456, { cents: true })).toBe('$1,234.56');
  });

  it('renders negative money exactly like positive money', () => {
    // GDD §1: red-for-negative is a judgement, and this game does not judge.
    // The formatter carries no colour, no parentheses, no marker of any kind.
    expect(formatCents(-123_456)).toBe('-$1,235');
    expect(formatCents(-123_456).replace('-', '')).toBe(formatCents(123_456));
  });

  it('signs deltas only when asked', () => {
    expect(formatCents(5_000, { signed: true })).toBe('+$50');
    expect(formatCents(5_000)).toBe('$50');
    expect(formatCents(-5_000, { signed: true })).toBe('-$50');
  });

  it('abbreviates large figures', () => {
    expect(formatCents(1_240_000, { compact: true })).toBe('$12.4k');
    expect(formatCents(320_000_000, { compact: true })).toBe('$3.20M');
    // Small figures stay exact.
    expect(formatCents(9_900, { compact: true })).toBe('$99');
  });

  it('renders a non-finite figure as a dash rather than NaN', () => {
    expect(formatCents(Number.NaN)).toBe('—');
    expect(formatCents(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('percentage formatting', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatPct(0.045)).toBe('4.5%');
    expect(formatPct(0.24, { decimals: 0 })).toBe('24%');
    expect(formatPct(-0.031)).toBe('-3.1%');
    expect(formatPct(0.031, { signed: true })).toBe('+3.1%');
  });
});

describe('the payoff projection', () => {
  it('says "Never" when the debt never clears', () => {
    // The single most educational word in the game. It is a plain string with
    // no marker, so it renders in the same weight and colour as any number.
    expect(formatPayoff(null)).toBe('Never');
  });

  it('reads naturally at every scale', () => {
    expect(formatPayoff(0.4)).toBe('This month');
    expect(formatPayoff(1)).toBe('1 month');
    expect(formatPayoff(7.2)).toBe('8 months');
    expect(formatPayoff(23)).toBe('23 months');
    expect(formatPayoff(24)).toBe('2 years');
    expect(formatPayoff(31)).toBe('2 yr 7 mo');
  });
});

describe('run dates', () => {
  it('uses the game calendar, never a real-world date', () => {
    expect(formatRunDate(0, 0)).toBe('Year 1, January');
    expect(formatRunDate(3, 11)).toBe('Year 4, December');
  });
});
