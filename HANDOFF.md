# HANDOFF — LEAPWare ShellUX

Last updated 2026-08-01, after the second wave of audits. Read this before touching
anything. Correct anything you find stale, but do not delete a finding without checking
it.

---

## 0. Keeping this document true

**This file is updated and merged after every landing — not at the end of a session.**
It is a crash-recovery measure. A previous session crashed and lost its entire context,
and this document is the only thing that survives that.

The rules:

- **Landing a change without updating this file is an incomplete change**, in exactly
  the sense the quality doctrine treats documentation as part of the change rather than
  a follow-up sweep.
- Anything not yet merged goes in **§1 Currently in flight**, with: what it is, which
  branch or agent owns it, what state it reached, and what is left. That section is
  **rewritten every time something lands**, and it is the first thing a resuming session
  should read.
- **The counts here go stale within hours.** Issue numbers, test counts, SHAs and
  milestone totals all move while agents file concurrently. A resuming session should
  **re-derive them** — `git fetch --all --prune`, `gh issue list`, `gh pr list`, the
  milestone endpoint — rather than trusting them. **The numbers in this document are a
  starting point, not a source of truth.**

---

## 1. Currently in flight

Verified directly against the repository and the worktrees at the time of writing.

### Browser test lane — `browser-test-lane` — **committed and pushed, not merged**

- Commit `da7d89e`, pushed to `origin/browser-test-lane`. **No PR open for it yet.**
- Adds `playwright.config.ts`, an `e2e/` suite, `dev.html`, `.github/workflows/browser.yml`,
  and **`src/dev/DevShell.tsx` + `src/dev/main.dev.tsx` — now tracked for the first time**.
- `src/dev/DevShell.tsx` is the file that makes `npm run dev` render a working shell. It
  was the CPO review's single highest-value, lowest-effort item. **Merging this branch is
  what unblocks anyone evaluating the product at all.**
- Adds `@playwright/test` and a `test:browser` script that is **deliberately outside
  `verify`**, so the `npm ci && npm run verify` fresh-clone promise stays literally true.
  Confirmed: `verify` does not chain `test:browser`.
- **It is based on `868fe88`, not on current `origin/main`.** It therefore does not
  contain this file. Merge main into it, or rebase, before opening the PR.

### Quality-first working agreement — `quality-first-agreement` — **NOT committed**

- Worktree at branch `quality-first-agreement`, HEAD `edc29db` (behind `origin/main`).
- Staged but uncommitted: **`CLAUDE.md` (new)** and
  **`docs/adr/0003-quality-over-velocity.md` (new)**, plus modified `CONTRIBUTING.md` and
  `.github/PULL_REQUEST_TEMPLATE.md`.
- `npm run verify` has passed end to end on it, exit 0.
- Held by its author to substantiate or remove one unevidenced sentence about a
  whole-suite shuffle.
- **Until this lands, the quality doctrine lives only in §9 of this file.** Neither file
  exists on any pushed branch — re-checked across every remote ref.

### Working-tree discipline

The shared working tree has been held by different agents on different branches through
the session. **One working tree, one git writer.** A commit already landed on the wrong
branch once because this was violated. Use `git worktree add` for anything concurrent;
this update was written in a throwaway worktree for exactly that reason.

---

## 2. Where we are

LEAPWare ShellUX is a pluggable desktop UI shell host. All five originally planned work
items (ISSUE-001 through ISSUE-005) are built and merged. A full audit on 2026-08-01
found the result **is not production-ready**; the next phase is remediation, tracked in
the milestone **Phase 2 — Production Readiness**.

---

## 3. Repository state

Verified 2026-08-01 after `git fetch --all --prune`.

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `03615e1` | Head. |
| `origin/browser-test-lane` | `da7d89e` | **In flight — see §1.** Based on `868fe88`. |
| local `main` | `e504fd3` | **STALE — well behind `origin/main`.** |
| `origin/phase-1-hotkeys` | `a1df19d` | Merged content; branch not deleted. |
| `origin/phase-2-shell` | `b80cad0` | Merged via PR #33. |
| `origin/docs-security-sweep` | `4509c38` | Merged via PR #56. |
| `quality-first-agreement` | `edc29db` | **Local only, uncommitted work — see §1.** |
| 5 `dependabot/*` remotes | — | PRs #34–#38, all open. #35 and #38 cross a major. |

