Verdict: DISAGREE

Reviewer: shellux-cto-cloud-reviewer-2026-09-19
Reviewed SHA: bcee47f478d503d2c5a586babceced72cd97ff6f
PR: LEAPWare-Software/LEAPWare-BuildCraft#52 — "Ship lwb_no_unauthorised_destructive_action at warn (build-plan 1.6)"

Read-only review. Nothing was posted, committed, or pushed to LEAPWare-BuildCraft. Dispatched to an `lw-verifier` (opus) subagent working in an isolated worktree (`/home/user/bc-pr52`, detached at this SHA).

## Summary

Most of the PR body's claims hold up (four destructive-action categories matching `docs/handoff-protocol.md`'s hard rules, the unconditional merge carve-out, warn-only default, vendor rebuild, 661 passing tests, non-vacuous test suite). But the PR is not mergeable as-is, for two independent reasons, and the reviewer found one undisclosed, reproduced authorization bypass that the PR body does not name.

## Mergeability (confirmed)

1. **Bad commit identity (as PR #53 itself already claims — independently reproduced here, not taken on trust).** The head commit `bcee47f` is authored `Claude <noreply@anthropic.com>`, not the repo's allow-listed `LEAPWare <leapware@outlook.com>`. `python3 scripts/lwb_check_commit_identity.py --base origin/main --head bcee47f…` → `FAIL: commit author not LEAPWare or an allow-listed bot: Claude <noreply@anthropic.com>`, exit 1. The same command against the parent commit (`3056493`) passes. This is a `required` check (`ci.yml`'s `test` job, all six OS/Python legs) under a branch ruleset with no bypass actors recorded in the tracked `.github/rulesets/main.json`; the live GitHub check runs confirm all six `test` legs are `failure` with that exact message. The check scans the full `base..head` range, so nothing pushed on top removes it — only a history rewrite would, which this repo's own hard rules forbid without owner authorization. "Permanently blocked" is very close to true but not absolute: an owner-authorized force-push or ruleset change could still clear it (the reviewer only read the tracked ruleset file, not live bypass-actor config).
2. **A second, independent blocker PR #53 does not mention:** `lwb_lanes.py`'s gate fails because `reviews/52/cloud-reviewer-b.json` records `verdict: DISAGREE`, and 0 independent AGREE reviews exist across the branch's commits. This one is recoverable with a fresh AGREE review; the identity failure is not.

## Blocking finding (new — not disclosed in the PR body or its docstring)

**A single allowlisted category in a command chain silently authorizes every later destructive segment in that same chain**, because `_classify_command` returns only the *first* destructive segment and `evaluate()` checks authorization for that one segment only — nothing after it is examined. Reproduced directly against `evaluate()` in DENY mode:

```
SILENT: 'git push origin --delete landed && git push --force origin main'
        opts={'verified_landed_branches': ['landed']}
SILENT: 'git push --force origin main && git push origin --delete main'
        opts={'allow': {'force_push': True}}
SILENT: 'git push origin --delete main landed'   (landed verified; 'main' deleted unauthorized —
        only the last positional ref is taken as the target)
```

This directly contradicts the PR body's central claim ("authorised only when the consuming repo's own policy explicitly allowlists it") and is not among the parsing blind spots the rule's own docstring names as accepted. No test covers it.

## Other confirmed findings (non-blocking at `warn`, real)

- **"Could not check" and "checked, nothing found" share a representation.** The rule never reads `event.repo` (confirmed by its own docstring and by grep), yet stays silent whenever `repo is None` or `facts_incomplete` is set — the same `None` it returns for "not destructive". Consequence: the Codex adapter never populates repo facts, so the vendored Codex copy of this rule is inert end-to-end (confirmed by `grep -rn "repo=" adapters/` — only the Claude adapter sets it). The rule doc discloses the Codex silence; the PR body does not, and the "could not check" framing is never distinguished from "checked, found nothing" the way `lwb_proof_required`'s Attack-C fix (PR #51, reviewed separately) now does.
- **Evasions beyond the docstring's own named blind-spot list**, all reproduced SILENT: `git push origin +main` (a `+`-refspec force-push — the most common form after `-f`), `git push -uf origin main`, `git push --mirror origin`, `git push --prune origin 'refs/heads/*:refs/heads/*'`, `gh api repos/o/r/rulesets -f name=x` (POST is implied by passing `-f` fields), `gh api -XPATCH repos/o/r -f x=y`, `gh repo rename`/`gh repo archive`, `sudo git push -f origin main`. The docstring's claim that all misses are "accepted and named" is false.
- **`-n` treated uniformly as `--dry-run`** is wrong for `git commit --amend -n` (there `-n` is `--no-verify`; the amend genuinely happens) and `git rebase -n` (`--no-stat`). Both SILENT.
- **Minor:** docstring says "four ... well-known subcommands" then lists five; `git push origin :refs/heads/landed` against a `verified_landed_branches: ['landed']` policy false-positives (full ref vs. short name mismatch).

## What held up, with evidence

- `PYTHONPATH=core:adapters python3 -m pytest tests/ -q` → 661 passed.
- `python3 scripts/lwb_build.py --check` → OK, both vendor trees.
- `lwb_check_state_claims.py`, `lwb_handoff.py --check`, `lwb_check_prefix.py`, `lwb_check_no_instruction_dep.py`, `lwb_check_proof.py` (23 records) → all pass at this head.
- Five independent mutation probes against the rule (evaluate() always None; force-push detection removed; allow-check always true; repo-None gate removed; merge classified as history-rewrite) produced real, substantial test failures (34/15/34/3/3 out of the full suite) — the tests are not vacuous.
- The four destructive-action categories and the unconditional, per-segment merge carve-out match the PR's claims and are independently tested.

## Not checked

- The live GitHub ruleset's bypass-actor configuration (only the tracked `.github/rulesets/main.json` was read).
- CI logs for five of the six failing `test` legs (only ubuntu/3.12 was read).
- `proof/52.json`'s `verifiable` flags and digests.
- The full text of `docs/rules/lwb-no-unauthorised-destructive-action.md` beyond the sections grepped.
- Windows/macOS behavior; the Codex adapter end-to-end (checked only via grep for `repo=`).
- PR #53's diff (reviewed separately, see `pr53-48bfb5b5db5167961719531b3c29da6add12e5a4.md`).

```json
{
  "pr": 52,
  "reviewed_commit": "bcee47f478d503d2c5a586babceced72cd97ff6f",
  "reviewer_agent": "claude",
  "reviewer_id": "shellux-cto-cloud-reviewer-2026-09-19",
  "commit_author_agent": "claude",
  "commit_author_id": "worker-sonnet-5-01H2pQdziijj12otKaWk7XVU-2026-09-24",
  "verdict": "DISAGREE",
  "reviewer_was_dispatched_by_author": false,
  "notes": "Not this repo's gate; a private cross-repo review recorded on LEAPWare-ShellUX's reviews/buildcraft branch, produced by an lw-verifier (opus) subagent working in an isolated worktree. Blocked on two independent grounds (bad commit identity on the head commit; a DISAGREE already recorded under reviews/52/). Also found one new, reproduced, undisclosed authorization bypass: a single allowlisted category in a multi-segment command chain silently authorizes every later destructive segment in that same chain, because only the first destructive segment is classified and checked. Not verifiable against BuildCraft's own reviewer-identity format checks (PR #52 predates the PR #19 cutoff for that format, and this record was never intended to satisfy BuildCraft's own lwb_lanes gate)."
}
```
