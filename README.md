# FinMe

A browser life-sim about money. You live 10–50 in-game years one week at a time,
making financial decisions with consequences that compound.

The game never tells you whether a decision was smart. It narrates what happened
and lets the arithmetic do the teaching — no green checkmarks, no letter grades,
no comparison to an optimal player. You are only ever compared to your own past.

> **Status: engine and UI complete, content incomplete.** All eighteen prompts of
> the build plan are done. The event pool is 8 of a target 45, which is enough to
> play but not enough for three of the balance tests to pass. See
> [open issues](https://github.com/carlosdanna/finme/issues).

---

## Quick start

Requires **Node 26.8.1** (see `.nvmrc`) and **pnpm 11**. Never run `npm install`
or `yarn` — a competing lockfile breaks the workspace.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Then the checks:

```bash
pnpm check        # lint, typecheck, 421 headless tests, 50 jsdom tests
pnpm -F @finme/ui e2e   # 36 Playwright tests at 390x844 and 360x740
```

`pnpm -F @finme/ui exec playwright install chromium` first, if you have not.

**`main` moves by merged pull request.** `pnpm install` sets up git hooks that
refuse a commit on `main` and run `pnpm check` before every push, and a GitHub
ruleset rejects direct pushes to `main` server-side. Work on a branch; use `/pr`
to open the pull request. See [CONTRIBUTING](CONTRIBUTING.md#branches-and-hooks).

---

## What makes this project unusual

**Every run is a seed.** Two players sharing `4F2A9C1B/v0.3.0` live in the same
world — the same market history, the same crashes, the same weeks that events
fire — regardless of how differently they play. That property is load-bearing for
the balance harness, and most of the engine's design follows from protecting it.

**The balance harness is the point.** `packages/sim` runs thousands of seeded
30-year lives against scripted strategies. It exists to answer one question the
design cannot answer on paper: *does this game accidentally teach gambling?*

The answer, measured over 10,000 seeds:

| Strategy | Median outcome | Ruin rate | Beats the index |
|---|---|---|---|
| All-in index | $552,357 | 0.1% | — |
| 60/40 index/bond | $498,093 | 0.0% | 35.2% |
| All-in Moonshot | $154,553 | 33.0% | **20.8%** |
| All-in Crypto-ish | $56,321 | 66.5% | **8.5%** |
| Chase last quarter's winner | $149,241 | 34.4% | 20.7% |

Speculation keeps a fat right tail — Moonshot's 99th percentile is 2.9× the
index's — while losing badly in the middle. That is the shape the design wants,
and `pnpm -F @finme/sim c1` re-checks it.

---

## Architecture

The one rule everything else depends on:

```
packages/engine/    pure TypeScript. NO React, NO DOM, NO browser APIs.
packages/sim/       headless balance harness. Imports engine only.
packages/content/   JSON data + Zod schemas. Depends on engine, never the reverse.
packages/ui/        React + Vite. Imports engine. Contains ZERO simulation logic.
```

`packages/engine` must run identically in Node and the browser. That is what
makes the balance harness possible, and the harness is the only thing that tells
us whether the game teaches what it means to.

It is enforced three ways, not trusted: pnpm's strict `node_modules`, a base
`tsconfig` with no DOM lib, and an ESLint `no-restricted-imports` rule. A fourth
test scans the whole source tree and asserts only `WebStorageAdapter.ts`
references `indexedDB` or `localStorage`.

### The engine

| Area | Files | Spec |
|---|---|---|
| Time, RNG, seeds | `time.ts` `rng.ts` `seed.ts` | TDD §1–2 |
| Market, inflation | `market.ts` `inflation.ts` | TDD §3 |
| Net worth, assets | `netWorth.ts` `assets.ts` | TDD §4.2, §8 |
| Debt, credit | `debt/` `credit.ts` | TDD §5 |
| Income, tax | `income.ts` `tax.ts` | TDD §6 |
| Vitals, jobs | `vitals.ts` `jobs.ts` | TDD §7, GDD §3.1 |
| Events, Logbook | `events/` `logbook/` | TDD §9, §11 |
| The tick pipeline | `tick.ts` `run.ts` `state.ts` | TDD §10, §4.1 |
| Epilogue, bankruptcy, saves | `epilogue.ts` `bankruptcy.ts` `persistence.ts` | TDD §12–14 |

### Conventions that are not negotiable

- **All currency is integer cents.** Never float dollars. `parseFloat` is banned
  in the engine by lint rule.
- **All rates are stored annualized nominal**, converted at point of use.
  Monthly is `annual / 12`, weekly is `annual / 52`, never mixed.
- **`weekIndex` is the only source of truth for time.** Date, age, month, quarter
  and year are all derived.
- **`Math.random()` is banned in the engine.** Every draw comes from a named
  seeded stream, and each subsystem has its own so adding a die roll to one can
  never shift another.
- A game year is 52 weeks in a **4-4-5 month pattern**. Months are unequal on
  purpose — a 5-week month has 25% more paychecks against the same fixed rent.

---

## The docs

| File | What it is |
|---|---|
| [`docs/GDD.md`](docs/GDD.md) | Game design: what it teaches, and the tone rules |
| [`docs/TDD.md`](docs/TDD.md) | Every formula and constant, by section |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 72 dated entries — why things are the way they are |
| [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md) | How the project was built, prompt by prompt |
| [`CLAUDE.md`](CLAUDE.md) | The rules, in the form an agent reads them |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, the branch policy, and how to change a constant |

`DECISIONS.md` is the one to read before proposing a change. Most surprising
things in this codebase are surprising on purpose, and it says why.

---

## Running the balance tests

```bash
pnpm -F @finme/sim c1         # speculation must not be optimal (10,000 seeds)
pnpm -F @finme/sim c-suite    # C2-C6, plus a pool-size diagnostic
pnpm -F @finme/sim wages      # what the §6.2 raise does to real income
pnpm -F @finme/sim housing    # buy vs rent, by mortgage rate and horizon
```

**C1 and C3 pass. C4, C5 and C6 fail**, and the cause is content volume rather
than the engine — the suite proves this by re-running each test against a pool
diluted to the design's own 45-event target, where C6 flips to passing. **C2 is
not yet a valid test**: nothing can take on debt, so "max out and discharge"
cannot max anything out.

Re-run C1 after any market or tax parameter change. It is cheap and it guards the
design rather than the code.

---

## Content

Events, Logbook templates, jobs and the glossary are **JSON in
`packages/content`**, validated by Zod at load — so a malformed event is a
load-time throw, not a crash in week 400.

Currently: **8 events** (target 45), **28 Logbook keys** at 3 placeholder
variants each (target ~280 entries), **13 jobs**, **26 glossary terms**.

Event ids are stable forever. Renaming one silently changes what every existing
seed produces.

---

## Licence

Not yet chosen.
