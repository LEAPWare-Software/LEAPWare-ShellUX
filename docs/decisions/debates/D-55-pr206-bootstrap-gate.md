# D-55 debate record: how PR #206 bootstraps its own `claude[bot]` review gate

Runbook §1 step 8 CTO/QA debate. Question filed as GitHub issue #211. Conducted by
the lane C conductor (cloud, 2026-09-25), dispatching an `lw-architect` (opus) as
CTO and a fresh `lw-verifier` (opus) as QA for each round, per the routing table.
Reproduced here close to verbatim, per runbook §1 step 8.5.

## The question

PR #206 (`lane-c/claude-bot-review-gate`) makes the required `PR evidence` check
fail unless a PR comment authored by GitHub login `claude[bot]` carries the PR's
current head SHA and `Verdict: MERGE`. PR #206 also edits
`.github/workflows/claude-code-review.yml`, the only workflow that posts that
comment automatically — and that workflow does not run on a PR that edits it
(GitHub Actions / `claude-code-action` skip a workflow file that differs from the
default branch). So #206 can never pass its own gate. A workaround via an
`@claude` mention (`.github/workflows/claude.yml`) was tried and failed: that
workflow's default tool grant lacks `gh pr view`/`gh pr diff` and its checkout
targets `main`, not the PR head.

---

## Round 1 — CTO proposal

**Recommendation: split PR #206 into two PRs so it no longer edits its own
reviewer (option 4a), plus a follow-up PR widening `claude.yml`'s tool grant with
a fork guard (a changed option 1).**

Key facts, measured from the repo:
- **F1.** #206's `claude-code-review.yml` change is a self-contained 15-line
  addition to the `prompt:` block; nothing else in #206 depends on it at runtime.
- **F2.** The auto-skip is `claude-code-action`'s workflow-validation rule, not
  GitHub's own — confirmed against D-49 (PR #144 skipped; PR #152, after the
  reviewer file itself had already changed, ran normally).
- **F3.** This recurs: 4 prior PRs (#144, #147, #149, #151) touched
  `claude-code-review.yml`; #206's gate would have blocked every one.
- **F4.** `claude.yml` grants no `gh pr` tools today, has no fork-PR skip (unlike
  `claude-code-review.yml`), and restricts triggering to OWNER/MEMBER/COLLABORATOR.
- **F5.** `claude-code-review.yml` is not itself a "gate file" per
  `pr-evidence.mjs`'s `isGateFile`.
- **F6.** `.github/rulesets/main.json` has `bypass_actors: []` — nobody can
  hand-merge around the gate without editing the ruleset.
- **F7.** `hasBotMergeComment` takes the single latest `claude[bot]` comment; an
  unrelated later `claude[bot]` reply (e.g. an `@claude` answer with no verdict)
  displaces a genuine earlier `MERGE`, hiding a valid review.

Options considered: (1) widen `claude.yml`'s grant — fixes the recurring case but
doesn't unblock #206 itself and needs security review; (2) an `OWNER:`-sign-off
escape hatch in `pr-evidence.mjs` — rejected, reopens exactly what D-53 removes;
(3) owner hand-merges — rejected, needs a ruleset edit since `bypass_actors: []`;
(4a) **split #206** — adds no privilege, uses the one reviewer path already shown
to work (F2); (4b) move to `pull_request_target` — rejected as a bigger, unmeasured
change.

Security analysis of the widened grant: same-repo PRs already get this exposure
from `claude-code-review.yml`; fork PRs are the real change (no fork skip in
`claude.yml`), closed by a fork-repo guard on the mention step. Explicitly labelled
**entry-point validation**, never "cannot forge"/"cannot post as".

Not measured: the exact GitHub Actions behaviour on a comment trigger against
`main`'s copy of the workflow; whether a mention's reply is really posted as
`claude[bot]`; the pytest-equivalent live run of `--allowedTools`.

---

## Round 1 — QA attack

**Verdict: OBJECT, revise before adopting.** The split mechanism holds and nothing
cheaper beats it, but:

1. **Stale-SHA race (PLAUSIBLE).** The prompt has the reviewer *fetch* the live
   head SHA, while `Read`/`Grep`/`Glob` see the checkout as of run start. A push
   mid-run could stamp a new SHA onto a review of old code. Fix in PR A (the only
   cheap moment, since PR A already edits those lines).
2. **The drafted fork guard breaks `@claude` on plain issues.** `claude.yml` also
   fires on `issues`/`issue_comment` for non-PR issues; an unconditional
   `gh pr view "$NUMBER"` fails there under `bash -e`.
3. **The `issue_comment` re-run claim is unverified and likely false.** Measured:
   two real `issue_comment`-triggered runs both attached to `main`'s tip
   (`head_sha: da95593`, zero linked PRs), not the PR head — so the required check
   on the PR itself would never turn green this way, contradicting the runbook's
   own "so a PR is not stuck" claim and D-53's wording.
4. **File before merge, not "fix it later" (rule 7):** the F7 comment-reset
   behaviour, and that neither workflow sets `persist-credentials: false`.
5. **Fork-PR policy consequence must go to the owner**, not be decided silently:
   once the gate is enforced, no fork PR can ever pass it.

Vocabulary and rule-6/ADR-0002 conflicts: none found.

---

## Round 2 — CTO revision

Accepted all five of round 1's objections, with corrections, and found a **new,
more serious problem**:

- **New finding.** #206's `pr-evidence.yml` `issue_comment` trigger condition
  (`github.event_name != 'issue_comment' || github.event.issue.pull_request != null`)
  has **no check on who commented**. On this public repo, any GitHub user
  commenting on a fork PR starts a workflow run, under `main`'s context and
  token, that checks out **the fork's own head commit** and runs `npm ci` — the
  fork writes code that this run executes. Unlike `auto-queue.yml`'s existing
  `issue_comment` handling (author-restricted to `LEAPWare-HQ`, checks out the
  default branch, runs no install step), #206 dropped all three protections.
  **Conclusion: the `issue_comment` trigger must be removed from PR B outright,
  not fixed.**
- **Stale-SHA fix (accepted):** print `${{ github.event.pull_request.head.sha }}`
  into the prompt from the event, instead of having the reviewer fetch it live;
  re-check `headRefOid` immediately before posting and use `DO NOT MERGE` if it
  moved.
- **Fork guard (accepted, narrowed):** the guard step only runs when
  `github.event_name == 'issue_comment' && github.event.issue.pull_request` is
  true, so plain-issue mentions are unaffected; section 5's "closes that
  documented route" language narrowed to cover only the gate-passing-comment
  route, not injection exposure in general.
- **F7 fix (attempted):** require both a `Reviewed SHA:` and a `Verdict:` line on
  the comment selected as "latest" — *this fix itself was later found wrong, see
  round 2 QA point 6 and round 3 below.*
- **`persist-credentials: false`** added to PR A's checkout step (confirmed by
  `grep -rn persist-credentials .github/workflows/` finding nothing today).
