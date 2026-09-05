# @finme/engine

The simulation. Every rule the game has lives here, and nothing else does.

```ts
import { createRun, advance } from '@finme/engine';
```

## The rule

**Pure TypeScript. No React, no DOM, no browser APIs, no `Math.random()`, no
float dollars.** It must run identically in Node and the browser — that is what
makes the headless balance harness possible, and the harness is the only thing
that tells us whether the game teaches what it means to. It is also what would
make a native port cheap.

This package declares **no dependencies at all**. Enforced four ways rather than
trusted:

1. pnpm's strict `node_modules` — it can only import what it declares, which is
   nothing.
2. `tsconfig.base.json` has `lib: ["ES2023"]` and no DOM, so `window` and
   `document` are type errors.
3. An ESLint `no-restricted-imports` / `no-restricted-globals` rule.
4. A test that scans the source tree for `indexedDB`, `localStorage` and
   `window`.

The escape hatch is a **parameter**, never an import. The epilogue needs an
unseeded generator, so `projectEpilogue(input, rng)` takes one: the UI passes
`Math.random`, tests pass a seeded stream, and the engine never calls it itself.

## Layout

| File | Covers | Spec |
|---|---|---|
| `time.ts` | 4-4-5 calendar, `weekIndex` derivations | TDD §1 |
| `rng.ts` `seed.ts` | mulberry32, the eight named streams, seed format | TDD §2 |
| `market.ts` `inflation.ts` | GBM, crash/boom overlay, AR(1) inflation | TDD §3 |
| `netWorth.ts` `assets.ts` | balance sheet, car depreciation, the home model | TDD §4.2, §8 |
| `debt/` | credit card, amortizing, BNPL, payday, payoff projection | TDD §5.1–5.4 |
| `credit.ts` | the five-component score, thin-file state | TDD §5.5 |
| `income.ts` `tax.ts` | gross pay, raises, brackets, FIFO tax lots | TDD §6 |
| `vitals.ts` | energy, mood, performance, anti-spiral guarantees | TDD §7 |
| `jobs.ts` | tiers, application rolls, the seeded timeline | GDD §3.1 |
| `events/` | slot scheduling, gates, selection, effects, formula evaluator | TDD §9 |
| `logbook/` | triggers, variant selection, the quiet cadence | TDD §11 |
| `state.ts` `tick.ts` `run.ts` | run state, **the pipeline**, advance control | TDD §4.1, §10 |
| `epilogue.ts` `bankruptcy.ts` `persistence.ts` | projection, dire state, saves | TDD §12–14 |
| `storage.ts` | the `StorageAdapter` seam | TDD §14 |

## Things that will surprise you

**The tick pipeline order is contractual.** `tick.ts` implements TDD §10's
fifteen steps in sequence, each labelled with its number. Reordering changes
outcomes for every existing seed. Step 7 before step 9 matters specifically: an
event that costs energy must constrain *that* week's allocation.

**Each subsystem has its own RNG stream** so adding a draw to one can never shift
another. Five are pre-drawn entirely at init and never touched again
(`startingDraw`, `market`, `jobTimeline`, `eventSlots`, `eventSelection`) — that
is what guarantees two players sharing a seed live in the same world regardless
of behaviour.

**`flavor` must never influence simulation state.** Adding a Logbook variant
cannot change a number in any run. `emitEntries` takes exactly one `Rng` and has
no path to another; the golden fixture catches a wrong one at the call site.

**Never call an RNG inside a loop over an unordered map.** Iterate arrays sorted
by stable id. The `.sort()` in `events/selection.ts` is load-bearing.

**`normal()` consumes exactly two draws** and discards the second Box-Muller
output on purpose. Caching it would make consumption depend on call parity.

**Prices are integer cents floored at 1.** A collapsed asset rounding to zero
divides by zero at every share-count site — CRYP reaches it in 21% of 30-year
runs.

**`RunState.flags` is a sorted array, not a `Set`.** A Set serializes as `{}` and
iterates in insertion order, so two identical runs would produce different
snapshots.

## Tests

```bash
pnpm test packages/engine
```

20 test files. The two that matter most:

- **`test/golden/market-4F2A9C1B-30y.json`** pins the RNG consumption order.
  Comparing two runs of the same build proves nothing about a reordered draw;
  only a committed fixture catches it.
- **The §7.4 anti-spiral property test** generates 500 random low states and
  asserts every one recovers within 8 weeks under rest-and-free-social. **It must
  never be marked skip.** Measured recovery is 1–4 weeks.

If a golden test fails, the first question is *"did I intend to change simulation
behaviour?"* — never *"let me update the fixture."*
