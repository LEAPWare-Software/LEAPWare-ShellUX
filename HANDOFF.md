# HANDOFF — LEAPWare ShellUX

The transition only. Capped at 3000 bytes. Re-derive every SHA and count with `git`
and `gh` before trusting it. **Citations of "HANDOFF §0" to "§12" elsewhere in this
repository refer to [`docs/history/handoff-archive-2026-08.md`](docs/history/handoff-archive-2026-08.md).**

## Where main is

`main` at `1237aee` (#176, 2026-09-19). Mission: a best-in-class UI/UX shell hosting
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
- This change: the `.lwplugin` validator (ADR-0006 step 3).

## In flight

- **Proof of completion, PR B** (plan step 0c item 5): make both checks required.

## The next step

1. Roll the protocol out step by step (§5), then PR B makes both checks required.
2. ADR-0006 steps 2 to 11 (runtime plugin host); wave 3 continues after the split.
3. Plan steps 5 to 9; the 1.0 tag waits for BuildCraft.

## The rules that bite

- **v1.0.0 waits for LEAPWare BuildCraft** (D-39): readiness bar R1 to R7 in
  [`docs/sdlc.md`](docs/sdlc.md). There is no 1.0 date.
- Steps run one at a time: every landing edits this file and `CHANGELOG.md`.
- Merge with `gh pr merge <n> --squash --auto`; it enters the queue.
- One git writer in the main tree. Throwaway worktrees go in a `.workspaces/`
  directory beside the repository.
- Use npm 11.16.0 (`packageManager`). See `docs/traps.md` for the npm 10 history.
