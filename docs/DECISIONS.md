# DECISIONS

Append-only. One entry per choice the TDD or GDD did not specify. Newest at the
bottom. Any change to a **[F]** constant needs an entry here *and* a ruleset
version bump in the same commit; a **[T]** constant changed after balance testing
needs an entry too.

Format:

```
## YYYY-MM-DD — Short title
**Context:** what forced the choice.
**Decision:** what was chosen.
**Consequences:** what this makes easy, hard, or newly load-bearing.
```

---

## 2026-09-03 — Scaffold: pnpm workspaces, not npm workspaces
**Context:** BUILD-PLAN Part 2 says npm workspaces; the repo was already
initialized with pnpm and a `pnpm-lock.yaml`.
**Decision:** stay on pnpm. CLAUDE.md is the authority on this.
**Consequences:** pnpm's strict `node_modules` is now one of the three things
enforcing engine purity — a package can only import what it declares. Running
`npm install` or `yarn` would create a competing lockfile and break that
guarantee, so it is banned in CLAUDE.md.

## 2026-09-03 — Single root ESLint flat config
**Context:** the Vite scaffold shipped `packages/ui/eslint.config.js`. A
per-package config means the engine-purity rule lives in one place and can drift
out of another.
**Decision:** one `eslint.config.js` at the repo root with per-package blocks;
the UI's config was deleted and its ESLint devDependencies hoisted to the root.
**Consequences:** `pnpm lint` covers the whole workspace in one pass. The
engine-purity rule cannot be silently dropped by editing a package-local file.

## 2026-09-03 — Shared `tsconfig.base.json` omits the DOM lib
**Context:** the engine purity rule needs teeth in the type system, not just in
ESLint.
**Decision:** the base config's `lib` is `["ES2023"]` with no DOM. `packages/ui`
re-adds `"DOM"` in its own `tsconfig.app.json`; engine, sim and content do not.
**Consequences:** `window`, `document` and `localStorage` are type errors in the
engine, not just lint errors. This is the second of the three enforcement
mechanisms named in CLAUDE.md.

## 2026-09-03 — `StorageAdapter` is a narrow string key-value interface
**Context:** BUILD-PLAN Part 2b requires the adapter in prompt 1, before there is
any persistence logic to shape it.
**Decision:** `get`/`set`/`remove`/`keys`/`clear`, all async, values are strings —
callers serialize. Lives in `packages/engine/src/storage.ts` with a
`MemoryStorageAdapter` for tests and the balance harness.
**Consequences:** async-everywhere means a native adapter with an async-only API
drops in unchanged. Serialization stays in the persistence layer (TDD §14), which
keeps the replay/checkpoint format the adapter's problem to store, not to
understand.

## 2026-09-03 — Docs renamed to `docs/GDD.md` and `docs/TDD.md`
**Context:** files were checked in as `finme-GDD.md` / `finme-TDD.md`; CLAUDE.md
and BUILD-PLAN both reference the short names.
**Decision:** renamed to match the references.
**Consequences:** none beyond the rename; every session prompt points at the
short paths.
