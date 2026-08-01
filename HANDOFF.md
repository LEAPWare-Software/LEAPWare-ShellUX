# HANDOFF — LEAPWare ShellUX

Written 2026-08-01, immediately after the full audit. Read this before touching anything.
Speed was prioritised over polish; correct anything you find stale, but do not delete a
finding without checking it.

---

## 1. Where we are

LEAPWare ShellUX is a pluggable desktop UI shell host. All five originally planned work
items (ISSUE-001 through ISSUE-005) are built and merged. A full audit on 2026-08-01
found the result **is not production-ready**; the next phase is remediation, tracked in
the milestone **Phase 2 — Production Readiness**.

---

## 2. Repository state

Verified 2026-08-01 after `git fetch --all --prune`.

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `868fe88` | Head. Merge of PR #56. |
| local `main` | `e504fd3` | **STALE — 12 behind `origin/main`.** |
| `origin/phase-1-hotkeys` | `a1df19d` | Merged content; branch not deleted. |
| `origin/phase-2-shell` | `b80cad0` | Merged via PR #33. |
| `origin/docs-security-sweep` | `4509c38` | Merged via PR #56. |
| local `quality-first-agreement` | `edc29db` | 2 behind `origin/main`; checked out in a separate worktree. |
| local `browser-test-lane` | `868fe88` | **Carries uncommitted, staged work — see below.** |
| 5 `dependabot/*` remotes | — | PRs #34–#38, all open. |

> **FIRST ACTION for a new session:** `git checkout main && git pull --ff-only`.
> Local `main` at `e504fd3` predates the shell merge — a tree checked out there has **no
> `src/components/`** at all. Several confusing "the file does not exist" reports trace
> back to exactly this.

### Work in flight — do not clobber

At the time of writing, the primary working tree is on `browser-test-lane` with staged
but uncommitted changes: a Playwright config, an `e2e/` suite (5 specs plus a helper), a
browser CI workflow, `dev.html`, and **`src/dev/DevShell.tsx` + `src/dev/main.dev.tsx`
staged for the first time**. If that branch has since landed, the "DevShell is untracked"
finding in §4 is resolved — check before re-filing it.

---

## 3. THE SINGLE MOST IMPORTANT FINDING

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

## 4. Audit findings

Seven audits ran: architecture, code correctness, security, test quality, production
readiness, repo/CI, deferrals, and the CPO review. Headline findings below. Each is
marked **[reproduced]** where it was confirmed by execution, or **[reasoned]** where it
was derived from reading and has not been run.

### 4.1 Data-destroying — Blocker

| Finding | Location | Evidence |
|---|---|---|
| Collapsing and re-expanding pane 1 discards the user's layout and persists an **internally inconsistent** record. Measured percentages `40/36/40` sum to 116%. | `ShellLayout.tsx:731` | **[reproduced]** |
| `hasRestoredLayout` is a false sentinel inferred from object identity, so **any** persisted write discards the pixel-intent table permanently. At 1920px viewport the nav pane opens 38% wrong. | `ShellLayout.tsx:733-736` | **[reproduced]** |

### 4.2 Security — two one-line fixes

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

### 4.3 Production readiness

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

### 4.4 Correctness

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

### 4.5 Product

- `VirtualizedList` — 1,441 lines, **zero consumers**, not even the 280-row inventory
  mock. **[reproduced]**
- Roughly **4,700 lines of meta-tooling** that checks the repository about itself, versus
  **0 lines** persisting the user's place in their work. **[reasoned — line counts
  approximate]**
- The shell restores how wide you dragged the dividers, and forgets which folder you were
  in. The persisted `extensions` scope is **permanently empty**, because no `IShellAPI`
  member persists anything into it. **[reproduced]**
- `src/dev/DevShell.tsx` — the file that registers the mocks and produces a working shell
  — was **untracked**, so `npm run dev` rendered an empty frame and nobody could evaluate
  the product. It is staged on `browser-test-lane` as of this writing; confirm before
  acting.

### 4.6 Silent debts with no owner

- ADR §5 (lazy loading) is flagged "decision only" and **no work item names it anywhere**.
- Six of nine `PINS A KNOWN LIMIT` entries say "no issue filed", verbatim.
- The `unregister` ownership model is said to need "its own issue and threat model" in
  **four** separate places. No such issue exists.

---

## 5. Issue tracker state

Counts verified 2026-08-01. **They move — several agents have been filing concurrently.
Re-check before relying on them.**

