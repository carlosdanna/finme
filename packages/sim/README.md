# @finme/sim

The headless balance harness. It runs thousands of seeded 30-year lives against
scripted strategies and reports what the design actually produces.

```bash
pnpm -F @finme/sim c1         # speculation must not be optimal (10,000 seeds)
pnpm -F @finme/sim c-suite    # C2-C6, plus a pool-size diagnostic
pnpm -F @finme/sim wages      # what the §6.2 raise does to real income
pnpm -F @finme/sim housing    # buy vs rent, by mortgage rate and horizon
```

## Why it exists

This is the part of the project most likely to change the design. The balance
tests answer questions no amount of reading can:

> **C1 — Speculation must not be optimal.** *(The single highest-risk item in
> this design.)* If a 14-year-old can discover that dumping everything into
> Moonshot is the winning play, the game teaches gambling, and no amount of
> framing fixes it. — GDD Appendix C

It imports `@finme/engine` and `@finme/content` and nothing else. No UI, no DOM.
Nothing here re-implements a rule; if a number is wrong, it is wrong in the
engine.

## What the tests report

**C1 passes.** Over 10,000 seeds:

| Strategy | p50 | Ruin | Beats index, same seed |
|---|---|---|---|
| All-in index | $552,357 | 0.1% | — |
| 60/40 | $498,093 | 0.0% | 35.2% |
| All-in Moonshot | $154,553 | 33.0% | **20.8%** |
| All-in Crypto-ish | $56,321 | 66.5% | **8.5%** |
| Momentum | $149,241 | 34.4% | 20.7% |

The head-to-head column is the one that matters. Comparing marginal percentiles
compares *different worlds*; the GDD's question is whether speculation wins in
*this* world, which is a same-seed comparison.

**C3 passes. C4, C5 and C6 fail** — and the suite proves the cause is content
volume rather than the engine by re-running each test against a pool diluted with
neutral fillers to the design's own 45-event target:

| pool | median net worth | max firings |
|---|---|---|
| 8 (shipped) | −$936,008 | 29 |
| **45 (MVP target)** | **+$822,626** | 13 |
| 120 (full) | +$1,003,003 | 7 |

C6 flips to passing there. That is the difference between "the engine is wrong"
and "the content is not written yet", and it is worth the extra run.

**C2 is not a valid test yet.** It reports PASS, but only trivially — nothing in
the tick opens a credit line, so max-out-and-discharge cannot max anything out.
See [#6](https://github.com/carlosdanna/finme/issues/6).

## Layout

| Path | What |
|---|---|
| `src/harness.ts` | runs strategies against seeded histories |
| `src/strategies/allocation.ts` | the five C1 strategies |
| `src/tests/c1.ts` | C1, the gate |
| `src/tests/cSuite.ts` | C2–C6 with the pool-size diagnostic |
| `src/probes/wages.ts` | career trajectories under different strategies |
| `src/probes/housing.ts` | buy-vs-rent, both households spending the same |
| `src/stats.ts` | percentiles and currency formatting |

**Probes are not tests.** They are diagnostic instruments for open tuning
questions — they print a table and settle an argument. Both have smoke tests so a
refactor cannot silently break them.

## Writing a strategy

```ts
export const MY_STRATEGY: Strategy = {
  id: 'my-strategy',
  name: 'Something a player might plausibly do',
  targetWeights: ({ history, weekIndex }) => ({ SAFE: 0.6, BOND: 0.4 }),
  rebalancesOn: (week) => week % 52 === 0,
};
```

Every strategy faces the **same market history** — each seed's world is generated
once and shared, which is both much faster and the fairer comparison.

## Two things to know before changing a parameter

**Re-run C1 after any market or tax change.** It is cheap and it guards the
design rather than the code.

**When a test fails, propose the minimal change and explain its collateral
effects on the other tests before changing anything.** A change that fixes one
balance test and breaks another is not a fix — and at least twice here, the
apparent fix was the wrong one. Raising `SLOT_LAMBDA` to hit the GDD's stated
event frequency would have pushed decision density further outside C4's ceiling.
