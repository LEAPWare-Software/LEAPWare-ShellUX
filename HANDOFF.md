# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `713c97b` (#196, 2026-09-19). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public
(Apache-2.0); `main` is protected by the ruleset in `.github/rulesets/main.json`,
with a merge queue.

## What landed on 2026-09-18 and 19

`git log --oneline` is the full list; the landmarks:
- ADR-0006 Accepted (#145); steps 1 CSP (#154), 2 SDK (#170).
- Rollout step 2 complete (#171, C-30); the step 3 harness (#173); plan step
  0c item 4 ticked (#175, C-31).
- #23 re-fit (W3-0), the wave-3 plan (#176); the `.lwplugin` validator (#177).
- Plan step 0c complete: the protocol is in force (#181, row C-37).
- The plugin store, ADR-0006 step 4 (#182).
- Wave-3 W3-1, the state primitives (#184).
- Plugin lifecycle hooks, nav tree, badge clear, ADR-0006 step 5 (#185).
- Proof rows C-38 to C-43 for work already built (#186).
- Cloud lanes can merge: the auto-queue workflow (#192, lane C item 0a).
- The cloud runbook, the `lw-*` roles and the gate-4 record (#188, D-52).
- The proof audit: 3 false, 11 weak, 17 underproven claims rows corrected (#190).
- Auto-queue's `issue_comment` leg restricted to `LEAPWare-HQ` comments (#194).
- Auto-merge via the `AUTO_QUEUE_TOKEN` secret; cloud merge path proven end to
  end with no human action, #188/#190/#196 (#196, lane C item 0a done).

## In flight

- **Start here:** [`docs/handoff/next-session.md`](docs/handoff/next-session.md), then #187.
- Cloud lanes build in parallel while the owner travels. Protocol:
  [`docs/cloud/runbook.md`](docs/cloud/runbook.md). Shared state: #187.
- Gate 4: #189's answer names six screens against a record of nine, so no decision row
  is written and step 9 and wave 4 wait. Record: `docs/design/gate4/`.

## The next step

1. Lane C item 0d (`claude[bot]` review gate) and 0e (`npm run status` fallback).
2. ADR-0006 steps 6 to 11, and W3-2 onward.
3. Plan steps 6, 6c, 7 (sourcemaps), 8 and 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time (cloud lanes excepted, D-52): every landing edits this file
  and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
