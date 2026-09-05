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

## 2026-09-03 — The home value path is appended last in the market draw order
**Context:** §8.2's home value needs a pre-generated stochastic path — generated
whether or not the player ever buys, since otherwise buying a home would consume
draws and shift every other subsystem. Inserting it anywhere in the existing
order would have shifted the inflation path and every GBM shock.
**Decision:** appended as step 6, after the GBM shocks. Verified: the golden
fixture is byte-identical, so no existing seed's prices, regimes or inflation
moved and no ruleset bump is required.
**Consequences:** the draw order is now crashes → booms → (sector) → inflation →
GBM → home. The path is indexed from week 0 and a purchase reads
`exp(path[t] − path[purchaseWeek])`, so when the player buys does not change the
world. Housing is modelled as **independent of the equity regime overlay**, per
§8.2 — realistically the two correlate sharply in a crisis (2008), so the model
understates tail risk for a leveraged homeowner. Worth revisiting if the home
path ever becomes more than v2 scaffolding.

## 2026-09-03 — §4.2's liability formula double-counts the mortgage
**Context:** §4.2 writes `liabilities = Σ_d balance_d + accruedUnpaidBills +
mortgagePrincipal`. A mortgage is an amortizing `Debt`, so it is already inside
`Σ_d balance_d`.
**Decision:** the mortgage lives in the `debts` array and nowhere else. Taken
literally the formula would report a homeowner as roughly $250k poorer than they
are.
**Consequences:** a test asserts a mortgage is counted exactly once.

## 2026-09-03 — §8.1's "roughly 30 months" underwater is closer to 20
**Context:** §8.1 says a 60-month-financed car with a low down payment has
`loanBalance > carValue` for "roughly the first 30 months".
**Decision:** parameters unchanged; the measured figure is pinned by a test.
**Consequences:** at 5% down the car is underwater through month **17 (excellent
credit) to 22 (thin file)** — about a third of the term, not a half. At 0% down
it is 25 months; at 20% down it is never underwater. The demonstration still
lands, and the model is realistic — 12% off the lot plus 16%/yr continuous means
25% gone in year one, which matches real depreciation. It is the "30 months" that
is optimistic.

A nicer property fell out of the arithmetic and is now tested: **net worth drops
by exactly the off-lot 12% on purchase, regardless of the down payment.** Paying
cash and financing at 5% down cost the player the identical $2,880 on a $24,000
car. That is a cleaner lesson than the underwater window itself.

## 2026-09-03 — Buy-vs-rent needs no rent term in the home model
**Context:** open question from the §5.2 mortgage discussion — at 5.5-7.5%
mortgage rates, appreciation (3.0%) less maintenance (1.0%) and property tax
(1.1%) is +0.9%/yr, which looks like buying can never win.
**Decision:** no rent-avoided term is added to §8.2. Owning removes the rent line
from the budget, so the comparison resolves through cash flow rather than through
the asset model.
**Consequences:** counting only *interest* as the cost of owning — principal is
saving, not spending — a 20%-down buyer at 6.5% pays about 7.3% of value a year
in interest, maintenance and tax, against 5.6% rent avoided plus 3.0%
appreciation. Roughly break-even in year one and improving as the interest share
falls, with the 6% sale cost punishing short holds. That is exactly §8.2's stated
goal of "non-obvious over short horizons and clearly favourable over long ones".

**This only holds if rent is priced consistently with home prices.** At a
price-to-rent ratio far from 15-20x the comparison breaks in one direction or the
other, so the housing tiers in `packages/content` must be set against the home
price range, not independently of it.

## 2026-09-04 — RESOLVED: §6.2's raise parameters stay; the TDD's claim was amended
**Context:** resolves the open question recorded on 2026-09-03. Measured with a
new probe (`pnpm -F @finme/sim wages`, 800 seeds, age 22→52) rather than argued.
**Decision:** `RAISE_INFLATION_FACTOR` and `CAREER_CURVE` are unchanged. §6.2's
narrative sentence was rewritten to state what the parameters actually produce.
**Consequences:** the erosion the TDD described is real, but only for a
below-average performer who never moves — they lose 21% of real income. An
average performer gains 11%, which matches real merit budgets (~3-3.5% nominal
against 2-2.5% inflation) and the life-cycle earnings profile. The proposed
reduced curve would have made everyone erode uniformly (average → 0.94×) while
producing nominal raises of 1.6-2.0%, below any published merit budget and
likely to read as a bug.

