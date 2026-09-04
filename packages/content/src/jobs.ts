/**
 * Job definitions — validated at load, never inlined in TypeScript.
 *
 * The schema mirrors `JobDef` in @finme/engine. The `satisfies` at the bottom is
 * what keeps the two from drifting: if the engine's type changes, this stops
 * compiling.
 */
import { JOB_TIERS, type JobDef } from '@finme/engine';
import { z } from 'zod';
import data from '../jobs.json' with { type: 'json' };

const centsSchema = z.number().int().nonnegative();

export const jobPaySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hourly'),
    rateCents: centsSchema.positive(),
    hoursPerWeek: z.number().positive().max(80),
  }),
  z.object({
    kind: z.literal('salaried'),
    annualSalaryCents: centsSchema.positive(),
  }),
]);

export const jobSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'job ids are stable forever: lowercase, digits and dashes only'),
  title: z.string().min(1),
  employer: z.string().min(1),
  tier: z.enum(JOB_TIERS),
  pay: jobPaySchema,
  workMode: z.enum(['none', 'part-time', 'full-time']),
  requiresVehicle: z.boolean(),
  requirements: z.object({
    educationYears: z.number().int().nonnegative().max(12),
    experienceYears: z.number().int().nonnegative().max(40),
  }),
  alwaysAvailable: z.boolean(),
});

export const jobsFileSchema = z
  .object({ jobs: z.array(jobSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const job of file.jobs) {
      if (seen.has(job.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate job id '${job.id}' — ids are stable forever and must never be reused`,
        });
      }
      seen.add(job.id);
    }
    // The early game must never dead-end with nothing to apply for.
    if (!file.jobs.some((job) => job.alwaysAvailable && !job.requiresVehicle)) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one always-available job must not require a vehicle (GDD §3.1)',
      });
    }
  });

export type JobsFile = z.infer<typeof jobsFileSchema>;

/** Parsed and validated at module load, so a content bug is never a runtime crash. */
export const JOBS: readonly JobDef[] = jobsFileSchema.parse(data).jobs satisfies readonly JobDef[];

export function jobById(id: string): JobDef | undefined {
  return JOBS.find((job) => job.id === id);
}
