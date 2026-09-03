# Game Design Document: FinMe
### A Browser Life-Sim Game About Money

*Revision 2 — incorporates decisions on run length, event weighting, bankruptcy, pacing, seeding, and scoring. Changes from Rev 1 are noted inline as **[Rev 2]** where a prior decision was reversed.*

---

## 1. High-Level Concept

**Genre:** Life/finance simulation, turn-based (weekly ticks, variable player-facing pacing), browser-based (HTML5/JS)

**Elevator pitch:** Live a simulated life across three decades. Get a job, pay bills, gamble (or not) on the stock market, chase a social life, and deal with the chaos that random events throw at you. Debt can spiral, investments can crash, a scam can wipe you out if you're not paying attention — this is a game with real stakes and real dumb mistakes to make, not a worksheet with a UI.

**Target audience:** Teens to young adults (14–25). The game should stand on its own as something people want to play and replay — not something that announces itself as medicine. It should be playable/marketable as a "life sim with money at the center," in the spirit of games like *Buy Me a Life* or *Bitlife*'s financial arc, rather than positioned as an "educational tool." Financial literacy is the effect of good design, not the pitch.

**Platform:** Browser (desktop + mobile responsive), single-player, no login required (optional save via localStorage, plus run export/import as JSON).

**Run length:** **[Rev 2]** A full run spans **30 years by default** (age 18 → 48), configurable to 40 or 50 years (age 18 → 68). This is a deliberate reversal of the earlier 3–5 year scope: compound growth, career arc, housing, and retirement saving are all decade-scale phenomena and cannot be taught inside a two-year window. See §2.1 for how a run of this length stays playable.

**Session length:** Not a design constraint. **[Rev 2]** Pacing is optimized for *seamlessness* rather than a target minute count — the player should never feel they are clicking through empty weeks, and should always feel the Logbook is keeping up with them. Expect 45–90 minutes for a 30-year run at a comfortable pace, with save/resume support.

**Design philosophy — avoiding the "sanitized edu-game" trap:**
- Consequences should feel real: debt spirals should feel bad, a stock crash should sting, a missed rent payment should have teeth (not just a slap-on-the-wrist popup).
- Choices should not have an obviously "correct" answer flagged by the UI — no green checkmarks for the "responsible" option. Let players learn from outcomes, not from being told what's virtuous.
- Humor, flavor text, and personality in events matter — scam events, weird roommates, a coworker's terrible investment tips — should read like a fun narrative game, not a compliance module.
- No moralizing copy ("Good choice! Saving is important!"). The end-of-run review can be data-driven and a little sardonic, not a gold star sheet.
- Failure states (debt spiral, bankruptcy) should be genuinely uncomfortable to sit in — tension is part of what makes the lesson land. See §4.3, which now has actual teeth rather than an automatic rescue.