The lesson survives intact and is bigger than the one that was intended: never
job-hopping costs **$513,000 of lifetime after-tax income, 34% more**, and more
than halves the ending salary. The annual review's counterfactual line is the
vehicle. Note the lifetime gap (34%) is much narrower than the ending-salary gap
(2.1×) because early years dominate the sum — the two framings tell different
stories.

## 2026-09-04 — RESOLVED: the mortgage rate stays; rent is priced at 1/16 of home value
**Context:** resolves the open question recorded on 2026-09-03. Measured with
`pnpm -F @finme/sim housing`, which runs buy-vs-rent with both households
spending the same and the one paying less investing the difference in SAFE.
**Decision:** `MORTGAGE_BASE_APR` stays at 0.075. `HOME_PRICE_TO_RENT = 16` was
added to `assets.ts`, and §5.2's "~78% interest" was corrected to the 81-89% the
rate table actually produces. §8.2 now records the rent dependency explicitly.
**Consequences:** the mortgage rate turned out **not** to be the lever — the rent
level is. At the originally assumed 1/18, the buyer loses at every horizon and
loses *more* the longer they hold, inverting §8.2's stated intent. At 1/16, median
buyer advantage over a renter at 30 years is:

| APR | 3y | 5y | 10y | 30y |
|---|---|---|---|---|
| 5.5% (score 850) | −$1.8k | −$2.2k | +$22k | **+$155k** |
| 6.5% (score ~715) | −$10k | −$17k | −$13k | **+$11k** |
| 7.5% (thin file) | −$18k | −$32k | −$46k | **−$168k** |

That is §8.2's goal exactly — non-obvious short, favourable long — and it produces
a property worth more than the original: **the break-even sits at a ~715 credit
score**, so buying pays off for good credit and does not for a thin file, through
arithmetic alone with no special-casing. A test in `probes.test.ts` guards it.

The housing tiers in `packages/content` are now constrained: rent must be set
against the home price range at roughly `price / 16`, never independently.

## 2026-09-04 — §7.3's mood formula has no part-time term; GDD §3.6's table does
**Context:** GDD §3.6 tabulates part-time work at −3 mood. TDD §7.3's formula has
only `−5 · (workFullTime ? 1 : 0)` — no part-time term at all. §7.2's energy
formula *does* carry part-time (−24), so this looks like an omission rather than
a decision.
**Decision:** implemented the TDD formula exactly, since the TDD is the formula
authority. The gap is a named constant, `MOOD_PART_TIME = 0`, so closing it is a
one-line change.
**Consequences:** part-time work currently costs energy but no mood, which makes
it strictly gentler than the GDD intends. Recommend setting it to −3 to match
GDD §3.6 — it is a [T] constant with no downstream dependency yet, and doing it
before the balance harness exercises time allocation would avoid a re-run later.

## 2026-09-04 — `nextPerformance` reads energy *after* the week's allocation
**Context:** §7.5's `energy >= 60` and `energy < 25` do not say whether they read
energy before or after the week being scored. §10's pipeline puts energy, mood
and performance all in step 9.
**Decision:** performance reads post-allocation energy, matching the order the
pipeline implies — energy is computed first, then performance consumes it.
**Consequences:** a week that exhausts the player damages performance in that
same week rather than the next one. Energy and mood both read the *previous*
tick's values for each other, so those two have no ordering hazard between them;
performance is the only one that reads a freshly-updated value, and it is
documented on the `PerformanceContext.energy` field.

## 2026-09-04 — Firing is structurally sustained, not a separate counter
**Context:** §7.5 fires below performance 20; prompt 10 requires that firing need
sustained low performance rather than one bad week.
**Decision:** no separate counter. Performance moves at most −7 in a week
(−4 exhaustion, −3 overtime), so 100 → 40 takes 9 weeks and 100 → 20 takes 12.
**Consequences:** the requirement is satisfied by the rate limit itself, and a
test asserts the 9-week and 12-week figures so a change to either penalty
surfaces immediately. Once notice is served it stands — recovering to 100 the
following week does not un-fire the player.

