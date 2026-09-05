import { ASSETS, ASSET_IDS, type AssetId, type RunState, type RunWorld } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Pct } from '@/components/finme/Pct';
import { Term } from '@/components/finme/Term';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from '@/components/ui/item';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

/**
 * The Investing panel.
 *
 * Assets are listed in a fixed order with their stated drift and volatility, and
 * nothing marks one as the sensible choice — same `Item` variant for every row.
 * The retirement contribution slider is visible and unhighlighted: GDD §3.10 is
 * explicit that discovering the default is 0% in the epilogue is the lesson, so
 * nothing here nudges toward it.
 */
export function InvestingPanel({
  state,
  world,
  onContributionChange,
  onAutoReinvestChange,
}: {
  state: RunState;
  world: RunWorld;
  onContributionChange?: (pct: number) => void;
  onAutoReinvestChange?: (enabled: boolean) => void;
}) {
  const week = state.weekIndex;
  const priceOf = (id: AssetId): number => world.market.series[id].priceCents[week];

  return (
    <div className="space-y-6">
      <ItemGroup className="gap-2">
        {ASSET_IDS.map((id) => {
          const asset = ASSETS[id];
          const shares = state.holdings[id].shares;
          const price = priceOf(id);
          const yearAgo = world.market.series[id].priceCents[Math.max(0, week - 52)];
          return (
            <Item key={id} variant="outline" className="flex-col items-stretch">
              <ItemHeader>
                <ItemTitle className="text-base">{asset.name}</ItemTitle>
                <Money amountCents={price} showCents className="text-sm" />
              </ItemHeader>
              <ItemContent>
                <ItemDescription className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <Term id="volatility">Volatility</Term>{' '}
                    <Pct value={asset.volatility} decimals={0} />
                  </span>
                  {asset.dividendYield > 0 && (
                    <span>
                      <Term id="dividend">Dividend</Term> <Pct value={asset.dividendYield} />
                    </span>
                  )}
                  <span>
                    Last 52 weeks <Pct value={yearAgo === 0 ? 0 : price / yearAgo - 1} signed />
                  </span>
                </ItemDescription>
              </ItemContent>
              {shares > 0 && (
                <ItemFooter className="border-t pt-2 text-sm">
                  <span className="text-muted-foreground">{shares.toFixed(3)} shares</span>
                  <Money amountCents={Math.round(shares * price)} />
                </ItemFooter>
              )}
            </Item>
          );
        })}
      </ItemGroup>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standing orders</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="contribution" className="flex justify-between">
                <span>Retirement contribution</span>
                <span className="tabular-nums font-normal">
                  <Pct value={state.retirement.contributionPct} decimals={0} />
                </span>
              </FieldLabel>
              <Slider
                id="contribution"
                value={[state.retirement.contributionPct * 100]}
                max={20}
                step={1}
                onValueChange={(next) => {
                  const pct = Array.isArray(next) ? next[0] : (next as number);
                  onContributionChange?.(pct / 100);
                }}
              />
              <FieldDescription>
                Your employer adds an <Term id="employer-match">employer match</Term> on the first
                4%.
              </FieldDescription>
            </Field>

            <FieldSeparator />

            <Field orientation="horizontal">
              <FieldLabel htmlFor="reinvest">
                <Term id="auto-reinvest">Auto-reinvest</Term> dividends
              </FieldLabel>
              <Switch
                id="reinvest"
                checked={state.standingOrders.autoReinvestDividends}
                onCheckedChange={(checked: boolean) => onAutoReinvestChange?.(checked)}
              />
            </Field>
            <FieldDescription>
              Dividends are taxed in the year received, whether or not the cash arrives.
            </FieldDescription>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}
