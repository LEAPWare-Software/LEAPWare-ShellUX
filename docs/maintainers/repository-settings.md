# Repository settings: rulesets, merge queue, squash-only

This repo is governed by a GitHub repository **ruleset**
(`.github/rulesets/main.json`), not classic branch protection. Rulesets are
the current GitHub mechanism; they are versioned as JSON here so the live
config is diffable and reproducible from any machine, not something only
visible by clicking through repo Settings. Pattern and file copied from
LEAPWare-SessionKeeper's own `docs/maintainers/repository-settings.md`, with
the CI job names, repo name and one review-count justification changed to
this repository's own.

**This ruleset is NOT yet applied.** The repository is currently private
(D-42/D-43, licence and public visibility, are still open owner decisions),
and `gh api repos/{owner}/{repo}/rulesets` on a private repo without the
right plan/permissions can behave differently from a public one — the safe
order is: repo goes public, THEN this file's script runs. Applying it is the
owner's own action; nothing in CI or in this script does it automatically.
See "Bootstrap is owner-only" below.

## What `main.json` enforces

- **`target: branch`, `conditions.ref_name: ["~DEFAULT_BRANCH"]`** — applies
  to `main` specifically (the `~DEFAULT_BRANCH` alias tracks the repo's
  default branch even if it's ever renamed).
- **`enforcement: active`, `bypass_actors: []`** — the ruleset is live and
  nobody, no role, no app, bypasses it. If a future change needs a bypass
  actor, that is itself a reviewed change to this file, not a UI toggle.
- **`deletion`** — `main` cannot be deleted.
- **`non_fast_forward`** — no force-push to `main`, ever.
- **`pull_request`** — every change to `main` goes through a PR:
  `required_approving_review_count: 0`. This is **not** "no review happens":
  CLAUDE.md rule 1 requires adversarial review before merge, and
  `.github/PULL_REQUEST_TEMPLATE.md` carries that checklist on every PR. The
  count is zero honestly, not aspirationally, because this project currently
  has **one human developer** — a second required approver on a one-person
  repo is not a review gate, it is a lock nobody else can turn, and rule 1's
  review is enforced by the PR template and by ADR-0003, not by GitHub's own
  approval count. Raise this the day a second maintainer joins; leaving it at
  zero afterward would be the actual lapse. `dismiss_stale_reviews_on_push:
  true` (a new push invalidates a stale approval regardless), and
  `allowed_merge_methods: ["squash"]` (squash-only: one commit per PR on
  `main`, no merge commits, no rebase-merge).
- **`required_status_checks`** — `strict_required_status_checks_policy: true`
  (the PR branch must be up to date with `main` before merging) and the five
  CI job names actually emitted by this repo's workflows today:

  | Ruleset context | Workflow / job |
  |---|---|
  | `Verify (ubuntu-latest)` | `.github/workflows/ci.yml`, `verify` job, `matrix.os: ubuntu-latest` |
  | `Verify (macos-latest)` | same job, `matrix.os: macos-latest` |
  | `Verify (windows-latest)` | same job, `matrix.os: windows-latest` |
  | `Browser tests (chromium)` | `.github/workflows/browser.yml`, `browser` job |
  | `Declared Node floor (22.13.0)` | `.github/workflows/ci.yml`, `floor` job |

  These are the workflow files' own `name:` fields, not invented labels — a
  required status check is matched by GitHub on the exact string a workflow
  run reports, so a renamed job that isn't updated here can never gate a
  merge again, silently. **If the matrix or a job name changes, update the
  workflow file and this table together**, the same rule
  LEAPWare-SessionKeeper's own copy of this file states for its Python
  matrix.
- **`merge_queue`** — `merge_method: SQUASH`, `grouping_strategy: ALLGREEN`
  (the queue only merges a batch once every entry in it is green — no
  partial-pass merges), small min/max group sizes (1..5) and a 10-minute
  `check_response_timeout_minutes` so a stuck check doesn't block the queue
  indefinitely. Both `ci.yml` and `browser.yml` carry the `on: merge_group:`
  trigger added alongside this file, or CI never runs for queue entries and
  every queued PR times out.

## Re-applying from any machine

```
gh auth login                                  # once, if not already authenticated
node scripts/apply-rulesets.mjs --dry-run       # inspect the JSON that would be sent
node scripts/apply-rulesets.mjs                 # create or update by name
```

`scripts/apply-rulesets.mjs` is a Node port of
LEAPWare-SessionKeeper's `scripts/lws_apply_rulesets.py`. It reads every
`.github/rulesets/*.json` file, looks up whether a ruleset with that `name`
already exists on the repo, and either creates it
(`POST /repos/{owner}/{repo}/rulesets`) or updates it in place
(`PUT /repos/{owner}/{repo}/rulesets/{id}`). It shells out to `gh api`, so it
carries whatever account `gh` is authenticated as — it needs no token or
secret of its own, and it never touches the CLI's stored credentials.

Before doing anything mutating, it checks the repo's own
`allow_squash_merge` (etc.) against every merge method a loaded ruleset
requires, and refuses with the exact remediation `gh api ... PATCH` command
if the repo isn't ready — the ordering trap recorded in
LEAPWare-SessionKeeper as LWS-D0, ported here rather than rediscovered.
`scripts/__tests__/apply-rulesets.test.mjs` exercises that guard, the
create-vs-update branch, and the dry-run path entirely against an injected
fake `gh` runner — no network call, so it runs safely in `test:scripts` on
every CI leg regardless of this repository's visibility.

## Repo-level merge settings (not part of the ruleset)

Squash-only, auto-merge-eligible, delete-branch-on-merge are repository
settings, not ruleset rules:

```
gh api -X PATCH repos/LEAPWare-Software/LEAPWare-ShellUX \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY
```

Run this **before** `apply-rulesets.mjs` — the script's own ordering guard
enforces that, but the PATCH above is what actually satisfies it.

## Bootstrap is owner-only

Nothing in this repo — no script, no CI job, no agent — enables auto-merge
on a PR, merges a PR, flips the repository from private to public, or picks
a licence. Applying the ruleset and the repo settings above only makes
squash + merge-queue + auto-merge *available*; turning auto-merge on for a
specific PR, the first click that exercises the merge queue, the visibility
flip (D-42), and the licence choice (D-43) are each the owner's own action,
taken deliberately and separately from anything this file automates.
