# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `31257bf` (#185, 2026-09-19). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public
(Apache-2.0); `main` is protected by the ruleset in `.github/rulesets/main.json`,
with a merge queue.

## What landed on 2026-09-18 and 19

`git log --oneline` is the full list; the landmarks:
- Public, Apache-2.0, ruleset and merge queue (#141); Claude review working (#151).
- Proof of completion: design (#152, D-50), PR A (#156), rollout step 2 (#169).
- ADR-0006 Accepted (#145); steps 1 CSP (#154) and 2 SDK (#170).
- Charts (#148), crash log and build target (#150), ShellLayout split (#160).
- Rollout step 2 complete (#171, row C-30).
- The rollout step 3 harness (#173); step 3 run on main (it filed #174, now no longer open);
  plan step 0c item 4 ticked (#175, row C-31).
- #23 re-fit (W3-0) and the wave-3 plan (#176); plan step 5 items 1 and 3 ticked.
- The `.lwplugin` validator, ADR-0006 step 3 (#177).
- Operator install guide and 1.0 known limits, plan step 7 (#178).
- PR B (#179): both proof-of-completion checks required, applied and read back.
- Plan step 0c complete: the protocol is in force (#181, row C-37).
- The plugin store, ADR-0006 step 4 (#182).
- Wave-3 W3-1, the state primitives (#184).
- Plugin lifecycle hooks, nav tree, badge clear, ADR-0006 step 5 (#185).
- Proof rows C-38 to C-43 for work already built (#186).
- This change: the cloud runbook, the `lw-*` roles and the gate-4 record (D-52).

## In flight

- Cloud routines build the plan in three lanes while the owner travels. The protocol is
  [`docs/cloud/runbook.md`](docs/cloud/runbook.md); the shared state is issue #187.
- Gate 4: #189 carries an `OWNER: gate 4 approved` answer. Its decision row and C-24's
  citation are still to do, so step 9 and wave 4 wait. Record: `docs/design/gate4/`.

## The next step

1. ADR-0006 steps 6 to 11, and W3-2 onward, once the owner says go.
2. Plan steps 6, 6c, 7 (sourcemaps), 8 and 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time: every landing edits this file and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
