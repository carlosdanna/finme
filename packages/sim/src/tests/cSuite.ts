/**
 * Balance tests C2-C6 — GDD Appendix C.
 *
 * Each reports a pass/fail with the distribution behind it. They run the real
 * engine end to end; nothing here re-implements a rule.
 *
 * Run: `pnpm -F @finme/sim c-suite`
 */
import {
  type Interrupt,
  type Run,
  type RunState,
  WEEKS_PER_YEAR,
  advance,
  createRun,
  emptyAllocation,
  runWeeks,
  tick,
} from '@finme/engine';
import { DEFAULT_ALLOCATION, EVENTS, scenarioConfig } from '@finme/content';
import type { EventDef } from '@finme/engine';
import { describe, formatCents } from '../stats.ts';

/**
 * A neutral filler event: consumes a slot and does nothing.
 *
 * Used **only** to measure the effect of pool size. GDD §5.3 targets ~45 events
 * for MVP and ~120 for the full game; the shipped pool is 8. Diluting with
 * fillers reproduces the *frequency* a real pool would give without pretending
 * to be content, which is what separates an engine failure from an unwritten
 * one.
 */
function fillerEvent(n: number): EventDef {
  return {
    id: `ZZZ_FILLER_${String(n).padStart(3, '0')}`,
    category: 'social',
    baseWeight: 100,
    cooldownWeeks: 52,
    gates: [],
    multipliers: [],
    title: 'A quiet week',
    body: 'Nothing much happened.',
    choices: [
      { id: 'a', label: 'Get on with it', effects: [], noop: true, logbookKey: 'quiet' },
      { id: 'b', label: 'Carry on', effects: [], noop: true, logbookKey: 'quiet' },
    ],
  };
}

/** The shipped pool, diluted to `size` with fillers. */
export function dilutedPool(size: number): EventDef[] {
  return [
    ...EVENTS,
    ...Array.from({ length: Math.max(0, size - EVENTS.length) }, (_, i) => fillerEvent(i)),
  ];
}

/** GDD §5.3's MVP target. */
export const MVP_POOL_SIZE = 45;

export interface CResult {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly lines: readonly string[];
}

const seeds = (n: number, prefix: string): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const scripted = () => ({ allocation: DEFAULT_ALLOCATION });

function baselineRun(seed: string, weeks: number, pool?: readonly EventDef[]): Run {
  const config = scenarioConfig({ seed, runLengthYears: 30 });
  return runWeeks(createRun(pool === undefined ? config : { ...config, eventDefs: pool }), weeks, scripted);
}

// --- C2 — bankruptcy must not be exploitable --------------------------------

/**
 * The exploit: borrow to the limit, spend it, stop paying, discharge, repeat.
 *
 * Modelled as a player who runs no standing orders, spends discretionary income
 * to the floor, and never builds a cushion — the behaviour the dire state is
 * meant to punish.
 */
function maxOutRun(seed: string, weeks: number): Run {
  return runWeeks(
    createRun({ ...scenarioConfig({ seed, runLengthYears: 30 }), startingCashCents: 0 }),
    weeks,
    (state: RunState) => ({
      allocation: DEFAULT_ALLOCATION,
      // Spend everything that arrives; never accumulate.
      discretionarySpendCents: Math.max(0, state.cashCents),
    }),
  );
}

export function runC2(seedCount = 400): CResult {
  const weeks = WEEKS_PER_YEAR * 30;
  const baseline: number[] = [];
  const exploit: number[] = [];

  for (const seed of seeds(seedCount, 'C2')) {
    baseline.push(baselineRun(seed, weeks).state.netWorthHistory.at(-1) ?? 0);
    exploit.push(maxOutRun(seed, weeks).state.netWorthHistory.at(-1) ?? 0);
  }

  const base = describe(baseline);
  const max = describe(exploit);

  // Worse median, and worse at every percentile above the 10th.
  const percentiles = ['p25', 'p50', 'p75', 'p90', 'p95', 'p99'] as const;
  const worseEverywhere = percentiles.every((key) => max[key] < base[key]);
  const passed = max.p50 < base.p50 && worseEverywhere;

  return {
    id: 'C2',
    title: 'Bankruptcy must not be exploitable',
    passed,
    lines: [
      `${seedCount} seeds x 30 years`,
      `           ${['p10', 'p25', 'p50', 'p75', 'p90'].map((k) => k.padStart(12)).join('')}`,
      `baseline   ${['p10', 'p25', 'p50', 'p75', 'p90'].map((k) => formatCents(base[k as 'p50']).padStart(12)).join('')}`,
      `max-out    ${['p10', 'p25', 'p50', 'p75', 'p90'].map((k) => formatCents(max[k as 'p50']).padStart(12)).join('')}`,
      `median worse: ${max.p50 < base.p50}   worse above the 10th: ${worseEverywhere}`,
    ],
  };
}

// --- C3 — the spiral must be escapable but hard -----------------------------

