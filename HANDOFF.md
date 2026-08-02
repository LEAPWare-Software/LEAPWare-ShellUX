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

### Quality-first working agreement — PR **#71**, `quality-first-agreement` — **OPEN, CI green**

- Commit `c82bfe1`. All three `Verify` legs pass. **Ready to merge.**
- Creates **`docs/adr/0003-quality-over-velocity.md`** and repo-root **`CLAUDE.md`**;
  edits `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md`. Filed issue **#58**.
- **One checkbox is deliberately unticked** — "parallel work is disjoint" — with the
  reason written beside it, because disjointness could not be verified from inside the
  branch. That is the doctrine working, not a defect in the PR.
- **Until this merges, the quality doctrine lives only in §9 of this file.** Neither file
  exists on `origin/main` — re-checked.

### THE DIRECTION CHANGED ON 2026-08-02. Read this before §4.

The owner has redirected the project: **ShellUX must become a native host application**,
must **leapfrog** rather than reproduce the Outlook three-pane standard, must support
**graphical visualization in all three panes**, must make **pane 3 both a visualization
surface and an input surface**, must be **visually stunning with multiple themes**, and
must **auto-update to a new release**.

The approved plan is a nine-phase evolution of this codebase, not a rewrite. Decisions
already taken, which are **not** open for re-litigation:

| Decision | Answer |
|---|---|
| Runtime | **Electron 43.x**. Rejected Tauri: its multi-webview-in-one-window API is behind an `unstable` flag, and Win+macOS under Tauri means two rendering engines (WebView2/Blink, WKWebView) for a graphics-heavy app |
| Targets | Windows 11 primary, macOS. **No Linux requirement** |
| Panes | Their own `WebContentsView` processes — **but see the correction below** |
| Ribbon | **Deleted.** One command registry with four views: a 32px context bar, a browsable Cmd-K palette, a selection-triggered floating toolbar, a docked omnibox composer |
| Third parties | Still undecided (§4 stands) → the isolation boundary must stay swappable |

**A correction that matters, because the word "isolation" was doing unearned work.**
`ExtensionViews` declares `pane2` and `pane3` on ONE blueprint and `ActiveExtension`
carries one blueprint, so **panes 2 and 3 are always the same extension**. Splitting per
pane puts one extension in two processes and yields **zero** boundary between different
extensions. What it really buys is **crash containment** (a wedged or leaking pane-3
renderer leaves nav and pane 2 alive, which a React `FaultBoundary` cannot do), per-pane
memory accounting, and a swappable boundary. It does **not** discharge ADR-0001
Amendment E's trigger. Call it crash containment in the ADR, not isolation.

**The three-process topology is gated, not settled.** Phase 6 ends with a topology gate: a
real NVDA + VoiceOver spike decides three-process vs two-process (host chrome + one
extension process holding both panes). The open question is whether Electron exposes N
`WebContentsView`s as N separate platform accessibility trees — if it does, the WCAG 2.2 AA
keyboard commitment in `README.md` breaks in a way a focus ring does not fix. **Nobody has
verified this.** Two-process also dissolves the shared-module-state problem below, so the
thumb is on the scale for it unless the spike comes back clean.

**A consequence to handle in Phase 5, before any split.** Both verification remotes keep
module-scope stores (`MailPlugin.tsx:315-341`, `DatabasePlugin.tsx:299-323`) because the
host carries only the id, never the item. Under a pane2/pane3 split the module loads twice:
static seed lookups still resolve, so it *looks* fine while every `commit` in pane 2 becomes
invisible to pane 3. Migrate both remotes onto the new structured payload channel first.

**Auto-update has a blocker that is the same one as §5.** `electron-updater`'s GitHub
provider on a private repo needs a token in the shipped client, which anyone can extract.
The recommendation is a static `generic` feed published to by a release workflow. **Making
the repository public would resolve §5, §6.2 and this at once** — all three share one root
cause, so it deserves a real decision rather than a default.

The full plan — the ADR-0002 amendment shape, the token architecture, the three contract
additions and thirteen ranked risks — is tracked at
[`docs/plans/native-host-pivot.md`](docs/plans/native-host-pivot.md).

---

## 1a. Recently landed

### Browser test lane — PR **#70**, merged as **`3ebf86d`**

Commit `da7d89e`; branch `browser-test-lane` preserved. **17 files, +1,389 / −4.**
**[reproduced — commit inspected]**

