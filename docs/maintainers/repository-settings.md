# Repository settings: rulesets, merge queue, squash-only

This repo is governed by a GitHub repository **ruleset**
(`.github/rulesets/main.json`), not classic branch protection. Rulesets are
the current GitHub mechanism; they are versioned as JSON here so the live
config is diffable and reproducible from any machine, not something only
visible by clicking through repo Settings. Pattern and file copied from
LEAPWare-SessionKeeper's own `docs/maintainers/repository-settings.md`, with
the CI job names, repo name and one review-count justification changed to
this repository's own.

**This ruleset is applied, and the decisions behind it are answered.** Measured
2026-09-19 against the live repository: `gh api
repos/LEAPWare-Software/LEAPWare-ShellUX --jq '{visibility, license:
.license.spdx_id}'` returns `public` and `Apache-2.0`, and `gh api
repos/LEAPWare-Software/LEAPWare-ShellUX/rulesets` returns exactly one ruleset —
`main`, id `23685990`, `enforcement: active` — whose seven
`required_status_checks` entries each carry `integration_id: 15368`. D-42 (the
Apache-2.0 licence) and D-43 (public visibility) were both answered by the owner
on 2026-09-18; neither is open.

The ordering that got it here, kept because re-applying repeats it: `gh api
repos/{owner}/{repo}/rulesets` on a private repo without the right
plan/permissions can behave differently from a public one, so the repo went
public first and this file's script ran second. Applying or re-applying is the
owner's/integrator's own action; nothing in CI or in this script does it
automatically. See "Bootstrap is owner-only" below, and "Applying rollout step 4
(PR B) and reading it back" for the read-back's pass condition.

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
  (the PR branch must be up to date with `main` before merging) and, since
  rollout step 4 of `docs/proof-of-completion.md` (§5 step 4, "PR B"), seven
  CI job names actually emitted by this repo's workflows today:

  | Ruleset context | Workflow / job |
  |---|---|
  | `Verify (ubuntu-latest)` | `.github/workflows/ci.yml`, `verify` job, `matrix.os: ubuntu-latest` |
  | `Verify (macos-latest)` | same job, `matrix.os: macos-latest` |
  | `Verify (windows-latest)` | same job, `matrix.os: windows-latest` |
  | `Browser tests (chromium)` | `.github/workflows/browser.yml`, `browser` job |
  | `Declared Node floor (22.13.0)` | `.github/workflows/ci.yml`, `floor` job |
  | `Prove claims` | `.github/workflows/claims.yml`, `prove` job (proof-of-completion §3.4) |
  | `PR evidence` | `.github/workflows/pr-evidence.yml`, `evidence` job (proof-of-completion §3.3) |

  These are the workflow files' own `name:` fields, not invented labels — a
  required status check is matched by GitHub on the exact string a workflow
  run reports, so a renamed job that isn't updated here can never gate a
  merge again, silently. **If the matrix or a job name changes, update the
  workflow file and this table together**, the same rule
  LEAPWare-SessionKeeper's own copy of this file states for its Python
  matrix.

  **`Prove claims` and `PR evidence` are guardrails, not integrity controls**
  (proof-of-completion §1): each defends only against the honest mistake —
  an unticked claim, a missing review record, prose that asserts "done"
  without a proven row. Whoever can edit `.github/rulesets/main.json`,
  `claims.yml` or `pr-evidence.yml` can also loosen or remove what they
  enforce; that is outside this protocol's threat model and is closed only
  by a second approver or LEAPWare BuildCraft R4 (`docs/proof-of-completion.md`
  §1, §6).

  Every entry above also carries `"integration_id": 15368` — the GitHub
  Actions app id (measured: `gh api repos/{r}/commits/main/check-runs --jq
  '.check_runs[0].app.id'` returned `15368`, `docs/proof-of-completion.md`
  intro facts). This pins each required context to check runs posted by the
  Actions app specifically — a guardrail GitHub itself enforces once applied,
  closing the gap where a caller with `statuses:write` (not `checks:write`;
  that scope covers the separate Checks API) could post a same-named commit
  status through the plain Statuses API and satisfy the requirement without a
  workflow having run at all. `scripts/__tests__/apply-rulesets.test.mjs` —
  *Test:* "every required_status_checks entry in the real main.json carries
  integration_id 15368 (rollout step 4)" — asserts the pin is present on all
  seven contexts in the committed file.

  `compare-ruleset.mjs` (§3.5) excludes `integration_id` from the drift
  comparison only when the live response omits the field entirely, which is
  the case for every response captured against this repo so far — **because
  the ruleset has never had the field set, not because the caller lacks
  write access.** An authenticated call against a ruleset that
  carries `integration_id` returns it, and so does an unauthenticated one (**measured
  2026-09-19 after the apply**, both returned all 7 entries with `integration_id: 15368`);
  the exclusion is keyed on the field's
  presence in the response, not on the token's permissions (`bypass_actors`,
  above, is the one that is genuinely access-gated). Concretely: **the
  post-apply read-back's pass condition is `integration_id: 15368` present on
  all 7 entries**, not merely 7 matching contexts — see "Applying rollout
  step 4" below. Because the field is now returned even without a token, CI's
  read-only `Prove claims` compares it, and `S-ruleset` would report a dropped pin.
  The paragraph that follows is kept as the reasoning behind that check, and applies
  only if GitHub ever stopped returning the field. If CI's own read-only token showed
  the field as absent after a real apply, that would be a blind spot, not a non-issue:
  `S-ruleset` cannot then detect someone dropping the pin (removing
  `integration_id` from the live ruleset, or replacing a workflow-posted
  check with an API-posted status of the same name) — the comparison would
  keep excluding the field and report no drift either way. Closing that would
  need either a token with write access to the ruleset in the comparison job
  (a bigger permission grant than `contents/pull-requests/actions/issues:
  read`) or a separate, deliberately privileged check; neither is built here.
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

