# FinMe — Technical Design Document
### Companion to GDD Rev 2. Formulas, system behavior, and event specification.

**Scope:** this document specifies *how* the systems in the GDD compute. Where the GDD says "moderate APR," this document gives the number and the equation. All constants are marked **[T]** (tunable — expected to move during balance passes) or **[F]** (fixed — changing it breaks determinism, save compatibility, or a stated design promise).

**Units convention, applied everywhere without exception:**
- All rates are quoted **annualized nominal** in config, and converted at point of use.
- Monthly rate = `annual / 12`. Weekly rate = `annual / 52`. Never mixed within one instrument.
- All currency is stored as **integer cents** (`number`, not float dollars). Display divides by 100.
- Time is stored as `weekIndex` (0-based, integer). Everything else — date, age, month, year, quarter — is derived. There is no second source of truth for time.

---

## 1. Time & Calendar

### 1.1 Canonical time

```
weekIndex        : integer, 0 .. (runLengthYears * 52) - 1
yearIndex        = floor(weekIndex / 52)
weekOfYear       = weekIndex % 52
age              = startAge + yearIndex
```

### 1.2 The 4-4-5 calendar **[F]**

52 weeks map to 12 months in a repeating 4-4-5 pattern per quarter (13 weeks × 4 = 52).

```
MONTH_LENGTHS = [4,4,5, 4,4,5, 4,4,5, 4,4,5]   // weeks per month, Jan..Dec
MONTH_START_WEEK = [0,4,8, 13,17,21, 26,30,34, 39,43,47]
```

```
monthOfYear(weekOfYear) = largest m where MONTH_START_WEEK[m] <= weekOfYear
isMonthBoundary(weekIndex) = MONTH_START_WEEK.includes(weekIndex % 52)
isYearBoundary(weekIndex) = (weekIndex % 52 === 0) && weekIndex > 0
isQuarterBoundary(weekIndex) = [0,13,26,39].includes(weekIndex % 52)
```

**Consequence to hold onto:** months are unequal in length. A 5-week month has 25% more weekly paychecks than a 4-week month against the same fixed rent. This is realistic, it is visible in the cash flow view, and it is a deliberate source of mild budgeting texture. Do not "fix" it by averaging.

Salaried pay is `annualSalary / 52` per week regardless of month length. Hourly pay is `hourlyRate × hoursWorked`.

---

## 2. Deterministic RNG

### 2.1 Generator **[F]**

`mulberry32`. Chosen over PCG32 for implementation size; 32-bit state is sufficient for this application and its output distribution is adequate for a game simulation.

