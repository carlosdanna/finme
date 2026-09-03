# CLAUDE.md — FinMe

A browser life-sim game about money. The player lives 10–50 in-game years, one week at a time, making financial decisions with real consequences. See `docs/GDD.md` for design and `docs/TDD.md` for formulas.

**Read the relevant TDD section before implementing anything.** Section numbers are referenced throughout this file and in every prompt.

---

## Package manager: pnpm

- `pnpm -F @finme/<pkg> <cmd>` for package-scoped commands
- `pnpm -w add -D <pkg>` for root dev dependencies
- `pnpm dlx` instead of `npx`
- Internal dependencies **always** use `workspace:*`, never a version range
- **Never run `npm install` or `yarn`** — a competing lockfile breaks the workspace

---

## Architecture: the rule everything else depends on

```
packages/engine/   pure TypeScript. NO React, NO DOM, NO browser APIs, NO Tailwind.
packages/sim/      headless balance harness. Imports engine only.
packages/content/  JSON data (events, logbook, jobs, constants) + Zod schemas.
packages/ui/       React app. Imports engine. Contains ZERO simulation logic.
```

`packages/engine` must run identically in Node and the browser. This is what makes the balance harness possible, and the balance harness is the only thing that tells us whether the game accidentally teaches gambling. It is also what makes a future native port cheap.

Enforced three ways: pnpm's strict `node_modules`, a base `tsconfig` without the DOM lib, and an ESLint `no-restricted-imports` rule. If you find yourself wanting to relax any of them, stop and ask.

**Storage:** all persistence goes through the `StorageAdapter` interface. No file outside the adapter may reference `indexedDB`, `localStorage`, or `window`.

**Navigation:** panel state lives in the Zustand store, never in the URL. URL routing behaves differently inside a native webview.

---

## Unit conventions (TDD §0) — no exceptions

- **All currency is integer cents.** Never float dollars. `parseFloat` is banned in the engine.
- **All rates are stored annualized nominal**, converted at point of use. Monthly = `annual / 12`. Weekly = `annual / 52`. Never mixed within one instrument.
- **`weekIndex` is the only source of truth for time.** Date, age, month, year, and quarter are all derived. Never store a second representation.
- A game year is 52 weeks in a **4-4-5 month pattern** (TDD §1.2). Months are unequal in length. This is deliberate — do not "fix" it by averaging.

---

## Determinism (TDD §2) — breaking this invalidates every shared run

- `Math.random()` is banned in the engine. Use the seeded streams.
- Each subsystem uses its **own named RNG stream**. Adding a die roll to one stream must never shift another.
- Streams pre-drawn at init (`startingDraw`, `market`, `jobTimeline`, `eventSlots`, `eventSelection`) are fully consumed into arrays during initialization and **never touched again**.
- The `flavor` stream must never influence simulation state. Adding a Logbook prose variant must not change any number in any run.
- **Never call an RNG inside a loop over an unordered map.** Iterate over arrays sorted by stable id. The `.sort()` in event selection is load-bearing.
- `normal()` consumes exactly two draws per call. Do not cache the second Box-Muller output.
- The tick pipeline order in **TDD §10 is contractual**. Reordering it changes outcomes for existing seeds.

**Constants marked [F] in the TDD are contractual.** Changing one requires a ruleset version bump in the same commit plus an entry in `docs/DECISIONS.md`. Constants marked [T] are tunable but still require a DECISIONS.md entry if changed after balance testing.

---

## Testing

- **Golden-seed fixtures are truth.** If a snapshot test fails, the first question is "did I intend to change simulation behavior?" — never "let me update the fixture."
- Every new event needs a golden test: fixed seed, fixed state, assert the exact selected event and the exact state delta.
- The anti-spiral property test (TDD §7.4) must never be skipped.
- **Re-run C1 after any market or tax parameter change.** It is cheap and it guards the design rather than the code.
- Playwright's default viewport is a phone (390×844), not a desktop.

---

## Design rules that are easy to violate accidentally

These come from GDD §1 and are not stylistic preferences — they are the reason the game doesn't read as an educational module.

- **No green checkmarks, no approving copy, no moralizing.** The game narrates what happened; it never says whether it was smart.
- **No `destructive` styling on any financial figure.** Not on negative net worth, not on losses, not on the "Never" payoff projection. `destructive` is reserved for destructive *user actions* (delete save, confirm bankruptcy). Red-for-negative and green-for-positive are judgments, and this game does not judge.
- **No letter grades, no ranks, no percentage-of-optimal.** Anywhere. The comparison is always the player against their own past.
- Choices in events must never signal which one is correct, in label, order, or styling.
- The Logbook never editorializes. It can be wry. It cannot approve.

---

## Mobile-first

FinMe is a phone game that runs in a browser. Design at 390×844; desktop is the wide breakpoint.

- **No interaction may depend on hover.** The glossary is a tap-to-open popover via the `<Term>` component — never a `title` attribute, never hover-only.
- Bottom tab bar, not a sidebar. The advance control lives in the bottom-right thumb zone.
- Event modals: `Sheet` below `md:`, `Dialog` above.
- Debts panel: card list below `md:`, table above. The payoff projection must be visible in both.
- `dvh`, never `vh`. `env(safe-area-inset-bottom)` on fixed bottom elements.
- Every touch target ≥44px, including the +/− time steppers.
- All currency and percentages render through `<Money>` / `<Pct>` with `tabular-nums`.
- Charts use uPlot with tap-to-inspect and a persistent crosshair. No hover tooltips.

---

## Content

Events and Logbook templates are **JSON data files in `packages/content`**, validated by Zod at load. Never inline event definitions in TypeScript.

Event magnitudes are formula strings evaluated at fire time (`"clamp(0.5*monthlyIncome, cpi*20000, cpi*250000)"`), never fixed cents — fixed amounts go stale across a 30-year run with inflation.

Event `id`s are stable forever. Never rename or reuse one; a rename silently changes what every existing seed produces.

---

## Working conventions

- Append to `docs/DECISIONS.md` whenever a choice is made that the TDD didn't specify. Six sessions from now nobody will remember why `CRASH_RECOVERY_FACTOR` moved.
- Prefer small, verifiable changes. Every task should end with a runnable check.
- When a balance test fails, propose the minimal parameter change and explain its collateral effects on the other tests **before** changing anything.
- If a requirement here conflicts with something asked in a prompt, say so rather than silently picking one.