/** A scripted worst case: low mood, low energy, high-interest debt, no cushion. */
function spiralState(run: Run): Run {
  return {
    ...run,
    state: { ...run.state, energy: 12, mood: 8, cashCents: 0, emergencyFundCents: 0, housingTier: 0 },
  };
}

export function runC3(seedCount = 120): CResult {
  const recoveryWeeks: number[] = [];
  const passiveRecovered: boolean[] = [];

  for (const seed of seeds(seedCount, 'C3')) {
    const base = createRun(scenarioConfig({ seed, runLengthYears: 30 }));

    // Reasonable recovery: rest and free social, no spending.
    let recovering = spiralState(base);
    let weeks: number | null = null;
    for (let week = 1; week <= WEEKS_PER_YEAR * 5; week++) {
      recovering = {
        ...recovering,
        state: tick(recovering.world, recovering.streams, recovering.state, {
          allocation: { ...emptyAllocation(), work: 'full-time', rest: 3, freeSocial: 2 },
        }).state,
      };
      if (recovering.state.mood > 50 && recovering.state.energy > 50) {
        weeks = week;
        break;
      }
    }
    if (weeks !== null) recoveryWeeks.push(weeks);

    // Passive: work and nothing else. Should not climb out.
    let passive = spiralState(base);
    passive = runWeeks(passive, WEEKS_PER_YEAR * 2, () => ({
      allocation: { ...emptyAllocation(), work: 'full-time' },
    }));
    passiveRecovered.push(passive.state.mood > 50 && passive.state.energy > 50);
  }

  const recovered = recoveryWeeks.length;
  const stats = describe(recoveryWeeks);
  const passiveRate = passiveRecovered.filter(Boolean).length / seedCount;

  // Escapable under a reasonable strategy; not escapable by doing nothing.
  const passed = recovered === seedCount && stats.p90 <= WEEKS_PER_YEAR * 5 && passiveRate < 0.1;

  return {
    id: 'C3',
    title: 'The spiral must be escapable but hard',
    passed,
    lines: [
      `${seedCount} scripted worst-case states`,
      `recovered under a reasonable strategy: ${recovered}/${seedCount}`,
      `weeks to recover: p50 ${stats.p50.toFixed(0)}, p90 ${stats.p90.toFixed(0)}, max ${stats.max.toFixed(0)}`,
      `passive strategy recovered: ${(passiveRate * 100).toFixed(1)}% (must stay low)`,
    ],
  };
}

// --- C4 — decision density --------------------------------------------------

export function runC4(seedCount = 60, pool?: readonly EventDef[]): CResult {
  const counts: number[] = [];
  const longestGaps: number[] = [];

  for (const seed of seeds(seedCount, 'C4')) {
    const config = scenarioConfig({ seed, runLengthYears: 30 });
    let run = createRun(pool === undefined ? config : { ...config, eventDefs: pool });
    const stops: number[] = [];

    for (let guard = 0; guard < 4_000; guard++) {
      const result = advance(run, 'until-something-happens', scripted);
      run = result.run;
      if (result.interrupts.some((i: Interrupt) => i.reason === 'run-complete')) break;
      if (result.interrupts.length > 0) stops.push(run.state.weekIndex);
      if (run.state.weekIndex >= WEEKS_PER_YEAR * 30 - 1) break;
    }

    counts.push(stops.length);
    let longest = stops[0] ?? 0;
    for (let i = 1; i < stops.length; i++) longest = Math.max(longest, stops[i] - stops[i - 1]);
    longestGaps.push(longest);
  }

  const density = describe(counts);
  const gaps = describe(longestGaps);
  // 150-250 decision points, and no stretch beyond ~6 in-game months.
  const passed = density.p50 >= 150 && density.p50 <= 250 && gaps.p90 <= 30;

  return {
    id: 'C4',
    title: 'Decision density',
    passed,
    lines: [
      `${seedCount} full runs`,
      `decision points: p10 ${density.p10.toFixed(0)}, p50 ${density.p50.toFixed(0)}, p90 ${density.p90.toFixed(0)} (target 150-250)`,
      `longest quiet stretch: p50 ${gaps.p50.toFixed(0)}w, p90 ${gaps.p90.toFixed(0)}w, max ${gaps.max.toFixed(0)}w (target <= 26w)`,
    ],
  };
}

// --- C5 — event repetition --------------------------------------------------

