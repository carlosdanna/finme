import { describe, expect, it } from 'vitest';
import {
  APPLICATION_BASE,
  APPLICATION_EXPERIENCE_CAP,
  APPLICATION_FAILURE_MOOD_COST,
  APPLICATION_MAX_PROBABILITY,
  APPLICATION_MIN_PROBABILITY,
  APPLICATION_NETWORKING_BONUS,
  APPLICATION_PER_EXPERIENCE_YEAR,
  type Applicant,
  type ApplicationContext,
  JOB_TIERS,
  type JobDef,
  LONG_UNEMPLOYMENT_WEEKS,
  applicableJobs,
  applicationProbability,
  availableJobIds,
  generateJobTimeline,
  ineligibleReasons,
  isEligible,
  rollApplication,
  tierRank,
  weeklyGrossCents,
} from '../src/jobs.ts';
import { stream } from '../src/rng.ts';
import { totalWeeks } from '../src/time.ts';

const WEEKS = totalWeeks(30);

const job = (partial: Partial<JobDef> & Pick<JobDef, 'id'>): JobDef => ({
  title: 'A Job',
  employer: 'An Employer',
  tier: 'entry',
  pay: { kind: 'hourly', rateCents: 1600, hoursPerWeek: 40 },
  workMode: 'full-time',
  requiresVehicle: false,
  requirements: { educationYears: 0, experienceYears: 0 },
  alwaysAvailable: false,
  ...partial,
});

const applicant = (partial: Partial<Applicant> = {}): Applicant => ({
  educationYears: 0,
  experienceYears: 0,
  hasVehicle: false,
  ...partial,
});

const context = (partial: Partial<ApplicationContext> = {}): ApplicationContext => ({
  relevantExperienceYears: 0,
  hasNetworkingContact: false,
  weeksUnemployed: 0,
  ...partial,
});

describe('the tier system (GDD §3.1)', () => {
  it('orders tiers entry to specialist', () => {
    expect([...JOB_TIERS]).toEqual(['entry', 'skilled', 'professional', 'specialist']);
    expect(tierRank('entry')).toBeLessThan(tierRank('skilled'));
    expect(tierRank('skilled')).toBeLessThan(tierRank('professional'));
    expect(tierRank('professional')).toBeLessThan(tierRank('specialist'));
  });

  it('pays hourly and salaried jobs through the §6.1 formulas', () => {
    expect(weeklyGrossCents(job({ id: 'h' }))).toBe(64_000); // $16/hr x 40h
    expect(
      weeklyGrossCents(job({ id: 's', pay: { kind: 'salaried', annualSalaryCents: 5_200_000 } })),
    ).toBe(100_000);
    // Overtime hours are paid at time and a half on top of the base week.
    expect(weeklyGrossCents(job({ id: 'h' }), 5)).toBe(Math.round(1_600 * 47.5));
  });
});

describe('eligibility and the vehicle prerequisite (GDD §3.1)', () => {
  it('gates on education and experience', () => {
    const nurse = job({ id: 'rn', requirements: { educationYears: 4, experienceYears: 2 } });
    expect(isEligible(nurse, applicant())).toBe(false);
    expect(ineligibleReasons(nurse, applicant())).toEqual(['education', 'experience']);
    expect(isEligible(nurse, applicant({ educationYears: 4, experienceYears: 2 }))).toBe(true);
  });

  it('makes a vehicle a first-class prerequisite', () => {
    // "Spend on a depreciating asset to unlock income" is a real decision.
    const driver = job({ id: 'driver', requiresVehicle: true });
    expect(isEligible(driver, applicant())).toBe(false);
    expect(ineligibleReasons(driver, applicant())).toEqual(['vehicle']);
    expect(isEligible(driver, applicant({ hasVehicle: true }))).toBe(true);
  });

  it('never reads a credit score', () => {
    // GDD §3.5: credit gates loans, housing and insurance. Never jobs.
    const source = ineligibleReasons.toString() + isEligible.toString();
    expect(source).not.toMatch(/credit|score/i);
  });
});

