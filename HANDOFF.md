# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `7a8eb67` (#151, 2026-09-19). Mission: a best-in-class UI/UX shell hosting
application plugins (D-31). Plan: [`docs/plans/v1-production.md`](docs/plans/v1-production.md).
Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). The repository is public
(Apache-2.0); `main` is protected by the ruleset in `.github/rulesets/main.json`,
with a merge queue.

## What landed on 2026-09-18 and 19

- #115 (wave 1), #126 (audit), #128 (mission recast, gate 3), #141 (public-release
  scaffolding), #143 (an npm claim corrected), #144 (Claude Actions, guarded).
- #145: ADR-0006 Accepted, with ADR-0001 Amendment P (D-46 to D-48).
- #147: the Claude review job gets the tools it needs to comment (D-49).
- #148: charts repaired (#112, #113; #111 addressed); #146 filed.
- #149: the review job may launch its subagents.
- #150: crash diagnostics log (#86, in part) and the Chromium build target (#85).
- #151: the Claude review is a direct prompt that must post a summary.
- This change: the proof-of-completion design (D-50); milestones v1.0.0 and 1.1 (D-51).

## In flight

- **Proof of completion, PR A** (plan step 0c): register, linters, status report and
  workflows, being built in `feat/proof-of-completion-pr-a`.

## The next step

1. Prove the review job comments (this PR is its first run as a direct prompt).
2. Build the protocol (its PR A), then roll it out step by step.
3. Plan steps 3b to 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time: every landing edits this file and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
