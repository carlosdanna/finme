/**
 * The ruleset version. Bump this in the SAME COMMIT as any change to a [T] or [F]
 * constant, a formula, an event definition, or the tick pipeline order (TDD §10),
 * and add the reason to docs/DECISIONS.md.
 *
 * Save files record the ruleset version they were created under. On mismatch the
 * game loads the run but marks it non-comparable (TDD §14).
 */
export const RULESET_VERSION = '0.3.0';
