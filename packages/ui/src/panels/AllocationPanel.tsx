import {
  type Allocation,
  TIME_POINTS_PER_WEEK,
  WORK_TIME_POINTS,
  type WorkMode,
  allocationPoints,
  nextEnergy,
  nextMood,
} from '@finme/engine';
import { Meter } from '@/components/finme/Meter';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item';

/**
 * The weekly time allocation — **+/− steppers, not drag-and-drop.**
 *
 * Drag-and-drop on a phone competes with scrolling and has no keyboard story.
 * Steppers are unambiguous, reachable one-handed, and every button here is 44px.
 *
 * The projected energy and mood update as the player adjusts, because the whole
 * point of §7.2's arithmetic is that the tradeoff is visible. It does not say
 * whether the split is a good one.
 */
const ACTIVITIES = [
  { key: 'rest', label: 'Rest', detail: '+18 energy, +2 mood' },
  { key: 'freeSocial', label: 'Social (free)', detail: '−2 energy, +7 mood' },
  { key: 'paidSocial', label: 'Social (paid)', detail: '−4 energy, +12 mood, costs money' },
  { key: 'study', label: 'Study', detail: '−8 energy, −2 mood' },
  { key: 'sideHustle', label: 'Side hustle', detail: '−14 energy, −4 mood, earns' },
  { key: 'overtime', label: 'Overtime', detail: '−12 energy, −6 mood, 1.5× pay' },
] as const;

const WORK_MODES: readonly { readonly mode: WorkMode; readonly label: string }[] = [
  { mode: 'none', label: 'None' },
  { mode: 'part-time', label: 'Part-time' },
  { mode: 'full-time', label: 'Full-time' },
];

export function AllocationPanel({
  allocation,
  energy,
  mood,
  onChange,
}: {
  allocation: Allocation;
  energy: number;
  mood: number;
  onChange: (allocation: Allocation) => void;
}) {
  const used = allocationPoints(allocation);
  const remaining = TIME_POINTS_PER_WEEK - used;

  const step = (key: (typeof ACTIVITIES)[number]['key'], delta: number): void => {
    const next = Math.max(0, allocation[key] + delta);
    if (delta > 0 && remaining <= 0) return;
    onChange({ ...allocation, [key]: next });
  };

  const setWork = (mode: WorkMode): void => {
    const cost = WORK_TIME_POINTS[mode] - WORK_TIME_POINTS[allocation.work];
    if (cost > remaining) return;
    onChange({ ...allocation, work: mode, overtime: mode === 'none' ? 0 : allocation.overtime });
  };

  const projectedEnergy = nextEnergy(energy, mood, allocation);
  const projectedMood = nextMood(mood, allocation, {
    discretionarySpendCents: 0,
    discretionaryBaselineCents: 40_000,
    housingTier: 1,
    unsecuredDebtCents: 0,
    annualGrossCents: 0,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between text-base">
            <span>Time this week</span>
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {used} of {TIME_POINTS_PER_WEEK} points
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ButtonGroup className="w-full">
            {WORK_MODES.map(({ mode, label }) => (
              <Button
                key={mode}
                type="button"
                variant={allocation.work === mode ? 'default' : 'outline'}
                onClick={() => setWork(mode)}
                aria-pressed={allocation.work === mode}
                className="h-11 flex-1"
              >
                {label}
                {WORK_TIME_POINTS[mode] > 0 && (
                  <span className="ml-1 text-xs opacity-70">{WORK_TIME_POINTS[mode]}p</span>
                )}
              </Button>
            ))}
          </ButtonGroup>

          <ItemGroup className="gap-2">
            {ACTIVITIES.map(({ key, label, detail }) => {
              const disabled = key === 'overtime' && allocation.work === 'none';
              return (
                <Item key={key} variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>{label}</ItemTitle>
                    <ItemDescription>{detail}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {/* 44px minimum on both steppers — small controls doing
                        high-frequency work. */}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11"
                      onClick={() => step(key, -1)}
                      disabled={allocation[key] === 0}
                      aria-label={`One less point of ${label}`}
                    >
                      −
                    </Button>
                    <span className="w-6 text-center tabular-nums" aria-live="polite">
                      {allocation[key]}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11"
                      onClick={() => step(key, 1)}
                      disabled={disabled || remaining <= 0}
                      aria-label={`One more point of ${label}`}
                    >
                      +
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">After this week</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Meter label="Energy after this week" value={projectedEnergy} />
          <Meter label="Mood after this week" value={projectedMood} />
        </CardContent>
      </Card>
    </div>
  );
}
