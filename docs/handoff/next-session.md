# Next session: how to take ShellUX from here to 1.0.0

Written 2026-09-19 at the end of the session that built the proof-of-completion
protocol and landed ADR-0006 steps 1 to 5. **Read this file first, then
[`HANDOFF.md`](../../HANDOFF.md), then [`CLAUDE.md`](../../CLAUDE.md).** The plan itself is
[`docs/plans/v1-production.md`](../plans/v1-production.md); this file does not replace it.
It says what is done, what is not, in what order to do the rest, and how.

Every number below was measured on 2026-09-19. **Re-measure before you trust any of
them** (commands in section 1). If this file and the plan disagree, the plan and
`npm run status` win, and this file is stale.

## 0. Stop rules: read before doing anything

1. **Cloud routines are building ShellUX while the owner travels** (the owner's order of
   2026-09-19, D-52). The protocol is `docs/cloud/runbook.md`, and the live state is on
   issue #187. **A local session is one more worker, not the boss.** Read #187 first,
   touch no item a lane has locked, and change lane state only through the owner's
   `OWNER:` commands on #187.
2. **v1.0.0 is not tagged until LEAPWare BuildCraft meets readiness bar R1 to R7**
   (D-39, [`docs/sdlc.md`](../sdlc.md)). Build everything up to that point; then stop.
   Plan steps 9b and 10 are blocked on it.
3. **Only the owner does these:** publishing a release, flipping settings that need an
   owner decision, operator sessions and sign-offs, looking at the packaged app, the
   clean-VM install. Prepare them and ask; never do them.
4. **Never handle credentials or secrets.** Money, legal and business calls go to the
   owner. Technical calls are delegated to the working session as CTO: act, record the
   decision in `docs/DECISIONS.md`, prove it.
5. **Nothing is done until it is proven.** A plan box is ticked only with a register row
   in `docs/claims.json` whose check passes (section 3). Prose never declares done.

## 1. Re-derive the state (run these first)

```bash
git fetch && git log --oneline -1 origin/main          # where main is
npm run status                                         # every ticked item, PASSING / MANUAL / failing
node scripts/claims/lint-boxes.mjs                     # plan structure and counters
gh issue list --milestone v1.0.0 --state open          # the open 1.0 issues
gh pr list --state open                                # anything in flight
```

