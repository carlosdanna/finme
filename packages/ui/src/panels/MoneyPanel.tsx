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
import { Card } from '@/components/ui/card';
import type { Panel } from '@/store/useGameStore';
import { cn } from '@/lib/utils';

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

function Row({ entry, onOpen, last }: { entry: Entry; onOpen: () => void; last: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        !last && 'border-b',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-muted text-muted-foreground">
        <HugeiconsIcon icon={entry.icon} size={20} strokeWidth={2} />
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
        size={18}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground"
      />
    </button>
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
          <Card className="py-0">
            {group.entries.map((entry, index) => (
              <Row
                key={entry.id}
                entry={entry}
                last={index === group.entries.length - 1}
                onOpen={() => onOpen(entry.id)}
              />
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
