# Decision register

**One row per decision. Who calls it, whether it is called, and when.**

This file exists because the decisions were scrolling past. They were recorded — in
`HANDOFF.md` prose, in ADR amendments, in issue bodies — and every one of those is a
paragraph rather than a row, so nobody could see the set at once or tell an open
question from a settled one. That is a reporting defect, not a process one.

**Rules, so this does not rot like the prose did:**

- **A decision is not made until it has a row here with a date and a name.** An
  agent may recommend; an agent may not decide anything in the CALLED BY column.
- **`OPEN` rows are the only work-stopping items in this repository.** Everything
  else is work, and work goes in the tracker.
- **The tracker is still the system of record for WORK.** Every issue number here is
  a real GitHub issue; this file adds no parallel task list. If a row needs code, it
  names the issue that carries it.
- **Superseded rows are struck through, not deleted** — same reason ADR-0001 keeps
  its old amendments.

---

## 1. OPEN — these block something

| # | Decision | Called by | Blocks | Cost to decide |
|---|---|---|---|---|
| D-22 | **Who runs #65, and when do they start?** | **Owner** | Step 3 of 8, and step 4 is unsizeable behind it | An assignment and a calendar slot. **This is the only question on this page an agent cannot answer**, because the whole point of #65 is that the author must not be whoever designed the contract |

**Every other row on this page was OPEN and is now decided.** On **2026-08-04**
the owner delegated in one instruction: *"these are CPO/CTO calls, make them."*
That delegation is the authority for D-23 through D-28 below and it is written
down rather than assumed, because this file's own rule is that an agent may
recommend and may not fill the CALLED BY column unaided. **Each is one line to
reverse, and each names what reverses it.**

---

## 2. DECIDED

