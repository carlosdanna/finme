import {
  type ActiveChain,
  type JobDef,
  type RunState,
  type RunWorld,
  WEEKS_PER_YEAR,
  applicableJobs,
  availableJobIds,
  chainById,
  ineligibleReasons,
  stepById,
  weeklyGrossCents,
} from '@finme/engine';
import { Money } from '@/components/finme/Money';
import { Nothing } from '@/components/finme/Nothing';
import { Stat } from '@/components/finme/Stat';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';

/** Plain statements of fact, never a judgement about the player. */
const REASON_TEXT: Readonly<Record<string, string>> = {
  education: 'Needs more study',
  experience: 'Needs more experience',
  vehicle: 'Needs a vehicle',
};

/** What each step of a search is, in the player's words rather than the data's. */
const STEP_TEXT: Readonly<Record<string, string>> = {
  prepare: 'Writing the application',
  interview: 'Waiting on an interview',
  interview_prepared: 'Waiting on an interview',
  offer: 'An offer to answer',
  rejected: 'Hearing back',
  gone: 'Hearing back',
};

/**
 * The Jobs panel — what you do now, and what else is going.
 *
 * Applying is not a button that hands over a job. It opens a search that runs
 * for several weeks (TDD §9.6), and the panel's job is to say where that search
 * has got to without ranking anything: no listing is marked as the one to take,
 * and an ineligible role states the requirement rather than commenting on the
 * player.
 */
export function JobsPanel({
  state,
  world,
  onApply,
  onStopLooking,
}: {
  state: RunState;
  world: RunWorld;
  onApply: (jobId: string) => void;
  onStopLooking: () => void;
}) {
  const week = state.weekIndex;
  const current = world.jobs.find((job) => job.id === state.job?.jobId);
  const search: ActiveChain | null =
    state.chains.find((entry) => entry.chainId === 'JOB_SEARCH') ?? null;

  const applicant = {
    educationYears: state.educationYears,
    experienceYears: Object.values(state.experienceWeeks).reduce((a, b) => a + b, 0) / WEEKS_PER_YEAR,
    hasVehicle: state.car !== null,
  };

  const openIds = new Set(availableJobIds(world.jobTimeline, world.jobs, week));
  const eligible = new Set(applicableJobs(world.jobTimeline, world.jobs, applicant, week).map((j) => j.id));
  // On the board this week, in a stable order that is not a ranking.
  const board = world.jobs
    .filter((job) => openIds.has(job.id) && job.id !== state.job?.jobId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const searchStep = (() => {
    if (search === null) return null;
    const chain = chainById(world.chainDefs, search.chainId);
    const step = chain === undefined ? undefined : stepById(chain, search.stepId);
    return step === undefined ? null : STEP_TEXT[step.id] ?? 'In progress';
  })();
  const searchTarget = world.jobs.find((job) => job.id === search?.target);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Current job"
          value={<span className="text-base">{current?.title ?? 'Not working'}</span>}
          hint={current?.employer}
        />
        <Stat
          label="Weekly pay"
          value={<Money amountCents={state.job?.weeklyGrossCents ?? 0} />}
          hint="before tax"
        />
      </div>

      {search !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              You are looking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {searchTarget === undefined
                ? 'A search is running.'
                : `${searchTarget.title} at ${searchTarget.employer}.`}{' '}
              {searchStep}
              {search.dueWeek > week ? `, in ${search.dueWeek - week} week${search.dueWeek - week === 1 ? '' : 's'}.` : '.'}
            </p>
            <Button variant="outline" size="lg" className="min-h-11 w-full" onClick={onStopLooking}>
              Stop looking
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            On the board this week
          </CardTitle>
        </CardHeader>
        <CardContent>
          {board.length === 0 ? (
            <Nothing
              title="Nothing open"
              description="Postings come and go on their own schedule."
            />
          ) : (
            <ItemGroup className="gap-0">
              {board.map((job) => (
                <Listing
                  key={job.id}
                  job={job}
                  eligible={eligible.has(job.id)}
                  applicant={applicant}
                  busy={search !== null}
                  onApply={() => onApply(job.id)}
                />
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Meeting the requirements makes a job applicable, not granted. An application takes a few
          weeks of your own time and it can come to nothing.
        </CardContent>
      </Card>
    </div>
  );
}

function Listing({
  job,
  eligible,
  applicant,
  busy,
  onApply,
}: {
  job: JobDef;
  eligible: boolean;
  applicant: { educationYears: number; experienceYears: number; hasVehicle: boolean };
  busy: boolean;
  onApply: () => void;
}) {
  const weekly = weeklyGrossCents(job);
  const reasons = ineligibleReasons(job, applicant);

  return (
    <Item size="sm" className="items-start">
      <ItemContent className="gap-0.5">
        <ItemTitle className="font-normal">{job.title}</ItemTitle>
        <ItemDescription className="text-xs">
          {job.employer} · <Money amountCents={weekly} className="text-xs" /> a week
        </ItemDescription>
        {reasons.length > 0 && (
          <ItemDescription className="text-xs">
            {reasons.map((reason) => REASON_TEXT[reason]).join(' · ')}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {/* Every listing gets the same button in the same variant. Nothing here
            says which one to take. `min-h-11` keeps the target at 44px. */}
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={!eligible || busy}
          onClick={onApply}
        >
          Apply
        </Button>
      </ItemActions>
    </Item>
  );
}
