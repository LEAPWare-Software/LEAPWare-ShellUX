# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `916f14a` (#212, 2026-09-24). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public
(Apache-2.0); `main` is protected by the ruleset in `.github/rulesets/main.json`,
with a merge queue.

## What landed, 2026-09-18 to 24

`git log --oneline` is the full list; the landmarks:
- Public, Apache-2.0, ruleset, merge queue, Claude review (#141, #151).
- Proof of completion: design, PR A, PR B, rollout 2-3 (#152 D-50, #156, #169,
  #171 C-30, #173-175 C-31, #179, #181 C-37).
- ADR-0006 Accepted (#145); steps 1-4 (#154, #170, #177, #182).
- Charts (#148), crash log, build target, ShellLayout split (#150, #160).
- #23 re-fit, wave-3 plan (#176); operator install guide, 1.0 limits (#178).
- Wave-3 W3-1, the state primitives (#184).
- Plugin lifecycle hooks, nav tree, badge clear, ADR-0006 step 5 (#185).
- Proof rows C-38 to C-43 for work already built (#186).
- Cloud lanes can merge: the auto-queue workflow (#192, lane C item 0a).
- The cloud runbook, the `lw-*` roles and the gate-4 record (#188, D-52).
- The proof audit: false claims corrected, checks tightened (#190).
- Auto-queue enables auto-merge with the AUTO_QUEUE_TOKEN secret (#196).
- D-54, plugin lifecycle-hook ownership enforced at the registry door
  (`runsPluginCode`), ADR-0006 decision 6 amendment, issue #183, lane A (#195, open).
- `npm run status` falls back to a local `prove-claims` run on artifact-download
  failure (#212, lane C item 0e).

## In flight

- **Start here:** [`docs/handoff/next-session.md`](docs/handoff/next-session.md), then #187.
- Cloud lanes build in parallel while the owner travels. Protocol:
  [`docs/cloud/runbook.md`](docs/cloud/runbook.md). Shared state: #187.
- Gate 4: #189's answer names six screens against a record of nine, so no decision row
  is written and step 9 and wave 4 wait. Record: `docs/design/gate4/`.

## The next step

1. ADR-0006 steps 6 to 11, and W3-2 onward.
2. Plan steps 6, 6c, 7 (sourcemaps), 8 and 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time (cloud lanes excepted, D-52): every landing edits this file
  and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`); see `docs/traps.md` for npm 10 history.