- Milestone 1 — **Phase 2 — Production Readiness**: **35 open**, 0 closed.
- **46 issues open in total.** So **11 open issues (#58–#68) are NOT attached to the
  milestone** — they were filed after it was created. **Sweep them on.**
- 14 issues closed.
- Open PRs: **#34, #35, #36, #37, #38** — all Dependabot dev-dependency bumps.
  Note #35 bumps TypeScript across a major and #38 bumps Tailwind across a major.

| Group | Issues |
|---|---|
| **BLOCKER** | **#39 — nobody has ever run the app** |
| RESEARCH / DECISION | #68 (versioning mechanisms conflict), #67 (theming), #65 (build a real first-party module) |
| CORRECTNESS | #10, #16, #17, #20, #21, #22, #23, #24, #25, #26, #64 |
| CONTRACT | #28, #29, #30, #31, #32, #57, #66 |
| TESTING | #40, #42, #59, #60, #61, #62, #63 |
| DOCS | #4, #27, #41, #43, #44, #45, #46, #47, #48, #49, #50, #51, #52, #53, #54, #55, #58 |
| TOOLING / CI | #58 (CI does not run all of `verify`), #62 |
| DEFERRED | #29 and #31 carry prior-art analysis whose scope depends entirely on the §3 decision |

Grouping is editorial, assigned from issue titles; labels in the tracker are only
`bug` / `enhancement` / `documentation` / `question` and do not encode this.

---

## 6. Recommended sequence

Cheap and high-value first; and the decision gates everything downstream of it.

| # | Work | Why here |
|---|---|---|
| 1 | **Answer §3: are third parties real customers in the next 12 months?** | It decides whether roughly half the open documentation and contract issues are worth doing at all. Doing them first risks polishing work that the answer deletes. |
| 2 | **Commit `src/dev/DevShell.tsx`** (land `browser-test-lane`) | Until this is tracked, nobody can run the product, so nothing can be validated by a human — and #39, the sole Blocker, cannot even be started. |
| 3 | **The two layout defects** (`ShellLayout.tsx:731`, `:733-736`) | The only findings that destroy user data. Both are reproduced. Both are small. |
| 4 | **The two `Object.freeze` lines** (`types.ts:770`, `HydrationEngine.ts:211`) | Two lines each. One of them makes a live `SECURITY.md` claim false. Add the exports-walking test in the same change so it cannot regress a third time. |
| 5 | **Root error boundary** | One component. Converts every unhandled throw from a white screen into something diagnosable — which every later step benefits from. |
| 6 | Everything else, by milestone priority | — |

---

## 7. The quality doctrine

**As of `868fe88`, neither `docs/adr/0003-quality-over-velocity.md` nor a repo-root
`CLAUDE.md` exists on any branch — checked across `origin/main`, `quality-first-agreement`,
`browser-test-lane` and `origin/docs-security-sweep`.** A branch may still be in flight.
Check again before assuming; if still absent, writing them is itself a work item.

The doctrine to apply meanwhile:

> **Review precedes merge. Never follows it.**

The review loop:

1. Severity rubric: **Blocker / High / Medium / Low**.
2. Terminate on a **clean round** — not on zero findings.
3. A **different reviewer every round**.
4. Findings **must trend down** round over round.
5. Cap at **three non-converging rounds**; escalate rather than loop.

---

## 8. The scrum-master role for the next session

One session owns delivery. Concretely, that role:

- **Owns the milestone.** Keeps issues attached, keeps the grouping current, closes what
  is genuinely done.
- **Runs the review loop** in §7, and enforces the different-reviewer rule.
- **Assigns severity by the rubric**, not by whoever filed it loudest.
- **Has explicit authority to refuse a merge**, including their own agents' work.
- **Reports progress against the milestone, not against activity.** "Six issues closed of
  35" is a report. "Four agents dispatched" is not.

---

## 9. Traps — things that have already cost time

| Trap | What it costs |
|---|---|
| **jsdom has no layout engine.** No `PointerEvent`, no `ResizeObserver`, no `scrollIntoView`; `getBoundingClientRect` returns 0×0. | **Two shipped defects passed fully green suites** because of this. A green suite is not evidence about geometry. |
| **`Object.freeze` on a `Set` does not stop `.add()`.** | Freezing the wrong container reads as a control and is not one. |
| **The linking parser matches `closed: #4` inside a sentence saying the opposite.** | It auto-closed an issue here. Keep every closing keyword away from every issue reference unless you mean it. |
| **Two agents doing git operations in one working tree** | Put a commit on the wrong branch. **One working tree, one git writer.** Use `git worktree add` for anything concurrent. |
| **`check-citations` compiles `it.each` templates to regexes** | A short citation can resolve *vacuously* — it matches a template rather than a real test. Green does not mean cited. |
| **`ISSUE-00N` (manifest) versus `#N` (GitHub) collide** | A phantom `ISSUE-006` is cited 31 times across 12 files with no manifest section defining it. Tracked as #53. |
| **Memory exhaustion at roughly 31 node processes** | Several agents could not complete `npm run verify`. **Limit concurrency.** |

---

## 10. How to verify anything

`npm run verify` chains **nine** stages, in order:

`check:portability` → `check:citations` → `lint` → `typecheck` → `test:coverage` →
`test:integration` → `test:scripts` → `build` → `audit:prod`

**CI does not run all of them.** Inspected at `868fe88`:

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
Tracked as #58.

Two checks gate every commit and are easy to trip:

- **`check:portability`** — no absolute paths, no drive letters, no home or scratch
  directories, LF endings only, no BOM.
- **`check:citations`** — never quote a test title you have not confirmed exists. It
  only inspects quoted strings that follow a citation marker, so the safe move in a
  document like this one is to quote no test titles at all. This file quotes none.
