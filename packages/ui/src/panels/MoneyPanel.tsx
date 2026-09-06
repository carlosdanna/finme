import { Fragment } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  BalanceScaleIcon,
  Calendar01Icon,
  ChartUpIcon,
  CreditCardIcon,
  PieChartIcon,
  RouteIcon,
} from '@hugeicons/core-free-icons';
import { Money } from '@/components/finme/Money';
import { Typography } from '@/components/finme/Typography';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Panel } from '@/store/useGameStore';

/**
 * The Money tab — a directory of the secondary panels.
 *
 * This was six identical outline buttons carrying nothing but a label, which
 * made a list of destinations look like a list of actions and gave no reason to
 * pick one. Grouping them and adding a supporting line answers "what is behind
 * this?" before the tap.
 *
 * **The supporting lines are descriptions, not figures**, except where a figure
 * comes from an engine selector the caller already has. Recomputing a budget or
 * a projection here would put simulation logic in the UI.
 */
interface Entry {
  readonly id: Exclude<Panel, null>;
  readonly label: string;
  readonly icon: IconSvgElement;
  readonly detail: React.ReactNode;
}

/**
 * The divider is a separate rule element, not a border on the row.
 *
 * `Button` carries `border border-transparent` on every side, which wins over
 * both a `border-b` on the row and `divide-y` on the card — those set a width
 * and leave the colour transparent, so the line renders invisibly.
 */
function Row({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onOpen}
      className="h-auto min-h-18 w-full justify-start gap-3 rounded-none px-4 py-3 text-left whitespace-normal"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-muted text-muted-foreground">
        <HugeiconsIcon icon={entry.icon} className="size-5" strokeWidth={2} />
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <Typography variant="h4" as="span">
          {entry.label}
        </Typography>
        <Typography variant="caption" color="muted">
          {entry.detail}
        </Typography>
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        className="size-[18px] shrink-0 text-muted-foreground"
      />
    </Button>
  );
}

export function MoneyPanel({
  debtCount,
  totalDebtCents,
  portfolioValueCents,
  yearsElapsed,
  endAge,
  onOpen,
}: {
  debtCount: number;
  totalDebtCents: number;
  portfolioValueCents: number;
  yearsElapsed: number;
  endAge: number;
  onOpen: (panel: Exclude<Panel, null>) => void;
}) {
  const groups: readonly { readonly title: string; readonly entries: readonly Entry[] }[] = [
    {
      title: 'This month',
      entries: [
        {
          id: 'budget',
          label: 'Budget',
          icon: PieChartIcon,
          detail: 'What comes in, what goes out',
        },
        {
          id: 'debts',
          label: 'Debts',
          icon: CreditCardIcon,
          detail:
            debtCount === 0 ? (
              'Nothing owed'
            ) : (
              <>
                {debtCount} {debtCount === 1 ? 'account' : 'accounts'} ·{' '}
                <Money amountCents={totalDebtCents} />
              </>
            ),
        },
        {
          id: 'investing',
          label: 'Investing',
          icon: ChartUpIcon,
          detail: <Money amountCents={portfolioValueCents} />,
        },
      ],
    },
    {
      title: 'The whole picture',
      entries: [
        {
          id: 'balance-sheet',
          label: 'Balance sheet',
          icon: BalanceScaleIcon,
          detail: 'What you own, what you owe',
        },
        {
          id: 'annual-review',
          label: 'Annual review',
          icon: Calendar01Icon,
          detail: yearsElapsed < 1 ? 'After the first year' : `Years 1 to ${yearsElapsed}`,
        },
        {
          id: 'epilogue',
          label: 'If nothing else changed',
          icon: RouteIcon,
          detail: `Where this run lands at ${endAge}`,
        },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.title} className="space-y-2">
          <Typography variant="caption" color="muted" as="h2" className="px-1">
            {group.title}
          </Typography>
          {/* `gap-0`: the card's own flex gap would hold the rows apart and leave
              each divider floating between them rather than joining them. */}
          <Card className="gap-0 py-0">
            {group.entries.map((entry, index) => (
              <Fragment key={entry.id}>
                {index > 0 && <div role="presentation" className="h-px bg-border" />}
                <Row entry={entry} onOpen={() => onOpen(entry.id)} />
              </Fragment>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
