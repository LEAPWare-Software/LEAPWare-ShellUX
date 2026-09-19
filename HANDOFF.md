# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `cfeed0a` (#190, 2026-09-19). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public
(Apache-2.0); `main` is protected by the ruleset in `.github/rulesets/main.json`,
with a merge queue.

## What landed on 2026-09-18 and 19

`git log --oneline` is the full list; the landmarks:
- Public, Apache-2.0, ruleset and merge queue (#141); Claude review working (#151).
- Proof of completion: design (#152, D-50), PR A (#156), rollout 2 (#169).
- ADR-0006 Accepted (#145); steps 1 CSP (#154), 2 SDK (#170).
- Charts (#148), crash log (#150), ShellLayout split (#160).
- Rollout step 2 (#171, C-30); step 3 harness (#173); plan step 0c item 4 (#175, C-31).
- #23 re-fit (W3-0), the wave-3 plan (#176); the `.lwplugin` validator (#177).
- Operator install guide, 1.0 known limits, plan step 7 (#178).
- PR B (#179): both proof-of-completion checks required and read back.
- Plan step 0c complete: the protocol is in force (#181, row C-37).
- The plugin store, ADR-0006 step 4 (#182).
- Wave-3 W3-1, the state primitives (#184).
- Plugin lifecycle hooks, nav tree, badge clear, ADR-0006 step 5 (#185).
- Proof rows C-38 to C-43 for work already built (#186).
- Cloud lanes can merge: the auto-queue workflow (#192, lane C item 0a).
- The cloud runbook, the `lw-*` roles and the gate-4 record (#188, D-52).
- Proof audit: claims corrected, checks tightened (#190).
- Wave-3 W3-3: nav tree, 48px rail (this change).

## In flight

- **Start here:** [`docs/handoff/next-session.md`](docs/handoff/next-session.md), then #187.
- Cloud lanes build in parallel while the owner travels. Protocol:
  [`docs/cloud/runbook.md`](docs/cloud/runbook.md). Shared state: #187.
- Gate 4: #189's answer names six screens against a record of nine, so no decision row
  is written and step 9 and wave 4 wait. Record: `docs/design/gate4/`.

## The next step

1. ADR-0006 steps 6-11; W3-2 (open, #191), W3-4 onward.
2. Plan steps 6, 6c, 7 (sourcemaps), 8 and 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time (cloud lanes excepted, D-52): every landing edits this file
  and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
