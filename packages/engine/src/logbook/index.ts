/** The Logbook engine — TDD §11. */
export {
  TRIGGER_PRIORITY,
  MAX_ENTRIES_PER_WEEK,
  DELTA_THRESHOLD_PCT,
  QUIET_GAP_MIN,
  QUIET_GAP_MAX,
  triggerRank,
  isSignificantDelta,
  logbookKeyFor,
  selectPending,
} from './triggers.ts';
export type { Trigger, TriggerKind, PendingEntry } from './triggers.ts';

export {
  ANTI_REPEAT_DEPTH,
  MAX_REROLLS,
  emptyVariantMemory,
  selectVariant,
} from './variants.ts';
export type { VariantMemory, VariantChoice } from './variants.ts';

export {
  TEMPLATE_VARIABLES,
  openLogbook,
  quietEntryDue,
  emitEntries,
} from './logbook.ts';
export type {
  LogbookEntry,
  LogbookState,
  TemplatePools,
  RunNames,
  EmitResult,
  TemplateVariable,
} from './logbook.ts';
