# Proof-of-completion rollout, step 3: main runs, a forced failing row, a forced crash

Evidence for `docs/proof-of-completion.md` §5 step 3, recorded 2026-09-19. The forcing
harness is `claims.yml`'s `workflow_dispatch` input `inject` (#173). Every run below is on
`main`; run ids read back with `gh run view <id> --json conclusion,jobs`.

| Step | Run | Event | Result |
|---|---|---|---|
| green main run 1 | 35421271000 | push (#156) | success |
| green main run 2 | 35422494969 | push (#160) | success |
| green main run 3 | 35424386634 | push (#169, #170) | success |
| forced failing row | 35427314752 | workflow_dispatch, `inject=failing-row` | "Prove claims (dispatch)" success with synthetic row `S-injected` failed; "File the claims failure" success: it filed issue #174, authored by `app/github-actions`, body "Claims run failed (failing: S-injected)" |
| forced crash | 35427454734 | workflow_dispatch, `inject=crash` | "Prove claims (dispatch)" failure; "File the claims failure" success: it commented on #174 "Claims run failed (the Prove claims job failed)" |
| clean run | 35427580893 | workflow_dispatch, `inject=none` | success |

`npm run status` on `main` (78a69f6), read at each point:

```text
after the crash:      reference run: 35427454734 (failure, 2026-09-19T06:45:36Z)
                      summary: FAILING 28, MANUAL 2
after the clean run:  reference run: 35427580893 (success, 2026-09-19T06:48:48Z)
                      summary: PASSING 28, MANUAL 2
```

The two `MANUAL` rows are dated evidence rows, which a run never re-proves, so a failed
run does not change them. Issue #174 is no longer open; the comment that ended it, posted by the
CTO agent, says it was the harness and that no real claim failed.