## Applying rollout step 4 (PR B) and reading it back

Per `docs/proof-of-completion.md` §5 step 4 (M5), the order is: merge PR B
first, THEN apply it, THEN read it back to confirm. `main.json` in a feature
branch is not the tree `gh auth`'s current checkout applies from, and
applying before the merge would make the two new checks required before any
PR had proven it could pass them — so the merge has to land first. This is
the owner's/integrator's own action, same as the rest of this file's
bootstrap section:

```
git checkout main && git pull                    # after PR B is merged
node scripts/apply-rulesets.mjs --dry-run         # inspect the JSON, incl. integration_id
node scripts/apply-rulesets.mjs                   # apply for real (PUT, since ruleset 23685990 exists)
gh api repos/LEAPWare-Software/LEAPWare-ShellUX/rulesets/23685990 \
  --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks'
node scripts/claims/compare-ruleset.mjs           # confirm no drift against the live ruleset
```

The read-back's pass condition is that every one of the 7 printed entries
carries `"integration_id": 15368`, not just that the 7 `context` strings
match — a response with the right 7 contexts but a missing or wrong
`integration_id` is a silent narrowing of what this file declared.

Expect one main `claims.yml` run between the merge and the apply to record
`S-ruleset` drift (the two new contexts are declared in `main.json` on `main`
before they exist on the live ruleset) and file the "Claims register is
failing" issue; the read-back above, once it shows the two new contexts live,
is the evidence that closes that issue with a comment, not a re-run of the
row (`manual`ly, per §3.5's "Issue job" and G3).

## Updating a Dependabot PR

Use `@dependabot rebase` (a PR comment) to bring a Dependabot PR up to date
with `main`, never GitHub's "Update branch" button. `pr-evidence.yml`'s
Dependabot exemption (`docs/proof-of-completion.md` §3.3) requires every
commit on the PR to have `author.login == 'dependabot[bot]'` and a verified
signature; "Update branch" merges `main` into the PR branch with a merge
commit authored by whoever clicked it, which breaks that all-commits author
check — the exemption is lost and the
PR needs a full evidence body instead. `@dependabot rebase` re-requests the
update from the bot itself, so every commit stays `dependabot[bot]`-authored
and verified.

## Break-glass: a gate-script bug blocks every merge

`bypass_actors` is `[]` (above): nothing, including the owner, bypasses this
ruleset by role. If a bug in `Prove claims` or `PR evidence` (not the code
under test — the gate script itself) makes either required check fail on
every PR, including the PR that would fix it, the ruleset itself has no
escape hatch. The only way out is the same one `docs/proof-of-completion.md`
§1 and §6 already name as this protocol's edge: the owner edits the live
ruleset directly, in the GitHub UI, to drop the two blocked contexts from
`required_status_checks`; merges the fix PR (which does not need to pass the
check it is fixing); re-applies `.github/rulesets/main.json` with
`scripts/apply-rulesets.mjs` (restoring both contexts, now presumably fixed);
and reads the ruleset back to confirm. This is a deliberate, visible action
outside CI, not a script — CI cannot un-block itself — and it must be
recorded in `docs/DECISIONS.md` through the PR that carries the fix, naming
the outage and the UI edit, so "why were these two checks briefly not
required" has an answer in the same place every other ruleset decision does.

## Bootstrap is owner-only

No script, CI job or agent in this repository *decides* to flip the repository
from private to public or to pick a licence. Both were owner calls — **D-43**
(the repository goes public) and **D-42** (the licence is Apache-2.0), each
answered 2026-09-18 — and both have since been carried out. D-43's own row
records how: the owner directed the CTO agent to make the repository public
under that day's delegation, and the agent did so. So "owner-only" here means
the decision is the owner's and an agent acts only on a delegation the decision
names; it does not mean no agent has ever touched the setting.

**The ruleset documented above is the reversal of D-27**, not a change that arrived
without one. D-27 — "No branch protection, and no spend to get it" — held from
2026-08-04 because both branch-protection endpoints returned 403 on a private
free-plan repository with one developer, making paid enforcement buy process, not
quality. That situation stopped being true once the repository went public (D-43)
under Apache-2.0 (D-42), which is what D-34 records as making "D-27's branch
protection possible, as a ruleset" — this file documents that ruleset. See
[`docs/DECISIONS.md`](../DECISIONS.md) D-27 and D-34 for the full reasoning on both
sides; it is not repeated here.

One job does enable auto-merge: `.github/workflows/auto-queue.yml` adds a
cloud-lane PR to the merge queue once `scripts/cloud/auto-queue.mjs` finds it
ready (a lane label, `Verdict: MERGE` in the body, and the newest
`shellux-cloud-reviewer` comment at the head, by `LEAPWare-HQ`, saying MERGE).
A queue entry this job makes does get the required checks run on it before
anything merges — measured, not assumed: the `Auto-queue` run at
`2026-09-19T16:30:23Z` logged `auto-queue: #190 queued at 9ee3f218…`, and the
queue branch `gh-readonly-queue/main/pr-190-39bf3502…` then ran `CI`, `Browser`,
`Claims` and `PR evidence`, all four `success` (`gh api
repos/{owner}/{repo}/actions/runs?event=merge_group`).

That readiness check is a **guardrail, not an integrity control** — the same
standing as `Prove claims` and `PR evidence` above, and the same word
`scripts/cloud/auto-queue.mjs`'s own docblock uses. It closes the documented
route and makes the honest mistake loud; it enforces nothing against deliberate
action. Every cloud routine posts under the owner's login, so the comment the
script reads proves a review exists at the head, not which routine wrote it,
and whoever can edit `auto-queue.yml`, the script, or the secret changes what
gets queued.
*Tests:* `scripts/__tests__/auto-queue.test.mjs` — *Test:* "ignores a forged
review comment from any other account", *Test:* "refuses a review comment made
at an older head" and *Test:* "calls gh pr merge --squash --auto pinned to the
head only when ready" pin the readiness rules and the head-pinned enqueue.
Those tests run `readiness()` and the script's `main()` against an injected
fake `gh`; **no test in this repository asserts that the merge queue re-runs
required checks**, which is GitHub's own behaviour and rests on the
measurement above alone.

It enqueues with the Actions secret `AUTO_QUEUE_TOKEN`, a classic `repo`-scope
token the owner creates and stores. **No creation or expiry date is recorded
here**: a date in this file goes stale silently the first time the token is
rotated, and nothing in CI reads one back. The secret's own last-updated date
is on this repo's Settings → Secrets and variables → Actions, and the token's
expiry on the owner's Tokens (classic) page; those two are the only current
answers.

The built-in `GITHUB_TOKEN` cannot do this job: GitHub starts no workflow for
an event that token causes, so on #194 auto-merge set by `github-actions` left
the PR out of the queue with every check green. The two ways the secret can
stop working fail in different places, and only one of them is loud:

- **Unset or emptied** — the job's `Require the AUTO_QUEUE_TOKEN secret` step
  compares `secrets.AUTO_QUEUE_TOKEN != ''` and exits 1 with an `::error::`.
- **Present but expired or revoked** — that step passes, and the failure lands
  in `Queue the pull request if it is ready`, as whatever `gh` reports for a
  rejected credential. The step name says nothing about it.

Either way nothing merges until the owner stores a new token (Settings →
Developer settings → Personal access tokens → Tokens (classic), scope `repo`;
then this repo's Settings → Secrets and variables → Actions).
