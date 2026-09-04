import {
  type Allocation,
  TIME_POINTS_PER_WEEK,
  WORK_TIME_POINTS,
  type WorkMode,
  allocationPoints,
  nextEnergy,
  nextMood,
} from '@finme/engine';
import { Button } from '@/components/ui/button';
import { Stat } from '@/components/finme/Stat';

/**
 * The weekly time allocation — **+/− steppers, not drag-and-drop.**
 *
 * Drag-and-drop on a phone competes with scrolling and has no keyboard story.
 * Steppers are unambiguous, reachable one-handed, and every button here is 44px.
 *
 * The panel shows the projected energy and mood for the week as the player
 * adjusts, because the whole point of §7.2's arithmetic is that the tradeoff is
 * visible. It does not say whether the split is a good one.
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
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">Time this week</p>
        <p className="tabular-nums text-sm">
          {used} of {TIME_POINTS_PER_WEEK} points
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Work</p>
        <div className="flex gap-2">
          {WORK_MODES.map(({ mode, label }) => (
            <Button
              key={mode}
              type="button"
              variant={allocation.work === mode ? 'default' : 'outline'}
              onClick={() => setWork(mode)}
              className="h-11 flex-1"
            >
              {label}
              {WORK_TIME_POINTS[mode] > 0 && (
                <span className="ml-1 text-xs opacity-70">{WORK_TIME_POINTS[mode]}p</span>
              )}
            </Button>
          ))}
        </div>
      </div>

      <ul className="space-y-2">
        {ACTIVITIES.map(({ key, label, detail }) => {
          const disabled = key === 'overtime' && allocation.work === 'none';
          return (
            <li key={key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="truncate text-xs text-muted-foreground">{detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* 44px minimum on both steppers — they are small controls doing
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
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
        <Stat
          label="Energy after this week"
          value={Math.round(projectedEnergy)}
          hint={`now ${Math.round(energy)}`}
        />
        <Stat
          label="Mood after this week"
          value={Math.round(projectedMood)}
          hint={`now ${Math.round(mood)}`}
        />
      </div>
    </div>
  );
}
