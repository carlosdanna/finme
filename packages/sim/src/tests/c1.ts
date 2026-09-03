/**
 * C1 — Speculation must not be optimal. (GDD Appendix C, the highest-risk item.)
 *
 * Pass condition, from the GDD: the speculative strategies must have a clearly
 * worse *median* outcome than the index strategy and a meaningfully higher ruin
 * rate, while retaining a fat enough right tail to feel exciting.
 *
 * Run it: `pnpm -F @finme/sim c1`
 * Re-run it after every market or tax parameter change.
 */
import { DEFAULT_CONFIG, type HarnessConfig, type Strategy, harnessSeeds, runHarness, totalContributedCents } from '../harness.ts';
import { ALL_IN_SAFE, C1_STRATEGIES } from '../strategies/allocation.ts';
import { type Distribution, describe, formatCents } from '../stats.ts';

export const RUIN_THRESHOLD = 0.5;

export interface StrategyOutcome {
  readonly strategy: Strategy;
  readonly terminal: Distribution;
  /** Share of runs ending below half of what was contributed. */
  readonly ruinRate: number;
  /**
   * Share of seeds where this strategy beats all-in index *in the same world*.
   *
   * This is the number the GDD's pass condition is really about: whether a
   * player can discover that dumping everything into Moonshot is the winning
   * play. Comparing marginal percentiles cannot answer that; a same-seed
   * head-to-head can.
   */
  readonly beatsIndexRate: number;
  /** Share of runs ending below what was contributed in nominal terms. */
  readonly belowContributedRate: number;
}

export interface C1Report {
  readonly config: HarnessConfig;
  readonly seedCount: number;
  readonly contributedCents: number;
  readonly outcomes: readonly StrategyOutcome[];
}

export function runC1(seedCount = 10_000, config: HarnessConfig = DEFAULT_CONFIG): C1Report {
  const seeds = harnessSeeds(seedCount);
  const results = runHarness(C1_STRATEGIES, seeds, config);
  const contributedCents = totalContributedCents(config);
  const ruinBelow = contributedCents * RUIN_THRESHOLD;

  const indexTerminals = results.get(ALL_IN_SAFE.id)!.map((r) => r.terminalCents);

  const outcomes = C1_STRATEGIES.map((strategy) => {
    const terminals = results.get(strategy.id)!.map((r) => r.terminalCents);
    return {
      strategy,
      terminal: describe(terminals),
      ruinRate: terminals.filter((t) => t < ruinBelow).length / terminals.length,
      beatsIndexRate: terminals.filter((t, i) => t > indexTerminals[i]).length / terminals.length,
      belowContributedRate: terminals.filter((t) => t < contributedCents).length / terminals.length,
    };
  });

  return { config, seedCount, contributedCents, outcomes };
}

export function outcomeFor(report: C1Report, strategyId: string): StrategyOutcome {
  const outcome = report.outcomes.find((o) => o.strategy.id === strategyId);
  if (outcome === undefined) throw new Error(`no C1 outcome for strategy '${strategyId}'`);
  return outcome;
}

export function formatC1Report(report: C1Report): string {
  const { config } = report;
  const lines: string[] = [];

  lines.push('C1 — Speculation must not be optimal');
  lines.push('='.repeat(96));
  lines.push(
    `${report.seedCount.toLocaleString('en-US')} seeds x ${config.runLengthYears} years  |  ` +
      `${formatCents(config.initialCapitalCents)} at t=0 + ${formatCents(config.annualContributionCents)}/yr  |  ` +
      `total contributed ${formatCents(report.contributedCents)}`,
  );
  lines.push(`ruin = terminal below ${RUIN_THRESHOLD * 100}% of contributions (${formatCents(report.contributedCents * RUIN_THRESHOLD)})`);
  lines.push('');

  const header = [
    'Strategy'.padEnd(28),
    'p10'.padStart(12),
    'p25'.padStart(12),
    'p50'.padStart(12),
    'p75'.padStart(12),
    'p90'.padStart(12),
    'ruin'.padStart(8),
  ].join('');
  lines.push(header);
  lines.push('-'.repeat(96));

  for (const { strategy, terminal, ruinRate } of report.outcomes) {
    lines.push(
      [
        strategy.name.padEnd(28),
        formatCents(terminal.p10).padStart(12),
        formatCents(terminal.p25).padStart(12),
        formatCents(terminal.p50).padStart(12),
        formatCents(terminal.p75).padStart(12),
        formatCents(terminal.p90).padStart(12),
        `${(ruinRate * 100).toFixed(1)}%`.padStart(8),
      ].join(''),
    );
  }

  lines.push('');
  lines.push('Right tail — is speculation still tempting?');
  lines.push('-'.repeat(96));
  lines.push(
    ['Strategy'.padEnd(28), 'p90'.padStart(12), 'p95'.padStart(12), 'p99'.padStart(12), 'max'.padStart(14), 'mean'.padStart(14)].join(''),
  );
  for (const { strategy, terminal } of report.outcomes) {
    lines.push(
      [
        strategy.name.padEnd(28),
        formatCents(terminal.p90).padStart(12),
        formatCents(terminal.p95).padStart(12),
        formatCents(terminal.p99).padStart(12),
        formatCents(terminal.max).padStart(14),
        formatCents(terminal.mean).padStart(14),
      ].join(''),
    );
  }

  lines.push('');
  lines.push('Head-to-head against all-in index, same seed');
  lines.push('-'.repeat(96));
  lines.push(
    ['Strategy'.padEnd(28), 'beats index'.padStart(14), 'ruin'.padStart(10), 'below cost'.padStart(14)].join(''),
  );
  for (const { strategy, beatsIndexRate, ruinRate, belowContributedRate } of report.outcomes) {
    lines.push(
      [
        strategy.name.padEnd(28),
        `${(beatsIndexRate * 100).toFixed(1)}%`.padStart(14),
        `${(ruinRate * 100).toFixed(1)}%`.padStart(10),
        `${(belowContributedRate * 100).toFixed(1)}%`.padStart(14),
      ].join(''),
    );
  }

  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seedCount = Number(process.argv[2] ?? 10_000);
  const started = Date.now();
  const report = runC1(seedCount);
  console.log(formatC1Report(report));
  console.log(`\ngenerated in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
