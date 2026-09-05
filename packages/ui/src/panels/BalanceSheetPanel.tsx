import { type BalanceSheet } from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Term } from '@/components/finme/Term';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';

/**
 * The balance sheet — everything owned against everything owed.
 *
 * A negative net worth renders exactly like a positive one. It is a fact about a
 * Tuesday, not a verdict, so no `destructive` variant appears here.
 */
function Section({
  title,
  lines,
  totalLabel,
  totalCents,
  emptyLabel,
}: {
  title: string;
  lines: readonly { readonly label: string; readonly cents: number }[];
  totalLabel: string;
  totalCents: number;
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ItemGroup className="gap-0">
            {lines.map((line) => (
              <Item key={line.label} size="xs">
                <ItemContent>
                  <ItemTitle className="font-normal">{line.label}</ItemTitle>
                </ItemContent>
                <Money amountCents={line.cents} className="text-sm" />
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
      <CardFooter className="justify-between border-t pt-4 text-sm font-medium">
        <span>{totalLabel}</span>
        <Money amountCents={totalCents} />
      </CardFooter>
    </Card>
  );
}

export function BalanceSheetPanel({ sheet }: { sheet: BalanceSheet }) {
  return (
    <div className="space-y-4">
      <Section
        title="What you own"
        lines={sheet.assetLines}
        totalLabel="Total"
        totalCents={sheet.assetsCents}
        emptyLabel="Nothing yet."
      />
      <Section
        title="What you owe"
        lines={sheet.liabilityLines}
        totalLabel="Total"
        totalCents={sheet.liabilitiesCents}
        emptyLabel="Nothing."
      />

      <Card>
        <CardContent className="flex items-baseline justify-between gap-4 pt-6">
          <span className="font-medium">
            <Term id="net-worth">Net worth</Term>
          </span>
          <Money amountCents={sheet.netWorthCents} className="text-2xl font-semibold" />
        </CardContent>
      </Card>
    </div>
  );
}
