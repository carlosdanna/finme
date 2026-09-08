/**
 * Seed generation and input cleanup — the UI half of TDD §2.3.
 *
 * Generation lives here because `Math.random` is banned in the engine. The
 * alphabet and length come from the engine so a minted seed cannot drift out of
 * what `isValidSeed` accepts.
 */
import { SEED_ALPHABET, SEED_LENGTH, parseSeedString } from '@finme/engine';

/** A fresh run seed, in the Crockford base32 the seed format specifies. */
export function randomSeed(length: number = SEED_LENGTH): string {
  let seed = '';
  for (let index = 0; index < length; index++) {
    seed += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return seed;
}

/**
 * Crockford's decode aliases. The alphabet omits I, L and O because they are
 * misread — which is exactly what a player typing one back has done. U is
 * dropped: it is excluded for a different reason and has no digit behind it.
 */
const DECODE_ALIASES: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0' };

/**
 * Clean up a seed a player typed or pasted: lower case, hyphens, and the full
 * `4F2A9C1B/v0.5.0` form all have to reach the same eight characters. Anything
 * still unrecognised is dropped rather than rejected, since the player is
 * mid-keystroke. The caller validates the result with `isValidSeed`.
 */
export function normalizeSeedInput(raw: string): string {
  const upper = raw.trim().toUpperCase();

  const parsed = parseSeedString(upper);
  if (parsed !== null) return parsed.seed;

  return [...upper]
    .map((character) => DECODE_ALIASES[character] ?? character)
    .filter((character) => SEED_ALPHABET.includes(character))
    .join('');
}
