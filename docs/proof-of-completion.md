# Proof of completion, before LEAPWare BuildCraft can enforce it

**Status: PR A built (§4), rollout steps 2 to 5 not done.** The two checks are not required;
plan step 0c tracks the rest. Revision r12, audited adversarially in twelve
rounds by agents that did not write it; the last round found no Blocker, and its Majors and
Minors (X1-X9) are folded in. Author: agent, under the owner's CTO delegation of
2026-09-18 (D-50).

Repository facts this plan relies on, each with the command that measured it
(2026-09-18/19; `{r}` is `LEAPWare-Software/LEAPWare-ShellUX`):
- public, and the organisation is on the `free` plan: `gh api repos/{r} --jq .visibility`
  returned `public`; `gh api orgs/LEAPWare-Software --jq .plan.name` returned `free`;
- ruleset `23685990` (`gh api repos/{r}/rulesets --jq '.[]|"\(.id) \(.name)"'` returned
  `23685990 main`), whose content is `.github/rulesets/main.json`: on `~DEFAULT_BRANCH`, a
  PR (0 approvals), five strict required checks (Verify on ubuntu, macos and windows;
  Browser tests (chromium); Declared Node floor (22.13.0)) and a merge queue (ALLGREEN,
  SQUASH, 10-minute response timeout);
- the GitHub Actions app id is 15368:
  `gh api repos/{r}/commits/main/check-runs --jq '.check_runs[0].app.id'` returned `15368`;
- artifact retention is 90 days:
  `gh api repos/{r}/actions/permissions/artifact-and-log-retention` returned `{"days":90}`;
- concurrency: `ci.yml`, `browser.yml`, `desktop.yml` and
`audit-dependencies.yml` use `concurrency: group: ${{ github.workflow }}-${{ github.ref }},
cancel-in-progress: true` (X6).

Audit history: Blockers per round 2, 3, 2, 2, 2, 5, 7, 2, 2, 1, 1, **0**. Round 8 accepted
the threat model below; round 12 found no Blocker.

## 1. Threat model

