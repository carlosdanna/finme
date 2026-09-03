import { describe, expect, it } from 'vitest';
import {
  AGE_SCORE_MAX_WEEKS,
  COMPONENT_WEIGHTS,
  type CreditInputs,
  type CreditState,
  ENTRY_SCORE_MAX,
  ENTRY_SCORE_MIN,
  MAX_MONTHLY_MOVE,
  PAYMENT_DECAY_PER_WEEK,
  SCORE_FLOOR,
  SCORE_SPAN,
  THIN_FILE_WEEKS,
  ageScore,
  compositeScore,
  decayWeek,
  derogatoryScore,
  drawEntryScore,
  emptyCreditState,
  hasFile,
  mixScore,
  openCreditLine,
  paymentHistoryScore,
  recordBankruptcy,
  recordCollection,
  recordMissedPayment,
  recordOnTimePayment,
  targetScore,
  updateMonthly,
  utilizationScore,
} from '../src/credit.ts';
import { stream } from '../src/rng.ts';

const ENTRY = 640;
const inputs = (weekIndex: number, balance = 0, limit = 100_000): CreditInputs => ({
  revolvingBalanceCents: balance,
  totalRevolvingLimitCents: limit,
  weekIndex,
});

/** A file opened at week 0, paying monthly, run forward `weeks` weeks. */
function maturedFile(weeks: number, options: { missAtWeek?: number } = {}): CreditState {
  let state = openCreditLine(emptyCreditState(), 'credit-card', 0);
  for (let week = 1; week <= weeks; week++) {
    state = decayWeek(state);
    if (week % 4 === 0) {
      state = week === options.missAtWeek ? recordMissedPayment(state) : recordOnTimePayment(state);
    }
  }
  return state;
}

describe('the thin file (TDD §5.5)', () => {
  it('has no score at all before 26 weeks — never a number, never a zero', () => {
    let state = openCreditLine(emptyCreditState(), 'credit-card', 100);

    for (let week = 100; week < 100 + THIN_FILE_WEEKS; week++) {
      expect(hasFile(state, week)).toBe(false);
      state = updateMonthly(state, inputs(week), ENTRY);
      expect(state.score).toBeNull();
    }

    // Exactly 26 weeks after the line opened, the file establishes.
    expect(hasFile(state, 100 + THIN_FILE_WEEKS)).toBe(true);
    state = updateMonthly(state, inputs(100 + THIN_FILE_WEEKS), ENTRY);
    expect(state.score).toBe(ENTRY);
  });

  it('has no score before any line is opened, however long the run', () => {
    const state = emptyCreditState();
    expect(state.score).toBeNull();
    expect(hasFile(state, 5_000)).toBe(false);
    expect(updateMonthly(state, inputs(5_000), ENTRY).score).toBeNull();
  });

  it('dates the file from the first line, not the newest', () => {
    let state = openCreditLine(emptyCreditState(), 'credit-card', 10);
    state = openCreditLine(state, 'amortizing', 300);
    expect(state.firstLineWeek).toBe(10);
    expect(state.oldestAccountWeek).toBe(10);
    expect(hasFile(state, 36)).toBe(true);
  });

  it('draws an entry score in 620-660', () => {
    const rng = stream('4F2A9C1B', 'startingDraw');
    for (let i = 0; i < 2_000; i++) {
      const score = drawEntryScore(rng);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(ENTRY_SCORE_MIN);
      expect(score).toBeLessThanOrEqual(ENTRY_SCORE_MAX);
    }
  });
});

describe('utilization (TDD §5.5)', () => {
  it('scores 9% and 10% perfectly, and 11% not', () => {
    expect(utilizationScore(0.09)).toBe(1);
    expect(utilizationScore(0.1)).toBe(1);
    expect(utilizationScore(0.11)).toBeLessThan(1);
    expect(utilizationScore(0.11)).toBeCloseTo(0.9875, 6);
    // Just past the sweet spot the penalty is tiny but real.
    expect(utilizationScore(0.101)).toBeLessThan(1);
  });

  it('falls linearly from 10% to 90%, then bottoms out', () => {
    expect(utilizationScore(0.3)).toBeCloseTo(0.75, 10);
    expect(utilizationScore(0.5)).toBeCloseTo(0.5, 10);
    expect(utilizationScore(0.9)).toBeCloseTo(0, 10);
    expect(utilizationScore(1.0)).toBe(0);
    expect(utilizationScore(3.0)).toBe(0);
  });

  it('treats zero utilization as perfect', () => {
    expect(utilizationScore(0)).toBe(1);
  });

  it('costs real points at the boundary', () => {
    const state = maturedFile(200);
    const at10 = targetScore(state, inputs(200, 10_000, 100_000));
    const at11 = targetScore(state, inputs(200, 11_000, 100_000));
    const at50 = targetScore(state, inputs(200, 50_000, 100_000));

    expect(at11).toBeLessThan(at10);
    // The whole utilization component is worth 30% of the 550-point span, so
    // going from 10% to 50% utilization gives up half of it — 82.5 points,
    // within the rounding of an integer score.
    const expected = COMPONENT_WEIGHTS.utilization * SCORE_SPAN * 0.5;
    expect(Math.abs(at10 - at50 - expected)).toBeLessThanOrEqual(1);
  });
});

