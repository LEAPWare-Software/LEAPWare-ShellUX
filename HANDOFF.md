# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `e424613` (#222, 2026-09-25). Mission (D-31) and rules: `CLAUDE.md`. Plan:
[`docs/plans/v1-production.md`](docs/plans/v1-production.md). Decisions:
[`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public (Apache-2.0);
`main` is protected by the ruleset in `.github/rulesets/main.json`, with a merge queue.

## What landed on 2026-09-18 and 19

`git log --oneline` is the full list; the landmarks:
- Public, ruleset/merge queue (#141); Claude review working (#151); ADR-0006 Accepted
  (#145). Proof of completion adopted (D-50, #152/#156/#169), then complete (#181, C-37).
- The plugin store, ADR-0006 step 4 (#182).
- Wave-3 W3-1 state primitives (#184); plugin lifecycle/nav tree/badge clear (#185);
  proof rows C-38–C-43 (#186).
- Cloud lanes can merge (#192, lane C item 0a); the runbook, `lw-*` roles and
  gate-4 record (#188, D-52).
- Proof audit corrected, `npm run status` falls back locally (0e); D-27 struck,
  superseded by D-34 (C-44).
- ADR-0006 steps 7-8 (#217/#57): plugins in `plugins/*`; `plugin:check` + CI.
- ADR-0006 step 11 (#222): Release-URL install source, org allowlist.
- ADR-0006 step 10 prep: packaged e2e lane, never run; owner/VM:
  [`docs/runbooks/packaged-plugin-e2e.md`](docs/runbooks/packaged-plugin-e2e.md).

## In flight

- **Start here:** [`docs/handoff/next-session.md`](docs/handoff/next-session.md), then #187.
- Cloud lanes build in parallel while the owner travels. Protocol:
  [`docs/cloud/runbook.md`](docs/cloud/runbook.md). Shared state: #187.
- Gate 4: #189's answer names six screens against a record of nine, so no decision row
  is written and step 9 and wave 4 wait. Record: `docs/design/gate4/`.
- D-55 (#211/#223/#226) landed: `claude[bot]` merge gate, `issue_comment` trigger
  dropped (fork code-exec finding). `claude.yml` follow-up (#227): gh pr
  view/diff/comment grant widened, fork-guarded.

## The next step

1. ADR-0006 steps 6 and 9, then step 10's packaged run; W3-2 onward.
2. Plan steps 6, 6c, 7 (sourcemaps), 8 and 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time (cloud lanes excepted, D-52): every landing edits this file
  and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in `.workspaces/`.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
