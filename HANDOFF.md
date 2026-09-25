# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `372a3e9` (#217, 2026-09-24). Mission (D-31) and rules: `CLAUDE.md`. Plan:
[`docs/plans/v1-production.md`](docs/plans/v1-production.md). Decisions:
[`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public (Apache-2.0);
`main` is protected by the ruleset in `.github/rulesets/main.json`, with a merge queue.

## What landed on 2026-09-18 and 19

`git log --oneline` is the full list; the landmarks:
- Public, ruleset/merge queue (#141); Claude review working (#151).
- Proof of completion: design (#152, D-50), PR A (#156), rollout 2 (#169).
- ADR-0006 Accepted (#145); steps 1 CSP (#154), 2 SDK (#170).
- Charts (#148), crash log (#150), ShellLayout split (#160).
- Rollout step 2 (#171, C-30); step 3 harness (#173); step 0c item 4 (#175, C-31).
- #23 re-fit (W3-0), the wave-3 plan (#176); `.lwplugin` validator (#177).
- Operator install guide, 1.0 known limits, plan step 7 (#178).
- PR B (#179): both proof-of-completion checks required, read back
- Plan step 0c complete (#181, C-37).
- The plugin store, ADR-0006 step 4 (#182).
- Wave-3 W3-1 state primitives (#184); plugin lifecycle/nav tree/badge clear (#185);
  proof rows C-38–C-43 (#186).
- Cloud lanes can merge (#192, lane C item 0a); the runbook, `lw-*` roles and
  gate-4 record (#188, D-52).
- Proof audit corrected, `npm run status` falls back locally (0e); D-27 struck,
  superseded by D-34 (C-44).
- ADR-0006 steps 7 (#217) and 8 (#57): plugins moved to `plugins/*`; `plugin:check` kit + CI job.
- ADR-0006 step 11: Release-URL source, org allowlist.

## In flight

- **Start here:** [`docs/handoff/next-session.md`](docs/handoff/next-session.md), then #187.
- Cloud lanes build in parallel while the owner travels. Protocol:
  [`docs/cloud/runbook.md`](docs/cloud/runbook.md). Shared state: #187.
- Gate 4: #189's answer names six screens against a record of nine, so no decision row
  is written and step 9 and wave 4 wait. Record: `docs/design/gate4/`.
- D-55 PR A (#211) landed; PR B lands with this PR: the `claude[bot]` merge gate, its `issue_comment` trigger dropped (fork code-execution finding, D-55).

## The next step

1. ADR-0006 step 6, 9-10; W3-2 onward.
2. Plan steps 6, 6c, 7 (sourcemaps), 8 and 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time (cloud lanes excepted, D-52): every landing edits this file
  and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in `.workspaces/`.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
