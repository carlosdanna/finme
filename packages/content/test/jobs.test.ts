import { describe, expect, it } from 'vitest';
import { JOB_TIERS, isEligible, weeklyGrossCents } from '@finme/engine';
import { JOBS, jobById, jobsFileSchema } from '../src/jobs.ts';

describe('jobs.json', () => {
  it('validates against the schema at load', () => {
    // Importing JOBS at all means parse() succeeded; assert it is populated.
    expect(JOBS.length).toBeGreaterThan(0);
    expect(jobById('barista')).toBeDefined();
    expect(jobById('no-such-job')).toBeUndefined();
  });

  it('has unique, stable ids', () => {
    const ids = JOBS.map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('rejects a duplicate id', () => {
    const duplicated = { jobs: [{ ...JOBS[0] }, { ...JOBS[0] }] };
    expect(() => jobsFileSchema.parse(duplicated)).toThrow(/duplicate job id/);
  });

  it('rejects a file with no vehicle-free starter job', () => {
    const noStarter = {
      jobs: JOBS.map((job) => ({ ...job, alwaysAvailable: false })),
    };
    expect(() => jobsFileSchema.parse(noStarter)).toThrow(/always-available/);
  });

  it('rejects an id that would be unstable across a rename', () => {
    expect(() => jobsFileSchema.parse({ jobs: [{ ...JOBS[0], id: 'Has Spaces' }] })).toThrow();
  });

  it('offers a starter job that needs nothing at all', () => {
    // GDD §3.1: no-requirements starter jobs avoid a dead early game.
    const starters = JOBS.filter(
      (job) =>
        job.alwaysAvailable &&
        !job.requiresVehicle &&
        job.requirements.educationYears === 0 &&
        job.requirements.experienceYears === 0,
    );
    expect(starters.length).toBeGreaterThan(0);
    const brandNew = { educationYears: 0, experienceYears: 0, hasVehicle: false };
    for (const starter of starters) expect(isEligible(starter, brandNew)).toBe(true);
  });

  it('covers every tier', () => {
    for (const tier of JOB_TIERS) {
      expect(JOBS.some((job) => job.tier === tier)).toBe(true);
    }
  });

  it('pays more at higher tiers', () => {
    const medianPay = (tier: string) => {
      const pays = JOBS.filter((j) => j.tier === tier)
        .map((j) => weeklyGrossCents(j))
        .sort((a, b) => a - b);
      return pays[Math.floor(pays.length / 2)];
    };
    expect(medianPay('skilled')).toBeGreaterThan(medianPay('entry'));
    expect(medianPay('professional')).toBeGreaterThan(medianPay('skilled'));
    expect(medianPay('specialist')).toBeGreaterThan(medianPay('professional'));
  });

  it('gates higher tiers behind more education or experience', () => {
    const entry = JOBS.filter((j) => j.tier === 'entry');
    const specialist = JOBS.filter((j) => j.tier === 'specialist');
    for (const job of entry) {
      expect(job.requirements.educationYears).toBe(0);
      expect(job.requirements.experienceYears).toBe(0);
    }
    for (const job of specialist) {
      expect(
        job.requirements.educationYears + job.requirements.experienceYears,
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it('makes at least one job need a vehicle, and one not', () => {
    // The "spend on a depreciating asset to unlock income" decision needs both.
    expect(JOBS.some((job) => job.requiresVehicle)).toBe(true);
    expect(JOBS.some((job) => !job.requiresVehicle)).toBe(true);
  });

  it('states every wage in integer cents', () => {
    for (const job of JOBS) {
      const cents = job.pay.kind === 'hourly' ? job.pay.rateCents : job.pay.annualSalaryCents;
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThan(0);
    }
  });
});
