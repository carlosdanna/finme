---
description: Open a pull request for the current branch
argument-hint: "[optional hint about framing, target branch, or draft]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git switch:*), Bash(git push:*), Bash(git rev-parse:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh issue list:*), Bash(pnpm check:*)
---

Open a pull request for the work on this branch.

Hint from the user (may be empty): $ARGUMENTS

## Steps

1. Run `git status --short`, `git branch --show-current`, and
   `git log --oneline main..HEAD` in parallel.
2. **If the branch is `main`**, stop. The work has to move to a branch first —
   offer `git switch -c <type>/<short-description>`, which carries uncommitted
   changes with it. If the commits are already *on* main, say so and stop;
   moving them is a rewrite and the user's call.
3. **If anything is uncommitted**, say what and stop. Use `/commit` first — a
   PR that omits half the change wastes a review.
4. Run `pnpm check`. If it fails, report the failure and stop; the pre-push
   hook will refuse the push anyway, and the reviewer's first question would be
   why CI is red.
5. Push with `git push -u origin HEAD`.
6. Read `.github/pull_request_template.md` and fill it in from the actual diff.
7. `gh pr create --base main --title "<title>" --body "<filled template>"`.
   Add `--draft` if the user asked, or if step 4 surfaced something knowingly
   unfinished.
8. Report the URL and nothing else.

## Writing the body

**Fill the template in. Do not ship it with the comments still in it.** Every
`<!-- -->` block is a question; answer it or delete the section per its own
instructions.

- **Title** — the Conventional Commit subject line for the change as a whole,
  same rules as `/commit`: `<type>(<scope>): <description>`, imperative,
  lowercase, ≤72 chars. A single-commit PR reuses that commit's subject.
- **What this changes** — the *why*. The diff already shows the what.
- **How to check it** — a real command that runs. `pnpm -F @finme/sim c1`,
  a test path, a URL and a viewport. Not "run the tests".
- **Simulation impact** — answer honestly, including "yes, this changes what
  existing seeds produce". That is not a problem to hide; it is a version bump.
- **Checks** — only tick what you actually ran in this session. An unticked box
  with a reason is worth more than a ticked box that is a guess.
- **Notes for the reviewer** — what you already know is imperfect. If the
  branch left something deferred, `gh issue list` for an existing issue and
  link it rather than inventing a new number.

## Project rules

- Base is `main` unless the user says otherwise.
- If the diff touches a `[F]` constant, a formula, the TDD §10 tick order, or
  an event definition, the PR must contain the `RULESET_VERSION` bump and the
  `docs/DECISIONS.md` entry. If either is missing, say so and stop.
- If a golden fixture changed, the body has to say why in the reviewer's own
  terms. "Updated the fixture" is not a reason.
- If the diff touches market or tax parameters and C1 was not re-run, say so
  rather than ticking the box.
