# Contributing to FinMe

Most of what makes this codebase unusual is defensive. It protects one property —
**a seed produces the same world for everyone** — and a second, softer one: the
game narrates without judging. Nearly every rule below exists to keep one of
those two intact.

Read [`docs/DECISIONS.md`](docs/DECISIONS.md) before proposing a change. It has
72 dated entries, and most of the surprising things here are surprising on
purpose.

---

## Getting set up

```bash
pnpm install
pnpm check     # lint, typecheck, 471 tests — should be green before you start
```

**Node 26.8.1** (`.nvmrc`), **pnpm 11**. Never run `npm install` or `yarn`: a
competing lockfile breaks pnpm's strict `node_modules`, which is one of the three
things enforcing engine purity.

`pnpm install` also installs the git hooks — see [Branches and
hooks](#branches-and-hooks). You do not need to run anything else for them.

For the device pass:

```bash
pnpm -F @finme/ui exec playwright install chromium
pnpm -F @finme/ui e2e
```

---

## Before you write code

**Read the TDD section you are about to implement.** Section numbers are
referenced throughout `CLAUDE.md`, in every issue template, and in the source. If
the TDD and the GDD disagree — and they do, in several places — the TDD is the
formula authority, but say so in your PR rather than picking silently.

**If the spec is silent, that is a design decision, not a coding one.** Open a
[design decision issue](https://github.com/carlosdanna/finme/issues/new/choose)
rather than inventing a constant. Where invention was unavoidable, it is marked
`[T]` and recorded — see #4 and #8 for what that looks like.

---

## The rules

### Engine purity

`packages/engine` imports nothing. No React, no DOM, no browser globals, no
`Math.random()`, no `parseFloat`. It must run identically in Node and the
browser, because that is what makes the balance harness possible.

Enforced by pnpm's strict `node_modules`, a base `tsconfig` with no DOM lib, an
ESLint rule, and a test that scans the source tree. If you find yourself wanting
to relax any of them, stop and ask.

The escape hatch is a **parameter**. The epilogue needs an unseeded generator, so
`projectEpilogue(input, rng)` takes one — the UI passes `Math.random`, tests pass
a seeded stream, and the engine never calls it.

### Units

- **Integer cents, always.** Never float dollars.
- **Rates are annualized nominal**, converted at point of use.
- **`weekIndex` is the only time.** Everything else derives from it.

### Determinism

Each subsystem uses its **own named RNG stream**. Adding a draw to one must never
shift another.

Streams pre-drawn at init (`startingDraw`, `market`, `jobTimeline`, `eventSlots`,
`eventSelection`) are consumed entirely during initialization and never touched
again. That is what guarantees two players sharing a seed get the same world
regardless of behaviour.

**Never call an RNG inside a loop over an unordered map.** Iterate arrays sorted
by stable id. The `.sort()` in event selection is load-bearing: without it the
same ticket maps to different events across versions and every shared seed
silently breaks.

The tick pipeline order in **TDD §10 is contractual**. Reordering it changes
outcomes for existing seeds.

### Tone

These come from GDD §1 and are the reason the game does not read as an
educational module:

- **No green checkmarks, no approving copy, no moralizing.**
- **No `destructive` styling on any financial figure.** Not on negative net
  worth, not on losses, not on the "Never" payoff projection. `destructive` is
  for destructive *user actions* — delete a save, confirm bankruptcy. Red-for-
  negative is a judgement.
- **No letter grades, no ranks, no percentage-of-optimal**, anywhere.
- Choices must never signal which is correct — in label, order, or styling.
- The Logbook can be wry. It cannot approve.

Tests enforce these. A template containing "should" or "well done" fails the
content schema; a `variant="destructive"` anywhere in our own UI code fails a
test; every choice label is scanned for ranking words.

---

## Changing a constant

Constants are marked in the TDD:

- **`[F]` — contractual.** Changing one invalidates every shared seed. It needs a
  `RULESET_VERSION` bump **in the same commit**, a `DECISIONS.md` entry, and a
  `!` on the commit with a `BREAKING CHANGE:` footer.
- **`[T]` — tunable.** Still needs a `DECISIONS.md` entry if it moves after
  balance testing, and a re-run of the affected tests.

**Re-run C1 after any market or tax change.** `pnpm -F @finme/sim c1`.

When a balance test fails, propose the minimal parameter change and explain its
collateral effects on the other tests **before** changing anything. A change that
fixes one test and breaks another is not a fix.

---

## Golden fixtures

Two fixtures pin simulation behaviour:

- `packages/engine/test/golden/market-4F2A9C1B-30y.json` — the market draw order
- `packages/content/test/golden/run-4F2A9C1B-200w.json` — 200 weeks of a full run

**If a snapshot test fails, the first question is "did I intend to change
simulation behaviour?" — never "let me update the fixture."**

If the answer is yes, diff it before regenerating and say in the commit what
moved. An additive change (new fields, no changed values) needs no ruleset bump;
a changed value does.

These are not ceremony. The run fixture caught a missing annual raise that had
left wages flat for four in-game years, and a flavor-stream leak that would have
broken every shared seed.

---

## Writing tests

**Assert the mechanism, not a property of the output.** Three tests in this repo
looked green and could not fail:

- `expect(moodDecay(20)).toBe(MOOD_DECAY_LOW)` compared a function to the very
  constant it returns.
- A slot-ticket test asserted "is a uniform in [0,1)", which a hard-coded `0.5`
  satisfies.
- A whitelist test threw for the wrong reason, so removing the whitelist still
  passed.

Each now asserts where the value came from. A useful habit: **mutate the code and
check the test fails.** If it does not, the test is decoration.

Every new event needs a golden test — fixed seed, fixed state, exact selected
event and exact state delta.

The anti-spiral property test (TDD §7.4) must never be marked skip.

### Where tests live

| Suite | Location | Runner |
|---|---|---|
| Engine, sim, content | `packages/*/test/`, `packages/sim/src/**` | `pnpm test` |
| UI components | `packages/ui/test/` | `pnpm test:ui` (jsdom) |
| Device and PWA | `packages/ui/e2e/` | `pnpm -F @finme/ui e2e` |

The UI has its own Vitest project because mounting React needs jsdom.
`globals: true` there is load-bearing, not stylistic — it registers Testing
Library's auto-cleanup.

---

## Mobile-first

FinMe is a phone game that runs in a browser. Design at **390×844**; desktop is
the wide breakpoint.

- **No interaction may depend on hover.** The glossary is a tap-to-open popover
  via `<Term>` — never a `title` attribute.
- Bottom tab bar, not a sidebar. The advance control lives in the bottom-right
  thumb zone.
- Event modals: `Sheet` below `md:`, `Dialog` above.
- Debts panel: card list below `md:`, table above. The payoff projection must be
  visible in both.
- `dvh`, never `vh`. `env(safe-area-inset-bottom)` on fixed bottom elements.
- **Every touch target ≥44px**, including the +/− steppers.
- Currency and percentages render through `<Money>` / `<Pct>` with
  `tabular-nums`.

Compose the vendored shadcn set in `src/components/ui/` rather than hand-rolling
cards and list rows. A test asserts this, because the first pass at the UI got it
wrong.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). There is
a `/commit` command in `.claude/commands/` that encodes the rules:

```
feat(engine): add the weekly tick pipeline and golden run fixture
fix(market): exclude week 0 from dividend payments
feat(engine)!: rescale crash recovery factor to 0.68
```

- Scope is the package or subsystem: `engine`, `content`, `sim`, `ui`, `docs`,
  or `market`, `tax`, `events`.
- Subject line ≤72 chars, imperative, lowercase, no trailing period.
- A body only when the *why* is not obvious from the diff.
- Split unrelated concerns into separate commits.
- Unrelated concerns go in separate commits.

---

## Branches and hooks

**`main` moves by merged pull request, and nothing else.** This is enforced in
two places, and you will meet both:

| | What it does | Escape hatch |
|---|---|---|
| `.husky/pre-commit` | refuses a commit while you are on `main` | `git commit --no-verify` |
| `.husky/pre-push` | refuses a push to `main`, then runs `pnpm check` | `git push --no-verify` |
| GitHub ruleset on `main` | rejects any push that is not a merged PR; also blocks force-push and deletion | none — nobody can bypass it, including the owner |

The hooks are local courtesy: they fail in about 18 seconds instead of after a
round trip, and `--no-verify` gets past them. **The ruleset is the real rule**,
and it has no bypass actor by design — a direct push to `main` is rejected by the
server no matter who you are.

Detached HEAD is exempt from the pre-commit guard, so rebasing, cherry-picking
and bisecting all still work.

Branch names are `<type>/<short-description>` using the commit types:
`feat/annual-review-chart`, `fix/credit-grace-period`, `docs/package-readmes`.

`pre-push` runs `pnpm check` — lint, typecheck, the node suite and the jsdom UI
suite. It deliberately does **not** run Playwright, which needs a production
build and a browser download. Run that yourself before a PR that touches the UI:

```bash
pnpm -F @finme/ui e2e
```

---

## Pull requests

Say what you measured, not just what you changed. If you touched a balance
parameter, include the before-and-after distribution. If a test now passes that
did not, say which and why.

State what you did **not** do. Partial work with a clear boundary is more useful
than work that looks complete and is not — most of the open issues exist because
a gap was written down instead of glossed over.

`pnpm check` must be green. `pre-push` will not let you get that far otherwise.

[`.github/pull_request_template.md`](.github/pull_request_template.md) fills in
automatically. Its **Simulation impact** section is the part that matters: if the
change touches the engine, the content or a constant, it has to answer whether
existing seeds now produce something different. Answering "yes" is fine. Leaving
it blank is not.

Two commands in `.claude/commands/`:

- **`/pr`** — runs `pnpm check`, pushes the branch, fills the template in from
  the actual diff, and opens the PR. It stops rather than opening one if you are
  on `main`, if anything is uncommitted, or if a `[F]` constant changed without
  its `RULESET_VERSION` bump and `DECISIONS.md` entry.
- **`/review-pr [number]`** — reviews a PR and reaches a decision: approve,
  approve with notes, or request changes, with the reason stated first. It omits
  the gotchas and recommendations headings when it has none rather than padding
  the review. `--post` adds it to the PR as a comment; it never submits a formal
  GitHub approval on its own.

---

## Filing issues

Four templates: bug, feature, technical debt, design decision. Pick the one that
fits — the shape of the form is the useful part.

- **Bug:** the seed and week are the two most useful fields. Simulation bugs
  reproduce from a seed.
- **Design decision:** bring the measurement. Most of these are settled faster by
  a number than by an argument.

---

## What needs doing

The engine and UI are complete; the content is not. In rough order of leverage:

1. **[#5](https://github.com/carlosdanna/finme/issues/5) — write 37 more events.**
   The pool is 8 against ~247 slots in a 30-year run, which fails three balance
   tests on its own. Batches of 8–10 per session; the schema and lint already
   enforce correctness.
2. **[#6](https://github.com/carlosdanna/finme/issues/6) — make borrowing a
   player action.** It gates C2, the bankruptcy UI, the Debts layout test, and
   the credit score ever leaving `null`.
3. **[#1](https://github.com/carlosdanna/finme/issues/1)–[#4](https://github.com/carlosdanna/finme/issues/4)
   — four design calls** the code cannot make on its own.
4. **[#15](https://github.com/carlosdanna/finme/issues/15) — Logbook prose.**
   3 variants per key against a ~280-entry target. BUILD-PLAN names this as the
   failure most expensive to discover late.
