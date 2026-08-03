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
| D-01 | **Are third parties real customers in the next 12 months?** (#93) | **CPO** | Half the documentation scope; #28, #29, #30, #31, #32, #57 all inherit their size from the answer | A judgement, no research needed |
| D-02 | **Merge PR #71**, the quality-first working agreement | **CTO** | The doctrine and the repo-root `CLAUDE.md` exist on no branch that is merged; until then the rules live only in `HANDOFF.md` §9 | 1 minute |
| D-03 | **Name a real security contact address** (#75) | **CTO** | A **Blocker**: `SECURITY.md` sends reporters to a public-repository feature that 404s, then falls back to "the private channel you do have", which it never names. There is no route in | 1 address, then a one-line commit |
| D-04 | **Run topology spike arm B** (NVDA) and accept or reject ADR-0005 (#102) | **CTO** | ADR-0005 stays `Proposed`. Not release-blocking — two-process shipped and is safe either way — but it is the only open item on this page that is five minutes of work | 5 min on a Windows 11 machine; script is `spike/topology/README.md` B1–B5 |
| D-05 | **Windows signing identity**: Azure Artifact Signing, or a cloud-HSM OV/EV certificate | **CTO** | Any release. Unsigned means a SmartScreen dialog on every download, and it is what makes an update feed unsafe | Money + a vendor choice. See §"Signing" below |
| D-06 | **Is macOS in v1?** | **CPO** | Packaging is configured and has never been executed. Dropping it removes the Apple Developer programme from the v1 budget | A judgement |
| D-07 | **Branch protection**: pay for a plan, or accept no enforcement (#74) | **CTO** | Nothing enforces review. No merged PR has ever carried one. In its absence the only gate is a person choosing to refuse a merge | Money |
| D-08 | **The lint rule underneath the react-refresh bump** (#105) | **CTO** | Nothing today, but it has now been deferred twice and will return a third time. 0.5.3 emits 11 warnings, all on `Object.freeze(...)` exports; 0.4.26 lints the same files clean. The tree did not change, the rule did. Three options are stated in #105 | 1 minute, once |

---

## 2. DECIDED

| # | Decision | Called by | When | What was decided |
|---|---|---|---|---|
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
| D-20 | **The tracker carries the taxonomy, not just this file** | Owner | 2026-08-03 | Six labels created — `blocker`, `correctness`, `contract`, `testing`, `decision`, `docs` — and applied. The grouping in `HANDOFF.md` §7 existed **nowhere but that file**, so it died with it. The eleven issues that were off the milestone are on it: it now reads 57 open / 12 closed rather than 47 / 11 |

---

## 3. Line of sight to v1

**Eight steps. One of them cannot be sized until #65 runs, and pretending otherwise
is what makes this feel endless.**

| Step | What | Status |
|---|---|---|
| 1 | Merge PR #104 — the pre-#65 prep | CI green, ready |
| 2 | D-02: merge or reject PR #71 | Waiting on CTO |
| 3 | **Run #65.** Go / no-go on the whole project | Waiting on owner |
| 4 | **Fix what #65 finds** | **UNKNOWN SIZE until step 3 runs.** This is the honest gap |
| 5 | Application icon — the build currently logs `default Electron icon is used` | Not started, ~1 hour |
| 6 | D-05: signing identity | Deferred by D-10 |
| 7 | Version bump, CHANGELOG, tag `vX.Y.Z` | Not started, ~1 hour |
| 8 | `docs/RELEASE.md` §2.3 and §3 — signature verified with the platform's own tool, clean-VM SmartScreen run | Not started, ~half a day |

Steps 5, 7 and 8 are roughly one session together once step 4 is known. **Steps 1 and
2 can close today.**

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