- Adds `playwright.config.ts` (`testDir: './e2e'`, 2 workers, chromium),
  `e2e/shell.ts` plus five specs — `ribbon-overflow`, `pane-dividers`, `shell-layout`,
  `hotkeys`, `focus-visibility` — `.github/workflows/browser.yml`, `dev.html`,
  `src/dev/DevShell.tsx`, `src/dev/main.dev.tsx`. Modifies `package.json`,
  `package-lock.json`, `tsconfig.json`, `.gitignore`, `README.md`, `CONTRIBUTING.md`.
- **24 browser tests** (8 + 5 + 5 + 4 + 2). **[reproduced — counted]** All CI legs green.
- **`verify` is unchanged and the lane sits deliberately outside it**, so the
  `npm ci && npm run verify` fresh-clone promise stays literally true. **[reproduced]**
  `@playwright/test` is a devDependency.
- `e2e/` is isolated from vitest — vitest's `include` is `src/**` only — and from the
  no-listener scan. **[reproduced — confirmed, not assumed]**
- **`check:citations` now reaches `e2e/`.** Corpus grew from 32 to **37 test files** and
  by nine prose files. **[reproduced — re-measured]** The author verified it bites by
  corrupting a cited title and watching it fail.

**This is the first thing in the repository that can see a defect jsdom cannot.** Both
regressions it targets were proven to bite by breaking them and reverting: removing the
Radix portal turned 4/4 overflow cases red (`visible.width` 1px against `own.width` 34px),
and disabling the resize handle turned 4/5 divider cases red.

> **Record the limit the author volunteered.** A third deliberate break — `w-0` plus
> zeroed `hitAreaMargins` — left **all five divider tests passing**. So those tests prove
> *that a drag occurred*, not that the hit area is any particular size. It is written up
> in PR #70's Limits section. Do not cite them as evidence about hit-target sizing.

---

## 1b. Working-tree discipline

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
| `origin/main` | `3ebf86d` | Head. Merge of PR #70. |
| local `main` | `e504fd3` | **STALE — well behind `origin/main`.** |
| `origin/browser-test-lane` | `da7d89e` | **Merged** via PR #70. Branch preserved. |
| `origin/quality-first-agreement` | `c82bfe1` | **PR #71 open, CI green — see §1.** |
| `origin/phase-1-hotkeys` | `a1df19d` | Merged content; branch not deleted. |
| `origin/phase-2-shell` | `b80cad0` | Merged via PR #33. |
| `origin/docs-security-sweep` | `4509c38` | Merged via PR #56. **Was fast-forwarded to `868fe88` in a local tree by an agent outside its remit — see §11.** |
| 5 `dependabot/*` remotes | — | PRs #34–#38, all open. #35 and #38 cross a major. **#34, #35 and #38 are currently RED on CI** — triage before merging any of them. |

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

Audits so far: architecture, code correctness, security, test quality, production
readiness, repo/CI, deferrals, CPO, plus a second wave covering enforcement and test
integrity. Each finding is tagged **[reproduced]** where confirmed by execution here, or
**[reasoned]** / **[reported]** where it was not re-run.

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
  **Re-reproduced 2026-08-02 on a fresh `npm ci`: 6 vulnerabilities, 3 moderate / 1 high /
  2 critical.** The 2026-08-02 dependency triage found the second half of the problem, which
  is worse than the first: **Dependabot could not offer the fix either.**
  `.github/dependabot.yml` sets `open-pull-requests-limit: 5` and deliberately ungroups
  majors; all five slots were occupied; and the fixes — `vitest@4`, `@vitest/coverage-v8@4`,
  `vite@8` — are three ungrouped majors needing three free slots. So the vulnerability was
  invisible to the gate *and* unofferable by the bot at the same time. Closing #35 and #38
  freed two slots. **This must land before Phase 6**, which puts the entire cross-process
  transport under jsdom unit test — i.e. increases this project's dependence on the exact
  package carrying the criticals. See [`docs/dependabot-triage.md`](docs/dependabot-triage.md).
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

