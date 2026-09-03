/**
 * Seed format — TDD §2.3.
 *
 *   {BASE32_SEED}/v{RULESET_VERSION}     e.g.  4F2A9C1B/v1.3
 *
 * The ruleset version travels with the seed because a seed only means anything
 * under the ruleset that produced it. On a mismatch the game still loads the run
 * — it just stops claiming the run is comparable (TDD §14).
 */
import { RULESET_VERSION } from './version.ts';

/** Crockford base32: no I, L, O or U, so a seed can be read aloud unambiguously. */
const SEED_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const SEED_PATTERN = new RegExp(`^[${SEED_ALPHABET}]+$`);

const SEED_STRING_PATTERN = new RegExp(`^([${SEED_ALPHABET}]+)/v(\\d+\\.\\d+\\.\\d+|\\d+\\.\\d+)$`);

export interface ParsedSeed {
  /** The base32 run seed on its own — what the RNG streams are derived from. */
  seed: string;
  /** The ruleset version the run was created under. */
  rulesetVersion: string;
}

/** True if `seed` is a well-formed base32 run seed (without the version suffix). */
export function isValidSeed(seed: string): boolean {
  return seed.length > 0 && SEED_PATTERN.test(seed);
}

/** Render a run seed for display, sharing and export. */
export function formatSeedString(seed: string, rulesetVersion = RULESET_VERSION): string {
  return `${seed}/v${rulesetVersion}`;
}

/**
 * Parse a shared seed string. Returns `null` on anything malformed — a seed
 * typed in by hand is untrusted input, so this never throws.
 *
 * A version *mismatch* is not a parse failure: the caller compares against
 * RULESET_VERSION itself and decides whether to show the banner.
 */
export function parseSeedString(input: string): ParsedSeed | null {
  const match = SEED_STRING_PATTERN.exec(input.trim().toUpperCase().replace('/V', '/v'));
  if (match === null) return null;
  return { seed: match[1], rulesetVersion: match[2] };
}

/** Whether a parsed seed was created under the ruleset this build implements. */
export function isCurrentRuleset(parsed: ParsedSeed): boolean {
  return parsed.rulesetVersion === RULESET_VERSION;
}
