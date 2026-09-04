import type { Granularity } from '@finme/engine';

/** The order the advance control cycles through, coarsest last. */
export const GRANULARITY_ORDER: readonly Granularity[] = [
  'week',
  'month',
  'season',
  'until-something-happens',
];

export const GRANULARITY_LABEL: Readonly<Record<Granularity, string>> = {
  week: 'Week',
  month: 'Month',
  season: 'Season',
  'until-something-happens': 'Until something happens',
};

export function nextGranularity(current: Granularity): Granularity {
  return GRANULARITY_ORDER[(GRANULARITY_ORDER.indexOf(current) + 1) % GRANULARITY_ORDER.length];
}
