# Glossary — acronyms and opaque codes

For contributors. Everything here appears in the docs, in constant names, or in
event formula strings, usually a long way from wherever it was defined.

**Player-facing financial terms live somewhere else.**
`packages/content/glossary.json` holds the 26 definitions the `<Term>` component
shows in the game, and it is authoritative for anything a player reads. `APR`,
`BNPL` and `CPI` are in both; this file gives the one-line expansion, and the
JSON gives the wording that ships. Change the wording there, not here.

---

## Documents

| | |
|---|---|
| **GDD** | **Game Design Document** — `docs/GDD.md`. What the game teaches and the tone rules it will not break. |
| **TDD** | **Technical Design Document** — `docs/TDD.md`. Every formula and constant, by numbered section. **Not Test-Driven Development.** It appears ~200 times in this repo and never once means the testing practice; a reference like "§9.1" is a section of this document. |
| **BUILD-PLAN** | `docs/BUILD-PLAN.md` — how the project was built, prompt by prompt. |

## Finance

| | |
|---|---|
| **APR** | **Annual Percentage Rate.** All rates are stored annualized nominal and converted at point of use (TDD §0). |
| **BNPL** | **Buy Now, Pay Later.** Four installments at weeks 0/2/4/6. The lesson is that it is debt that does not feel like debt, so it counts as a liability from the moment of purchase (§5.3). |
| **CPI** | **Consumer Price Index.** The inflation multiplier, 1.0 at run start. Event magnitudes use it so a fixed price does not go stale over 30 years (§9.3). |
| **DTI** | **Debt-to-Income.** Unsecured debt over annual gross. Gates the debt interrupt (`DEBT_INTERRUPT_DTI`), the stress term in `vitals.ts`, and one of bankruptcy's three conditions (`BANKRUPTCY_DTI_MULTIPLE`). |
| **FIFO** | **First In, First Out.** How tax lots are consumed on a sale (`tax.ts`, §6). |

## Model and technical

| | |
|---|---|
| **GBM** | **Geometric Brownian Motion.** The base price process, stepped weekly in log space (`market.ts`, §3.2). |
| **RNG** | **Random Number Generator.** Never `Math.random()` — every draw comes from a named seeded stream (§2). |
| **FNV-1a** | The hash mixing a run's seed with a stream name to derive that stream. Appending a stream name is safe *because* of this; renaming or reordering is not. |
| **MVP** | **Minimum Viable Product.** The first shippable cut (GDD §9), not "most valuable player". |
| **PWA** | **Progressive Web App.** How the game ships before any native shell. |
| **`dvh`** | **Dynamic viewport height**, the CSS unit. Always used instead of `vh`, which mis-measures under a mobile browser's collapsing chrome. |

## Asset ids

Five tickers, used bare in formulas like `price('CRYP')` and defined in
`market.ts`. Risk rises down the table.

| | |
|---|---|
| **`BOND`** | Bond Fund — low drift, low volatility, negative regime beta (flight to quality). |
| **`SAFE`** | SafeCo Index — the broad-market fund. The benchmark C1 measures every other strategy against. |
| **`BLUE`** | BlueChip Corp — a single large company. Teaches concentration risk. |
| **`MOON`** | Moonshot Tech — high drift, very high volatility. |
| **`CRYP`** | Crypto-ish Token — the most volatile thing on the menu. |

## Balance tests

`C1` runs on its own (`pnpm -F @finme/sim c1`); `C2`–`C6` run as a suite
(`pnpm -F @finme/sim c-suite`). Defined in GDD Appendix C.

| | |
|---|---|
| **C1** | Speculation must not be optimal. The highest-risk item in the design — it is what stops the game accidentally teaching gambling. |
| **C2** | Bankruptcy must not be exploitable. |
| **C3** | The spiral must be escapable, but not by doing nothing. |
| **C4** | Decision density — 150–320 decision points over 30 years, no quiet stretch beyond 30 weeks. |
| **C5** | Event repetition — per-tier firing limits, and no event fires again inside its own cooldown. |
| **C6** | Starting position fairness — every start positive at the median, and the gap narrows without vanishing. |

## Constant markers

Every tunable number in the engine carries one of these in its doc comment.

| | |
|---|---|
| **`[F]`** | **Fixed / contractual.** Changing it changes what every existing seed produces. Requires a `RULESET_VERSION` bump in the same commit plus a `docs/DECISIONS.md` entry. |
| **`[T]`** | **Tunable.** Still needs a `DECISIONS.md` entry once balance testing has been run against it. |

## Other

| | |
|---|---|
| **`weekIndex`** | The only representation of time. Date, age, month, year and quarter are all derived from it — never stored alongside it (§0). |
| **Ruleset version** | Stamped into every save and every shared seed string (`4F2A9C1B/v0.4.0`). A mismatch marks a run non-comparable rather than refusing to load. |
