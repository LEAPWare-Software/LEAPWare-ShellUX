# HANDOFF — LEAPWare ShellUX

Last updated **2026-08-03**, by a session whose whole job was re-deriving §0's numbers
after the pivot merged. Read this before touching anything. Correct anything you find
stale, but do not delete a finding without checking it.

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

**Rewritten 2026-08-03. Re-derived 2026-08-03 (later session) — the deltas from that
re-derivation are folded in below and throughout §3, §6, §7, §8 and §12.** Re-derive
every SHA and every count again before trusting it — see §0.

### IN FLIGHT: PR #115, `design/redesign-groundwork` → `main`, OPEN and unreviewed

**This section said "NOTHING IS IN FLIGHT" and was stale for a whole branch.**
Recorded rather than quietly overwritten, because §0 exists for exactly this.
Re-derived 2026-08-04.

**Nine commits, 21 files, +2069 / −320 against `main`.** Three layers, and they
are worth separating when reading:

| Commits | What | Issue |
|---|---|---|
| `73ee90e` … `6ba6053` (six) | Documents only — the UI audit, `PRODUCT.md`, the shape brief, the withdrawn WCAG 2.2 AA target, a compressed `CLAUDE.md`, six decisions closed in the register | — |
| `ce1d97a` | Wave 1 of the redesign — chrome becomes its own plane, the accent becomes petrol | — |
| `af6fdd9`, `c919e6d` | Pane 3's composer docks; the collapsed pane split sums to 100 | **#110**, **#114** |

**Five UI defects were filed off the running application, #110 through #114.** The
PR closes two: #110 (composer never docked, ~450px of dead pane) and #114 (panes
opened summing to 83 and warned on every load). **#111, #112 and #113 are
untouched** — all three are chart-title and chart-contrast work in
`echartsRenderer.ts` and `chart/*`, a disjoint file set, and they are the next
change.

**Both fixes were mutation-probed, and one probe changed the work.** Reverting
`flex flex-col` on the pane body left the docked-footer browser case GREEN — the
footer docks off the section's own column and never asked anything of the body's —
so citing that file as the class's guard was an overclaim, caught before merge. A
second case now guards the half that had nothing. A third finding came from review
rather than a gate: the composer's WIDTH was unmeasured by both lanes after it
stopped drawing its own chrome, and is now asserted.

**Gates at the branch tip:** `npm run verify` exit 0, all ten stages, 1742 tests,
100% on all four metrics, pasted in PR #115's body. `npm run test:browser` 54 of
54. **Read the exit code carefully if you re-run it** — piping `verify` into
`tail` reports `tail`'s status, which cost this session two false "exit 0"
readings before it was caught.

**Not done, and it is the whole of what is left before merge:**

- **Nobody has reviewed PR #115.** Rule 1 wants adversarial review before merge and
  this has had none. #74 records that branch protection is impossible on this
  repository, so nothing mechanical will stop a merge without one.
- **No person has seen either fix in the packaged Electron app.** The guards are
  Playwright's, in Chromium, from the dev server — which is #61's point, unchanged.
- **Wave 1's colour decisions have no reviewer either.** `tokens:check` and
  `e2e/theme.spec.ts` gate the ratios; neither is a judgement about whether it
  looks right.
- **The PR is not split.** The six documentation commits and wave 1 could have been
  their own PR and were not. `af6fdd9..c919e6d` is the fix-only range.

### `pre-65-prep` MERGED as `9929410` (PR #104)

**Read `docs/DECISIONS.md` first, not this file.** The decision register is new and it
is where the open questions now live — one row each, who calls it, what it blocks,
what it costs to decide, plus a line-of-sight table to v1. This file remains the
crash-recovery record; the register is the thing to act on. There is also a
`scrum-master` agent at `.claude/agents/scrum-master.md` — invoke it with "where are
we" and it re-derives from `git` and `gh` rather than reading state off a document.

**Tracker state, re-derived 2026-08-03 after the merge: 54 open issues, milestone 54
open / 17 closed, and ONE open PR — #71.** Six labels now carry the §7 taxonomy on the
tracker itself, so it no longer lives only in this file.

**A GitHub detail that cost three manual closes and is worth knowing:** `closing #83`
in a commit subject **does not close anything**. GitHub's keywords are
`close`/`closes`/`closed`, `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved` —
**`closing` is not one of them**, though `Closing #27` in a body did work. #83, #81 and
#90 were closed by hand, each after checking the fix on `main` rather than trusting the
commit message. This is the mirror of §11's trap: that one is about closing something
by accident, this one is about believing you did when you did not.

### What landed on 2026-08-03

**The one decision this branch is FOR.** The project's real open question is not
technical: the shell is built, nobody has shipped it, and the only two extensions in
existence are mocks this project wrote to test itself. **#65 — build one real
first-party module against the contract, by someone who did not design it — is the
cheapest test of whether this project should continue.** The owner has chosen to run
that test and this branch is the preparation for it: it fixes the things that would
make #65 measure the wrong thing, and **deliberately leaves the contract gaps open,
because which of them actually bite is the experiment's output.**

| Commit | What | Issue |
|---|---|---|
| `715f14f` | every count in this file re-derived after the pivot merged | — |
| `33ce56e` | CI runs all ten `verify` stages; four had no leg anywhere | **#58** |
| `67ac6c7` | `subscribe` validates its argument; one `undefined` wedged every later write | **#83** |
| `e8c8137` | `DatabasePlugin` supplies the icons it declares — the C A C rail was still live | **#81** |
| `0afd218` | three passages describing shipped code as unbuilt | **#90** |
| `9cb2226` | a copyable example extension, registered and driven by a test | **#52**, partial |
| `59a06c3` | the icon case asserts the tree, not a 280-row mount | — |
| `832888b` | `docs/DECISIONS.md`, the `scrum-master` agent, and the stale ISSUE-00N statuses | **#27** |
| `5b0e5c5` | the register records what the tracker sweep decided | — |

