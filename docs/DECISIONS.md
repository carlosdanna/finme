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

## 2026-09-03 — Market stream draw order is fixed and asset-major
**Context:** TDD §3 says the `market` stream is consumed entirely at init but
does not say in what order. The order is contractual whether or not it is
written down, so it needed writing down.
**Decision:** crash timeline → boom timeline → (sector events, reserved) →
inflation path → GBM shocks. Shocks are **asset-major**: all 1,560 weeks of BOND,
then SAFE, and so on in `ASSET_IDS` order.
**Consequences:** asset-major means a new asset *appended* to `ASSET_IDS` leaves
every existing asset's series untouched — only inserting one in the middle
shifts them. Adding sector-event scheduling later will shift the inflation path
and every GBM shock, and needs a ruleset bump. A golden fixture
(`test/golden/market-4F2A9C1B-30y.json`) pins all of this; a mutation check
confirmed that without it, reversing the asset order passed all 87 other tests.

## 2026-09-03 — Sector events are modelled but not scheduled
**Context:** TDD §3.4's last line gives sector events a beta of 1.0 and a 2-6
week duration, but no arrival rate, no depth range, and no rule for which asset
they hit. Those three numbers materially move C1.
**Decision:** `RegimeEpisode` carries an `assetId` and the overlay applies a
single-asset episode at beta 1.0, so the machinery is complete and tested. No
sector events are scheduled — the generator draws nothing for them.
**Consequences:** the rest of §3 is fully delivered and C1 (prompt 4) runs
against a market whose every parameter came from the TDD rather than from a
guess. Turning sector events on later needs λ and a depth range specified, plus
a ruleset bump, because the draws land mid-sequence.

## 2026-09-03 — Prices stored as integer cents, rounded once from a float log path
**Context:** CLAUDE.md bans float dollars, but rounding a GBM path to cents every
week would compound rounding error into the μ_log property that C1 depends on.
**Decision:** the log path stays float; `priceCents` is `Math.round(exp(logP)*100)`
computed from it, so rounding never feeds back into the next step. Stored in a
`Float64Array` rather than `Int32Array` — a +5σ CRYP path exceeds Int32 and would
overflow silently.
**Consequences:** exact integer cents at every price lookup with no drift in the
underlying process. It also *helps* cross-engine determinism: `Math.exp`/`log`/
`cos` are not bit-specified by ECMA-262, and rounding to a cent absorbs the
1-ulp differences a different JS engine might produce. That is a mitigation, not
a guarantee — bit-identical runs across browser engines remain unproven.

## 2026-09-03 — Dividends do not pay on week 0
**Context:** TDD §3.5 pays dividends at quarter boundaries, and `isQuarterBoundary(0)`
is true. A player who buys on the opening tick would collect a full quarter's
dividend for zero weeks of holding.
**Decision:** `isDividendWeek` excludes week 0. Every other quarter boundary pays.
**Consequences:** closes a free-lunch exploit at the very first decision of the
run. A 30-year run pays 119 dividends rather than 120.

## 2026-09-03 — The μ_log validation runs at 4,000 seeds, not 1,000
**Context:** the specified test is a median annual log-return within 0.5pp of the
§3.3 table over 1,000 seeds. CRYP's median standard error at σ=0.70 over 30 years
is ≈0.51pp — larger than the tolerance. At 1,000 seeds CRYP misses by 0.77pp on
sampling noise alone.
**Decision:** raised to 4,000 seeds, where measured error is BOND +0.00pp,
SAFE −0.05pp, BLUE +0.09pp, MOON −0.04pp, CRYP −0.02pp. The test is seeded, so it
is deterministic, not flaky.
**Consequences:** the §3.3 guard is real rather than nominally satisfied. The test
measures the **base** GBM path, which is what the published table describes; the
overlaid path is checked separately (see below).

## 2026-09-03 — Booms are a net positive drift injection that scales with beta
**Context:** measured while validating §3.3. Crashes are 72% recovered, so each
leaves a net −0.28·β·ln(1−depth); booms have **no recovery phase**, so each leaves
the full +β·ln(1−depth). At λ=0.11 vs 0.09 the booms win.
**Decision:** left as specified — this is what §3.4 says. Recorded rather than
silently retuned, and asserted with a ceiling so it cannot grow unnoticed.
**Consequences:** measured over 1,000 seeds, the overlay lifts the realized median
annual log-return above the pure-GBM μ_log by +0.20pp (SAFE), +0.30pp (MOON) and
**+1.80pp (CRYP)**. It partially subsidizes exactly the assets the C1 safeguard is
meant to make unattractive. The core property survives — MOON and CRYP still have
losing medians and still lose to SAFE — but this is a live input to the C1 tuning
conversation in prompt 4, and the first parameter to look at is `BOOM_LAMBDA` or
giving booms a decay phase.

## 2026-09-03 — SAFE's ≥20% drawdown count is wider than the stated 2-5 band
**Context:** the §3 exit condition asks that a 30-year run contain 2-5 drawdowns
of ≥20% on SAFE. Measured over 1,000 seeds: median 4, but the full range is 1-10
and only 71% of runs land inside [2,5].
**Decision:** the test asserts the **median** run is in [2,5] and that at least
65% of runs are, rather than asserting it of every run. Not treated as a bug.
**Consequences:** the gap is not the crash scheduler — crash episodes per run are
2-5 in 76% of runs, mean 3.0, matching §3.4's "≈3.3". The extra drawdowns come
from SAFE's own σ=0.16 GBM noise clearing 20% unaided. Two further findings for
C1: ~4.5% of 30-year runs contain **no scheduled crash at all** (P(first gap > 30y)
= e^−3.3), and those runs make speculation look far better than it is.

## 2026-09-03 — Market constants live in market.ts, not content/constants.json
**Context:** BUILD-PLAN Part 2's repo tree lists `packages/content/constants.json`.
CLAUDE.md's content rule names only events and Logbook templates as data files.
**Decision:** the §3.1 asset table and the §3.4 regime parameters stay in
`market.ts` beside the formulas that consume them, typed and marked [T]/[F].
**Consequences:** no Zod round-trip for five rows of numbers that only the engine
reads, and a constant cannot drift away from the formula it parameterizes. Events,
Logbook templates and jobs still go to `packages/content` as CLAUDE.md requires.

## 2026-09-03 — Prices are floored at one cent (ruleset 0.1.0 → 0.2.0)
**Context:** found by C1. `Math.round(exp(logP)*100)` reaches 0 for a collapsed
asset — CRYP in **21% of 30-year runs**, MOON in 0.07%. Every site that derives a
share count divides by the price, so a zero price produced `Infinity` holdings,
which propagated into `NaN` percentiles and silently corrupted the whole C1 table.
**Decision:** `priceCents = max(1, round(exp(logP) * 100))`. A price below the
smallest representable currency unit is not a price. The float log path keeps
falling underneath the floor, so a recovery still has to climb all the way back.
`RULESET_VERSION` bumped to 0.2.0 in the same commit.
**Consequences:** the golden fixture is unchanged (no sampled week was affected).
The harness now also throws on a non-finite terminal rather than reporting it —
this class of bug is invisible in a table and fatal to the conclusion. A residual
distortion remains: an asset pinned at the floor whose log path recovers appears
to rise from 1 cent, so a holder at the floor sees an outsized gain. It is
confined to assets that have already lost 99.99% of their value.