> **FIRST ACTION for a new session:** `git checkout main && git pull --ff-only`.
> Local `main` at `e504fd3` predates the shell merge — a tree checked out there has **no
> `src/components/`** at all. Several confusing "the file does not exist" reports trace
> back to exactly this.

---

## 4. THE SINGLE MOST IMPORTANT FINDING

The CPO review found the incoherence sitting underneath every other finding:

> **The architecture is priced for a third-party extension ecosystem it has no way to
> serve.**

ADR-0001 requires that extensions come from third parties, shipped without host review —
and then correctly rejects the only delivery mechanism that would make that true. So
deep-freezing, host-owned normalisation and hostile-payload validation are all paid for
by a threat model whose subject **cannot ship**. Meanwhile the actual named consumers —
first-party LEAPWare modules — would be better served by a contract half as defensive.

### The blocking decision

**Are third parties real customers in the next 12 months?**

| Answer | Consequence |
|---|---|
| **No** | Delete the third-party threat model. Halve `DEVELOPER.md`. Stop paying for hostile-payload defence. |
| **Yes** | Versioning and distribution become P0, and the current ADR **cannot stand**. |

**Nothing else should be built until this is answered.** It changes what half the
repository needs to be, and every documentation issue in the tracker inherits its scope
from the answer.

---

## 5. THE ENFORCEMENT GAP

This is not a code finding and no commit fixes it. It is the reason the quality doctrine
in §9 has nowhere to attach.

**Branch protection is impossible on this repository, not merely unconfigured.**
**[reproduced]** — both endpoints return **403**:

| Call | Result |
|---|---|
| `GET /repos/.../branches/main/protection` | 403 — "Upgrade to GitHub Pro or make this repository public to enable this feature." |
| `GET /repos/.../rulesets` | 403 — same message |

The repository is **private**, **organisation-owned**, on the **free plan**
(`private: true`, `plan: null`). Consequences, all confirmed:

- **No status check has ever been required.** The green CI legs are advisory.
- **No review has ever been required.** Every merged PR — #6, #33, #56, #69 — has empty
  `reviewDecision` and `reviews: []`. **[reproduced]**
- **PR #33 was +25,796 / −675 across 65 files, authored and merged by the same account,
  with zero reviews.** **[reproduced]**
- The PR template's "paste the real verify output" checkbox is the **only** thing
  standing behind the four stages CI does not run (§12) — and it is self-attested by the
  author who then merges.

**`CODEOWNERS` is inert twice over.** **[reproduced]** Its entire content is `* @LEAPWare-HQ`,
which is the sole author of every PR, and GitHub never requests review from a PR's own
author. Code-owner review also requires branch protection, which is 403.

**The fix is a plan change or making the repository public. It is not code.** Decide it
alongside §4.

---

## 6. Audit findings

Nine audits have now run: architecture, code correctness, security, test quality,
production readiness, repo/CI, deferrals, CPO, plus a second wave covering enforcement
and test integrity. Each finding is tagged **[reproduced]** where confirmed by execution,
or **[reasoned]** / **[reported]** where it was not re-run here.

### 6.1 Data-destroying — Blocker

| Finding | Location | |
|---|---|---|
| Collapsing and re-expanding pane 1 discards the user's layout and persists an **internally inconsistent** record. Measured percentages `40/36/40` sum to 116%. | `ShellLayout.tsx:731` | **[reproduced]** |
| `hasRestoredLayout` is a false sentinel inferred from object identity, so **any** persisted write discards the pixel-intent table permanently. At 1920px viewport the nav pane opens 38% wrong. | `ShellLayout.tsx:733-736` | **[reproduced]** |

