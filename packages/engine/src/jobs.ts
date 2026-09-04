/**
 * Employment — GDD §3.1, with wage growth from TDD §6.2.
 *
 * Meeting a job's requirements makes it *applicable*, not granted. Applications
 * are rolled, and a failed one costs a time point and a little mood. That is
 * what keeps a career change tense rather than a checklist.
 *
 * **Credit score must never gate a job** (GDD §3.5). Nothing here reads it.
 */
import { clamp } from './math.ts';
import { weeklyGrossHourlyCents, weeklyGrossSalariedCents } from './income.ts';
import { type Rng, intIn } from './rng.ts';
import { WEEKS_PER_YEAR } from './time.ts';
import type { WorkMode } from './vitals.ts';

/** [F] Tiers, in order. Gated by education and experience, never by credit. */
export const JOB_TIERS = ['entry', 'skilled', 'professional', 'specialist'] as const;
export type JobTier = (typeof JOB_TIERS)[number];

export function tierRank(tier: JobTier): number {
  return JOB_TIERS.indexOf(tier);
}

export type JobPay =
  | { readonly kind: 'hourly'; readonly rateCents: number; readonly hoursPerWeek: number }
  | { readonly kind: 'salaried'; readonly annualSalaryCents: number };

export interface JobRequirements {
  readonly educationYears: number;
  readonly experienceYears: number;
}

export interface JobDef {
  readonly id: string;
  readonly title: string;
  readonly employer: string;
  readonly tier: JobTier;
  readonly pay: JobPay;
  readonly workMode: WorkMode;
  /** A first-class attribute: some roles simply cannot be reached without one. */
  readonly requiresVehicle: boolean;
  readonly requirements: JobRequirements;
  /**
   * Always on the board. There is always at least one of these, so the early
   * game can never dead-end with nothing to apply for.
   */
  readonly alwaysAvailable: boolean;
}

/** Weekly gross for a job, before tax. */
export function weeklyGrossCents(job: JobDef, overtimeHours = 0): number {
  if (job.pay.kind === 'salaried') return weeklyGrossSalariedCents(job.pay.annualSalaryCents);
  return weeklyGrossHourlyCents(
    job.pay.rateCents,
    job.pay.hoursPerWeek + overtimeHours,
    overtimeHours,
  );
}

// --- Eligibility ------------------------------------------------------------

export interface Applicant {
  readonly educationYears: number;
  readonly experienceYears: number;
  readonly hasVehicle: boolean;
}

export type IneligibleReason = 'education' | 'experience' | 'vehicle';

/** Why an applicant cannot apply, or an empty list if they can. */
export function ineligibleReasons(job: JobDef, applicant: Applicant): IneligibleReason[] {
  const reasons: IneligibleReason[] = [];
  if (applicant.educationYears < job.requirements.educationYears) reasons.push('education');
  if (applicant.experienceYears < job.requirements.experienceYears) reasons.push('experience');
  if (job.requiresVehicle && !applicant.hasVehicle) reasons.push('vehicle');
  return reasons;
}

export function isEligible(job: JobDef, applicant: Applicant): boolean {
  return ineligibleReasons(job, applicant).length === 0;
}

// --- Application rolls (GDD §3.1) -------------------------------------------

/** [T] Base odds before anything the player has done. */
export const APPLICATION_BASE = 0.35;
export const APPLICATION_PER_EXPERIENCE_YEAR = 0.15;
export const APPLICATION_EXPERIENCE_CAP = 0.45;
export const APPLICATION_NETWORKING_BONUS = 0.2;
export const APPLICATION_LONG_UNEMPLOYED_PENALTY = 0.2;

/** [T] Unemployment counts as long past six months. */
export const LONG_UNEMPLOYMENT_WEEKS = 26;

/** [F] Odds are always a real chance and never a certainty. */
export const APPLICATION_MIN_PROBABILITY = 0.05;
export const APPLICATION_MAX_PROBABILITY = 0.95;

/** [T] What a failed application costs. */
export const APPLICATION_TIME_POINTS = 1;
export const APPLICATION_FAILURE_MOOD_COST = 3;

export interface ApplicationContext {
  /** Years of experience relevant to *this* job. */
  readonly relevantExperienceYears: number;
  /** Whether a networking event has fired for this employer. */
  readonly hasNetworkingContact: boolean;
  /** Consecutive weeks unemployed. Zero while employed. */
  readonly weeksUnemployed: number;
}

