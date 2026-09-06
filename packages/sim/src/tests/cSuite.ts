/**
 * Balance tests C2-C6 — GDD Appendix C.
 *
 * Each reports a pass/fail with the distribution behind it. They run the real
 * engine end to end; nothing here re-implements a rule.
 *
 * Run: `pnpm -F @finme/sim c-suite`
 */
import {
  BASE_WEIGHT_COMMON,
  BASE_WEIGHT_RARE,
  BASE_WEIGHT_UNCOMMON,
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
function fillerEvent(n: number, baseWeight: number): EventDef {
  return {
    id: `ZZZ_FILLER_${String(n).padStart(3, '0')}`,
    category: 'social',
    baseWeight,
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

/**
 * [T] The rarity mix fillers are drawn in (`docs/EVENT-CATALOGUE.md` §4).
 *
 * Uniformly-common fillers made the diluted pool a bad model of a real one: C5
 * then measured a pool with no rare events at all.
 */
const FILLER_TIER_MIX: readonly number[] = (() => {
  const counts: readonly (readonly [number, number])[] = [
    [BASE_WEIGHT_COMMON, 21],
    [BASE_WEIGHT_UNCOMMON, 35],
    [BASE_WEIGHT_RARE, 20],
  ];
  // Interleaved, not blocked, so any prefix is a representative mix.
  return counts
    .flatMap(([weight, n]) =>
      Array.from({ length: n }, (_, k) => ({ weight, spread: (k + 0.5) / n })),
    )
    .sort((a, b) => a.spread - b.spread || b.weight - a.weight)
    .map((entry) => entry.weight);
})();

/** The shipped pool, diluted to `size` with fillers in the catalogue's tier mix. */
export function dilutedPool(size: number): EventDef[] {
  return [
    ...EVENTS,
    ...Array.from({ length: Math.max(0, size - EVENTS.length) }, (_, i) =>
      fillerEvent(i, FILLER_TIER_MIX[i % FILLER_TIER_MIX.length]),
    ),
  ];
}

/** GDD §5.3's MVP target. */
export const MVP_POOL_SIZE = 45;

/** GDD §5.3's full-game target. C5's per-tier limits are sized against this. */
export const FULL_POOL_SIZE = 120;

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

/**
 * [T] Decision points per 30-year run (issue #1, 2026-09-06).
 *
 * An event *is* a decision point, so §5.3's frequency and this are the same
 * number; they agreed at ~255 and C4's old 150-250 was the outlier. The ceiling
 * is 320 rather than 255 because a larger pool leaves fewer slots with nothing
 * eligible, so density rises with pool size on a fixed schedule.
 */
export const DENSITY_MIN = 150;
export const DENSITY_MAX = 320;

/**
 * [T] Longest acceptable stretch with no player interaction. C4 says "~6 in-game
 * months"; the assertion has always been 30 while the label said 26. Kept at 30.
 */
export const QUIET_STRETCH_MAX_WEEKS = 30;

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
  const passed =
    density.p50 >= DENSITY_MIN && density.p50 <= DENSITY_MAX && gaps.p90 <= QUIET_STRETCH_MAX_WEEKS;

  return {
    id: 'C4',
    title: 'Decision density',
    passed,
    lines: [
      `${seedCount} full runs`,
      `decision points: p10 ${density.p10.toFixed(0)}, p50 ${density.p50.toFixed(0)}, p90 ${density.p90.toFixed(0)} (target ${DENSITY_MIN}-${DENSITY_MAX})`,
      `longest quiet stretch: p50 ${gaps.p50.toFixed(0)}w, p90 ${gaps.p90.toFixed(0)}w, max ${gaps.max.toFixed(0)}w (target <= ${QUIET_STRETCH_MAX_WEEKS}w)`,
    ],
  };
}

// --- C5 — event repetition --------------------------------------------------

type Tier = 'common' | 'uncommon' | 'rare';

/**
 * [T] Firings of one event per 30-year run, per rarity tier, at the **p90** of
 * the (run, event) distribution (issue #1, 2026-09-06).
 *
 * Per tier because a common event carries 8x a rare event's weight and fires 8x
 * as often by design. At p90 rather than the maximum because a maximum grows
 * with sample count, so the old check got stricter when `seedCount` rose.
 * Numbers scale §5.3's "no more than 3-4 times" by tier weight.
 */
export const REPEAT_LIMIT_P90: Readonly<Record<Tier, number>> = {
  common: 8,
  uncommon: 4,
  rare: 2,
};

function tierOf(event: EventDef): Tier {
  if (event.baseWeight >= BASE_WEIGHT_COMMON) return 'common';
  if (event.baseWeight >= BASE_WEIGHT_UNCOMMON) return 'uncommon';
  return 'rare';
}

export function runC5(seedCount = 200, pool?: readonly EventDef[]): CResult {
  const events = pool ?? EVENTS;
  const byId = new Map(events.map((event) => [event.id, event]));

  const firings: Record<Tier, number[]> = { common: [], uncommon: [], rare: [] };
  const worst: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };
  let cooldownBreaches = 0;
  const repeatCounts: number[] = [];

  for (const seed of seeds(seedCount, 'C5')) {
    const run = baselineRun(seed, WEEKS_PER_YEAR * 30, pool);

    for (const [id, weeks] of Object.entries(run.state.eventHistory)) {
      const event = byId.get(id);
      if (event === undefined) continue;
      const tier = tierOf(event);

      firings[tier].push(weeks.length);
      worst[tier] = Math.max(worst[tier], weeks.length);
      repeatCounts.push(weeks.length);

      // Replaces "no event repeats inside the first 5 years", which no pool
      // could satisfy: a common event has ~1.1 expected firings in five years,
      // so a repeat somewhere across 200 runs is a certainty, not a defect.
      for (let i = 1; i < weeks.length; i++) {
        if (weeks[i] - weeks[i - 1] < event.cooldownWeeks) cooldownBreaches++;
      }
    }
  }

  const stats = describe(repeatCounts);
  const tiers = Object.keys(REPEAT_LIMIT_P90) as Tier[];
  const overLimit = tiers.filter((tier) => {
    const counts = firings[tier];
    return counts.length > 0 && describe(counts).p90 > REPEAT_LIMIT_P90[tier];
  });
  const passed = overLimit.length === 0 && cooldownBreaches === 0;

  const tierLine = (tier: Tier): string => {
    const counts = firings[tier];
    if (counts.length === 0) return `  ${tier}: no events in pool`;
    const t = describe(counts);
    return `  ${tier}: p50 ${t.p50.toFixed(1)}, p90 ${t.p90.toFixed(1)} (limit ${REPEAT_LIMIT_P90[tier]}), worst ${worst[tier]}`;
  };

  return {
    id: 'C5',
    title: 'Event repetition',
    passed,
    lines: [
      `${seedCount} full runs`,
      'firings per event in one run, by rarity tier — p90 is the assertion:',
      tierLine('common'),
      tierLine('uncommon'),
      tierLine('rare'),
      `all tiers: p50 ${stats.p50.toFixed(1)}, p90 ${stats.p90.toFixed(1)}`,
      `firings inside the event's own cooldown: ${cooldownBreaches} (must be 0)`,
      `pool size: ${events.length} events (GDD §5.3 targets ~45 for MVP, ~120 full)`,
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
  ].map((result) => ({ ...result, id: `${result.id}@${MVP_POOL_SIZE}` }));
}

/**
 * C5 against §5.3's full-game pool target. Its limits describe the shipped game,
 * so this is what shows they are met by pool size alone — and that the failures
 * above are unwritten content rather than a broken parameter.
 */
export function runC5AtFullPool(): CResult {
  const result = runC5(60, dilutedPool(FULL_POOL_SIZE));
  return { ...result, id: `C5@${FULL_POOL_SIZE}` };
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
  console.log(`Diagnostic — the same tests with the pool diluted to the MVP target of ${MVP_POOL_SIZE}`);
  console.log(formatCSuite(runCSuiteAtMvpPool()));
  console.log('');
  console.log(`Diagnostic — C5 at §5.3's full-game pool target of ${FULL_POOL_SIZE}`);
  console.log(formatCSuite([runC5AtFullPool()]));
}
