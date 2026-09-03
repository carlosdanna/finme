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

## 2026-09-03 — C1 harness parameters
**Context:** neither the GDD nor the TDD gives C1 a capital base or contribution
schedule, and the pass condition is a comparison between strategies rather than
an absolute number.
**Decision:** $5,000 deployed at t=0 plus $6,000 at each year boundary — 29
contributions over a 30-year run, $179,000 total. Nominal, not indexed to
inflation. Dividends auto-reinvest into the paying asset (TDD §3.5), so no
strategy is penalized by cash drag it did not choose. Fractional shares; cash is
integer cents.
**Consequences:** every strategy faces the identical schedule, so the comparison
holds regardless of the level chosen. Contributions being nominal means later
ones are worth less in real terms — identical across strategies, so it does not
affect the C1 conclusion, but it does mean these terminal figures are nominal.

## 2026-09-03 — C1 measures a same-seed head-to-head, not just marginal percentiles
**Context:** the GDD's real question is "can a player discover that dumping
everything into Moonshot is the winning play." Comparing each strategy's
percentiles separately cannot answer that — it compares different worlds.
**Decision:** the report also computes, for each strategy, the share of seeds
where it beats all-in index *in the same market history*.
**Consequences:** this turned out to be the decisive statistic. All-in Moonshot
beats the index in 20.8% of worlds and Crypto-ish in 8.5%, which is a far more
direct answer than the percentile table gives. Kept as a CI assertion.

## 2026-09-03 — C1 PASSES at 10,000 seeds
**Context:** the gate before any gameplay work (BUILD-PLAN prompt 4).
**Decision:** recorded as passing; no parameter changes were needed.
**Consequences:** medians — index $552k, 60/40 $498k, Moonshot $155k, Crypto-ish
$56k, momentum $149k. Ruin rates — index 0.1%, 60/40 0.0%, Moonshot 33.0%,
Crypto-ish 66.5%, momentum 34.4%. Right tail stays fat: Moonshot's p99 is 2.9x
the index's and its max 19x. The speculative assets cross above the index between
p90 and p95, so a player sees index-beating outcomes only in the top ~7% of runs.
Caveat for prompt 17: this is **pre-tax**. Dividends are ordinary income (§6.3),
which drags the dividend-paying strategies by roughly 0.4%/yr; the margin here is
3-10x, so the conclusion should survive, but C1 must be re-run once tax exists.
Note also that the boom subsidy recorded above makes C1 *harder* to pass, and it
passes anyway.

## 2026-09-03 — Short-term gains are taxed once, through the brackets
**Context:** TDD §6.3 puts short-term realized gains inside taxable income *and*
says capital gains are taxed at `holdingWeeks >= 52 ? 0.15 : marginalIncomeRate`,
then sums `incomeTax(totalTaxable) + capitalGainsTax`. Read literally that taxes
short-term gains twice.
**Decision:** `longTermGainsTaxCents` covers long-term gains only, at the flat
15%. Short-term gains reach the marginal rate by sitting in taxable income, which
is what "rate = marginalIncomeRate" describes. Long-term gains stay out of
taxable income entirely, so they never push the player into a higher bracket.
**Consequences:** the 51-week vs 52-week cliff is sharper than a literal reading
would give — at 51 weeks a gain is ordinary income at up to 32%, at 52 it is 15%
and invisible to the brackets. Net losses produce no tax and no refund; there is
no loss carryforward.

## 2026-09-03 — Overtime hours are a subset of hours worked
**Context:** §6.1 writes `hourlyRate · hoursWorked · (overtimeHours > 0 ? blended : 1)`
without defining `blended` or saying whether overtime sits inside `hoursWorked`.
**Decision:** `overtimeHours` is the portion of `hoursWorked` paid at 1.5x, so
pay is `rate · (hours + 0.5 · overtime)`. 45 hours with 5 of overtime pays 47.5
hours' worth. Overtime is clamped to hours worked, so it cannot invent pay.
`OVERTIME_THRESHOLD_HOURS = 40` [T] is new — the TDD gives no threshold.
**Consequences:** matches the "blended multiplier" the formula gestures at. The
alternative reading (overtime on top of hours) would pay 45+5 hours for a 45-hour
week.

