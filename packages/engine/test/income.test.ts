import { describe, expect, it } from 'vitest';
import {
  CAREER_CURVE,
  DEFAULT_CONTRIBUTION_PCT,
  EARLY_WITHDRAWAL_AGE,
  EMPLOYER_MATCH_CAP_PCT,
  JOB_HOP_RAISE_MAX,
  JOB_HOP_RAISE_MIN,
  OVERTIME_THRESHOLD_HOURS,
  RAISE_INFLATION_FACTOR,
  annualRaiseRate,
  applyRaiseCents,
  careerCurveRate,
  earlyWithdrawalPenaltyCents,
  jobHopRaiseRate,
  overtimeHoursFor,
  performanceBonusRate,
  retirementContributionCents,
  weeklyGrossHourlyCents,
  weeklyGrossSalariedCents,
} from '../src/income.ts';
import { buildCpi } from '../src/inflation.ts';
import { stream } from '../src/rng.ts';
import { WEEKS_PER_YEAR } from '../src/time.ts';

describe('gross pay (TDD §6.1)', () => {
  it('pays hourly work at the rate for straight time', () => {
    expect(weeklyGrossHourlyCents(2_000, 40)).toBe(80_000); // $20/hr x 40h
    expect(weeklyGrossHourlyCents(1_550, 32)).toBe(49_600);
    expect(weeklyGrossHourlyCents(2_000, 0)).toBe(0);
  });

  it('pays overtime hours at time and a half', () => {
    // 45 hours with 5 of overtime: 40 straight + 5 at 1.5x = 47.5 hours' pay.
    expect(weeklyGrossHourlyCents(2_000, 45, 5)).toBe(Math.round(2_000 * 47.5));
    expect(weeklyGrossHourlyCents(2_000, 45, 5)).toBeGreaterThan(weeklyGrossHourlyCents(2_000, 45));
  });

  it('treats overtime as a portion of hours worked, not hours on top', () => {
    // All 40 hours at overtime rates is 60 hours' pay, not 100.
    expect(weeklyGrossHourlyCents(2_000, 40, 40)).toBe(Math.round(2_000 * 60));
    // Overtime beyond the hours worked cannot invent pay.
    expect(weeklyGrossHourlyCents(2_000, 40, 80)).toBe(weeklyGrossHourlyCents(2_000, 40, 40));
  });

  it('derives the overtime portion from a 40-hour threshold', () => {
    expect(overtimeHoursFor(38)).toBe(0);
    expect(overtimeHoursFor(OVERTIME_THRESHOLD_HOURS)).toBe(0);
    expect(overtimeHoursFor(52)).toBe(12);
  });

  it('pays salaried work at annual / 52 regardless of month length', () => {
    expect(weeklyGrossSalariedCents(5_200_000)).toBe(100_000);
    // A 5-week month simply pays five of these against the same fixed rent.
    expect(weeklyGrossSalariedCents(5_200_000) * WEEKS_PER_YEAR).toBe(5_200_000);
  });

  it('returns integer cents', () => {
    expect(Number.isInteger(weeklyGrossSalariedCents(4_999_999))).toBe(true);
    expect(Number.isInteger(weeklyGrossHourlyCents(1_733, 37.5, 2.5))).toBe(true);
  });
});