/**
 * Odds of an application succeeding, bounded to 5-95%.
 *
 * Neither bound is reachable by the modifiers alone — the floor and ceiling
 * exist so that no future modifier can turn a job into a formality or an
 * impossibility.
 */
export function applicationProbability(context: ApplicationContext): number {
  const experience = Math.min(
    APPLICATION_PER_EXPERIENCE_YEAR * Math.max(0, context.relevantExperienceYears),
    APPLICATION_EXPERIENCE_CAP,
  );
  const networking = context.hasNetworkingContact ? APPLICATION_NETWORKING_BONUS : 0;
  const stale =
    context.weeksUnemployed > LONG_UNEMPLOYMENT_WEEKS ? APPLICATION_LONG_UNEMPLOYED_PENALTY : 0;

  return clamp(
    APPLICATION_BASE + experience + networking - stale,
    APPLICATION_MIN_PROBABILITY,
    APPLICATION_MAX_PROBABILITY,
  );
}

export interface ApplicationResult {
  readonly hired: boolean;
  readonly probability: number;
  /** Mood cost of a rejection. Zero on success. */
  readonly moodCost: number;
}

/**
 * Roll an application. One draw, from the `jobApplication` stream — the caller
 * supplies it, so this stays pure.
 */
export function rollApplication(rng: Rng, context: ApplicationContext): ApplicationResult {
  const probability = applicationProbability(context);
  const hired = rng() < probability;
  return { hired, probability, moodCost: hired ? 0 : APPLICATION_FAILURE_MOOD_COST };
}

// --- The seeded availability timeline ---------------------------------------

/**
 * [T] Openings per year, by tier. Higher tiers come up far less often, which is
 * what makes a specialist role something to wait and prepare for.
 *
 * The TDD does not specify these; see docs/DECISIONS.md.
 */
export const OPENINGS_PER_YEAR: Readonly<Record<JobTier, number>> = {
  entry: 3.0,
  skilled: 1.5,
  professional: 0.8,
  specialist: 0.4,
};

/** [T] How long an opening stays on the board. */
export const OPENING_WEEKS_MIN = 3;
export const OPENING_WEEKS_MAX = 8;

export interface JobOpening {
  readonly jobId: string;
  readonly openWeek: number;
  /** Exclusive. The opening is gone from this week on. */
  readonly closeWeek: number;
}

/**
 * Pre-draw every opening for the whole run from the `jobTimeline` stream.
 *
 * [F] Jobs are iterated in id-sorted order, and the whole timeline is drawn at
 * init. This is what guarantees two players sharing a seed see the same world
 * open the same doors at the same weeks, whatever either of them does.
 */
export function generateJobTimeline(
  rng: Rng,
  jobs: readonly JobDef[],
  weeks: number,
): JobOpening[] {
  const openings: JobOpening[] = [];
  // Sort by id: never iterate content in whatever order it was authored in.
  const ordered = [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const job of ordered) {
    if (job.alwaysAvailable) continue;

    const lambda = OPENINGS_PER_YEAR[job.tier];
    let week = 0;
    for (;;) {
      const u = Math.max(rng(), Number.MIN_VALUE);
      week += Math.max(1, Math.round((-Math.log(u) / lambda) * WEEKS_PER_YEAR));
      if (week >= weeks) break;

      const duration = intIn(rng, OPENING_WEEKS_MIN, OPENING_WEEKS_MAX);
      openings.push({ jobId: job.id, openWeek: week, closeWeek: Math.min(week + duration, weeks) });
    }
  }

  return openings;
}

/** Job ids on the board at a given week, always-available roles included. */
export function availableJobIds(
  timeline: readonly JobOpening[],
  jobs: readonly JobDef[],
  weekIndex: number,
): string[] {
  const open = new Set(jobs.filter((job) => job.alwaysAvailable).map((job) => job.id));
  for (const opening of timeline) {
    if (weekIndex >= opening.openWeek && weekIndex < opening.closeWeek) open.add(opening.jobId);
  }
  return [...open].sort();
}

/** Jobs the player can both see and apply for this week. */
export function applicableJobs(
  timeline: readonly JobOpening[],
  jobs: readonly JobDef[],
  applicant: Applicant,
  weekIndex: number,
): JobDef[] {
  const available = new Set(availableJobIds(timeline, jobs, weekIndex));
  return jobs
    .filter((job) => available.has(job.id) && isEligible(job, applicant))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