## 2026-09-04 — The §7.4 property test recovers in 1-4 weeks against an 8-week budget
**Context:** the invariant is that any reachable low state recovers above 50 mood
and energy within 8 weeks under rest-and-free-social-only.
**Decision:** implemented as a 500-state property test over a seeded RNG, so it is
deterministic rather than flaky.
**Consequences:** measured recovery is 1 week (214 states), 2 (175), 3 (103) and
4 (8) — the worst case is half the budget, so the guarantee holds with real
margin rather than scraping through. Mutation checks confirm the test bites:
weakening free social to +1 mood, or raising debt stress to 60, both fail it.

One flaw was found in the *test* rather than the code: the original guarantee-2
assertion compared `moodDecay(20)` against `MOOD_DECAY_LOW`, the very constant it
returns, so changing the constant kept it green. It now asserts the literal 0.5
and 1, plus the behavioural consequence — the last 10 mood points take twice as
long to lose as the 10 above the threshold.

## 2026-09-04 — `content` depends on `engine`, never the reverse
**Context:** prompt 10 puts job definitions in `packages/content/jobs.json` with
a Zod schema, but `packages/engine` declares no dependencies at all, and having
it import content would make the engine's purity contingent on a data package.
**Decision:** the engine defines `JobDef` and the logic; `content` declares
`@finme/engine` as a dependency, owns the JSON and the schema, and asserts
`satisfies readonly JobDef[]` on the parsed result.
**Consequences:** the dependency graph stays one-directional — engine → nothing,
content → engine, sim/ui → both. If the engine's `JobDef` changes, the content
package stops compiling rather than failing at runtime. The tick pipeline will
take job definitions as an argument rather than importing them.

## 2026-09-04 — Job opening arrival rates are invented [T] constants
**Context:** neither the GDD nor the TDD gives an arrival rate or duration for
job openings, but "the seeded `jobTimeline` availability schedule" needs both.
**Decision:** `OPENINGS_PER_YEAR` by tier — entry 3.0, skilled 1.5, professional
0.8, specialist 0.4 — with openings staying on the board for `intIn(3, 8)` weeks.
Same exponential inter-arrival machinery as the market regimes.
**Consequences:** across a 30-year run a player sees roughly 90 entry-level
openings and 12 specialist ones, so a specialist role is genuinely something to
wait and prepare for. These are guesses and should be validated by C4 (decision
density) once it exists — if openings are too rare the career track stalls, and
if too common the job-hop step (8-18%) becomes a treadmill the player can farm.

Always-available jobs are deliberately excluded from the timeline: they consume
no draws and are simply always on the board, which is what keeps the early game
from dead-ending.

## 2026-09-04 — Application odds are clamped to 5-95%, though nothing reaches either bound
**Context:** GDD §3.1's modifiers span 15% (base less the long-unemployment
penalty) to 100% (base + experience cap + networking). The prompt requires the
probability be bounded 5-95%.
**Decision:** clamped to [0.05, 0.95]. The ceiling binds today — a networked
applicant with 3+ years of relevant experience computes to exactly 1.00 and is
held at 0.95. The floor does not bind yet.
**Consequences:** meeting the requirements is never the same as being hired, and
no future modifier can turn a job into a formality or an impossibility. A test
asserts both bounds against deliberately absurd inputs.

## 2026-09-04 — §9.1's slot formula undershoots both documents' stated targets
**Context:** §9.1's comment claims "mean ≈ 4.5, ≈11.5 slots/year, ~345 over a
30-year run". GDD §5.3 asks for "one event every 4-6 weeks, roughly 10 per
in-game year, ~300 over a 30-year run". The formula produces neither.
**Decision:** implemented exactly as specified, with the measured figures pinned
by a test rather than retuned.
**Consequences:** `clamp(3 + floor(−ln(U)/0.22), 3, 10)` adds 3 to the floor of
an exponential whose mean is 4.55, giving a **6.16-week mean gap — 8.4 slots a
year, ~253 a run**. The "mean ≈ 4.5" in the comment is the exponential's mean
before the +3, not the gap. Seed 4F2A9C1B gets 247 slots.