describe('the annual raise (TDD §6.2)', () => {
  it('scores performance from -2% at 0 to +2% at 100', () => {
    expect(performanceBonusRate(0)).toBeCloseTo(-0.02, 12);
    expect(performanceBonusRate(50)).toBe(0);
    expect(performanceBonusRate(100)).toBeCloseTo(0.02, 12);
  });

  it('steps the career curve down with age', () => {
    expect(careerCurveRate(22)).toBe(0.012);
    expect(careerCurveRate(29)).toBe(0.012);
    expect(careerCurveRate(30)).toBe(0.008);
    expect(careerCurveRate(44)).toBe(0.008);
    expect(careerCurveRate(45)).toBe(0.002);
    expect(careerCurveRate(54)).toBe(0.002);
    expect(careerCurveRate(55)).toBe(0);
    expect(careerCurveRate(70)).toBe(0);
  });

  it('declines monotonically across the age bands', () => {
    const rates = CAREER_CURVE.map((b) => b.rate);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThan(rates[i - 1]);
  });

  it('lags inflation by design for an average performer', () => {
    // The quiet villain: 80% of inflation, plus a career curve that runs out.
    const inflation = 0.03;
    const raise = annualRaiseRate(inflation, 50, 60);
    expect(raise).toBeCloseTo(inflation * RAISE_INFLATION_FACTOR, 12);
    expect(raise).toBeLessThan(inflation);
  });

  it('erodes real income once the career curve runs out', () => {
    // The mechanism: with no curve left, the raise is 80% of inflation and real
    // pay falls every single year.
    const inflation = 0.02;
    expect(annualRaiseRate(inflation, 50, 60)).toBeLessThan(inflation);

    const rates = Float64Array.from(Array.from({ length: 21 }, () => inflation));
    const cpi = buildCpi(rates);
    let salaryCents = 8_000_000;
    for (let year = 1; year <= 20; year++) {
      salaryCents = applyRaiseCents(salaryCents, annualRaiseRate(inflation, 50, 55 + year));
    }

    expect(salaryCents).toBeGreaterThan(8_000_000); // nominal pay went up
    expect(salaryCents / cpi[20]).toBeLessThan(8_000_000); // real pay went down
  });

  it('does NOT erode real income for a young passive worker — the curve outruns the lag', () => {
    // Measured, and contrary to §6.2's stated intent. Net real drift per year is
    // `careerCurve - 0.2 * inflation`, so at the model's 2% baseline it is
    // +0.8%/yr under 30 and +0.4%/yr to 45 — the lag only bites from 45 on.
    // A passive average performer aged 22-52 ends ~10% AHEAD in real terms.
    // Recorded rather than silently retuned; see docs/DECISIONS.md.
    const inflation = 0.02;
    const rates = Float64Array.from(Array.from({ length: 31 }, () => inflation));
    const cpi = buildCpi(rates);

    let salaryCents = 5_200_000;
    for (let year = 1; year <= 30; year++) {
      salaryCents = applyRaiseCents(salaryCents, annualRaiseRate(inflation, 50, 22 + year));
    }

    const realRatio = salaryCents / cpi[30] / 5_200_000;
    expect(realRatio).toBeGreaterThan(1.08);
    expect(realRatio).toBeLessThan(1.13);

    // Where the lag does bite: after the curve steps down at 45.
    expect(annualRaiseRate(inflation, 50, 25)).toBeGreaterThan(inflation);
    expect(annualRaiseRate(inflation, 50, 50)).toBeLessThan(inflation);
  });

  it('lets a strong performer under 30 outrun inflation', () => {
    expect(annualRaiseRate(0.03, 100, 25)).toBeGreaterThan(0.03);
  });

  it('never cuts pay, however bad the year', () => {
    expect(annualRaiseRate(0, 0, 60)).toBe(0);
    expect(annualRaiseRate(-0.005, 0, 60)).toBe(0);
    expect(annualRaiseRate(0.001, 0, 60)).toBe(0);
  });

  it('steps pay 8-18% on a job hop, which is why hopping beats loyalty', () => {
    const rng = stream('4F2A9C1B', 'jobApplication');
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const raise = jobHopRaiseRate(rng);
      expect(raise).toBeGreaterThanOrEqual(JOB_HOP_RAISE_MIN);
      expect(raise).toBeLessThan(JOB_HOP_RAISE_MAX);
      sum += raise;
    }
    expect(sum / 5000).toBeCloseTo((JOB_HOP_RAISE_MIN + JOB_HOP_RAISE_MAX) / 2, 2);
    // Even the smallest hop is worth more than two years of average raises.
    expect(JOB_HOP_RAISE_MIN).toBeGreaterThan(annualRaiseRate(0.03, 50, 25) * 2);
  });
});

describe('retirement contributions (TDD §6.4)', () => {
  it('defaults to contributing nothing, and never prompts', () => {
    expect(DEFAULT_CONTRIBUTION_PCT).toBe(0);
    const contribution = retirementContributionCents(100_000, DEFAULT_CONTRIBUTION_PCT);
    expect(contribution).toEqual({ employeeCents: 0, employerCents: 0, totalCents: 0 });
  });

  it('matches 100% of the first 4% of gross', () => {
    const gross = 100_000;
    // Below the cap the match is pound for pound.
    expect(retirementContributionCents(gross, 0.02)).toEqual({
      employeeCents: 2_000,
      employerCents: 2_000,
      totalCents: 4_000,
    });
    // At the cap.
    expect(retirementContributionCents(gross, EMPLOYER_MATCH_CAP_PCT).employerCents).toBe(4_000);
    // Above it the employer stops, the employee does not.
    expect(retirementContributionCents(gross, 0.1)).toEqual({
      employeeCents: 10_000,
      employerCents: 4_000,
      totalCents: 14_000,
    });
  });

  it('leaves free money on the table below the match cap', () => {
    const under = retirementContributionCents(100_000, 0.01);
    const atCap = retirementContributionCents(100_000, EMPLOYER_MATCH_CAP_PCT);
    expect(atCap.employerCents - under.employerCents).toBe(3_000);
  });

  it('penalizes withdrawal before 59 at 10%', () => {
    expect(earlyWithdrawalPenaltyCents(1_000_000, 40)).toBe(100_000);
    expect(earlyWithdrawalPenaltyCents(1_000_000, EARLY_WITHDRAWAL_AGE - 1)).toBe(100_000);
    expect(earlyWithdrawalPenaltyCents(1_000_000, EARLY_WITHDRAWAL_AGE)).toBe(0);
    expect(earlyWithdrawalPenaltyCents(1_000_000, 70)).toBe(0);
  });
});
