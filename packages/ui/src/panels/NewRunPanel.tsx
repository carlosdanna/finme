import { useState } from 'react';
import { isValidSeed } from '@finme/engine';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Refresh01Icon, Remove01Icon } from '@hugeicons/core-free-icons';
import { Typography } from '@/components/finme/Typography';
import { normalizeSeedInput, randomSeed } from '@/lib/seed';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type RunSetup, defaultSetup } from '@/store/useGameStore';

/** TDD §4.1's run lengths. */
const RUN_LENGTHS: readonly number[] = [10, 30, 40, 50];

/** [T] The span the age stepper allows. 18 is where the GDD's premise starts. */
const MIN_AGE = 18;
const MAX_AGE = 40;

/** A recessed rail with one raised pill — the control `AllocationPanel` uses for work mode. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-full bg-muted p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={String(option.value)}
            type="button"
            variant={selected ? 'default' : 'ghost'}
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              'h-11 flex-1 rounded-full tabular-nums',
              selected ? 'shadow-sm' : 'text-muted-foreground hover:bg-card',
            )}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The new-run screen.
 *
 * A longer run is not a harder one and an older start is not a worse one; the
 * screen says nothing about either (GDD §1). The seed is editable with a Reroll
 * beside it rather than buried, because GDD §13 makes it the unit of sharing.
 */
export function NewRunPanel({ onBegin }: { onBegin: (setup: RunSetup) => void }) {
  // Opens on a world nobody chose — GDD §3.7's "dealt, not picked".
  const [setup, setSetup] = useState<RunSetup>(() => defaultSetup(randomSeed()));

  const seedIsUsable = isValidSeed(setup.seed);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
          <div className="space-y-1">
            <Typography variant="h1" as="h1">
              A new life
            </Typography>
            <Typography variant="body" color="muted" className="text-pretty">
              Thirty years of weeks, one at a time. Everything below is fixed once you begin.
            </Typography>
          </div>

          <Card className="p-4 sm:p-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="player-name">Your name</FieldLabel>
                <Input
                  id="player-name"
                  value={setup.playerName}
                  autoComplete="off"
                  maxLength={24}
                  placeholder="Optional"
                  className="h-11"
                  onChange={(event) => setSetup({ ...setup, playerName: event.target.value })}
                />
                <FieldDescription>
                  Shown on your dashboard. It changes nothing about how the run plays.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="seed">Seed</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="seed"
                    value={setup.seed}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="h-11 flex-1 font-mono tracking-widest tabular-nums"
                    aria-invalid={!seedIsUsable}
                    onChange={(event) =>
                      setSetup({ ...setup, seed: normalizeSeedInput(event.target.value) })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSetup({ ...setup, seed: randomSeed() })}
                    aria-label="Reroll the seed"
                    className="size-11 shrink-0 rounded-full bg-muted"
                  >
                    <HugeiconsIcon icon={Refresh01Icon} className="size-4" strokeWidth={2} />
                  </Button>
                </div>
                <FieldDescription>
                  {seedIsUsable
                    ? 'Two runs of the same seed meet the same markets and the same openings. What either of you does with them is your own.'
                    : 'A seed is made of digits and letters, without I, L, O or U.'}
                </FieldDescription>
              </Field>

              <Field>
                <FieldTitle>How long</FieldTitle>
                <Segmented
                  label="Run length in years"
                  options={RUN_LENGTHS.map((years) => ({ value: years, label: `${years} yr` }))}
                  value={setup.runLengthYears}
                  onChange={(runLengthYears) => setSetup({ ...setup, runLengthYears })}
                />
                <FieldDescription>
                  You finish at {setup.startAge + setup.runLengthYears}.
                </FieldDescription>
              </Field>

              <Field>
                <FieldTitle id="start-age-label">Starting age</FieldTitle>
                <div
                  role="group"
                  aria-labelledby="start-age-label"
                  className="flex items-center gap-3"
                >
                  <Stepper
                    label="One year younger"
                    glyph="minus"
                    disabled={setup.startAge <= MIN_AGE}
                    onClick={() => setSetup({ ...setup, startAge: setup.startAge - 1 })}
                  />
                  <Typography variant="h3" as="p" className="min-w-10 text-center tabular-nums">
                    {setup.startAge}
                  </Typography>
                  <Stepper
                    label="One year older"
                    glyph="plus"
                    disabled={setup.startAge >= MAX_AGE}
                    onClick={() => setSetup({ ...setup, startAge: setup.startAge + 1 })}
                  />
                </div>
              </Field>
            </FieldGroup>
          </Card>
        </div>
      </main>

      <div
        className="flex-none border-t bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex h-16 max-w-2xl items-center px-4">
          <Button
            type="button"
            disabled={!seedIsUsable}
            onClick={() => onBegin(setup)}
            className="h-11 w-full rounded-full"
          >
            Begin
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A 36px circle with a 44px touch target: `after:` extends the hit area without
 * disturbing the layout, as `AllocationPanel`'s stepper and `Term` both do.
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
