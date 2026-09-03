import { describe, expect, it } from 'vitest';
import { RULESET_VERSION } from '../src/version.ts';
import { formatSeedString, isCurrentRuleset, isValidSeed, parseSeedString } from '../src/seed.ts';

describe('seed format (TDD §2.3)', () => {
  it('formats as {BASE32_SEED}/v{RULESET_VERSION}', () => {
    expect(formatSeedString('4F2A9C1B', '1.3')).toBe('4F2A9C1B/v1.3');
    expect(formatSeedString('4F2A9C1B')).toBe(`4F2A9C1B/v${RULESET_VERSION}`);
  });

  it('round-trips a formatted seed', () => {
    const parsed = parseSeedString(formatSeedString('4F2A9C1B'));
    expect(parsed).toEqual({ seed: '4F2A9C1B', rulesetVersion: RULESET_VERSION });
  });

  it('accepts the example from the TDD', () => {
    expect(parseSeedString('4F2A9C1B/v1.3')).toEqual({
      seed: '4F2A9C1B',
      rulesetVersion: '1.3',
    });
  });

  it('tolerates the whitespace and casing of a hand-typed seed', () => {
    expect(parseSeedString('  4f2a9c1b/v1.3  ')).toEqual({
      seed: '4F2A9C1B',
      rulesetVersion: '1.3',
    });
  });

  it('returns null rather than throwing on malformed input', () => {
    for (const bad of ['', '4F2A9C1B', '/v1.3', '4F2A9C1B/1.3', '4F2A9C1B/vX', 'not a seed']) {
      expect(parseSeedString(bad)).toBeNull();
    }
  });

  it('rejects base32 characters that are ambiguous when read aloud', () => {
    for (const letter of ['I', 'L', 'O', 'U']) {
      expect(isValidSeed(`4F2A9C${letter}B`)).toBe(false);
    }
    expect(isValidSeed('4F2A9C1B')).toBe(true);
    expect(isValidSeed('')).toBe(false);
  });

  it('treats a version mismatch as parseable but not current', () => {
    const older = parseSeedString('4F2A9C1B/v0.0.1');
    expect(older).not.toBeNull();
    expect(isCurrentRuleset(older!)).toBe(false);
    expect(isCurrentRuleset({ seed: '4F2A9C1B', rulesetVersion: RULESET_VERSION })).toBe(true);
  });
});