describe('application rolls (GDD §3.1)', () => {
  it('bounds the probability to 5-95%', () => {
    // No combination of modifiers escapes the band.
    const extremes = [
      context(),
      context({ relevantExperienceYears: 100, hasNetworkingContact: true }),
      context({ weeksUnemployed: 5_000 }),
      context({ relevantExperienceYears: -50, weeksUnemployed: 5_000 }),
      context({ relevantExperienceYears: 100, hasNetworkingContact: true, weeksUnemployed: 5_000 }),
    ];
    for (const ctx of extremes) {
      const p = applicationProbability(ctx);
      expect(p).toBeGreaterThanOrEqual(APPLICATION_MIN_PROBABILITY);
      expect(p).toBeLessThanOrEqual(APPLICATION_MAX_PROBABILITY);
    }
  });

  it('starts at 35% and rewards relevant experience up to +45%', () => {
    expect(applicationProbability(context())).toBeCloseTo(APPLICATION_BASE, 10);
    expect(applicationProbability(context({ relevantExperienceYears: 1 }))).toBeCloseTo(
      APPLICATION_BASE + APPLICATION_PER_EXPERIENCE_YEAR,
      10,
    );
    // The cap binds at three years.
    expect(applicationProbability(context({ relevantExperienceYears: 3 }))).toBeCloseTo(
      APPLICATION_BASE + APPLICATION_EXPERIENCE_CAP,
      10,
    );
    expect(applicationProbability(context({ relevantExperienceYears: 20 }))).toBeCloseTo(
      APPLICATION_BASE + APPLICATION_EXPERIENCE_CAP,
      10,
    );
  });

  it('rewards a networking contact and penalizes long unemployment', () => {
    expect(applicationProbability(context({ hasNetworkingContact: true }))).toBeCloseTo(
      APPLICATION_BASE + APPLICATION_NETWORKING_BONUS,
      10,
    );
    expect(applicationProbability(context({ weeksUnemployed: LONG_UNEMPLOYMENT_WEEKS }))).toBeCloseTo(
      APPLICATION_BASE,
      10,
    );
    expect(
      applicationProbability(context({ weeksUnemployed: LONG_UNEMPLOYMENT_WEEKS + 1 })),
    ).toBeCloseTo(0.15, 10);
  });

  it('rolls at the stated rate over many draws', () => {
    const rng = stream('4F2A9C1B', 'jobApplication');
    const ctx = context({ relevantExperienceYears: 1 }); // 50%
    let hired = 0;
    for (let i = 0; i < 20_000; i++) if (rollApplication(rng, ctx).hired) hired++;
    expect(hired / 20_000).toBeGreaterThan(0.48);
    expect(hired / 20_000).toBeLessThan(0.52);
  });

  it('charges a mood cost for a rejection and nothing for a hire', () => {
    const rng = stream('4F2A9C1B', 'jobApplication');
    for (let i = 0; i < 200; i++) {
      const result = rollApplication(rng, context());
      expect(result.moodCost).toBe(result.hired ? 0 : APPLICATION_FAILURE_MOOD_COST);
    }
  });

  it('never grants a job for meeting the requirements alone', () => {
    // Applicable is not granted. Even a perfect candidate can be turned down.
    expect(applicationProbability(context({ relevantExperienceYears: 10, hasNetworkingContact: true })))
      .toBeLessThan(1);
  });
});

