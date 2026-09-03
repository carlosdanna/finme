/**
 * The payoff projection — TDD §5.1.
 *
 * Shown in the Debts panel, and the single most educational number in the game.
 * When a payment does not cover the interest, this returns `null` and the panel
 * renders **"Never"** — in the same neutral typography as any other number, with
 * no warning colour and no commentary. That word does more teaching than any
 * tooltip could.
 */

/**
 * Months to clear `balanceCents` paying `paymentCents` a month at `rate`:
 *
 *   n = −ln(1 − (balance · r) / payment) / ln(1 + r)
 *
 * Returns `null` when the debt never clears — that is, when the payment is at or
 * below the monthly interest. Also `null` for a non-positive payment.
 */
export function payoffMonths(
  balanceCents: number,
  rate: number,
  paymentCents: number,
): number | null {
  if (balanceCents <= 0) return 0;
  if (paymentCents <= 0) return null;

  // No interest: the balance just divides.
  if (rate <= 0) return Math.ceil(balanceCents / paymentCents);

  const monthlyInterest = balanceCents * rate;
  // The payment never touches principal. "Never".
  if (paymentCents <= monthlyInterest) return null;

  return -Math.log(1 - monthlyInterest / paymentCents) / Math.log(1 + rate);
}

/**
 * Total paid over the life of the debt at a fixed monthly payment, in integer
 * cents — or `null` when it never clears.
 */
export function totalPaidCents(
  balanceCents: number,
  rate: number,
  paymentCents: number,
): number | null {
  const months = payoffMonths(balanceCents, rate, paymentCents);
  if (months === null) return null;
  // The last payment is partial; charging a full one would overstate the cost.
  const full = Math.floor(months);
  const remainder = months - full;
  return Math.round(full * paymentCents + remainder * paymentCents);
}
