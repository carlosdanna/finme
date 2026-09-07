/**
 * The ruleset version.
 *
 * **Bump this in the SAME COMMIT as any change that alters what an existing seed
 * produces**, and add the reason to docs/DECISIONS.md. In practice that means a
 * [F] or [T] constant, a formula, an event definition, or the tick pipeline
 * order (TDD §10).
 *
 * The test is the *effect*, not the marker. Deleting a constant that no executed
 * path reaches changes nothing a seed can observe, and bumping for it would mark
 * every existing save non-comparable for no reason — so it does not need one, and
 * the unchanged golden fixtures are how you show it. That carve-out is narrow: if
 * you cannot demonstrate the fixtures are byte-identical, bump.
 *
 * A [T] constant still needs a DECISIONS.md entry whether or not it needs a bump
 * (CLAUDE.md).
 *
 * Save files record the ruleset version they were created under. On mismatch the
 * game loads the run but marks it non-comparable (TDD §14).
 */
export const RULESET_VERSION = '0.4.0';