```js
function mulberry32(a) {
  return function() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### 2.2 Stream derivation **[F]**

Each subsystem gets an independent stream seeded from the run seed plus a stream name, via FNV-1a 32-bit:

```js
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const stream = (seed, name) => mulberry32(fnv1a(`${seed}::${name}`));
```

**Stream names (fixed set):**

| Stream | Consumed by | Consumed when |
|---|---|---|
| `startingDraw` | Starting scenario + its randomized parameters | Run init only |
| `market` | Full price series for all assets, regime/crash timeline, inflation path | Run init only |
| `jobTimeline` | Which jobs/opportunities exist in the world and when | Run init only |
| `eventSlots` | Week indices at which events fire | Run init only |
| `eventSelection` | One uniform per slot, used to pick from the state-filtered pool | Run init only (values pre-drawn) |
| `eventOutcome` | Rolls *inside* an event's resolution (repayment success, repair cost variance) | During play |
| `jobApplication` | Application success rolls | During play |
| `flavor` | Logbook variant selection, cosmetic text | During play |

**Rule [F]:** streams pre-drawn at init (`startingDraw`, `market`, `jobTimeline`, `eventSlots`, `eventSelection`) must be fully consumed during initialization into materialized arrays. They are never touched again. This is what guarantees the GDD §13 promise that two runs share an identical world regardless of player behavior.

**Rule [F]:** `flavor` must never influence simulation state. Adding a Logbook variant must not change any number in any run.

**Rule [F]:** every consumption site is deterministic in call order. Never call an RNG inside a loop whose iteration count depends on unordered map traversal. Iterate over sorted-by-id arrays.

### 2.3 Seed format **[F]**

```
{BASE32_SEED}/v{RULESET_VERSION}      e.g.  4F2A9C1B/v1.3
```

Ruleset version increments on any change to a **[T]** or **[F]** constant, formula, or event definition. On import of a mismatched version the game loads the run but displays a non-blocking banner: *"This run was created under ruleset v1.2. Outcomes may differ."*

### 2.4 Derived helpers

```js
const uniform  = (rng, lo, hi) => lo + rng() * (hi - lo);
const intIn    = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));  // inclusive
const normal   = (rng) => {                                   // Box-Muller, cached pair
  const u1 = Math.max(rng(), 1e-12), u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
const pick     = (rng, arr) => arr[Math.floor(rng() * arr.length)];
```

`normal()` consumes exactly **two** draws every call. Do not cache the second Box-Muller output across calls — it makes consumption count depend on call parity and breaks reproducibility across refactors.

---

## 3. Market Model

The entire price history for every asset, for every week of the run, is generated at initialization from the `market` stream and stored. Prices are never rolled during play.

### 3.1 Asset parameters

| Asset | id | Price drift μ (annual) **[T]** | Volatility σ (annual) **[T]** | Dividend yield **[T]** | Regime beta **[T]** |
|---|---|---|---|---|---|
| Bond Fund | `BOND` | 0.000 | 0.040 | 0.040 | −0.15 |
| SafeCo Index | `SAFE` | 0.052 | 0.160 | 0.018 | 1.00 |
| BlueChip Corp | `BLUE` | 0.045 | 0.220 | 0.030 | 0.90 |
| Moonshot Tech | `MOON` | 0.060 | 0.450 | 0.000 | 1.80 |
| Crypto-ish Token | `CRYP` | 0.040 | 0.700 | 0.000 | 2.50 |

Total expected return = price drift + dividend yield. SafeCo's 5.2% + 1.8% = 7.0% matches the GDD.

### 3.2 Base price process **[F: form, T: parameters]**

Geometric Brownian motion in log space, weekly steps:

```
μ_w = (ln(1 + μ) − σ² / 2) / 52
σ_w = σ / √52

logP[t] = logP[t−1] + μ_w + σ_w · Z_t          Z_t ~ N(0,1) from `market`
P[t]    = exp(logP[t])
```

All assets start at an index value of 100.00 **[F]** so charts are comparable and share counts are readable.

### 3.3 The median-vs-mean property (this is the C1 safeguard)

Under GBM the **median** multi-year outcome is `exp(μ_log · T)` where `μ_log = ln(1+μ) − σ²/2`, while the **mean** is `exp(ln(1+μ)·T)`. High volatility drags the median down even with attractive drift. Computed annually:

| Asset | `μ_log` (annual) | Median price growth/yr | Median total/yr (w/ div) |
|---|---|---|---|
| BOND | −0.0008 | −0.08% | +3.9% |
| SAFE | +0.0379 | +3.86% | +5.7% |
| BLUE | +0.0198 | +2.00% | +5.0% |
| MOON | −0.0430 | **−4.21%** | −4.2% |
| CRYP | −0.2058 | **−18.6%** | −18.6% |

This is the mathematical guarantee behind GDD Appendix C1: **speculation has an attractive mean and a losing median.** A player who dumps everything into Moonshot usually does badly and occasionally does spectacularly, which is precisely the real-world shape and precisely the lesson. Do not raise `MOON.μ` above ~0.09 without recomputing this table — at `μ_log > 0` the game starts rewarding gambling.

Crypto-ish at σ=0.70 has a brutal median. That is intentional, but verify in C1 that the right tail is still fat enough to be tempting; if the asset is never chosen, it teaches nothing.

### 3.4 Regime / crash overlay **[T]**

GBM alone produces drawdowns but not the correlated, multi-week, narratively legible crashes the design wants. A crash timeline is drawn at init and overlaid.

**Crash scheduling.** Inter-arrival time in years is drawn from an exponential with rate λ = 0.11 **[T]** (≈3.3 crashes per 30-year run), clamped to a minimum separation of 3 years:

```
gap_years = max(3, −ln(U) / 0.11)
```

**Crash shape.** Each crash has:
```
declineWeeks   = intIn(8, 20)
recoveryWeeks  = intIn(20, 90)
depth          = uniform(0.22, 0.45)     // market-wide, on the SAFE reference
```

Applied as an additive drag on log-returns during the decline, and a partial-recovery boost after, scaled per asset by regime beta:

```
during decline (k weeks in of declineWeeks):
  drag[asset] = beta[asset] · ln(1 − depth) / declineWeeks

during recovery:
  boost[asset] = −0.72 · beta[asset] · ln(1 − depth) / recoveryWeeks
```

The 0.72 factor **[T]** means crashes are not fully recovered by the overlay alone — the rest comes from ordinary drift, which is why recovery takes years and why sequence-of-returns risk is real. The negative bond beta produces flight-to-quality: bonds rise modestly during equity crashes, which is what makes a 60/40 allocation discoverable through play rather than through a tooltip.

**Booms** use the same machinery with λ = 0.09, `depth` negative (−0.15 to −0.30), and no recovery phase.

**Sector events** apply the same overlay to a single asset with beta 1.0 and short duration (2–6 weeks).

### 3.5 Dividends

Paid at quarter boundaries into the settlement cash account:

```
dividendPayment = shares · P[t] · (annualYield / 4)
```

Taxable as ordinary income in the year received (§6.3). If the `autoReinvest` standing order is on, the payment immediately buys `dividendPayment / P[t]` shares — **but the tax liability is still incurred.** This is deliberate: auto-reinvest can create a year-end tax bill with no cash to pay it, which is a genuinely instructive trap.

### 3.6 Inflation path **[T]**

Drawn annually at init as an AR(1) process:

```
i[0] = 0.02
i[y] = 0.02 + 0.60 · (i[y−1] − 0.02) + 0.008 · Z_y
i[y] = clamp(i[y], −0.005, 0.09)
```

Cumulative deflator, used for every real-vs-nominal display:

```
CPI[0] = 1.0
CPI[y] = CPI[y−1] · (1 + i[y−1])
realValue(nominal, y) = nominal / CPI[y]
```

Inflation spike events (§9, `MKT_INFLATION_SPIKE`) override `i[y]` upward to `uniform(0.05, 0.08)` for that year.

**Applied to:** all fixed expenses (rent, utilities, food, phone, insurance), tax bracket thresholds, wage growth floors, tuition, and event payout magnitudes. **Not applied to:** existing fixed-rate debt balances or payments — which is exactly why inflation quietly helps a fixed-rate borrower, a subtle and rarely-taught point that the annual review should be able to surface.

---

## 4. Player State Model

### 4.1 Core state shape

```ts
interface RunState {
  seed: string;
  rulesetVersion: string;
  weekIndex: number;
  startAge: number;              // 18
  runLengthYears: number;        // 10 (MVP) | 30 | 40 | 50

  cashCents: number;
  savingsCents: number;
  emergencyFundCents: number;
  emergencyStreakWeeks: number;

  holdings: Record<AssetId, { shares: number; lots: TaxLot[] }>;
  retirement: { balanceCents: number; contributionPct: number; };

  job: JobState | null;
  performance: number;           // 0..100, hidden
  experienceWeeks: Record<JobTier, number>;
  skills: Record<SkillId, number>;

  energy: number;                // 0..100
  mood: number;                  // 0..100

  debts: Debt[];
  creditProfile: CreditProfile;

  ownedAssets: { car?: CarAsset; home?: HomeAsset; };
  housingTier: 0 | 1 | 2 | 3;

  standingOrders: StandingOrders;
  eventHistory: Record<EventId, number[]>;   // weekIndices when fired
  flags: Set<string>;                         // narrative + gating flags
  decisionLog: DecisionRecord[];              // append-only, for replay/QA
}

interface TaxLot { shares: number; costBasisCents: number; purchasedWeek: number; }
```

**Tax lots are mandatory, not optional.** The holding-period capital gains split (GDD §3.8) cannot be computed without them. Sales use **FIFO** **[F]** — chosen over specific-lot identification because lot-picking is a tax optimization minigame the game explicitly doesn't want.

### 4.2 Net worth

```
assets      = cash + savings + emergencyFund
            + Σ_a (shares_a · P_a[t])
            + retirementBalance
            + carValue(t)
            + homeValue(t)

liabilities = Σ_d balance_d + accruedUnpaidBills + mortgagePrincipal

netWorth    = assets − liabilities
```

Note that `retirementBalance` counts in full despite early-withdrawal penalties. The alternative (haircutting it) is more "accurate" and much worse pedagogy — it would make the highest-value action in the game look less valuable on the headline number.

---

## 5. Debt Instruments

### 5.1 Credit card

```
APR         = 0.18 + creditRateAdjustment      // 0.18 .. 0.27  [T]
monthlyRate = APR / 12

// At each month boundary:
interest        = statementBalance · monthlyRate        // if not paid in full last month
newBalance      = statementBalance + interest + newCharges − payment
minimumPayment  = max(2500, round(0.02 · balance) + interest)   // $25 floor [T]
```

**Grace period [T]:** if the previous statement was paid in full, no interest accrues on new purchases. This makes the card genuinely free when used well, which is what makes it a trap rather than an obvious mistake.

**Payoff projection** (shown in the Debts panel, the single most educational number in the game):

```
n = −ln(1 − (balance · r) / payment) / ln(1 + r)          r = monthlyRate
```
Undefined when `payment ≤ balance · r` — in that case display **"Never"**, in the same neutral typography as any other number. That word does more teaching than any tooltip.

### 5.2 Amortizing loans (personal, auto, student, mortgage)

```
r = APR / 12
n = termMonths
monthlyPayment = principal · r / (1 − (1 + r)^(−n))

// each month:
interestPortion  = balance · r
principalPortion = monthlyPayment − interestPortion
balance         -= principalPortion
```

The Debts panel shows the interest/principal split per payment. The share of the first payment that is interest is exactly `1 − (1 + r)^(−n)` — it has no principal term in it, so a $100k and a $900k mortgage front-load identically. At the rates in the table below, a 30-year mortgage's first payment is **81% interest at the best credit and 89% at the worst**, ~86% mid-range; a 15-year is ~63%. This is the amortization lesson and it needs no commentary.

| Instrument | APR **[T]** | Term | Notes |
|---|---|---|---|
| Personal loan | `0.13 − 0.06·creditQuality` → 7–13% | 24–60 mo | `creditQuality = (score−580)/270`, clamped 0..1 |
| Auto loan | `0.11 − 0.055·creditQuality` → 5.5–11% | 36–60 mo | Secured; default → repossession |
| Student loan | 0.045 | 120 mo | Interest accrues during study; capitalizes at repayment start |
| Mortgage | `0.075 − 0.02·creditQuality` | 180/360 mo | Requires ≥10% down, score ≥620 |

### 5.3 BNPL

```
installment   = purchaseAmount / 4
schedule      = weeks [0, 2, 4, 6] from purchase
lateFee       = 700   // $7 [T]
```
Miss 1 → late fee, −15 credit score impact via missed-payment counter. Miss 2 → second fee, account frozen (no new BNPL for 26 weeks). Miss 3 → sent to collections: remaining balance becomes a collections debt, severe credit hit (−80 equivalent), no further interest but persistent.

Critically: **BNPL obligations count as liabilities on the balance sheet from the moment of purchase.** The whole lesson is that it's debt that doesn't feel like debt.

### 5.4 Payday loan

Fee-structured, not APR-structured, because that's how the real product hides its cost:

```
fee        = 0.15 · principal        // $15 per $100 [T]
termWeeks  = 2
effectiveAPR = (fee / principal) · (52 / termWeeks) = 3.90   // 390%
```

The UI shows the fee prominently and the effective APR in the same size type, in the Debts panel, without comment. Rollover: if unpaid at term, the fee is charged again on the full principal. Three rollovers and the player has paid 45% of principal in fees with the principal untouched — the Logbook should notice this dryly.

### 5.5 Credit score **[T]**

No score exists until 26 weeks after the first reported credit line opens. Before that, `score = null` and the UI displays "No credit history" — not a number, not a zero.

Entry score on file establishment: `uniform(620, 660)`.

```
score = 300 + 550 · clamp(
    0.35 · paymentHistory
  + 0.30 · utilizationScore
  + 0.15 · ageScore
  + 0.10 · mixScore
  + 0.10 · derogatoryScore
, 0, 1)
```

```
paymentHistory   = onTimeWeighted / (onTimeWeighted + 2.5 · missedWeighted)
                   // both decay by 0.995 per week, so old sins fade
utilization      = revolvingBalance / totalRevolvingLimit
utilizationScore = utilization <= 0.10 ? 1.0
                 : clamp(1 − (utilization − 0.10) / 0.80, 0, 1)
ageScore         = clamp(oldestAccountWeeks / 520, 0, 1)          // 10 yr to max
mixScore         = clamp(distinctDebtTypesEverHeld / 3, 0, 1)
derogatoryScore  = clamp(1 − 0.25·collections − 0.60·bankruptcies, 0, 1)
```

Score is recomputed at each month boundary and moves toward its target by at most **±20 points/month** **[T]**, so it feels like a lagging indicator rather than a live readout — which is both realistic and better for pacing.

**Gates:** loan APRs (§5.2), housing tiers 2 and 3, insurance premiums, mortgage eligibility. **Never jobs** (GDD §3.5).

---

## 6. Income & Taxes

### 6.1 Gross pay

```
// hourly
weeklyGross = hourlyRate · hoursWorked · (overtimeHours > 0 ? blended : 1)
              where overtime hours pay 1.5×

// salaried
weeklyGross = annualSalary / 52
```

### 6.2 Annual raise, applied at year boundary **[T]**

```
performanceBonus = ((performance − 50) / 50) · 0.02        // −2% .. +2%
careerCurve      = age < 30 ? 0.012 : age < 45 ? 0.008 : age < 55 ? 0.002 : 0.000
raise            = max(0, inflation[y] · 0.80 + performanceBonus + careerCurve)
```

The `· 0.80` factor is the quiet villain of the whole game: **the default raise lags inflation.** Measured over 800 seeded 30-year runs from age 22, what it actually produces is:

| Career (average performer unless noted) | Real salary after 30 years | Lifetime after-tax income |
|---|---|---|
| Stay put, weak performer (20) | **0.79×** | $1.29M |
| Stay put, average | 1.11× | $1.49M |
| Stay put, strong performer (80) | 1.58× | $1.75M |
| Hop every 7 years | 1.82× | $1.82M |
| Hop every 5 years | 2.32× | $2.01M |
| Hop every 3 years | 3.77× | $2.55M |

So a player who performs *below* average and never moves does lose real income — 21% of it. An average performer who never negotiates and never job-hops does not lose ground outright; they **gain far less than they could have**, which is the more honest lesson and the more common real outcome. Never hopping costs **$513,000 of lifetime after-tax income, 34% more**, and more than doubles the ending salary.

This single coefficient does more teaching than any event in the catalogue, and it should be visible in the annual review's real-vs-nominal income line and in its counterfactual line — and nowhere else. Note that the lifetime gap (34%) is much narrower than the ending-salary gap (2.1×), because early years dominate the sum; the two framings tell different stories, so choose deliberately. Re-run `pnpm -F @finme/sim wages` after changing any of these constants.

Job-hopping (accepting a competitor offer) grants a one-time step of `uniform(0.08, 0.18)` **[T]**, which is why it dominates loyalty — again, discoverable, never stated.

### 6.3 Tax computation

Brackets are indexed: `threshold[y] = threshold[0] · CPI[y]`.

```
BRACKETS = [
  { upTo:  1_500_000, rate: 0.00 },   // cents
  { upTo:  4_000_000, rate: 0.12 },
  { upTo:  9_000_000, rate: 0.22 },
  { upTo:  Infinity,  rate: 0.32 },
]

function incomeTax(taxableCents, cpi) {
  let tax = 0, prev = 0;
  for (const b of BRACKETS) {
    const cap = b.upTo === Infinity ? Infinity : b.upTo * cpi;
    if (taxableCents <= prev) break;
    tax += (Math.min(taxableCents, cap) - prev) * b.rate;
    prev = cap;
  }
  return Math.round(tax);
}
```

**Taxable income** = employment gross + side hustle gross + dividends + short-term realized gains − retirement contributions.

**Capital gains, split by holding period [F]:**
```
holdingWeeks = currentWeek − lot.purchasedWeek
rate = holdingWeeks >= 52 ? 0.15 : marginalIncomeRate
```

**Withholding:**
```
weeklyWithholding = incomeTax(weeklyEmploymentGross · 52, cpi) / 52
```
Applied only to employment income. **Side hustle income, dividends, and realized gains are unwithheld**, which produces a year-end bill. This is intentional and is one of the game's best "wait, what?" moments — do not add withholding to them as a quality-of-life improvement.

**Annual settlement** at year boundary:
```
owed      = incomeTax(totalTaxable, cpi) + capitalGainsTax
settlement = totalWithheld − owed        // positive = refund, negative = bill due
```
A bill exceeding available cash creates an `accruedUnpaidBills` liability with a 6% annual penalty rate **[T]**.

### 6.4 Retirement account

```
employeeContribution = weeklyGross · contributionPct              // default 0.00 [F]
employerMatch        = min(employeeContribution, weeklyGross · 0.04)   // 100% of first 4% [T]
```
Contributions reduce taxable income. Growth follows the player's chosen allocation within the account (default `SAFE` 100%). Early withdrawal before age 59: `penalty = 0.10 · amount` plus ordinary income tax on the full amount.

**The default contribution is 0% and the game never prompts.** GDD §3.10 is explicit that discovering this in the epilogue is the lesson. The slider is visible in the Investing panel; nothing highlights it.

---

## 7. Energy, Mood, and the Weekly Allocation

### 7.1 Time points

10 per week **[F]**. Caregiver start permanently commits 2. Activity costs per GDD §3.6.

### 7.2 Energy

```
energy[t+1] = clamp(
    energy[t]
  + 2                                          // passive baseline recovery [T]
  + 18 · restPoints
  − 40 · (workFullTime ? 1 : 0)
  − 24 · (workPartTime ? 1 : 0)
  − 12 · overtimePoints
  −  8 · studyPoints
  − 14 · sideHustlePoints
  −  4 · paidSocialPoints
  −  2 · freeSocialPoints
  + moodEnergyCoupling
, 0, 100)

moodEnergyCoupling = mood > 70 ? +4 : mood < 30 ? −4 : 0        // [T]
```

Note the arithmetic: full-time work (−40) plus baseline (+2) requires roughly **2.2 rest points/week** just to break even. With 5 points consumed by work, the player has 5 free and must spend ~2 on rest, leaving 3 for study, social, and side hustle. That tightness is the opportunity-cost engine of the game and should be verified in balance testing, not adjusted casually.

### 7.3 Mood

```
mood[t+1] = clamp(
    mood[t]
  + 12 · paidSocialPoints
  +  7 · freeSocialPoints
  +  2 · restPoints
  −  5 · (workFullTime ? 1 : 0)
  −  6 · overtimePoints
  −  2 · studyPoints
  −  4 · sideHustlePoints
  + discretionarySatisfaction
  + housingMoodModifier                    // tier 0: −4, 1: 0, 2: +3, 3: +5  [T]
  − debtStress
  − decayFloorAdjusted
, 0, 100)

discretionarySatisfaction = min(8, 8 · (discretionarySpend / discretionaryBaseline))
debtStress = dti > 1.0 ? 6 : dti > 0.5 ? 3 : 0     // dti = unsecured debt / annual gross
decayFloorAdjusted = mood > 20 ? 1 : 0.5           // decay halves below 20 [T]
```

### 7.4 Anti-spiral guarantees **[F — these are safety properties, not tuning]**

Three mechanisms, each independently sufficient to prevent an unrecoverable state:

1. **Free social always exists**, at +7 mood for 1 time point and zero cash. A player with no money can always spend 3 points on free social for +21 mood/week, which exceeds any decay rate.
2. **Decay halves below mood 20**, so the floor is approached asymptotically rather than crossed.
3. **`SOC_REACH_OUT`** (§9) is force-scheduled when `mood < 25` for 4 consecutive weeks and has not fired in 26 weeks. It grants +25 mood at zero cost. It bypasses the normal slot schedule — this is the one place where an event is not seed-placed, and it is deliberate.

**Invariant to assert in tests:** from any reachable state, a scripted "rest and free social only" strategy must return mood and energy above 50 within 8 weeks.

### 7.5 Job performance

```
performance[t+1] = clamp(
    performance[t]
  + (energy >= 60 ? 1.5 : 0)
  − (energy < 25 && workedThisWeek ? 4 : 0)
  − (consecutiveOvertimeWeeks > 6 ? 3 : 0)
  + eventModifiers
, 0, 100)
```
Below 40 → written warning (visible, Logbook beat, `flags.add('written_warning')`). Below 20 → fired with 2 weeks' notice. Recovering above 55 clears the warning.

---

## 8. Owned Assets

### 8.1 Car

```
offLotDrop = 0.12                                  // immediate, at purchase [T]
value(t)   = purchasePrice · (1 − 0.12) · exp(−0.16 · yearsOwned)     // [T]
floor      = 0.08 · purchasePrice                  // scrap value
```
Ongoing: insurance (annual, scales with credit score and vehicle value), fuel/maintenance as a monthly expense, plus `EMG_CAR_BREAKDOWN` risk scaling with age.

A financed car is the canonical **underwater** demonstration: at 60-month financing with a low down payment, `loanBalance > carValue` for roughly the first 30 months. The balance sheet shows this plainly.

### 8.2 Home *(v2)*

```
value(t)  = purchasePrice · exp(driftPath)         // drift 0.030/yr, σ 0.06 [T]
maintenance = 0.010 · value / year                 // [T]
propertyTax = 0.011 · value / year                 // [T]
```
Transaction cost on sale: 6% **[T]**. Combined with maintenance and tax, this is what makes the buy-vs-rent question genuinely non-obvious over short horizons and clearly favorable over long ones — which is the correct real answer and should emerge from arithmetic, not from copy.

**This property depends on the rent level, not on the home model.** Owning removes the rent line from the budget, so the comparison resolves through cash flow; there is deliberately no rent term here. Measured against a renter who invests the difference in `SAFE`, the buyer only comes out ahead if rent is priced at roughly **`homePrice / 16` per year [T]** — the housing tiers in `packages/content` must be set against the home price range, never independently of it. At that ratio the break-even mortgage rate is ~6.5%, which is a credit score of about 715: buying pays off for good credit and does not for a thin file, with no special-casing anywhere. At `/18` the buyer loses at every horizon and loses more the longer they hold, which inverts the intent above. Re-run `pnpm -F @finme/sim housing` after changing the mortgage rate, the home drift, or the rent tiers.

---

## 9. Event System

### 9.1 Slot scheduling **[F: mechanism, T: rate]**

At init, from the `eventSlots` stream:

```
w = 0
while (w < totalWeeks) {
  gap = clamp(3 + floor(−ln(U) / 0.22), 3, 10)     // mean ≈ 4.5, hard bounds [T]
  w += gap
  if (w < totalWeeks) slots.push(w)
}
```
≈11.5 slots/year, ~345 over a 30-year run. Also pre-drawn: one uniform per slot from `eventSelection`, stored as `slotTickets[]`.

### 9.2 Selection at a slot

This is the mechanism that reconciles state-weighted events with seed reproducibility (GDD §13). The **ticket** is fixed by the seed; what the ticket maps to depends on state.

```js
function selectEvent(state, slotIndex) {
  const eligible = EVENTS
    .filter(e => passesGates(e, state))
    .filter(e => cooldownExpired(e, state))
    .filter(e => !(e.oncePerRun && state.eventHistory[e.id]?.length))
    .sort((a, b) => a.id.localeCompare(b.id));       // stable order — REQUIRED

  const weights = eligible.map(e => e.baseWeight * multiplierProduct(e, state));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return null;                       // slot passes silently

  let x = slotTickets[slotIndex] * total;
  for (let i = 0; i < eligible.length; i++) {
    x -= weights[i];
    if (x <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}
```

The `.sort()` is load-bearing. Without a stable ordering, the same ticket maps to different events across engine versions and every shared seed silently breaks.

### 9.3 Event schema

```ts
interface EventDef {
  id: string;                       // stable, never reused, never renamed
  category: EventCategory;
  baseWeight: number;               // C=100, U=45, R=12
  oncePerRun?: boolean;
  cooldownWeeks: number;
  gates: Gate[];                    // ALL must pass
  multipliers: Multiplier[];        // product applied to baseWeight
  title: string;
  body: string;                     // supports {{var}} interpolation
  choices: Choice[];
}

interface Gate {
  type: 'age' | 'flag' | 'notFlag' | 'employed' | 'ownsCar' | 'ownsHome'
      | 'hasDebtType' | 'holdsAsset' | 'stat' | 'lifeStage';
  // e.g. { type:'stat', stat:'cashCents', op:'<', value: 50_000 }
}

interface Multiplier {
  when: Gate;
  factor: number;                   // multiplicative; 1.0 = no effect
}

interface Choice {
  id: string;
  label: string;                    // never signals correctness
  requires?: Gate[];                // choice hidden or disabled if unmet
  effects: Effect[];
  deferred?: DeferredEffect[];      // fires N weeks later
  outcomeRoll?: {                   // uses `eventOutcome` stream
    stream: 'eventOutcome';
    branches: { p: number; effects: Effect[]; logbookKey: string }[];
  };
  logbookKey: string;
}

type Effect =
  | { k:'cash'; cents:number }                       // may be a formula string
  | { k:'mood'; delta:number }
  | { k:'energy'; delta:number }
  | { k:'performance'; delta:number }
  | { k:'debt'; instrument:DebtType; principalCents:number }
  | { k:'asset'; assetId:AssetId; sharesDelta:number }
  | { k:'expense'; category:string; cents:number; recurring?:boolean }
  | { k:'flag'; add?:string; remove?:string }
  | { k:'jobOffer'; jobId:string }
  | { k:'creditEvent'; kind:'missed'|'onTime'|'collection'|'inquiry' };
```

**Magnitude scaling.** Fixed cent amounts go stale across a 30-year run with inflation and rising income. Event magnitudes are therefore expressed as formulas evaluated at fire time:

```
"cents": "cpi * 45000"                    // $450 in year-0 money
"cents": "0.35 * monthlyIncome"           // proportional to the player's life
"cents": "clamp(0.5 * monthlyIncome, cpi*20000, cpi*250000)"
```
Prefer `monthlyIncome`-relative for anything meant to feel like a meaningful hit at any life stage, and `cpi`-relative for things with a real-world fixed price (a phone, a dental visit).

### 9.4 Fully specified example events

```json
{
  "id": "EMG_CAR_BREAKDOWN",
  "category": "emergency",
  "baseWeight": 100,
  "cooldownWeeks": 60,
  "gates": [{ "type": "ownsCar" }],
  "multipliers": [
    { "when": { "type":"stat", "stat":"carAgeYears", "op":">", "value":6 }, "factor": 2.0 },
    { "when": { "type":"stat", "stat":"emergencyFundMonths", "op":"<", "value":1 }, "factor": 1.4 }
  ],
  "title": "The noise got worse",
  "body": "It started three weeks ago and you've been pretending not to hear it. This morning the car made the noise and then stopped making any noise at all. The shop says {{repairCost}}.",
  "choices": [
    {
      "id": "repair",
      "label": "Pay for the repair",
      "effects": [{ "k":"cash", "cents": "-clamp(0.6*monthlyIncome, cpi*40000, cpi*180000)" }],
      "logbookKey": "car_repair_paid"
    },
    {
      "id": "bnpl",
      "label": "Put it on the card",
      "requires": [{ "type":"hasDebtType", "value":"CREDIT_CARD" }],
      "effects": [{ "k":"debt", "instrument":"CREDIT_CARD",
                    "principalCents":"clamp(0.6*monthlyIncome, cpi*40000, cpi*180000)" }],
      "logbookKey": "car_repair_carded"
    },
    {
      "id": "scrap",
      "label": "Let it go",
      "effects": [
        { "k":"flag", "remove":"owns_car" },
        { "k":"cash", "cents":"carScrapValue" },
        { "k":"mood", "delta":-8 }
      ],
      "deferred": [{
        "afterWeeks": 1,
        "condition": { "type":"flag", "value":"job_requires_vehicle" },
        "effects": [{ "k":"flag", "add":"job_at_risk_no_vehicle" }]
      }],
      "logbookKey": "car_scrapped"
    }
  ]
}
```

```json
{
  "id": "SCM_COWORKER_CRYPTO",
  "category": "scam",
  "baseWeight": 100,
  "cooldownWeeks": 78,
  "gates": [{ "type":"employed" }],
  "multipliers": [
    { "when": { "type":"stat", "stat":"cryptoPriceChange52w", "op":">", "value":0.5 }, "factor": 2.5 },
    { "when": { "type":"stat", "stat":"mood", "op":"<", "value":40 }, "factor": 1.3 }
  ],
  "title": "Dev is very confident about this",
  "body": "He's shown you the chart twice. He is up, he says, {{coworkerClaim}} percent. He is not lying, exactly — he just isn't mentioning the part before the part he's showing you.",
  "choices": [
    { "id":"in_big",   "label":"Put in a month's pay",
      "effects":[{ "k":"asset","assetId":"CRYP","sharesDelta":"monthlyIncome / price('CRYP')" },
                 { "k":"cash","cents":"-monthlyIncome" }],
      "logbookKey":"crypto_in_big" },
    { "id":"in_small", "label":"Put in a little",
      "effects":[{ "k":"asset","assetId":"CRYP","sharesDelta":"(0.15*monthlyIncome)/price('CRYP')" },
                 { "k":"cash","cents":"-0.15*monthlyIncome" }],
      "logbookKey":"crypto_in_small" },
    { "id":"pass",     "label":"Say you'll think about it",
      "effects":[{ "k":"mood","delta":-2 }],
      "logbookKey":"crypto_passed" }
  ]
}
```

Note what this event does **not** do: there is no branch where the game evaluates the choice. The player buys an asset whose price series was fixed at initialization. Sometimes the coworker is right. The lesson is delivered by the distribution across many runs (§3.3), not by the event punishing the player, and that is what keeps it from reading as a morality play.

```json
{
  "id": "CAR_RAISE_BELOW_INFLATION",
  "category": "career",
  "baseWeight": 100,
  "cooldownWeeks": 52,
  "gates": [
    { "type":"employed" },
    { "type":"stat", "stat":"weeksInCurrentJob", "op":">", "value":52 },
    { "type":"stat", "stat":"lastRaisePct", "op":"<", "value":"inflationThisYear" }
  ],
  "multipliers": [],
  "title": "Annual review",
  "body": "Your manager says the number out loud like it's good news: {{raisePct}} percent. Prices went up {{inflationPct}} percent this year.",
  "choices": [
    { "id":"accept",    "label":"Say thank you",
      "effects":[], "logbookKey":"raise_accepted" },
    { "id":"negotiate", "label":"Ask for more",
      "outcomeRoll": { "stream":"eventOutcome", "branches":[
        { "p":"0.25 + 0.3*performanceNorm",
          "effects":[{ "k":"flag","add":"raise_negotiated" }],
          "logbookKey":"raise_negotiated_win" },
        { "p":"rest",
          "effects":[{ "k":"performance","delta":-3 },{ "k":"mood","delta":-6 }],
          "logbookKey":"raise_negotiated_loss" }
      ]},
      "logbookKey":"raise_negotiate_attempt" }
  ]
}
```

### 9.5 Category weight budget

Target share of fired events over a full run **[T]**, enforced by tuning `baseWeight` and validated in Appendix-C5-style tests:

| Category | Target share | Notes |
|---|---|---|
| Social/lifestyle | 22% | Highest-frequency, needs the deepest pool |
| Emergency | 18% | Concentrated in low-emergency-fund states |
| Career | 16% | Age-front-loaded |
| Market | 14% | Gated on holding assets |
| Windfall | 12% | Deliberately less common than emergencies |
| Scam/temptation | 10% | Higher weight when income or mood suggest vulnerability |
| Housing | 5% | v2 |
| Health/family | 3% | v2, age-gated |

---

## 10. The Weekly Tick Pipeline **[F — order is contractual]**

Any reordering changes outcomes for existing seeds. This sequence is part of the ruleset version.

```
1.  weekIndex++
2.  Apply market prices for weekIndex (lookup only — no RNG)
3.  Accrue income:
      a. gross pay
      b. retirement contribution + employer match
      c. withholding
      d. net → cash
4.  Apply standing orders (in declared order):
      a. emergency fund transfer
      b. savings transfer
      c. auto-invest
      d. debt payments
5.  If quarter boundary: pay dividends, apply auto-reinvest
6.  If month boundary:
      a. fixed expenses (inflation-adjusted)
      b. debt interest accrual + minimum payments
      c. BNPL installments
      d. credit score recompute
      e. check bankruptcy trigger
7.  Event check: if weekIndex ∈ slots → selectEvent() → present modal → apply effects
8.  Resolve any deferred effects scheduled for this week
9.  Apply player's time allocation → energy, mood, performance, side hustle income
10. Check firing / warning thresholds
11. Check anti-spiral force-schedule (§7.4)
12. Recompute net worth, append to history
13. Evaluate Logbook triggers, emit entries
14. If year boundary: tax settlement, raise, inflation step, annual review screen
15. Evaluate interrupt conditions → halt advance or continue
```

**Step 7 before step 9** matters: an event that costs energy should constrain that week's allocation, not the next one's.

---

## 11. Logbook Engine

### 11.1 Trigger evaluation (step 13)

Entries are emitted only when a trigger fires. Most weeks emit nothing (GDD §12).

```ts
type Trigger =
  | { k:'event'; eventId:string; choiceId:string; branch?:string }   // always
  | { k:'firstTime'; action:string }                                  // always
  | { k:'threshold'; metric:string; crossed:number; direction:'up'|'down' }
  | { k:'delta'; metric:string; pctChange:number }                    // |Δ| > 10%
  | { k:'streakBreak'; streak:string }
  | { k:'lifeStage'; stage:string }
  | { k:'quiet' };                                                    // rhythm filler
```

**Quiet-entry cadence:** if no entry has been emitted in `intIn(flavor, 6, 10)` weeks, emit a `quiet` entry. This keeps the Logbook breathing during stable stretches without narrating every rent payment.

**Cap:** at most 2 entries per week. If more triggers fire, keep the highest-priority (`event` > `threshold` > `streakBreak` > `firstTime` > `delta` > `quiet`).

### 11.2 Variant selection

```js
const pool = TEMPLATES[logbookKey];
const idx  = Math.floor(flavorRng() * pool.length);
const text = interpolate(pool[idx], varsFor(state, trigger));
```

Anti-repetition: keep a rolling set of the last 3 variant indices used per key and reroll (up to 3 attempts) to avoid immediate repeats. Rerolls consume the `flavor` stream, which is safe precisely because `flavor` never touches simulation state.

### 11.3 Template variables

Available in all templates: `{{amount}}`, `{{jobTitle}}`, `{{age}}`, `{{netWorth}}`, `{{cash}}`, `{{assetName}}`, `{{pct}}`, `{{monthName}}`, `{{yearsIn}}`, `{{friendName}}`, `{{advisorName}}`.

Names are drawn once at run init from the `startingDraw` stream and are stable for the run — the friend who invites you to things in year 2 is the same friend whose wedding you attend in year 6. Cheap continuity, disproportionate narrative payoff.

---

## 12. Epilogue Projection

Monte Carlo, 2,000 paths **[T]**, run in-browser at run end (well under 100ms).

```
For each path:
  W = finalLiquidNetWorth + retirementBalance
  for y in (endAge .. 65):
     r_y = sampled from the player's final allocation
           (per-asset lognormal draws, correlated via a single market factor)
     C_y = finalAnnualContribution · (1 + 0.02)^(y − endAge)
     W = W · (1 + r_y) + C_y
Report percentiles 10 / 50 / 90 in both nominal and real terms.
```

Counterfactual shown alongside: identical contributions held entirely in cash, deflated by 2%/yr. The gap between those two numbers is the single most important output the game produces, and it should be presented as two numbers and a chart with no adjectives whatsoever.

The epilogue uses `Math.random()`, **not** a seeded stream — it is a post-run illustration, not part of the simulation, and seeding it would imply a determinism it doesn't need.

---

## 13. Bankruptcy Implementation

**Trigger check** (step 6e), all three conditions:
```
unsecuredDebt > 2.0 · annualGross
  && cash < monthlyExpenses
  && consecutiveMissedPaymentMonths >= 3
```

**Branch 3 (continue) applies a `DireState` object:**
```ts
{
  dischargedAtWeek: number,
  creditScoreOverride: 450,           // recovers +15/yr, ceiling rises over 7 yr
  noNewCreditUntilWeek: week + 104,
  forcedBudgetUntilWeek: week + 52,   // discretionary capped at floor
  housingForcedTier: max(0, tier - 1),
  investingBlockedUntilCashMonths: 1.0,
  garnishmentPct: 0.15,               // on secured debt still outstanding
  jobTiersBlocked: ['PROFESSIONAL_FINANCE'],  // until week + 260
}
```
Retirement balances are protected from discharge. The early-withdrawal option remains available and is deliberately surfaced during forced budget mode — taking it is the trap inside the trap.

**Test C2 pass condition** (GDD Appendix C): a scripted max-out-and-discharge strategy must produce a worse median 30-year net worth than baseline play, and worse at every percentile above the 10th. If it doesn't, raise `noNewCreditUntilWeek` and the credit recovery ceiling before touching anything else — those are the levers with the least collateral damage to legitimate recovery arcs.

---

## 14. Persistence

### 14.1 Storage

Primary **IndexedDB**, fallback **localStorage**. Autosave every 4 weeks of simulated time and on every event resolution.

A run save is the seed plus the decision log, not a full state dump:
```json
{
  "seed": "4F2A9C1B", "rulesetVersion": "1.3",
  "weekIndex": 412,
  "decisionLog": [ { "w": 3, "t": "alloc", "v": [5,2,2,1,0] },
                   { "w": 7, "t": "event", "e": "EMG_PHONE_DIES", "c": "cheap" } ],
  "standingOrders": { ... },
  "checkpoint": { "weekIndex": 400, "state": { ... } }
}
```
A checkpoint every 100 weeks bounds replay cost; loading replays from the nearest checkpoint. This makes saves small, makes bug reports perfectly reproducible, and makes the "share your run" feature trivially a matter of sharing a JSON blob.

**Warning:** replay-based loading means the ruleset version must match exactly or the replay diverges. On mismatch, load from `checkpoint.state` directly and mark the run as non-comparable.

### 14.2 Export/import

Explicit **Export run (JSON)** and **Import run**, per GDD §8. Also surface a passive warning after 5 days of inactivity, since mobile Safari evicts storage at ~7.

---

## 15. Implementation Notes & Ordering

Suggested build order, chosen so each stage is independently testable and the risky items surface early:

1. **Time, calendar, RNG streams.** Nothing else is testable without deterministic time.
2. **Market generation + charts.** Build the headless harness here, not later — Appendix C1 should be runnable before a single UI panel exists. If the speculation math is wrong, everything downstream is wasted work.
3. **Cash flow: income, withholding, fixed expenses, inflation.**
4. **Debt instruments + credit score.**
5. **Time allocation, energy, mood, performance.**
6. **Event engine + first 10 events.**
7. **Logbook engine** (with placeholder copy; the writing is a parallel workstream).
8. **Annual review + balance sheet history.**
9. **Bankruptcy branches.**
10. **Epilogue projection.**
11. Remaining 35 MVP events, remaining Logbook copy.

**Test C1 before step 6.** It is the only test in the project that can invalidate the design rather than the implementation, and it needs nothing but §3.

---

## Appendix — Constant Reference

| Constant | Value | Class | Section |
|---|---|---|---|
| `TIME_POINTS_PER_WEEK` | 10 | F | 7.1 |
| `WORK_FULLTIME_POINTS` | 5 | F | 7.1 |
| `ENERGY_BASELINE_RECOVERY` | +2/wk | T | 7.2 |
| `MOOD_IMPULSE_THRESHOLD` | 30 | T | 7.3 |
| `INFLATION_TARGET` | 0.02 | T | 3.6 |
| `INFLATION_AR1_PHI` | 0.60 | T | 3.6 |
| `CRASH_RATE_LAMBDA` | 0.11/yr | T | 3.4 |
| `CRASH_RECOVERY_FACTOR` | 0.72 | T | 3.4 |
| `EVENT_GAP_MEAN` | ≈4.5 wk | T | 9.1 |
| `CC_APR_RANGE` | 0.18–0.27 | T | 5.1 |
| `CC_MIN_PAYMENT_FLOOR` | $25 | T | 5.1 |
| `PAYDAY_FEE_RATE` | 0.15 / 2wk | T | 5.4 |
| `EMPLOYER_MATCH_CAP` | 0.04 | T | 6.4 |
| `RETIREMENT_DEFAULT_PCT` | 0.00 | F | 6.4 |
| `RAISE_INFLATION_FACTOR` | 0.80 | T | 6.2 |
| `JOB_HOP_STEP` | 0.08–0.18 | T | 6.2 |
| `CAR_DEPRECIATION_RATE` | 0.16/yr | T | 8.1 |
| `CAPGAINS_LONG_TERM_WEEKS` | 52 | F | 6.3 |
| `CAPGAINS_LONG_RATE` | 0.15 | T | 6.3 |
| `BANKRUPTCY_DTI_TRIGGER` | 2.0 | T | 13 |
| `EPILOGUE_PATHS` | 2000 | T | 12 |

Constants marked **F** are contractual: changing one changes the meaning of every existing seed and must bump the ruleset major version.
