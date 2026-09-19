# Plan: LEAPWare ShellUX to 1.0.0 in production

**This file is the plan.** It is the line of sight `docs/DECISIONS.md` §3 points at. Tick a box only when its condition is checkable and checked; re-derive status from `git` and `gh`, never from this file. Owner rulings behind it: D-31 to D-41.

## Mission (owner, 2026-09-18)
**A best-in-class UI/UX shell that hosts application plugins.** 1.0 is not "released" until the bar below is met and measured. Benchmarks: **VS Code, Linear, Raycast, Outlook/Teams.**

| Dimension | 1.0 gate (each measured, never asserted) |
|---|---|
| Plugin host | Operators install, enable, disable and remove plugins **at runtime** without rebuilding the shell. Lifecycle hooks (#17). A versioned contract (#28/#32, resolving #68). A plugin crash is shown to the user with a recovery path. A conformance kit (#57) that the two mocks and HelloExtension pass |
| Keyboard | Every command is reachable from the palette. Shortcuts are shown in the UI (`describeHotkey` wired, #43). Full keyboard operation with visible focus, covered by browser-lane focus-order specs. **Screen readers (WCAG 2.2 AA, NVDA, #60) are 1.1, and every doc labels them not done** |
| Performance | Budgets for cold start, palette open, input latency and bundle size. CI fails when a budget is exceeded (#62) |
| Visual | Token and contrast gates (exist). Editorial-voice rule (SHAPE-BRIEF §3): no publisher ID shown as a heading, no type chips |
| Review | Heuristic review against the four benchmarks by an agent that did not build the UI, with findings closed or filed |
| Users | Operators use the packaged app with the owner watching, and the owner signs off |

Deliberately unproven at 1.0 and labelled so: **"best for plugin authors"**. #65 stays after 1.0 by owner call, so no one outside the design has built a plugin.

## SDLC — led by LEAPWare BuildCraft, which is still being built

**The circularity.** The owner has ruled that ShellUX's SDLC is led by `leapware-buildcraft` (`LEAPWare-Software/LEAPWare-BuildCraft`, public, Apache-2.0). Recon on 2026-09-18 found that BuildCraft cannot lead anything mechanically yet:
- It is at v0.1.0 with no tag and no release.
- Exactly one rule ships, `lwb_version`, a permanent no-op that never denies.
- Every stage, role, proof and hygiene gate is `PROPOSED`.
- Its CI scripts hard-code BuildCraft's own tree.
- Its requirements are 1 of 13 sections done (`docs/requirements/mission.md`). The owner-directives session has not been held, and D5 (reviewer identity bound to what was reviewed) is open.
- ShellUX is mentioned nowhere in it.

So ShellUX cannot wait for BuildCraft, and BuildCraft cannot be finished without a real project to be finished *for*.

**How ShellUX works while BuildCraft is unfinished: by convention first, mechanically later.** (The earlier "pilot" framing, with ShellUX filing requirements into BuildCraft, was withdrawn by the owner: D-44.)
1. **Adopt the model now, as convention.** Take the one decided part of BuildCraft, its mission. Stage order: design → qa → review → security → delivery → release → operations. Role rule D3: a qa, review or security actor may not have authored an earlier stage of the same deliverable. `docs/sdlc.md` in ShellUX maps each of this plan's steps onto those stages, and maps ShellUX's existing machinery onto them: ADR-0003 rules, `verify`, the browser lane, the review loop, and DECISIONS.md. **Existing ShellUX gates stay where they are**; the SDLC doc names them, it does not replace them.
2. **Record in the shape BuildCraft will check.** Every review record names the reviewer, the role, the stage, and the **commit SHA reviewed**. That last field is BuildCraft's PR #13 direction ("bind reviews to commits") and D5's open question. The PR #115 review comment already carries the reviewer and verdict; from now on it also carries the SHA. Records go in PR comments until BuildCraft defines a consumer-side record format. **No parallel `reviews/` directory is invented**: BuildCraft's `reviews/` is its own internal store, not a consumer contract.
3. **No requirements are filed into BuildCraft from here** (D-44). BuildCraft's own development happens in its own repository.
4. **Adoption ratchet.** `docs/sdlc.md` keeps a table with one row per BuildCraft rule: `PROPOSED` → `EXISTS` → **installed in ShellUX** → **enforcing**. When a BuildCraft gate ships, ShellUX installs it (as a Claude Code plugin, `plugins/claude/lwb`) and retires the matching convention in the same change. Nothing is installed before BuildCraft ships a gate that enforces something (D-44).
5. **1.0 WAITS FOR BUILDCRAFT (owner call, 2026-09-18).** The ratchet is not enough: v1.0.0 is not tagged until BuildCraft meets the **readiness bar** below, installed in ShellUX and enforcing. Until then ShellUX work continues under convention (points 1–4), and rc pre-releases (Step 9) are allowed, labelled "pre-BuildCraft".

**BuildCraft readiness bar for ShellUX 1.0.** These are the criteria the wait is measured against. The owner may confirm or amend them:

| # | Criterion | BuildCraft state 2026-09-18 |
|---|---|---|
| R1 | A tagged, installable BuildCraft release (not a SHA pin) | ❌ v0.1.0, no tag |
| R2 | Stage gates enforcing the design → qa → review → security → delivery → release → operations order on a consumer repo | ❌ `PROPOSED` |
| R3 | Role rule D3 enforcing: the reviewer/qa/security actor did not author an earlier stage | ❌ `PROPOSED` |
| R4 | Review records bound to the commit SHA, with reviewer identity verifiable (D5 decided) | ❌ D5 open; PR #13 in flight |
| R5 | Proof gates: a stage cannot pass without its recorded evidence (for ShellUX, `verify` output and the browser lane) | ❌ `PROPOSED` |
| R6 | Gates are consumer-portable, configured per repo, with nothing hard-coded to BuildCraft's tree | ❌ all `scripts/` hard-coded |
| R7 | A documented consumer adoption path (install, config, record format) | ❌ only the plugin install for the no-op |

**Reconciliation when the bar is met.** Work landed under convention is not re-litigated merge by merge. Instead, **the 1.0 release candidate (`v1.0.0-rc.N`, the diff from the first commit to the candidate) runs BuildCraft's full stage sequence once, enforcing**: review, security and release stages by actors who authored none of it. Findings are fixed before the tag. Only then is "built under BuildCraft" claimable, and only for the rules that enforced.

**Critical path consequence, stated rather than hidden.** 1.0's date is now `max(ShellUX Steps 0–9, BuildCraft R1–R7)`. BuildCraft publishes no size estimate, so **no 1.0 date can be given** until BuildCraft's requirements package (12 of 13 sections open) sizes its gates. BuildCraft's own development happens in BuildCraft's repo and sessions, not in this plan. ShellUX's part is to adopt each gate as it lands (point 4).

**What this does NOT solve (rule 8):**
- Conventions are self-attested until BuildCraft enforces them. D3 separation is honoured by agent routing (`lw-verifier` never authors), not by a gate.
- If BuildCraft's later requirements contradict the mapping, `docs/sdlc.md` is the one file that changes.
- One developer means D3 can be met only by distinct agents, not distinct humans. That is BuildCraft's open question D5, left for BuildCraft to answer.

## Context

HANDOFF.md (last updated 2026-08-04, six weeks stale) and `docs/DECISIONS.md` §3 describe the path to v1 as eight steps, gated behind #65. #65 is a real first-party module built by someone who did not design the contract, and nobody is assigned to it. The owner has now answered the four blocking questions:

| Question | Owner's answer (2026-09-18) | Recorded decisions it reverses |
|---|---|---|
| #65 gate | **Ship 1.0 first.** #65 becomes a post-1.0 item | D-11 (as a v1 gate), D-13, D-19, D-28 timing |
| Signing | **Ship unsigned**, for LEAPWare operators only | D-25 purchase deferred (vendor choice kept) |
| Updates | **Make the repository public and use the GitHub provider** | D-09, D-12, and D-27 (branch protection becomes possible) |
| Redesign | **Waves 2, 3 and 4 all ship in 1.0** | Step 2b scope |

Measured today:
- `HEAD` is 12 commits ahead of `origin/main` (`b7bfc60`).
- PR #115: all 5 CI checks green, 0 reviews.
- 5 Dependabot PRs are open (#117, #118, #119, #120, #125).
- 52 issues are open. `package.json` is at `0.1.0` and nothing has been tagged.
- HANDOFF.md is 70,219 bytes against the 3000-byte cap. CLAUDE.md is 334 lines against the 200-line cap.

**One conflict the owner must accept explicitly at Step 3.** "Internal only" and "public repository with GitHub Releases" contradict each other. Once the repository is public, **anyone can download the unsigned installer**. Update integrity then rests on the `sha512` in `latest.yml`, served over HTTPS from the same GitHub release. That is a **guardrail**, not an integrity control: whoever controls the GitHub account controls what every client installs. It is acceptable only if it is written down that way.

---

## Step 0 — Land what is in flight  (6/6)
- [x] Adversarial review of PR #115 (rule 1), by an `lw-verifier` (sonnet) that did not write it. Verdict MERGE AFTER FIXES; record on the PR, 2026-09-18. [C-01]
- [x] Fix the findings (`899fa66`, three prose findings). Gates on the fix: `check:portability` and `check:citations` exit 0; CI 5 of 5 green. The full `verify` was not re-run for a two-file prose change. [C-02]
- [x] Merge #115: merged as `148217b`. **HANDOFF §1 was NOT updated in that landing**; it is carried into the docs-recast change instead, which is a rule-3 miss recorded rather than hidden. [C-03]
- [x] **Clear the red production audit** (found 2026-09-18: failing every Monday since 2026-08-10 on `js-yaml`), close the unaudited dev tree, and make a failing scheduled audit file an issue. PR #126: `verify` exit 0, review MERGE, Medium finding fixed; merged `e00ea93`, all seven checks green. [C-04]
- [x] Triage the Dependabot PRs. **Done 2026-09-18:** #117 and the group #131 merged green on every leg; the D-28 pin landed in `.github/dependabot.yml` (#130); declined with reasons and an ignore rule: #118, #119, #120, #132, #133, #134, #135, #136, #137, #138, #139, #140, each confirmed `CLOSED` with `gh pr view`. **What "done" means here:** every Dependabot pull request opened through 2026-09-18 is merged or declined. It does not mean the queue stays empty: Dependabot opened #140 minutes after this line was first written as "zero open", which was true only at that moment: [C-05]
  - **#125** (minor/patch group): merge if green on every leg.
  - **#117** globals, **#118** jsdom 30, **#119** eslint 10: take each only if all legs are green. Otherwise close it with the failing leg quoted.
  - **#120** react-resizable-panels 2→4: **decline, deferred to after 1.0** (done 2026-09-18, reason on the PR). It is a migration of the divider/layout engine, which is where both data-destroying defects lived. Wave 3 already rewrites that surface, so the substrate should not move under it.
- [x] React 19 (#106) and `eslint-plugin-react-refresh` 0.5 (#105) stay deferred to after 1.0. React 18 has no known defect in this tree. [C-06]

## Step 0b — Withdrawn
The BuildCraft pilot is not part of this plan (D-44). The 1.0 tag still waits for BuildCraft (D-39).

## Step 0c — Proof of completion, before BuildCraft  (4/5)
Design: [`docs/proof-of-completion.md`](../proof-of-completion.md) (D-50). Until its PR B lands, a tick here is recorded under the old convention.
- [x] Design audited adversarially until a round found no Blocker (round 12 of 12), and recorded as D-50. [C-07]
- [x] PR A: register, box linter, evidence gate, status report, both workflows (not required), template and `CLAUDE.md` rule, migration of today's ticked items. [C-28]
- [x] Rollout step 2: every throwaway-PR case shown with its run id. Cases (a) to (l), each as designed: `docs/claims-evidence/rollout-step2-2026-09-19.md` lists every run, and the row re-reads each run's conclusion from GitHub. [C-30]
- [x] Rollout step 3: three green main runs, a forced failing row and a forced crash each file the issue. Main runs 35421271000, 35422494969 and 35424386634 were green; the `failing-row` dispatch 35427314752 filed #174 through the issue job, and the `crash` dispatch 35427454734 failed and its issue job ran; the `npm run status` readings and #174's text are in `docs/claims-evidence/rollout-step3-2026-09-19.md`. [C-31]
- [ ] PR B: both checks required with `integration_id: 15368`, applied and read back.

## Step 1 — Record the decisions before acting on them  (1/2)
- [ ] In `docs/DECISIONS.md`, add D-31 through D-34 (one per row above, "Called by: Owner, 2026-09-18"). Strike through the superseded D-09, D-11 (as the v1 gate), D-12 and D-27, and rewrite §3 as the new line of sight: this plan's steps. Add D-35: **contract gaps ship as documented limits** (#16, #17, #28, #32, #57, #80, #91). This is consistent with D-23 (no third parties). #65 is re-scoped to the 1.1 milestone.
- [x] Create GitHub milestone **v1.0.0** and move every issue this plan closes onto it. Everything else goes to **1.1** or stays on Phase 2. The milestone then *is* the gate, and it can be counted. [C-25]

## Step 2 — Context files within their caps  (4/4)
- [x] HANDOFF.md → ≤3000 bytes. It keeps only the transition: where main is, what landed, what is in flight, the next step. §2–§12 move verbatim to `docs/history/handoff-archive-2026-08.md`. [C-08]
- [x] CLAUDE.md → ≤200 lines. The "Traps" and "jsdom is blind" bodies move to `docs/traps.md`, and CLAUDE.md keeps one-line pointers plus the rules. [C-09]
- [x] The caps lint: `scripts/__tests__/context-caps.test.mjs` in `test:scripts`, so inside `verify` with no new stage. Mutation-probed both halves. [C-10]
- [x] `git add` the new files before running `verify` (the portability trap). Citations must still resolve: moved text keeps its `*Tests:*` markers. [C-11]

## Step 3 — Go public, on the `leapware-sessionkeeper` pattern  (6/9)

The template is `../leapware-sessionkeeper`, which is PUBLIC and Apache-2.0 (checked with `gh repo view`). Copy its open-source scaffolding, but **not** its plugin or dual-host parts: `.claude-plugin/`, `.agents/`, `.codex/`, `AGENTS.md`, `.github/apps/lws-*.json`, `docs/install-claude.md` and `docs/install-codex.md` have no equivalent here.

- [x] Scan the published history for secrets with gitleaks: every commit on `main`, plus the lockfile as it stands, which `gitleaks git` cannot read because `.gitattributes` marks it `-diff`. This is a one-off invocation, not a tracked dependency (ADR-0002). Any hit is **rotated**; deleting it from history is not enough. Run 2026-09-18 **after** the flip, because gitleaks could not run before it (D-43, whose pre-flip check was a grep of every commit): no leaks. Raw output, the commit counts, and the two false positives an all-refs scan finds are in the row's evidence file. [C-19]
- [x] The two repairs from the public-content review hold: `CODE_OF_CONDUCT.md` names no personal contact and routes reports through `SECURITY.md`, and `CODEOWNERS` names no `@LEAPWare-HQ`. The review itself (customer names, internal hosts, credentials in docs) was by hand in #141 and is not re-run by the row. [C-12]
- [x] **Licence.** Sessionkeeper ships `LICENSE` (Apache-2.0, 201 lines) and a `NOTICE`, and its README carries a license line. ShellUX's `package.json` says `MIT`. **Owner picks one**; the default is Apache-2.0 to match the house pattern. That means the `LICENSE` and `NOTICE` files, `package.json` `license`, and the README line, all in one commit. The owner picked Apache-2.0 (D-42). [C-20]
- [x] Community files mirroring sessionkeeper's shape: `CODE_OF_CONDUCT.md`, and `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature.yml` (form-based). `CONTRIBUTING.md` and `SECURITY.md` already exist and get re-aimed rather than replaced. `.editorconfig` and `.gitattributes` are added if missing; `.gitattributes` enforces LF, which `check:portability` already requires. [C-13]
- [x] `.github/CODEOWNERS` → `* @LEAPWare-Software`. The current `@LEAPWare-HQ` is inert (HANDOFF §5). [C-14]
- [x] **The repository is public.** Outward and hard to reverse, so it was the owner's call (D-43), executed by the CTO agent under the owner's 2026-09-18 delegation. The owner accepted the Context risk statement in D-34. [C-21]
- [ ] **Ruleset as code, not classic branch protection.** Add `.github/rulesets/main.json` modelled on sessionkeeper's:
  - `~DEFAULT_BRANCH` with `bypass_actors: []`.
  - `deletion` and `non_fast_forward`.
  - `pull_request` with `required_approving_review_count: 0` and squash-only.
  - `required_status_checks`, strict, listing the exact CI job names: `Verify (ubuntu-latest)`, `Verify (macos-latest)`, `Verify (windows-latest)`, `Browser tests (chromium)` and `Declared Node floor (22.13.0)`.
  - `merge_queue` with ALLGREEN, which means adding `on: merge_group:` to `ci.yml` and `browser.yml`.

  Add `scripts/apply-rulesets.mjs`, a Node port of `lws_apply_rulesets.py` that shells out to `gh api` and supports `--dry-run`, with a `node:test` file. Add `docs/maintainers/repository-settings.md` covering what each rule enforces, how to re-apply, the squash-only repo `PATCH`, and the note that bootstrap is owner-only. Write the D-27 reversal honestly.
- [ ] Enable private vulnerability reporting, secret scanning and Dependabot security updates. Rewrite `SECURITY.md` the way sessionkeeper does: a "Report a vulnerability" link first, then `leapware@outlook.com` (D-03), then scope notes (what the host does and does not claim, citing tests per Amendment G), then supported versions ("1.x: latest release only").
- [ ] README top matter in sessionkeeper's order: a one-paragraph what-it-is, a license line, an Installing link (`docs/INSTALL.md`, Step 7), a Developing block (`npm ci && npm run verify`), and Contributing/Security links. The long body moves to `docs/`. Mark #74 and #103 done with evidence (API responses pasted). Also close the audit gap: add a full-tree `npm audit --audit-level=high` job to `audit-dependencies.yml` (HANDOFF §6.2).

## Step 3b — Design gates 3 and 4 before any more redesign code  (3/6)  — `opus` + impeccable
Measured 2026-09-18: gates 1 (REDESIGN-SPEC) and 2 (SHAPE-BRIEF) are done in impeccable's product register. **Gate 3 (`DESIGN.md`) and gate 4 (screens) were never produced.** No wireframe, mock or artifact exists, and wave 1 shipped without them. SHAPE-BRIEF says the mock step was skipped for lack of image generation; this session has impeccable, the `design` canvas skill and published artifacts, so that reason no longer holds.
- [x] Owner confirms or overrides the SHAPE-BRIEF gate points: §3 editorial voice, §4 the 11–13px scale, §9 palette arrow-keys, §13.1. Each goes into DECISIONS.md. [C-22]
- [x] **Gate 3:** write `DESIGN.md` with impeccable, from real `design/generate.mjs` output. It covers type scale, spacing, planes, states and motion, and no hand-written hex (the token pipeline stays the only colour source). [C-23]
- [ ] **Gate 4:** wireframe every 1.0 surface as a `design` canvas published as an artifact, using real token values: shell at rest, the pane-1 nav and rail, the pane-2 list with Direction B instrument rows, pane-3 detail with charts and the docked composer, the palette, the context bar and floating toolbar, empty/loading/error/crashed-plugin states, **the plugin manager (Step 6b)**, and each theme. Include benchmark side-by-sides against VS Code, Linear, Raycast and Outlook/Teams.
- [ ] Impeccable critique pass on the wireframes by an agent that did not draw them (D3). Findings resolved on the canvas, not in code.
- [x] **Owner approves gate 4:** the six gate-4 screens are approved (D-45). [C-24]
- [ ] Steps 4–6 and 6b's UI implement the approved wireframes, and a live impeccable pass on the running app checks the result against them.

## Step 4 — Redesign wave 2: charts  (4/4)  — `opus`, design discovery
- [x] Stream A, disjoint files `echartsRenderer.ts`, `chart/*`, `e2e/chart.spec.ts`: repairs #112 (title overprint) and #113 (title outside the token system, dark contrast), and addresses #111 (contrast gate measured against a background the app never paints), which stays open. Landed in the charts PR. #146 (Database chart clipped) filed, not fixed. [C-15]
- [x] The chart contrast check runs in `tokens:check`, and so inside `verify`. [C-27]
- [x] Browser-lane cases, mutation-probed. Revert the fix and watch them go red. Whole-fix revert re-run at landing; result in the charts PR body. [C-16]
- [x] Review → `verify` → merge (per D-30). Record and `VERIFY_EXIT` in the charts PR body. [C-17]

## Step 5 — Redesign wave 3: the system  (3/4)  — `opus`
- [x] Wave plan from `docs/design/SHAPE-BRIEF.md`: rows (D-29, 32px), nav, rail, tables, forms, palette, states. Serialised on `ShellLayout.tsx` (rule 6). Written as `docs/design/WAVE3-PLAN.md`: nine increments, W3-0 to W3-8, with a table assigning each critique resolution R1 to R9 of the v4 gate-4 screens to an increment, and a file-ownership table; only W3-0 is built. [C-32]
- [x] Before editing, decide whether #95 (splitting `ShellLayout.tsx`) goes first. Decided yes, and done first: the pane-size helpers, the navigation, the pane and the resize-handle components and the palette hook moved into five modules that `ShellLayout.tsx` imports, with no behaviour change, and the pane-size helpers have direct unit tests. The persistence-hook extraction #95 also argues for is not done; #95 stays open. [C-29]
- [x] Also fold in #23 (re-clamp the layout on window resize). It is user-visible in a resizable desktop window, and wave 3 owns that file. Done as W3-0: the panes re-fit to the live width from the layout the user chose, pinned by five browser-lane cases in `e2e/pane-refit.spec.ts` and by unit cases over stubbed widths; a report arriving during a width change is passed on as a correction and not saved. #23 stays open until the owner sees it in the packaged app. [C-33]
- [ ] Browser lane for every geometric claim. Review → `verify` → merge. **Owner looks at the packaged app** (rule 5; #61's point is that Chromium on the dev server is not the product).

## Step 6 — Redesign wave 4: instrument layer  (0/3)  — `opus`
- [ ] Direction B: per-row series with threshold bands, the list minimap, the overview state.
- [ ] Browser-lane cases and `tokens:check` for any new colour.
- [ ] Review → `verify` → merge. Owner views the packaged build.

## Step 6b — Runtime plugin host  (1/7)  — `opus` (design discovery, security-relevant)
- [x] **ADR-0006 first, before any code.** Accepted 2026-09-18 on D-46 to D-48, with ADR-0001 Amendment P; see `docs/adr/0006-runtime-plugin-host.md`. Covers the manifest format; where plugins live (per-user `app.getPath('userData')/plugins`); how they load (a custom protocol serving each plugin's bundle into the extension `WebContentsView`, with no `nodeIntegration` and a context-isolated preload); and install sources (a local `.lwplugin` package, plus a GitHub Release URL). The ADR must use ADR-0001 Amendment E vocabulary: a plugin runs **in the extension renderer, with no boundary between plugins**, which is crash containment, not isolation. D-23 stays: first-party plugins only. [C-18]
- [ ] Integrity: the manifest carries a `sha512` of the bundle, and the loader refuses a mismatch. This is **entry-point validation** at install, not an integrity control against a hostile local user. The claim is written only once a named test pins it.
- [ ] Contract: lifecycle hooks (#17: `onActivate`/`onDeactivate`/`onRelease`); `hostApiVersion` in the manifest, with the host refusing a major mismatch (#28/#32, #68 closed with a decision row); a mutable nav tree (#16); badge clear (#80). #91 is decided or fixed.
- [ ] A plugin-manager surface in host chrome (a palette command plus a pane-1 view): list, enable/disable, remove, and per-plugin error state with a retry.
- [ ] Migrate both mocks and HelloExtension onto the packaged-plugin route so the shipped app loads nothing compile-time except the host.
- [ ] Conformance kit (#57): `npm run plugin:check <dir>` validates the manifest, contract version and lifecycle, run in CI against all three plugins.
- [ ] Browser lane plus the packaged app: install a plugin → it appears → disable it → it is gone → a crashing plugin shows its error state and the rest of the shell survives. Review → `verify` → merge.

## Step 6c — Best-in-class bar  (0/4)
- [ ] Keyboard: `describeHotkey` wired into the palette and tooltips, and a focus-order spec for every surface.
- [ ] Performance budgets (#62): measure a baseline on the packaged app, set budgets, and add a CI step that fails when one is exceeded.
- [ ] Heuristic review against VS Code, Linear, Raycast and Outlook/Teams by an `lw-verifier` that did not build the UI. Every finding is fixed or filed with evidence (rule 7).
- [ ] Operator sessions on the packaged app, with owner sign-off recorded in DECISIONS.md.

## Step 7 — Production hardening  (1/5)  — `sonnet`
- [ ] #86 observability, minimum version (logging and asar exclusion landed with the hardening PR; attaching sourcemaps to the release waits for step 8): `onerror`/`unhandledrejection` in the renderer and `process.on('uncaughtException')` in main, logged to a rotating file under `app.getPath('logs')`. Sourcemaps kept out of the asar and attached to the release. **No telemetry leaves the machine** (no endpoint exists or is declared).
- [x] #85 for Electron: set Vite `build.target` to the Chromium version Electron 43 ships. The Safari half is moot because the target is Electron only. Verify that `base` is correct for `file://` loading by launching the packaged app. `chrome150`, measured from Electron 43.2.0; the packaged renderer loads over the `shellux://` scheme, not `file://`. The packaged launch is recorded in #150 and is not re-checked by the row. [C-26]
- [ ] Contract items not covered by Step 6b ship as documented limits (D-35, now narrowed to exclude #16, #17, #28, #32, #57, #68 and #80).
- [ ] `DEVELOPER.md` gets a "Known limits at 1.0" section that names each deferred issue. `README.md`/`PRODUCT.md` state accessibility honestly: WCAG target withdrawn, no assistive technology ever run (#60).
- [ ] `docs/INSTALL.md` for operators: install per-user, the SmartScreen "More info → Run anyway" path for an unsigned build, where the logs live, and how updates arrive (partly covers #43).

## Step 8 — Release engineering  (0/6)  — `sonnet`
- [ ] App icon (`build/icon.ico`, 256px) and the `icon` key in `electron-builder.yml`. Check that the build log no longer says `default Electron icon is used`.
- [ ] `publish: { provider: github, owner, repo }` in `electron-builder.yml`. Update exactly the three places `docs/RELEASE.md` §1 names (`DOCUMENTED_ENDPOINTS` in `scripts/check-portability.mjs`, and its fixture in `scripts/__tests__/check-portability.test.mjs`). Both gates must go red, then green.
- [ ] A separate `release.yml` triggered by `v*` tags (as sessionkeeper does): run `verify` before releasing, then package. `desktop.yml` stays the non-publishing PR build. On a `v*` tag, build Windows only (D-26) and create a **draft** GitHub Release. Upload the installer and `.blockmap` first and `latest.yml` last (RELEASE.md §2.4). Publishing the draft stays a human step. The macOS leg is removed from release publishing (kept or dropped as a CI build, stated either way).
- [ ] Record in `SECURITY.md` and `docs/RELEASE.md` that unsigned updates depend on `sha512` + HTTPS + GitHub account control, and that this is a **guardrail**. Name the test that pins it, or narrow the claim (Amendment G).
- [ ] Rewrite RELEASE.md §0 and §1 to the new truth in the same commit (rule 3).
- [ ] Bump `package.json` to `1.0.0-rc.1` and add a CHANGELOG `[1.0.0-rc.1]` section.

## Step 9 — Prove the release path before 1.0.0  (0/6)
- [ ] Tag `v1.0.0-rc.1` → draft release → publish as a **pre-release**.
- [ ] On a clean Windows 11 VM: install rc.1, launch it, see the shell with both mocks, and confirm the logs file exists. `Get-AuthenticodeSignature` reports `NotSigned`, pasted as evidence.
- [ ] Bump to `rc.2`, tag and publish. **The rc.1 install auto-updates to rc.2** with the new version shown in the palette. This is the only proof the feed works end to end. (`allowPrerelease` must be on for rc builds only. Verify the 1.0.0 build has it off.)
- [ ] Uninstall and reinstall to confirm the per-user install is clean.
- [ ] Fix anything found, then repeat from rc.N.
- [ ] Owner sign-off on the rc build in the VM (rule 5).

## Step 9b — BuildCraft enforcing pass on the release candidate  (0/4)  — BLOCKED on R1–R7
- [ ] BuildCraft readiness bar R1–R7 met. Each criterion is checked against BuildCraft's tagged release, not its docs.
- [ ] Install the tagged BuildCraft into ShellUX. Retire each matching convention in `docs/sdlc.md` in the same change.
- [ ] Run the rc diff through BuildCraft's full stage sequence, enforcing. Every finding is fixed or filed (rule 7).
- [ ] `docs/sdlc.md` ratchet table: every rule enforcing, or named as not applicable with a reason.

## Step 10 — Ship 1.0.0  (0/5)  — requires Step 9b
- [ ] `npm ci && npm run verify` (exit 0, output pasted), `npm run test:browser`, `npm run verify:desktop`.
- [ ] Version `1.0.0`, CHANGELOG `[1.0.0]` with its comparison link, tag `v1.0.0`.
- [ ] RELEASE.md §2.3 checks on the downloaded artifact: `latest.yml` version is `1.0.0`, `sha512` matches, the blockmap is present.
- [ ] Owner publishes the release. An rc.2 install on the VM updates to 1.0.0.
- [ ] Hand-off: HANDOFF ≤3000 bytes, the milestone closed with counts re-measured, #65 opened on 1.1 with an owner slot.

---

## Deliberately NOT in 1.0 (stated per rule 8)
#65 and its friction-log fixes (owner call) · screen-reader support: WCAG 2.2 AA and NVDA (#60), moved to 1.1 and labelled · React 19 (#106) · react-resizable-panels 4 (#120) · macOS (D-26) · signing (D-25, vendor kept) · assistive-technology testing (#60), with the ADR-0005 arm B kept `Proposed` · docs issues #41–#54 except what Step 7 touches.

## Verification (every step)
- `npm run verify`, all stages (11 once Step 2 adds the caps check), with the exit code read directly. `npm run test:browser` for anything geometric, visual or focus-related.
- Mutation-probe every new browser case. Adversarial review by a different agent before each merge.
- Owner sees the **packaged** app after Steps 5, 6 and 9.
- Release proof is the rc.1→rc.2 auto-update on a clean VM, not a build log.

## Routing
Default `sonnet` (Steps 0–3, 7–10, and all reviews by `lw-verifier`). `opus` for Steps 4–6 (design discovery). No `fable`: nothing here is money-path. Every dispatch carries `BUDGET: <n>k`. One git writer in the main tree. Throwaway worktrees (mutation probes, sub-streams) go under a `.workspaces/` directory beside the repository, never inside it. **Steps run in sequence. No two steps run in parallel.** Every landing edits `HANDOFF.md`, `CHANGELOG.md` and usually `docs/DECISIONS.md` in the same commit (HANDOFF §0, rule 3; measured: `af6fdd9` touched all three, `c919e6d` touched `CHANGELOG.md`). Any two steps therefore share files, and rule 6 requires them to serialise. Comparing source files alone is the false-disjointness error DECISIONS.md already records for streams B and C. Parallelism is allowed only *inside* one step, between sub-streams whose full file sets (shared docs included) are listed and shown not to overlap before dispatch.

## Blocking 1.0 (critical path)
- BuildCraft readiness bar R1–R7. There is no size estimate, so there is no 1.0 date.

## Blocking now
Rendered by `npm run status`, not written here: this list went stale once already (it named PR #115's review and the Step 3 owner actions long after both were done).