describe('payment history decay (TDD §5.5)', () => {
  it('halves a missed payment after roughly 140 weeks', () => {
    // ln(0.5) / ln(0.995) = 138.3 weeks.
    let state = recordMissedPayment(emptyCreditState());
    const initial = state.missedWeighted;

    for (let week = 0; week < 138; week++) state = decayWeek(state);
    expect(state.missedWeighted / initial).toBeCloseTo(0.5, 2);

    const halfLife = Math.log(0.5) / Math.log(PAYMENT_DECAY_PER_WEEK);
    expect(halfLife).toBeGreaterThan(135);
    expect(halfLife).toBeLessThan(142);
  });

  it('leaves the ratio untouched under decay alone', () => {
    // Both counters decay at the same rate, so decay by itself changes nothing.
    // Old sins fade only because on-time payments keep accumulating against them.
    let state = recordMissedPayment(recordOnTimePayment(emptyCreditState(), 24));
    const before = paymentHistoryScore(state);
    for (let week = 0; week < 300; week++) state = decayWeek(state);
    expect(paymentHistoryScore(state)).toBeCloseTo(before, 10);
  });

  it('fades a missed payment as on-time payments accumulate', () => {
    const impactAt = (weeksAfter: number) => {
      const week = 200 + weeksAfter;
      return (
        targetScore(maturedFile(week), inputs(week)) -
        targetScore(maturedFile(week, { missAtWeek: 200 }), inputs(week))
      );
    };

    const immediate = impactAt(0);
    expect(immediate).toBeGreaterThan(10);
    // By the counters' half-life the sting is well under half of what it was.
    expect(impactAt(140)).toBeLessThan(immediate / 2);
    expect(impactAt(260)).toBeLessThan(impactAt(140));
  });

  it('weighs a miss 2.5x an on-time payment', () => {
    const oneMiss = recordMissedPayment(recordOnTimePayment(emptyCreditState(), 10));
    expect(paymentHistoryScore(oneMiss)).toBeCloseTo(10 / (10 + 2.5), 10);
  });

  it('treats an empty history as nothing missed', () => {
    expect(paymentHistoryScore(emptyCreditState())).toBe(1);
  });
});

describe('the remaining components (TDD §5.5)', () => {
  it('takes ten years of history to max the age component', () => {
    const state = openCreditLine(emptyCreditState(), 'credit-card', 0);
    expect(ageScore(state, 0)).toBe(0);
    expect(ageScore(state, 260)).toBeCloseTo(0.5, 10);
    expect(ageScore(state, AGE_SCORE_MAX_WEEKS)).toBe(1);
    expect(ageScore(state, 2_000)).toBe(1);
    expect(ageScore(emptyCreditState(), 500)).toBe(0);
  });

  it('takes three distinct debt types to max the mix component', () => {
    let state = emptyCreditState();
    expect(mixScore(state)).toBe(0);

    state = openCreditLine(state, 'credit-card', 0);
    expect(mixScore(state)).toBeCloseTo(1 / 3, 10);

    // The same type again adds nothing.
    state = openCreditLine(state, 'credit-card', 50);
    expect(mixScore(state)).toBeCloseTo(1 / 3, 10);
    expect(state.debtTypesEverHeld).toEqual(['credit-card']);

    state = openCreditLine(state, 'amortizing', 60);
    state = openCreditLine(state, 'bnpl', 70);
    expect(mixScore(state)).toBe(1);

    state = openCreditLine(state, 'payday', 80);
    expect(mixScore(state)).toBe(1); // clamped
    // Sorted, so serialization and iteration are stable.
    expect(state.debtTypesEverHeld).toEqual([...state.debtTypesEverHeld].sort());
  });

  it('penalizes collections and bankruptcies, flooring at zero', () => {
    const base = emptyCreditState();
    expect(derogatoryScore(base)).toBe(1);
    expect(derogatoryScore(recordCollection(base))).toBeCloseTo(0.75, 10);
    expect(derogatoryScore(recordCollection(recordCollection(base)))).toBeCloseTo(0.5, 10);
    expect(derogatoryScore(recordBankruptcy(base))).toBeCloseTo(0.4, 10);

    let wrecked = base;
    for (let i = 0; i < 5; i++) wrecked = recordCollection(wrecked);
    expect(derogatoryScore(wrecked)).toBe(0);
  });

  it('weights the five components as specified, summing to 1', () => {
    const total = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(COMPONENT_WEIGHTS).toEqual({
      paymentHistory: 0.35,
      utilization: 0.3,
      age: 0.15,
      mix: 0.1,
      derogatory: 0.1,
    });
  });

  it('maps the composite onto 300-850', () => {
    const perfect = { ...maturedFile(AGE_SCORE_MAX_WEEKS), missedWeighted: 0 };
    let full = perfect;
    for (const kind of ['amortizing', 'bnpl'] as const) full = openCreditLine(full, kind, 0);

    expect(compositeScore(full, inputs(AGE_SCORE_MAX_WEEKS))).toBeCloseTo(1, 6);
    expect(targetScore(full, inputs(AGE_SCORE_MAX_WEEKS))).toBe(SCORE_FLOOR + SCORE_SPAN);

    const worst = emptyCreditState();
    expect(targetScore(worst, inputs(0, 100_000, 100_000))).toBeGreaterThanOrEqual(SCORE_FLOOR);
  });
});

