import { describe, expect, it } from 'vitest';
import {
  IN_PLAY_STREAMS,
  PRE_DRAWN_STREAMS,
  STREAM_NAMES,
  type Rng,
  type StreamName,
  fnv1a,
  intIn,
  mulberry32,
  normal,
  pick,
  stream,
  uniform,
} from '../src/rng.ts';

const SEED = '4F2A9C1B';

/** Wraps a stream so a test can assert exactly how many draws something took. */
function counting(rng: Rng): { rng: Rng; get draws(): number } {
  let draws = 0;
  return {
    rng: () => {
      draws++;
      return rng();
    },
    get draws() {
      return draws;
    },
  };
}

function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng());
}

describe('mulberry32 (TDD §2.1)', () => {
  it('produces values in [0, 1)', () => {
    const rng = mulberry32(fnv1a('probe'));
    for (const value of take(rng, 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is a pure function of its 32-bit state', () => {
    expect(take(mulberry32(0), 5)).toEqual(take(mulberry32(0), 5));
    expect(take(mulberry32(1), 5)).not.toEqual(take(mulberry32(0), 5));
  });

  it('has a mean near 0.5 over a large sample', () => {
    const values = take(mulberry32(fnv1a('mean')), 100_000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });
});

describe('fnv1a (TDD §2.2)', () => {
  it('matches the reference 32-bit values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const name of STREAM_NAMES) {
      const h = fnv1a(`${SEED}::${name}`);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('stream derivation (TDD §2.2)', () => {
  it('lists the fixed stream set, pre-drawn and in-play', () => {
    expect([...PRE_DRAWN_STREAMS]).toEqual([
      'startingDraw',
      'market',
      'jobTimeline',
      'eventSlots',
      'eventSelection',
    ]);
    expect([...IN_PLAY_STREAMS]).toEqual(['eventOutcome', 'jobApplication', 'flavor']);
    expect(STREAM_NAMES).toHaveLength(8);
    expect(new Set(STREAM_NAMES).size).toBe(8);
  });

  it('produces identical sequences for the same seed and stream name', () => {
    for (const name of STREAM_NAMES) {
      expect(take(stream(SEED, name), 500)).toEqual(take(stream(SEED, name), 500));
    }
  });

  it('diverges immediately for the same seed and different stream names', () => {
    const firstDraws = new Map<StreamName, number>();
    for (const name of STREAM_NAMES) firstDraws.set(name, stream(SEED, name)());

    // Every pair differs on its very first draw, not merely somewhere later on.
    expect(new Set(firstDraws.values()).size).toBe(STREAM_NAMES.length);

    for (const a of STREAM_NAMES) {
      for (const b of STREAM_NAMES) {
        if (a === b) continue;
        expect(firstDraws.get(a)).not.toBe(firstDraws.get(b));
        expect(take(stream(SEED, a), 20)).not.toEqual(take(stream(SEED, b), 20));
      }
    }
  });

  it('diverges for different seeds on the same stream', () => {
    expect(take(stream('4F2A9C1B', 'market'), 20)).not.toEqual(
      take(stream('4F2A9C1C', 'market'), 20),
    );
  });

  it('keeps streams independent: draining one does not shift another', () => {
    const expected = take(stream(SEED, 'eventOutcome'), 5);

    const market = stream(SEED, 'market');
    take(market, 10_000);
    // Adding die rolls to `market` must never move `eventOutcome`.
    expect(take(stream(SEED, 'eventOutcome'), 5)).toEqual(expected);
  });

  it('is stable across builds: golden first draws for seed 4F2A9C1B', () => {
    // A determinism fixture. If this changes, the ruleset version must change
    // with it — every existing seed now produces a different world.
    expect(take(stream(SEED, 'market'), 4).map((v) => v.toFixed(12))).toEqual([
      '0.496520038694',
      '0.526068674168',
      '0.221283894731',
      '0.698723848676',
    ]);
    expect(take(stream(SEED, 'eventSlots'), 4).map((v) => v.toFixed(12))).toEqual([
      '0.372174235061',
      '0.957353968872',
      '0.493216901319',
      '0.527307196520',
    ]);
  });
});

describe('derived helpers (TDD §2.4)', () => {
  it('draws uniform values within [lo, hi) using one draw', () => {
    const c = counting(stream(SEED, 'flavor'));
    for (let i = 0; i < 1000; i++) {
      const v = uniform(c.rng, -5, 15);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(15);
    }
    expect(c.draws).toBe(1000);
  });

  it('draws integers inclusive at both ends using one draw', () => {
    const c = counting(stream(SEED, 'jobApplication'));
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = intIn(c.rng, 1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.draws).toBe(5000);
  });

  it('picks within bounds using one draw', () => {
    const arr = ['a', 'b', 'c', 'd'] as const;
    const c = counting(stream(SEED, 'flavor'));
    for (let i = 0; i < 1000; i++) {
      expect(arr).toContain(pick(c.rng, arr));
    }
    expect(c.draws).toBe(1000);
  });

  describe('normal()', () => {
    it('consumes exactly two draws per call', () => {
      const c = counting(stream(SEED, 'market'));
      normal(c.rng);
      expect(c.draws).toBe(2);

      normal(c.rng);
      expect(c.draws).toBe(4);

      for (let i = 0; i < 100; i++) normal(c.rng);
      expect(c.draws).toBe(204);
    });

    it('does not cache the second Box-Muller output across calls', () => {
      // If the pair were cached, the second normal() would consume no draws and
      // the interleaved raw draw below would land on a different value.
      const cached = stream(SEED, 'market');
      normal(cached);
      normal(cached);
      const afterTwoNormals = cached();

      const raw = stream(SEED, 'market');
      take(raw, 4);
      expect(afterTwoNormals).toBe(raw());
    });

    it('is computed from the draws in the documented order', () => {
      const raw = take(stream(SEED, 'market'), 2);
      const u1 = Math.max(raw[0], 1e-12);
      const u2 = raw[1];
      const expected = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      expect(normal(stream(SEED, 'market'))).toBe(expected);
    });

    it('is standard normal: mean ~0, sd ~1, and it produces both signs', () => {
      const rng = stream(SEED, 'market');
      const values = Array.from({ length: 50_000 }, () => normal(rng));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;

      expect(Math.abs(mean)).toBeLessThan(0.02);
      expect(Math.sqrt(variance)).toBeGreaterThan(0.98);
      expect(Math.sqrt(variance)).toBeLessThan(1.02);
      expect(values.some((v) => v > 0)).toBe(true);
      expect(values.some((v) => v < 0)).toBe(true);
    });

    it('never returns a non-finite value, even when u1 underflows to 0', () => {
      // Math.log(0) is -Infinity; the 1e-12 floor is what keeps this finite.
      const zeroThenHalf = (() => {
        let i = 0;
        return () => (i++ === 0 ? 0 : 0.5);
      })();
      expect(Number.isFinite(normal(zeroThenHalf))).toBe(true);
    });
  });
});
