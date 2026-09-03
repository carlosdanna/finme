import { describe, expect, it } from 'vitest';
import golden from './golden/market-4F2A9C1B-30y.json' with { type: 'json' };
import { ASSET_IDS, type AssetId, generateMarket } from '../src/market.ts';

/**
 * The RNG-consumption contract, pinned to concrete numbers.
 *
 * Byte-identity between two runs of the same build proves nothing about a
 * refactor: reversing the order assets draw their shocks in, or inserting a draw
 * anywhere in the sequence, leaves every same-build comparison passing while
 * silently changing what every shared seed produces. Only a committed fixture
 * catches that.
 *
 * **If this test fails, the first question is "did I intend to change simulation
 * behaviour?" — never "let me update the fixture."** If the change was intended,
 * the ruleset version moves in the same commit, with an entry in DECISIONS.md.
 */
describe('golden market fixture: seed 4F2A9C1B, 30 years', () => {
  const history = generateMarket(golden.seed, golden.runLengthYears);

  it('matches the committed run shape', () => {
    expect(history.weeks).toBe(golden.weeks);
    expect(history.episodes).toHaveLength(golden.episodeCount);
  });

  it('matches the committed prices at every sampled week', () => {
    for (const id of ASSET_IDS) {
      const expected = golden.priceCents[id as keyof typeof golden.priceCents];
      const actual = golden.sampleWeeks.map((w) => history.series[id as AssetId].priceCents[w]);
      expect(actual).toEqual(expected);
    }
  });

  it('matches the committed regime timeline', () => {
    const actual = history.episodes.slice(0, golden.firstEpisodes.length).map((e) => ({
      ...e,
      depth: Number(e.depth.toFixed(12)),
    }));
    expect(actual).toEqual(golden.firstEpisodes);
  });

  it('matches the committed inflation path', () => {
    const actual = [...history.inflation.annualRate]
      .slice(0, golden.inflationRates.length)
      .map((r) => Number(r.toFixed(12)));
    expect(actual).toEqual(golden.inflationRates);
    expect(Number(history.inflation.cpi[golden.runLengthYears].toFixed(12))).toBe(golden.finalCpi);
  });
});
