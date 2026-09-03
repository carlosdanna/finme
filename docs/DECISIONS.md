# DECISIONS

Append-only. One entry per choice the TDD or GDD did not specify. Newest at the
bottom. Any change to a **[F]** constant needs an entry here *and* a ruleset
version bump in the same commit; a **[T]** constant changed after balance testing
needs an entry too.

Format:

```
## YYYY-MM-DD — Short title
**Context:** what forced the choice.
**Decision:** what was chosen.
**Consequences:** what this makes easy, hard, or newly load-bearing.
```

---

## 2026-09-03 — Scaffold: pnpm workspaces, not npm workspaces
**Context:** BUILD-PLAN Part 2 says npm workspaces; the repo was already
initialized with pnpm and a `pnpm-lock.yaml`.
**Decision:** stay on pnpm. CLAUDE.md is the authority on this.
**Consequences:** pnpm's strict `node_modules` is now one of the three things
enforcing engine purity — a package can only import what it declares. Running
`npm install` or `yarn` would create a competing lockfile and break that
guarantee, so it is banned in CLAUDE.md.

## 2026-09-03 — Single root ESLint flat config
**Context:** the Vite scaffold shipped `packages/ui/eslint.config.js`. A
per-package config means the engine-purity rule lives in one place and can drift
out of another.
**Decision:** one `eslint.config.js` at the repo root with per-package blocks;
the UI's config was deleted and its ESLint devDependencies hoisted to the root.
**Consequences:** `pnpm lint` covers the whole workspace in one pass. The
engine-purity rule cannot be silently dropped by editing a package-local file.

## 2026-09-03 — Shared `tsconfig.base.json` omits the DOM lib
**Context:** the engine purity rule needs teeth in the type system, not just in
ESLint.
**Decision:** the base config's `lib` is `["ES2023"]` with no DOM. `packages/ui`
re-adds `"DOM"` in its own `tsconfig.app.json`; engine, sim and content do not.
**Consequences:** `window`, `document` and `localStorage` are type errors in the
engine, not just lint errors. This is the second of the three enforcement
mechanisms named in CLAUDE.md.

## 2026-09-03 — `StorageAdapter` is a narrow string key-value interface
**Context:** BUILD-PLAN Part 2b requires the adapter in prompt 1, before there is
any persistence logic to shape it.
**Decision:** `get`/`set`/`remove`/`keys`/`clear`, all async, values are strings —
callers serialize. Lives in `packages/engine/src/storage.ts` with a
`MemoryStorageAdapter` for tests and the balance harness.
**Consequences:** async-everywhere means a native adapter with an async-only API
drops in unchanged. Serialization stays in the persistence layer (TDD §14), which
keeps the replay/checkpoint format the adapter's problem to store, not to
understand.

## 2026-09-03 — Docs renamed to `docs/GDD.md` and `docs/TDD.md`
**Context:** files were checked in as `finme-GDD.md` / `finme-TDD.md`; CLAUDE.md
and BUILD-PLAN both reference the short names.
**Decision:** renamed to match the references.
**Consequences:** none beyond the rename; every session prompt points at the
short paths.

## 2026-09-03 — `normal()` discards the second Box-Muller output
**Context:** TDD §2.4's code comment says "Box-Muller, cached pair", but the prose
immediately below it says the opposite: "Do not cache the second Box-Muller
output — it makes consumption count depend on call parity."
**Decision:** followed the prose. `normal()` consumes exactly two draws every
call and throws the sine term away. The comment in the TDD is stale.
**Consequences:** roughly 2× the draws for normally-distributed quantities, which
costs nothing — the market series is generated once at init. In exchange, draw
count is a function of call count alone, so a refactor that changes how often
`normal()` is called cannot silently shift every downstream value. A test asserts
the two-draw count directly, and a mutation check confirms it fails when caching
is reintroduced.

## 2026-09-03 — Seed alphabet is Crockford base32
**Context:** TDD §2.3 specifies `{BASE32_SEED}/v{RULESET_VERSION}` but does not
name an alphabet, and seeds are meant to be shared (GDD §13).
**Decision:** Crockford base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, excluding
I, L, O and U. `parseSeedString` upcases and trims before matching.
**Consequences:** a seed can be read aloud or copied off a screenshot without the
1/I and 0/O confusions. Seeds are validated, never coerced: an invalid seed
returns `null` rather than silently becoming a different valid world.

## 2026-09-03 — `parseSeedString` returns null instead of throwing
**Context:** a shared seed is untrusted input typed by a player.
**Decision:** returns `null` on malformed input. A ruleset *mismatch* is not a
parse failure — it parses fine, and `isCurrentRuleset` reports separately.
**Consequences:** keeps the TDD §14 behaviour available to the UI: load the run,
show the non-blocking "outcomes may differ" banner, and mark it non-comparable.
The engine does not decide what a mismatch means for the player.

## 2026-09-03 — `monthOfYear` normalizes its argument modulo 52
**Context:** TDD §1.2 writes the signature as `monthOfYear(weekOfYear)`, but most
call sites hold a `weekIndex`. Passing one where the other is expected would
return December for every week past the first year, silently.
**Decision:** the function takes `week % 52` internally, so it is correct given
either. Same treatment as `isMonthBoundary`, which the TDD already writes this way.
**Consequences:** removes a whole class of off-by-a-year bug at no cost. It does
not weaken `weekIndex` as the single source of truth — nothing is stored.

## 2026-09-03 — A golden RNG fixture lands at prompt 2, not prompt 14
**Context:** BUILD-PLAN Part 6 item 3 flags that waiting until prompt 14 for
golden fixtures leaves RNG consumption order unguarded through the whole build,
and suggests a minimal price-series fixture earlier.
**Decision:** went earlier still — `rng.test.ts` pins the first four draws of the
`market` and `eventSlots` streams for seed `4F2A9C1B` to twelve decimal places.
**Consequences:** any change to mulberry32, FNV-1a, or the `${seed}::${name}`
derivation string fails immediately with an obvious cause, rather than surfacing
later as a diff in a 200-week state snapshot. If this fixture fails, the first
question is whether the ruleset version should change — never whether to update
the numbers.
