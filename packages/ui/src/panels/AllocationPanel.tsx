import {
  type Allocation,
  TIME_POINTS_PER_WEEK,
  WORK_TIME_POINTS,
  type WorkMode,
  allocationPoints,
  nextEnergy,
  nextMood,
} from '@finme/engine';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Remove01Icon } from '@hugeicons/core-free-icons';
import { Meter } from '@/components/finme/Meter';
import { Typography } from '@/components/finme/Typography';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The weekly time allocation — **+/− steppers, not drag-and-drop.**
 *
 * Drag-and-drop on a phone competes with scrolling and has no keyboard story.
 * Steppers are unambiguous and reachable one-handed.
 *
 * The projected energy and mood update as the player adjusts, because the whole
 * point of §7.2's arithmetic is that the tradeoff is visible. It does not say
 * whether the split is a good one. They sit in the card's footer rather than in
 * a second card further down, so the tradeoff is on screen while it is being
 * made.
 *
 * Rows were ~250px tall, which put two activities on a phone screen and hid the
 * rest behind a scroll. At 56px all six fit at once on a 390x844 screen, which is
 * the only way the ten points read as a single decision.
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

/**
 * A stepper: a 36px circle with a 44px touch target.
 *
 * The visible control is smaller than the target it answers to. The `after:`
 * box extends the hit area past the circle's edge without changing the layout —
 * the same technique `Term` uses for the glossary trigger. Shrinking the circle
 * alone would have taken these under the 44px floor, and these are small
 * controls doing high-frequency work.
 */
function Stepper({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: 'plus' | 'minus';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      // `size="icon"` is the 36px circle; the focus ring, the disabled state and
      // the press translate all come from `Button` rather than being restated.
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'relative rounded-full bg-muted',
        'after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]',
      )}
    >
      <HugeiconsIcon
        icon={glyph === 'plus' ? Add01Icon : Remove01Icon}
        className="size-4"
        strokeWidth={2.2}
      />
    </Button>
  );
}

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
    /* `py-0` plus explicit section padding. The card previously kept its own
       block padding and the footer cancelled it again with a negative margin —
       two paddings fighting, which is what made the spacing look arbitrary. */
    <Card className="gap-0 py-0">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-4">
        <Typography variant="h4" as="h2">
          Time this week
        </Typography>
        <Typography variant="body" color="muted" className="tabular-nums">
          {used} of {TIME_POINTS_PER_WEEK} points
        </Typography>
      </div>

      <div className="space-y-3 p-4">
        {/* A segmented track — a recessed rail with one raised pill — rather than
            three joined outline buttons, which read as three separate controls
            with one inexplicably filled. */}
        <div role="group" aria-label="Work mode" className="flex gap-1 rounded-full bg-muted p-1">
          {WORK_MODES.map(({ mode, label }) => {
            const selected = allocation.work === mode;
            return (
              <Button
                key={mode}
                type="button"
                // The raised pill is just the default variant; the rail's
                // unselected segments are `ghost`, so neither restates a colour.
                variant={selected ? 'default' : 'ghost'}
                onClick={() => setWork(mode)}
                aria-pressed={selected}
                className={cn(
                  'h-11 flex-1 gap-1 rounded-full',
                  selected ? 'shadow-sm' : 'text-muted-foreground hover:bg-card',
                )}
              >
                {label}
                {WORK_TIME_POINTS[mode] > 0 && (
                  <Typography variant="caption" color="inherit" className="opacity-75">
                    {WORK_TIME_POINTS[mode]}p
                  </Typography>
                )}
              </Button>
            );
          })}
        </div>

        <div role="list" className="flex flex-col gap-1.5">
          {ACTIVITIES.map(({ key, label, detail }) => {
            const disabled = key === 'overtime' && allocation.work === 'none';
            return (
              <div
                key={key}
                role="listitem"
                className="flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2"
              >
                <div className="flex flex-1 flex-col gap-0.5">
                  <Typography variant="body" className="font-medium">
                    {label}
                  </Typography>
                  <Typography variant="caption" color="muted" className="text-pretty">
                    {detail}
                  </Typography>
                </div>
                <div className="flex items-center gap-1">
                  <Stepper
                    label={`One less point of ${label}`}
                    glyph="minus"
                    disabled={allocation[key] === 0}
                    onClick={() => step(key, -1)}
                  />
                  <Typography
                    variant="body"
                    as="span"
                    className="w-5 text-center font-medium tabular-nums"
                    aria-live="polite"
                  >
                    {allocation[key]}
                  </Typography>
                  <Stepper
                    label={`One more point of ${label}`}
                    glyph="plus"
                    disabled={disabled || remaining <= 0}
                    onClick={() => step(key, 1)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t bg-muted p-4">
        <Typography variant="caption" color="muted" className="mb-2 block">
          After this week
        </Typography>
        <div className="flex gap-4">
          {/* The footer sits on `muted`, which is also the meter track's own
              colour — the track needs the card surface here to stay visible. */}
          <Meter
            className="flex-1 [&_[data-slot=progress-track]]:bg-card"
            label="Energy"
            value={projectedEnergy}
          />
          <Meter
            className="flex-1 [&_[data-slot=progress-track]]:bg-card"
            label="Mood"
            value={projectedMood}
          />
        </div>
      </div>
    </Card>
  );
}
