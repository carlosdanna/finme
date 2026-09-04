import { ASSETS, ASSET_IDS, type AssetId, type RunState, type RunWorld } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Pct } from '@/components/finme/Pct';
import { Term } from '@/components/finme/Term';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';

/**
 * The Investing panel.
 *
 * Assets are listed in a fixed order with their stated drift and volatility, and
 * nothing marks one as the sensible choice. The retirement contribution slider
 * is visible and unhighlighted — GDD §3.10 is explicit that discovering the
 * default is 0% in the epilogue is the lesson, so nothing here nudges toward it.
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
      <ul className="space-y-2">
        {ASSET_IDS.map((id) => {
          const asset = ASSETS[id];
          const shares = state.holdings[id].shares;
          const price = priceOf(id);
          const yearAgo = world.market.series[id].priceCents[Math.max(0, week - 52)];
          return (
            <li key={id} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{asset.name}</span>
                <Money amountCents={price} showCents className="text-sm" />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <Term id="volatility">Volatility</Term> <Pct value={asset.volatility} decimals={0} />
                </span>
                {asset.dividendYield > 0 && (
                  <span>
                    <Term id="dividend">Dividend</Term> <Pct value={asset.dividendYield} />
                  </span>
                )}
                <span>
                  Last 52 weeks <Pct value={yearAgo === 0 ? 0 : price / yearAgo - 1} signed />
                </span>
              </div>
              {shares > 0 && (
                <div className="mt-2 flex justify-between border-t pt-2 text-sm">
                  <span className="text-muted-foreground">{shares.toFixed(3)} shares</span>
                  <Money amountCents={Math.round(shares * price)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <section className="space-y-4 rounded-lg border p-4">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="contribution" className="text-sm font-medium">
              Retirement contribution
            </label>
            <span className="tabular-nums text-sm">
              <Pct value={state.retirement.contributionPct} decimals={0} />
            </span>
          </div>
          <Slider
            id="contribution"
            className="mt-3"
            value={[state.retirement.contributionPct * 100]}
            max={20}
            step={1}
            onValueChange={(next) => {
              const pct = Array.isArray(next) ? next[0] : (next as number);
              onContributionChange?.(pct / 100);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Your employer adds an <Term id="employer-match">employer match</Term> on the first 4%.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <label htmlFor="reinvest" className="text-sm">
            <Term id="auto-reinvest">Auto-reinvest</Term> dividends
          </label>
          <Switch
            id="reinvest"
            checked={state.standingOrders.autoReinvestDividends}
            onCheckedChange={(checked: boolean) => onAutoReinvestChange?.(checked)}
          />
        </div>
      </section>
    </div>
  );
}