State on 2026-09-19: `main` at `904e8bc` (#186). `npm run status` against CI run
35439801044: 43 ticked items, 43 rows, PASSING 40, MANUAL 3, failing 0. 30 open issues
on milestone v1.0.0. No open PRs. No tag.

## 2. The 1.0.0 plan, step by step: done and not done

Counts are ticked/total items per plan step. **Done** means ticked with a passing row;
nothing else counts.

| Step | Done | What is left, in order | Who |
|---|---|---|---|
| 0 Land what was in flight | 6/6 | nothing | |
| 0b | withdrawn | | |
| 0c Proof of completion | 5/5 | nothing; the protocol is in force | |
| 1 Record the decisions | 1/2 | strike D-27 in `docs/DECISIONS.md` with its reversal written; then item 1 can be ticked (it is currently false on that clause only) | agent |
| 2 Context-file caps | 4/4 | nothing | |
| 3 Go public | 11/15 | (a) the D-27 reversal write-up (same edit as step 1); (b) `SECURITY.md` reordered as the item says, with "1.x: latest release only"; (c) paste raw API responses on #74 and #103; (d) README top matter, long body moved to `docs/` | agent |
| 3b Design gates 3 and 4 | 3/6 | gate-4 wireframes and the critique exist as a published artifact but are **not recorded in the repo**, so they cannot be ticked: commit the canvas source or a record under `docs/design/` with the critique, then add rows. The live impeccable pass on the running app comes after the UI steps | agent, owner looks |
| 4 Charts | 4/4 | nothing | |
| 5 Wave 3 | 3/4 | W3-2 to W3-8 (table below), then **the owner looks at the packaged app** | agent, owner |
| 6 Wave 4 instrument layer | 0/3 | per-row series with threshold bands, list minimap, overview state; browser cases and `tokens:check`; owner views the packaged build | agent, owner |
| 6b Runtime plugin host | 2/7 | ADR-0006 steps 6 to 11 (table below). Item 2 (contract) is **built but not ticked**: it also needs #68 closed with a decision row and #91 decided or fixed | agent |
| 6c Best-in-class bar | 0/4 | keyboard (`describeHotkey` wired, focus-order spec per surface); performance budgets in CI (#62); heuristic review against VS Code, Linear, Raycast, Outlook/Teams by an agent that did not build the UI; operator sessions with owner sign-off | agent, owner |
| 7 Production hardening | 4/5 | sourcemaps attached to the release (waits for step 8) | agent |
| 8 Release engineering | 0/6 | icon; GitHub publish provider (the three places `docs/RELEASE.md` §1 names); `release.yml` on `v*` tags, draft release; unsigned-update guardrail recorded with its test; RELEASE.md §0/§1 rewritten (it still says the repository is private); version `1.0.0-rc.1` | agent |
| 9 Prove the release path | 0/6 | rc.1 pre-release; clean Windows 11 VM install; rc.1 auto-updates to rc.2; uninstall/reinstall; owner sign-off | **owner** with agent prep |
| 9b BuildCraft enforcing pass | 0/4 | **blocked on BuildCraft R1 to R7** | stop |
| 10 Ship 1.0.0 | 0/5 | **blocked on 9b** | stop |

### ADR-0006, the runtime plugin host (source: the step table in `docs/adr/0006-*.md`)

| Step | State | What it needs |
|---|---|---|
| 0 Owner ruling, ADR Accepted | done (#145) | |
| 1 CSP | done (#154) | |
| 2 SDK barrel, `/shared/*`, api-surface baseline | done (#170) | |
| 3 `.lwplugin` validator, `hostApiVersion` rule | done (#177) | |
| 4 Plugin store, `/plugins/` route, sender-checked IPC | done (#182) | |
| 5 Lifecycle hooks, `setNavigationTree`, `clearBadge`, scope purge; contract 1.1 | done (#185) | |
| 6 Surface loader, fault reports, crash attribution, crash-loop breaker | **next** | decide first which document owns a plugin's hooks (#183); main cannot read a runtime nav tree yet (the store facade lacks `getNavigationTree`) |
| 7 Move the three plugins to `plugins/*`, delete `FIXTURE_EXTENSIONS` | open | also resolves #153 (mocks in the packaged bundle) |
| 8 `plugin:check` and its CI job (#57) | open | |
| 9 Plugin manager in host chrome, five states (D-48) | open | follow the approved gate-4 screen |
| 10 Packaged-app end to end | open | install, appears, disable, gone, crash shows *crashed*, shell survives |
| 11 GitHub Release URL source, organisation allowlist | open | |

### Wave 3 (source: `docs/design/WAVE3-PLAN.md`)

W3-0 (#176) and W3-1 (#184) are done. Open: **W3-2** rows (no `ShellLayout.tsx` edit),
**W3-3** nav and rail, **W3-4** pane chrome, **W3-5** ledger blocks and `Switch`,
**W3-6** palette and command surfaces, **W3-7** notifications and undo strip, **W3-8**
empty and error states. The plan's file-ownership table decides which may run in
parallel: only increments with no `ShellLayout.tsx` edit, and even then every landing
edits `HANDOFF.md` and `CHANGELOG.md`, so landings serialise.

### Recommended order for the next session

1. Housekeeping that makes existing claims true: the step 1 / step 3 items above
   (D-27, SECURITY.md, #74/#103 evidence, README), and any finding from the audit in
   section 5 that is not yet fixed.
2. ADR-0006 step 6, then 7, 8, 9, 10, 11.
3. W3-2 to W3-8, interleaved with 2 only where files are disjoint.
4. Step 6 (wave 4), then step 6c.
5. Step 8 release engineering, then prepare step 9 for the owner.
6. Stop at the BuildCraft boundary. Report with the status format in section 6.

## 3. How work lands here (the loop that made every merge above)

1. **Worktree per change**, in a `.workspaces/` directory beside the repository, never
   in the main tree and never in the home directory.
2. **Build** with an implementer agent (`opus` for design discovery and security-relevant
   host work, `sonnet` otherwise). Every dispatch carries a `BUDGET:` line. It must not
   edit `HANDOFF.md`, `CHANGELOG.md` or `docs/claims.json`; the coordinating session does.
3. **Adversarial review** by a different agent that did not author it (`lw-verifier`).
   Loop until the verdict is MERGE. Findings are fixed in the change or filed with
   evidence (rule 7). A reviewer's claim is measured before acting on it: one Claude
   review finding this session was a false positive, disproved in Chromium.
4. **Docs in the same change**: a CHANGELOG entry citing full test titles, a HANDOFF
   line. Tick a plan box only with a new `docs/claims.json` row (box text identical,
   checks that prove every clause, a probe that turns it red).
5. **Verify under the machine lock**, exit code read without a pipe:
   `until mkdir <tmp>/verify.lock 2>/dev/null; do sleep 30; done; npm run verify; E=$?; rmdir <tmp>/verify.lock; echo VERIFY_EXIT=$E`.
   Run `npm run test:browser` too for anything visual, geometric or pointer-driven.
   Use npm 11.16.0 (`npx -y npm@11.16.0 ci`).
6. **Re-stamp**: any commit after the review (even docs) goes back to the reviewer for
   `Reviewed SHA:` on the final head.
7. **PR body** needs `## Evidence` with a standalone `VERIFY_EXIT=0` line, `## Not done`,
   and `## Review` with `Reviewer:`, `Reviewed SHA:` (full 40 characters, the head),
   `Verdict:`, `Rows reviewed:`, `Items removed or reworded:` (full `path:line` for each
   line `lint-boxes --mode pull_request` lists) and `Gate changes:` (every changed file
   under `scripts/claims/` named). Check with
   `node scripts/claims/pr-evidence.mjs --event pull_request --pr <n>` before queueing.
8. `gh pr merge <n> --squash --auto` enters the merge queue. After merge, read the
   Claude review comment and measure any finding.
9. After merge, wait for the `Prove claims` run on the merge commit, then
   `npm run status`: new rows read UNPROVEN until that run lands.

## 4. Traps paid for in this session (in addition to `docs/traps.md`)

- **A quoted phrase near "pinned by a named test" is read as a test title** by
  `check:citations`. Do not quote non-titles in a sentence that cites tests.
- **CI's read-only token reads admin-only repository fields as `null`**
  (`security_and_analysis`). A row over such a field passes locally with an owner token
  and fails in CI. Use a `manual` row with a committed evidence file (C-43 is the model).
- **A PR body goes stale when the head moves.** Re-stamp and edit the body; the PR
  evidence check compares `Reviewed SHA:` to the head.
- **`cmd | tail; echo $?` reports `tail`'s exit code.** Capture exit codes without a
  pipe.
- **Heredocs mangle backslashes** in this shell. Write scripts with a file-writing tool.
- **Issues addressed but still open**: #17, #16, #80 (ADR-0006 step 5), #23 (W3-0) and
  #95 (the ShellLayout split). They were left open deliberately (no closing keywords).
  Close each only with a comment that pastes the evidence on `main`.

## 5. Audit of the proof of completion at hand-off

Two independent `lw-verifier` agents audited all 43 ticked rows at `904e8bc` on 2026-09-19. They found 3 FALSE (C-09, C-25, C-32), 11 WEAK and about 17 UNDERPROVEN. The owner ordered **all of them fixed, none handed off**.

- Items 1–14 (the false and weak rows) are in commit `9f47f87` on branch `docs/handoff-package`.
- Items 15–32 (the underproven rows, the C-22 CTO wording, the C-24 untick with the D-45 correction, and the gitleaks triage) were in progress when the laptop shut down. Their work in progress is committed on the same branch, **unverified**.
- **The cloud lane C conductor finishes them first:** the item list is in `docs/cloud/runbook.md`.
- #172 was milestoned v1.0.0.
- C-24: the owner does not recognise the gate-4 approval recorded in D-45. It stays unticked until the owner reviews the screens.

## 6. How to report status

When the owner asks for status, render the step plan with every substep checked or
unchecked, never prose (the owner's global format): a ledger line from `npm run status`,
the live step, a gate line, every step with its count, and a "Blocking now" line.
Re-measure every number at the time you report it.
