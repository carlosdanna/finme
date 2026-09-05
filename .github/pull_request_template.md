## What this changes

<!-- One or two sentences. The diff shows what; say why. -->

## Spec

<!-- The GDD/TDD section this implements or changes, e.g. "TDD §5.3". If this
     implements nothing specified, say so — that is fine, but it usually means
     a docs/DECISIONS.md entry belongs in this PR. -->

## How to check it

```
# the command a reviewer runs to see this working or failing
```

## Simulation impact

<!-- Delete this section only if the PR touches no engine, content or
     constant. Everything else has to answer these. -->

- [ ] **Does this change what an existing seed produces?** If yes: which
      ruleset version bump, and is `RULESET_VERSION` bumped in this PR?
- [ ] **Golden fixtures** — unchanged, or changed deliberately with the reason
      stated below.
- [ ] **`[F]` constants** — none touched, or touched with a `docs/DECISIONS.md`
      entry in this PR and a `!` on the commit.
- [ ] **C1 re-run** — required after any market or tax parameter change.
      Paste the head-to-head column.

## Checks

- [ ] `pnpm check` passes
- [ ] `pnpm -F @finme/ui e2e` passes *(UI changes only)*
- [ ] New behaviour has a test that fails without the change — I confirmed it
      fails by breaking the code, not by assuming
- [ ] Tone: no green checkmarks, no approving copy, no `destructive` on a
      financial figure, no grades or ranks *(UI/content changes only)*

## Notes for the reviewer

<!-- Anything you already know is imperfect, deferred, or worth arguing about.
     Deferred work should have an issue; link it. -->