**The tracker sweep that followed, same day.** #94 closed — stale on arrival, all three
Dependabot PRs it named were already closed. #58 commented and left closed. Six labels
created and applied. The eleven issues that were off the milestone are on it. #36
(`@types/node`) merged green; **#96 closed** because it is red on all three Verify legs
and the reason is a doctrine question, now **#105**; **#97 closed** because `npm ci`
fails before any test runs — it is a React 19 **migration**, now **#106**, deferred
until after #65 so the substrate does not move underneath the experiment.

**Left open ON PURPOSE, and re-opening them early destroys the signal:** #17
(lifecycle hooks), #16 (immutable nav tree), #80 (no way to clear a badge), #91
(`VirtualizedList` selection), #57 (conformance kit), #28/#32/#68 (contract
versioning). Each is a plausible thing #65's author will hit. **Fixing them first is
deciding the gaps from inside, which is the one thing #65 exists not to do.** The
deliverable of #65 is the author's friction log, not the module.

**Not spent, deliberately:** no signing certificate, no paid GitHub plan, no feed
host. All three would buy a release for a product with no proven consumer. The Tier 1
release path in `docs/RELEASE.md` stays valid whenever it is wanted.

**Two things found while doing the above, both worth more than the fixes:** #58 was
**closed as `COMPLETED` while every stage it named still ran nowhere**, and
`check:citations` **refused a commit** whose evidence cited `RibbonToolbar.test.tsx` —
a file Phase 4 deleted. Both are the gates and the re-derivation rule working.

### THE PIVOT IS BUILT AND MERGED. All nine phases are on `main`.

`origin/main` is at **`1d2f8a5`**, a HANDOFF-only commit on top of **`21cf3e0`**, the
merge of PR #101, which followed PR #100. Nothing is outstanding on a branch.
**Everything below is on `main`**: `npm run verify` exit 0 across ten stages, 1,733
tests in 72 files, 100% statements/branches/functions/lines, 0 vulnerabilities in
**both** trees, 230 tracked files at 0 portability violations, 51 Playwright.

**The counts were re-measured 2026-08-03** with `npx vitest list` and
`npx playwright test --list`: **1,733 in 72 files** and **51 in 9 files**, both exact.
`verify` chains **ten** stages, confirmed by reading `package.json` — `tokens:check`
was added and §12's list of nine was written before it. `verify` itself was **not**
re-run: `main` is docs-only on top of `21cf3e0`, and §11 records this machine
OOM-killing coverage runs.

Both PRs passed all five CI checks — three OS `Verify` legs, the browser lane and
the new declared-Node-floor job. Neither was reviewed by a person; nothing
mechanical requires it, and that is §5 rather than an oversight.

**#102 (the topology spike's NVDA arm) and #103 (the update feed) are the two open
items that block the pivot, and both are decisions rather than work.** Read those two
first. **Do not read that as "two issues are open" — an earlier revision of this line
said exactly that and it was false.** Re-derived 2026-08-03: **58 issues open**, 47 of
them on milestone 1. See §7.

| Commit | What landed | Plan item |
|---|---|---|
| `a9a7a69` | packaging, signing configuration, auto-update from a feed | **Phase 9** |
| `5da912f` | visualization in all three panes; pane 3 takes input | **Phase 8** |
| `3745548` | the cross-process state design, proven in-process; topology ADR | **Phase 6** |
| `8127029` | pane-1 metrics, structured payload channel, live dimensions, theming | **Phase 5** |
| `abf25bf` | vitest 4 / vite 8 — both CVSS 9.8 criticals gone; the Node floor | §6.2 |
| `673d75d` | the desktop host wired up and launched | **Phase 1**, closes **#39** |
| `c082e9a` | the ribbon deleted for one command registry and four surfaces | **Phase 4** |
| `cc756b0` | claims that outran their evidence, corrected | — |
| `7d87867` | every colour in the shell is a token | **Phase 3** |
| `c02456b` | the two confirmed-vacuous tests now assert what they name | §8 item 8 |
| `72ff274` | the collapse round trip and the false sentinel no longer destroy layouts | **Phase 0b** |
| `719c818` | a root error boundary, and the `when`-expression evaluator | §8 item 7 |
| `e6266f9` | the generative token pipeline | **Phase 2** |
| `971348d` | the Phase 1 native-host source — unwired at the time | **Phase 1, partial** |
| `57a7554` | the Dependabot triage | §8 item 9 |
| `b4da5f2` | the `patternFor` trailing-placeholder hole is closed | **Phase 0c** |
| `deaf83c` | the two host constants are frozen | §6.2 |
| `863685e` | the working demo is served at `/` | **Phase 0a** |

**Gate state at `a9a7a69`:** `npm run verify` exit 0 across ten stages — 1,667 tests
in 66 files, 100% statements/branches/functions/lines, 0 vulnerabilities in **both**
trees, 204 tracked files at 0 portability violations — plus 51 Playwright.

**Three things were observed, not asserted.** A native window was launched and
screenshotted. `verify:desktop` produced a 105.6 MB NSIS installer and a `latest.yml`
carrying a SHA-512 over it. The packaged app was probed over CDP: it read its baked
`app-update.yml`, contacted the feed, returned `net::ERR_NAME_NOT_RESOLVED`, and
`Ctrl+K` listed "Check for updates — last check failed" beside the host commands.

