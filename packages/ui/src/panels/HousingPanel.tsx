import {
  type ActiveChain,
  HOME_PRICE_TO_RENT,
  HOME_SEARCH_DOWN_PAYMENT_PCT,
  HOUSING_TIER_RENT_CENTS,
  type RunState,
  type RunWorld,
  chainById,
  homeValueCents,
  housingMoodModifier,
  stepById,
  tierRentCents,
  yearIndex,
} from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Stat } from '@/components/finme/Stat';
import { Term } from '@/components/finme/Term';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';

/** Plain names for the tiers. No tier is described as better than another. */
const TIER_NAME: readonly string[] = [
  'A room in a shared flat',
  'A small one-bedroom',
  'A two-bedroom with a bit of light',
  'Somewhere with room to spare',
];

const STEP_TEXT: Readonly<Record<string, string>> = {
  brief: 'Working out how to look',
  viewings: 'Going to viewings',
  viewings_agent: 'Waiting on the agent',
  shortlist: 'Deciding on one',
  apply_rent: 'Waiting on the referencing',
  offer_buy: 'Waiting on the offer',
  move_in: 'Moving',
  completion: 'Waiting on completion',
  declined: 'Hearing back',
};

/**
 * The Housing panel — where you live, what else there is, and what moving costs.
 *
 * Moving is a search that runs for weeks, not a tier selector. Buying and
 * renting sit side by side with the same button and no commentary: the panel
 * states the rent, the price and the deposit, and the comparison is the
 * player's to make.
 */
export function HousingPanel({
  state,
  world,
  onLook,
  onStopLooking,
}: {
  state: RunState;
  world: RunWorld;
  onLook: (target: string) => void;
  onStopLooking: () => void;
}) {
  const week = state.weekIndex;
  const cpi = world.market.inflation.cpi[Math.min(yearIndex(week), state.runLengthYears)];
  const owns = state.home !== null;
  const rentNow = owns ? 0 : Math.round(tierRentCents(state.housingTier) * cpi);

  const search: ActiveChain | null =
    state.chains.find((entry) => entry.chainId === 'HOME_SEARCH') ?? null;
  const searchStep = (() => {
    if (search === null) return null;
    const chain = chainById(world.chainDefs, search.chainId);
    const step = chain === undefined ? undefined : stepById(chain, search.stepId);
    return step === undefined ? null : STEP_TEXT[step.id] ?? 'In progress';
  })();

  const tiers = HOUSING_TIER_RENT_CENTS.map((_, tier) => ({
    tier,
    rentCents: Math.round(tierRentCents(tier) * cpi),
    // §8.2 prices a home off the rent it replaces, never independently.
    priceCents: Math.round(tierRentCents(tier) * cpi * 12 * HOME_PRICE_TO_RENT),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Where you live"
          value={<span className="text-base">{owns ? 'A place you own' : TIER_NAME[state.housingTier]}</span>}
          hint={`Mood ${housingMoodModifier(state.housingTier) >= 0 ? '+' : ''}${housingMoodModifier(state.housingTier)}`}
        />
        <Stat
          label={owns ? 'What it is worth' : 'Monthly rent'}
          value={
            <Money
              amountCents={
                owns ? homeValueCents(state.home!, world.market.homeValuePath, week) : rentNow
              }
            />
          }
          hint={owns ? 'before the mortgage' : 'this year'}
        />
      </div>

      {search !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              You are looking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {searchStep}
              {search.dueWeek > week
                ? `, in ${search.dueWeek - week} week${search.dueWeek - week === 1 ? '' : 's'}.`
                : '.'}
            </p>
            <Button variant="outline" size="lg" className="min-h-11 w-full" onClick={onStopLooking}>
              Stop looking
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Renting</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-0">
            {tiers.map((entry) => (
              <Item key={`rent-${entry.tier}`} size="sm" className="items-start">
                <ItemContent className="gap-0.5">
                  <ItemTitle className="font-normal">{TIER_NAME[entry.tier]}</ItemTitle>
                  <ItemDescription className="text-xs">
                    <Money amountCents={entry.rentCents} className="text-xs" /> a month
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={search !== null || (!owns && entry.tier === state.housingTier)}
                    onClick={() => onLook(`rent-${entry.tier}`)}
                  >
                    Look
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Buying</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-0">
            {/* Tier 0 is a room in a shared flat, which is not a thing anyone
                buys. Buying starts where a whole place does. */}
            {tiers.slice(1).map((entry) => (
              <Item key={`buy-${entry.tier}`} size="sm" className="items-start">
                <ItemContent className="gap-0.5">
                  <ItemTitle className="font-normal">{TIER_NAME[entry.tier]}</ItemTitle>
                  <ItemDescription className="text-xs">
                    <Money amountCents={entry.priceCents} className="text-xs" /> ·{' '}
                    <Money
                      amountCents={Math.round(entry.priceCents * HOME_SEARCH_DOWN_PAYMENT_PCT)}
                      className="text-xs"
                    />{' '}
                    deposit
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={search !== null || owns}
                    onClick={() => onLook(`buy-${entry.tier}`)}
                  >
                    Look
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          A mortgage needs a deposit and a <Term id="credit-score">credit score</Term> of at least
          620. Looking takes weeks either way, and the viewings cost time whether or not anything
          comes of them.
        </CardContent>
      </Card>
    </div>
  );
}