- ~~**`npm run dev` still renders an empty shell.**~~ **CLOSED 2026-08-02.**
  `vite.config.ts` now installs a `configureServer` middleware rewriting `/` to `dev.html`,
  so `npm run dev` opens the shell with both verification remotes registered.
  `/index.html` still serves the empty-registry production shell by name.
  **Two things were measured rather than asserted.** `dist/` is **SHA-256 identical**
  before and after the change — all three artifacts, verified by building both ways — so
  "the production bundle is unchanged" is now a measurement. And the four new cases in
  `e2e/dev-routing.spec.ts` were mutation-probed: with the middleware removed by hand, the
  two load-bearing cases fail and the two deliberate control cases still pass.
  **One of those four was vacuous on the first draft** — it asserted only that the URL was
  still `/`, which the production shell also satisfies, so it passed with the middleware
  gone. It now asserts the fixture arrived *and* the URL did not move. Worth recording as
  another instance of §11's "a green test is not a test".
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

  **The narrow conclusion, which is the one to keep:** the manifest's claim **has lost
  its evidence without anything replacing it**. It is not disproven. `--sequence.shuffle`
  reorders *files*, not cases, so one file order at one seed is all anyone has ever
  measured.

  **This is the best worked example the project produced today — read it before trusting
  any single run.** The claim passed through three states: (1) repeated as fact from the
  manifest; (2) apparently *confirmed* — a junctioned `node_modules` produced 104 failures
  that looked exactly like the predicted order-dependence; (3) contradicted by a clean run
  (31 files, 1,079 tests, green under shuffle). **Stopping at state two would have written
  a false claim into the file every future session reads, backed by evidence that was an
  artifact of the author's own setup.** Corroboration that arrives from a broken
  environment is not corroboration.

---

## 7. Issue tracker state

Counts verified 2026-08-01. **See §0 — re-derive these, do not trust them.**

- Milestone 1 — **Phase 2 — Production Readiness**: **35 open**, 0 closed.
- **46 issues open in total.** So **11 open issues — #58 through #68 — are NOT attached
  to the milestone.** They were filed after it was created. **Sweep them on.**