### Phase 7 IS built, as two processes — and it is MERGED

**Corrected 2026-08-03.** This section used to head "on branch `topology-spike`". PR
**#101 squash-merged that branch** as `21cf3e0`, so `f378329` is **not** an ancestor of
`main` while its content is. Verified: `git diff origin/main origin/topology-spike`
touches **`HANDOFF.md` only**. The branch still exists locally and on the remote and is
2 behind / 5 ahead by commit count — that is squash-merge bookkeeping, not outstanding
work. Nothing needs to be merged from it.

`f378329`. Host chrome renders the context bar, pane 1 and the palette; one
extension renderer holds panes 2 and 3, the ledger and the composer. Activating an
extension in pane 1 fills panes 2 and 3 **in the other document**, and Ctrl+K from
the extension view opens the palette in host chrome — context crosses both ways.
1,733 tests in 72 files, `verify` exit 0.

**Two-process was chosen because it is safe under either spike outcome**, not
because the spike returned. If arm B comes back clean, three-process becomes an
additive change; if it comes back bad, two-process already shipped. Building
three-process first would have been the bet that cannot be unwound. **ADR-0005 is
still `Proposed` and this commit does not decide it.**

**An earlier build of the same phase put a complete `ShellLayout` in BOTH views** —
two whole shells side by side, with Phase 8's ledger in neither, and a green suite
over it. That version was not committed. The defects that fixed it were all found
by looking at the window: a restored pane-2 share that made the two panels sum to
75, two documents racing over one `localStorage` key until **both** showed nothing,
and an `activate()` that moved a ref without re-rendering.

**Named limits, not fixed:** the context bar and palette are shell-wide chrome
living in a 282px view, so the bar scrolls and the palette renders as a
left-aligned strip; there is no draggable divider between the two views, because a
pointer drag does not cross a native view edge; and `HydrationEngine` and
`AuthoritativeStore` did **not** move to main — `electron/tsconfig.json` is
`NodeNext` and every relative import in `src/` is extensionless, so that graph
gives `TS2835` on every import. `AuthoritativeStore` runs in host chrome's document
and main is a relay. Amendment O records two routes and takes neither.

### What is NOT done, and why each one is blocked

- **Tracked as GitHub issue #102.** **The topology spike's human arms.**
  `docs/adr/0005-pane-topology.md` stays **`Proposed`**. `spike/topology/` holds a
  throwaway two-view app and every machine-observable measurement (`baf3399`);
  **arm B needs NVDA on Windows 11 and is what decides the ADR** — the B1–B5 script
  is in `spike/topology/README.md` and takes about five minutes. Arm A needs
  `inspect.exe`; arm C needs a Mac.
- **Tracked as GitHub issue #103.** **The update feed host was INVENTED, and it has
  been removed. Read this one.**
  Phase 9 shipped `electron-builder.yml` pointing at `updates.leapware.dev`. That
  host was written to look plausible under the project's brand; **this organisation
  does not own `leapware.dev`.** The apex resolves to a netblock belonging to
  somebody else, and an earlier revision of this very section cited that resolution
  as proof the domain was "real and controlled" — it proved only that *someone*
  owns it.

  **Why this was a security defect rather than a naming mistake.** With
  `provider: generic`, that one URL is the sole authority for both the `latest.yml`
  manifest **and** the installer the manifest names. A shipped application would
  have asked a stranger's server what to download and then run it, and nothing this
  project builds is signed, so signature verification would not have refused the
  answer. Remote code execution by configuration. Caught before any release, any
  tag, or any user holding a build — but it was on `main`.

  `publish` is now unset, `DOCUMENTED_ENDPOINTS` is empty, and the hostname rule is
  fully on again, so an accidental re-introduction fails the build.

  **The decision this leaves open is smaller than it looks.** `electron-updater`'s
  GitHub provider was rejected because the repository is *private* — release assets
  would need a token inside the shipped client. **On a public repository those
  assets are plain public URLs and the provider needs no host, no DNS and no
  bucket.** So going public collapses this blocker entirely, and it is the same
  decision that resolves §5's branch protection and §6.2's vulnerability reporting.
  Three blockers, one choice. The alternative is owning a static HTTPS host and
  declaring it in the three places `docs/RELEASE.md` §1 enumerates.
- **Nothing is signed and no certificate was sought.** macOS packaging is configured
  and never executed — unbuildable from Windows.
- ~~**An engines split-brain, until #100 merges.**~~ **RESOLVED — #100 merged as
  `e3078db`.** Re-derived 2026-08-03: `package.json` on `main` declares
  `"node": "^22.13.0 || >=24"`, which is the raise, so the window where `main`
  advertised Node 20.19 while carrying jest-dom 7 is closed. The finding is kept only
  for its mechanism: **no CI leg exercised the declared floor**, because every workflow
  reads `.nvmrc` (`24`). #100 also added the declared-Node-floor job that closes that.

**One working tree, one git writer — §1b, and it has already cost a commit on the
wrong branch.** If you are resuming and the tree is dirty, the dirt is not yours.

### 2026-08-03, later: the queue is empty and #65 is the only thing in the way

**Zero open pull requests. 53 open issues. `main` at `6caac51`, tree clean.**

- **PR #71 MERGED** (`3bee328`). `CLAUDE.md` and `docs/adr/0003-quality-over-velocity.md`
  are on `main`, so §9 of this file is no longer the only home of the doctrine —
  **replace §9 with a pointer to those two files**, which is what §9 itself asks for.
