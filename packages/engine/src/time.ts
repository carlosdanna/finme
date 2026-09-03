/**
 * Time and the 4-4-5 calendar — TDD §1.
 *
 * `weekIndex` is the only source of truth for time. Age, month, year and quarter
 * are all derived here; nothing anywhere else may store a second representation.
 *
 * Everything in this file is marked [F] in the TDD. Changing the calendar shape
 * changes what every existing seed produces, so it needs a ruleset version bump
 * and a DECISIONS.md entry in the same commit.
 */

/** [F] A game year is exactly 52 weeks. Not 52.18, not 365/7. */
export const WEEKS_PER_YEAR = 52;

export const MONTHS_PER_YEAR = 12;

/**
 * [F] Weeks per month, Jan..Dec, in a repeating 4-4-5 pattern per quarter
 * (13 weeks × 4 quarters = 52).
 *
 * Months are deliberately unequal. A 5-week month has 25% more weekly paychecks
 * against the same fixed rent — that is the point, and it is visible in the cash
 * flow view. Do not "fix" it by averaging.
 */
export const MONTH_LENGTHS: readonly number[] = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];

/**
 * [F] The week-of-year each month starts on: [0,4,8, 13,17,21, 26,30,34, 39,43,47].
 * Derived from MONTH_LENGTHS rather than written out, so the two can never drift
 * apart — the test asserts it matches the table published in TDD §1.2.
 */
export const MONTH_START_WEEK: readonly number[] = cumulativeStarts(MONTH_LENGTHS);

function cumulativeStarts(lengths: readonly number[]): readonly number[] {
  const starts: number[] = [];
  let week = 0;
  for (const length of lengths) {
    starts.push(week);
    week += length;
  }
  return starts;
}

/** [F] Quarters are 13 weeks each. */
export const QUARTER_START_WEEK: readonly number[] = [0, 13, 26, 39];

export const WEEKS_PER_QUARTER = 13;

/** Total weeks in a run of `runLengthYears` years. */
export function totalWeeks(runLengthYears: number): number {
  return runLengthYears * WEEKS_PER_YEAR;
}

/** Completed years since the run began. */
export function yearIndex(weekIndex: number): number {
  return Math.floor(weekIndex / WEEKS_PER_YEAR);
}

/** Position within the current game year, 0..51. */
export function weekOfYear(weekIndex: number): number {
  return weekIndex % WEEKS_PER_YEAR;
}

/** The player's age. Derived — never stored. */
export function age(weekIndex: number, startAge: number): number {
  return startAge + yearIndex(weekIndex);
}

/**
 * Month of the year, 0 = January .. 11 = December: the largest m where
 * MONTH_START_WEEK[m] <= weekOfYear.
 *
 * Accepts either a `weekOfYear` or a raw `weekIndex` — it normalizes into the
 * year itself, the same way `isMonthBoundary` does.
 */
export function monthOfYear(week: number): number {
  const w = week % WEEKS_PER_YEAR;
  for (let m = MONTHS_PER_YEAR - 1; m > 0; m--) {
    if (MONTH_START_WEEK[m] <= w) return m;
  }
  return 0;
}

/** Quarter of the year, 0..3. */
export function quarterOfYear(week: number): number {
  return Math.floor((week % WEEKS_PER_YEAR) / WEEKS_PER_QUARTER);
}

/** How many weeks the given month runs for — 4 or 5. */
export function weeksInMonth(month: number): number {
  return MONTH_LENGTHS[month];
}

/**
 * Position within the current month, 0-based. 0..3 in a 4-week month,
 * 0..4 in a 5-week month.
 */
export function weekOfMonth(week: number): number {
  const w = week % WEEKS_PER_YEAR;
  return w - MONTH_START_WEEK[monthOfYear(w)];
}

/**
 * True on the first week of a month — including week 0 of the run, which is the
 * first week of January. Fires exactly 12 times per year.
 */
export function isMonthBoundary(weekIndex: number): boolean {
  return MONTH_START_WEEK.includes(weekIndex % WEEKS_PER_YEAR);
}

/**
 * True on the first week of a year, *excluding* week 0 — a run does not open on
 * a year rollover, so the annual review does not fire before any year has been
 * lived.
 */
export function isYearBoundary(weekIndex: number): boolean {
  return weekIndex % WEEKS_PER_YEAR === 0 && weekIndex > 0;
}

/** True on the first week of a quarter, including week 0. */
export function isQuarterBoundary(weekIndex: number): boolean {
  return QUARTER_START_WEEK.includes(weekIndex % WEEKS_PER_YEAR);
}
