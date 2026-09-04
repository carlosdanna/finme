import { type BalanceSheet } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Term } from '@/components/finme/Term';
import { Separator } from '@/components/ui/separator';

/**
 * The balance sheet — everything owned against everything owed.
 *
 * A negative net worth is rendered exactly like a positive one. It is a fact
 * about a Tuesday, not a verdict.
 */
export function BalanceSheetPanel({ sheet }: { sheet: BalanceSheet }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">What you own</h3>
        <dl className="space-y-1.5">
          {sheet.assetLines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4 text-sm">
              <dt>{line.label}</dt>
              <dd>
                <Money amountCents={line.cents} />
              </dd>
            </div>
          ))}
          {sheet.assetLines.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          )}
        </dl>
        <div className="mt-2 flex justify-between gap-4 border-t pt-2 text-sm font-medium">
          <span>Total</span>
          <Money amountCents={sheet.assetsCents} />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">What you owe</h3>
        <dl className="space-y-1.5">
          {sheet.liabilityLines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4 text-sm">
              <dt>{line.label}</dt>
              <dd>
                <Money amountCents={line.cents} />
              </dd>
            </div>
          ))}
          {sheet.liabilityLines.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing.</p>
          )}
        </dl>
        <div className="mt-2 flex justify-between gap-4 border-t pt-2 text-sm font-medium">
          <span>Total</span>
          <Money amountCents={sheet.liabilitiesCents} />
        </div>
      </section>

      <Separator />

      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">
          <Term id="net-worth">Net worth</Term>
        </span>
        <Money amountCents={sheet.netWorthCents} className="text-2xl font-semibold" />
      </div>
    </div>
  );
}