*Minimal proposed change, not applied:* `SLOT_LAMBDA` 0.22 → **0.34**, giving a
5.22-week mean gap, 9.94 slots/year and 298 a run — inside GDD §5.3's 4-6 week
band and on both stated targets. λ is marked **[T]** in §9.1 ("[F: mechanism,
T: rate]"), so this is a tuning change rather than a mechanism change, and no
seed has shipped. Collateral: it raises decision density by ~18%, which is C4's
concern (150-250 decision points over 30 years) — worth setting before C4 runs
rather than after.

| λ | mean gap | slots/year | per 30y |
|---|---|---|---|
| 0.22 (as specified) | 6.16w | 8.42 | 253 |
| 0.34 (proposed) | 5.22w | 9.94 | 298 |
| 0.45 | 4.67w | 11.11 | 333 |

## 2026-09-04 — The formula evaluator parses; it never evaluates
**Context:** §9.3 requires magnitudes be expressions evaluated at fire time, and
the prompt requires the evaluator reject anything outside a whitelist.
**Decision:** a hand-written tokenizer and recursive-descent parser. No `eval`,
no `new Function`, no property access in the grammar at all. Whitelist: `clamp`,
`min`, `max`, `round`, `floor`, `ceil`, `abs`, `price`.
**Consequences:** content is data and cannot reach the runtime — `Math.random()`
does not parse, because `.` is not in the grammar. Unknown variables throw rather
than reading as zero, so a content typo surfaces loudly instead of silently
zeroing a magnitude. Determinism is preserved: `price()` is the only context
lookup and it reads a pre-generated series.

Two mutation checks initially passed and exposed weak *tests* rather than weak
code: removing the whitelist check still threw, but only via a later finiteness
check, and replacing every slot ticket with a constant `0.5` still satisfied "is
a uniform in [0,1)". Both tests now assert the mechanism — the error message for
an unknown function, and that the tickets equal the `eventSelection` stream's own
draws in order.

## 2026-09-04 — Effects resolve to a diff, not a mutation
**Context:** §9.3's `Effect` union writes to cash, mood, debts, assets, flags and
more. The game state object does not exist yet (prompt 14).
**Decision:** `applyEffects` folds a list of effects into an `EffectOutcome` — an
accumulated diff — which the tick pipeline applies.
**Consequences:** effect resolution is pure and testable without a whole game
state, and replayable for the §14 persistence model. A choice consumes a draw
from `eventOutcome` **only** when it declares an `outcomeRoll`, so a choice
without one cannot shift the stream; a test asserts the draw count directly.

The Zod schema for `EventDef` lives in `@finme/content`, not the engine, matching
the jobs decision — the engine declares no dependencies, and content asserts
`satisfies` against the engine's types.

## 2026-09-04 — §9.4's third event needs three schema features the first two do not
**Context:** implementing `CAR_RAISE_BELOW_INFLATION` verbatim required
extending the §9.3 schema, which does not describe any of them.
**Decision:** all three added, since the TDD's own worked example uses them.
**Consequences:**
1. A `stat` gate's `value` may name **another stat** rather than a number, so
   "below inflation" stays true at any inflation level instead of being frozen to
   a percentage.
2. An outcome branch's `p` may be a **formula** — `"0.25 + 0.3*performanceNorm"`
   makes negotiating better when the player has performed.
3. `"p": "rest"` takes whatever the other branches leave, so probabilities cannot
   drift out of sum as content is edited.

## 2026-09-04 — The "no choice without effects" lint would reject §9.4's own event
**Context:** the prompt's lint fails any choice with no effects. §9.4's
`CAR_RAISE_BELOW_INFLATION` has exactly that: "Say thank you" accepts a
below-inflation raise and does nothing mechanically, deliberately.
**Decision:** a choice must declare effects, an `outcomeRoll`, or a `deferred`,
**or** set `"noop": true`.
**Consequences:** the lint still catches what it exists to catch — an author who
wrote a choice and forgot its effects — while permitting the "do nothing" branch
that several events need. `noop` makes the intent explicit in the data rather
than inferred from an empty array, and a mutation check confirms removing the
rule fails the test.

