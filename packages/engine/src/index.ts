/**
 * Public API surface of the FinMe simulation engine.
 *
 * Pure TypeScript. No React, no DOM, no browser globals, no `Math.random`,
 * no float dollars. Runs identically in Node and the browser — that is what
 * makes the balance harness in packages/sim possible.
 */
export { RULESET_VERSION } from './version.ts';

export { MemoryStorageAdapter } from './storage.ts';
export type { StorageAdapter } from './storage.ts';

// Time and the 4-4-5 calendar (TDD §1).
export {
  WEEKS_PER_YEAR,
  WEEKS_PER_QUARTER,
  MONTHS_PER_YEAR,
  MONTH_LENGTHS,
  MONTH_START_WEEK,
  QUARTER_START_WEEK,
  totalWeeks,
  yearIndex,
  weekOfYear,
  age,
  monthOfYear,
  quarterOfYear,
  weeksInMonth,
  weekOfMonth,
  isMonthBoundary,
  isYearBoundary,
  isQuarterBoundary,
} from './time.ts';

// Deterministic RNG (TDD §2).
export {
  PRE_DRAWN_STREAMS,
  IN_PLAY_STREAMS,
  STREAM_NAMES,
  mulberry32,
  fnv1a,
  stream,
  uniform,
  intIn,
  normal,
  pick,
} from './rng.ts';
export type { Rng, StreamName, PreDrawnStream, InPlayStream } from './rng.ts';

// Seed format (TDD §2.3).
export { isValidSeed, formatSeedString, parseSeedString, isCurrentRuleset } from './seed.ts';
export type { ParsedSeed } from './seed.ts';