The three incidents of 2026-09-18 were honest mistakes: (I1) "zero open pull requests"
(HANDOFF #128, plan `44edac1`); (I2) "npm 10.9.8 crashes on this lockfile" (CLAUDE,
traps heading, HANDOFF, #128); (I3) "0 sourcemaps packaged" (agent report). Each was an
assertion checked once or never.

This protocol defends against the honest mistake. It does not defend against a writer
who sets out to defeat it: on the free plan with 0 approvals, anyone who can merge can
edit any in-repository gate, and no design here removes that; BuildCraft R4 or a second
approver can. One honest mistake sits at the edge and is named: an agent that loosens a
row's check or the linter to get green. The defences are the `Gate changes:` and
`Rows reviewed:` lines, which make the change visible, and a review under the same
identity. That is weak, and it is a guardrail. No part of this protocol is an integrity
control, and every component this design builds is a guardrail. The merge queue is
GitHub's, not this design's; it is observed working (the `merge_group` runs that landed
#143 and #144), and no test in this repository exercises it, so no stronger word is
claimed for it here (ADR-0001 Amendment G).

## 2. Guarantees (against the honest mistake)

G1. **"Done" has one recording form: a ticked task item in `docs/plans/**`.** A PR that
    adds a tick, or changes a ticked item's text or tag, fails unless the item cites a
    register row in `active` whose `box` equals the item text and which passes in that
    PR's run (`repo`/`github`), or is a `manual` row with its evidence file present.
G2. **What is checked is the row's `expect` list, not the item's prose.** A row declares
    expectations such as `{ "key": "handoff_bytes", "op": "<=", "value": 3000 }`; its
    checks print `key=value` lines; the prover evaluates each expectation. Numbers in the
    item's prose are not checked, spelled out or not; a measured value belongs in
    `expect`, and prose may repeat it only as a bound.
G3. **Every `repo` and `github` row is re-run on every completed main run** (`push` to
    `main` and the daily `schedule`; a pending push run may be superseded by a newer one,
    which checks a tree containing it, X7). A failing row, a structural failure, ruleset drift, or a
    crashed run files one issue. `manual` rows are never re-run; they are dated.
G4. **Step heading counts `(x/y)` equal the item counts**, and a PR that removes or
    rewords an item, or deletes or moves a plan file, must name each one.
G5. **Every PR carries evidence, "Not done", and a review record for its head SHA.**
G6. **Status answers come from `npm run status`,** whose rendering rules are in §3.6. It
    never prints "proven", and it re-checks structure locally before trusting any run.

Not guaranteed: free prose (HANDOFF, CHANGELOG, a plain bullet such as today's "(done
2026-09-18, reason on the PR)", a table mark, a plan file outside `docs/plans/**`) is not
recorded as done by this protocol; the status report ignores it, an advisory lint (§3.8)
annotates likely cases on the PR, and review decides. The rule in `CLAUDE.md` and the PR
template: prose may point to an item, not declare one done. I2 is prose and is covered
by ADR-0003 rule 2 and review, not by the machine. A row's check can be weaker than its
item; probes narrow that for `repo` rows. A PR that breaks an old tick is caught by the
next completed main run, not by that PR.

## 3. Components

### 3.1 Register: `docs/claims.json`

`{ "schemaVersion": 1, "active": Row[], "retired": Row[] }`. "The row exists" means it is
in `active`.

Row = `{ id, box, class, checks?, expect?, probe?, evidence?, provenOn, addedBy }`:
- `id`: `C-` plus digits, unique across `active` and `retired`.
- `box`: the item text (§3.2).
- `class`:
  - `repo`: reads the tree only. `probe` required: a named mutation, applied in a
    scratch worktree, that must turn a check red; a row whose probe leaves it green is
    rejected as vacuous.
  - `github`: reads named GitHub objects, one object per command, by number or SHA. List
    and search endpoints are rejected **except for two paths pinned literally in
    `scripts/claims/lib.mjs`'s `GH_API_PATHS`**, each admitted for one row and written out
    in full so it cannot generalise: C-25's `search/issues?q=repo:LEAPWare-Software/
    LEAPWare-ShellUX+is:issue+is:open+no:milestone`, and C-31's comments list on this
    repository's issue #174. Any other query, repository or issue number matches neither
    regex and is refused. Both are GET-only, like every path in that list.
  - `manual`: `evidence` names a committed file of raw output; `provenOn` its date; never
    re-run; its `expect` values render as `STATED`, never as checked.
- `rowHash` (computed, not stored): sha256 of the canonical JSON of `box`, `class`,
  `checks`, `expect` and `probe` (X2).
- `checks`: a list of argv arrays; all must exit 0; their concatenated stdout is the
  row's output. Each `expect` key must appear exactly once as `key=<value>`, else the row
  fails; numbers compare after stripping thousands separators; `op` is one of `==`,
  `<=`, `>=`, `<`, `>`.
- Retiring: a row leaves `active` only by entering `retired` with `retiredBy` and
  `reason`.

**Argv allowlist** (exact shape; a fixture for every rejected form):
- `node <path>`: the path, after normalisation, lies under `scripts/claims/checks/`;
  argv[1] may not be `-e`, `--eval`, `-p`, `--print`, `--import`, `--require`, `-r`.
- `git <sub> ...`: argv[1] is one of `ls-files`, `show`, `grep`, `rev-parse`,
  `cat-file`, `diff`; rejected anywhere: `-c`, `-C`, `--git-dir`, `--work-tree`,
  `--exec-path`, `--ext-diff`, `--output`, `-O`, `--open-files-in-pager`. (`ls-remote`
  is not allowed: `repo` rows read the tree.)
- `gh` (`github` rows only): `gh api <path>` with no flags except `--jq <expr>`; rejected:
  `-X`, `--method` other than GET, `-f`, `-F`, `--field`, `--raw-field`, `--input`,
  `--paginate`, and the path `graphql`, in joined and split forms (`-XPOST`,
  `--method=POST`). Also `gh pr view <n>`, `gh run view <id>`, `gh issue view <n>`, each
  with `--json`/`--jq` only. The `<path>` must match one of `GH_API_PATHS` in
  `scripts/claims/lib.mjs` — single-object paths, plus the two literally pinned
  list/search paths named under `class` above. That list is the allowlist; this prose
  describes it and does not define it.
- Any argv containing `verify`, `test:coverage` or `test:browser` is rejected.

**Network restriction for `repo` rows** (a guardrail): on the Linux runner they run as
`sudo unshare --net -- sudo -u runner -E "$(command -v node)" ...` (ubuntu-24.04 restricts
unprivileged user namespaces through AppArmor; not yet measured on a runner). If the
wrapper fails the job fails; it never falls back to running unrestricted. Local runs are
unrestricted and print that they are.

### 3.2 Box linter: `scripts/claims/lint-boxes.mjs`

- **Finding items.** `remark-parse` + `remark-gfm`, and a raw-line scan
  `^\s*(>\s*)*([-*+]|\d+[.)])[\s ]+\[[ xX]\]` (Unicode whitespace). Raw hits inside
  remark `code`, `html` or `definition` nodes are dropped; any remaining disagreement
  fails as "ambiguous task item", including a line inside a paragraph that looks like a
  task item. Fixtures: GitHub `POST /markdown` (gfm) renderings captured once and
  committed; must-pass for fenced, indented, comment and link-definition cases; must-fail
  for paragraph continuation and the NBSP case.
- **Item text.** The source slice from just after the checkbox's `]` and its following
  whitespace to the end of the item's first paragraph; remove the `[C-nn]` tag, then
  collapse whitespace and trim. Fixtures for items that start with bold, code and plain
  text.
- **Structural checks, every ticked item, every run:** exactly one `[C-nn]`; the row is in
  `active`; its `box` equals the item text.
- **Execution, diff-scoped:** items whose tick, text or tag changed, and rows added or
  changed, over `origin/main...HEAD` (`pull_request`) or `HEAD~1..HEAD` (`merge_group`,
  after asserting `HEAD` has one parent and `main.json`'s `merge_method` is `SQUASH`):
  the row's checks pass and its `expect` holds, or it is `manual` with evidence present.
  Probes run for rows added or changed.
- **Headings:** each `(x/y)` equals checked/total task items from that heading to the next
  heading of the same or higher level, sub-sections included.
- **Removal or rewording:** base item text absent on the head, or a plan file deleted or
  moved, is reported to the evidence gate (§3.3), which enforces it.

### 3.3 PR evidence gate: `.github/workflows/pr-evidence.yml`, job `PR evidence`

Reads the PR body through the API (so a re-run sees the current body) and fails unless
it has:
- `## Evidence` with a line `VERIFY_EXIT=0`;
- `## Not done` with at least one line;
- `## Review` with `Reviewer:`, `Reviewed SHA:` equal to the PR head SHA (under
  `merge_group`, the head SHA read via API), `Verdict:` not `DO NOT MERGE`;