## 2026-09-04 — Content lint runs as schema refinement, not a separate pass
**Context:** prompt 12 asks for a lint over missing `logbookKey`s, effect-less
choices and colliding ids.
**Decision:** implemented as Zod `superRefine` rules on the schema that already
parses at module load, rather than as a separate tool.
**Consequences:** the lint cannot be forgotten — importing `EVENTS` runs it, so a
malformed event is a load-time throw rather than something a CI step might skip.
The lint also covers what the prompt did not ask for but the design requires: at
least two choices per event, unique choice ids within an event, and ids matching
`PREFIX_UPPER_SNAKE` so a rename is a schema error rather than a silent seed
change. A test additionally scans every choice label for words that would rank
the options for the player (GDD §1), and parses every formula in the content
against the evaluator's whitelist.

## 2026-09-04 — The flavor-isolation guarantee is structural, and the test proves sensitivity
**Context:** §2.2 marks it **[F]** that `flavor` must never influence simulation
state, and prompt 13 requires a test that shuffling Logbook variants changes no
number. Writing that test surfaced a subtlety about what it can actually prove.
**Decision:** `emitEntries` takes exactly one `Rng`, and the caller supplies
`flavor`. There is no path from inside the Logbook to any other stream, so the
isolation is structural rather than checked at runtime.
**Consequences:** three tests run a full 30-year simulation — market prices,
dividends, weekly withholding, annual settlement, plus a live `eventOutcome` roll
every 11 weeks — with the Logbook emitting alongside, and assert every simulation
value is byte-identical after variants are **reordered, added, or a whole key
removed**, while the prose genuinely changes.

A fourth test guards the guard: it points the Logbook at the simulation's own
live stream and asserts the outputs **do** diverge. Without it the other three
would prove nothing, since a harness that consumes no live stream would pass them
trivially. Two mutation attempts were rejected as non-leaks before landing on
that framing — an extra `flavor` draw is harmless by design, which is the whole
point of the separate stream.

**The residual risk is at the call site, not here.** The tick pipeline (prompt 14)
must pass the `flavor` stream to `emitEntries` and nothing else; that is the one
place this could still be got wrong.

## 2026-09-04 — Logbook keys for non-event triggers are derived, not authored
**Context:** §11.1 defines seven trigger kinds but only event triggers carry an
explicit key — an event's key lives on the chosen `Choice`.
**Decision:** `logbookKeyFor` derives a key for the other six:
`first_<action>`, `threshold_<metric>_<up|down>`, `delta_<metric>_<up|down>`,
`streak_<streak>`, `stage_<stage>`, `quiet`. Event triggers derive
`<eventId>.<choiceId>[.<branch>]` as a fallback, though the tick supplies the
choice's own key.
**Consequences:** content authors know exactly which key to write prose against
without a lookup table. A key with no prose yet emits nothing rather than
throwing — content arrives in batches, and a missing variant must not end a
30-year run. A content test asserts every key the events reference has prose, so
the gap is visible without being fatal.

`lifeStage` is absent from §11.1's priority list; it is ranked just above `quiet`.

## 2026-09-04 — The flavor call-site risk is now closed by the golden fixture
**Context:** prompt 13 recorded that the §2.2 flavor-isolation guarantee was
structural inside the Logbook, but that the residual risk sat at the call site —
the tick pipeline could pass the wrong stream.
**Decision:** the golden snapshot pins the whole run, and a dedicated test
re-runs seed 4F2A9C1B with every template pool reversed and asserts every
simulation field is identical.
**Consequences:** a mutation that passes `streams.eventOutcome` instead of
`streams.flavor` to `emitEntries` now fails the golden snapshot immediately. The
risk is closed. The snapshot deliberately records logbook *keys* and the entry
count but **not the prose**, since pinning the text would make the guarantee
untestable.