### 6.2 Security

- `SHELL_UX_ERROR_CODES` (`types.ts:770`) is **not frozen**. Shadowing `.has` lets a
  plug-in choose the error code `register()` returns, including masquerading as
  `REVOKED`. This falsifies a claim `SECURITY.md` labels an *unconditional* integrity
  control. **[reproduced]**
- `HYDRATION_LIMITS` (`HydrationEngine.ts:211`) is `as const`, not frozen — the exact
  defect issue #10 closed for `REGISTRY_LIMITS`, reintroduced. **[reproduced]**
- **Fix both together**, and replace the hand-maintained freeze list in
  `hostConstants.test.ts` with a test that walks the module's own exports. A
  hand-maintained list is how the second one got in.
- **CI never audits the dev tree.** `audit:prod` is `npm audit --omit=dev`, and both
  audit workflows run only that script. Two critical CVEs in `vitest` (CVSS 9.8,
  arbitrary file read/execute) are therefore **structurally invisible** to CI.
  **[reproduced — workflow files inspected]**
- **There is no working way to report a vulnerability. Blocker.** **[reproduced]**
  `SECURITY.md:267-269` instructs reporters to use the Security tab's "Report a
  vulnerability". Private vulnerability reporting is a **public-repository feature**:
  `security_and_analysis` is `null` and `GET /security-advisories` returns **404**.
  `.github/ISSUE_TEMPLATE/config.yml` deliberately carries no `contact_links` — to
  satisfy the `hardcoded-hostname` portability rule — and documents that choice at
  length. `SECURITY.md:275` then falls back to "say so through the private channel you
  *do* have", **which it never names anywhere**. The instruction is circular and there is
  no route in. Same root cause as §5: the repository is private on a free plan.

### 6.3 Production readiness

- **No runtime plug-in delivery exists at all.** Nothing on `window`, no manifest fetch,
  no dynamic import. The model is compile-time only — deploying today means deploying an
  empty frame. **[reproduced]**
- **No top-level error boundary.** Any throw above `ShellLayout` is a white screen.
  **[reproduced]**
- `dist/index.html` uses absolute asset paths with no `base` configured — 404s on any
  subpath deployment. **[reproduced]**
- No observability, no sourcemaps, no deploy story. **[reasoned]**
- **No declared browser target.** The bundle ships `Object.hasOwn`, which breaks Safari
  14–15.3 silently. **[reasoned]**

### 6.4 Correctness

- `DatabasePlugin` declares `icon` keys and never uses them, so issue #19's "C A C"
  collapsed-rail bug is **still live in the extension** while the host fix and its
  documentation both say it is closed. **[reproduced]**
- `describeHotkey` has **zero production callers**, yet two documents claim it is the
  ribbon tooltip. Consequence: **no sighted user can discover that any keyboard shortcut
  exists.** **[reproduced]**
- `ShellStateStore.subscribe` does not validate its argument, while the banner above it
  claims every member does. One `undefined` callback wedges every subsequent write.
  **[reproduced]**
- `DEVELOPER.md:1849` tells extension authors that a containment guarantee does not exist
  when it does — and contradicts itself about 500 lines earlier. **[reproduced]**

### 6.5 Test integrity

**The coverage number is real but narrower than it reads, and the mutation result is
genuinely good. Both halves matter.**

- The 100% gate is measured over roughly **72% of tracked source** — the audit measured
  9,733 of 13,484 lines. The mechanism is **[reproduced]**: `vitest.config.ts` scopes
  coverage `include` to `src/core/**`, `src/components/**` and `src/hooks/**` only.
  Everything else is outside the gate — `src/mocks/**` (**1,909 lines, measured**),
  `src/App.tsx` + `src/main.tsx` (**55 lines, measured**), and both gate scripts
  (`check-citations.mjs` 918 + `check-portability.mjs` 869 = **1,787 lines, measured**).
  The audit's three component figures reproduce exactly; the 9,733/13,484 ratio itself
  is **[reported]** and was not re-derived.
