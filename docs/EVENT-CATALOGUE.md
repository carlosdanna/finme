# Event Catalogue — categories, variance, pool sizing, and likelihood

Working document for issue #1 (*GDD §5.3's event frequency contradicts Appendix
C4's decision density*). It takes GDD Appendix A's prose catalogue and turns it
into something measurable: every event assigned an engine `category`, a rarity
tier, a magnitude spread and a prose-variant budget, plus the expected number of
times each one fires in a 30-year run.

**This document does not settle issue #1.** It supplies the arithmetic the
decision needs, and it surfaces a constraint neither §5.3 nor C4 mentions: pool
size, repetition (C5) and decision density are bound together by the weight
system, and **no pool below ~124 events can pass C5 at §5.3's frequency.**

**Run length.** Every figure here is for a **30-year run (1,560 weeks)** — the
balance-harness standard, hardcoded at [cSuite.ts:100](packages/sim/src/tests/cSuite.ts#L100).
GDD §1 allows 10–50 years. A 50-year run fires ~1.7× as many events and makes
every repetition figure below correspondingly worse; a 10-year run fires ~85 and
will never show most of the pool.

Sources: GDD §5.2 (categories), §5.3 (frequency, pool size), §12 and Appendix B
(Logbook prose), Appendix A (catalogue), Appendix C4/C5 (balance tests), TDD §9.1
(slot scheduling), §9.3 (rarity tiers, magnitude formulas), §9.5 (category weight
budget).

---

## 1. Categories

The engine's nine categories (`EVENT_CATEGORIES` in
[schema.ts:14](packages/engine/src/events/schema.ts#L14)) with their lesson from
GDD §5.2 and their target share of fired events from TDD §9.5.

| Category | `id` prefix | Financial lesson | Target share **[T]** |
|---|---|---|---|
| Social/lifestyle | `SOC_` | Lifestyle inflation, social spending | 22% |
| Emergency | `EMG_` | Importance of an emergency fund | 18% |
| Career | `CAR_` | Career capital, networking, negotiation | 16% |
| Market | `MKT_` | Diversification, risk tolerance, sequence-of-returns risk | 14% |
| Windfall | `WIN_` | Saving vs. spending a windfall | 12% |
| Scam/temptation | `SCM_` | Recognizing red flags | 10% |
| Housing | `HOU_` | Renting vs. owning, maintenance, moving costs | 5% |
| Health & aging | `HLT_` | Insurance, medical costs, income interruption | 3% (with family) |
| Family & relationships | `FAM_` | Shared finances, dependents, obligation | — (v2, no events yet) |

### Rarity tiers

`baseWeight` comes from three tiers (TDD §9.3, constants in
[schema.ts:28-30](packages/engine/src/events/schema.ts#L28-L30)). Weight is
*relative within the eligible pool at a slot* — it is not a probability.

| Tier | `baseWeight` | Meaning | Fires/run @255 |
|---|---|---|---|
| **C** — common | 100 | The everyday texture of a life | **6.5** |
| **U** — uncommon | 45 | Happens a few times across three decades | **2.9** |
| **R** — rare | 12 | A handful of runs will never see it | **0.8** |
| **O** — once per run | tier + `oncePerRun` | Narrative beat; cannot repeat | 1 |

Those fire counts are for the 76-event pool in §4. **The common tier already
breaches C5's limit of 4 on its own** — see §5.

---

## 2. How likelihood is derived

1. TDD §9.1 pre-draws event **slots** at init:
   `gap = clamp(3 + floor(−ln(U) / SLOT_LAMBDA), 3, 10)` with
   `SLOT_LAMBDA = 0.22` **[T]**. The §9.1 text claims ≈11.5 slots/year, ~345
   over 30 years; the hard `[3, 10]` clamp actually produces **~253**.
2. A slot fires at most one event, so **fired events ≈ decision points**. The
   measured p50 at a 45-event pool is **256** (`pnpm -F @finme/sim c-suite`,
   run 2026-09-06).
3. Fires per category = 255 × §9.5 target share.
4. Fires per event = 255 × `baseWeight` ÷ total pool weight.

**255 fired events per 30-year run** is the reference throughout. A 200-fire
column appears in §5 for the case where C4's ceiling wins.

---

## 3. The variance model

Three independent axes. Only one of them works in the engine today.

### 3.1 Magnitude variance — *needs an engine change*

Today a magnitude is a formula string evaluated at fire time
([formula.ts:18](packages/engine/src/events/formula.ts#L18)) and the function set
is `clamp, min, max, round, floor, ceil, abs, price`. All deterministic. The car
repair costs `0.6 × monthlyIncome` **every single time it fires** — six or seven
times in a run, always the same fraction. That is the flattest thing about the
current event system.

The tables in §4 give each event an anchor and a spread, written
`anchor × [lo–hi]`. `0.6× monthlyIncome × [0.5–2.0]` means the repair costs
between 30% and 120% of a month's income, drawn per firing.

**What this needs.** A per-firing uniform available to formulas — a `roll`
variable in `FormulaContext.vars`, drawn from a **new named RNG stream**,
`eventMagnitude`. It must be a new stream, not a reuse of `eventOutcome`: per
CLAUDE.md and TDD §2, adding a draw to an existing stream shifts every downstream
value and breaks existing seeds. A new stream is additive and breaks nothing.
`eventMagnitude` is an in-play stream (the draw depends on which event fired,
which depends on state), so it joins `IN_PLAY_STREAMS` alongside `eventOutcome`
in [rng.ts:29](packages/engine/src/rng.ts#L29).

Spreads are expressed as multipliers on an anchor rather than as absolute ranges
so they keep composing with `cpi` and `monthlyIncome` across a 30-year run — the
same reason TDD §9.3 bans fixed cent amounts.

**Spreads must be mean-preserving.** A spread `[lo–hi]` has mean `(lo+hi)/2`,
which for every range in §4 is greater than 1 — `[0.5–2.0]` averages 1.25. Written
naively as `anchor × (lo + (hi−lo)·roll)` it raises the *typical* cost by that
factor, so adding variance would quietly make the game harsher. Divide the anchor
by the spread's mean:

```
   0.6 × monthlyIncome                        with spread [0.5–2.0]
=> 0.48 × monthlyIncome × (0.5 + 1.5·roll)    mean 0.6, unchanged
```

**The mean is preserved before the clamp, not after it.** The clamp bounds stay
where they were, and truncating a spread is not mean-neutral: mass that would
have landed above the ceiling piles up on it instead. Where the *old* fixed value
already sat at the ceiling, the spread can only move downwards, so the effective
mean falls. For `EMG_CAR_BREAKDOWN`:

| monthlyIncome | old | new E[cost] | |
|---|---|---|---|
| $2,000 | $1,200 | $1,195 | −0.4% |
| $3,000 | $1,800 (clamped) | $1,530 | **−15.0%** |
| $3,500 | $1,800 (clamped) | $1,617 | −10.2% |
| $4,500 | $1,800 (clamped) | $1,720 | −4.4% |
| $6,000 | $1,800 (clamped) | $1,785 | −0.8% |

The effect is nil at low incomes, largest just past the point where the old value
started pinning, and fades again as the spread's lower half also clears the
ceiling. It is a real softening in the mid band, accepted rather than corrected:
widening the clamps to compensate would be a balance change, and balance changes
are a separate decision from variance and belong in their own DECISIONS entry.
Anyone adding a spread to a clamped anchor should check this table's shape
against their own bounds.

### 3.2 Outcome variance — *works today*

`outcomeRoll` on the `eventOutcome` stream already gives discrete branching, and
`CAR_RAISE_BELOW_INFLATION` uses it. This is the right tool where the *shape* of
the result differs (the negotiation works or it doesn't), and the wrong tool for
"the same thing, but a different amount" — encoding a continuous spread as five
branches is verbose and still visibly quantised. The `Variance` column in §4 says
which mechanism each event wants: `mag`, `branch`, or `both`.

### 3.3 Prose variance — *half-solved, and mis-sized in the GDD*

Two surfaces, and they are in different states:

- **The Logbook already has variants.** `MIN_VARIANTS_PER_KEY = 3` is enforced at
  load ([logbook.ts:19](packages/content/src/logbook.ts#L19)), drawn from the
  `flavor` stream, which by design touches no simulation value.
- **The event card does not.** `title` and `body` are single strings in
  `eventSchema` ([events.ts:107](packages/content/src/events.ts#L107)). A player
  who meets `EMG_CAR_BREAKDOWN` seven times reads *the same paragraph* seven
  times. Fixing it means widening those two fields to arrays and drawing from
  `flavor` — cheap, and strictly a content change, since `flavor` cannot move a
  number.

**Card-variant budget**, by expected repeats: **C → 3 variants, U → 2, R → 1.**
Across the §4 pool that is 21 C, 35 U, 20 R = **153 card variants**.

**Appendix B undercounts by 3×.** It sizes Tier 3 as "event entries:
hand-written, **no variants**… ~2.5 entries per event". The shipped schema
requires 3 variants per key, so the real Logbook figure for a 76-event pool is
76 × 2.5 keys × 3 = **570 lines**, not 190. With Tier 1 (90) and Tier 2 (75),
total Logbook copy is **~735 lines**, plus the 153 card variants: **~888 pieces
of copy**. Appendix B's "~450 for 120 events" is not reachable under the current
schema and should be restated.

---

## 4. The pool — 76 events

Expanded from the 45-event MVP target because §5 shows 45 cannot pass C5 under
any option in issue #1. Every Appendix A entry that is not v2-gated is included,
plus 10 new events written to fill the categories the arithmetic showed thinnest.

Columns: **A#** = GDD Appendix A number (— = new here). **Magnitude** = anchor ×
per-firing spread (§3.1). **Var** = variance mechanism (§3.2). **Fires** =
modelled firings per 30-year run, assuming the event is eligible at every slot —
an upper bound, see §5.3.

✅ marks the 8 events already written in
[mvp.json](packages/content/events/mvp.json).

### Social / lifestyle — 15 events, 22.9% raw share, ~58 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `SOC_FRIEND_WEDDING` ✅ | 42 | C | — | `0.35× monthlyIncome × [0.4–2.2]` (gift + travel) | mag | 6.5 |
| `SOC_GROUP_TRIP` | 44 | C | — | `1.1× monthlyIncome × [0.5–1.8]` | mag | 6.5 |
| `SOC_UPGRADE_AFTER_RAISE` | 46 | C | after a raise | `0.25× raiseAmount × [0.6–1.5]`, recurring | mag | 6.5 |
| `SOC_BIG_SALE` | 48 | C | — | `cpi×18000 × [0.3–4.0]` | mag | 6.5 |
| `SOC_HOLIDAY_GIFT_SEASON` | — | U | month == 12 | `0.4× monthlyIncome × [0.5–2.0]` | mag | 2.9 |
| `SOC_GYM_JANUARY` | — | U | month == 1 | `cpi×4500 × [0.6–2.0]`, recurring | mag | 2.9 |
| `SOC_SPLIT_THE_BILL` | — | U | — | `cpi×6000 × [0.5–3.0]` | mag | 2.9 |
| `SOC_CONCERT_ONSALE` | — | U | — | `cpi×9000 × [0.4–3.5]` | mag | 2.9 |
| `SOC_PHONE_UPGRADE_OFFER` | — | U | — | `cpi×80000 × [0.7–1.6]`, BNPL surfaced | mag | 2.9 |
| `SOC_ROOMMATE_OFFER` | 43 | U | renting | rent `× [0.55–0.80]`, recurring | mag | 2.9 |
| `SOC_FRIEND_BORROWS` | 45 | U | — | `0.5× monthlyIncome × [0.3–1.5]` | both | 2.9 |
| `SOC_FRIEND_REPAYS_LATE` | — | U | lent money ≥26w ago | repays `× [0.0–1.0]` | branch | 2.9 |
| `SOC_SUBSCRIPTION_CREEP` | 47 | U | ≥3 recurring discretionary | audit reveals `× [0.5–2.5]` | mag | 2.9 |
| `SOC_FAMILY_ASKS_HELP` | 50 | U | — | `0.8× monthlyIncome × [0.4–2.0]` | mag | 2.9 |
| `SOC_MOVING_IN_TOGETHER` | 49 | U | age > 22, renting | rent `× [0.5–0.7]`, recurring | mag | 2.9 |

### Emergency — 12 events, 17.7% raw share, ~45 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `EMG_CAR_BREAKDOWN` ✅ | 10 | C | owns car | `0.6× monthlyIncome × [0.5–2.0]` | mag | 6.5 |
| `EMG_PHONE_DIES` | 11 | C | — | `cpi×45000 × [0.4–2.2]` | mag | 6.5 |
| `EMG_TOWED_AND_FINED` | — | C | owns car | `cpi×22000 × [0.7–1.8]` | mag | 6.5 |
| `EMG_OVERDRAFT_CASCADE` | — | C | cash < 1w expenses | `cpi×3500 × [1.0–5.0]` (fee stack) | both | 6.5 |
| `EMG_LAPTOP_DIES` | 13 | U | studying | `cpi×90000 × [0.5–2.0]` | mag | 2.9 |
| `EMG_URGENT_TRAVEL` | 14 | U | — | `0.5× monthlyIncome × [0.4–2.5]` | mag | 2.9 |
| `EMG_APPLIANCE_FAILURE` | 16 | U | owns home | `cpi×70000 × [0.4–3.0]` | mag | 2.9 |
| `EMG_PET_EMERGENCY` | 17 | U | has pet | `0.7× monthlyIncome × [0.3–3.0]` | both | 2.9 |
| `EMG_DEPOSIT_WITHHELD` | — | U | moved within 8w | deposit `× [0.0–1.0]` withheld | branch | 2.9 |
| `EMG_WORK_TOOL_LOST` | — | U | employed | `cpi×30000 × [0.5–2.5]` | mag | 2.9 |
| `EMG_THEFT` | 18 | R | — | insured value `× [0.0–1.0]` recovered | branch | 0.8 |
| `EMG_STORM_DAMAGE` | 19 | R | owns home | `2.0× monthlyIncome × [0.3–4.0]`, deductible | both | 0.8 |

### Career — 11 events, 15.7% raw share, ~40 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `CAR_UNPAID_OVERTIME` | 34 | C | employed | energy `−[4–14]`, performance `+[1–5]` | mag | 6.5 |
| `CAR_NETWORKING` | 36 | C | — | costs 1 time point; application odds `+[0.02–0.10]` | mag | 6.5 |
| `CAR_RAISE_BELOW_INFLATION` ✅ | 41 | C | employed, ≥1y tenure, year boundary | raise `= inflation × [0.2–0.95]` | both | 6.5 |
| `CAR_CERTIFICATION` | 35 | C | — | `1.2× monthlyIncome × [0.5–2.0]`, unlocks a tier | mag | 6.5 |
| `CAR_PROMOTION_OFFERED` | 31 | U | employed, performance high | salary `× [1.06–1.22]`, hours `+[2–8]` | mag | 2.9 |
| `CAR_COMPETITOR_OFFER` | 33 | U | employed | salary `× [1.05–1.35]` | both | 2.9 |
| `CAR_MANAGER_LEAVES` | 37 | U | employed | promotion odds `× [0.5–1.6]` | branch | 2.9 |
| `CAR_BURNOUT` | 40 | U | sustained overtime | `[2–8]` weeks reduced capacity | mag | 2.9 |
| `CAR_LAYOFF` | 32 | R | employed | severance `= tenureYears × [0.5–1.5]` months | mag | 0.8 |
| `CAR_RESTRUCTURE` | 38 | R | employed | pay freeze `[0–4]` quarters | branch | 0.8 |
| `CAR_SIDE_HUSTLE` | 39 | R | side hustling | income `+[0.1–0.6]× monthlyIncome`, tax surprise | both | 0.8 |

### Market — 10 events, 13.2% raw share, ~34 fires

Market magnitudes are *already* stochastic through the `market` stream. The
spreads here scale the event's framing and any forced-sale amount, not the
underlying return — an event must never inject a return the market model did not
produce, or §7.4's anti-spiral property test loses its meaning.

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `MKT_HOT_STOCK_CHATTER` | 29 | C | — | no forced action; buy sized `[0.05–0.5]× cash` | mag | 6.5 |
| `MKT_CORRECTION` | 21 | C | holds equities | narrates a `−10%` to `−15%` drawdown | branch | 6.5 |
| `MKT_SECTOR_BOOM` | 23 | C | — | one asset `× [1.15–1.60]` | mag | 6.5 |
| `MKT_MOONSHOT_SPIKE` | 24 | U | holds MOON | `× [1.5–6.0]` | mag | 2.9 |
| `MKT_MOONSHOT_COLLAPSE` | 25 | U | holds MOON | `× [0.02–0.45]` | mag | 2.9 |
| `MKT_INFLATION_SPIKE` ✅ | 26 | U | — | expenses `+[0.03–0.12]`, recurring | mag | 2.9 |
| `MKT_RATES_RISE` | 27 | U | — | variable APR `+[0.5–3.0]pp` | mag | 2.9 |
| `MKT_CRASH` | 22 | R | holds equities | `−25%` to `−40%`, `[8–40]w` recovery arc | both | 0.8 |
| `MKT_BOND_UNDERPERFORMS` | 28 | R | holds SAFE | `−[1–6]%` | mag | 0.8 |
| `MKT_DIVIDEND_CUT` | 30 | R | holds a dividend payer | payout `× [0.0–0.6]` | mag | 0.8 |

### Windfall — 9 events, 11.2% raw share, ~29 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `WIN_TAX_REFUND` ✅ | 1 | C | — | `0.4× monthlyIncome × [0.2–2.5]` | mag | 6.5 |
| `WIN_BIRTHDAY_MONEY` | 2 | C | age < 25 | `cpi×7500 × [0.3–3.0]` | mag | 6.5 |
| `WIN_WORK_BONUS` | 3 | C | employed | `0.5× monthlyIncome × [0.2–2.0]` | mag | 6.5 |
| `WIN_SOLD_OLD_THING` | 7 | U | — | `cpi×12000 × [0.3–4.0]` | mag | 2.9 |
| `WIN_EMPLOYER_STOCK_VESTS` | 8 | U | professional tier | shares, not cash; `0.8× monthlyIncome × [0.4–2.0]` | mag | 2.9 |
| `WIN_DORMANT_ACCOUNT` | 4 | R, **O** | — | `cpi×40000 × [0.2–2.0]`, minus dormancy fees | mag | 1 |
| `WIN_INHERITANCE` | 5 | R | age > 28 | `8× monthlyIncome × [0.2–5.0]`, mood `−[6–18]` | mag | 0.8 |
| `WIN_CLASS_ACTION` | 6 | R | — | `cpi×400 × [0.5–3.0]` — deliberately anticlimactic | mag | 0.8 |
| `WIN_LOTTERY_SMALL` | 9 | R | has bought tickets | `cpi×5000 × [0.2–8.0]` | mag | 0.8 |

### Scam / temptation — 8 events, 9.5% raw share, ~24 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `SCM_COWORKER_CRYPTO` ✅ | 51 | C | employed | stake `[0.15–1.0]× monthlyIncome` | mag | 6.5 |
| `SCM_GUARANTEED_RETURNS` | 52 | C | — | stake `[0.2–2.0]× monthlyIncome`, returns 0 | mag | 6.5 |
| `SCM_PAYDAY_OFFER` | 53 | U | cash low | principal `[0.3–1.0]× monthlyIncome` at payday APR | mag | 2.9 |
| `SCM_MLM_INVITE` | 54 | U | — | buy-in `cpi×35000 × [0.5–3.0]`, mood `−[2–10]` | both | 2.9 |
| `SCM_RENT_TO_OWN` | 57 | U | — | item `cpi×60000 × [0.6–2.0]`, effective APR `[60–160]%` | mag | 2.9 |
| `SCM_PHISHING` | 55 | R | — | loss `[0.05–1.5]× monthlyIncome`, recovery roll | both | 0.8 |
| `SCM_FAKE_JOB_FEE` | 56 | R | unemployed | fee `cpi×15000 × [0.5–3.0]` | mag | 0.8 |
| `SCM_TIMESHARE_PITCH` | 58 | R | age > 30 | commitment `cpi×250000 × [0.5–2.0]`, recurring | mag | 0.8 |

### Housing — 6 events, 5.8% raw share, ~15 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `HOU_RENT_INCREASE` ✅ | 15 | C | renting | rent `× [1.02–1.14]`, recurring | mag | 6.5 |
| `HOU_DOWN_PAYMENT_REACHED` | 60 | U | savings ≥ threshold | surfaces buy-vs-rent; no magnitude | branch | 2.9 |
| `HOU_MAINTENANCE_SURPRISE` | 61 | U | owns home | `1.5× monthlyIncome × [0.3–3.5]` | mag | 2.9 |
| `HOU_LANDLORD_SELLS` | 59 | R | renting | forced move, costs `1.2× monthlyIncome × [0.5–2.0]` | mag | 0.8 |
| `HOU_PROPERTY_TAX_REASSESSED` | 62 | R | owns home | tax `× [0.9–1.4]`, recurring | mag | 0.8 |
| `HOU_REFINANCE_WINDOW` | 63 | R | has mortgage, rates fell | APR `−[0.5–2.5]pp`, fees `cpi×200000 × [0.5–1.5]` | mag | 0.8 |

### Health & aging — 5 events, 4.1% raw share, ~10 fires

| Event id | A# | Tier | Gate | Magnitude | Var | Fires |
|---|---|---|---|---|---|---|
| `HLT_MEDICAL_BILL` | 12 | U | — | `0.9× monthlyIncome × [0.2–4.0]`, larger if uninsured | both | 2.9 |
| `HLT_UNEXPECTED_DENTAL` ✅ | 20 | U | — | `cpi×55000 × [0.4–3.0]` | mag | 2.9 |
| `HLT_INSURANCE_ENROLLMENT` | 64 | U, **O** | employed | premium/deductible tradeoff, no draw | branch | 1 |
| `HLT_INJURY_OFF_WORK` | 65 | R | — | `[2–16]` weeks income interruption | mag | 0.8 |
| `HLT_AGING_PARENT` | 66 | R | age > 35 | `0.6× monthlyIncome × [0.3–3.0]`, recurring | both | 0.8 |

### Family & relationships — 0 events

Appendix A 68–71 are all v2. The category exists in the engine enum and stays
empty. Appendix A#67 (*health costs rise with age*) is not in this catalogue
either — it is a passive drift, not an event, and belongs in the expense model.

---

## 5. What the numbers say

### 5.1 Raw shares now track §9.5

Tiers above were chosen so the pool's raw weight share matches the §9.5 budget.
Total pool weight 3,915 across 76 events.

| Category | §9.5 target | Raw share | Δ |
|---|---|---|---|
| Social | 22% | 22.9% | +0.9 |
| Emergency | 18% | 17.7% | −0.3 |
| Career | 16% | 15.7% | −0.3 |
| Market | 14% | 13.2% | −0.8 |
| Windfall | 12% | 11.2% | −0.8 |
| Scam | 10% | 9.5% | −0.5 |
| Housing | 5% | 5.8% | +0.8 |
| Health | 3% | 4.1% | +1.1 |

All within 1.1 points, against −6.1 for emergency at the 45-event pool. The gap
closed by adding emergency events, not by inflating multipliers — a player who
keeps a healthy emergency fund should still meet the category.

### 5.2 The repetition floor is much higher than a pool count

This corrects the figure in the first draft of this document, which assumed
events within a category fire equally. They do not — the tier system is the
whole point — and the common tier is what binds.

A common event fires `255 × 100 ÷ T` times, where `T` is total pool weight. For
that to reach C5's limit of 4, `T ≥ 6,375`. At this pool's average weight of 51.5:

| Constraint | @255 fires | @200 fires |
|---|---|---|
| Uniform-weight floor (255 ÷ 4) | 64 events | 50 events |
| **With C/U/R tiering** | **~124 events** | **~98 events** |

**No MVP-scale pool passes C5 at §5.3's frequency.** 45 fails, 76 fails (common
events fire 6.5×), and the full-game target of ~120 only just clears it. At C4's
200-fire ceiling the requirement drops to ~98 — still most of the full pool.

Three ways out, and they are not exclusive:

1. **Lower `SLOT_LAMBDA`** — the only lever that moves C4 and C5 together. But
   C4 has a second half: longest quiet stretch, target ≤26w, measured 10w at
   pool 45 and 51w at the shipped pool of 8. Lowering λ widens the gaps, so this
   must be checked against the 26w bound, not just the density bound.
2. **Compress the tiers** (e.g. C=100/U=60/R=30 instead of 100/45/12). Raises
   average weight, lowers the pool requirement, and costs texture — the run
   starts to feel uniformly random rather than having a common everyday and a
   rare shock. `[T]`, so it needs a DECISIONS entry and a C-suite re-run.
3. **Relax C5's limit of 4 for the common tier specifically.** A common event
   appearing 6 times in thirty years is arguably correct — cars do break down
   repeatedly. This is the option §3.3's card variants exist to make bearable,
   and it may be the honest answer: the limit should be per-tier, not global.

Option 3 also reframes issue #1. Its Option C ("redefine *decision point*")
cannot fix repetition, because C5 counts firings rather than decisions — but a
per-tier repetition limit *can*, and it is a smaller change than either of the
others.

### 5.3 Modelling caveats

- **Gates are ignored.** `EMG_CAR_BREAKDOWN` cannot fire for a carless player;
  `MKT_CRASH` needs equities; six events are v2-shaped and gate on owning a home.
  Real fires per event are lower than the tables and vary by playstyle — which
  makes repetition *worse*, because a narrower eligible pool concentrates fires
  on fewer events.
- **Multipliers are ignored**, and they are large (up to 2.5×).
- **Cooldowns** (52–104 weeks) bound repeats at 15–30 per 30-year run and so are
  not the binding constraint anywhere above.
- **`oncePerRun`** events are shown as 1; their weight redistributes to the rest
  of the pool after they fire.
- Every figure is 30-year. See the run-length note at the top.

---

## 6. Beyond MVP — reaching ~120

This catalogue holds 76. Appendix A supplies 4 more (68–71, family, v2), leaving
~40 to be written. §5.2 says that gap is not optional decoration — it is what
C5 needs to pass at any density above ~200 fires.

Expansion priority follows the fire counts rather than Appendix A's own note:
**social** (58 fires), **emergency** (45) and **career** (40) absorb the most
repetition and should get the most new events. Family is the only category with
no MVP presence and needs its four v2 events before the health/family 3% budget
means anything.