**Core systems this teaches (as a side effect, not a stated goal):**
- Income vs. expenses and budgeting
- Assets vs. liabilities, and how net worth is actually calculated from the two
- Different types of debt and how interest compounds against you
- Risk/reward tradeoffs in investing (stocks vs. savings vs. speculation)
- The value — and non-obviousness — of an emergency fund
- Opportunity cost of time (work vs. leisure vs. education vs. hustle)
- How your starting position shapes (but doesn't fully determine) your outcomes
- **[Rev 2]** Compounding over a career, lifestyle inflation, and sequence-of-returns risk — only reachable at the new run length

---

## 2. Core Gameplay Loop

The simulation resolves in **weekly ticks**. The *player-facing* pace is variable (§2.1).

Each week:

1. **Resolve income** — paycheck if employed, minus automatic deductions (withholding estimate, retirement contribution, rent if due this week, subscriptions)
2. **Random event check** — chance of a life event firing (see §5)
3. **Player decision phase** — player allocates time and money:
   - Work (hours set by job; overtime optional)
   - Job hunting / skill-building (education, certifications)
   - Free time activities (social, hobbies, rest, side hustle)
   - Financial actions (buy/sell investments, move money to savings, pay down debt, adjust budget)
4. **End of week summary** — net worth, cash flow, mood/energy update
5. **Month boundary** → bills due (rent, utilities, loan payments, minimum payments)
6. **Year boundary** → tax settlement (see §3.8), annual review screen (see §4.2), birthday and life-stage events

### 2.1 Calendar and pacing **[Rev 2]**

**Calendar.** The 13-month year is gone. A game year is **12 months over 52 weeks**, using a repeating **4-4-5 week** pattern per quarter (13 weeks per quarter × 4 = 52). Rent and all monthly bills fire on the first week of each calendar month. Salaries, tax brackets, and APRs are all quoted annually and divided by 12 for monthly instruments or 52 for weekly accrual — never mixed. Credit card interest accrues **monthly** on the statement balance (this is now unambiguous; Rev 1 said "weekly/monthly").

**Pacing.** A 30-year run is ~1,560 weekly ticks. The player never sits through 1,560 decision prompts. Instead:

- **Advance control.** A single primary button advances time until something needs the player. Its granularity is player-set: *Week / Month / Season / Until something happens*. Default is "Until something happens."
- **Interrupt conditions.** Time-advance halts on: a random event firing, a bill that cannot be paid from available cash, a job offer or firing risk warning, a debt crossing a threshold, energy or mood dropping below a floor, a milestone, a life-stage transition, or any player-set alert (e.g. "stop if SafeCo drops 15%").
- **Standing orders.** The player configures recurring behaviour once and it persists: auto-transfer to savings, auto-invest a fixed amount weekly or monthly, pay minimum / pay statement balance / pay fixed amount on each debt, default time allocation. Changing standing orders is itself a meaningful decision, and the Logbook narrates when a standing order is silently doing something dumb (e.g. auto-investing while carrying 24% APR card debt).
- **Stage-based default granularity.** Early run (first ~3 years) defaults to weekly stops, because that's where the player is learning the panels and where week-to-week cash flow is genuinely tight. From roughly year 4 the default granularity widens to monthly, and past year 15 to quarterly, unless the player narrows it. Life gets less week-to-week precarious as income stabilizes, and the pacing should reflect that.

The design goal: **the number of decisions in a run should be roughly constant regardless of run length** (target ~150–250 meaningful decision points across 30 years). Length buys the player a felt arc and working compound math, not more clicking.

---

## 3. Core Systems

### 3.1 Employment

- Player starts unemployed or with a starter job, depending on starting scenario (§3.7). A no-requirements starter job (barista, warehouse, retail) is always available to avoid a dead early game.
- Jobs have tiers: **Entry-level → Skilled → Professional → Specialist**, gated by education/experience.
- Each job has: wage or salary, hours/week (in time points), stress impact, skill requirements, and optional prerequisites (see below).
- **[Rev 2] Job applications are not automatic.** Meeting the stated requirements makes a job *applicable*, not *granted*. Application success is rolled: base 35%, +15% per year of relevant experience (cap +45%), +20% if a networking event has fired for that employer, −20% if currently unemployed longer than 6 months. Failed applications cost a time point and a small mood hit. This keeps a job change tense rather than turning the career track into a checklist.
- **[Rev 2] Car prerequisite made explicit.** Certain jobs (delivery, trades, some suburban roles) list *vehicle required*. This was referenced only in the debt table in Rev 1 and is now a first-class job attribute, creating a real "spend on a depreciating asset to unlock income" decision.
- **Firing.** Performance is a hidden 0–100 stat. It drops when energy is below 25 at a work week, when overtime is sustained beyond 6 consecutive weeks, or on certain events. Below 40 → written warning (visible, and a Logbook beat). Below 20 → fired, with 2 weeks' notice.
- **[Rev 2] Wage growth and career arc.** Over a 30-year run, wages must not be static. Each job has a within-role annual raise (0–3%, weighted by performance) and promotion opportunities that fire as career events. Career trajectory flattens after roughly age 45 unless the player has invested in skills — a real and rarely-taught fact.

### 3.2 Investments

- A small basket of fictional instruments with different risk profiles:
  - **"SafeCo Index Fund"** — low risk, ~7% average annual nominal growth, low volatility
  - **"BlueChip Corp"** — medium risk, moderate growth, moderate volatility
  - **"Moonshot Tech"** — high risk, high potential growth, high volatility (can crash)
  - **"Bond Fund"** — very low risk, low fixed return, near-zero volatility
  - Optional: **"Crypto-ish Token"** — very high risk/reward, for teaching speculation vs. investing
- **[Rev 2] Returns are nominal, not real.** With inflation now modeled (§3.9), the ~7% index return is a nominal figure and the annual review shows the real (inflation-adjusted) figure alongside it. This is one of the highest-value lessons the longer run length unlocks.
- Prices update weekly via a random walk with drift, plus event-driven shocks (crash, boom, sector news).
- **Dividends.** **[Rev 2]** Previously mentioned once in the loop and modeled nowhere. Now explicit: SafeCo pays ~1.8%/yr, BlueChip ~3%/yr, Bond Fund ~4%/yr, all paid quarterly as cash into the settlement account unless the player enables auto-reinvest (a standing order). Moonshot and Crypto-ish pay nothing. Dividends are taxed as income in the year received (§3.8), which makes auto-reinvest a real, slightly counterintuitive decision rather than a free win.
- Player can buy/sell any time from the Investing panel. No shorting or margin.
- Line chart per asset plus a portfolio chart.
- All values are simulated play money; no real-money mechanics.

**[Rev 2] Volatility model — realism retained.** Per the decision to lean realistic: volatility is not tapered at the end of a run and crashes are not softened. Over 30 years, a run should expect 2–4 significant drawdowns (−20% or worse on the equity assets) placed by the seed, not by proximity to the ending. A late crash genuinely hurting a large portfolio is now a *feature*, because it teaches sequence-of-returns risk — the fact that when your bad years arrive matters as much as your average return. The mitigations that made a late crash survivable in the Rev 1 short run are handled instead by:
- multi-dimensional scoring (§4.2), so final net worth is not the only number that matters;
- the epilogue projection (§4.4), which shows recovery beyond the run's end;
- the fact that a 30-year run gives the player time to actually rebalance toward bonds as they age, which is the real-world answer and is now a discoverable strategy rather than a fact stated in a tooltip.

### 3.3 Budget & Expenses

- Fixed monthly costs: rent/housing tier, utilities, phone, food baseline.
- Player chooses housing tier at start and can upgrade/downgrade (affects mood and cost). **[Rev 2]** Housing costs rise with inflation and with local market drift, so rent is not a fixed number for 30 years.
- Discretionary spending: eating out, entertainment, shopping — costs money, boosts mood/energy.
- **[Rev 2] Lifestyle inflation** is modeled as a soft pull: after a raise or promotion, the *suggested* discretionary budget auto-adjusts upward by default, and the player must actively decline it. This is the single most common real-world wealth leak and it should be a live temptation, not a tooltip. The Logbook notices when it happens, without editorializing.
- **Emergency fund.** A separate bucket, excluded from discretionary spending prompts. **[Rev 2]** It is no longer purely cosmetic: withdrawing from it requires an explicit confirmation naming what it's for, breaks a visible "months of expenses covered" streak, and the confirmation is worded neutrally rather than disapprovingly. The friction is the mechanic.

### 3.4 Assets & Liabilities

Cash flow week to week doesn't tell the whole financial picture, so the game also tracks a **balance sheet** view, since that's what net worth actually is.

**Assets:**
- Cash on hand + savings + emergency fund
- Investment portfolio at current market value
- **Retirement account** balance (see §3.10)
- Car (if purchased) — depreciating on a schedule
- Home (if purchased) — appreciating with its own simplified market drift, contrasting with the car
- Other owned items where modeled (e.g. an item bought via BNPL, once fully owned)

**Liabilities:**
- All active debts from §3.5
- Accrued-but-unpaid bills
- **[Rev 2]** Mortgage principal, if a home is purchased

**Net worth** = assets − liabilities, shown as the primary graph tracked across a run (see §4.2 and §6). A player who buys a depreciating car on a loan can watch net worth go *down* even as their possessions go up — one of the more counterintuitive and valuable things the game teaches.

**Assets & Liabilities panel:** two-column view with net worth as the difference, distinct from the cash-flow view, reinforcing that positive cash flow and negative net worth can coexist.

### 3.5 Debt & Credit — Multiple Distinct Types

| Debt type | How it's triggered | Mechanics | Design intent |
|---|---|---|---|
| **Credit card** | Player opts in, or is offered one via event | Revolving balance, 18–25% APR applied **monthly** to statement balance, minimum payment each month, interest compounds on unpaid balance | The default danger mechanic. Should visibly show payoff time at minimum vs. full payment. |
| **Buy Now, Pay Later (BNPL)** | Offered contextually at point of purchase | Splits purchase into 4 fixed installments, 0% if paid on time; a missed installment triggers a late fee, repeated misses send the balance to collections and hit credit score hard | Teaches "free until it isn't," and how BNPL stacks across purchases without feeling like real debt. **[Rev 2]** Corrected: default failure mode is fees + collections, not silent conversion to an interest-bearing plan, which is not how most BNPL actually works. |
| **Personal/installment loan** | Player applies (emergency, consolidation, opportunity) | Fixed term, fixed monthly payment, lower APR than cards; amount and rate depend on credit score | Teaches that loans aren't inherently bad — used deliberately they're a rational tool. |
| **Auto loan** | Buying a car | Fixed 3–5 year term, moderate APR, secured against a depreciating asset | Teaches secured debt and depreciation: the car's value falls, the loan balance doesn't care. |
| **Student loan** | Choosing a study path with tuition | Low APR, long term, deferred payments while studying, accrues in background | Teaches investment-in-yourself debt: usually net-positive over a career, still a real liability. |
| **Payday / predatory loan** | Offered as an emergency-event option, framed as fast and easy | Very high effective APR, short term, aggressive rollover penalties | The clearest trap instrument, included so players learn to recognize predatory lending and understand *why* it's bad even when it looks like the only option. |
| **Mortgage** **[Rev 2]** | Buying a home (unlocked by down payment + credit score) | Long term (15/30 yr), amortizing, secured; property taxes and maintenance as ongoing costs | New at this run length. Teaches amortization (early payments are almost all interest), and that a house carries costs beyond the payment. |

**Shared mechanics:**
- **Credit score** (300–850). **[Rev 2]** A player at age 18 starts with **no score** ("thin file"), not a number. A score materializes after 6 months of any reported credit line, entering at 620–660. It responds to on-time payments (largest factor), utilization, account age, and missed payments. It gates loan APRs, housing tiers, and insurance costs.
  - **[Rev 2] Credit score no longer gates jobs.** It was an unnecessary spiral amplifier and a regionally specific, morally loaded mechanic. Housing, lending, and insurance gating is enough.
- **Debts panel** shows all active debts side by side with balance, APR, minimum payment, and projected payoff date at the current payment rate — so avalanche-vs-snowball is discoverable from the numbers, not stated.
- No debt type is flagged "good" or "bad" in the UI.

### 3.6 Free Time / Energy

Each week the player has **10 time points**. **[Rev 2]** Costs are now specified:

| Activity | Time points | Energy | Mood | Money |
|---|---|---|---|---|
| Work (full-time) | 5 (fixed) | −40 | −5 | + wage |
| Work (part-time) | 3 (fixed) | −24 | −3 | + wage |
| Overtime | +1 or +2 | −12 each | −6 each | +1.5× wage |
| Rest | 1 each | +18 each | +2 each | 0 |
| Social (paid) | 1 each | −4 | +12 | − cost |
| Social (free) | 1 each | −2 | +7 | 0 |
| Study | 1 each | −8 | −2 | − tuition (if any) |
| Side hustle | 1 each | −14 | −4 | + variable |

- **Energy** 0–100, starts at 80. Below 25 at a work week damages job performance (§3.1).
- **Mood** 0–100, starts at 60. Below 30 multiplies impulse-spending event weight by ~2.5×.
- **[Rev 2] Anti-spiral valve.** The failure mode to avoid is: no money → no paid social → low mood → forced impulse spending → less money. Three guards: **free social** and **rest** always exist and cost nothing; mood decay slows below 20 rather than continuing linearly; and at sustained low mood a "reach out to someone" event fires offering a zero-cost mood recovery. The spiral should be survivable but genuinely unpleasant — the point is that it's hard, not that it's unescapable.
- A player may allocate zero points to work. Doing so for more than 2 consecutive weeks without approved leave triggers the firing track.

### 3.7 Starting Position

Before the first turn the player is **assigned** a starting scenario. **[Rev 2] The player no longer chooses**, because a chosen start breaks seed reproducibility on turn 1 and undercuts the design intent that starting position is something you're dealt, not something you pick. A "Reroll" button is available before the run begins (which changes the seed), and an explicit **Custom Start** mode exists outside of seeded play for teachers and tinkerers, flagged as non-comparable.

| Scenario | Starting cash | Starting debt | Job access | Notes |
|---|---|---|---|---|
| **Stable ground** | Moderate savings | None | Entry-level immediately | Baseline run |
| **Head start** | High savings (family gift) | None | Entry-level + one skilled job unlocked | A cushion changes what risks are affordable |
| **Behind the line** | Low/no savings | Small existing debt | Entry-level only, lower wage | Debt payoff and survival budgeting dominate early |
| **Student path** | Low cash | Student loan active | Locked out of skilled/professional until study completes | Future earning power at the cost of present flexibility. **[Rev 2]** Now viable, since a 30-year run gives the degree time to pay off — at the old 2-year length this start was strictly dominated. |
| **Caregiver** **[Rev 2]** | Moderate | None | Entry-level, but 2 time points/week permanently committed | Time poverty as distinct from money poverty; a common real constraint the original table missed |
| **Random / "Life Draw"** | Randomized | Randomized | Randomized | Replayability; mirrors real unfairness without saying so |

Design intent: the game does not editorialize about which start is harder. The annual review contextualizes performance relative to the starting position without shaming.

### 3.8 Taxes — Simplified Progressive System

A handful of brackets, applied once a year, no itemized deductions or filing minigame. The goal is to make "your marginal rate isn't your average rate" visible.

- **Income tax** (illustrative, **[Rev 2]** indexed to inflation annually so brackets don't silently ratchet over 30 years):
  - 0–$15k: 0%
  - $15k–$40k: 12%
  - $40k–$90k: 22%
  - $90k+: 32%
  - Applied marginally; the year-end summary shows the bracket breakdown and both the marginal and average rate.
- **Capital gains.** **[Rev 2] Now split by holding period**: assets held under 12 months are taxed at the ordinary income rate; assets held 12 months or longer at a flat 15%. Rev 1's flat rate made frequent trading tax-free relative to patience, which taught precisely the wrong thing. This split is cheap to implement and is itself one of the better lessons available.
- **Dividends** taxed as ordinary income in the year received.
- **No tax on unrealized gains** — gains don't count until you sell.
- **Withholding.** A rough weekly withholding estimate makes paychecks feel taxed, trued up at year end into a refund or a bill. **[Rev 2] Side hustle income has no withholding**, so a heavy side-hustle year produces a surprise tax bill at settlement. This is intentional and is one of the game's better "wait, what?" moments. Capital gains are likewise unwithheld, so a big realized gain produces a bill the following spring.
- Explicitly **not modeled**: deductions, credits, dependents, regional tax layers.

### 3.9 Inflation **[Rev 2] — new section**

Mandatory at this run length; without it a 30-year run's numbers become nonsense and the game teaches that a dollar is a dollar forever.

- Baseline **2%/year**, applied to all fixed expenses (rent, utilities, food, insurance), wage growth floors, and tax brackets.
- Event-driven spikes (the "inflation spike" event listed in §5 now has something to hook into) can push a year to 5–8%.
- The annual review shows **nominal vs. real** for income, expenses, and net worth. The moment a player realizes a 3% raise in a 5% inflation year is a pay cut is worth more than any tooltip.
- Cash and savings visibly lose purchasing power. This is the counterweight to the game's otherwise strong "debt is scary → hoard cash" pull, which Rev 1's short run length would have taught by accident.

### 3.10 Retirement Accounts & Employer Match **[Rev 2] — new section**

The signature regional flavor system flagged in §10, now load-bearing given the run length.

- A tax-advantaged retirement account with an **employer match** (e.g. 100% of the first 4% of salary contributed). The match is free money and the game never says so — it just shows up in the balance sheet, and the Logbook may note it dryly.
- Contributions reduce taxable income; withdrawals before the age threshold incur a penalty (which becomes a genuinely tempting bad option during a bankruptcy arc).
- Default contribution is **0%** at game start, not auto-enrolled. Whether the player ever finds and raises this slider is, by design, one of the largest single determinants of their end-of-run outcome, and discovering that in the epilogue is a far better lesson than being prompted.
- Contribution rate is a standing order.

---

## 4. Progression & Scoring

This is not a hard win/lose game — it's a sandbox with a scorecard.

### 4.1 Milestones

Soft goals shown as achievements: first paycheck, first $1,000 saved, first investment, first employer match captured, debt-free, first $10,000 net worth, 3-months-expenses emergency fund, first home, net worth exceeding annual income, financial independence threshold. **[Rev 2]** "Retirement-ready net worth" now makes sense as a milestone rather than being absurd at age 20.

### 4.2 Annual Review **[Rev 2] — replaces "comparison to optimal play"**

The comparison-to-optimal-play scoring is **removed from the design**. It contradicted the no-green-checkmarks philosophy, punished the harder starting scenarios exactly as §3.7 says it shouldn't, and would have been expensive and shaky to compute over a stochastic 30-year run.

In its place, a **year-end review screen** that is the game's main reflective beat:

- **Year-over-year balance sheet.** Assets, liabilities, and net worth for the current year shown against every prior year, as a running table plus a stacked chart. The player compares themselves to their own past, which is both fairer and more motivating than comparing to a synthetic optimum.
- **Cash flow statement for the year**: income by source, expenses by category, savings rate, and the same figures for the prior three years alongside.
- **Nominal vs. real** on every headline figure (§3.9).
- **Debt trajectory**: total balance, interest paid this year, and projected payoff at current behaviour.
- **Two or three concrete counterfactuals**, drawn from decisions the player actually made, stated as arithmetic and nothing else. *"You took the payday loan in March. Covering it from savings would have cost $180 less."* / *"You contributed 0% to the retirement account this year. The match you didn't take was $1,840."* No adjectives, no verdict.
- Skippable, and available on demand from the Logbook afterward.

### 4.3 Bankruptcy **[Rev 2] — reworked**

Rev 1's automatic rescue arc was exploitable: max out every credit line, spend it, get bailed out. Bankruptcy now triggers a **player choice** with no free option.

**Trigger:** unsecured debt exceeds 2× annual gross income, AND cash is below one month of expenses, AND at least 3 consecutive months of missed minimum payments.

**The player chooses one of three:**

1. **End the run here.** The run terminates, and it terminates as a loss. The end screen and epilogue still run, and the epilogue is honest about where this trajectory lands. This is a real ending, not a soft one.
2. **Start over.** New run, new seed (or the same seed, offered explicitly, for players who want to retry the same life).
3. **Keep going.** The run continues in a **dire state** that persists and is not quietly forgiven:
   - Unsecured debt is discharged, but **credit score drops to the floor (~450)** and recovers no faster than ~15 points/year for 7 in-game years.
   - **No new credit of any kind for 24 months.** No cards, no personal loans, no auto loan, no mortgage. Payday lenders will still take the player's call, at worse terms than usual.
   - **Forced budget mode for 12 months**: discretionary spending capped at a bare floor, housing forcibly downgraded one tier, no investing permitted while cash reserves are under one month of expenses.
   - **Income drag**: wage garnishment on any secured debt not discharged; some jobs (financial, certain professional tiers) become inapplicable for 5 years.
   - Retirement account balances are protected from discharge, but the temptation to withdraw early at a penalty is deliberately surfaced.

The player should be able to climb out — a 30-year run has room for a genuine comeback arc, and the Logbook should make that comeback feel earned. But the arithmetic must be worse than never having gotten there, or the mechanic teaches the opposite of its intent. **Balance test: a deliberate max-out-and-discharge strategy must produce a worse median 30-year outcome than baseline play.** If it doesn't, the penalties are too soft.

### 4.4 End of Run & Epilogue Projection **[Rev 2]**

At run end, the player gets:
- The final balance sheet and the full year-over-year history from §4.2.
- The **story recap** pulled from the Logbook (§12).
- An **epilogue projection**: the player's final allocation, contribution rate, and spending behaviour projected forward to age 65 under a range of return scenarios (10th / 50th / 90th percentile), shown against a counterfactual where the same money sat in cash. This is where compounding fully lands, and it costs almost nothing to build.
- **No letter grade, no percentage of optimal, no rank.**

---

## 5. Random Events System

Random events are the game's teaching engine and, together with the Logbook, its main source of replayability.

### 5.1 Weighting **[Rev 2] — decision: state-weighted, confirmed**

Events are **weighted by player state**, as originally intended. This is confirmed as the correct call, and it forces a change to the seeding promise (§13) rather than the other way around.

Each event carries:
- a **base weight**
- **life-stage gates** (min/max age, or a required condition such as *employed*, *owns car*, *has children*)
- **state multipliers** — e.g. emergency-fund-below-1-month raises the weight of cash-crunch emergencies; large equity holdings raise market-event weight; low mood raises impulse-spending weight; high income raises the weight of lifestyle and scam-targeting events
- a **cooldown**, so the same event can't fire twice in quick succession
- an optional **once-per-run** flag for the big narrative beats

Weighting operates on a fixed schedule of event *slots* (§13), so the seed still controls *when* events happen even though state controls *which*.

### 5.2 Categories

| Category | Financial lesson |
|---|---|
| **Windfalls** | Saving vs. spending a windfall |
| **Emergencies** | Importance of an emergency fund |
| **Market events** | Diversification, risk tolerance, sequence-of-returns risk |
| **Career events** | Career capital, networking, negotiation |
| **Social/lifestyle** | Lifestyle inflation, social spending |
| **Scams/temptations** | Recognizing red flags |
| **Housing** **[Rev 2]** | Renting vs. owning, maintenance, moving costs |
| **Health & aging** **[Rev 2]** | Insurance, medical costs, income interruption |
| **Family & relationships** **[Rev 2]** | Shared finances, dependents, obligation to family |

### 5.3 Frequency and pool size **[Rev 2]**

Rev 1's arithmetic didn't work: 8–10 events firing every 1–3 weeks over a run meant each event repeating five to seven times. And "2 per category minimum" across 6 categories exceeded the stated 8–10 total.

- **Frequency:** on average one event every **4–6 weeks**, i.e. roughly **10 per in-game year**, ~300 over a 30-year run.
- **Pool size:** the full game targets **~120 events**; MVP targets **~45**. See **Appendix A**.
- With life-stage gating, only a fraction of the pool is eligible at any age, which both keeps early-run events age-appropriate and makes later decades feel different rather than same-y.
- Cooldowns plus once-per-run flags mean a 30-year run should show a given repeatable event no more than 3–4 times, each with different Logbook prose (§12).

### 5.4 Mechanics

- Each event presents 2–3 choices with different financial outcomes, not always obviously ranked.
- Choices may have delayed consequences that resolve weeks or years later — the scam that seems fine for six months, the certification that pays off in year 8.
- Events may chain: declining one may open a follow-up later.

---

## 6. UI / Screen Structure

1. **Dashboard:** net worth graph, cash on hand, date and age, energy & mood, advance control (§2.1), quick-access panels, active alerts.
2. **Job panel:** current job, listings, apply/quit, performance indicator.
3. **Investing panel:** asset list with charts, buy/sell, portfolio breakdown, contribution and auto-invest standing orders.
4. **Budget panel:** income/expense breakdown, savings, emergency fund with months-covered indicator.
5. **Debts panel:** all debts side by side with balance, APR, minimum, projected payoff.
6. **Balance sheet panel:** assets vs. liabilities, net worth, year-over-year history.
7. **Time allocation panel:** weekly planner. **[Rev 2]** Uses **+/− steppers**, not drag-and-drop — dragging time tokens is finger-hostile on mobile, and this is a mobile-responsive game. Includes a "repeat last week" and "set as default" control feeding standing orders.
8. **Standing orders panel:** all recurring behaviours in one place.
9. **Event modal:** fires on random events, presents choices.
10. **Logbook:** scrollable running diary (§12), always accessible; feeds the end-of-run recap. Annual reviews are pinned in it.
11. **Annual review screen** (§4.2).
12. **End-of-run screen and epilogue** (§4.4).

---

## 7. Difficulty / Accessibility

**[Rev 2] Difficulty modes are split into two independent toggles.** Rev 1 bundled tooltips with market volatility, which meant a player wanting explanations *and* hard markets couldn't have both, and meant "Realistic" mode deleted the glossary that §7 itself called central.

- **Explanations:** *On* (inline tooltips and plain-language definitions for every financial term) / *Off*. **Default On, and available in every difficulty.** The glossary is never removed as a difficulty penalty.
- **Simulation harshness:** *Gentle* (lower volatility, softer event outcomes, more forgiving firing thresholds) / *Standard* / *Harsh* (higher volatility, more frequent adverse events, tighter margins).
- **Glossary** is also browsable as a standalone panel, not only as hover text.
- **No real money, no ads for financial products.** Non-negotiable given the audience.

---

## 8. Technical Scope Assumptions

- Single-page HTML/JS/CSS app, no backend required for MVP; state in memory + localStorage.
- **[Rev 2] Save durability:** localStorage is evicted by mobile Safari after ~7 days of inactivity, which would silently destroy 30-year runs. Mitigations: an explicit **Export run (JSON)** / **Import run** pair, an in-page warning when a save is at risk, and IndexedDB as the primary store with localStorage as fallback.
- **[Rev 2] Telemetry:** an opt-in, anonymous end-of-run summary ping (final net worth, starting scenario, seed, major decision counts, whether bankruptcy fired). A game whose entire value is in its tuning cannot be tuned with zero play data. If a backend is unacceptable for MVP, ship the JSON export and collect playtest runs manually.
- Charts via a lightweight library (Chart.js or similar).
- **RNG:** see §13.

---

## 9. Suggested MVP Cut **[Rev 2] — rescoped]**

- 1 starter job + 5 unlockable jobs across three tiers
- 4 investment options (Bond / Safe index / BlueChip / Moonshot); Crypto-ish held for v2
- **~45 random events** (see Appendix A), life-stage gated
- **Fixed 10-year run** (age 18 → 28) with the full epilogue projection to 65. This is the key MVP compromise: 10 years is enough to show compounding beginning to bite, career progression, and a market cycle, while the epilogue delivers the 40-year lesson without 40 years of simulation.
- Inflation, retirement match, and the annual review are **in** for MVP — they're cheap and they're where the lessons live.
- Mortgage/home ownership, the Caregiver start, and health/aging events are **v2**.
- Bankruptcy with all three branches is **in** for MVP; the dire-state penalties are the whole point of it.

---

## 10. Regional Setting — Single Region, Light Flavor

**Decided:** one region with light regional flavor rather than dual-region realism.

- Core numbers (tax brackets, APRs, debt types) stay generic and simplified.
- Flavor text, job names, and the employer-match retirement system (§3.10) lean recognizably toward a single region for grounded texture, without requiring full regional accuracy.
- A true region-specific realism mode is a possible v2 addition.

*Rationale:* a fully generic system is simpler and more broadly relevant but risks feeling placeless; a fully accurate single-region model is more grounded but costs more and narrows the audience. Light flavor on a generic core is the best balance.

---

## 11. Market Volatility & Advisor NPC

**Market volatility:** see §3.2. Volatility is realistic and not tapered; drawdowns are seed-placed across the run rather than scheduled to escalate toward the ending.

**Financial advisor NPC:** included for MVP in basic form — a recurring character offering advice at check-in points, drawn from a fixed pool where some tips are genuinely useful and some are mediocre or self-serving.

- **[Rev 2] Cadence** is roughly **twice a year** rather than every 8 weeks. At 30 years, an 8-week cadence would need 195 distinct lines and would become a nag. Twice a year gives ~60 appearances over a full run; the MVP pool should be **at least 40 lines** so a 10-year run never repeats.
- Cadence remains player-adjustable (Rarely / Normal / Frequently / Off).
- **[Rev 2] Retrospective reveal.** If advice is sometimes bad but never revealed as bad, players simply learn to ignore the NPC. The end-of-run screen therefore shows, as plain arithmetic: what following every tip would have produced versus what the player actually did. No commentary.
- v2: advisor types (free blog guy / paid advisor / friend who read one book), tracking whether advice was followed, credibility shifting with track record. Design the data structure with this growth path in mind.

---

## 12. Narrative Layer — The Logbook

The Logbook is the main lever against the "spreadsheet with extra steps" problem, and along with the event system it is where replayability actually comes from.

**Core idea:** a running, auto-generated diary that narrates the player's life back to them in short, flavorful entries, building over a run into something worth scrolling back through.

**How it works:**
- Entries are short, second-person, present-tense flavor text with variables slotted in. *"Rent's due again. You transferred the money without really looking at the number this time — that's either good news or bad news."*
- **Multiple templates per situation:** each situation draws from a pool of variants, picked at random. See Appendix B for pool sizing.
- **[Rev 2] Most weeks produce no entry at all.** This is the single most important change to this system. Rev 1 would have generated an entry every week — over 1,560 weeks that is both an enormous content burden and self-defeating, since constant narration is exactly what makes prose feel templated. Silence is free, and it makes the entries that do fire feel earned.
  - **Entry triggers:** random events (always), first-time actions (always), threshold crossings (net worth milestones, debt crossing a line, emergency fund fully funded or drained), notable deltas (a market move over ±10%, an unusually large purchase), streak breaks (first missed payment in a long clean run), life-stage transitions, and roughly one "quiet life" entry per 6–10 weeks to maintain rhythm.
  - Routine rent payments produce entries only occasionally, and preferentially when something about them has changed.
- **Random events get hand-written entries**, per choice and per outcome, since they're the most narratively interesting beats.
- **Milestones and bad stretches both get acknowledged.** A debt spiral shouldn't just be red numbers; the Logbook should reflect stress and scrambling. A big win gets a moment.
- **Annual reviews are pinned into the Logbook**, so scrolling back gives both the story and the data.
- **End-of-run story recap** pulls the most dramatic and defining entries into something that reads like a short story of the life just lived.

**Design intent:**
- Keep the voice from §1 — wry, a little irreverent, never moralizing.
- The Logbook narrates what happened; it never says whether it was smart.
- **[Rev 2] Content cost is real.** Rev 1 called this cheap. At the sizing in Appendix B it's roughly 250–400 pieces of voiced copy for MVP, which is plausibly the largest single content task in the project — larger than most of the code. It's still worth prioritizing for MVP, but it should be scheduled as a content workstream with a named writer and a voice guide, not treated as string-filling done at the end.

---

## 13. Seeded Playthroughs — Shareable Runs **[Rev 2] — promise corrected]**

Rev 1 promised that two players with the same seed would see "the exact same sequence of random events... with the only variable being the choices they personally make." That is **incompatible with state-weighted events** (§5.1), which is the design we're keeping. Since events are selected partly by player state, and state depends on choices, two players with the same seed *will* diverge. The promise is therefore corrected rather than the mechanic.

**The corrected promise: same world, different life.**

A seed fixes:
- the **starting scenario** and its randomized parameters
- the **market price series** for every asset across the whole run, generated up front and independent of player behaviour, including the placement and depth of every crash and boom
- the **event slot schedule** — exactly which weeks an event will fire
- the **candidate draw** at each slot (the ordered list of events considered)
- the **job and opportunity availability timeline** (answering the Rev 1 open question: yes, the seed locks *what becomes available when*; whether the player qualifies for or accepts it remains theirs)

A seed does **not** fix:
- **which** event fires at a given slot, since state weighting filters the candidate list
- anything downstream of player choice

**What this means for the use cases:**
- *Friends comparing runs*: still works, and is arguably better — you both lived through the same 2031 crash and the same job market, and you find out that one of you got a scam pitch where the other got a promotion because of how you'd been playing. That's a more interesting comparison than a pure input-output diff.
- *Speedrun / optimal-play challenges*: still works. The market and opportunity timeline are fixed, which is what optimization needs.
- *Teachers and creators sharing scenarios*: works, with the caveat that the scenario is a world, not a script.
- *Bug reporting*: a seed plus the player's decision log reproduces a run exactly. The decision log is a small append-only list and should be included in the JSON export.

**Engineering requirements:**
- `Math.random()` is not seedable. Use **mulberry32** or **PCG32**.
- **Separate named RNG streams** per subsystem: `market`, `eventSlots`, `eventSelection`, `startingDraw`, `jobTimeline`, `flavor`. With a single shared stream, adding one die roll anywhere reorders every downstream draw and invalidates every shared seed.
- **Logbook variant selection draws from the `flavor` stream only**, so adding prose variants never perturbs simulation determinism.
- **Version the seed** as `seed + rulesetVersion`. Every balance patch otherwise silently breaks previously shared runs. Display it as e.g. `4F2A-9C1B/v1.3`, and warn on import when the ruleset differs.
- The market series is **pre-generated at run start** from the `market` stream, not rolled per tick — this is what guarantees identical worlds regardless of when the player looks at prices.

---

## 14. Open Design Questions

*Resolved since Rev 1:* Logbook pool sizing (Appendix B); whether the seed locks job/investment availability (yes — §13).

Still open:
- What's the right default run length in the shipped game — is 30 years the sweet spot, or does 20 hold attention better while still teaching compounding?
- Should the player be able to *see* the volatility setting's effect before committing, or does that pre-explain the lesson?
- Does the Caregiver start (§3.7) need a distinct win condition, or does the annual review's relative framing carry it?
- How much of the retirement account should be visible before the player enables contributions? Full visibility risks prompting; total invisibility risks nobody ever finding it.
- Should marriage/partnership merge two balance sheets, or is that a v3 system?

---

# Appendix A — Event Catalogue

Format: **Name** — trigger gates — brief. Choices sketched where the design is non-obvious. Weight tiers: C = common, U = uncommon, R = rare, O = once per run.

MVP set marked **★** (45 events). Unmarked entries are the target ~120-event full pool, listed here so the data schema is designed against the full shape.

### Windfalls

1. ★ **Tax refund larger than expected** (C, any) — a few hundred to a few thousand. Save / spend / invest / pay down debt.
2. ★ **Birthday money** (C, age <25) — small windfall from family.
3. ★ **Work bonus** (U, employed) — scales with salary. Arrives just as a discretionary temptation event becomes more likely.
4. ★ **Found an old account** (R, O) — forgotten savings account with a small balance and a dormancy fee already taken.
5. **Inheritance** (R, age >28) — significant, and paired with a grief mood hit, so it doesn't read as pure upside.
6. **Class action settlement** (R) — trivially small, deliberately anticlimactic.
7. **Sold something you forgot you owned** (U) — small.
8. **Employer stock vests** (U, professional tier) — arrives as shares, not cash; teaches concentration risk if held.
9. ★ **Lottery ticket wins** (R) — small win after the player has bought tickets; the Logbook is careful not to celebrate.

### Emergencies

10. ★ **Car breaks down** (C, owns car) — repair, or go without a car (job risk if vehicle-required).
11. ★ **Phone dies** (C, any) — cheap replacement / expensive replacement / BNPL offer surfaces here.
12. ★ **Medical bill** (U, any) — variable, larger if uninsured.
13. ★ **Laptop dies mid-study** (U, studying) — blocks study progress until replaced.
14. ★ **Emergency travel** (U, any) — family situation requires a flight.
15. ★ **Rent increase notice** (C, renting) — absorb / move (moving costs) / negotiate (roll).
16. **Appliance failure** (U, owns home) — pairs with the maintenance lesson.
17. **Pet emergency** (U, has pet) — high cost, high emotional weight.
18. ★ **Bike/car stolen** (R) — insurance question surfaces here, teaching what insurance is for.
19. **Flood/storm damage** (R, owns home) — deductible mechanics.
20. ★ **Unexpected dental** (U) — the classic "not covered" surprise.

### Market events

21. ★ **Market correction** (U, holds equities) — −10 to −15%. Choices: hold / sell / buy more.
22. ★ **Market crash** (R, holds equities) — −25 to −40%, multi-week recovery arc.
23. ★ **Sector boom** (U) — one asset spikes; teaches chasing.
24. ★ **Moonshot spikes** (U, holds Moonshot) — the temptation-to-double-down beat.
25. ★ **Moonshot collapses** (U) — can go to near zero.
26. ★ **Inflation spike** (U, any) — hooks into §3.9; expenses jump, cash loses ground.
27. **Interest rates rise** (U) — variable-rate debt costs more, savings pay more.
28. **Bond fund underperforms** (R) — teaches that "safe" isn't "guaranteed."
29. ★ **Everyone's talking about a hot stock** (C) — social pressure framing, no forced action.
30. **Dividend cut** (R, holds dividend payer) — income assumption breaks.

### Career events

31. ★ **Promotion offered** (U, employed, performance high) — more money, more stress, more hours.
32. ★ **Layoff** (R, employed) — severance based on tenure; unemployment arc follows.
33. ★ **Job offer from a competitor** (U, employed) — take it / use it to negotiate / decline.
34. ★ **Asked to work unpaid overtime** (C, employed) — performance vs. energy.
35. ★ **Certification opportunity** (U) — costs money and time now, unlocks a tier later.
36. ★ **Networking event** (C) — costs a time point, raises future application odds.
37. **Manager leaves** (U, employed) — performance and promotion odds shift.
38. **Company restructure** (R) — role changes, possible pay freeze.
39. ★ **Side hustle takes off** (R, side hustling) — meaningful income, tax surprise follows.
40. **Burnout** (U, sustained overtime) — forced rest, income interruption.
41. ★ **Raise below inflation** (C, employed, year boundary) — the real-vs-nominal lesson as a live moment.

### Social / lifestyle

42. ★ **Friend's wedding** (C) — gift + travel; decline has a mood cost.
43. ★ **Roommate opportunity** (U, renting) — lower rent, mood variance.
44. ★ **Group trip invitation** (C) — the classic "can't afford it but everyone's going."
45. ★ **Friend asks to borrow money** (U) — lend / decline / partial. Repayment is not guaranteed.
46. ★ **Upgrade temptation after a raise** (C, after raise) — the lifestyle inflation hook from §3.3.
47. **Subscription creep audit** (U) — the game reveals accumulated small subscriptions.
48. ★ **Big sale on something you wanted** (C) — BNPL offered prominently.
49. **Moving in with a partner** (U, age >22) — expenses drop, complexity rises.
50. **Family asks for help** (U) — obligation with no good option.

### Scams / temptations

51. ★ **Crypto pitch from a coworker** (C) — confident, wrong, likeable.
52. ★ **"Guaranteed returns" DM** (U) — outright fraud; money is simply gone if taken.
53. ★ **Payday loan offer during a cash crunch** (U, cash low) — the trap instrument surfaced at the worst moment.
54. ★ **MLM invitation from an old friend** (U) — costs money and social capital.
55. ★ **Phishing / account compromise** (R) — small loss, credit monitoring aftermath.
56. **Fake job offer with an upfront fee** (R, unemployed) — targets desperation specifically.
57. ★ **Rent-to-own furniture offer** (U) — effective APR is buried; the panel will show it if the player looks.
58. **Timeshare-style pitch** (R, age >30).

### Housing *(v2 unless marked)*

59. ★ **Landlord sells the building** (R, renting) — forced move.
60. **Down payment threshold reached** (U, savings high) — the buy-vs-rent decision surfaces.
61. **Home maintenance surprise** (U, owns home).
62. **Property tax reassessment** (U, owns home).
63. **Refinance opportunity** (U, has mortgage, rates fell).

### Health & aging *(v2 unless marked)*

64. ★ **Insurance enrollment decision** (O, employed) — premium vs. deductible tradeoff.
65. **Injury with income interruption** (R) — teaches disability coverage by its absence.
66. **Aging parent support** (U, age >35).
67. **Health costs rise with age** (passive, age >45).

### Family & relationships *(v2)*

68. **Partnership finances merge** (O, partnered).
69. **Child arrives** (O) — permanent expense and time changes.
70. **Childcare cost shock** (U, has child).
71. **Separation** (R, partnered) — asset split.

*Events 72–120 to be written out during content production; the categories above are sized to absorb them. Priority for expansion: Social/lifestyle and Scams, since those are the highest-replay-value categories and the ones players will notice repeating first.*

---

# Appendix B — Logbook Content Sizing

Answering the Rev 1 open question, adjusted for the "most weeks are silent" rule (§12).

**Tier 1 — high-frequency situations: 6 variants each.** These are the lines a player will see repeatedly in a single run.
- Rent paid / rent paid with difficulty / rent missed
- Paycheck received (employed) / no paycheck (unemployed)
- Quiet week
- Debt payment made / minimum only / missed
- Investment bought / sold
- Emergency fund contribution / withdrawal
- Mood low / energy low

That's ~15 situations × 6 = **90 lines.**

**Tier 2 — threshold and milestone moments: 3 variants each.** Seen a few times per run at most.
- Each milestone from §4.1 (~10)
- Net worth crossing zero (both directions)
- First time in each state (first card, first investment, first debt-free week, first raise)
- Streak breaks

~25 situations × 3 = **75 lines.**

**Tier 3 — event entries: hand-written, no variants.** One per event × per choice × per broad outcome, roughly 2.5 entries per event.
- MVP: 45 events × 2.5 = **~113 entries.**

**MVP total: ~280 pieces of copy.** Full game with 120 events: ~450.

**Recommendation:** write Tier 3 first. Event entries are where the voice lives, and they're what players remember. Tier 1 can ship at 4 variants and grow post-launch; nobody churns over slightly repetitive rent narration, but a flat scam event kills the tone immediately.

---

# Appendix C — Balance Tests to Run Before Ship

These are the tuning questions the design can't answer on paper. Each needs a headless simulation harness running many seeded runs with scripted strategies.

**C1 — Speculation must not be optimal.** *(The single highest-risk item in this design.)*
Run 10,000 seeded 30-year runs for each of: all-in index, all-in Moonshot, all-in Crypto-ish, 60/40 index/bond, and a "chase whatever went up last quarter" strategy. **Pass condition:** the speculative strategies must have a clearly worse *median* outcome than the index strategy and a meaningfully higher ruin rate, while retaining a fat enough right tail to feel exciting. If a 14-year-old can discover that dumping everything into Moonshot is the winning play, the game teaches gambling, and no amount of framing fixes it. Re-run this test after every balance change.

**C2 — Bankruptcy must not be exploitable.** Script a deliberate max-out-and-discharge strategy against baseline play across 10,000 runs. **Pass condition:** worse median 30-year net worth, and a worse distribution at every percentile above the 10th.

**C3 — The spiral must be escapable but hard.** From a scripted worst-case state (low mood, low energy, high-interest debt, no emergency fund), verify that a reasonable recovery strategy climbs out within 3–5 in-game years, and that a passive strategy does not.

**C4 — Decision density.** Instrument a full run and confirm the player faces 150–250 meaningful decision points over 30 years, and that no stretch longer than ~6 in-game months passes with zero interaction.

**C5 — Event repetition.** Confirm no repeatable event fires more than 4 times in a 30-year run and that the first 5 in-game years never repeat an event.

**C6 — Starting position fairness.** Run baseline play from each starting scenario. **Pass condition:** every start reaches a positive net worth by run end under competent play, and the gap between "Head start" and "Behind the line" narrows but does not vanish. If it vanishes, the game is lying about how the world works; if it never narrows, the game teaches fatalism.