- **Say the good half too:** inside that 72%, mutation testing killed **18 of 19** valid
  mutants, and the one survivor is an *equivalent* mutant — unreachable behind a
  `DUPLICATE_HOTKEY` invariant. **The logic is genuinely well tested.** **[reported]**
- **What is uncovered is the presentation layer — which is exactly where both
  data-destroying defects in §6.1 lived.** That is the finding, not the percentage.

**Two confirmed vacuous tests.** Both re-verified here by mutation:

| Test | Mutation applied | Result |
|---|---|---|
| `ShellLayout.test.tsx:476` — the collapse-during-divider-drag case | Deleted all three `fireEvent.pointer*` lines | **39/39 still pass.** The assertions only check track width, separator count and pane sum, none of which the drag touches. **[reproduced]** |
| `IntegrationSuite.test.tsx:973` — the badge-timer case | Emptied the `setInterval` body at `DatabasePlugin.tsx:645` | **Still passes.** Both assertions are shape-only regexes, and one reads the value captured *before* the clock advanced. **[reproduced]** |

`IntegrationSuite.test.tsx:1300` fires the identical pointer sequence as the first one
and **correctly titles it as impossible in this jsdom**. Two files, same mechanism,
opposite claims. Whichever is right, they cannot both be.

### 6.6 `check-citations` has a hole that makes it partly ornamental

**[reproduced]** — measured with the checker's own exported functions.

`patternFor` compiles a parameterised title to a regex. **When the placeholder is the
final token, the regex degenerates to a prefix match**: a title of the form
`rejects <placeholder>` compiles to a pattern matching any title beginning with those
words.

Measured against the current suite (31 test files, 981 title entries, 1,704 concrete
titles):

| Parameterised title | Concrete titles it also matches |
|---|---|
| the `rejects` one | 40 |
| the `accepts` one | 23 |
| the `discards` one | 8 |

**17 currently-cited titles are shadowed by a trailing-placeholder pattern — rename any
of them and the gate stays green.** (The audit reported 18; my independent count is 17.
The one-title difference is not worth chasing; the mechanism and the order of magnitude
agree, and the fix is the same either way.)

**But this is a loaded gun, not a live wound.** Also measured: of 357 distinct cited
titles, **348 resolve exactly** and **0 resolve only via a regex**. Nothing today depends
on the hole. Fix it before that stops being true. The checker's own test aimed at this
risk **cannot exhibit it**, because its fixture has a long literal tail.

### 6.7 Product

- `VirtualizedList` — 1,441 lines, **zero consumers**, not even the 280-row inventory
  mock. **[reproduced]**
- Roughly **4,700 lines of meta-tooling** that checks the repository about itself, versus
  **0 lines** persisting the user's place in their work. **[reasoned — approximate]**
- The shell restores how wide you dragged the dividers, and forgets which folder you were
  in. The persisted `extensions` scope is **permanently empty**, because no `IShellAPI`
  member persists anything into it. **[reproduced]**

### 6.8 Silent debts with no owner

- ADR §5 (lazy loading) is flagged "decision only" and **no work item names it anywhere**.
- Six of nine `PINS A KNOWN LIMIT` entries say "no issue filed", verbatim.
- The `unregister` ownership model is said to need "its own issue and threat model" in
  **four** separate places. No such issue exists.

### 6.9 Corrections to earlier findings — do not act on the originals

- **The `shellApi.test.ts` order-dependence claim does not reproduce.** Reported by an
  early audit; since tested independently three times, including twice here under
  `--sequence.shuffle` with different seeds. **109/109 passed every time.**
  **Downgraded to: reported, not reproduced — do not act without a failing seed.**
  Issue #64 already records that the reported order-dependence does not reproduce; keep
  it that way. **[reproduced — the non-reproduction, that is]**

---

## 7. Issue tracker state

Counts verified 2026-08-01. **See §0 — re-derive these, do not trust them.**

