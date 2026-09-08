import {
  ASSET_IDS,
  WEEKS_PER_YEAR,
  balanceSheet,
  carValueCents,
  homeValueCents,
  interpolate,
  monthOfYear,
  portfolioValueCents,
  totalLiabilitiesCents,
  yearIndex,
} from '@finme/engine';
import { assignedStartId } from '@finme/content';
import { AdvanceControl } from '@/components/finme/AdvanceControl';
import { nextGranularity } from '@/lib/granularity';
import { TabBar } from '@/components/finme/TabBar';
import { TopBar } from '@/components/finme/TopBar';
import { MoneyPanel } from '@/panels/MoneyPanel';
import { formatRunDate } from '@/lib/format';
import { AllocationPanel } from '@/panels/AllocationPanel';
import { BalanceSheetPanel } from '@/panels/BalanceSheetPanel';
import { BudgetPanel } from '@/panels/BudgetPanel';
import { DashboardPanel } from '@/panels/DashboardPanel';
import { AnnualReviewPanel } from '@/panels/AnnualReviewPanel';
import { DebtsPanel } from '@/panels/DebtsPanel';
import { EpiloguePanel } from '@/panels/EpiloguePanel';
import { EventModal } from '@/panels/EventModal';
import { HousingPanel } from '@/panels/HousingPanel';
import { InvestingPanel } from '@/panels/InvestingPanel';
import { JobsPanel } from '@/panels/JobsPanel';
import { LogbookPanel } from '@/panels/LogbookPanel';
import { NewRunPanel } from '@/panels/NewRunPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { type Panel, type Tab, useGameStore } from '@/store/useGameStore';

/** The header title for each primary tab. */
const TAB_TITLE: Readonly<Record<Tab, string>> = {
  dashboard: 'Dashboard',
  money: 'Money',
  life: 'Life',
  logbook: 'Logbook',
};

const SECONDARY: readonly { readonly id: Exclude<Panel, null>; readonly label: string }[] = [
  { id: 'budget', label: 'Budget' },
  { id: 'debts', label: 'Debts' },
  { id: 'investing', label: 'Investing' },
  { id: 'balance-sheet', label: 'Balance sheet' },
  { id: 'allocation', label: 'This week' },
  { id: 'jobs', label: 'Work' },
  { id: 'housing', label: 'Where you live' },
  { id: 'annual-review', label: 'Annual review' },
  { id: 'epilogue', label: 'If nothing else changed' },
];

/**
 * The app shell.
 *
 * Mobile-first: designed at 390x844, with `md:` as the wide breakpoint.
 *
 * **The shell is a column, not a stack of layers.** Header, scroller, advance
 * bar, tab bar — four rows of one flex column, all in normal flow. `main` is the
 * only thing that scrolls, so the bars cannot be scrolled past, cannot overlap
 * content, and need no `z-index` or reserved padding. The page itself never
 * scrolls; `dvh` throughout, never `vh`.
 *
 * The only stacking contexts left in the app are the modal portals, which are
 * inherent to an overlay.
 */