describe('the seeded availability timeline (GDD §3.1)', () => {
  const jobs: JobDef[] = [
    job({ id: 'barista', alwaysAvailable: true }),
    job({ id: 'delivery', requiresVehicle: true }),
    job({ id: 'admin', tier: 'skilled' }),
    job({ id: 'developer', tier: 'professional' }),
    job({ id: 'lead', tier: 'specialist' }),
  ];

  it('is identical across two runs with the same seed', () => {
    const a = generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS);
    const b = generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('does not depend on player behaviour', () => {
    // The timeline is drawn once, at init, from a stream nothing else touches.
    // Whatever the player does, the same doors open in the same weeks.
    const rng = stream('4F2A9C1B', 'jobTimeline');
    const timeline = generateJobTimeline(rng, jobs, WEEKS);

    // Draining the jobApplication stream — what a busy applicant would do —
    // cannot move it.
    const applications = stream('4F2A9C1B', 'jobApplication');
    for (let i = 0; i < 10_000; i++) applications();

    expect(generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS)).toEqual(timeline);
  });

  it('is unchanged by the order jobs are authored in', () => {
    // Iteration is id-sorted, so re-ordering jobs.json cannot reshape the world.
    const shuffled = [jobs[3], jobs[0], jobs[4], jobs[1], jobs[2]];
    expect(generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), shuffled, WEEKS)).toEqual(
      generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS),
    );
  });

  it('diverges for a different seed', () => {
    expect(generateJobTimeline(stream('4F2A9C1C', 'jobTimeline'), jobs, WEEKS)).not.toEqual(
      generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS),
    );
  });

  it('opens higher tiers far less often than entry roles', () => {
    let entry = 0;
    let specialist = 0;
    for (let i = 0; i < 60; i++) {
      const timeline = generateJobTimeline(stream(`S${i}`, 'jobTimeline'), jobs, WEEKS);
      entry += timeline.filter((o) => o.jobId === 'delivery').length;
      specialist += timeline.filter((o) => o.jobId === 'lead').length;
    }
    expect(entry).toBeGreaterThan(specialist * 4);
  });

  it('keeps every opening inside the run and open for 3-8 weeks', () => {
    for (const opening of generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS)) {
      expect(opening.openWeek).toBeGreaterThanOrEqual(0);
      expect(opening.openWeek).toBeLessThan(WEEKS);
      expect(opening.closeWeek).toBeGreaterThan(opening.openWeek);
      expect(opening.closeWeek).toBeLessThanOrEqual(WEEKS);
      expect(opening.closeWeek - opening.openWeek).toBeLessThanOrEqual(8);
    }
  });

  it('never schedules an always-available job — it is simply always there', () => {
    const timeline = generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS);
    expect(timeline.some((o) => o.jobId === 'barista')).toBe(false);
    for (let week = 0; week < WEEKS; week += 37) {
      expect(availableJobIds(timeline, jobs, week)).toContain('barista');
    }
  });

  it('shows only jobs that are open and applicable', () => {
    const timeline = generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS);
    const opening = timeline.find((o) => o.jobId === 'delivery')!;

    const withoutCar = applicableJobs(timeline, jobs, applicant(), opening.openWeek);
    const withCar = applicableJobs(timeline, jobs, applicant({ hasVehicle: true }), opening.openWeek);

    expect(withoutCar.map((j) => j.id)).not.toContain('delivery');
    expect(withCar.map((j) => j.id)).toContain('delivery');
    // Closed again a week after it shuts.
    expect(
      applicableJobs(timeline, jobs, applicant({ hasVehicle: true }), opening.closeWeek).map((j) => j.id),
    ).not.toContain('delivery');
  });

  it('never leaves the board empty', () => {
    // The early game must not dead-end with nothing to apply for.
    const timeline = generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS);
    for (let week = 0; week < WEEKS; week += 13) {
      expect(applicableJobs(timeline, jobs, applicant(), week).length).toBeGreaterThan(0);
    }
  });

  it('offers each tier over a 30-year run', () => {
    const timeline = generateJobTimeline(stream('4F2A9C1B', 'jobTimeline'), jobs, WEEKS);
    for (const id of ['admin', 'developer', 'lead']) {
      expect(timeline.some((o) => o.jobId === id)).toBe(true);
    }
    // A specialist role really is something to wait for: at 0.4 openings a
    // year, roughly 12 across a 30-year run, against ~90 entry-level ones.
    let leadTotal = 0;
    let deliveryTotal = 0;
    const seeds = 60;
    for (let i = 0; i < seeds; i++) {
      const runTimeline = generateJobTimeline(stream(`T${i}`, 'jobTimeline'), jobs, WEEKS);
      leadTotal += runTimeline.filter((o) => o.jobId === 'lead').length;
      deliveryTotal += runTimeline.filter((o) => o.jobId === 'delivery').length;
    }
    expect(leadTotal / seeds).toBeGreaterThan(8);
    expect(leadTotal / seeds).toBeLessThan(16);
    expect(deliveryTotal / seeds).toBeGreaterThan(60);
  });
});