## 2026-09-03 — §6.2's raise does NOT erode real income for a young player
**Context:** §6.2 calls the 0.80 inflation factor "the quiet villain of the whole
game" and says a passive player "loses real income slowly over three decades".
Measured, it does not.
**Decision:** parameters left exactly as specified. Recorded, with the measured
trajectory pinned by a test, rather than retuned unilaterally.
**Consequences:** net real drift per year is `careerCurve − 0.2 · inflation`. At
the model's 2% baseline that is **+0.8%/yr under 30**, +0.4%/yr to 45, −0.2%/yr
to 55, −0.4%/yr after. A passive average performer aged 22→52 ends **~10% ahead**
in real terms; real pay peaks at age 44. The erosion only appears at 5%+ inflation
(−7.4% over the run) or for a start age past 45.

**It is the career curve, not `RAISE_INFLATION_FACTOR`, that defeats the intent.**
Erosion at every age needs `careerCurve < 0.2 · inflation` — i.e. under 0.004 at
2% inflation, against the specified 0.012/0.008. Reaching it through the lag
instead would need the factor below 0.4, which makes a raise 0.8% at 2% inflation
and looks broken to a player.

*Minimal proposed change, not applied:* `CAREER_CURVE` to `[0.004, 0.002, 0.000,
0.000]`, giving real drift of 0.0 / −0.2% / −0.4% / −0.4%/yr — flat early career,
slow erosion after 30, which is what §6.2 describes. Collateral effects: lower
lifetime income across every run, so C6 (starting-position fairness) and the C1
contribution schedule both shift; and the job-hop step (8-18%) becomes even more
dominant relative to staying put, which is the intended lesson. Needs a balance
pass before adopting.

## 2026-09-03 — A credit card statement is "paid in full" only when it clears to zero
**Context:** §5.1 says grace holds "if the previous statement was paid in full",
but its formula splits the cycle into `statementBalance` (carried) and
`newCharges` (this cycle). Reading "paid in full" as covering only the carried
portion means the very first statement on a new card is always paid in full —
`statementBalance` is 0 — so a player could charge indefinitely and never break
grace. My first implementation had exactly this bug; the tests caught it.
**Decision:** grace continues only when the statement clears to a zero balance,
new charges included.
**Consequences:** the card behaves the way a real one does. Paying the carried
balance while charging more does not preserve grace, which is what makes the card
a trap rather than free money. Overpaying clears to zero and never creates a
credit balance.

## 2026-09-03 — §5.2's "~78% interest" contradicts §5.2's own mortgage rate table
**Context:** §5.2 says a 30-year mortgage's first payment is "~78% interest" and
calls it the amortization lesson. Its rate table gives `0.075 − 0.02·creditQuality`
— 5.5% at perfect credit, 7.5% on a thin file.
**Decision:** parameters left as specified, the discrepancy pinned by tests
rather than silently retuned.
**Consequences:** the first payment's interest share is exactly `1 − (1+r)^−n`,
with no principal term — a $100k and a $900k mortgage front-load identically.
For n=360 the stated 75-80% band is the **APR band 4.63%-5.38%**, and "~78%" is
5.06%. The table's own floor of 5.5% already yields **80.7%**, and it runs to
**89.4%** for a thin file. The amortization math is correct; a test asserts the
75-80% band at 5.06% to prove it, and a second pins the 80.7-89.4% the table
actually produces.

*Minimal proposed change, not applied:* `MORTGAGE_BASE_APR` 0.075 → 0.06, putting
a mid-credit borrower at 5.0% and 77.7% — the stated figure. Note that no base
rate can put the whole range inside 75-80%: the 2pp credit spread is wider than
the 0.75pp band that 75-80% corresponds to, so the figure can only ever describe
one point on the curve. Collateral effects: cheaper mortgages raise home
affordability and shift every net-worth trajectory that includes a home, so C6
and the §8 underwater-car/home tests both move. Needs a balance pass.

