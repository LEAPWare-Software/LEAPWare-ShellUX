# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `e00ea93` (2026-09-18). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions, including the four owner calls still open (D-42 to D-45):
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## What landed on 2026-09-18

- **PR #115**: the redesign groundwork (wave 1) and the repairs behind #110 and #114.
  Adversarially reviewed, three prose findings resolved, merged `148217b`.
- **PR #126**: the production audit had been red every Monday since 2026-08-10
  (`js-yaml`, via `electron-updater`). It is cleared, the dev tree is now audited
  (`audit:all`), and a failing scheduled audit files an issue. Merged `e00ea93`.

## In flight

- **Branch `docs/mission-recast`** (this change): the README recast around the
  mission, with its long sections moved verbatim into `docs/`; `DESIGN.md` (design
  gate 3); `docs/sdlc.md`; `docs/plans/v1-production.md`; decisions D-31 to D-45;
  this file cut to the cap, with the old one archived.
- **Gate-4 screens**, awaiting owner approval (D-45): the "ShellUX 1.0 Screens"
  artifact. No redesign component is written until they are approved.

## The next step

1. Land `docs/mission-recast`.
2. Plan step 0: land the D-28 ignore in `dependabot.yml`, then recreate the group (#127).
3. The owner calls D-42 to D-45. Steps 3, 0b and 4 onward wait on them.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time: every landing edits this file and `CHANGELOG.md`.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). npm 10.9.8 crashes on this lockfile.