| # | Decision | Called by | When | What was decided |
|---|---|---|---|---|
| D-23 | **Third parties are NOT customers in the next 12 months** (#93, was D-01) | Agent, under the owner's 2026-08-04 delegation | 2026-08-04 | Follows the answer already given in `PRODUCT.md`: the users are LEAPWare's own operators and third-party authors are a means, not a customer. Deciding the commercial question the same way makes the two consistent instead of quietly opposed. **Consequence, which is the point:** #29, #30, #31, #32 and #57 shrink from "build an ecosystem" to "keep the contract honest and documented". No conformance kit, no published package, no versioning mechanism, no stability markers — until a real third party exists. **Reverses if** one signs |
| D-24 | **ADR-0005 stays `Proposed`; two-process ships; arm B is not run for v1** (#102, was D-04) | Agent, under delegation | 2026-08-04 | The register already recorded this as not release-blocking, and D-17 chose two-process *because it is safe under either outcome*. Running arm B would resolve a question whose answer changes nothing that ships. It is also an assistive-technology measurement, and #60 records that no assistive technology has ever been pointed at this application — so arm B is one narrow probe inside a hole that big, and doing it alone would read as more coverage than it is. **Folded into step 4**, where the accessibility question gets addressed as a whole or not at all. **Reverses if** a three-process need appears |
| D-25 | **Windows signing is Azure Trusted Signing, bought at step 6 and not before** (was D-05) | Agent, under delegation | 2026-08-04 | The vendor question is decided now; the spend still waits on D-10. The installed `electron-builder` is 26.15.3, which ships `windowsSignAzureManager.js` and a native `azureSignOptions` key, so no custom signtool integration is needed. The alternative is behind reality: since the 2023 CA/B rule change, OV/EV private keys are issued on hardware tokens or in a cloud HSM and are **not** handed over as an exportable file, and a hardware token cannot attach to a GitHub-hosted runner — which is what `docs/signing.md`'s `CSC_LINK` route assumes. `azureSignOptions` and `signtoolOptions` are mutually exclusive, so switching later stays a configuration edit. **Reverses if** the clean-VM SmartScreen check in step 8 fails on Azure's intermediates, a live risk `docs/signing.md` §3 already records |
| D-26 | **macOS is NOT in v1** (was D-06) | Agent, under delegation | 2026-08-04 | D-15 already made Windows 11 primary. macOS packaging is configured and **has never once been executed**, so its true cost is unknown rather than small, and it would add the Apple Developer Programme to a budget D-10 has closed, a second notarisation pipeline, and a second rendering engine for a graphics-heavy shell that #61 records has only ever rendered in Chromium. Shipping one platform that has been seen to work beats two that have not. **Reverses if** an operator needs a Mac; it is additive, not architectural |
| D-27 | **No branch protection, and no spend to get it** (#74, was D-07) | Agent, under delegation | 2026-08-04 | Both endpoints 403 on a private free-plan repository, so this is impossible rather than unconfigured. Paying for a plan to enforce review on a project with one developer buys process, not quality. **What is stated instead of pretended:** the only gate is a person choosing to refuse a merge, `CODEOWNERS` is inert twice over, and no merged pull request has ever carried a review. The compensating control is real and mechanical — CI runs all ten `verify` stages on three operating systems, and the browser lane on a fourth leg. **Reverses if** a second developer joins, at which point it stops being process theatre |
| D-28 | **`eslint-plugin-react-refresh` pins at 0.4.26 until after #65** (#105, was D-08) | Agent, under delegation | 2026-08-04 | 0.5.3 emits 11 warnings, every one on an `Object.freeze(...)` export. The tree did not change; the rule did. `Object.freeze` on a module-level constant is load-bearing in this repository — `hostConstants.test.ts` pins what it does and does not deliver — so silencing 11 sites to take a lint bump is the tail wagging the dog. **Bundled deliberately with D-19**: React 19 also waits for #65, and both touch the same surfaces, so they become one considered change instead of two deferrals that each return a third time. The pin carries its reason in configuration, not as an inline suppression. **Reverses when** #65's friction log lands |
| D-29 | **Row height is 32px, `--row-h-comfortable`** | Agent, under delegation | 2026-08-04 | Both mock extensions render two-line rows, and two lines at 12px over 11px do not fit 28px once the 4px vertical rhythm is there. 32px is still a **27% density gain over today's measured 44px**, and it consumes a token that already exists with zero consumers rather than inventing a number. Direction B's per-row series fits its 20px band exactly. **Reverses if** an operator turns out to scan 200 rows at a time, which is a question #65 will answer better than taste will |
| D-30 | **`npm run verify` runs once per wave, not once at the end** | Agent, under delegation | 2026-08-04 | Ten stages, 12–13 minutes. Four waves means roughly 52 minutes of gate time across the redesign. That is cheap against a failed matrix leg and it is what rule 2 asks for — real output in each pull request body, which only a real run produces. Wave 1 is the highest blast radius in the whole plan, because a token change moves every painted pixel, so it is the last place to batch verification |
| D-09 | **Repository stays private for now** | Owner | 2026-08-03 | Going public would have collapsed D-03, D-07 and the update feed into one free answer. Rejected for now on its own merits. The consequence is that each of those three needs its own answer, which is why they are three rows above and not one |
| D-10 | **No money spent before #65** | Owner | 2026-08-03 | No signing certificate, no paid GitHub plan, no update-feed host. All three would buy a release for a product with no proven consumer. D-05 and D-07 are therefore **deferred, not open-ended** |
| D-11 | **#65 is the next move**, and it decides the project | Owner | 2026-08-03 | Build one real first-party module against the contract, by someone who did not design it. The deliverable is the author's friction log, not the module. **Not started — standing by** |
| D-12 | **The update feed is out of v1** (#103) | Owner | 2026-08-03 | Follows from D-10. `publish` is unset, so electron-builder writes no `app-update.yml` and the app reports the updater unconfigured — `electron-builder.yml` calls that the honest state. A first release does not need a feed |
| D-13 | **Contract gaps stay open until #65 runs** | Owner | 2026-08-03 | #17, #16, #80, #91, #57, #28/#32/#68. Each is a plausible thing #65's author will hit. Fixing them first is deciding the gaps from inside, which is the one thing #65 exists not to do |
| D-14 | Runtime is **Electron 43.x** | Owner | 2026-08-02 | Tauri rejected: multi-webview-in-one-window is behind an `unstable` flag, and Win+macOS under Tauri means two rendering engines for a graphics-heavy app. See ADR-0004 |
| D-15 | **Windows 11 primary, macOS second, no Linux** | Owner | 2026-08-02 | See D-06, which asks whether macOS is in the *first* release |
| D-16 | **The ribbon is deleted** | Owner | 2026-08-02 | One command registry, four surfaces: 32px context bar, Cmd-K palette, floating toolbar, docked omnibox. Shipped in Phase 4 |
| D-17 | **Two-process pane topology**, for now | Owner | 2026-08-03 | Chosen because it is safe under either outcome of the spike D-04 decides. Three-process remains an additive change if arm B comes back clean |
| D-18 | **The dependency queue is emptied, one bump at a time and each with a reason** | Owner | 2026-08-03 | #36 (`@types/node`) green on every leg — **merged**. #96 closed: red on all three Verify legs, and the reason is the doctrine question now filed as #105, not the bump. #97 closed: `npm ci` fails before any test runs because it moves `@types/react` to 19 and leaves `@types/react-dom` at 18 — a **migration**, not a bump, now #106. Dependabot ungroups majors deliberately, so it cannot offer the set that would resolve and will keep re-proposing it |
| D-19 | **React 19 waits until after #65** (#106) | Owner | 2026-08-03 | React 18 has no known defect in this tree, and the migration touches the Radix command surface and `react-resizable-panels` — the exact surfaces #65's author will exercise. Changing the substrate underneath an experiment about contract sufficiency confounds the result |
| D-02 | **PR #71 merged** — the quality-first working agreement | Owner | 2026-08-03 | `CLAUDE.md` and `docs/adr/0003-quality-over-velocity.md` are on `main`. The doctrine used to live only in `HANDOFF.md` §9, so it held because whoever was working had read that file. It is now loaded automatically by every session in this repository. **The file arrived carrying four claims the pivot had already falsified** — see D-21 |
| D-03 | **Security contact is `leapware@outlook.com`** (#75) | Owner | 2026-08-03 | Closes a **Blocker** without going public and without spend. `SECURITY.md` sent reporters to a public-repository feature that returns 404 here, then fell back to "the private channel you *do* have" and named none — so there was no way to report a vulnerability at all, in a file that read as though there were. No response-time commitment is stated, because none has ever been measured |
| D-21 | **`CLAUDE.md` is corrected in the same change that merged it** | Owner | 2026-08-03 | It branched before the native-host pivot and said: `verify` is nine stages (ten); CI runs five of them (all ten, as of `33ce56e`); `npm run dev` renders an empty shell (fixed 2026-08-02); and #39 is open (closed by Phase 1). The file that governs how every agent behaves was wrong on arrival about the gates it governs. Fixed rather than filed — its own **rule 3** says documentation lands in the commit that makes it true |
| D-20 | **The tracker carries the taxonomy, not just this file** | Owner | 2026-08-03 | Six labels created — `blocker`, `correctness`, `contract`, `testing`, `decision`, `docs` — and applied. The grouping in `HANDOFF.md` §7 existed **nowhere but that file**, so it died with it. The eleven issues that were off the milestone are on it: it now reads 57 open / 12 closed rather than 47 / 11 |

---

## 3. Line of sight to v1

**Eight steps. One of them cannot be sized until #65 runs, and pretending otherwise
is what makes this feel endless.**

**Re-measured 2026-08-04.** Steps 1 and 2 are done. Step 2b is new: the owner asked
for the redesign and it is real work sitting between here and a release, so it is on
the page rather than in a side conversation. Numbering is not shifted, because
references to "step 4" exist elsewhere.

| Step | What | Status | Size |
|---|---|---|---|
| 1 | Merge PR #104 — the pre-#65 prep | **DONE**, merged 2026-08-03 | — |
| 2 | D-02: merge or reject PR #71 | **DONE**, merged 2026-08-03 | — |
| 2b | **The redesign.** Wave 1 landed at `ce1d97a`; waves 2–4 remain | **IN FLIGHT**, 1 of 4 waves | ~3 sessions, sized below |
| 3 | **Run #65.** Go / no-go on the whole project | **Waiting on D-22 — an assignment.** The one thing nobody has picked up | Unknown until an author starts |
| 4 | **Fix what #65 finds**, plus the accessibility question D-24 folded in | **UNKNOWN SIZE until step 3 runs.** This is the honest gap and it has not moved | Unknown |
| 5 | Application icon — `electron-builder.yml` contains zero `icon` keys, measured | Not started | ~1 hour |
| 6 | Buy and wire Azure Trusted Signing per D-25 | Vendor decided; spend still deferred by D-10 | ~half a day + money |
| 7 | Version bump, CHANGELOG, tag `vX.Y.Z` | Not started | ~1 hour |
| 8 | `docs/RELEASE.md` §2.3 and §3 — signature verified with the platform's own tool, clean-VM SmartScreen run | Not started. **Windows only, per D-26** | ~half a day |

**Step 2b, broken out.** Three waves, and the streams inside wave 2 own disjoint
files so they do not serialise (rule 6):

| Wave | Streams | Closes | Gate |
|---|---|---|---|
| 2 | **A** `echartsRenderer.ts` + `chart/*` + `e2e/chart.spec.ts` · **B** `ShellLayout.tsx` sizing only + `e2e/pane-dividers.spec.ts` · **C** `PaneWrapper.tsx` + `e2e/shell-layout.spec.ts` | #111, #112, #113, #114, #110 | `verify` ten stages + browser lane, per D-30 |
| 3 | The system: rows, nav, rail, tables, forms, palette, states. Serialised on `ShellLayout.tsx` | none — this is the redesign proper | same |
| 4 | Direction B's instrument layer: per-row series with threshold bands, the list minimap, the overview state | none | same |

**Steps 5, 7 and 8 are roughly one session together** once step 4 is known.
**Steps 2b and 3 are independent of each other** and could run in parallel if a
second person existed; with one, 2b first is the choice already made, so that #65's
author judges the contract rather than a shell whose chart title overprints its own
axis.

**The one number that cannot be given.** Everything above is sized except step 4, and
step 4 cannot be sized until step 3 runs, and step 3 has no owner. **Any total that
includes step 4 is invented.** Excluding it: roughly five sessions plus the signing
spend.

---

## 4. Signing, because D-05 has a trap in it

`docs/signing.md` documents one Windows route: `CSC_LINK` pointing at a `.pfx`/`.p12`.
**Since the 2023 CA/B rule change, OV/EV code-signing private keys are issued on
hardware tokens or in a cloud HSM and are not handed over as an exportable file** — and
a hardware token cannot be attached to a GitHub-hosted runner. So the document's
"keep a traditional OV/EV path viable via `CSC_LINK`" is behind reality.

The installed `electron-builder` is **26.15.3**, which ships
`out/codeSign/windowsSignAzureManager.js` and a native `azureSignOptions` key —
**Azure Artifact Signing needs no custom signtool integration.** `signing.md` predates
that and does not mention it. `azureSignOptions` and `signtoolOptions` are mutually
exclusive, so switching providers stays a configuration edit.

`docs/signing.md` §3 records a live, unverified report that Azure's new intermediate
authorities are being SmartScreen-flagged. It is a risk to check on a clean VM, not a
reason to choose in advance.