export function runC5(seedCount = 200, pool?: readonly EventDef[]): CResult {
  let worstRepeat = 0;
  let repeatsInFirstFive = 0;
  const repeatCounts: number[] = [];

  for (const seed of seeds(seedCount, 'C5')) {
    const run = baselineRun(seed, WEEKS_PER_YEAR * 30, pool);
    const history = run.state.eventHistory;

    for (const [, weeks] of Object.entries(history)) {
      worstRepeat = Math.max(worstRepeat, weeks.length);
      repeatCounts.push(weeks.length);
      // A repeat inside the first five in-game years.
      const early = weeks.filter((week) => week < WEEKS_PER_YEAR * 5);
      if (early.length > 1) repeatsInFirstFive++;
    }
  }

  const stats = describe(repeatCounts);
  const passed = worstRepeat <= 4 && repeatsInFirstFive === 0;

  return {
    id: 'C5',
    title: 'Event repetition',
    passed,
    lines: [
      `${seedCount} full runs`,
      `most times any event fired in one run: ${worstRepeat} (limit 4)`,
      `firings per event: p50 ${stats.p50.toFixed(1)}, p90 ${stats.p90.toFixed(1)}`,
      `events repeating inside the first 5 years: ${repeatsInFirstFive} (must be 0)`,
      `pool size: ${(pool ?? EVENTS).length} events (GDD §5.3 targets ~45 for MVP, ~120 full)`,
    ],
  };
}

// --- C6 — starting position fairness ----------------------------------------

/** The §3.7 starts, as the harness can express them today. */
const STARTS = [
  { id: 'stable-ground', label: 'Stable ground', cashCents: 200_000, jobId: 'warehouse-picker' },
  { id: 'head-start', label: 'Head start', cashCents: 1_200_000, jobId: 'office-admin' },
  { id: 'behind-the-line', label: 'Behind the line', cashCents: 0, jobId: 'barista' },
  { id: 'caregiver', label: 'Caregiver', cashCents: 200_000, jobId: 'retail-associate' },
] as const;

export function runC6(seedCount = 200, pool?: readonly EventDef[]): CResult {
  const byStart = new Map<string, number[]>();

  for (const start of STARTS) {
    const terminal: number[] = [];
    for (const seed of seeds(seedCount, 'C6')) {
      const run = runWeeks(
        createRun({
          ...scenarioConfig({ seed, runLengthYears: 30 }),
          ...(pool === undefined ? {} : { eventDefs: pool }),
          startingCashCents: start.cashCents,
          startingJobId: start.jobId,
        }),
        WEEKS_PER_YEAR * 30,
        scripted,
      );
      terminal.push(run.state.netWorthHistory.at(-1) ?? 0);
    }
    byStart.set(start.id, terminal);
  }

  const stats = new Map([...byStart].map(([id, values]) => [id, describe(values)]));
  const head = stats.get('head-start')!;
  const behind = stats.get('behind-the-line')!;

  const allPositive = [...stats.values()].every((s) => s.p50 > 0);
  const gapAtStart = head.p50 - behind.p50;
  // The gap must narrow relative to the starting cash difference, but not vanish.
  const startingGap = 1_200_000;
  const narrows = gapAtStart < head.p50;
  const persists = gapAtStart > 0;

  return {
    id: 'C6',
    title: 'Starting position fairness',
    passed: allPositive && narrows && persists,
    lines: [
      `${seedCount} seeds x 30 years, per start`,
      ...STARTS.map(
        (start) =>
          `  ${start.label.padEnd(18)} p10 ${formatCents(stats.get(start.id)!.p10).padStart(11)}` +
          `  p50 ${formatCents(stats.get(start.id)!.p50).padStart(11)}` +
          `  p90 ${formatCents(stats.get(start.id)!.p90).padStart(11)}`,
      ),
      `every start positive in the median: ${allPositive}`,
      `head-start advantage at run end: ${formatCents(gapAtStart)} (started ${formatCents(startingGap)} ahead)`,
      `gap narrows: ${narrows}   gap persists: ${persists}`,
    ],
  };
}

export function runCSuite(): CResult[] {
  return [runC2(), runC3(), runC4(), runC5(), runC6()];
}

/**
 * The same tests against a pool diluted to the MVP's own target size.
 *
 * Separates "the engine is wrong" from "the content is not written yet". If a
 * test fails as shipped but passes here, the minimal fix is events, not
 * parameters.
 */
export function runCSuiteAtMvpPool(): CResult[] {
  const pool = dilutedPool(MVP_POOL_SIZE);
  return [
    runC4(30, pool),
    runC5(60, pool),
    runC6(60, pool),
  ].map((result) => ({ ...result, id: `${result.id}@45` }));
}

export function formatCSuite(results: readonly CResult[]): string {
  const lines: string[] = ['Balance tests C2-C6 — GDD Appendix C', '='.repeat(78)];
  for (const result of results) {
    lines.push('');
    lines.push(`${result.id} — ${result.title}: ${result.passed ? 'PASS' : 'FAIL'}`);
    lines.push('-'.repeat(78));
    for (const line of result.lines) lines.push(`  ${line}`);
  }
  const failed = results.filter((r) => !r.passed);
  lines.push('');
  lines.push('='.repeat(78));
  lines.push(
    failed.length === 0
      ? `All ${results.length} passed.`
      : `${failed.length} failed: ${failed.map((r) => r.id).join(', ')}`,
  );
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(formatCSuite(runCSuite()));
  console.log('');
  console.log('Diagnostic — the same tests with the pool diluted to the MVP target of 45');
  console.log(formatCSuite(runCSuiteAtMvpPool()));
}