## 2026-09-03 — Payday rollovers pay a fee and start a new term
**Context:** §5.4 says "three rollovers and the player has paid 45% of principal
in fees with the principal untouched", which fixes the accounting: 45% is three
fees of 15%, not four.
**Decision:** origination charges the fee due at the first term. Each rollover
*pays* that fee and charges a fresh one on the full principal for another two
weeks. So after N rollovers `feesPaidCents` is N × 15% of principal, and one more
fee is always outstanding.
**Consequences:** matches the stated 45% exactly. `balanceCents` stays
`principal + currentFee` no matter how many times it rolls, which is the whole
point of the instrument and what the Debts panel shows beside the 390% APR.

## 2026-09-03 — A thin credit file is priced as the worst credit, not the average
**Context:** §5.2 prices every loan off `creditQuality = (score−580)/270`, but a
score is `null` before 26 weeks (§5.5) and the TDD does not say what to do then.
**Decision:** `creditQuality(null) === 0` — the bottom of the range. A mortgage
is refused outright, since it needs a score of 620.
**Consequences:** a player who has never borrowed pays the 13% personal rate and
the 11% auto rate, not the middle. That is how thin-file lending actually works,
and it gives the credit-building path something to be worth.

## 2026-09-03 — Decay alone does not fade a missed payment; accumulating on-time payments do
**Context:** §5.5 says both payment counters decay at 0.995/week "so old sins
fade". Measured: because *both* decay at the same rate, `onTime / (onTime + 2.5 ·
missed)` is scale-invariant — 300 weeks of pure decay leaves the payment-history
score bit-for-bit unchanged.
**Decision:** implemented exactly as specified. What actually fades a miss is the
on-time weight that keeps arriving while the miss decays.
**Consequences:** the half-life the design intends is real — the missed *weight*
halves at ln(0.5)/ln(0.995) = **138.3 weeks**, matching the stated ~140 — but it
only reaches the score through continued good behaviour. That is arguably the
better lesson: recovery comes from paying, not from waiting. A test pins the
scale-invariance so a future "fix" to one decay rate cannot pass unnoticed.

## 2026-09-03 — §5.3's "−80 equivalent" collection hit is unreachable from §5.5
**Context:** §5.3 gives a BNPL collection a "severe credit hit (−80 equivalent)".
§5.5's derogatory component is 10% of a 550-point span — 55 points total — and
one collection carries a 0.25 penalty, so it is capped at **13.75 points**.
**Decision:** §5.5's formula is authoritative; §5.3's figures are treated as
descriptive intent. No parameters changed.
**Consequences:** measured against a mature file, a missed payment costs **−14
points** (§5.3 says −15, so that one agrees closely) and a collection **−14**, not
−80. Even a bankruptcy is only −33. Reaching −80 requires the payment-history
damage that accompanies a collection, which happens on a thin file and not on a
mature one.

*If the −80 is meant literally*, the minimal change is raising
`COMPONENT_WEIGHTS.derogatory` from 0.10 to ~0.25 with `COLLECTION_PENALTY` at
0.6 — but that takes weight from payment history or utilization, which are the
two components the game actually teaches through. I would leave it and soften the
TDD's wording instead.

## 2026-09-03 — A miss costs far more on a thin file than a mature one
**Context:** emerged from the formula rather than being specified.
**Decision:** kept, and pinned by a test.
**Consequences:** a missed payment costs **−59 points** on a 26-week-old file
against **−14** on a mature one, because the miss is weighed against a much
smaller on-time history. This is how real scoring behaves and it gives early
mistakes genuine weight without needing a special case. Combined with the ±20/month
cap, a thin-file miss takes three months to fully land.

## 2026-09-03 — The entry score is drawn from `startingDraw`, not an in-play stream
**Context:** §5.5 draws `uniform(620, 660)` when the file establishes, which
happens 26 weeks after the player opens their first line — a player-dependent
week. None of the in-play streams fits: `flavor` must never touch simulation
state, and `eventOutcome`/`jobApplication` belong to other subsystems.
**Decision:** `drawEntryScore(rng)` is a pure function; run init draws it once
from `startingDraw` and holds it until the file establishes. `credit.ts` never
touches a stream itself.
**Consequences:** preserves the [F] rule that pre-drawn streams are fully consumed
at init and never touched again, so the entry score is a property of the world
rather than of when the player happened to borrow. Two runs on the same seed get
the same entry score no matter how differently they behave.
