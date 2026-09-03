/**
 * Headless balance harness. Imports @finme/engine and @finme/content only —
 * never any UI code. Runs balance tests C1-C6 from GDD Appendix C.
 */
export {
  DEFAULT_CONFIG,
  harnessSeeds,
  runHarness,
  runStrategy,
  totalContributedCents,
} from './harness.ts';
export type { HarnessConfig, RunResult, Strategy, StrategyContext, Weights } from './harness.ts';

export { describe as describeDistribution, formatCents, percentile } from './stats.ts';
export type { Distribution } from './stats.ts';

export {
  ALL_IN_CRYP,
  ALL_IN_MOON,
  ALL_IN_SAFE,
  C1_STRATEGIES,
  MOMENTUM,
  SIXTY_FORTY,
} from './strategies/allocation.ts';

export { RUIN_THRESHOLD, formatC1Report, outcomeFor, runC1 } from './tests/c1.ts';
export type { C1Report, StrategyOutcome } from './tests/c1.ts';
