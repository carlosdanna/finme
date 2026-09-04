/**
 * Golden-seed snapshot serialization.
 *
 * The whole point is that this is *complete and stable*: every field of
 * `RunState` that a simulation change could move, in a fixed key order, with
 * floats rounded to 12 decimal places so a last-bit difference in a transcendental
 * does not produce a spurious CI failure.
 *
 * **If a snapshot test fails, the first question is "did I intend to change
 * simulation behaviour?" — never "let me update the fixture."**
 */
import type { RunState } from '@finme/engine';

const round = (value: number): number => Number(value.toFixed(12));

export function serializeState(state: RunState): Record<string, unknown> {
  return {
    seed: state.seed,
    rulesetVersion: state.rulesetVersion,
    weekIndex: state.weekIndex,
    startAge: state.startAge,
    runLengthYears: state.runLengthYears,

    cashCents: state.cashCents,
    savingsCents: state.savingsCents,
    emergencyFundCents: state.emergencyFundCents,
    emergencyStreakWeeks: state.emergencyStreakWeeks,

    holdings: Object.fromEntries(
      Object.entries(state.holdings)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, holding]) => [
          id,
          {
            shares: round(holding.shares),
            lots: holding.lots.map((lot) => ({
              assetId: lot.assetId,
              shares: round(lot.shares),
              purchasedWeek: lot.purchasedWeek,
              costBasisCents: lot.costBasisCents,
            })),
          },
        ]),
    ),
    retirement: {
      balanceCents: state.retirement.balanceCents,
      contributionPct: round(state.retirement.contributionPct),
    },

    job:
      state.job === null
        ? null
        : {
            jobId: state.job.jobId,
            startedWeek: state.job.startedWeek,
            weeklyGrossCents: state.job.weeklyGrossCents,
            workMode: state.job.workMode,
            standing: state.job.track.standing,
            terminationWeek: state.job.track.terminationWeek,
          },
    performance: round(state.performance),
    weeksUnemployed: state.weeksUnemployed,
    consecutiveOvertimeWeeks: state.consecutiveOvertimeWeeks,

    energy: round(state.energy),
    mood: round(state.mood),
    consecutiveLowMoodWeeks: state.consecutiveLowMoodWeeks,
    lastReachOutWeek: state.lastReachOutWeek,

    debts: state.debts.map((debt) => ({
      id: debt.id,
      kind: debt.kind,
      balanceCents: debt.balanceCents,
      aprAnnual: round(debt.aprAnnual),
      openedWeek: debt.openedWeek,
    })),
    accruedUnpaidBillsCents: state.accruedUnpaidBillsCents,
    credit: {
      score: state.credit.score,
      firstLineWeek: state.credit.firstLineWeek,
      oldestAccountWeek: state.credit.oldestAccountWeek,
      onTimeWeighted: round(state.credit.onTimeWeighted),
      missedWeighted: round(state.credit.missedWeighted),
      collections: state.credit.collections,
      bankruptcies: state.credit.bankruptcies,
      debtTypesEverHeld: [...state.credit.debtTypesEverHeld],
    },

    car: state.car,
    home: state.home,
    housingTier: state.housingTier,
    recurringExpenses: state.recurringExpenses.map((e) => ({ category: e.category, cents: e.cents })),

    eventHistory: Object.fromEntries(
      Object.entries(state.eventHistory).sort(([a], [b]) => a.localeCompare(b)),
    ),
    deferredEffects: state.deferredEffects.map((d) => ({ dueWeek: d.dueWeek, logbookKey: d.logbookKey ?? null })),
    flags: [...state.flags],

    ytd: Object.fromEntries(
      Object.entries(state.ytd).sort(([a], [b]) => a.localeCompare(b)),
    ),
    lastRaisePct: round(state.lastRaisePct),
    netWorthHistory: state.netWorthHistory.map((value) => Math.round(value)),

    logbook: {
      weeksSinceEntry: state.logbook.weeksSinceEntry,
      quietGap: state.logbook.quietGap,
    },
    /**
     * Only the count and the keys. The prose itself is deliberately excluded:
     * the §2.2 guarantee is that adding a variant changes no simulation value,
     * and pinning the text here would make that guarantee untestable.
     */
    logbookEntryCount: state.logbookEntries.length,
    logbookKeys: state.logbookEntries.map((entry) => entry.key),
  };
}