- Milestone 1 — **Phase 2 — Production Readiness**: **35 open**, 0 closed.
- **46 issues open in total.** So **11 open issues — #58 through #68 — are NOT attached
  to the milestone.** They were filed after it was created. **Sweep them on.**
- 14 issues closed. 5 PRs open, all Dependabot dev-dependency bumps (#34–#38).

| Group | Issues |
|---|---|
| **BLOCKER** | **#39 — nobody has ever run the app.** Plus two blockers with no issue yet: §5 enforcement, and §6.2 vulnerability reporting. **File both.** |
| RESEARCH / DECISION | #68 (versioning mechanisms conflict), #67 (theming), #65 (build a real first-party module) |
| CORRECTNESS | #10, #16, #17, #20, #21, #22, #23, #24, #25, #26, #64 |
| CONTRACT | #28, #29, #30, #31, #32, #57, #66 |
| TESTING | #40, #42, #59, #60, #61, #62, #63 |
| DOCS | #4, #27, #41, #43, #44, #45, #46, #47, #48, #49, #50, #51, #52, #53, #54, #55 |
| TOOLING / CI | #58 (CI does not run all of `verify`), #62 |
| DEFERRED | #29 and #31 carry prior-art analysis whose scope depends entirely on §4 |

Grouping is editorial, assigned from issue titles. The tracker's only labels are
`bug` / `enhancement` / `documentation` / `question`, so **this taxonomy exists nowhere
but this file.** Creating the labels would be cheap and would make it survive.

---

## 8. Recommended sequence

Cheap and high-value first; and the decisions gate everything downstream.

| # | Work | Why here |
|---|---|---|
| 1 | **Answer §4: are third parties real customers in the next 12 months?** | It decides whether roughly half the open documentation and contract issues are worth doing at all. Doing them first risks polishing work the answer deletes. |
| 2 | **Answer §5: pay for the plan tier that allows branch protection, or make the repository public?** | Until one of those, no doctrine in §9 can be *enforced* — only asked for. It also unblocks §6.2, which shares the root cause. |
| 3 | **Merge `browser-test-lane`** (`da7d89e`) — rebase onto `origin/main` first | Lands `src/dev/DevShell.tsx`. Until then nobody can run the product, nothing can be validated by a human, and #39 — the sole tracked Blocker — cannot even be started. |
| 4 | **The two layout defects** (`ShellLayout.tsx:731`, `:733-736`) | The only findings that destroy user data. Both reproduced. Both small. |
| 5 | **The two `Object.freeze` lines** (`types.ts:770`, `HydrationEngine.ts:211`) | Two lines each. One makes a live `SECURITY.md` claim false. Add the exports-walking test in the same change so it cannot regress a third time. |
| 6 | **Root error boundary** | One component. Turns every unhandled throw from a white screen into something diagnosable — which every later step benefits from. |
| 7 | **Land `quality-first-agreement`** | Cheap, already verified green, and it is what §9 should point at instead of restating. |
| 8 | Fix the two vacuous tests and the `patternFor` hole | §6.5 and §6.6. Do it before the hole is load-bearing. |
| 9 | Everything else, by milestone priority | — |

---

## 9. The quality doctrine

**As of `03615e1`, `docs/adr/0003-quality-over-velocity.md` and the repo-root `CLAUDE.md`
still do not exist on any pushed branch** — re-checked across every remote ref. They are
written and staged but uncommitted on `quality-first-agreement`; see §1. **Once that
lands, replace this section with a pointer to those two files.**

Until then, the doctrine to apply:

> **Review precedes merge. Never follows it.**

The review loop:

1. Severity rubric: **Blocker / High / Medium / Low**.
2. Terminate on a **clean round** — not on zero findings.
3. A **different reviewer every round**.
4. Findings **must trend down** round over round.
5. Cap at **three non-converging rounds**; escalate rather than loop.

Read this next to §5: today none of it is enforceable by the platform. It holds only
because people choose to hold it.

---

## 10. The scrum-master role for the next session

One session owns delivery. Concretely, that role:

- **Owns the milestone.** Keeps issues attached, keeps the grouping current, closes what
  is genuinely done.
- **Owns this file.** Updates §1 on every landing — see §0.
- **Runs the review loop** in §9, and enforces the different-reviewer rule.
- **Assigns severity by the rubric**, not by whoever filed it loudest.
- **Has explicit authority to refuse a merge**, including their own agents' work. In the
  absence of branch protection (§5) this authority is the *only* gate that exists.
- **Reports progress against the milestone, not against activity.** "Six issues closed of
  35" is a report. "Four agents dispatched" is not.

---

## 11. Traps — things that have already cost time

| Trap | What it costs |
|---|---|
| **jsdom has no layout engine.** No `PointerEvent`, no `ResizeObserver`, no `scrollIntoView`; `getBoundingClientRect` returns 0×0. | **Two shipped defects passed fully green suites** because of this. A green suite is not evidence about geometry. |
| **A green test is not a test.** Two confirmed vacuous cases in §6.5. Before trusting one, delete the line it is supposedly about and watch it fail. | Two tests bought nothing for months. |
| **`Object.freeze` on a `Set` does not stop `.add()`.** | Freezing the wrong container reads as a control and is not one. |
| **The linking parser matches a closing keyword inside a sentence saying the opposite.** | It auto-closed an issue here. Keep every closing keyword away from every issue reference unless you mean it. |
| **Two agents doing git operations in one working tree** | Put a commit on the wrong branch. **One working tree, one git writer.** Use `git worktree add`. |
| **`check-citations` trailing-placeholder prefix match** | See §6.6. A short citation can resolve *vacuously*. Green does not mean cited. |
| **`ISSUE-00N` (manifest) versus `#N` (GitHub) collide** | A phantom `ISSUE-006` is cited 31 times across 12 files with no manifest section defining it. Tracked as #53. |
| **Memory exhaustion on this 8GB machine** | `test:coverage` was OOM-killed twice under concurrent load. **Limit concurrency.** |
| **A partial `npm install` produces *fake* failures.** A truncated `ajv` file and a missing `lib.es2022.d.ts` surfaced as bogus lint crashes and **13 phantom TypeScript errors**. | A new maintainer would reasonably file those as defects. **Suspect the environment before the code when failures look structural.** Reinstall, then re-run, before believing them. |

---

## 12. How to verify anything

`npm run verify` chains **nine** stages, in order:

`check:portability` → `check:citations` → `lint` → `typecheck` → `test:coverage` →
`test:integration` → `test:scripts` → `build` → `audit:prod`

**It takes roughly 12–13 minutes**, dominated by `test:coverage` (~351s) and
`test:integration` (~199s) — **and those two overlap**, because `IntegrationSuite.test.tsx`
runs in both. **[reported]** Worth knowing, because "run verify before every commit" is
the doctrine and its cost should be stated rather than discovered.

**CI does not run all of them.** Inspected at `03615e1`:

| Stage | On CI? |
|---|---|
| `check:portability` | yes (`ci.yml`) |
| `check:citations` | **no leg** |
| `lint` | yes |
| `typecheck` | yes |
| `test:coverage` | yes |
| `test:integration` | **no leg** |
| `test:scripts` | **no leg** |
| `build` | yes |
| `audit:prod` | yes, but only in `audit-dependencies.yml` / `audit-schedule.yml`, and only with `--omit=dev` |

`README.md` claims `verify` is exactly what CI applies. It is not — five of nine.
Tracked as #58. Read this next to §5: the four unguarded stages are backed only by an
author's self-attestation on a PR nobody is required to review.

Two checks gate every commit and are easy to trip:

- **`check:portability`** — no absolute paths, no drive letters, no home or scratch
  directories, LF endings only, no BOM, no hardcoded network host in a tracked
  non-Markdown file.
- **`check:citations`** — never quote a test title you have not confirmed exists. It only
  inspects quoted strings that follow a citation marker, and see §6.6 for what it will
  miss even then.
