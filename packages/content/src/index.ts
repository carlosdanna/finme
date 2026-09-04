/**
 * Content package: JSON data files (events, logbook templates, jobs, constants)
 * plus the Zod schemas that validate them at load.
 *
 * Content is never inlined in TypeScript. Schemas live here; the data lives in
 * ../events, ../logbook, and the JSON files beside them.
 */
export { JOBS, jobById, jobSchema, jobPaySchema, jobsFileSchema } from './jobs.ts';
export type { JobsFile } from './jobs.ts';

export {
  EVENTS,
  eventById,
  eventSchema,
  eventsFileSchema,
  referencedLogbookKeys,
  collectFormulas,
  ALLOWED_FORMULA_FUNCTIONS,
} from './events.ts';
export type { EventsFile } from './events.ts';

export {
  LOGBOOK_TEMPLATES,
  FRIEND_NAMES,
  ADVISOR_NAMES,
  MIN_VARIANTS_PER_KEY,
  drawRunNames,
  missingTemplateKeys,
  templatesFileSchema,
  namesFileSchema,
} from './logbook.ts';

export { DEFAULT_ALLOCATION, scenarioConfig, createScenarioRun } from './scenario.ts';
export type { ScenarioOptions } from './scenario.ts';

export { serializeState } from './snapshot.ts';
