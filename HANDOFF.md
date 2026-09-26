# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `5a02392` (#233, 2026-09-26). Mission (D-31) and rules: `CLAUDE.md`. Plan:
[`docs/plans/v1-production.md`](docs/plans/v1-production.md). Decisions:
[`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public (Apache-2.0);
`main` is protected by the ruleset in `.github/rulesets/main.json`, with a merge queue.

## What landed on 2026-09-18 through 2026-09-26

`git log --oneline` is the full list; the landmarks:
- Public, ruleset/merge queue (#141); Claude review working (#151); ADR-0006
  Accepted (#145); proof of completion adopted (D-50), then complete (#181, C-37).
- Plugin store, step 4 (#182); wave-3 W3-1 primitives (#184); lifecycle/
  nav/badge clear (#185); proof rows C-38–C-43. Cloud lanes can merge (#192);
  runbook/`lw-*`/gate-4 record (#188, D-52). Proof audit corrected (0e);
  D-27 struck, superseded by D-34 (C-44).
- Steps 7-8 (#217/#57): plugins in `plugins/*`; `plugin:check` + CI. Step 11
  (#222): Release-URL source, org allowlist. Step 10 prep, owner/VM:
  [`docs/runbooks/packaged-plugin-e2e.md`](docs/runbooks/packaged-plugin-e2e.md).
- Plan lines 129/133/131: `SECURITY.md`/README reorder; #74/#103 evidence
  (C-49). Step 8 items 2-5 (#233): publish provider/D-34, `release.yml`/D-26,
  guardrail wording, C-50–C-53; items 1, 6 open.

## In flight

- **Start here:** [`docs/handoff/next-session.md`](docs/handoff/next-session.md), then #187.
- Cloud lanes build in parallel while the owner travels
  (`docs/cloud/runbook.md`); shared state: #187.
- Gate 4: #189's answer names six screens against a record of nine, no
  decision row written yet; step 9/wave 4 wait (`docs/design/gate4/`).
- D-55 (#211/#223/#226) landed: `claude[bot]` merge gate, `issue_comment`
  trigger dropped (fork code-exec finding); `claude.yml` follow-up (#227)
  widened gh pr view/diff/comment, fork-guarded.
- D-56 (#172, PR #236 open): `validateText` hardened, all 7 display fields;
  `HOST_API_VERSION` 1.1→2.0. Bidi isolation filed (#235). PR #195 (D-54,
  #183) stays frozen on the unanswered #213.

## The next step

1. ADR-0006 steps 6, 9, step 10's packaged run; W3-2 onward.
2. Plan steps 6, 6c, 7 (sourcemaps), 8, 9; 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1-R7 in
  [`docs/sdlc.md`](docs/sdlc.md). No 1.0 date.
- Steps run one at a time (cloud lanes excepted, D-52): every landing edits
  this file and `CHANGELOG.md`.
- Merge via CCR auto-merge route (not `gh pr merge`, GraphQL, blocked).
- One git writer in main; throwaway worktrees in `.workspaces/`.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