describe('the ±20/month movement cap (TDD §5.5)', () => {
  it('never moves the score more than 20 points in a month', () => {
    // Start established, then wreck the file: the score must crawl, not jump.
    let state = maturedFile(AGE_SCORE_MAX_WEEKS);
    state = updateMonthly(state, inputs(AGE_SCORE_MAX_WEEKS), ENTRY);
    state = { ...state, score: 820 };

    for (let i = 0; i < 6; i++) state = recordCollection(state);
    state = recordBankruptcy(state);
    for (let i = 0; i < 40; i++) state = recordMissedPayment(state, 10);

    const week = AGE_SCORE_MAX_WEEKS;
    const maxedOut = inputs(week, 100_000, 100_000);
    let previous = state.score!;

    for (let month = 0; month < 60; month++) {
      state = updateMonthly(state, maxedOut, ENTRY);
      expect(Math.abs(state.score! - previous)).toBeLessThanOrEqual(MAX_MONTHLY_MOVE);
      previous = state.score!;
    }

    // It gets there eventually — it just takes years.
    expect(state.score).toBe(targetScore(state, maxedOut));
  });

  it('caps upward movement too', () => {
    let state = maturedFile(AGE_SCORE_MAX_WEEKS);
    state = { ...state, score: 400 };
    for (const kind of ['amortizing', 'bnpl'] as const) state = openCreditLine(state, kind, 0);

    const week = AGE_SCORE_MAX_WEEKS;
    let previous = state.score!;
    for (let month = 0; month < 12; month++) {
      state = updateMonthly(state, inputs(week), ENTRY);
      expect(state.score! - previous).toBeLessThanOrEqual(MAX_MONTHLY_MOVE);
      expect(state.score!).toBeGreaterThan(previous);
      previous = state.score!;
    }
    expect(state.score).toBe(400 + MAX_MONTHLY_MOVE * 12);
  });

  it('settles exactly on target rather than oscillating around it', () => {
    let state = maturedFile(300);
    state = { ...state, score: targetScore(state, inputs(300)) - 5 };
    state = updateMonthly(state, inputs(300), ENTRY);
    expect(state.score).toBe(targetScore(state, inputs(300)));

    // And stays there.
    state = updateMonthly(state, inputs(300), ENTRY);
    expect(state.score).toBe(targetScore(state, inputs(300)));
  });
});

describe('measured point impacts, against §5.3\'s stated equivalents', () => {
  it('costs about 15 points for a miss on a mature file', () => {
    const state = maturedFile(200);
    const cost = targetScore(state, inputs(200)) - targetScore(recordMissedPayment(state), inputs(200));
    // §5.3 says a missed BNPL installment is "-15 credit score impact".
    expect(cost).toBeGreaterThan(12);
    expect(cost).toBeLessThan(18);
  });

  it('costs far more on a thin file than a mature one', () => {
    const thin = maturedFile(THIN_FILE_WEEKS);
    const thinCost = targetScore(thin, inputs(26)) - targetScore(recordMissedPayment(thin), inputs(26));
    const mature = maturedFile(400);
    const matureCost =
      targetScore(mature, inputs(400)) - targetScore(recordMissedPayment(mature), inputs(400));

    expect(thinCost).toBeGreaterThan(matureCost * 3);
  });

  it('cannot cost 80 points for a collection — the component is only 55', () => {
    // §5.3 calls a BNPL collection a "-80 equivalent" hit. The derogatory
    // component is 10% of a 550-point span, so one collection is capped at
    // 0.25 x 55 = 13.75 points. Recorded, not retuned; see docs/DECISIONS.md.
    const state = maturedFile(200);
    const cost = targetScore(state, inputs(200)) - targetScore(recordCollection(state), inputs(200));
    expect(cost).toBeLessThan(15);
    expect(COMPONENT_WEIGHTS.derogatory * SCORE_SPAN).toBe(55);
  });
});
