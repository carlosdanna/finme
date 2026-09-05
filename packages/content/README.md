# @finme/content

The game's data — events, Logbook prose, jobs, the glossary — as JSON, validated
by Zod at load.

```ts
import { EVENTS, JOBS, GLOSSARY, LOGBOOK_TEMPLATES } from '@finme/content';
```

## Why data and not code

Event magnitudes are **formula strings evaluated at fire time**, not fixed cents:

```json
{ "k": "cash", "cents": "-clamp(0.6*monthlyIncome, cpi*40000, cpi*180000)" }
```

A fixed amount goes stale across a 30-year run with inflation and rising income.
`cpi`-relative for things with a real-world price — a phone, a dental visit;
`monthlyIncome`-relative for anything meant to feel like a meaningful hit at any
life stage.

The formula evaluator in `@finme/engine` is a hand-written parser with a
whitelist of eight functions. It has no `eval`, no `new Function`, and no
property access in the grammar at all — so `Math.random()` does not parse.
Content is data, and data must never reach the runtime.

## Direction of dependency

**`content` depends on `engine`, never the reverse.** The engine declares no
dependencies, so it cannot import Zod or read a JSON file. It defines the types;
this package owns the data and asserts against them:

```ts
export const EVENTS: readonly EventDef[] =
  eventsFileSchema.parse(data).events satisfies readonly EventDef[];
```

If `EventDef` changes, this package stops **compiling** rather than failing at
runtime.

## Layout

| Path | What |
|---|---|
| `events/mvp.json` | 8 events across 8 categories |
| `logbook/templates.json` | 28 keys, 3 placeholder variants each |
| `logbook/names.json` | friend and advisor name pools |
| `jobs.json` | 13 jobs across all four tiers |
| `glossary.json` | 26 terms, for the `<Term>` popover |
| `src/scenario.ts` | the scripted default run used by fixtures and the harness |
| `src/snapshot.ts` | golden-run serialization |

## The lint is the schema

There is no separate lint step. The rules run as Zod refinements on the schema
that already parses at module load, so importing `EVENTS` runs them and a
malformed event is a load-time throw rather than a CI step someone can skip.

What it enforces beyond types:

- Every choice has a `logbookKey`.
- No choice silently does nothing — it must declare `effects`, an `outcomeRoll`
  or a `deferred`, **or** set `"noop": true`. TDD §9.4's own "Say thank you"
  choice is deliberately empty, which is why the marker exists.
- Event ids are `PREFIX_UPPER_SNAKE` and unique. **Ids are stable forever** — a
  rename silently changes what every existing seed produces.
- At least two choices per event; unique choice ids within an event.
- At least three Logbook variants per key, no duplicates.
- **Tone**: a Logbook template containing "should", "mistake", "wisely", "well
  done" is rejected. The Logbook narrates; it never approves (GDD §1). The
  glossary explains; it never advises.

Tests go further: every formula in the content is parsed against the evaluator's
whitelist, and every choice label is scanned for words that would rank the
options.

## Adding an event

1. Add it to `events/mvp.json`. The three in TDD §9.4 are the reference shape.
2. Add its `logbookKey`s to `logbook/templates.json` — three variants minimum.
3. **Write a golden test**: fixed seed, fixed state, assert the exact selected
   event and the exact state delta.
4. `pnpm test packages/content`.

## Status

**8 events against a target of 45 (MVP) or 120 (full).** That gap is the largest
single item of debt in the project: with ~247 event slots in a 30-year run, each
event fires 14–29 times, which fails three of the balance tests on its own. See
[#5](https://github.com/carlosdanna/finme/issues/5).

Logbook prose is placeholder — 3 variants per key against a ~280-entry target.
See [#15](https://github.com/carlosdanna/finme/issues/15).