- **Fork-PR policy:** confirmed the effect starts at **PR B alone** (not
  "PR B + follow-up" as round 1 QA framed it), since `claude-code-review.yml`
  already skips fork PRs per D-49. Recommended recording it in D-53/this row as a
  knowingly-accepted consequence and flagging it to the owner as an informational
  item, not gating PR B's merge on an answer — flagged explicitly as a call QA
  might disagree with.

---

## Round 2 — QA attack

**Verdict: 5 of 6 points CONCEDE (with corrections); OBJECT on point 6 (the F7 fix).**

1. **Fork code-execution finding: CONFIRMED, and understated by the CTO.**
   Independently re-read `pr-evidence.yml` on the #206 branch: no author check, a
   real checkout of the fork's head, `npm ci` runs the fork's install scripts, and
   the last step then runs `pr-evidence.mjs` itself from the fork's own tree with
   `GH_TOKEN` in its environment — **no cache-poisoning trick is even required**,
   the fork simply writes the script that executes. The token itself is low-value
   (read-scoped, public repo), but the general class (a run in `main`'s context,
   triggered by anyone, executing fork-controlled code) is real and independently
   verified: `desktop.yml` (tag-triggered, `cache: 'npm'`, holds
   `CSC_LINK`/`CSC_KEY_PASSWORD`/Apple signing secrets) is a plausible downstream
   victim of a poisoned cache. Removing the trigger from PR B is confirmed correct.
2. **Stale-SHA fix: correct, with one refinement.** The re-check doesn't close the
   window by itself — pinning the SHA from the event does that; the re-check only
   avoids a misleading "DO NOT MERGE" label. `actions/checkout` on `pull_request`
   checks out the *merge commit*, not the raw head, a residual gap noted but not
   required to fix now (safe because fork PRs are already skipped there).
3. **Fork guard: syntactically sound**, correctly skips plain issues and `issues`
   events.
4. **Inform-vs-gate call: CONCEDE.** No existing decision row commits to fork
   contributions; `forks_count: 0` today; a maintainer re-push preserves original
   authorship. Two conditions: state the consequence in `CONTRIBUTING.md` too (not
   only this row), and if anyone later decides the owner must *approve* rather than
   be *informed*, runbook step 9 then blocks PR B on that answer.
5. **Filing (not fixing) the late-review-retrigger limit: CONCEDE**, rule 7 allows
   a labelled, unmeasured candidate fix as long as it's not presented as verified.
6. **F7 fix: OBJECT, reproduced by running it.** The "both lines required" filter
   makes the gate **fail open**: a genuine retraction missing either field (e.g.
   `Verdict: DO NOT MERGE` with no SHA line, or prose-only) is now silently
   skipped, letting an earlier stale `MERGE` count again. Measured directly against
   #206's real `hasBotMergeComment`:
   ```
   F7_unrelated_later_reply            current= false proposed= true
   superseded_retraction_both_lines    current= false proposed= false
   retraction_verdict_only_no_sha      current= false proposed= true   (regression)
   retraction_prose_only               current= false proposed= true   (regression)
   ```
   Suggested (not run against the real suite) amendment: select the latest comment
   *starting with* `Claude review:`, the prefix the prompt already requires.

