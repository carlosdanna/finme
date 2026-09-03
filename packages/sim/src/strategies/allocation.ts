/**
 * The five scripted allocation strategies from GDD Appendix C1.
 *
 * None of these is a "correct answer" the game endorses — they are probes. C1
 * asks whether the market model makes speculation optimal, and these are the
 * shapes a player might plausibly land on.
 */
import { ASSET_IDS, type AssetId, WEEKS_PER_QUARTER, WEEKS_PER_YEAR } from '@finme/engine';
import type { Strategy, StrategyContext, Weights } from '../harness.ts';

const NEVER = () => false;
const ANNUALLY = (week: number) => week % WEEKS_PER_YEAR === 0;
const QUARTERLY = (week: number) => week % WEEKS_PER_QUARTER === 0;

/** All-in on a single asset. Never needs rebalancing — there is nothing to drift. */
function allIn(id: AssetId, name: string): Strategy {
  const weights: Weights = { [id]: 1 };
  return {
    id: `all-in-${id.toLowerCase()}`,
    name,
    targetWeights: () => weights,
    rebalancesOn: NEVER,
  };
}

export const ALL_IN_SAFE = allIn('SAFE', 'All-in SafeCo Index');
export const ALL_IN_MOON = allIn('MOON', 'All-in Moonshot Tech');
export const ALL_IN_CRYP = allIn('CRYP', 'All-in Crypto-ish');

/** The classic. Rebalanced once a year, which is where its edge comes from. */
export const SIXTY_FORTY: Strategy = {
  id: 'sixty-forty',
  name: '60/40 index/bond',
  targetWeights: () => ({ SAFE: 0.6, BOND: 0.4 }),
  rebalancesOn: ANNUALLY,
};

/**
 * "Chase whatever went up last quarter." Every quarter, move everything into the
 * asset with the best trailing 13-week return.
 *
 * This is the strategy a player is most likely to invent on their own, which is
 * exactly why C1 has to measure it.
 */
export const MOMENTUM: Strategy = {
  id: 'momentum',
  name: 'Chase last quarter\'s winner',
  targetWeights: ({ history, weekIndex }: StrategyContext): Weights => {
    // No trailing quarter to judge by yet: start somewhere neutral.
    if (weekIndex < WEEKS_PER_QUARTER) return { SAFE: 1 };

    let best: AssetId = ASSET_IDS[0];
    let bestReturn = -Infinity;
    // ASSET_IDS is a stable, ordered array — ties resolve the same way every run.
    for (const id of ASSET_IDS) {
      const prices = history.series[id].priceCents;
      const trailing = prices[weekIndex] / prices[weekIndex - WEEKS_PER_QUARTER];
      if (trailing > bestReturn) {
        bestReturn = trailing;
        best = id;
      }
    }
    return { [best]: 1 };
  },
  rebalancesOn: QUARTERLY,
};

/** In the order they are reported. */
export const C1_STRATEGIES: readonly Strategy[] = [
  ALL_IN_SAFE,
  SIXTY_FORTY,
  ALL_IN_MOON,
  ALL_IN_CRYP,
  MOMENTUM,
];
