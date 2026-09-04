import {
  type Debt,
  cardPayoffMonths,
  minimumPaymentCents,
  monthlyRate,
  payoffMonths,
} from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Pct } from '@/components/finme/Pct';
import { Term } from '@/components/finme/Term';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPayoff } from '@/lib/format';

/**
 * The Debts panel — where the game does its most important teaching.
 *
 * **Card list below `md:`, table above.** A five-column table with APR, balance,
 * minimum and payoff projection is unreadable at 390px, and this cannot be the
 * panel that degrades worst. The payoff projection is visible in both.
 *
 * The "Never" projection renders in the same weight and colour as any other
 * number. No `destructive` styling appears anywhere in this file.
 *
 * The projection is computed against the payment the player is **actually
 * making**, not the minimum. §5.1's minimum is 2% of the balance *plus* the
 * interest, so it always touches principal and can never produce "Never" — the
 * word only appears when a standing order pays a fixed amount that the interest
 * has outgrown. Showing the minimum's projection would quietly hide the case
 * this panel exists to teach.
 */
interface DebtRow {
  readonly debt: Debt;
  readonly minimumCents: number;
  /** What the player's standing order actually pays, if it differs. */
  readonly payingCents: number;
  readonly payoff: number | null;
}

function toRow(debt: Debt, paymentFor?: (debt: Debt) => number | undefined): DebtRow {
  const override = paymentFor?.(debt);

  if (debt.kind === 'credit-card') {
    const card = debt as Parameters<typeof minimumPaymentCents>[0];
    const minimumCents = minimumPaymentCents(card);
    const paying = override ?? minimumCents;
    return { debt, minimumCents, payingCents: paying, payoff: cardPayoffMonths(card, paying) };
  }
  if (debt.kind === 'amortizing') {
    const loan = debt as Debt & { monthlyPaymentCents: number };
    const paying = override ?? loan.monthlyPaymentCents;
    return {
      debt,
      minimumCents: loan.monthlyPaymentCents,
      payingCents: paying,
      payoff: payoffMonths(debt.balanceCents, monthlyRate(debt.aprAnnual), paying),
    };
  }
  return { debt, minimumCents: debt.balanceCents, payingCents: override ?? debt.balanceCents, payoff: 0 };
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  'credit-card': 'Credit card',
  amortizing: 'Loan',
  bnpl: 'Buy Now Pay Later',
  payday: 'Payday loan',
  collections: 'In collections',
};

export function DebtsPanel({
  debts,
  paymentFor,
}: {
  debts: readonly Debt[];
  /** The standing order's payment for a debt, if it is not the minimum. */
  paymentFor?: (debt: Debt) => number | undefined;
}) {
  const rows = debts.map((debt) => toRow(debt, paymentFor));

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nothing owed.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Card list — the phone layout, and the design target. */}
      <ul className="space-y-3 md:hidden">
        {rows.map(({ debt, minimumCents, payingCents, payoff }) => (
          <li key={debt.id} className="rounded-lg border p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{KIND_LABEL[debt.kind] ?? debt.kind}</span>
              <Money amountCents={debt.balanceCents} className="text-lg font-semibold" />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  <Term id="apr" />
                </dt>
                <dd>
                  <Pct value={debt.aprAnnual} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {payingCents === minimumCents ? (
                    <Term id="minimum-payment">Minimum</Term>
                  ) : (
                    'Paying'
                  )}
                </dt>
                <dd>
                  <Money amountCents={payingCents} />
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">
                  <Term id="payoff-projection">Paid off in</Term>
                </dt>
                {/* Same weight, same colour, whatever it says. */}
                <dd className="tabular-nums">{formatPayoff(payoff)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {/* Table — the wide breakpoint. */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Debt</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">
                <Term id="apr" />
              </TableHead>
              <TableHead className="text-right">
                <Term id="minimum-payment">Paying</Term>
              </TableHead>
              <TableHead className="text-right">
                <Term id="payoff-projection">Paid off in</Term>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ debt, payingCents, payoff }) => (
              <TableRow key={debt.id}>
                <TableCell>{KIND_LABEL[debt.kind] ?? debt.kind}</TableCell>
                <TableCell className="text-right">
                  <Money amountCents={debt.balanceCents} />
                </TableCell>
                <TableCell className="text-right">
                  <Pct value={debt.aprAnnual} />
                </TableCell>
                <TableCell className="text-right">
                  <Money amountCents={payingCents} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatPayoff(payoff)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
