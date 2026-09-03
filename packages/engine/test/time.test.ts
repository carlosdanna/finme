import { describe, expect, it } from 'vitest';
import {
  MONTH_LENGTHS,
  MONTH_START_WEEK,
  MONTHS_PER_YEAR,
  QUARTER_START_WEEK,
  WEEKS_PER_YEAR,
  age,
  isMonthBoundary,
  isQuarterBoundary,
  isYearBoundary,
  monthOfYear,
  quarterOfYear,
  totalWeeks,
  weekOfMonth,
  weekOfYear,
  weeksInMonth,
  yearIndex,
} from '../src/time.ts';

describe('the 4-4-5 calendar (TDD §1.2)', () => {
  it('has month lengths summing to exactly 52 weeks', () => {
    expect(MONTH_LENGTHS).toHaveLength(MONTHS_PER_YEAR);
    expect(MONTH_LENGTHS.reduce((a, b) => a + b, 0)).toBe(WEEKS_PER_YEAR);
  });

  it('repeats 4-4-5 in every quarter', () => {
    expect([...MONTH_LENGTHS]).toEqual([4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5]);
    for (let q = 0; q < 4; q++) {
      const quarter = MONTH_LENGTHS.slice(q * 3, q * 3 + 3);
      expect(quarter.reduce((a, b) => a + b, 0)).toBe(13);
    }
  });

  it('derives MONTH_START_WEEK matching the table published in TDD §1.2', () => {
    expect([...MONTH_START_WEEK]).toEqual([0, 4, 8, 13, 17, 21, 26, 30, 34, 39, 43, 47]);
  });

  it('derives each month start as the cumulative sum of preceding month lengths', () => {
    let cumulative = 0;
    for (let m = 0; m < MONTHS_PER_YEAR; m++) {
      expect(MONTH_START_WEEK[m]).toBe(cumulative);
      cumulative += MONTH_LENGTHS[m];
    }
    expect(cumulative).toBe(WEEKS_PER_YEAR);
  });

  it('starts each quarter on the weeks named in §1.2', () => {
    expect([...QUARTER_START_WEEK]).toEqual([0, 13, 26, 39]);
    for (let q = 0; q < 4; q++) {
      expect(MONTH_START_WEEK[q * 3]).toBe(QUARTER_START_WEEK[q]);
    }
  });
});

describe('canonical time (TDD §1.1)', () => {
  it('derives yearIndex and weekOfYear from weekIndex alone', () => {
    expect(yearIndex(0)).toBe(0);
    expect(weekOfYear(0)).toBe(0);
    expect(yearIndex(51)).toBe(0);
    expect(weekOfYear(51)).toBe(51);
    expect(yearIndex(52)).toBe(1);
    expect(weekOfYear(52)).toBe(0);
    expect(yearIndex(1559)).toBe(29);
    expect(weekOfYear(1559)).toBe(51);
  });

  it('derives age from weekIndex and the starting age', () => {
    expect(age(0, 22)).toBe(22);
    expect(age(51, 22)).toBe(22);
    expect(age(52, 22)).toBe(23);
    expect(age(totalWeeks(30) - 1, 22)).toBe(51);
  });

  it('sizes a run at 52 weeks per year', () => {
    expect(totalWeeks(10)).toBe(520);
    expect(totalWeeks(30)).toBe(1560);
    expect(totalWeeks(50)).toBe(2600);
  });
});

describe('month and quarter derivation', () => {
  it('maps every week of the year to the largest month start not after it', () => {
    for (let w = 0; w < WEEKS_PER_YEAR; w++) {
      const month = monthOfYear(w);
      expect(MONTH_START_WEEK[month]).toBeLessThanOrEqual(w);
      if (month < MONTHS_PER_YEAR - 1) {
        expect(MONTH_START_WEEK[month + 1]).toBeGreaterThan(w);
      }
    }
  });

  it('places the known boundaries in the right months', () => {
    expect(monthOfYear(0)).toBe(0);
    expect(monthOfYear(3)).toBe(0);
    expect(monthOfYear(4)).toBe(1);
    expect(monthOfYear(12)).toBe(2); // March is the 5-week month of Q1
    expect(monthOfYear(13)).toBe(3);
    expect(monthOfYear(47)).toBe(11);
    expect(monthOfYear(51)).toBe(11);
  });

  it('accepts a raw weekIndex as well as a weekOfYear', () => {
    for (let w = 0; w < WEEKS_PER_YEAR; w++) {
      expect(monthOfYear(w + 52 * 7)).toBe(monthOfYear(w));
    }
  });

  it('gives every month exactly its MONTH_LENGTHS worth of weeks', () => {
    const weeksSeen = new Array<number>(MONTHS_PER_YEAR).fill(0);
    for (let w = 0; w < WEEKS_PER_YEAR; w++) weeksSeen[monthOfYear(w)]++;
    expect(weeksSeen).toEqual([...MONTH_LENGTHS]);
  });

  it('numbers weeks within a month from zero', () => {
    for (let w = 0; w < WEEKS_PER_YEAR; w++) {
      const offset = weekOfMonth(w);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(weeksInMonth(monthOfYear(w)));
    }
    expect(weekOfMonth(0)).toBe(0);
    expect(weekOfMonth(3)).toBe(3);
    expect(weekOfMonth(4)).toBe(0);
    expect(weekOfMonth(12)).toBe(4); // fifth week of a 5-week March
  });

  it('assigns 13 weeks to each quarter', () => {
    const weeksSeen = [0, 0, 0, 0];
    for (let w = 0; w < WEEKS_PER_YEAR; w++) weeksSeen[quarterOfYear(w)]++;
    expect(weeksSeen).toEqual([13, 13, 13, 13]);
  });
});

describe('boundary predicates', () => {
  it('fires isMonthBoundary exactly 12 times per year, for 30 years', () => {
    for (let year = 0; year < 30; year++) {
      let hits = 0;
      for (let w = 0; w < WEEKS_PER_YEAR; w++) {
        if (isMonthBoundary(year * WEEKS_PER_YEAR + w)) hits++;
      }
      expect(hits).toBe(MONTHS_PER_YEAR);
    }
  });

  it('fires isMonthBoundary on exactly the weeks in MONTH_START_WEEK', () => {
    for (let w = 0; w < WEEKS_PER_YEAR; w++) {
      expect(isMonthBoundary(w)).toBe(MONTH_START_WEEK.includes(w));
    }
  });

  it('fires isYearBoundary 12 months apart and never on week 0', () => {
    expect(isYearBoundary(0)).toBe(false);
    expect(isYearBoundary(51)).toBe(false);
    expect(isYearBoundary(52)).toBe(true);
    expect(isYearBoundary(104)).toBe(true);

    const hits: number[] = [];
    for (let w = 0; w < totalWeeks(30); w++) if (isYearBoundary(w)) hits.push(w);
    expect(hits).toHaveLength(29); // a 30-year run rolls over 29 times
    expect(hits[0]).toBe(52);
  });

  it('fires isQuarterBoundary exactly 4 times per year, including week 0', () => {
    expect(isQuarterBoundary(0)).toBe(true);
    let hits = 0;
    for (let w = 0; w < WEEKS_PER_YEAR; w++) if (isQuarterBoundary(w)) hits++;
    expect(hits).toBe(4);
  });

  it('makes every quarter boundary a month boundary too', () => {
    for (let w = 0; w < WEEKS_PER_YEAR; w++) {
      if (isQuarterBoundary(w)) expect(isMonthBoundary(w)).toBe(true);
    }
  });
});
