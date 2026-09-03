---
description: Commit staged changes as a Conventional Commit
argument-hint: "[optional hint about what this commit is]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*)
---

Commit the current changes following Conventional Commits 1.0.0.

Hint from the user (may be empty): $ARGUMENTS

## Steps

1. Run `git status --short`, `git diff --staged`, and `git diff` in parallel.
2. If nothing is staged, stage only the files belonging to this change — never `git add -A` blindly.
3. If the changes cover unrelated concerns, make separate commits rather than one mixed commit.
4. Commit. Report only the subject line(s) you used.

## Format

```
<type>(<scope>)!: <description>

<body>

<footer>
```

- **type** — `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `style`, `revert`. `feat` = new capability, `fix` = corrected behaviour; neither applies to tests or docs alone.
- **scope** — optional, the package or area: `engine`, `sim`, `content`, `ui`, `docs`, or a subsystem (`rng`, `market`, `tax`, `events`).
- **`!`** — breaking change. Requires a `BREAKING CHANGE: <what breaks>` footer.
- **description** — imperative mood, lowercase, no trailing period, subject line ≤72 chars.
- **body** — only when the *why* is not obvious from the diff. Most commits have none.
- **footer** — `BREAKING CHANGE: …`, issue refs.

End every commit message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Project rules

- Changing a **[F]** constant, a formula, the tick pipeline order, or an event definition is a breaking change: use `!`, and the same commit must bump `RULESET_VERSION` and add a `docs/DECISIONS.md` entry. Say so and stop if either is missing.
- A changed golden fixture in the same commit is a red flag — confirm the behaviour change was intended before committing it.
- Don't commit on `main` without saying so first.

## Examples

```
feat(engine): add 4-4-5 calendar and seeded rng streams
fix(market): exclude week 0 from dividend payments
test(engine): pin market draw order with a golden fixture
docs: record the boom drift subsidy finding
feat(engine)!: rescale crash recovery factor to 0.68
```
