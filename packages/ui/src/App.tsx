import { useEffect } from 'react';
import { ASSET_IDS, balanceSheet, carValueCents, homeValueCents, interpolate, portfolioValueCents } from '@finme/engine';
import { AdvanceControl } from '@/components/finme/AdvanceControl';
import { nextGranularity } from '@/lib/granularity';
import { TAB_BAR_CLEARANCE, TabBar } from '@/components/finme/TabBar';
import { AllocationPanel } from '@/panels/AllocationPanel';
import { BalanceSheetPanel } from '@/panels/BalanceSheetPanel';
import { BudgetPanel } from '@/panels/BudgetPanel';
import { DashboardPanel } from '@/panels/DashboardPanel';
import { AnnualReviewPanel } from '@/panels/AnnualReviewPanel';
import { DebtsPanel } from '@/panels/DebtsPanel';
import { EpiloguePanel } from '@/panels/EpiloguePanel';
import { EventModal } from '@/panels/EventModal';
import { InvestingPanel } from '@/panels/InvestingPanel';
import { LogbookPanel } from '@/panels/LogbookPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { type Panel, useGameStore } from '@/store/useGameStore';

const SECONDARY: readonly { readonly id: Exclude<Panel, null>; readonly label: string }[] = [
  { id: 'budget', label: 'Budget' },
  { id: 'debts', label: 'Debts' },
  { id: 'investing', label: 'Investing' },
  { id: 'balance-sheet', label: 'Balance sheet' },
  { id: 'allocation', label: 'This week' },
  { id: 'annual-review', label: 'Annual review' },
  { id: 'epilogue', label: 'If nothing else changed' },
];

/**
 * The app shell.
 *
 * Mobile-first: designed at 390x844, with `md:` as the wide breakpoint. Content
 * scrolls under a fixed bottom tab bar; the advance control floats in the
 * bottom-right thumb zone above it. `dvh` throughout, never `vh`.
 */
export default function App() {
  const { run, tab, panel, granularity, allocation, pendingEvent, rulesetBanner } = useGameStore();
  const { start, setTab, openPanel, setGranularity, setAllocation, advanceTime, resolveEvent } =
    useGameStore();

  useEffect(() => {
    if (run === null) start('4F2A9C1B');
  }, [run, start]);

  if (run === null) return null;
  const { state, world } = run;

  const sheet = balanceSheet({
    cashCents: state.cashCents,
    savingsCents: state.savingsCents,
    emergencyFundCents: state.emergencyFundCents,
    portfolioValueCents: portfolioValueCents(
      Object.fromEntries(ASSET_IDS.map((id) => [id, state.holdings[id].shares])),
      world.market,
      state.weekIndex,
    ),
    retirementBalanceCents: state.retirement.balanceCents,
    carValueCents: state.car === null ? 0 : carValueCents(state.car, state.weekIndex),
    homeValueCents:
      state.home === null ? 0 : homeValueCents(state.home, world.market.homeValuePath, state.weekIndex),
    debts: state.debts,
    accruedUnpaidBillsCents: state.accruedUnpaidBillsCents,
  });

  const panelTitle = SECONDARY.find((entry) => entry.id === panel)?.label ?? '';

  return (
    <div className="min-h-dvh bg-background">
      {rulesetBanner !== null && (
        <div className="mx-auto max-w-2xl px-4 pt-4">
          {/* Non-blocking, and `default` rather than `destructive`: a version
              mismatch is a fact about the save, not an error the player caused. */}
          <Alert>
            <AlertTitle>Loaded from a checkpoint</AlertTitle>
            <AlertDescription>{rulesetBanner}</AlertDescription>
          </Alert>
        </div>
      )}

      <main
        className="mx-auto max-w-2xl px-4 pt-6"
        style={{ paddingBottom: `calc(${TAB_BAR_CLEARANCE} + 6rem)` }}
      >
        {tab === 'dashboard' && <DashboardPanel state={state} />}

        {tab === 'money' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Money</h2>
            {/* Navigation rows are buttons, not `Item`s: `Item` is a display
                container with no `asChild`, and a tappable row must be a real
                button for keyboard and screen-reader users. */}
            <div className="flex flex-col gap-2">
              {SECONDARY.filter((entry) => entry.id !== 'allocation').map((entry) => (
                <Button
                  key={entry.id}
                  type="button"
                  variant="outline"
                  className="h-14 w-full justify-start rounded-2xl text-base"
                  onClick={() => openPanel(entry.id)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {tab === 'life' && (
          <AllocationPanel
            allocation={allocation}
            energy={state.energy}
            mood={state.mood}
            onChange={setAllocation}
          />
        )}

        {tab === 'logbook' && (
          <LogbookPanel entries={state.logbookEntries} snapshots={state.annualSnapshots} />
        )}
      </main>

      {/* Secondary panels open as sheets over the current tab. */}
      <Sheet open={panel !== null} onOpenChange={(open: boolean) => !open && openPanel(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh]"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        >
          <SheetHeader className="px-0">
            <SheetTitle className="text-left">{panelTitle}</SheetTitle>
          </SheetHeader>
          <ScrollArea className="max-h-[75dvh] pr-2">
          {panel === 'budget' && <BudgetPanel state={state} world={world} />}
          {panel === 'debts' && (
            <DebtsPanel
              debts={state.debts}
              paymentFor={() =>
                typeof state.standingOrders.debtPayment === 'object'
                  ? state.standingOrders.debtPayment.fixedCents
                  : undefined
              }
            />
          )}
          {panel === 'investing' && <InvestingPanel state={state} world={world} />}
          {panel === 'balance-sheet' && <BalanceSheetPanel sheet={sheet} />}
          {panel === 'annual-review' && <AnnualReviewPanel snapshots={state.annualSnapshots} />}
          {panel === 'epilogue' && <EpiloguePanel state={state} world={world} />}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <EventModal
        event={pendingEvent?.event ?? null}
        choiceIds={pendingEvent?.choiceIds ?? []}
        body={
          pendingEvent === null
            ? ''
            : interpolate(pendingEvent.event.body, {
                friendName: world.names.friendName,
                advisorName: world.names.advisorName,
              })
        }
        onChoose={resolveEvent}
      />

      <AdvanceControl
        granularity={granularity}
        onAdvance={advanceTime}
        onCycleGranularity={() => setGranularity(nextGranularity(granularity))}
        disabled={pendingEvent !== null}
      />

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
