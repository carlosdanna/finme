import { describe, expect, it } from 'vitest';
import { outcomeFor, runC1 } from './c1.ts';

/**
 * C1 in CI. The full report runs 10,000 seeds (`pnpm -F @finme/sim c1`); this
 * runs 2,000, which reproduces every pass condition with room to spare and
 * costs ~1.5s. It is seeded, so it is deterministic rather than flaky.
 *
 * **Re-run the full report after any market or tax parameter change.** This test
 * is the guard, not the analysis.
 */
describe('C1 — speculation must not be optimal', () => {
  const report = runC1(2000);

  const index = outcomeFor(report, 'all-in-safe');
  const moon = outcomeFor(report, 'all-in-moon');
  const cryp = outcomeFor(report, 'all-in-cryp');
  const momentum = outcomeFor(report, 'momentum');
  const sixtyForty = outcomeFor(report, 'sixty-forty');

  it('gives every speculative strategy a clearly worse median than the index', () => {
    for (const outcome of [moon, cryp, momentum]) {
      expect(outcome.terminal.p50).toBeLessThan(index.terminal.p50 / 2);
    }
  });

  it('gives every speculative strategy a much higher ruin rate', () => {
    expect(index.ruinRate).toBeLessThan(0.02);
    expect(sixtyForty.ruinRate).toBeLessThan(0.01);
    expect(moon.ruinRate).toBeGreaterThan(0.2);
    expect(cryp.ruinRate).toBeGreaterThan(0.4);
    expect(momentum.ruinRate).toBeGreaterThan(0.2);
  });

  it('loses to the index in most worlds, seed for seed', () => {
    // The GDD's actual worry: "if a 14-year-old can discover that dumping
    // everything into Moonshot is the winning play."
    expect(moon.beatsIndexRate).toBeLessThan(0.35);
    expect(cryp.beatsIndexRate).toBeLessThan(0.2);
    expect(momentum.beatsIndexRate).toBeLessThan(0.35);
  });

  it('keeps a right tail fat enough to stay tempting', () => {
    // Attractive mean, losing median. If this ever fails, speculation has become
    // merely bad rather than a gamble, and the asset stops teaching anything.
    expect(moon.terminal.p99).toBeGreaterThan(index.terminal.p99 * 1.5);
    expect(cryp.terminal.p99).toBeGreaterThan(index.terminal.p99);
    expect(moon.terminal.max).toBeGreaterThan(index.terminal.max);
    expect(cryp.terminal.max).toBeGreaterThan(index.terminal.max);
  });

  it('buys downside protection with median return on 60/40', () => {
    // The lesson the allocation is meant to teach, and it has to be discoverable
    // from the numbers rather than from a tooltip.
    expect(sixtyForty.terminal.p10).toBeGreaterThan(index.terminal.p10);
    expect(sixtyForty.terminal.p50).toBeLessThan(index.terminal.p50);
  });

  it('never produces a non-finite outcome', () => {
    for (const outcome of report.outcomes) {
      for (const value of Object.values(outcome.terminal)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
}, 120_000);