- `Rows reviewed:` naming every added, changed or cited row (or `none`);
- `Items removed or reworded:` naming each such item by its base line number, when §3.2
  reports any;
- `Gate changes:` naming every changed file under `scripts/claims/**`, the schema of
  `docs/claims.json`, `claims.yml`, `pr-evidence.yml` or `.github/rulesets/**`, when any.
Dependabot: exempt only when every commit from `GET /pulls/{n}/commits` has
`author.login == 'dependabot[bot]'` and `commit.verification.verified == true`; the box
linter still runs. `.github/PULL_REQUEST_TEMPLATE.md` gains these headings, the
prose-points-to-items rule, a note that any push or rebase makes `Reviewed SHA:` stale,
and a correction of its stale "CI runs fewer steps than `verify`" paragraph.

### 3.4 Workflows and required-check hygiene

`claims.yml` (job `Prove claims`) and `pr-evidence.yml` (job `PR evidence`):
- run from the PR head, like every other check here; no base-commit execution, so a gate
  change cannot deadlock the queue (X8);
- trigger on `pull_request` (types `opened, synchronize, reopened, edited`) and
  `merge_group`, with no `paths`, `paths-ignore`, `branches` or `branches-ignore` under
  either; `claims.yml` also on `push: branches: [main]`, `schedule` (daily) and
  `workflow_dispatch` (added 2026-09-19 for rollout step 3: one `choice` input `inject`,
  `none | failing-row | crash`, default `none`). A dispatch is a main run only from
  `refs/heads/main`: the artifact upload and the issue job require that ref, and the
  prover refuses a dispatch from any other ref. The workflow passes `inject` to the
  prover only when the event is `workflow_dispatch` (`'none'` on every other event), and
  the prover refuses any `--inject` but `none` on `pull_request`, `merge_group`, `push`
  and `schedule`. `failing-row` records one extra failed synthetic row `S-injected` while
  every real row runs as normal; `crash` exits non-zero before the result file exists.
  The required check `Prove claims` is never skipped; a dispatch run carries a different
  name, `Prove claims (dispatch)`, so a dispatch on a PR branch or a queue ref can never
  produce, skip or satisfy the required context. The job has no job-level `if`.
  Limit: the runs API records a dispatch by `head_branch` alone; that a dispatch from a
  tag named `main` would be told apart from `refs/heads/main` is not measured. Such a run
  fails in the prover and, if its `head_branch` reads `main`, renders `FAILING RUN` until
  the next successful main run.
  A guardrail against the honest mistake: whoever can edit `claims.yml` can remove it.
  *Tests:* scripts/__tests__/claims-prove.test.mjs — "refuses an injection on pull_request, merge_group, push and schedule, and a dispatch from any ref but main".
