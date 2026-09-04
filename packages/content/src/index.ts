/**
 * Content package: JSON data files (events, logbook templates, jobs, constants)
 * plus the Zod schemas that validate them at load.
 *
 * Content is never inlined in TypeScript. Schemas live here; the data lives in
 * ../events, ../logbook, and the JSON files beside them.
 */
export { JOBS, jobById, jobSchema, jobPaySchema, jobsFileSchema } from './jobs.ts';
export type { JobsFile } from './jobs.ts';
