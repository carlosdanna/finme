# Event Catalogue — categories, pool sizing, and likelihood

Working document for issue #1 (*GDD §5.3's event frequency contradicts Appendix
C4's decision density*). It takes GDD Appendix A's prose catalogue and turns it
into something measurable: every MVP event assigned an engine `category` and a
rarity tier, and the expected number of times each one fires in a 30-year run.

**This document does not settle issue #1.** It supplies the arithmetic that the
decision needs, and it surfaces a third constraint that neither §5.3 nor C4
mentions: pool size and repetition (C5) are bound to decision density by the same
number, and the current MVP target of 45 events cannot satisfy both.

Sources: GDD §5.2 (categories), §5.3 (frequency and pool size), Appendix A
(catalogue), Appendix C4/C5 (balance tests), TDD §9.1 (slot scheduling), §9.3
(rarity tiers), §9.5 (category weight budget).

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
| Family & relationships | `FAM_` | Shared finances, dependents, obligation | — (v2, no MVP events) |

### Rarity tiers

`baseWeight` comes from three tiers (TDD §9.3, constants in
[schema.ts:28-30](packages/engine/src/events/schema.ts#L28-L30)). Weight is
*relative within the eligible pool at a slot* — it is not a probability.

| Tier | `baseWeight` | Meaning |
|---|---|---|
| **C** — common | 100 | The everyday texture of a life |
| **U** — uncommon | 45 | Happens a few times across three decades |
| **R** — rare | 12 | A handful of runs will never see it |
| **O** — once per run | tier + `oncePerRun` | Narrative beat; cannot repeat |

State multipliers (§5.1) then scale weight by the player's situation, and gates
remove ineligible events entirely. Both are ignored in the modelling below —
see §4 for why that matters.

---

## 2. How likelihood is derived

1. TDD §9.1 pre-draws event **slots** at init: `gap = clamp(3 + floor(−ln(U) / SLOT_LAMBDA), 3, 10)`
   with `SLOT_LAMBDA = 0.22` **[T]**. The §9.1 text claims ≈11.5 slots/year, ~345
   over 30 years; the hard `[3, 10]` clamp actually produces **~253**.
2. A slot fires at most one event, so **fired events ≈ decision points**. The
   measured p50 at a 45-event pool is **256** (`pnpm -F @finme/sim c-suite`,
   run 2026-09-06).
3. Fires per category = 255 × §9.5 target share.
4. Fires per event = category fires × `baseWeight` ÷ sum of the category's weights.

Everything below uses **255 fired events per 30-year run** as the reference. A
column at 200 is given in §4 for the alternative where C4's ceiling wins.

---

## 3. The MVP pool — 45 events

GDD Appendix A marks 45 events with ★ but only 42 stars exist, and three of them
sit under a heading that does not match the `category` the engine would give
them. This list reconciles both.

**Recategorised from Appendix A's headings:** *Rent increase notice* (A#15,
listed under Emergencies) is `housing` — this is already how it ships as
`HOU_RENT_INCREASE`. *Medical bill* (A#12) and *Unexpected dental* (A#20, ships
as `HLT_UNEXPECTED_DENTAL`) are `health`, not Emergencies.

**Three events promoted to MVP** to reach the stated 45, all from Appendix A's
unmarked entries, chosen to relieve the categories §4 shows as thinnest:
`WIN_SOLD_OLD_THING` (A#7), `SOC_SUBSCRIPTION_CREEP` (A#47),
`SOC_FAMILY_ASKS_HELP` (A#50).

✅ marks the 8 events already written in
[mvp.json](packages/content/events/mvp.json). "Fires/run" is the modelled
expectation from §2 — an upper bound, since it assumes the event is eligible at
every slot.

### Social / lifestyle — 8 events, 22%, ~56 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `SOC_FRIEND_WEDDING` ✅ | 42 | C | — | 9.7 |
| `SOC_GROUP_TRIP` | 44 | C | — | 9.7 |
| `SOC_UPGRADE_AFTER_RAISE` | 46 | C | after a raise | 9.7 |
| `SOC_BIG_SALE` | 48 | C | — | 9.7 |
| `SOC_ROOMMATE_OFFER` | 43 | U | renting | 4.4 |
| `SOC_FRIEND_BORROWS` | 45 | U | — | 4.4 |
| `SOC_SUBSCRIPTION_CREEP` | 47 | U | — | 4.4 |
| `SOC_FAMILY_ASKS_HELP` | 50 | U | — | 4.4 |

### Emergency — 5 events, 18%, ~46 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `EMG_CAR_BREAKDOWN` ✅ | 10 | C | owns car | 15.2 |
| `EMG_PHONE_DIES` | 11 | C | — | 15.2 |
| `EMG_LAPTOP_DIES` | 13 | U | studying | 6.8 |
| `EMG_URGENT_TRAVEL` | 14 | U | — | 6.8 |
| `EMG_THEFT` | 18 | R | — | 1.8 |

### Career — 8 events, 16%, ~41 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `CAR_UNPAID_OVERTIME` | 34 | C | employed | 8.9 |
| `CAR_NETWORKING` | 36 | C | — | 8.9 |
| `CAR_RAISE_BELOW_INFLATION` ✅ | 41 | C | employed, ≥1y tenure, year boundary | 8.9 |
| `CAR_PROMOTION_OFFERED` | 31 | U | employed, performance high | 4.0 |
| `CAR_COMPETITOR_OFFER` | 33 | U | employed | 4.0 |
| `CAR_CERTIFICATION` | 35 | U | — | 4.0 |
| `CAR_LAYOFF` | 32 | R | employed | 1.1 |
| `CAR_SIDE_HUSTLE` | 39 | R | side hustling | 1.1 |

### Market — 7 events, 14%, ~36 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `MKT_HOT_STOCK_CHATTER` | 29 | C | — | 10.6 |
| `MKT_CORRECTION` | 21 | U | holds equities | 4.8 |
| `MKT_SECTOR_BOOM` | 23 | U | — | 4.8 |
| `MKT_MOONSHOT_SPIKE` | 24 | U | holds Moonshot | 4.8 |
| `MKT_MOONSHOT_COLLAPSE` | 25 | U | holds Moonshot | 4.8 |
| `MKT_INFLATION_SPIKE` ✅ | 26 | U | — | 4.8 |
| `MKT_CRASH` | 22 | R | holds equities | 1.3 |

### Windfall — 6 events, 12%, ~31 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `WIN_TAX_REFUND` ✅ | 1 | C | — | 9.7 |
| `WIN_BIRTHDAY_MONEY` | 2 | C | age < 25 | 9.7 |
| `WIN_WORK_BONUS` | 3 | U | employed | 4.4 |
| `WIN_SOLD_OLD_THING` | 7 | U | — | 4.4 |
| `WIN_DORMANT_ACCOUNT` | 4 | R, **O** | — | 1 (capped) |
| `WIN_LOTTERY_SMALL` | 9 | R | has bought tickets | 1.2 |

### Scam / temptation — 6 events, 10%, ~26 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `SCM_COWORKER_CRYPTO` ✅ | 51 | C | employed | 8.7 |
| `SCM_GUARANTEED_RETURNS` | 52 | U | — | 3.9 |
| `SCM_PAYDAY_OFFER` | 53 | U | cash low | 3.9 |
| `SCM_MLM_INVITE` | 54 | U | — | 3.9 |
| `SCM_RENT_TO_OWN` | 57 | U | — | 3.9 |
| `SCM_PHISHING` | 55 | R | — | 1.0 |

### Housing — 2 events, 5%, ~13 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `HOU_RENT_INCREASE` ✅ | 15 | C | renting | 11.4 |
| `HOU_LANDLORD_SELLS` | 59 | R | renting | 1.4 |

### Health & aging — 3 events, 3%, ~8 fires

| Event id | A# | Tier | Gate | Fires/run |
|---|---|---|---|---|
| `HLT_MEDICAL_BILL` | 12 | U | — | 2.5 |
| `HLT_UNEXPECTED_DENTAL` ✅ | 20 | U | — | 2.5 |
| `HLT_INSURANCE_ENROLLMENT` | 64 | U, **O** | employed | 1 (capped) |

### Family & relationships — 0 events

All four Appendix A entries (68–71) are v2. The category exists in the engine
enum and stays empty for MVP.

---

## 4. What the numbers say

### Raw weight shares land close to §9.5, with one gap

Summing `baseWeight` across the 45 events above (total 2531) gives the share each
category would take if every event were always eligible:

| Category | §9.5 target | Raw share | Δ |
|---|---|---|---|
| Social | 22% | 22.9% | +0.9 |
| Emergency | 18% | 11.9% | **−6.1** |
| Career | 16% | 18.1% | +2.1 |
| Market | 14% | 13.3% | −0.7 |
| Windfall | 12% | 12.4% | +0.4 |
| Scam | 10% | 11.5% | +1.5 |
| Housing | 5% | 4.4% | −0.6 |
| Health | 3% | 5.3% | +2.3 |

Emergency is the one real gap: five events cannot carry 18% at tier weights that
every other category also uses. In play the gap partly closes — the emergency
multipliers (`emergencyFundMonths < 1`, `carAgeYears > 6`) fire exactly when the
design wants them to. But relying on multipliers to hit a *baseline* share means
a player who keeps a healthy emergency fund sees the category almost vanish. The
cleaner fix is more emergency events, not bigger multipliers.

### Pool size and decision density are the same argument

GDD §5.3 says a repeatable event should appear "no more than 3–4 times" in a run.
Appendix C5 enforces 4 as a hard limit. At 255 fires that is a floor on pool size:

| Category | Fires @255 | Min events @≤4 | Fires @200 | Min events @≤4 |
|---|---|---|---|---|
| Social | 56 | 15 | 44 | 11 |
| Emergency | 46 | 12 | 36 | 9 |
| Career | 41 | 11 | 32 | 8 |
| Market | 36 | 9 | 28 | 7 |
| Windfall | 31 | 8 | 24 | 6 |
| Scam | 26 | 7 | 20 | 5 |
| Housing | 13 | 4 | 10 | 3 |
| Health | 8 | 2 | 6 | 2 |
| **Total** | **255** | **68** | **200** | **52** |

**A 45-event pool cannot satisfy C5 at any density the two documents propose.**
It needs ~68 events at §5.3's frequency, and still ~52 at C4's ceiling. The
measured run confirms it: `C5@45` reports p50 **6.0** firings per event, max
**13**, against a limit of 4.

This is a constraint issue #1 does not currently weigh. Restating its options:

- **Option A (raise C4's ceiling to ~300)** costs the most content: ~80 events to
  keep C5 passing, nearly the full-game pool, in MVP.
- **Option B (lower `SLOT_LAMBDA`)** is the only option that moves C4 and C5 in
  the same direction. Even at 200 fires the pool must roughly double to 52.
- **Option C (redefine "decision point")** changes what C4 counts but not what
  C5 counts — the same events still fire, and C5 keeps failing. It cannot fix
  repetition on its own.

Note also that C4's *other* half already passes only at a 45-event pool: longest
quiet stretch is 10w at pool 45 versus 51w at the shipped pool of 8, against a
26w target. Lowering `SLOT_LAMBDA` widens that gap and has to be checked against
the 26w bound, not just the density bound.

### Modelling caveats

- Gates are ignored. `EMG_CAR_BREAKDOWN` cannot fire for a carless player;
  `MKT_CORRECTION` needs equities. Real fires per event are lower than the table
  and vary by playstyle — which makes the repetition problem *worse*, because a
  narrower eligible pool concentrates fires on fewer events.
- Multipliers are ignored, and they are large (up to 2.5×).
- Cooldowns (52–104 weeks) bound repeats at 15–30 per 30-year run and so are not
  the binding constraint anywhere in this table.
- `oncePerRun` events are shown as 1 and their unused weight redistributes to
  the rest of their category after they fire.

---

## 5. Beyond MVP — the remaining ~75

Appendix A lists 71 entries and targets ~120. Twenty-nine are unmarked — 5, 6,
7\*, 8, 16, 17, 19, 27, 28, 30, 37, 38, 40, 47\*, 49, 50\*, 56, 58, 60–63, 65–71 —
of which the three starred here are promoted into MVP above, leaving 26. Those 26
plus ~49 events still to be written fill the gap to 120. §4's arithmetic
says expansion priority should follow the fire counts, not the appendix's own
note: **social, emergency, career** are the three categories that most need
depth, and emergency is the one where the appendix is furthest behind its own
weight budget.
