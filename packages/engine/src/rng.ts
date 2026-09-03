/**
 * Deterministic RNG — TDD §2.
 *
 * `Math.random()` is banned in this package. Every draw comes from a named,
 * seeded stream, so that two players with the same seed live in the same world.
 *
 * Everything in this file is marked [F]. The generator, the stream derivation
 * and the draw counts are all part of the ruleset version: changing any of them
 * silently changes what every existing seed produces.
 */

/** A stream: call it for the next uniform in [0, 1). */
export type Rng = () => number;

/**
 * [F] Streams consumed entirely at run init into materialized arrays, then never
 * touched again. This is what guarantees the GDD §13 promise that two runs share
 * an identical world regardless of how either player behaves.
 */
export const PRE_DRAWN_STREAMS = [
  'startingDraw',
  'market',
  'jobTimeline',
  'eventSlots',
  'eventSelection',
] as const;

/** [F] Streams consumed during play, as the player's choices reach them. */
export const IN_PLAY_STREAMS = ['eventOutcome', 'jobApplication', 'flavor'] as const;

/** [F] The fixed stream set from TDD §2.2. Adding one is a ruleset change. */
export const STREAM_NAMES = [...PRE_DRAWN_STREAMS, ...IN_PLAY_STREAMS] as const;

export type PreDrawnStream = (typeof PRE_DRAWN_STREAMS)[number];
export type InPlayStream = (typeof IN_PLAY_STREAMS)[number];
export type StreamName = (typeof STREAM_NAMES)[number];

/**
 * [F] mulberry32. Chosen over PCG32 for implementation size; 32-bit state is
 * sufficient here and the output distribution is adequate for a game.
 */
export function mulberry32(a: number): Rng {
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [F] FNV-1a 32-bit. Mixes the run seed with the stream name. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * [F] Derive an independent stream from the run seed and a stream name.
 *
 * Each subsystem gets its own. Adding a die roll to one stream must never shift
 * another — that is the whole reason the streams are separate.
 */
export function stream(seed: string, name: StreamName): Rng {
  return mulberry32(fnv1a(`${seed}::${name}`));
}

/** Uniform in [lo, hi). One draw. */
export function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Integer in [lo, hi], inclusive at both ends. One draw. */
export function intIn(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Standard normal via Box-Muller.
 *
 * [F] Consumes exactly **two** draws every call. The second Box-Muller output is
 * deliberately discarded rather than cached: caching it would make the number of
 * draws consumed depend on call parity, so any refactor that changes how often
 * this is called would shift every downstream stream.
 */
export function normal(rng: Rng): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Pick one element. One draw.
 *
 * The caller is responsible for `arr` having a deterministic order — iterate
 * arrays sorted by stable id, never the values of an unordered map.
 */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
