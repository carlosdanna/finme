import { useState } from 'react';
import {
  ASSETS,
  type AssetId,
  type RealizedGain,
  type RunState,
  type RunWorld,
  sellLotsFifo,
} from '@finme/engine';
import { useIsMobile } from '@/hooks/use-mobile';
import { Money } from '@/components/finme/Money';
import { Term } from '@/components/finme/Term';
import { Typography } from '@/components/finme/Typography';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export interface TradeTarget {
  readonly assetId: AssetId;
  readonly side: 'buy' | 'sell';
}

/** One line of the preview. Label left, figure right, both `tabular-nums`. */
function Line({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

/** A cents amount from a text field. Never `parseFloat`, and never a float dollar. */
function centsFrom(text: string): number {
  const value = Number(text.trim());
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
}

function sharesFrom(text: string): number {
  const value = Number(text.trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Buy or sell one asset — `Sheet` below `md:`, `Dialog` above, the same rule the
 * event modal follows.
 *
 * Mounted only while a trade is open, so each one starts with an empty field: a
 * half-typed number from the last asset can never be confirmed against this one.
 *
 * The preview states what the trade does and nothing else. **No `destructive`
 * styling on any figure**, a realized loss included: `destructive` is reserved
 * for destructive *user actions* (GDD §1). There is no "are you sure", no
 * warning about volatility and no approval of a sale — the panel quotes the
 * arithmetic and the player decides.
 */
export function TradeModal({
  target,
  state,
  world,
  onClose,
  onBuy,
  onSell,
}: {
  target: TradeTarget;
  state: RunState;
  world: RunWorld;
  onClose: () => void;
  onBuy: (assetId: AssetId, cashCents: number) => void;
  onSell: (assetId: AssetId, shares: number) => void;
}) {
  const [amount, setAmount] = useState('');
  const isMobile = useIsMobile();

  const { assetId, side } = target;
  const asset = ASSETS[assetId];
  const holding = state.holdings[assetId];
  const price = world.market.series[assetId].priceCents[state.weekIndex];

  const title = `${side === 'buy' ? 'Buy' : 'Sell'} ${asset.name}`;

  const cashCents = Math.min(centsFrom(amount), state.cashCents);
  const shares = Math.min(sharesFrom(amount), holding.shares);
  const sale =
    side === 'sell' && shares > 0
      ? sellLotsFifo(holding.lots, assetId, shares, state.weekIndex, price)
      : null;
  const longTerm = sale === null ? [] : sale.realized.filter((lot) => lot.longTerm);
  const shortTerm = sale === null ? [] : sale.realized.filter((lot) => !lot.longTerm);
  const sum = (lots: readonly RealizedGain[]) =>
    lots.reduce((total, lot) => total + lot.gainCents, 0);

  const ready = side === 'buy' ? cashCents > 0 : shares > 0;

  const confirm = () => {
    if (!ready) return;
    if (side === 'buy') onBuy(assetId, cashCents);
    else onSell(assetId, shares);
    onClose();
  };

  const content = (
    <>
      <div className="mb-4">
        <Line label="Price today">
          <Money amountCents={price} showCents />
        </Line>
        <Line label={side === 'buy' ? 'Cash available' : 'Shares held'}>
          {side === 'buy' ? (
            <Money amountCents={state.cashCents} />
          ) : (
            holding.shares.toFixed(3)
          )}
        </Line>
      </div>

      <Field>
        <FieldLabel htmlFor="trade-amount">
          {side === 'buy' ? 'Amount to spend' : 'Shares to sell'}
        </FieldLabel>
        <div className="flex gap-2">
          <Input
            id="trade-amount"
            className="h-11 flex-1"
            inputMode="decimal"
            autoComplete="off"
            placeholder={side === 'buy' ? '0.00' : '0.000'}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() =>
              setAmount(
                side === 'buy'
                  ? (state.cashCents / 100).toFixed(2)
                  : String(holding.shares),
              )
            }
          >
            {side === 'buy' ? 'All cash' : 'Everything'}
          </Button>
        </div>
        <FieldDescription>
          {side === 'buy'
            ? 'Cash only. Savings and the emergency fund are left where they are.'
            : 'Sold oldest first, which is what decides the holding period.'}
        </FieldDescription>
      </Field>

      <div className="mt-4 border-t pt-3">
        {side === 'buy' ? (
          <>
            <Line label="Shares">{(cashCents / price).toFixed(3)}</Line>
            <Line label="Cash out">
              <Money amountCents={cashCents} showCents />
            </Line>
          </>
        ) : (
          <>
            <Line label="Shares out">{shares.toFixed(3)}</Line>
            <Line label="Cash in">
              <Money amountCents={sale?.proceedsCents ?? 0} showCents />
            </Line>
            <Line label={<Term id="capital-gain">Realized gain</Term>}>
              <Money amountCents={sum(sale?.realized ?? [])} showCents signed />
            </Line>
            {longTerm.length > 0 && (
              <Line label="Of which long-term, taxed at 15%">
                <Money amountCents={sum(longTerm)} showCents signed />
              </Line>
            )}
            {shortTerm.length > 0 && (
              <Line label="Of which short-term, taxed as income">
                <Money amountCents={sum(shortTerm)} showCents signed />
              </Line>
            )}
          </>
        )}
      </div>

      <Typography variant="caption" color="muted" className="mt-3 block text-pretty">
        {side === 'buy'
          ? 'Bought at this week’s price. No commission.'
          : 'Tax on a realized gain is settled at the end of the year, not now.'}
      </Typography>

      <div className="mt-5 flex gap-2">
        {/* `outline` on both, and the same size: neither doing this nor walking
            away is the answer the game prefers (GDD §1). */}
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClose}>
          Not now
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={!ready} onClick={confirm}>
          {side === 'buy' ? 'Buy' : 'Sell'}
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open onOpenChange={(open: boolean) => !open && onClose()}>
        <SheetContent side="bottom" className="max-h-[90dvh] gap-0 p-0">
          <SheetHeader className="flex-none pb-0">
            <SheetTitle className="text-left">{title}</SheetTitle>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 sm:px-6"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          >
            {content}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70dvh] overflow-y-auto overscroll-contain">{content}</div>
      </DialogContent>
    </Dialog>
  );
}
