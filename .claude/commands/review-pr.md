---
description: Review a pull request and give an approve/reject decision with reasons
argument-hint: "[PR number or URL] [--post to add the review as a PR comment]"
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checks:*), Bash(gh pr list:*), Bash(gh pr comment:*), Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*), Read, Grep, Glob
---

Review a pull request and reach a decision.

Target and flags (may be empty): $ARGUMENTS

## Steps

1. Resolve the target. With no number, use `gh pr view --json number` for the
   current branch's PR; if there is none, say so and stop.
2. Run `gh pr view <n>`, `gh pr diff <n>`, and `gh pr checks <n>` in parallel.
3. Read the full diff before forming a view. For anything the diff only
   half-shows — a function it calls, a constant it reads, the spec section it
   claims to implement — open the file. **A review from the diff alone misses
   exactly the bugs this project produces.**
4. Verify the PR's own claims. If the body says C1 was re-run, the numbers
   should be there. If it says a fixture changed deliberately, the reason
   should hold. If it ticks a box the diff contradicts, that is a finding.
5. Write the review in the shape below.
6. **Only if `--post` was passed**, add it with `gh pr comment <n> --body-file`.
   Post it as a comment; do not submit a formal GitHub approval or
   request-changes unless the user asks for that in so many words.

## Output shape

Lead with the decision. One of:

- **Approve** — merge it.
- **Approve with notes** — merge it; the notes are for later, not blockers.
- **Request changes** — something in here is wrong, and what.

Then:

### Why

Two to five sentences. What the PR does, and the specific reason for the
decision. If you are requesting changes, the blocking reason goes here in one
sentence before anything else — a reviewer should not have to hunt for it.

### Blocking

*Only present when the decision is Request changes.* One entry per problem:
the file and line, what breaks, and a concrete input or seed that breaks it.
"This looks fragile" is not a blocking finding. If you cannot say what goes
wrong, it belongs under Gotchas.

### Gotchas

*Omit this heading entirely if there are none.* Things that are correct as
written but will surprise the next person: a silent behaviour change, an
implicit ordering dependency, a constant that now means something subtly
different, a test that passes for a reason other than the one it claims.

### Recommendations

*Omit this heading entirely if you have none.* **Do not manufacture one.** A
clean PR gets "Approve" and stops. Padding a review with suggestions teaches
the author to skim reviews.

## What to actually look for

Ordinary review still applies — correctness, dead code, a test that cannot
fail. These are the ones specific to this project, and the ones that have
actually caused problems here:

- **Determinism.** A new `Math.random()` in the engine. A die roll added to an
  existing stream, which shifts everything downstream of it. An RNG call inside
  a loop over an unordered map. A `normal()` whose second draw got cached. The
  `flavor` stream touching simulation state.
- **The tick order.** TDD §10 is contractual. A reordered step is a behaviour
  change for every existing seed whether or not the author noticed.
- **Units.** Float dollars. A `parseFloat` in the engine. A monthly rate used
  where the annual was meant, or `/12` and `/52` mixed in one instrument. A
  second representation of time stored alongside `weekIndex`.
- **`[F]` constants.** Changed without a `RULESET_VERSION` bump and a
  `docs/DECISIONS.md` entry in the same PR. This is always blocking.
- **Golden fixtures.** A changed fixture with no stated reason is blocking.
  The question is never "does it match now" but "did we intend this".
- **Tests that cannot fail.** This repo has produced three. Watch for an
  assertion comparing a function to the constant it returns; a property
  assertion a hard-coded value would satisfy; a `toThrow()` that passes on the
  wrong error. Ask of each new test: what edit would make this go red?
- **Tone.** Green checkmarks, approving copy, `destructive` on a financial
  figure, letter grades, ranks, percentage-of-optimal, an event choice styled
  as the right one. GDD §1, and it is not a matter of taste here.
- **Layering.** React, DOM or browser APIs in `engine`. Simulation logic in
  `ui`. `indexedDB`, `localStorage` or `window` outside `WebStorageAdapter.ts`.
  `content` importing from anywhere but `engine`. Navigation state in the URL.
- **Content.** A renamed or reused event `id` — it silently changes what every
  existing seed produces. A fixed cents amount where a formula string belongs.
  An event definition inlined in TypeScript instead of JSON.
- **Mobile.** A touch target under 44px. `vh` instead of `dvh`. A fixed bottom
  element without `env(safe-area-inset-bottom)`. Anything that needs hover.

## Calibration

Be fair rather than harsh. Approving a good PR quickly is a real outcome, not a
failure to find something. Say plainly when you are unsure rather than dressing
a guess as a finding, and separate "this is wrong" from "I would have done it
differently" — only the first blocks.

For a deeper correctness sweep on a large diff, `/code-review high <PR#>` is
the complement to this; this command produces the decision.