- skip only inside a step that exits 0 and prints its reason;
- under `merge_group`, parse the PR number from `merge_group.head_ref`
  (`refs/heads/gh-readonly-queue/main/pr-<N>-<base-sha>`) and fail if unresolvable;
- `actions/checkout` with `fetch-depth: 0`; a fixture shows the diff helper failing
  loudly in a depth-1 clone;
- permissions: `contents`, `pull-requests`, `actions`, `issues` all `read`; issue filing
  is a separate job (§3.5);
- concurrency (W2, M3): `pull_request` and `merge_group` keep the per-ref group with
  cancellation; `push`, `schedule` and a `workflow_dispatch` from `refs/heads/main` use a
  separate group `claims-main` (a dispatch from any other ref keeps a per-ref group, so it
  never replaces a pending main run) with
  `cancel-in-progress: false`. GitHub keeps at most one pending run per group and cancels
  an older pending one when a newer arrives; that is safe, because the newer run checks a
  tree that contains the older one, and cancelled runs are never reference runs (§3.6).
- job outcome (W4): on `pull_request` and `merge_group`, any failing diff-scoped row or
  structural failure fails the job; on `push`, `schedule` and a `workflow_dispatch` from
  `main`, the job records every
  result in the `claims-results` artifact and succeeds unless it crashes.
`scripts/__tests__/required-checks.test.mjs` (in `test:scripts`; `yaml` declared as a
devDependency) expands `strategy.matrix` into job names, maps every ruleset-required
context to a job, and asserts the trigger, filter, `edited` and concurrency rules above;
it passes on today's workflows before the new ones exist; the concurrency assertions
apply to the two new workflows only (X6). A timing test fails if the
summed measured per-row times for a PR or queue run exceed 4 minutes (the queue's CI run
measured 4m18s of its 10 minutes). Main runs are not queue-bound: `timeout-minutes: 30`,
and the timing test also sums the whole register plus every probe under 30 minutes (X4).

### 3.5 Main runs and issue filing

Each `push` to `main` and each daily `schedule` run: every `repo` and `github` row
(checks, `expect`, probes), every structural check, and the ruleset comparison, each
recorded in `claims-results` as `{ rowId, rowHash, pass, output }`, with structural
failures and ruleset drift recorded as synthetic rows `S-structure` and `S-ruleset` (W3).

**Ruleset comparison** against `.github/rulesets/main.json`, read with the job's read-only
token: the set of rule types must be equal; for each rule, every parameter key `main.json`
declares must be equal, and declared arrays (`allowed_merge_methods`,
`required_status_checks`) must be equal as a whole; undeclared keys are ignored.
`bypass_actors` is not compared, because GitHub returns it only to callers with write
access to the ruleset (measured: the unauthenticated response omits it): a bypass actor
added in the UI is not detected. If the read-only response omits `integration_id`, it is
excluded too, and that gap is stated. Fixture: today's unauthenticated response, which
round 11 measured as equal under these rules.