export default function App() {
  const { run, tab, panel, granularity, allocation, pendingEvent, pendingChainStep, rulesetBanner } =
    useGameStore();
  const { start, setTab, openPanel, setGranularity, setAllocation, advanceTime, resolveEvent } =
    useGameStore();
  const { startChain, abandonChain, resolveChainStep } = useGameStore();

  if (run === null) return <NewRunPanel onBegin={start} />;

  const { state, world } = run;

  // Event-computed values plus the two names the run drew at init. Event keys
  // are linted at load, so none can arrive here unresolved.
  // A week presents at most one card, so these are never both set.
  const card = pendingEvent ?? pendingChainStep;
  const onChooseCard = pendingEvent !== null ? resolveEvent : resolveChainStep;
  const cardVars = {
    ...(card?.vars ?? {}),
    friendName: world.names.friendName,
    advisorName: world.names.advisorName,
  };

  const portfolioCents = portfolioValueCents(
    Object.fromEntries(ASSET_IDS.map((id) => [id, state.holdings[id].shares])),
    world.market,
    state.weekIndex,
  );

  const sheet = balanceSheet({
    cashCents: state.cashCents,
    savingsCents: state.savingsCents,
    emergencyFundCents: state.emergencyFundCents,
    portfolioValueCents: portfolioCents,
    retirementBalanceCents: state.retirement.balanceCents,
    carValueCents: state.car === null ? 0 : carValueCents(state.car, state.weekIndex),
    homeValueCents:
      state.home === null ? 0 : homeValueCents(state.home, world.market.homeValuePath, state.weekIndex),
    debts: state.debts,
    accruedUnpaidBillsCents: state.accruedUnpaidBillsCents,
  });

  const panelTitle = SECONDARY.find((entry) => entry.id === panel)?.label ?? '';

  // The run clock belongs to the run, not to any one panel, so it renders in the
  // header on every screen rather than inside the dashboard's hero card.
  const clock = `${formatRunDate(
    yearIndex(state.weekIndex),
    monthOfYear(state.weekIndex % WEEKS_PER_YEAR),
  )} · ${state.startAge + yearIndex(state.weekIndex)}`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TopBar title={TAB_TITLE[tab]} clock={clock} />

      {/* A flex child defaults to `min-height: auto` and refuses to shrink below
          its content, which would let this grow instead of scrolling. `overflow-y:
          auto` already resolves that automatic minimum to 0, so `min-h-0` is
          belt-and-braces here rather than load-bearing — verified by removing it,
          which changes nothing. It is kept so the scroller survives someone
          taking the overflow off. */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl px-4 py-3">
          {state.startId !== assignedStartId(state.seed) && (
            /* GDD §3.7's Custom Start, stated as a fact about the run rather
               than a warning about the player — the same plain `Alert` the
               ruleset banner uses, and for the same reason: `default`, never
               `destructive`. Derived, not stored: a chosen start is exactly one
               the seed would not have dealt. */
            <Alert className="mb-3">
              <AlertTitle>A start you set yourself</AlertTitle>
              <AlertDescription>
                This seed deals a different beginning, so this run is not the one someone else
                gets from it.
              </AlertDescription>
            </Alert>
          )}

          {rulesetBanner !== null && (
            /* Non-blocking, and `default` rather than `destructive`: a version
               mismatch is a fact about the save, not an error the player caused. */
            <Alert className="mb-3">
              <AlertTitle>Loaded from a checkpoint</AlertTitle>
              <AlertDescription>{rulesetBanner}</AlertDescription>
            </Alert>
          )}

          {tab === 'dashboard' && <DashboardPanel state={state} />}

          {tab === 'money' && (
            <MoneyPanel
              debtCount={state.debts.length}
              totalDebtCents={totalLiabilitiesCents(state.debts)}
              portfolioValueCents={portfolioCents}
              yearsElapsed={yearIndex(state.weekIndex)}
              endAge={state.startAge + state.runLengthYears}
              onOpen={openPanel}
            />
          )}

          {tab === 'life' && (
            <div className="space-y-4">
              <AllocationPanel
                committedPoints={state.committedTimePoints}
                allocation={allocation}
                energy={state.energy}
                mood={state.mood}
                housingTier={state.housingTier}
                onChange={setAllocation}
              />
              {/* `size="lg"` is 40px tall; every touch target clears 44px. */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="min-h-11"
                  onClick={() => openPanel('jobs')}
                >
                  Work
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="min-h-11"
                  onClick={() => openPanel('housing')}
                >
                  Where you live
                </Button>
              </div>
            </div>
          )}

          {tab === 'logbook' && (
            <LogbookPanel entries={state.logbookEntries} snapshots={state.annualSnapshots} />
          )}
        </div>
      </main>

      {/* Secondary panels open as sheets over the current tab. */}
      <Sheet open={panel !== null} onOpenChange={(open: boolean) => !open && openPanel(null)}>
        {/* A column with one scrolling row. The header stays put and the body
            scrolls to its end — `ScrollArea` inside a `max-h` sheet nested two
            height limits that fought each other and stranded the last section. */}
        <SheetContent side="bottom" className="max-h-[90dvh] gap-0 p-0">
          <SheetHeader className="flex-none border-b">
            <SheetTitle className="text-left">{panelTitle}</SheetTitle>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 sm:px-6"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          >
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
            {panel === 'jobs' && (
              <JobsPanel
                state={state}
                world={world}
                onApply={(jobId) => startChain('JOB_SEARCH', jobId)}
                onStopLooking={() => abandonChain('JOB_SEARCH')}
              />
            )}
            {panel === 'housing' && (
              <HousingPanel
                state={state}
                world={world}
                onLook={(target) => startChain('HOME_SEARCH', target)}
                onStopLooking={() => abandonChain('HOME_SEARCH')}
              />
            )}
            {panel === 'annual-review' && <AnnualReviewPanel snapshots={state.annualSnapshots} />}
            {panel === 'epilogue' && <EpiloguePanel state={state} world={world} />}
          </div>
        </SheetContent>
      </Sheet>

      <EventModal
        event={card?.event ?? null}
        choiceIds={card?.choiceIds ?? []}
        title={card === null ? '' : interpolate(card.title, cardVars)}
        body={card === null ? '' : interpolate(card.body, cardVars)}
        onChoose={onChooseCard}
      />

      <AdvanceControl
        granularity={granularity}
        onAdvance={advanceTime}
        onCycleGranularity={() => setGranularity(nextGranularity(granularity))}
        disabled={card !== null}
      />

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