- **PR #108 MERGED** (`6caac51`). `SECURITY.md` names `leapware@outlook.com`, closing
  **#75** — a Blocker, closed without going public and without spend.
  **The same PR corrected `CLAUDE.md` on the day it merged**, because #71 branched
  before the pivot and arrived saying `verify` is nine stages, that CI runs five of
  them, that `npm run dev` renders an empty shell and that #39 is open. Four claims,
  all false on arrival, in the one file auto-loaded into every session. Its own rule 3
  is why that was fixed rather than filed.

**The decisions board is at [`docs/DECISIONS.md`](docs/DECISIONS.md): six open, and
not one of them is work.** D-01 third parties (#93) and D-06 macOS-in-v1 are
judgements for the CPO; D-05 signing and D-07 branch protection are money; D-04 is
five minutes with NVDA (#102); D-08 is a one-minute call (#105). **None of the six
blocks #65.** They block a release.

**So the honest state is: nothing stands between this repository and #65.** What
stands between it and v1 is step 4 of the line-of-sight table — *fix what #65 finds* —
which cannot be sized until #65 runs. That is the whole reason it goes next.

### Still open from before the pivot, and still unmerged

- **PR #71, `quality-first-agreement`, `c82bfe1` — OPEN, CI green, not merged.** It is
  the only home of `docs/adr/0003-quality-over-velocity.md` and the repo-root
  `CLAUDE.md`; neither exists on `origin/main`, so **until it merges the quality
  doctrine lives only in §9 of this file.** One checkbox is deliberately unticked —
  "parallel work is disjoint" — with the reason beside it, because disjointness could
  not be verified from inside the branch. That is the doctrine working, not a defect.
  See §8 item 4, and read it next to the paragraph above: the pivot is the largest
  change in this repository's history and §5 means nothing enforces review of it.

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

**This section describes 2026-08-01 and is kept for that. It predates the pivot — read
§1 first, and do not take "the next phase is remediation" as current.**

LEAPWare ShellUX is a pluggable desktop UI shell host. All five originally planned work
items (ISSUE-001 through ISSUE-005) are built and merged. A full audit on 2026-08-01
found the result **is not production-ready**; the next phase is remediation, tracked in
the milestone **Phase 2 — Production Readiness**.

**What changed after that:** the owner redirected the project on 2026-08-02 (§1), and
the nine-phase native-host pivot is now built and merged — Electron host, ribbon
deleted, tokens, three-pane visualization, packaging. The milestone still holds 47 open
issues, so remediation did not go away; it stopped being the only thing in flight.

---

## 3. Repository state

**This table was re-derived 2026-08-03** — `git fetch --all --prune`, `git branch -vv`,
`gh pr view`. It will go stale again; per §0 the numbers here are a starting point, not
a source of truth.

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `1d2f8a5` | **Re-derived 2026-08-03.** A HANDOFF-only commit on `21cf3e0` (PR #101). **Everything is here** — all nine phases, both PRs. |
| local `main` | `1d2f8a5` | **Re-derived 2026-08-03.** Level with `origin/main`, checked out, working tree clean. |
| `native-host-phase-0` | `abe86c0` | **MERGED via PR #100 (`e3078db`).** No longer the live work. Branch preserved local and remote. |
| `topology-spike` | `e033397` | **MERGED via PR #101 (`21cf3e0`), squashed** — so `f378329` is not an ancestor of `main` though its content is. Only `HANDOFF.md` differs between the two. See §1. |
| `origin/browser-test-lane` | `da7d89e` | **Merged** via PR #70. Branch preserved. |
| `origin/quality-first-agreement` | `c82bfe1` | **PR #71 still OPEN — re-derived 2026-08-03. The one piece of unblocked work in this file.** See §1 and §8 item 4. |
| `origin/phase-1-hotkeys` | `a1df19d` | Merged content; branch not deleted. |
| `origin/phase-2-shell` | `b80cad0` | Merged via PR #33. |
| `origin/docs-security-sweep` | `4509c38` | Merged via PR #56. **Was fast-forwarded to `868fe88` in a local tree by an agent outside its remit — see §11.** |
| `dependabot/*` remotes | — | **Re-derived 2026-08-03: the five this row used to name are PRUNED.** #34, #35 and #38 are **CLOSED**; #37 is **MERGED** (`3a110a3`). Three new ones are open — **#96, #97, #36**. See §7. |
| `origin/handoff`, `origin/handoff-audit-2` | — | `handoff-audit-2` is what PR #72 merged. |

> **FIRST ACTION for a new session:** re-derive this table — `git fetch --all --prune`,
> then `git log --oneline -1 origin/main` and `git status`.
> **Both of this line's previous warnings are now obsolete, and there is no replacement
> hazard.** It once warned that local `main` predated the shell merge; then that the
> pivot sat unmerged on `native-host-phase-0` and a session on `main` would find no
> tokens, no root boundary and no `when.ts`. **Neither is true.** `main` carries
> everything, the tree is clean, and no branch holds work that `main` lacks. Checking
> out `main` is now the correct thing to do. Read §1 anyway — for what is *decided* and
> what is *open*, not for where the code is.

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
**BOTH CLOSED 2026-08-02 by `72ff274`, MERGED to `main` via PR #100 (`e3078db`).**
The rows below are the finding as filed. **Two of their numbers were wrong**, and the
fix measured rather than repeated them:

| Finding as filed | Location | Fixed, and what the measurement corrected |
|---|---|---|
| ~~Collapsing and re-expanding pane 1 discards the user's layout and persists an **internally inconsistent** record. Measured percentages `40/36/40` sum to 116%.~~ | `ShellLayout.tsx:731` | The round trip was real: instrumented at 1000px, a dragged `pane2 = 42.4` came back as `36`. **But `40/36/40 = 116%` conflated two mechanisms and the sum has nothing to do with collapsing** — `pane3`'s slot was simply never written when only the first divider moved, so the record read `17.6/42.4/56 = 116` *before* any collapse. Both mechanisms are fixed; writes are now whole layouts, so the record divides the whole. |
| ~~`hasRestoredLayout` is a false sentinel inferred from object identity, so **any** persisted write discards the pixel-intent table permanently. At 1920px viewport the nav pane opens 38% wrong.~~ | `ShellLayout.tsx:733-736` | Confirmed and replaced with `isEngineDefaultLayout`, which compares by value. **The magnitude was 44%, not 38%** — measured in a real browser at 1920×900, pane 1 opening at 344.16px instead of 238.77px, 105.4px too wide. The measurement is recorded here in place of the estimate. |

**Two things were deliberately NOT fixed and are recorded rather than closed:** on
expand, pane 1 returns to its mount-time width rather than the width dragged this
session, because `defaultSize` reads the mount snapshot and making it live would break
ADR-0001 Amendment K Decision 6; and `pane3`'s stored slot is now true but still
write-only, because `detailDefaultPercent` is always the remainder and never reads it.

### 6.2 Security

- ~~`SHELL_UX_ERROR_CODES` (`types.ts:770`) is **not frozen**. Shadowing `.has` lets a
  plug-in choose the error code `register()` returns, including masquerading as
  `REVOKED`. This falsifies a claim `SECURITY.md` labels an *unconditional* integrity
  control.~~ ~~`HYDRATION_LIMITS` (`HydrationEngine.ts:211`) is `as const`, not frozen —
  the exact defect issue #10 closed for `REGISTRY_LIMITS`, reintroduced.~~
  **BOTH CLOSED 2026-08-02 by `deaf83c`, MERGED to `main` via PR #100 (`e3078db`).**
  Both are now `Object.freeze`d, `SECURITY.md` was corrected in the same commit, and
  **the structural half of the recommendation landed too**: `hostConstants.test.ts` no
  longer carries a hand-maintained freeze list but a discovery scan over the modules'
  own exports — which is what stops a third reintroduction. Note the standing caveat in
  §11 still applies and is asserted rather than assumed: freezing a `Set` does not stop
  `.add()`, and the test says so in its own title.
- **The recommendation that produced that is worth keeping as a rule:** a
  hand-maintained list of things-that-must-be-frozen is how the second one got in.
  Prefer a test that walks the exports.
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
- ~~**No top-level error boundary.** Any throw above `ShellLayout` is a white screen.~~
  **CLOSED 2026-08-02** by `719c818`, MERGED to `main` via PR #100 (`e3078db`).
  `src/components/error/RootBoundary.tsx` exists and is exercised by 20 cases in
  `src/components/__tests__/RootBoundary.test.tsx`. **Do not read it wider than it is:**
  it is a React error boundary, so it contains a throw during render, and it is neither
  a sandbox nor a catcher of `setTimeout` throws or rejected promises — the same scope
  limit §6.5 and `README.md` already record for `FaultBoundary`. §8 item 7 should be
  marked done, and the Electron argument in it now applies to a boundary that exists.
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
- ~~`DEVELOPER.md:1849` tells extension authors that a containment guarantee does not
  exist when it does — and contradicts itself about 500 lines earlier.~~ **CLOSED
  2026-08-03 with the other two passages of #90.** All three described shipped, tested
  code as unbuilt: the ADR's **header banner** said "nothing in `src/` evaluates a
  predicate or catches a render error yet" (`ribbonAction.ts` and `FaultBoundary.tsx`
  both existed); the persistence paragraph said neither `ShellLayout` nor `App.tsx`
  reads or writes persisted state (`ShellLayout` does both, in four places — and two
  data-destroying defects have since been fixed *in* that path); and `DEVELOPER.md` told
  authors a throwing predicate "will not be contained by anything" while saying the
  opposite, correctly, 570 lines earlier. The ADR corrections are dated superseding notes
  per its own convention rather than in-place edits.
  **Two things worth keeping from it.** The persistence sentence had *already* been
  superseded once — the 2026-07-31 note corrected the claim that the **engine** did not
  exist and never touched the clause about the shell using it. The machinery worked and
  was applied one clause too narrowly, which is the failure mode to watch for.
  And the fourth passage an audit reported — "no `icon` field on the blueprint" — **is
  true and was deliberately left alone**; the ADR is correctly scoped there and records
  its own earlier error.
  **The sweep #90 asks for was run rather than promised.** A grep over all 20 tracked
  Markdown files for `not yet …` / `does not yet` / `still decision only` / `nothing in
  src/` returned four live hits beyond the three fixed, and **all four triaged clean**:
  `README.md:160` and `:1314`, `design/README.md:272` (which explicitly says "do not
  write it in the present tense anywhere") and `docs/adr/0001-…:3584` on unforwarded
  chords. They are honest current limits, not stale claims. **A permanent checker was
  NOT built** — #90 suggests one and it is a real idea, but a gate needs its own tests
  and its own portability surface, and that is a separate change rather than a rider on
  this one.

### 6.5 Test integrity

**The coverage number is real but narrower than it reads, and the mutation result is
genuinely good. Both halves matter.**

> **NOT RE-DERIVED 2026-08-03, and every input to it moved.** The ratio below is
> **pre-pivot**. Tracked files went 204 → 230, tests 1,667 → 1,733, and the pivot added
> `electron/`, `src/core/ipc/` and the token pipeline — none of which existed when
> 9,733/13,484 was measured. **Open issue #89 already cites a different denominator,
> 13,608**, so this file and its own tracker disagree. It was deliberately not
> re-measured: the ratio needs `test:coverage`, which §11 records being OOM-killed twice
> on this machine. **Re-measure before quoting either number.** The *mechanism* below is
> unaffected and still holds.

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

**Two confirmed vacuous tests — BOTH FIXED 2026-08-02 by `c02456b`, MERGED via #100.**
Both were re-verified by mutation before the fix, and the table below is that record.
**Read the first row's resolution, because it settles the contradiction underneath it:**
the collapse case no longer pretends a drag occurred. It now pins the *limit* — it
asserts the handle is still `data-resize-handle-state="inactive"`, that no pane moved,
and that the unmount re-normalises the survivors to the exact pair `[47.4, 52.6]` — and
the drag half moved to the browser lane, `e2e/pane-dividers.spec.ts`, where a real
pointer can put the handle into its `drag` state before the collapse. `.github/ISSUES_MANIFEST.md`
was corrected to describe that split rather than to claim a drag under jsdom.

| Test | Mutation applied | Result |
|---|---|---|
| `ShellLayout.test.tsx:476` — the collapse-during-divider-drag case | Deleted all three `fireEvent.pointer*` lines | **39/39 still pass.** The assertions only check track width, separator count and pane sum, none of which the drag touches. **[reproduced]** |
| `IntegrationSuite.test.tsx:973` — the badge-timer case | Emptied the `setInterval` body at `DatabasePlugin.tsx:645` | **Still passes.** Both assertions are shape-only regexes, and one reads the value captured *before* the clock advanced. **[reproduced]** |

`IntegrationSuite.test.tsx:1300` fires the identical pointer sequence as the first one
and **correctly titled it as impossible in this jsdom**. Two files, same mechanism,
opposite claims — and the integration file was the one telling the truth. **Measured
against `react-resizable-panels` 2.1.9:** `getResizeEventCoordinates` reads
`clientX`/`clientY` only when the event reports `isPrimary`; jsdom's plain-`Event`
fallback carries neither, so the library receives `{x: Infinity, y: Infinity}` and the
handle never leaves `inactive`. Supplying a `PointerEvent` constructor does not rescue
it — probed directly. **No pointer drag is reachable under this jsdom at all**, which
is §11's first trap stated as a mechanism rather than as folklore.

### 6.6 `check-citations` had a hole that made it partly ornamental — CLOSED 2026-08-02

**Closed by `b4da5f2`, MERGED to `main` via PR #100 (`e3078db`), which is Phase 0c.**
The measurements below are kept because they are the record of what the hole was and how
it was quantified, and because §11's trap row and Phase 4's risk both rest on them. Read
them in the past tense: a trailing placeholder no longer degenerates to a prefix match,
so a near-miss title now fails the gate instead of resolving vacuously.

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

**Re-derived 2026-08-03** with `gh issue list` and the milestones endpoint. **See §0 —
re-derive again, do not trust these.**

- Milestone 1 — **Phase 2 — Production Readiness**: **47 open, 11 closed.** Was 35/0 on
  2026-08-01.
- **58 issues open in total, 27 closed.** So **11 open issues are NOT attached to the
  milestone: #59, #60, #61, #62, #63, #64, #65, #66, #68, #102, #103.** The old "#58
  through #68" reading is stale — #58 and #67 are gone from the open list and the two
  pivot decisions are new. **Sweep the eleven on**, or decide the milestone is not the
  instrument for the two decisions.
- **4 PRs open: #71 (the quality agreement, not a bump) and three Dependabot — #96, #97,
  #36.** The old "#34–#38, all Dependabot" row is dead: **#34, #35, #38 CLOSED**, **#37
  MERGED** (`3a110a3`), and their remote branches are pruned.
- **The table below is the 2026-08-01 grouping and has NOT been re-grouped.** Issues
  filed since — #74, #75, #80, #81, #83, #85, #86, #89, #90, #91, #92, #93, #94, #95,
  #102, #103 — appear in the open list above and in no row here. Several are the audit
  findings in §6 filed at last, and **#93 is §4 and #74 is §5**, so the two "no issue at
  all" entries below are now filed. Re-group before using this taxonomy for planning.

| Group | Issues |
|---|---|
| **BLOCKER** | ~~**#39 — nobody has ever run the app.**~~ **CLOSED by `673d75d`** (Phase 1) — a native window was launched and screenshotted, see §1. The **three items with no issue** are now filed: routing the demo to `/` was done (§6.3), the §5 enforcement gap is **#74**, and §6.2 vulnerability reporting is **#75**. |
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
| 5 | **The two layout defects** (`ShellLayout.tsx:731`, `:733-736`) | **Phase 0b — LANDED 2026-08-02 as `72ff274`, MERGED via #100.** Kept ahead of the pivot deliberately: item 3 makes this an artifact a human is now asked to run, and two data-destroying defects in a demo is not acceptable. The pivot later deletes the code they live in — the value is one correct release plus a browser-lane regression test that survives as a behavioural spec. |
| 6 | **The two `Object.freeze` lines** (`types.ts:770`, `HydrationEngine.ts:211`) | **LANDED 2026-08-02 as `deaf83c`, MERGED via #100** — and landed the right way: the hand-maintained freeze list in `hostConstants.test.ts` was replaced by a scan over the modules' own exports, so the third regression has somewhere to fail. See §6.2. |
| 7 | **Root error boundary** | **LANDED 2026-08-02 as `719c818`, MERGED via #100** — `src/components/error/RootBoundary.tsx`, 20 cases. The pivot argument stands and now has something to point at: an Electron renderer throw above the boundary would otherwise be a blank native window. Scope limit in §6.3. |
| 8 | Fix the two vacuous tests and the `patternFor` hole | **Both halves LANDED 2026-08-02, MERGED via #100** — `b4da5f2` closes the `patternFor` hole (Phase 0c) and `c02456b` makes the two confirmed-vacuous tests assert what they are named for. The Phase 4 argument is why the order mattered: deleting the ribbon renames many cited titles at once, which is exactly when a prefix-match hole stops being theoretical, and Phase 4 is in flight now. |
| 9 | Triage the red Dependabot PRs | **DONE 2026-08-02** — full findings in [`docs/dependabot-triage.md`](docs/dependabot-triage.md). **#35 and #38 closed.** The lead finding is not about any single PR: `.github/dependabot.yml` caps the queue at 5 with majors deliberately ungrouped, all five slots were full, and the fixes for the two CVSS 9.8 criticals in `vitest` are three ungrouped majors needing three free slots. So CI could not *see* the criticals (§6.2 — `audit:prod` omits dev) **and** Dependabot could not *offer* the fix. Two slots are now free. ~~**#37 is green and CI is structurally blind to its breaking change**~~ — **RESOLVED, re-derived 2026-08-03: #37 MERGED (`3a110a3`), `engines` on `main` is now `^22.13.0 || >=24`, and #100 added the declared-Node-floor job that no workflow used to provide.** #34 has since been **CLOSED**, along with #35 and #38; the doctrine question it raised — 11 new warnings all sitting on `Object.freeze(...)` exports, which 0.4.26 lints clean — was **not** answered by closing it, and **#96 re-proposes the identical bump**. Answer it there. |
| 10 | Everything else, by milestone priority | Re-triage against the pivot — the ribbon's deletion closes or moots several documentation issues. |

---

## 9. The quality doctrine

**PR #71 MERGED 2026-08-03 as `3bee328`, and this section is now a pointer, exactly as
its previous text instructed.**

- **[`CLAUDE.md`](CLAUDE.md)** — what to *do*. Auto-loaded into every session in this
  repository, which is the whole point of merging it: the rules used to hold because
  whoever was working had read §9 of this file.
- **[`docs/adr/0003-quality-over-velocity.md`](docs/adr/0003-quality-over-velocity.md)**
  — why, with the incident behind each rule.
- `.github/PULL_REQUEST_TEMPLATE.md` — the same list as checkboxes.

**One warning, and it is the reason this section keeps a body at all.** `CLAUDE.md`
merged carrying **four claims the pivot had already falsified** — `verify` at nine
stages, CI running five of them, `npm run dev` rendering an empty shell, and #39 open.
All four were corrected the same day by PR #108. **A rulebook is not exempt from the
rot it legislates against**, and this one arrived with it. Re-derive what it says about
the gates before quoting it, the same way §0 asks you to re-derive this file.

The five-step review loop below is preserved because it is quoted elsewhere and because
`CLAUDE.md` states the rules rather than the loop:

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
| **`check-citations` trailing-placeholder prefix match — CLOSED, `b4da5f2`** | See §6.6. A short citation used to resolve *vacuously*; it no longer does. The trap is kept because the lesson outlived the bug: **green does not mean cited**, and the checker still only inspects quoted strings that follow a citation marker. |
| **`ISSUE-00N` (manifest) versus `#N` (GitHub) collide** | A phantom `ISSUE-006` is cited 31 times across 12 files with no manifest section defining it. Tracked as #53. |
| **`gh pr checks` returns NON-ZERO while checks are still pending** — not 0. Measured here: exit **1** on a PR with pending legs, and exit **1** on a PR with failed legs. An audit reported exit 8 for the pure-pending case; I could not isolate it. | Either way the rule holds: **a non-zero exit does not mean failed — it may mean pending.** Any script treating non-zero as failure will misread a run in progress. Read the status column, not the exit code. |
| **A branch was moved by an agent outside its remit.** A `git merge origin/main` ran while another agent held the shared tree on `docs-security-sweep`, fast-forwarding it `4509c38` → `868fe88`. | Non-destructive, already-merged content, and left in place. But it reinforces the rule: **one working tree, one git writer.** |
| **Transient probe edits alarmed two auditors.** An agent deliberately broke `ShellLayout.tsx` to prove the tests bite; two concurrent auditors read the working tree and filed it as a live defect. | Wasted two audits. **Announce a probe window before deliberately breaking a shared file — or do it in a worktree.** This update's mutation probes were all run in a throwaway worktree for that reason. |
| **Memory exhaustion on this 8GB machine** | `test:coverage` was OOM-killed twice under concurrent load. **Limit concurrency.** |
| **The machine is in a degraded state as of this writing.** ~620 MB free across ~572 processes, with orphaned `vitest` and `vite-node` processes from earlier agents still resident. `verify` died twice on resource exhaustion — exit 127 `fork: Resource temporarily unavailable`, and `-1073740791`. Playwright workers died with `spawn UNKNOWN`. | **Recommend a restart before the next session.** And the standing rule: structural-looking failures should be suspected as environmental **first**. |
| **A partial `npm install` produces *fake* failures.** A truncated `ajv` file and a missing `lib.es2022.d.ts` surfaced as bogus lint crashes and **13 phantom TypeScript errors**. A junctioned `node_modules` separately produced **104 failures** that mimicked a real predicted defect. | A new maintainer would reasonably file those as defects — and one audit nearly wrote the junction artifact into this file as a confirmed finding (§6.9). **Suspect the environment before the code when failures look structural.** Reinstall, then re-run, before believing them. |

---

## 12. How to verify anything

**Corrected 2026-08-03 by reading `package.json`. This section said nine stages; it is
TEN** — the pivot added `tokens:check` as the third. §1 said ten and this section said
nine, in the one file whose purpose is being trusted; §1 was right.

`npm run verify` chains **ten** stages, in order:

`check:portability` → `check:citations` → **`tokens:check`** → `lint` → `typecheck` →
`test:coverage` → `test:integration` → `test:scripts` → `build` → `audit:prod`

**It takes roughly 12–13 minutes**, dominated by `test:coverage` (~351s) and
`test:integration` (~199s) — **and those two overlap**, because `IntegrationSuite.test.tsx`
runs in both. **[reported]** Worth knowing, because "run verify before every commit" is
the doctrine and its cost should be stated rather than discovered.

There is now a **second, separate lane**: `npm run test:browser` runs the Playwright
suite against a real Chromium, on its own `browser.yml` workflow. **Re-measured
2026-08-03 with `npx playwright test --list`: 51 tests in 9 files** — 24 in 5 when PR
#70 merged, 42 in 7 on 2026-08-02. It is **deliberately not part of `verify`** — see
§1a. Run it when touching layout, dividers, hotkeys, theming or focus, because it is the
only thing here that can see what jsdom cannot. (It no longer covers *the ribbon*, which
Phase 4 deleted.) The jsdom suite alongside it is **1,733 tests in 72 files**,
re-measured the same day with `npx vitest list`. **The 1,263-in-35 figure this paragraph
used to carry was pre-pivot.**

**CI NOW RUNS ALL OF `verify`. This section said the opposite for its whole life and
the change is the reason to read it.** Re-inspected 2026-08-03 at `1d2f8a5` — the
workflow set is five files: `ci.yml`, `browser.yml`, `desktop.yml`,
`audit-dependencies.yml`, `audit-schedule.yml`.

| Stage | On CI? |
|---|---|
| `check:portability` | yes (`ci.yml`) |
| `check:citations` | **yes — added 2026-08-03**, was no leg |
| `tokens:check` | **yes — added 2026-08-03**, was no leg |
| `lint` | yes |
| `typecheck` | yes |
| `test:coverage` | yes |
| `test:integration` | **yes — added 2026-08-03**, was no leg |
| `test:scripts` | **yes — added 2026-08-03**, was no leg |
| `build` | yes |
| `audit:prod` | yes, in `audit-dependencies.yml` / `audit-schedule.yml`, and only with `--omit=dev` |

`README.md` claimed `verify` is exactly what CI applies, and for its whole life that was
false — **five of ten**, and the gap had widened rather than closed, because
`tokens:check` was added to `verify` with no leg either.

> **#58 tracked it and was CLOSED as `COMPLETED` while nothing had closed it** —
> re-derived 2026-08-03 with `gh issue view 58 --json state,stateReason`, and `ci.yml`
> at `1d2f8a5` ran `check:portability`, `lint`, `typecheck`, `test:coverage` and `build`
> and nothing else.
>
> **It is closed now for real: the four missing steps were added to `ci.yml`'s matrix
> job on 2026-08-03**, in `verify`'s own order, so a CI failure lands on the same step a
> laptop fails on. `README.md`'s `verify` row was corrected in the same change and now
> records what it used to claim. **Re-open #58 only to confirm and close it again, or
> leave it closed and cite this** — but do not cite the *old* #58 as an open gap.

**The cost was taken deliberately and should not be quietly trimmed later.**
`test:integration` is ~199s and overlaps `test:coverage` (`IntegrationSuite.test.tsx`
runs in both); what it adds is `--sequence.shuffle`, the only order-independence signal
here, and #64 records that it reaches one file. Three legs at macOS 10x and Windows 2x
billing is the price of `README`'s claim being true. **Running it on one leg would buy a
cheaper version of the same lie** — that argument is in the workflow comment so the next
person to look at the bill meets it.

**One narrower gap survives and is NOT #58:** `audit:prod` is `npm audit --omit=dev`, so
**the dev tree is audited by nothing on any leg.** That is §6.2's finding, it is the
mechanism that made two CVSS 9.8 criticals in `vitest` structurally invisible, and
closing #58 does not touch it.

**Two workflows exist that this section never listed.** `desktop.yml` runs
`npm run verify:desktop` — the packaging leg that produced the NSIS installer in §1 —
and `ci.yml` carries the declared-Node-floor job, which is what would now catch the
engines split-brain that §1 records. **Its provenance was checked rather than inherited
from prose: `git log -S -- .github/workflows/ci.yml` puts it in `e3078db`, PR #100.**

Two checks gate every commit and are easy to trip:

- **`check:portability`** — no absolute paths, no drive letters, no home or scratch
  directories, LF endings only, no BOM, no hardcoded network host in a tracked
  non-Markdown file.
- **`check:citations`** — never quote a test title you have not confirmed exists. It only
  inspects quoted strings that follow a citation marker. Since PR #70 its corpus includes
  `e2e/`. **The checker prints its own corpus size on every run — read that rather than a
  number written here.** Run 2026-08-03 against this update: **1,062 citations in 175
  prose files resolving against 1,770 titles in 83 test files, 7 quoted spans set aside
  as prose** — against 889 / 92 / 1,213 / 44 on 2026-08-02, and 37 test files at PR #70.
  Both gates were re-run after these edits and both pass; `check:portability` reports
  **230 tracked files, 20 rules, 0 violations**.
  **§6.6's trailing-placeholder prefix-match hole is CLOSED** — `b4da5f2`, Phase 0c, see
  §1 — so a near-miss no longer resolves vacuously.
