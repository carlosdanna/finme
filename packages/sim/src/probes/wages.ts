/**
 * Wage-trajectory probe — informs the open §6.2 question in docs/DECISIONS.md.
 *
 * Not a C-test. This exists to answer one thing with numbers rather than
 * argument: does the default raise actually erode real income, and what does
 * never job-hopping cost?
 *
 * Run: `pnpm -F @finme/sim wages`
 */
import {
  RAISE_INFLATION_FACTOR,
  applyRaiseCents,
  careerCurveRate,
  generateMarket,
  jobHopRaiseRate,
  performanceBonusRate,
  settleAnnualTax,
  stream,
  weeklyWithholdingCents,
  WEEKS_PER_YEAR,
} from '@finme/engine';
import { describe, formatCents } from '../stats.ts';

export const START_AGE = 22;
export const START_SALARY_CENTS = 5_200_000; // $52,000
export const RUN_YEARS = 30;

/** The §6.2 table, and the reduced variant proposed in DECISIONS.md. */
export const CURVE_SPEC = careerCurveRate;
export const CURVE_REDUCED = (age: number): number =>
  age < 30 ? 0.004 : age < 45 ? 0.002 : 0;

export interface CareerSpec {
  readonly id: string;
  readonly name: string;
  readonly performance: number;
  /** Years between job hops, or null for never. */
  readonly hopEveryYears: number | null;
  readonly curve: (age: number) => number;
}

export interface CareerResult {
  /** Final salary in year-0 dollars. */
  readonly finalRealCents: number;
  /** Final salary as a multiple of the starting salary, in real terms. */
  readonly realMultiple: number;
  /** Every year's after-tax pay, summed, in year-0 dollars. */
  readonly lifetimeRealAfterTaxCents: number;
}

export function runCareer(seed: string, spec: CareerSpec): CareerResult {
  const { inflation } = generateMarket(seed, RUN_YEARS);
  const hopRng = stream(seed, 'jobApplication');

  let salaryCents = START_SALARY_CENTS;
  let lifetimeRealAfterTaxCents = 0;

  for (let year = 0; year < RUN_YEARS; year++) {
    const cpi = inflation.cpi[year];

    // Tax the year at this salary, withholding weekly on employment income.
    const withheldCents = weeklyWithholdingCents(Math.round(salaryCents / WEEKS_PER_YEAR), cpi) * WEEKS_PER_YEAR;
    const settlement = settleAnnualTax({
      employmentGrossCents: salaryCents,
      sideHustleGrossCents: 0,
      dividendsCents: 0,
      shortTermGainsCents: 0,
      longTermGainsCents: 0,
      retirementContributionsCents: 0,
      withheldCents,
      cpi,
    });
    lifetimeRealAfterTaxCents += (salaryCents - settlement.totalOwedCents) / cpi;

    // Raise at the year boundary.
    const age = START_AGE + year;
    const raise = Math.max(
      0,
      inflation.annualRate[year] * RAISE_INFLATION_FACTOR +
        performanceBonusRate(spec.performance) +
        spec.curve(age),
    );
    salaryCents = applyRaiseCents(salaryCents, raise);

    if (spec.hopEveryYears !== null && (year + 1) % spec.hopEveryYears === 0) {
      salaryCents = applyRaiseCents(salaryCents, jobHopRaiseRate(hopRng));
    }
  }

  const finalCpi = inflation.cpi[RUN_YEARS];
  const finalRealCents = Math.round(salaryCents / finalCpi);
  return {
    finalRealCents,
    realMultiple: finalRealCents / START_SALARY_CENTS,
    lifetimeRealAfterTaxCents: Math.round(lifetimeRealAfterTaxCents),
  };
}

export const CAREERS: readonly CareerSpec[] = [
  { id: 'stay-avg', name: 'Stay put, average', performance: 50, hopEveryYears: null, curve: CURVE_SPEC },
  { id: 'stay-strong', name: 'Stay put, strong (80)', performance: 80, hopEveryYears: null, curve: CURVE_SPEC },
  { id: 'stay-weak', name: 'Stay put, weak (20)', performance: 20, hopEveryYears: null, curve: CURVE_SPEC },
  { id: 'hop-7', name: 'Hop every 7 years', performance: 50, hopEveryYears: 7, curve: CURVE_SPEC },
  { id: 'hop-5', name: 'Hop every 5 years', performance: 50, hopEveryYears: 5, curve: CURVE_SPEC },
  { id: 'hop-3', name: 'Hop every 3 years', performance: 50, hopEveryYears: 3, curve: CURVE_SPEC },
];

export const CAREERS_REDUCED: readonly CareerSpec[] = CAREERS.map((c) => ({
  ...c,
  id: `${c.id}-reduced`,
  curve: CURVE_REDUCED,
}));

function report(title: string, specs: readonly CareerSpec[], seeds: readonly string[]): string {
  const lines = [title, '-'.repeat(88)];
  lines.push(
    ['Career'.padEnd(24), 'real salary x'.padStart(15), 'median final'.padStart(16), 'lifetime after-tax'.padStart(22)].join(''),
  );

  for (const spec of specs) {
    const results = seeds.map((seed) => runCareer(seed, spec));
    const multiples = describe(results.map((r) => r.realMultiple));
    const finals = describe(results.map((r) => r.finalRealCents));
    const lifetime = describe(results.map((r) => r.lifetimeRealAfterTaxCents));
    lines.push(
      [
        spec.name.padEnd(24),
        `${multiples.p50.toFixed(2)}x`.padStart(15),
        formatCents(finals.p50).padStart(16),
        formatCents(lifetime.p50).padStart(22),
      ].join(''),
    );
  }
  return lines.join('\n');
}

export function runWageProbe(seedCount = 2_000): string {
  const seeds = Array.from({ length: seedCount }, (_, i) => `W${i}`);
  const lines = [
    'Wage trajectories — the §6.2 question',
    '='.repeat(88),
    `${seedCount.toLocaleString('en-US')} seeds | age ${START_AGE}-${START_AGE + RUN_YEARS} | ` +
      `starting ${formatCents(START_SALARY_CENTS)} | all figures in year-0 dollars`,
    '',
    report('A. As specified — CAREER_CURVE [0.012, 0.008, 0.002, 0]', CAREERS, seeds),
    '',
    report('B. Proposed reduction — CAREER_CURVE [0.004, 0.002, 0, 0]', CAREERS_REDUCED, seeds),
  ];

  // The headline: what never moving actually costs.
  const stay = describe(seeds.map((s) => runCareer(s, CAREERS[0]).lifetimeRealAfterTaxCents)).p50;
  const hop5 = describe(seeds.map((s) => runCareer(s, CAREERS[4]).lifetimeRealAfterTaxCents)).p50;
  lines.push('');
  lines.push(
    `Opportunity cost of never hopping: ${formatCents(hop5 - stay)} of lifetime after-tax income ` +
      `(${((hop5 / stay - 1) * 100).toFixed(0)}% more)`,
  );

  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(runWageProbe(Number(process.argv[2] ?? 2_000)));
}