**Issue job** (`issues: write`, `needs: prove`, `if: ${{ !cancelled() }}`, on `push`,
`schedule` and a `workflow_dispatch` from `main` only; X5): files or comments one issue, "Claims register is failing", when the
check job's result is `failure`, or its artifact is missing, or any row (synthetic rows
included) failed. A run cancelled by hand or by concurrency files nothing. The
find-or-comment step is the one `audit-schedule.yml` uses (proven by #142); this job
form (separate job, `needs`, artifact download) is new and is proven in rollout step 3.

### 3.6 Status: `scripts/status.mjs`, `npm run status`

1. `git fetch origin main`.
2. **Local structure first (W1):** run §3.2's structural checks and heading counts on the
   working tree it reads. Any ticked item without exactly one tag, whose row is not in
   `active`, or whose `box` differs from the item text renders `UNPROVEN`, whatever any
   run says.
3. **Reference run:** among `claims.yml` runs whose runs-API record has event `schedule`,
   `push` or `workflow_dispatch`, `head_branch` `main`, `head_repository.id` equal to the repository id, status
   `completed` and conclusion not `cancelled` or `skipped`, the one with the highest
   `run_number`. Only then is its result read. Pull-request and merge-queue runs are never
   candidates.
   *Note, 2026-09-19 (rollout step 3):* `workflow_dispatch` joined the candidate events,
   because step 3 requires a forced crash to render `FAILING RUN`, and a run status never
   reads cannot render anything. The same `head_branch` and `head_repository.id` filters
   hold, so a dispatch from any other branch is never a candidate. Consequence: a
   `failing-row` dispatch concludes `success` and becomes the reference run until the
   next main run; its `S-injected` row is recorded but, like `S-structure` and
   `S-ruleset`, no ticked item cites it, so status renders the real rows as that run
   recorded them. A `crash` dispatch renders `FAILING RUN <id>` for every row until the
   next main run succeeds. Any later successful main run clears `FAILING RUN`, a
   dispatch with `inject=none` included; so a flaky crash hidden by a later green run is
   seen only through the issue it filed, which stays open until someone closes it.
   *Tests:* scripts/__tests__/status.test.mjs — "takes a workflow_dispatch run on main as the reference run, so a forced crash renders FAILING RUN, and never one from another branch".
   *Note, 2026-09-24 (lane C item 0e):* when the reference run concluded `success` but its
   `claims-results` artifact cannot be downloaded and read back — either the
   `gh run download <id> --name claims-results` call itself fails (in this project's cloud
   sandbox, always, because the outbound proxy blocks it), or the downloaded file cannot be
   parsed — `loadRunContext` falls back to reproducing the same rows locally:
   `node scripts/claims/prove-claims.mjs --mode push --out <tmpfile>` in the working tree,
   read back in the same `{ results: [...] }` shape as the artifact. `push` is the mode the
   reference run itself runs on `main` (§3.5), so the rows recomputed are the rows the
   artifact would have held. This is a fallback for the download-or-read-back step
   specifically: a missing reference run, a missing token, or any other structural failure
   is unchanged. If the local run also fails (a nonzero exit, or a
   result file that does not parse), `loadRunContext` throws naming both failures, and
   every row degrades to `UNPROVEN` the same way any other unreadable run does (§3.6 step
   4's no-reference-run rule, since `main()`'s catch leaves `reference` at its unset
   default) — it never crashes `npm run status`.
   *Tests:* scripts/__tests__/status.test.mjs — "falls back to a local run of prove-claims --mode push when the reference run artifact cannot be downloaded, and renders the row MEASURED LOCALLY".
   *Tests:* scripts/__tests__/status.test.mjs — "throws an error naming both failures when the artifact download and the local reproduction both fail".
   *Tests:* scripts/__tests__/status.test.mjs — "prints one warning naming both failures and exits 0 when the artifact download and the local reproduction both fail".
   *Tests:* scripts/__tests__/status.test.mjs — "renders UNPROVEN when there is no reference run, or the row is absent from it".
4. Rendering, first match wins: no token, `UNPROVEN`; `manual` row, `MANUAL <date>` with
   its `expect` values marked `STATED` (X1: manual rows never enter a run); newest
   completed main run cancelled by `timeout-minutes`, `FAILING RUN <id>` (X4); reference
   run conclusion not `success`, `FAILING RUN <id>` for every row, deliberately, because a
   crashed run's partial results are not trusted (X9); reference run `updated_at` more than 48 hours ago,
   `STALE`; its `head_sha` unknown locally or not an ancestor of `origin/main`,
   `UNPROVEN` — **both skipped when the results came from the local fallback above**,
   because a number computed just now against this process's own working tree is neither
   aged nor tied to `reference.head_sha`'s ancestry, so neither question has an answer for
   it; the row's `rowHash` in the results not equal to the local row's, `UNPROVEN`;
   recorded `fail`, `FAILING C-nn` (from either source, since a failure needs no elevated
   trust to state); recorded `pass` from the downloaded artifact, `PASSING C-nn run <id>`,
   followed by each checked expectation as measured (`handoff_bytes=1928 <= 3000`, X8);
   recorded `pass` from the local fallback, `MEASURED LOCALLY C-nn` with the same
   expectation detail — never `PASSING ... run <id>`, because no CI run vouched for it
   (CLAUDE.md's vocabulary section: a claim must render as what actually attests it).
   *Tests:* scripts/__tests__/status.test.mjs — "applies the rendering rules in the order the design fixes".
   *Tests:* scripts/__tests__/status.test.mjs — "skips staleness and the ancestor check for a locally-measured row, even against a stale reference run whose head is not known to be an ancestor".

### 3.7 Chat

The agent's status answers come from `npm run status` run at answer time. "Done" in chat
names the item and its `PASSING` run id. This is held by memory and review.

### 3.8 Advisory prose lint

`scripts/claims/lint-prose.mjs` (ported from the r6 prototype, whose source is committed
in PR A) scans added blocks of `HANDOFF.md`, `CLAUDE.md`, `README.md`, `docs/traps.md`,
`docs/DECISIONS.md` and `docs/plans/**` for completion and state wording and emits GitHub
warning annotations. It never fails a check. Reviewers answer each annotation in the
review record.

## 4. Migration (PR A)

- The register, `scripts/claims/**`, `scripts/status.mjs`, `npm run status`, the tests
  above, devDependencies `yaml`, `remark-parse`, `remark-gfm`, `unified`, both workflows
  and the template changes.
- The 14 ticked items in `v1-production.md` each get a row (with an `expect` list where
  the item states a measured value), or are unticked with a note. Live values in item
  prose (`(2,137)`, `(199)`) become bounds.
- Step 3's heading reads `(0/9)` with 3 ticked: corrected.
- `CLAUDE.md` and the template gain the prose-points-to-items rule.

## 5. Rollout, each step proven before the next

1. PR A as above. The two new checks are **not required**.
2. Throwaway PRs, each result pasted with its run id. Cases (b) to (k) run on
   `pull_request` only and are closed unmerged, because a queued bad case would land on
   main while the checks are not required; (a) and (l), with passing content, go through
   the queue. (a) both jobs report on `merge_group`; (b) ticking an item without a row
   fails; (c) citing a row with a different `box` fails; (d) an `expect` key printed zero
   times or twice fails; (d2) a row whose `expect` bound is exceeded fails (X3); (e) a heading count off by one fails; (f) removing or rewording
   an item without `Items removed or reworded:` fails; (g) a missing review record fails;
   (h) a body edit re-runs the evidence gate; (i) under the `unshare` wrapper a
   network-calling `repo` row fails, a tree-only row passes, and `node --version` prints
   the `.nvmrc` version (M2); (j) the NBSP task item fails as ambiguous; (k) a PR changing
   `claims.yml` without `Gate changes:` fails; (l) a two-entry queue group passes.
3. Three consecutive green main runs; then one forced failing row files the issue, and
   one forced crash renders `FAILING RUN` in `npm run status` and files the issue (W3).
   Forced through `workflow_dispatch` on `main` with `inject=failing-row`, then
   `inject=crash` (§3.4), so no broken tree lands on `main`.
4. Before PR B, every open PR gets a review record. PR B adds both checks to `main.json`
   with `integration_id: 15368`. Order (M5): merge PR B, then immediately apply it with
   `scripts/apply-rulesets.mjs` and read it back with `gh api`; the main run between the
   merge and the apply reports `S-ruleset` drift and files the issue, which the read-back
   closes with a comment.
5. When BuildCraft R4/R5 enforce, retire these item by item (`docs/sdlc.md`).

## 6. Known limits

- A writer who edits the gate, the register or the review record on purpose is outside
  the threat model. Closed only by BuildCraft R4 or a second approver.
- Free prose is not machine-checked.
- A row's check can be weaker than its item.
- A PR that breaks an old tick is caught by the next completed main run.
- `manual` rows are dated, not re-proven.
- A bypass actor added to the ruleset outside `main.json` is not detected.
- The `unshare` wrapper is unmeasured on a runner until rollout step 2(i).