**Overall round 2 verdict:** round 3 needed, scoped to point 6 only.

---

## Round 3 — CTO final fix, agreement reached

Verified QA's prefix requirement is real and already on `main`
(`claude-code-review.yml:72`, "starts with \"Claude review:\""), predating #206, so
no transition-window gap exists for it (the SHA/Verdict lines are the only part
that's new, gated correctly by PR A landing before PR B's enforcement).

**Found a flaw in QA's own literal-prefix suggestion:** the model's own output
sometimes bolds or headers the opener (`**Claude review:**`, `## Claude Review`),
which a literal `startsWith` would skip — and if the skipped comment is a
retraction, the earlier stale MERGE governs again, the same fail-open class QA had
just objected to. Measured:
```
X_bold_prefix_retraction          want=false  qaPrefix=true   (fail-open)
X_heading_prefix_retraction       want=false  qaPrefix=true   (fail-open)
X_unprefixed_verdict_retraction   want=false  qaPrefix=true   (fail-open)
X_bold_prefix_genuine_merge       want=true   qaPrefix=false  (real approval ignored)
```

**Final fix:** a comment is *review-shaped* — and only the latest review-shaped
`claude[bot]` comment ever governs — if it has **any** of: a prefix-tolerant
`Claude review` opener (regex, case/markup-insensitive), a line-anchored
`Reviewed SHA:` line, or a line-anchored `Verdict:` line. Missing/malformed data on
that selected comment is `false`; nothing ever falls back to an earlier comment.
Verified against all 9 existing named fixtures plus 6 new adversarial cases (bold
opener, heading opener, unprefixed verdict, unrelated reply, prose-only,
both-genuine) with **0 mismatches** in a scratch harness copied verbatim from
`8353365`'s `lastField`/`hasBotMergeComment`. Concrete diff and 5 new test
fixtures specified for `lw-implementer` to apply in PR B.

**Status: agreement reached.** Nothing left open for a further round.

---

## The decision, as it stands

1. **PR A** (this decision's first landing): `claude-code-review.yml` only —
   `persist-credentials: false` on checkout, and the prompt printing
   `${{ github.event.pull_request.head.sha }}` from the event (not fetched live)
   as the reviewed SHA, re-checking `headRefOid` before posting and using
   `DO NOT MERGE` if the head moved during the run. Keeps the existing
   "starts with \"Claude review:\"" opener sentence unchanged. No owner input
   needed; the bot gate isn't enforced until PR B, so nothing merges on a stale
   approval in between.
2. **PR B** (rest of #206, rebased onto current `main`): drops the
   `issue_comment` trigger, PR-number-resolution step, `ref:` override and
   concurrency change from `pr-evidence.yml` entirely (fork code-execution
   finding above); adds the review-shaped-comment selection fix for F7 with its
   5 new fixtures; corrects the runbook §4 and this row's own prior wording about
   an `issue_comment` re-run (it doesn't reach the PR — filed as a known
   limitation with evidence, not fixed, candidate: switch to a
   `pull_request_review` trigger, unmeasured); files `persist-credentials` gaps in
   `pr-evidence.yml`/`auto-queue.yml` with evidence.
3. **Follow-up PR** (after PR B): widens `claude.yml`'s tool grant
   (`gh pr view`/`gh pr diff`) with `persist-credentials: false` and a guard step
   that refuses `@claude` on fork PRs specifically (fails closed, skips cleanly on
   plain issues).
4. **Knowingly accepted consequence, recorded here per rule 1 (label aspiration as
   aspiration) and rule 8:** from PR B onward, a PR from a fork of this repository
   can never pass `PR evidence` — `claude-code-review.yml` already skips fork PRs
   (D-49), and the follow-up refuses the `@claude`-mention route for them too. An
   external contribution can land only if a maintainer re-pushes it to an
   in-repository branch. `forks_count` was 0 at debate time. This is an
   informational item for the owner, not a merge-blocking one, per the round-2/
   round-3 CTO/QA exchange above — recorded, not silently decided.
5. **General policy, stated for future workflow changes:** no workflow that runs
   with repository secrets or a write-scoped token may be triggered by a comment
   event in a way that checks out or executes pull-request head code from a fork;
   any comment trigger on such a workflow must restrict by `author_association`
   (OWNER/MEMBER/COLLABORATOR) and must run only base-branch code.

Vocabulary check (CLAUDE.md): the gate throughout is **entry-point validation** —
real at the `PR evidence` check, silent about every other route a comment claiming
that login could arrive by. The fork guard and the tool allowlist are
**guardrails** — in-repo YAML any writer can edit, not integrity controls. Neither
term is used loosely anywhere in this record.
