/**
 * Variant selection — TDD §11.2.
 *
 * **Every draw here comes from the `flavor` stream, and `flavor` must never
 * influence simulation state.** That is what makes it safe for a reroll to
 * consume an unpredictable number of draws, and it is why adding a Logbook
 * variant can never change a number in any run.
 */
import type { Rng } from '../rng.ts';

/** [T] Avoid repeating any of the last 3 variants used for a key. */
export const ANTI_REPEAT_DEPTH = 3;

/** [T] Reroll at most this many times before accepting a repeat. */
export const MAX_REROLLS = 3;

/** The last few variant indices used, per template key. */
export type VariantMemory = Readonly<Record<string, readonly number[]>>;

export function emptyVariantMemory(): VariantMemory {
  return {};
}

export interface VariantChoice {
  readonly index: number;
  readonly memory: VariantMemory;
}

/**
 * Pick a variant index for `key`, avoiding the last few used.
 *
 * Rerolls consume the `flavor` stream, which is safe precisely because `flavor`
 * never touches simulation state. A pool smaller than the anti-repetition window
 * simply accepts a repeat after `MAX_REROLLS` attempts rather than looping.
 */
export function selectVariant(
  key: string,
  poolSize: number,
  rng: Rng,
  memory: VariantMemory,
): VariantChoice {
  if (poolSize <= 0) return { index: -1, memory };

  const recent = memory[key] ?? [];
  let index = Math.floor(rng() * poolSize);

  for (let attempt = 0; attempt < MAX_REROLLS && recent.includes(index); attempt++) {
    index = Math.floor(rng() * poolSize);
  }

  const nextRecent = [...recent, index].slice(-ANTI_REPEAT_DEPTH);
  return { index, memory: { ...memory, [key]: nextRecent } };
}
