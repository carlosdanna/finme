# @finme/ui

The React front end. **Mobile-first — designed at 390×844, with `md:` as the wide
breakpoint.**

```bash
pnpm dev                      # from the repo root
pnpm -F @finme/ui test        # 50 jsdom component tests
pnpm -F @finme/ui e2e         # 36 Playwright tests, two phones + desktop
```

Playwright needs `pnpm -F @finme/ui exec playwright install chromium` once.

## The rule

**This package contains zero simulation logic.** Every state change comes from
`@finme/engine`; the Zustand store is a subscription layer and a place to keep
which panel is open. If a calculation is needed here, it belongs in the engine.

**No navigation state in the URL.** Panel routing lives in the store, because URL
routing behaves differently inside a native webview and is the most common source
of port friction.

**Storage goes through the `StorageAdapter` interface.** Only
`src/storage/WebStorageAdapter.ts` may reference `indexedDB` or `localStorage` —
a test scans the whole source tree and asserts it. That is what makes a future
Capacitor adapter a drop-in.

## Layout

| Path | What |
|---|---|
| `src/panels/` | one file per screen — dashboard, debts, budget, investing, balance sheet, allocation, logbook, annual review, epilogue, event modal |
| `src/components/finme/` | `Money`, `Pct`, `Term`, `Stat`, `Meter`, `Nothing`, `TabBar`, `AdvanceControl`, and the two uPlot charts |
| `src/components/ui/` | the vendored shadcn set — third-party, but ours to own |
| `src/store/useGameStore.ts` | Zustand; no simulation logic |
| `src/storage/` | the one place allowed to touch browser storage |
| `src/lib/` | formatting, chart touch gestures, granularity |
| `test/` | jsdom component tests, plus the tone and isolation guards |
| `e2e/` | Playwright device, PWA and performance specs |

## The tone rules are enforced, not just documented

These come from GDD §1 and are the reason the game does not read as an
educational module:

- **No `destructive` styling on any financial figure.** Not on negative net
  worth, not on losses, not on the "Never" payoff projection. `destructive` is
  reserved for destructive *user actions*. A test fails on any
  `variant="destructive"` or hard-coded red/green class in our own code.
- **No green checkmarks, no approving copy, no letter grades, no ranks, no
  percentage-of-optimal.** The annual review test scans for all of them.
- **Event choices carry no primary action** — identical variant and size, in
  content order. A test asserts they share one visual treatment.
- Every currency figure renders through `<Money>` with `tabular-nums` and **no
  sign colouring**. Red-for-negative is a judgement.

## Mobile-first, enforced by the device pass

- **No interaction may depend on hover.** GDD §7 specifies hover tooltips for the
  glossary; phones have no hover, so `<Term>` is **tap-only** — a dotted
  underline opening a popover, never a `title` attribute. Its 44px target comes
  from an absolutely positioned `::after` that does not disturb the line box.
- **Every touch target ≥44px**, including the +/− steppers. Playwright measures
  every interactive element on every tab.
- `dvh`, never `vh`. `env(safe-area-inset-bottom)` on fixed bottom elements.
- Bottom tab bar; the advance control sits in the bottom-right thumb zone.
- Event modal: `Sheet` below `md:`, `Dialog` above.
- Debts panel: card list below `md:`, table above — the payoff projection visible
  in both.
- Charts are uPlot on canvas with **tap-to-inspect and a persistent crosshair**.
  uPlot ships no touch gestures at all, so pinch-zoom and drag-pan are a plugin
  in `src/lib/chartTouch.ts`.

## Two things that bit, so they are now guarded

**`src/index.css` carries the shadcn design tokens.** The `:root` variables, the
`.dark` block, `@theme inline` and the base layer are all load-bearing —
`bg-background` and `border-border` compile to nothing without them. Deleting
that section leaves the app rendering as unstyled markup while the build, the
type check and every test stay green. A test now asserts the stylesheet itself.

**Compose the vendored shadcn set** rather than hand-rolling cards and list rows.
`Card`, `Item`, `Empty`, `Field`, `ButtonGroup`, `Tabs`, `Progress`,
`Collapsible` and `ScrollArea` all exist. A test asserts the panels import from
`@/components/ui/` and that the shared primitives wrap vendored components.

## Tests

The UI has its own Vitest project (`vitest.config.ts`) because mounting React
needs jsdom. **`globals: true` there is load-bearing, not stylistic** — it
registers Testing Library's automatic cleanup. Without it every `render` appends
to the same document and tests start finding duplicate elements.

`e2e/` is Playwright's and is excluded from the Vitest run.

## PWA

The game has no backend, so it works fully offline: `vite-plugin-pwa` precaches
the whole bundle, and a test cuts the network and reloads to confirm the game is
**playable** rather than merely shell-cached.
