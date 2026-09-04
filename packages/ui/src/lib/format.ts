/**
 * Display formatting. Pure functions, so they can be tested without a DOM.
 *
 * **No formatter here ever returns a sign-coloured or judged value.** Negative
 * money is rendered exactly like positive money; deciding what a number means is
 * the player's job, not the game's (GDD §1).
 */

export interface MoneyFormatOptions {
  /** Show the cents. Off by default — most figures read better rounded. */
  readonly cents?: boolean;
  /** Abbreviate past a thousand: $12.4k, $1.20M. */
  readonly compact?: boolean;
  /** Show a leading + on positive values, for deltas. */
  readonly signed?: boolean;
}

/** Format integer cents. Never accepts float dollars. */
export function formatCents(value: number, options: MoneyFormatOptions = {}): string {
  if (!Number.isFinite(value)) return '—';

  const negative = value < 0;
  const abs = Math.abs(value);
  const sign = negative ? '-' : options.signed ? '+' : '';

  if (options.compact === true && abs >= 100_000) {
    const dollars = abs / 100;
    if (dollars >= 1_000_000) return `${sign}$${(dollars / 1_000_000).toFixed(2)}M`;
    return `${sign}$${(dollars / 1_000).toFixed(1)}k`;
  }

  const dollars = options.cents === true ? abs / 100 : Math.round(abs / 100);
  return `${sign}$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: options.cents === true ? 2 : 0,
    maximumFractionDigits: options.cents === true ? 2 : 0,
  })}`;
}

export interface PctFormatOptions {
  readonly decimals?: number;
  readonly signed?: boolean;
}

/** Format a fraction as a percentage. `0.045` becomes `4.5%`. */
export function formatPct(value: number, options: PctFormatOptions = {}): string {
  if (!Number.isFinite(value)) return '—';
  const decimals = options.decimals ?? 1;
  const sign = value > 0 && options.signed === true ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

/**
 * The payoff projection, in months, or the word the design cares most about.
 *
 * "Never" is rendered in the same weight and colour as any other number. That
 * word does more teaching than any tooltip, and it does it by being stated
 * plainly rather than flagged as an alarm.
 */
export function formatPayoff(months: number | null): string {
  if (months === null) return 'Never';
  if (months < 1) return 'This month';
  const whole = Math.ceil(months);
  if (whole < 24) return `${whole} ${whole === 1 ? 'month' : 'months'}`;
  const years = Math.floor(whole / 12);
  const remainder = whole % 12;
  return remainder === 0 ? `${years} years` : `${years} yr ${remainder} mo`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
  return MONTH_NAMES[Math.min(Math.max(month, 0), 11)];
}

/** "Year 4, March" — the game's own calendar, never a real-world date. */
export function formatRunDate(yearIndex: number, month: number): string {
  return `Year ${yearIndex + 1}, ${monthName(month)}`;
}
