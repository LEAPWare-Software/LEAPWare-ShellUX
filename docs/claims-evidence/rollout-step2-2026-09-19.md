# Proof-of-completion rollout, step 2: throwaway-PR cases

Evidence for `docs/proof-of-completion.md` §5 step 2, recorded 2026-09-19. Each case ran
on GitHub Actions against `main` after PR A (#156) landed; the two checks, `Prove claims`
(`claims.yml`) and `PR evidence` (`pr-evidence.yml`), were **not** required checks. Cases
(b) to (k) were `pull_request` runs on throwaway PRs titled "rollout test (do not merge)",
each closed unmerged with its branch deleted. Run ids can be read back with
`gh run view <id> --json name,event,conclusion`.

| Case | What was tried | Expected | Result | `Prove claims` run | `PR evidence` run | Why, from the log |
|---|---|---|---|---|---|---|
| a | both jobs on `merge_group` (PR #156 through the queue) | both report | both succeeded | 35421034443 | 35421034378 | ref `gh-readonly-queue/main/pr-156-de252c9…` |
| b | tick an item with no `[C-nn]` (#157) | fail | failed | 35421695911 | 35421695937 (passed) | 0 `[C-nn]` tags on a ticked item |
| c | cite a row whose `box` differs (#158) | fail | failed | 35421902172 | passed | C-06 box text is not the item text |
| d | an `expect` key printed 0 times and one printed twice (#159) | fail | failed | 35422123043 | passed | `alpha` printed 0 times, `beta` twice |
| d2 | an `expect` bound exceeded (#161) | fail | failed | 35422220468 | passed | `gamma=10` violates `<= 5` |
| e | a step heading count off by one (#162) | fail | failed | 35422311632 | passed | heading `(5/6)`, items `(6/6)` |
| f | an item reworded without `Items removed or reworded:` (#163) | evidence gate fails | failed | 35422411662 | 35422411665 | the line is missing |
| g | a body with no `## Review` record (#164) | evidence gate fails | failed | passed | 35422496166 | `## Review` missing |
| h | the body of a failing PR edited to add the record (#165) | re-runs on `edited` and passes | fail, then pass | passed | 35422573538 failed, 35422634428 passed | the `edited` event re-ran the gate |
| i | a `repo` row whose check calls the network, beside a tree-only row (#166) | network row fails, tree row passes, Node matches `.nvmrc` | as expected | 35422780283 | passed | fetch refused under `unshare --net`; Node 24.20.0, as `.nvmrc` declares |
| j | a task item with a non-breaking space after the checkbox (#167) | fail as ambiguous | failed | 35422925481 | passed | the raw scan and remark disagree |
| k | `claims.yml` changed without `Gate changes:` (#168) | evidence gate fails | failed | passed | 35423036084 | `Gate changes:` did not name `claims.yml` |

**Not yet shown here:** case (l), a two-entry merge-queue group passing both jobs. It is
recorded by the change that follows this one, which is queued together with another PR
for that purpose.

One operator slip, not a tooling defect: case (d)'s first body omitted the new check
script from `Gate changes:`, the gate failed for that reason, and the body was corrected.
