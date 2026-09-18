# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `e00ea93` (2026-09-18). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions (none open for v1):
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## What landed on 2026-09-18

- **PR #115**: the redesign groundwork (wave 1) and the repairs behind #110 and #114.
  Adversarially reviewed, three prose findings resolved, merged `148217b`.
- **PR #126**: the production audit had been red every Monday since 2026-08-10
  (`js-yaml`, via `electron-updater`). It is cleared, the dev tree is now audited
  (`audit:all`), and a failing scheduled audit files an issue. Merged `e00ea93`.

## In flight

- **Branches built in parallel, landing one at a time**: `chore/public-release-prep`
  (this change), `docs/adr-0006-plugin-host`, `fix/chart-title-contrast`,
  `fix/observability-build-target`. Each lands with its own review and `verify`.
- **Gate-4 screens** await owner approval (D-45). No redesign component before then.

## The next step

1. Land `docs/mission-recast`.
2. Land in order: ADR-0006, charts, hardening. Step 0 is complete.
3. After this lands: the owner makes the repository public (D-43); then apply the ruleset.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time: every landing edits this file and `CHANGELOG.md`.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). npm 10.9.8 crashes on this lockfile.
