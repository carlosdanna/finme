import { useState } from 'react';
import { ASSETS, ASSET_IDS, type AssetId, type RunState, type RunWorld } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Pct } from '@/components/finme/Pct';
import { Term } from '@/components/finme/Term';
import { TradeModal, type TradeTarget } from './TradeModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { cn } from '@/lib/utils';

export type AutoInvest = { readonly assetId: AssetId; readonly weeklyCents: number } | null;

/**
 * The auto-invest order — GDD §6.8's one standing order that buys assets.
 *
 * An asset is picked by tapping it and cleared by tapping it again; there is no
 * pre-selected asset, because a default here would read as the game's opinion.
 * Every pill carries an identical class string and they render in declaration
 * order (GDD §1).
 */
function AutoInvest({
  order,
  onChange,
}: {
  order: AutoInvest;
  onChange: (order: AutoInvest) => void;
}) {
  const [dollars, setDollars] = useState(
    order === null ? '' : (order.weeklyCents / 100).toFixed(2),
  );

  const centsFrom = (text: string): number => {
    const value = Number(text.trim());
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  };

  const weeklyCents = centsFrom(dollars);

  const setAmount = (text: string) => {
    setDollars(text);
    if (order !== null) onChange({ assetId: order.assetId, weeklyCents: centsFrom(text) });
  };

  const toggle = (assetId: AssetId) => {
    if (order?.assetId === assetId) return onChange(null);
    onChange({ assetId, weeklyCents });
  };

  return (
    <Field>
      <FieldLabel htmlFor="auto-invest">Invest every week</FieldLabel>
      <Input
        id="auto-invest"
        className="h-11"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={dollars}
        onChange={(event) => setAmount(event.target.value)}
      />
      <div role="group" aria-label="Asset to buy" className="flex flex-wrap gap-2">
        {ASSET_IDS.map((id) => {
          const selected = order?.assetId === id;
          return (
            <Button
              key={id}
              type="button"
              variant="outline"
              aria-pressed={selected}
              // An order of nothing is stored as no order at all, so a pill
              // tapped before an amount is set would silently do nothing.
              disabled={weeklyCents === 0}
              onClick={() => toggle(id)}
              className={cn('min-h-11 flex-1 basis-40', selected && 'ring-2 ring-ring')}
            >
              {ASSETS[id].name}
            </Button>
          );
        })}
      </div>
      <FieldDescription>
        Set an amount, then choose what it buys. Taken from whatever cash is left after the
        other orders, at that week’s price.
      </FieldDescription>
    </Field>
  );
}

/**
 * The Investing panel.
 *
 * Assets are listed in a fixed order with their stated drift and volatility, and
 * nothing marks one as the sensible choice — same `Item` variant for every row,
 * and the Buy control reads the same on all five. The retirement contribution
 * slider is visible and unhighlighted: GDD §3.10 is explicit that discovering
 * the default is 0% in the epilogue is the lesson, so nothing here nudges
 * toward it.
 */
export function InvestingPanel({
  state,
  world,
  onBuy,
  onSell,
  onContributionChange,
  onAutoReinvestChange,
  onAutoInvestChange,
}: {
  state: RunState;
  world: RunWorld;
  onBuy?: (assetId: AssetId, cashCents: number) => void;
  onSell?: (assetId: AssetId, shares: number) => void;
  onContributionChange?: (pct: number) => void;
  onAutoReinvestChange?: (enabled: boolean) => void;
  onAutoInvestChange?: (order: AutoInvest) => void;
}) {
  const [target, setTarget] = useState<TradeTarget | null>(null);
  const week = state.weekIndex;
  const priceOf = (id: AssetId): number => world.market.series[id].priceCents[week];
  const tradable = onBuy !== undefined && onSell !== undefined;

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
              {tradable && (
                /* Buy and Sell are the same variant and the same size. GDD §3.2
                   allows both at any time, and the panel has no view on which. */
                <ItemFooter className="gap-2 border-t pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 flex-1"
                    onClick={() => setTarget({ assetId: id, side: 'buy' })}
                  >
                    Buy
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 flex-1"
                    disabled={shares <= 0}
                    onClick={() => setTarget({ assetId: id, side: 'sell' })}
                  >
                    Sell
                  </Button>
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

            <AutoInvest
              order={state.standingOrders.autoInvest}
              onChange={(order) => onAutoInvestChange?.(order)}
            />

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

      {tradable && target !== null && (
        <TradeModal
          target={target}
          state={state}
          world={world}
          onClose={() => setTarget(null)}
          onBuy={onBuy}
          onSell={onSell}
        />
      )}
    </div>
  );
}