## 2026-09-04 — §10 step 14's "raise" was missing until the fixture exposed it
**Context:** the first golden run came out with `lastRaisePct: 0` after four
in-game years and a wage that had never moved. §10's step 14 is "tax settlement,
raise, inflation step, annual review"; only the tax had been implemented.
**Decision:** the annual raise now applies at the year boundary, reading the
inflation of the year just finished — the year the player actually lived through.
**Consequences:** wages grow. In the golden run, pay goes from $750/week to
$851/week over four years. It also changed which events fire:
`CAR_RAISE_BELOW_INFLATION` stopped appearing, because a 4.45% raise for a
high-performing 22-year-old beats 2% inflation and its gate correctly fails. That
is the §6.2 finding from 2026-09-04 showing up end to end — the "quiet villain"
does not bite a young strong performer.

The fixture is what caught this. An idle golden run would not have.

## 2026-09-04 — State invented where the TDD stops short
**Context:** the pipeline needs numbers §10 references but no section defines.
**Decision:** added as documented [T] constants in `state.ts`:
`HOUSING_TIER_RENT_CENTS` (65/110/160/235 dollars a month, year-0),
`BASE_MONTHLY_EXPENSES_CENTS` ($950), `DISCRETIONARY_BASELINE_CENTS` ($400), and
the interrupt floors (energy 20, mood 25, unsecured DTI 0.75).
**Consequences:** all guesses, and all load-bearing for pacing. The housing tier
rents must be reconciled with `HOME_PRICE_TO_RENT = 16` before the home path is
playable — tier 3 at $2,350/month implies a ~$450k home, which is in range, but
the two were set independently and should be checked together.

`RunState.flags` is a **sorted array**, not §4.1's `Set`: a Set serializes as
`{}` and iterates in insertion order, so two runs with identical flags would
produce different snapshots. Gate evaluation builds a Set from it per tick.

## 2026-09-04 — Systems the pipeline stubs rather than fakes
**Context:** §10 references subsystems that later prompts build.
**Decision:** step 6e sets a `bankruptcy_eligible` flag rather than implementing
§13's three branches (prompt 17). Job applications, promotions and job-hopping
are wired in `jobs.ts` but nothing in the tick calls them yet — the run keeps its
starting job or loses it to the firing track. Skills and `experienceWeeks` are
absent from `RunState` entirely.
**Consequences:** the golden fixture pins what exists today, so each of those
prompts will legitimately change it. That is the moment to ask "did I intend
this?" — the answer will be yes, and the fixture gets regenerated with a
DECISIONS entry saying so.

## 2026-09-04 — A credit card's minimum payment can never produce "Never"
**Context:** the Debts panel was built to show the payoff projection against the
minimum payment. A render test that expected "Never" failed, and the reason is
structural rather than a bug.
**Decision:** the panel projects against the payment the player is **actually
making** — the standing order's fixed amount when there is one, the minimum
otherwise.
**Consequences:** §5.1's minimum is `max($25, 2% of balance + interest)`. The 2%
term means it always touches principal, so a card paid its minimum always clears
eventually, however slowly. **"Never" only appears when a standing order pays a
fixed amount the interest has since outgrown.** Projecting the minimum everywhere
would have quietly hidden the case the panel exists to teach, while looking
correct. A test asserts both halves: "Never" renders for a fixed underpayment,
and never renders for a minimum payment.

## 2026-09-04 — The glossary is tap-only, not tap-and-hover
**Context:** GDD §7 specifies hover tooltips; BUILD-PLAN Part 2b resolves this to
a tap-to-open popover "(and on hover, on desktop, as a bonus)".
**Decision:** implemented as **tap only**. Hover is not added as a desktop bonus.
**Consequences:** one interaction that works identically everywhere, rather than
two paths where the desktop one is better and therefore the one that gets tested.
The trigger is a real `<button>`, so it is keyboard-reachable and screen-reader
announced, and it carries a 44px touch target through an `::after` overlay that
does not disturb the text's line box. There is no `title` attribute anywhere in
the UI, and a test asserts it.