- 14 issues closed. 5 PRs open, all Dependabot dev-dependency bumps (#34–#38).

| Group | Issues |
|---|---|
| **BLOCKER** | **#39 — nobody has ever run the app.** Plus **three items with no issue at all**: routing the demo to `/` (§6.3), the §5 enforcement gap, and §6.2 vulnerability reporting. **File all three.** |
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

**Superseded in part by the native-host pivot at the top of §1.** The nine-phase plan in
[`docs/plans/native-host-pivot.md`](docs/plans/native-host-pivot.md) is the sequence now;
what follows is the pre-pivot list with its still-live items marked, because several are
prerequisites the plan folds in rather than replaces.

| # | Work | Status |
|---|---|---|
| 1 | **Answer §4: are third parties real customers in the next 12 months?** | **STILL OPEN.** The pivot does not answer it — it designs the isolation boundary to stay swappable so the answer can arrive late. Still decides half the documentation scope. |
| 2 | **Answer §5: pay for the tier that allows branch protection, or go public?** | **STILL OPEN, and now larger.** Auto-update needs a release feed, and the GitHub provider on a private repo would mean shipping an extractable token. Public would resolve §5, §6.2 and the update feed together. |
| 3 | ~~Route the working demo to `/`~~ | **DONE 2026-08-02.** See §6.3. |
| 4 | **Merge PR #71** (`quality-first-agreement`) | Still open, still green. Larger stakes now: the pivot is the biggest change in this repo's history and §5 means nothing enforces review. |
| 5 | **The two layout defects** (`ShellLayout.tsx:731`, `:733-736`) | **Phase 0b, in flight.** Kept ahead of the pivot deliberately: item 3 makes this an artifact a human is now asked to run, and two data-destroying defects in a demo is not acceptable. The pivot later deletes the code they live in — the value is one correct release plus a browser-lane regression test that survives as a behavioural spec. |
| 6 | **The two `Object.freeze` lines** (`types.ts:770`, `HydrationEngine.ts:211`) | Still open. Do it with the exports-walking test, or it regresses a third time. |
| 7 | **Root error boundary** | Still open, and the pivot raises its value — an Electron main process with no top-level boundary turns a renderer throw into a blank native window. |
| 8 | Fix the two vacuous tests and the `patternFor` hole | **Phase 0c, in flight** for the `patternFor` half. It is a hard prerequisite for Phase 4: deleting the ribbon renames many cited titles at once, which is exactly when a prefix-match hole stops being theoretical. The two vacuous tests are still open. |
| 9 | Triage the red Dependabot PRs | **DONE 2026-08-02** — full findings in [`docs/dependabot-triage.md`](docs/dependabot-triage.md). **#35 and #38 closed.** The lead finding is not about any single PR: `.github/dependabot.yml` caps the queue at 5 with majors deliberately ungrouped, all five slots were full, and the fixes for the two CVSS 9.8 criticals in `vitest` are three ungrouped majors needing three free slots. So CI could not *see* the criticals (§6.2 — `audit:prod` omits dev) **and** Dependabot could not *offer* the fix. Two slots are now free. **#37 is green and CI is structurally blind to its breaking change** — jest-dom 7 raises `engines` to `node: >=22` while this repo declares a 20.19 floor and `.npmrc` sets `engine-strict=true`, so a developer on the declared-supported Node gets a hard `EBADENGINE`; every workflow reads `.nvmrc`, which is `24`, so **no CI leg has ever exercised the declared floor**. #34 is a doctrine decision rather than a chore: all 11 new warnings sit on `Object.freeze(...)` exports and 0.4.26 lints the same files clean. |
| 10 | Everything else, by milestone priority | Re-triage against the pivot — the ribbon's deletion closes or moots several documentation issues. |

---

## 9. The quality doctrine

**As of `3ebf86d`, `docs/adr/0003-quality-over-velocity.md` and the repo-root `CLAUDE.md`
do not exist on `origin/main`.** They are the content of **PR #71**, which is open and
green. **Once it merges, replace this section with a pointer to those two files.**

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
| **`gh pr checks` returns NON-ZERO while checks are still pending** — not 0. Measured here: exit **1** on a PR with pending legs, and exit **1** on a PR with failed legs. An audit reported exit 8 for the pure-pending case; I could not isolate it. | Either way the rule holds: **a non-zero exit does not mean failed — it may mean pending.** Any script treating non-zero as failure will misread a run in progress. Read the status column, not the exit code. |
| **A branch was moved by an agent outside its remit.** A `git merge origin/main` ran while another agent held the shared tree on `docs-security-sweep`, fast-forwarding it `4509c38` → `868fe88`. | Non-destructive, already-merged content, and left in place. But it reinforces the rule: **one working tree, one git writer.** |
| **Transient probe edits alarmed two auditors.** An agent deliberately broke `ShellLayout.tsx` to prove the tests bite; two concurrent auditors read the working tree and filed it as a live defect. | Wasted two audits. **Announce a probe window before deliberately breaking a shared file — or do it in a worktree.** This update's mutation probes were all run in a throwaway worktree for that reason. |
| **Memory exhaustion on this 8GB machine** | `test:coverage` was OOM-killed twice under concurrent load. **Limit concurrency.** |
| **The machine is in a degraded state as of this writing.** ~620 MB free across ~572 processes, with orphaned `vitest` and `vite-node` processes from earlier agents still resident. `verify` died twice on resource exhaustion — exit 127 `fork: Resource temporarily unavailable`, and `-1073740791`. Playwright workers died with `spawn UNKNOWN`. | **Recommend a restart before the next session.** And the standing rule: structural-looking failures should be suspected as environmental **first**. |
| **A partial `npm install` produces *fake* failures.** A truncated `ajv` file and a missing `lib.es2022.d.ts` surfaced as bogus lint crashes and **13 phantom TypeScript errors**. A junctioned `node_modules` separately produced **104 failures** that mimicked a real predicted defect. | A new maintainer would reasonably file those as defects — and one audit nearly wrote the junction artifact into this file as a confirmed finding (§6.9). **Suspect the environment before the code when failures look structural.** Reinstall, then re-run, before believing them. |

---

## 12. How to verify anything

`npm run verify` chains **nine** stages, in order:

`check:portability` → `check:citations` → `lint` → `typecheck` → `test:coverage` →
`test:integration` → `test:scripts` → `build` → `audit:prod`

**It takes roughly 12–13 minutes**, dominated by `test:coverage` (~351s) and
`test:integration` (~199s) — **and those two overlap**, because `IntegrationSuite.test.tsx`
runs in both. **[reported]** Worth knowing, because "run verify before every commit" is
the doctrine and its cost should be stated rather than discovered.

There is now a **second, separate lane**: `npm run test:browser` runs 24 Playwright tests
against a real Chromium, on its own `browser.yml` workflow. It is **deliberately not part
of `verify`** — see §1a. Run it when touching layout, the ribbon, dividers, hotkeys or
focus, because it is the only thing here that can see what jsdom cannot.

**CI does not run all of `verify`.** Inspected at `3ebf86d`:

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
  miss even then. Since PR #70 its corpus includes `e2e/` — 37 test files.
