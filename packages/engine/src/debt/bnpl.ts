/**
 * Buy Now Pay Later — TDD §5.3.
 *
 * The whole lesson is that it is debt that does not feel like debt, so the
 * obligation counts as a liability on the balance sheet **from the moment of
 * purchase** — before a single installment has been missed, and before anything
 * has gone wrong.
 */
import type { CreditEventKind } from '../credit.ts';
import type { Debt } from './types.ts';

/** [F] Four installments, due at weeks 0, 2, 4 and 6 from purchase. */
export const BNPL_INSTALLMENTS = 4;
export const BNPL_INSTALLMENT_WEEKS: readonly number[] = [0, 2, 4, 6];

/** [T] $7 per missed installment. */
export const BNPL_LATE_FEE_CENTS = 700;

/** [T] A second miss freezes new BNPL for 26 weeks. */
export const BNPL_FREEZE_WEEKS = 26;

/** [T] Three strikes and the balance goes to collections. */
export const BNPL_STRIKES_TO_COLLECTIONS = 3;

export type BnplStatus = 'active' | 'frozen' | 'collections' | 'settled';

export interface BnplPlan extends Debt {
  readonly kind: 'bnpl';
  readonly purchaseAmountCents: number;
  readonly installmentCents: number;
  readonly purchaseWeek: number;
  readonly installmentsPaid: number;
  readonly missedCount: number;
  readonly feesAccruedCents: number;
  readonly status: BnplStatus;
  /** Set on the second miss; no new BNPL until this week. */
  readonly frozenUntilWeek: number | null;
}

/** The weeks each installment falls due. */
export function installmentDueWeeks(plan: BnplPlan): number[] {
  return BNPL_INSTALLMENT_WEEKS.map((offset) => plan.purchaseWeek + offset);
}

/**
 * The amount of installment `index` (0-based). The last one absorbs the rounding
 * remainder so the four always sum to the purchase amount exactly.
 */
export function installmentAmountCents(plan: BnplPlan, index: number): number {
  if (index < BNPL_INSTALLMENTS - 1) return plan.installmentCents;
  return plan.purchaseAmountCents - plan.installmentCents * (BNPL_INSTALLMENTS - 1);
}

function remainingPrincipalCents(plan: BnplPlan): number {
  let remaining = plan.purchaseAmountCents;
  for (let i = 0; i < plan.installmentsPaid; i++) remaining -= installmentAmountCents(plan, i);
  return Math.max(0, remaining);
}

/**
 * Open a plan. The full purchase amount is a liability immediately — BNPL is
 * interest-free, so the APR is genuinely 0 until something is missed.
 */
export function openBnplPlan(options: {
  id: string;
  purchaseAmountCents: number;
  purchaseWeek: number;
}): BnplPlan {
  return {
    id: options.id,
    kind: 'bnpl',
    balanceCents: options.purchaseAmountCents,
    aprAnnual: 0,
    openedWeek: options.purchaseWeek,
    purchaseAmountCents: options.purchaseAmountCents,
    installmentCents: Math.round(options.purchaseAmountCents / BNPL_INSTALLMENTS),
    purchaseWeek: options.purchaseWeek,
    installmentsPaid: 0,
    missedCount: 0,
    feesAccruedCents: 0,
    status: 'active',
    frozenUntilWeek: null,
  };
}

/** Recompute the liability from the plan's own state. */
function withBalance(plan: BnplPlan): BnplPlan {
  const balanceCents = remainingPrincipalCents(plan) + plan.feesAccruedCents;
  const settled = balanceCents === 0 && plan.status !== 'collections';
  return { ...plan, balanceCents, status: settled ? 'settled' : plan.status };
}

export function payInstallment(plan: BnplPlan): { plan: BnplPlan; paidCents: number } {
  if (plan.installmentsPaid >= BNPL_INSTALLMENTS) return { plan, paidCents: 0 };
  const paidCents = installmentAmountCents(plan, plan.installmentsPaid);
  return {
    plan: withBalance({ ...plan, installmentsPaid: plan.installmentsPaid + 1 }),
    paidCents,
  };
}

export interface MissResult {
  readonly plan: BnplPlan;
  readonly feeChargedCents: number;
  /**
   * What to record against the credit file (§5.5).
   *
   * Kinds, not point deltas: the score is a recomputed composite, so there is
   * nothing for a "−80" to be subtracted from. §5.3's figures describe the
   * intent; §5.5 decides what it costs.
   */
  readonly creditEvents: readonly CreditEventKind[];
}

/**
 * Miss an installment, escalating on the three-strike track (§5.3):
 *
 *   1. late fee, missed payment recorded
 *   2. second fee, account frozen for 26 weeks
 *   3. collections — balance persists, no interest, derogatory mark recorded
 */
export function missInstallment(plan: BnplPlan, weekIndex: number): MissResult {
  if (plan.status === 'collections') {
    return { plan, feeChargedCents: 0, creditEvents: [] };
  }

  const missedCount = plan.missedCount + 1;

  if (missedCount >= BNPL_STRIKES_TO_COLLECTIONS) {
    // Sent to collections: the balance stops growing but does not go away.
    return {
      plan: withBalance({ ...plan, missedCount, status: 'collections' }),
      feeChargedCents: 0,
      // The third miss is a missed payment in its own right *and* the mark that
      // opens the collection. Both land — which is how a thin file gets near the
      // severity §5.3 describes, while a mature file barely notices.
      creditEvents: ['missed', 'collection'],
    };
  }

  const feesAccruedCents = plan.feesAccruedCents + BNPL_LATE_FEE_CENTS;
  const frozen = missedCount === 2;

  return {
    plan: withBalance({
      ...plan,
      missedCount,
      feesAccruedCents,
      status: frozen ? 'frozen' : plan.status,
      frozenUntilWeek: frozen ? weekIndex + BNPL_FREEZE_WEEKS : plan.frozenUntilWeek,
    }),
    feeChargedCents: BNPL_LATE_FEE_CENTS,
    creditEvents: ['missed'],
  };
}

/** Whether the player may open a new plan this week. */
export function canOpenNewPlan(plans: readonly BnplPlan[], weekIndex: number): boolean {
  return !plans.some(
    (plan) =>
      plan.status === 'collections' ||
      (plan.frozenUntilWeek !== null && weekIndex < plan.frozenUntilWeek),
  );
}