## 2026-09-04 — UI tests run in their own jsdom project
**Context:** the root Vitest config runs the headless packages in a `node`
environment. Mounting React components needs jsdom, and mixing environments in
one project would slow every engine test down.
**Decision:** `packages/ui` has its own `vitest.config.ts` with `environment:
'jsdom'` and `globals: true`; the root `test` script runs both.
**Consequences:** `globals: true` is load-bearing rather than stylistic — it is
what registers Testing Library's automatic cleanup. Without it every `render`
appends to the same document and tests start finding duplicate elements, which is
exactly how three of these tests first failed.

The render tests guard the GDD §1 tone rules directly: no `destructive` or
red/green class reaches any figure, "Never" carries no styling of its own, the
allocation steppers are 44px and nothing is draggable, and the Logbook contains
no checkmarks.

## 2026-09-04 — Event choices render with no primary action
**Context:** GDD §1 requires that choices never signal which is correct — in
label, order, or styling.
**Decision:** every choice button in the event modal uses the identical
`outline` variant and size, in the order the content declares. There is no
default action and no emphasized option.
**Consequences:** the modal is also not dismissible, since an event is a decision
and the simulation has no "closed without choosing" outcome. Content order is
therefore load-bearing for presentation as well as for the outcome roll, which
the event schema already treats as part of an event's identity.

## 2026-09-04 — The epilogue's rng is a parameter, satisfying §12 and CLAUDE.md at once
**Context:** TDD §12 says the epilogue "uses `Math.random()`, **not** a seeded
stream — it is a post-run illustration, not part of the simulation, and seeding
it would imply a determinism it doesn't need." CLAUDE.md bans `Math.random()` in
the engine outright.
**Decision:** `projectEpilogue(input, rng)` takes the generator as an argument.
The UI passes `Math.random`; tests pass a seeded stream so they are reproducible.
**Consequences:** both rules hold without either being bent. The engine never
calls `Math.random` itself, so the ESLint rule and the balance harness stay
intact, and the projection is genuinely unseeded in play.

Assets are correlated through a single market factor, loaded by their §3.1
regime beta scaled by the largest of them — so bonds load **negative** and the
flight-to-quality the market model produces carries into the projection. That
scaling is invented; §12 says only "correlated via a single market factor".

## 2026-09-04 — Golden fixture regenerated: additive only
**Context:** the annual review needs a year-over-year series, so `RunState`
gained `annualSnapshots`, `interestPaidThisYearCents` and
`employerMatchedThisYearCents`. That changes the golden snapshot.
**Decision:** regenerated, after diffing to confirm the change was what I
intended.
**Consequences:** the diff is **purely additive** — three new fields, and *zero*
changed values. The snapshots record what was already happening rather than
altering it, so no existing seed's behaviour moved and `RULESET_VERSION` stays at
0.2.0. This is the "did I intend this?" check working as designed: had any
existing field moved, that would have been a simulation change needing a bump.

## 2026-09-04 — Counterfactuals are limited to what is honestly computable
**Context:** GDD §4.2 wants "two or three concrete counterfactuals, drawn from
decisions the player actually made", e.g. "You took the payday loan in March.
Covering it from savings would have cost $180 less."
**Decision:** implemented the counterfactuals derivable from the annual snapshot
— the employer match forgone, interest paid against the cash balance held, and
income restated in real terms. The payday-loan example is **not** implemented.
**Consequences:** §4.1's `decisionLog: DecisionRecord[]` does not exist yet, and
without it there is no record of *which* decision was taken *when* to
counterfactually re-run. The match-forgone line is real and lands well — the
golden run shows $1,560 unclaimed in year one. Richer counterfactuals need the
decision log, which belongs with §14's replay work in prompt 17.

## 2026-09-04 — uPlot ships no touch gestures, so they are written here
**Context:** BUILD-PLAN Part 2b requires pinch-zoom and drag-pan with no reliance
on hover.
**Decision:** a `touchGestures()` uPlot plugin — one-finger drag to pan,
two-finger pinch to zoom, `touch-action: none` on the overlay so the browser does
not claim the gesture first.
**Consequences:** uPlot has mouse drag-to-zoom built in but nothing for touch, so
without this a phone gets a chart it can only look at. **Not yet verified on a
real device or under CPU throttling** — that is prompt 18's device pass, and the
"1,560 points pan at 60fps" requirement is unproven until then.

## 2026-09-05 — Ruleset 0.2.0 → 0.3.0: recurring expenses merge, unpaid bills are payable
**Context:** two engine defects found by running C2-C6 for the first time.
**Decision:** both fixed; `RULESET_VERSION` bumped and the golden fixture
regenerated after diffing.
**Consequences:**
1. **Recurring expenses now merge by category.** `applyOutcome` appended blindly,
   so a rent-increase event firing every year produced **28 separate permanent
   `rent` lines totalling $11,114/month**. One category, one line. At 200 weeks
   the fixture change is representational only — four lines became one with an
   identical total — so nothing downstream moved in that window.
2. **Accrued unpaid bills can now be paid down.** They accrued the §6.3 penalty
   and then only ever grew; a single unaffordable month became a permanent
   compounding liability. They now take the penalty and are then cleared from
   whatever cash is available at the next month boundary. This genuinely changes
   30-year outcomes, which is what makes the version bump necessary rather than
   merely tidy.

## 2026-09-05 — C2-C6: three fail, and the cause is content volume, not the engine
**Context:** first full run of GDD Appendix C's remaining balance tests.
**Decision:** no parameter changed. The failures were diagnosed by re-running
each test against the shipped pool **and** against a pool diluted with neutral
filler events to GDD §5.3's own MVP target of 45.
**Consequences:** the shipped pool is **8 events against ~247 slots in a 30-year
run**, so every event fires 14-29 times. That single fact drives most of the
failures:

| pool | median net worth | max firings | rent added/mo |
|---|---|---|---|
| 8 (shipped) | −$936,008 | 29 | $10,968 |
| 20 | +$221,882 | 20 | $5,993 |
| **45 (MVP target)** | **+$822,626** | 13 | $1,781 |
| 120 (full) | +$1,003,003 | 7 | $736 |

- **C3 PASSES** as shipped. All 120 scripted worst-case states recover within 5
  weeks under rest-and-free-social; the passive strategy recovers 0% of the time.
- **C6 FAILS as shipped and PASSES at 45.** Every start reaches a positive median,
  the head-start gap narrows relative to the starting difference but persists.
  Its failure was **entirely** content volume.
- **C5 FAILS at every pool size tested** — 13 firings at 45, 7 at 120, against a
  limit of 4. Pool size alone does not fix it. The minimal changes are the full
  120-event pool **plus** `oncePerRun` on one-time life events (none of the
  current 8 sets it) **plus** longer cooldowns on the repeatable ones. GDD §5.3
  says exactly this — "cooldowns plus once-per-run flags" — and the content does
  not use either lever yet.
- **C4 FAILS**: 338 decision points as shipped, 256 at pool 45, against a target
  of 150-250. See the entry below — this one is a spec conflict, not a bug.
- **C2 is not yet a valid test.** It reports PASS, but only trivially: nothing in
  the tick opens a credit line, so the "max out and discharge" strategy cannot
  actually max anything out. The §13 model is implemented and unit-tested, but
  C2 cannot exercise it end-to-end until borrowing is a player action.

## 2026-09-05 — GDD §5.3's event frequency contradicts Appendix C4's decision density
**Context:** C4 asks for **150-250 meaningful decision points** over 30 years.
GDD §5.3 asks for "roughly 10 per in-game year, **~300 over a 30-year run**".
**Decision:** recorded rather than resolved — this one needs a design call.
**Consequences:** every event presents 2-3 choices, so an event *is* a decision
point. 300 events cannot fit inside a 250-point ceiling. Measured, decision
density is essentially the slot count: 253 slots at the specified λ=0.22 gives
256 points at a 45-event pool, already over C4's ceiling.

This also settles the open `SLOT_LAMBDA` question from 2026-09-04. I proposed
raising λ from 0.22 to 0.34 to hit §5.3's ~10 events a year. **That change should
not be made**: it would push decision density to ~300 and break C4 further. The
specified λ=0.22 is the better value once C4 is taken into account, and §5.3's
"~300 events" is the number that should move.
