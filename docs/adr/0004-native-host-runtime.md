# ADR 0004 — Electron as the Native Host Runtime

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Implemented by (Phase 1 only):** `electron/main/index.ts`,
  `electron/preload/index.ts`, `electron/tsconfig.json`
- **Related:** `docs/plans/native-host-pivot.md` (the full plan and its nine
  phases), ADR-0001 Amendment E (what a boundary in this project can and cannot
  be), ADR-0002 (no local-environment dependencies — this decision owes it an
  amendment, see clause 8)

> **Most of this document is a decision, not a description.** What exists in the
> tree today is one window. The topology, the transport, the updater and the
> packaging lane are all argued here and none of them are built, and the
> distinction is kept visible in every clause rather than being made once at the
> top and then forgotten. ADR-0001's header had to be corrected three times for
> claiming implementation status it did not have; that is a mistake worth not
> repeating on a document written at the start of a nine-phase change rather than
> at the end of one. Clause 1 states exactly what Phase 1 contains. Everything
> after it is a commitment about what comes next, and clause 6 is not even that —
> it is a gate whose outcome could reverse clause 5.

---

## Context

`LEAPWare-ShellUX` is a browser-only React SPA with an IoC extension registry, a
three-pane layout and a thousand tests. It is required to become a native desktop
application with graphical visualization in all three panes, an input surface in
pane 3, multiple themes, and self-update from a release feed. The plan for that
is `docs/plans/native-host-pivot.md`; this ADR records the runtime choice the
plan depends on and the three claims about that runtime that are easiest to
overstate.

Six forces act on the choice.

1. **The product is a graphics application wearing a shell's clothes.** Pane 2 is
   hundreds of small charts mounting and unmounting under a virtualizer; pane 3
   is one chart with up to millions of points. Whatever renders those is not an
   implementation detail underneath the product — for most of the frames the user
   sees, it *is* the product.
2. **Two target platforms, Windows 11 primary and macOS.** No Linux requirement.
3. **The existing codebase is being evolved, not rewritten.** Approximately 11.6k
   non-test lines of React, Tailwind and TypeScript, held to a 100% coverage gate
   over `src/core/**`, `src/components/**` and `src/hooks/**`. Any runtime that
   does not run that DOM unchanged is not a runtime change, it is a second
   product.
4. **ADR-0002's acceptance test is binding**: a fresh clone on a different
   operating system runs `npm ci && npm run verify` with no local setup and no
   edits. A runtime that adds a toolchain outside `npm ci` does not merely cost
   convenience; it invalidates the sentence the README opens with.
5. **The accessibility commitment is WCAG 2.2 AA**, and the plan's own risk
   register (R1) says the multi-view topology may break it in a way no visual
   affordance fixes.
6. **Third-party extensions are undecided**, which ADR-0001 Amendment E turns
   into a firm condition rather than an open question: the isolation boundary has
   to stay swappable, because the day third parties become real is the day
   Amendment E's trigger fires and per-*extension* isolation is owed.

---

## Decision

### 1. Electron 43.x is the native host. Phase 1 is one window and nothing else.

Electron 43 pairs Chromium 150 with Node 24.18. Windows 11 is the primary target
and macOS is supported; Linux is not a requirement and is not claimed.

**What exists after Phase 1, exhaustively:** `electron/main/index.ts` creates one
`BrowserWindow` with `contextIsolation: true`, `sandbox: true` and
`nodeIntegration: false`, loads the SPA this repository already builds, denies
window-opening and off-origin navigation by default, applies the Windows 11
backdrop material conditionally, and turns four classes of load failure into a
named error dialog. `electron/preload/index.ts` exposes nothing and contains no
executable statement. `npm run verify` is untouched, every existing test still
runs in jsdom against the same modules, and no file under `src/` changes.

**What does not exist and is not claimed:** `BaseWindow`, `WebContentsView`, any
IPC channel, any `contextBridge` surface, any state replication, any updater, any
packaging, and any theme system. Clauses 5 through 7 describe those and are
decisions about the future, in the sense clause 6 makes uncomfortable.

The engine is deliberately *not* pinned to a Chromium version by policy. One
engine on both platforms is the property being bought; freezing which build of it
is a separate decision that has not been needed yet.

### 2. Electron over Tauri, after giving Tauri the better half of the argument.

Tauri's case is not weak and this decision is not close on every axis.

**Where Tauri is genuinely better.** Its capability model is better designed than
anything Electron offers, and the gap is not stylistic. Tauri v2 declares, in
tracked JSON, which windows and which webviews may invoke which commands, with
permission sets composed per plugin and a default of deny. Electron has no
declarative permission layer at all: the IPC surface is whatever the preload
exposes, and every restriction on it is hand-written and hand-reviewed. For a
project whose central architectural anxiety is exactly "which code may call
what", a declarative, tracked, default-deny capability table is the artifact this
repository would most like to own — it is the same shape as
`scripts/check-portability.mjs`'s allowlist, which ADR-0002 defends precisely
because it is declarative, has no wildcard, and carries a written reason per
entry. The Windows footprint is also genuinely, not marginally, smaller: Tauri
links the system WebView2 rather than shipping a browser, and the difference
between the two installers is roughly two orders of magnitude. Its updater plugin
ships signature verification as a first-class feature, which would have answered
part of clause 7 for free.

**Why it is still rejected. Four reasons, in descending weight.**

- **Two rendering engines for a graphics product.** Windows under Tauri is
  WebView2, which is Blink; macOS is WKWebView, which is not. Force 1 says the
  renderer is the product. Two engines means the canvas throughput target in
  pane 3, the mount cost of the inline-SVG sparklines in pane 2, the density and
  type work, the focus-ring contrast and every visual regression are all two
  questions rather than one, and each bug report starts with a bisect across
  engines before it starts with a bisect across commits. It also means the
  macOS engine version is the macOS version — the floor is the operating system's
  floor, and there is no way to pin past it.
- **The topology the plan depends on is behind an unstable flag.** Multiple
  webviews in one window is the mechanism the three-pane process split needs.
  In Tauri it is gated behind an `unstable` feature with open rendering defects;
  in Electron, `WebContentsView` is the supported, documented API. Choosing a
  runtime whose central required capability is explicitly not stable is choosing
  to find out later.
- **A Rust toolchain is local setup, and ADR-0002 forbids local setup.** The
  acceptance test is `npm ci && npm run verify` with no local setup and no edits.
  Electron's binary is downloaded by `npm ci`, so it is inside the sentence, and
  §7 of the pivot plan already argues that the desktop *packaging* lane sits
  outside `verify` for the same reason Playwright's browser download does. A Rust
  toolchain sits outside `npm ci` entirely, is installed per platform by a
  different mechanism on each, and would have to be added to the README's
  Getting Started — which is the acceptance test, written out.
- **The desktop test lane exists on one side and not the other.** Playwright's
  `_electron.launch()` is a supported harness for driving a real Electron
  application on Windows and macOS, and the six assertions in the plan's
  `verify:desktop` lane are written against it. Tauri's WebDriver harness does
  not support macOS at all, so half the target matrix would have no automated
  desktop lane.

**What the rejection costs, stated rather than waved off:** roughly 100–150 MB of
installer and a memory baseline per renderer that a system-webview runtime would
not pay, plus the hand-written permission surface described above. The first is
accepted. The second is a debt, and the place it is paid is the transport seam in
Phase 6 — where the IPC surface should be enumerated in one tracked table with a
written reason per entry, because that is the closest this project can get to
the thing Tauri would have given it.

### 3. Per-pane processes buy crash containment. They are not isolation between extensions.

This clause exists because the framing that motivated the topology was wrong, and
the code says so.

`ExtensionViews` in `src/core/types.ts` declares `pane2` and `pane3` on **one**
blueprint, and `ActiveExtension` in `src/core/ActivationContext.tsx` carries one
blueprint and one `IShellAPI`. **Panes 2 and 3 are always the same extension**,
and only one extension is in the foreground at a time. Splitting per pane
therefore puts *one* extension into two processes and produces **zero** boundary
between two *different* extensions.

What it does buy, and these are real:

- **Crash containment.** A pane-3 renderer that crashes, wedges, or exhausts
  memory leaves the navigation tree and pane 2 alive. React's `FaultBoundary`
  cannot do this: it catches a throw during render, and an infinite loop is not a
  throw.
- **Per-pane memory accounting**, which is worth having when one of the panes is
  a chart with millions of points in it.
- **A swappable boundary**, which is the actual requirement behind force 6.

**It does not discharge ADR-0001 Amendment E's trigger.** Amendment E's finding
is that the between-*extension* boundary is not enforceable inside one document,
and its condition is that when third parties become real, per-extension isolation
is owed. A pane split pays that boundary's full cost — a second realm, a
serialization contract, and the loss of module-scope state shared between panes 2
and 3 — while satisfying none of the condition. The word for what it buys is
**crash containment**, it is used in that sense everywhere in this repository,
and it must not be written as *isolation* in a commit message, a CHANGELOG entry
or a release note.

### 4. The three security switches are an integrity control, and the only one available here.

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, on every
renderer, with no exception and no per-view override.

Amendment E's vocabulary applies: this is an **integrity control** — real and
unconditional against any caller however hostile — and it is a different boundary
from the one Amendment E says cannot be enforced. Amendment E concedes that a
hostile extension can reach the activation controller by walking React fibers.
These three switches are what keeps that reach inside the page, rather than
extending it to the file system, the network and process creation. Turning any of
them off would not soften a claim this repository makes; it would convert every
extension, every mock and every transitive dependency in the renderer's module
graph into code with the operating system in reach.

One consequence is recorded now because it is a trap later: **a sandboxed preload
script cannot use ESM imports**, while this repository's root `package.json`
declares `"type": "module"`. The Phase 1 preload sidesteps the collision by
containing no `import` and no `export` at all, which makes it a script and valid
under either module system. The first real statement written into it has to be
CommonJS. Both `electron/preload/index.ts` and `electron/tsconfig.json` carry
that note at their own end.

### 5. The process topology is three views, *provisionally*, and clause 6 can overturn it.

Main owns the authoritative registry, the authoritative store, view geometry,
command routing and the updater. View 0 is host chrome including pane 1. View 1
is pane 2. View 2 is pane 3. Pane 1 does not get a process, because it renders
host-owned, already-serializable `NavigationNode` data and nothing an extension
supplies can make it throw.

The alternative is two views: host chrome, and one extension process holding
panes 2 and 3 together. Two views keeps panes 2 and 3 in one document, so ARIA
relationships and focus order between them work without any host arbitration, and
the shared-module-state problem — both verification remotes keep cross-pane state
in module scope, which loads twice under a split and silently diverges —
disappears rather than being migrated around. Two views loses only *per-pane*
crash containment; an extension crash still cannot take the shell down.

**The thumb is on the scale for two views.** Three is written here because it is
the shape the rest of the plan is drafted against, not because it has won.

### 6. The accessibility question is a gate with a named spike, not a solved problem.

**Electron may expose N `WebContentsView`s as N separate platform accessibility
trees** — N UIA trees on Windows, N `NSAccessibility` trees on macOS. If it does,
a screen reader's virtual cursor cannot traverse from pane 2 into pane 3, the
reading order of the shell is not the visual order of the shell, and the WCAG 2.2
AA keyboard commitment in README.md is broken in a way a focus ring does not fix,
because the defect is in what the platform is told exists rather than in what is
drawn.

**This cannot be resolved from this repository.** No test in `verify`, in the
browser lane, or in jsdom can see a platform accessibility tree. jsdom has no
layout engine at all.

**The gate.** At the end of Phase 6 — after the transport seam is proven
in-process and before any `WebContentsView` is created — a throwaway two-view
window is driven with **NVDA on Windows 11 and VoiceOver on macOS**, and the
question asked is whether a single virtual cursor traverses from the last element
of view 1 to the first element of view 2. The outcome decides clause 5:

- **One tree, or one that can be made continuous:** three views, as clause 5
  describes.
- **N trees:** collapse to two views, which also dissolves the shared-state
  problem.
- **N trees and two views is also insufficient:** the fallback is a documented AA
  regression with a CHANGELOG entry, and it is the fallback, not the default.

**The outcome is written into this ADR whichever way it goes.** A spike whose
result is not recorded gets re-litigated by the next person, at the same cost,
with no memory of why.

### 7. Auto-update ships in Phase 9 against a static generic feed, not the GitHub provider.

The mechanism is `electron-updater` with NSIS on Windows and the `.zip` artifact
on macOS, surfaced as a host command and a badge rather than a modal.

**The feed is a static generic endpoint** — an object store or any static host —
published to by a release workflow that reads from this repository. The GitHub
provider is rejected on a specific, verified fact and not on preference: this
repository is private on a free plan, which `HANDOFF.md` §5 records as a `403` on
the branch-protection and rulesets endpoints, and `electron-updater`'s GitHub
provider against a private repository requires a token **inside the shipped
client**, where anyone who downloads the installer can extract it. Shipping an
extractable credential to make an update check work is not a trade-off with a
good side.

Two alternatives were weighed. **Paying for a GitHub plan** fixes branch
protection and private vulnerability reporting and does *not* fix this — a
private repository's release assets still require authentication. **Making the
repository public** would fix all three at once, which is why it deserves a real
decision on its own merits rather than being ruled out by default; it is not this
ADR's to take.

Nothing in clause 7 is implemented. The updater is Phase 9, and the paragraph
exists so that Phase 9 does not start by reaching for the provider that looks
easiest.

**The signing risk is live and unverified**, and `docs/signing.md` carries it:
since 26 March 2026 Azure Trusted Signing — renamed Azure Artifact Signing — has
been issuing from two new intermediate certificate authorities, and executables
signed through them are *reportedly* being flagged by SmartScreen as
unrecognized. This project has not observed that and does not assert it. The
response is to keep the signing provider swappable, keep a traditional OV/EV path
viable, and make a clean-VM SmartScreen observation a release-checklist step.

### 8. What this decision owes ADR-0002, and where the debt is paid.

Every native artifact strains ADR-0002's mandate, and the amendment is part of
the work rather than a follow-up. Four clause interactions, measured against
`scripts/check-portability.mjs` rather than against the prose:

- **Clause 5, hardcoded hostname and undocumented port.** The update feed URL
  will be a literal host in a tracked non-Markdown file, which the checker fails
  on sight. The fix is a `DOCUMENTED_ENDPOINTS` table with one entry and a
  written reason — the same declared-not-exempted shape `DOCUMENTED_PORTS`
  already has — and not an allowlist hole. Phase 1 introduces no such literal:
  the dev-server URL uses the one documented port, and the private scheme in
  clause 9 is single-label and names no host.
- **Clause 6, undeclared environment assumption.** The desktop build will read
  signing credentials, and `verify`'s Linux leg will read
  `ELECTRON_SKIP_BINARY_DOWNLOAD`. Every name, its purpose and its working
  default are declared in `docs/signing.md`. **The Phase 1 runtime reads none of
  them** — see clause 9.
- **Clause 7, platform-only script or path separator.** The checker's
  `platform-only-invocation` rule matches `cmd.exe`, `powershell`, `pwsh` and
  batch extensions, none of which an `electron-builder` invocation contains, so
  the prose forbids something the regex does not catch. That gap is closed in the
  same change that introduces the build command, because relying on it is exactly
  the "written rule with no checker" ADR-0002 rejects. The path-separator rule
  needs no ADR change at all: `electron-builder` accepts forward slashes
  everywhere, so the fix is to write them.
- **The acceptance test does not change.** `verify` gains no Electron stage. The
  justification is already written in this repository — `playwright.config.ts`
  keeps Playwright outside `verify` because the browser download is outside
  `npm ci` and outside the lockfile, and Electron's binary and its signing
  certificates are the same argument one step larger. A second, clearly
  subordinate sentence is added for a *packaging* acceptance test, and it is
  explicitly not a precondition for contributing.

### 9. Three runtime decisions Phase 1 had to take, and their reasons.

These are small, they are in `electron/main/index.ts`, and they are recorded here
because each one is the kind of line that is copied forward without being read.

**Development and production are told apart by `app.isPackaged`.** ADR-0002
clause 6 forbids an undeclared environment assumption and `.gitignore` records
that nothing in this repository reads an environment variable; `NODE_ENV` would
be exactly the forbidden thing, deciding which document a user sees based on
whether a shell happened to export a name. `app.isPackaged` is a property of the
running application's own layout, cannot be set from outside the build, and needs
no entry in `docs/signing.md`. It is imperfect in one stated way — a built but
unpackaged run is treated as development — and the response to that is a named
error dialog rather than a white window.

**The packaged renderer is served over a private scheme, not over `file://`.**
`vite.config.ts` sets no `base`, so the built `dist/index.html` references
`/assets/…` absolutely and with `crossorigin`; under `file://` those resolve
against the file-system root and the window is blank, with no load-failure event
because the main frame loaded and only its sub-resources did not. Serving `dist/`
over a privileged, standard, secure scheme fixes that inside `electron/` rather
than by changing a Vite setting the browser lane also owns, and it buys a real
origin — so `HydrationEngine`'s `localStorage` persistence behaves as it does in
a browser — and something for the navigation allowlist to compare against.

**Mica is requested once, conditionally, and the fallback is a colour.** The
material is asked for only on Windows build 22621 or newer and only when the
system is not in High Contrast, and it is re-evaluated when that signal changes.
Transparency-off and Battery Saver also suppress it and **Electron exposes no
signal for either**, so no attempt is made to detect them; what handles them is
that the window always carries an opaque background colour, so a material that
does not draw leaves a solid surface instead of a transparent one. Microsoft's
guidance — do not apply a backdrop material more than once, keep vertical panes
opaque — is satisfied trivially at Phase 1, and the obligation it creates is for
Phase 7: the `WebContentsView`s must not set a material of their own.

---

## Consequences

**What this buys.**

- A native window exists, which closes the repository's sole tracked Blocker,
  GitHub issue #39 — "nobody has ever run the app". In development the window
  loads the dev server's root, which `vite.config.ts` rewrites to the fixture
  shell, so the first native window anyone opens has content in it.
- One rendering engine on both target platforms, which makes every visual,
  performance and accessibility result a single result.
- A supported desktop test harness, so the six assertions nothing else can make —
  including that a crash in pane 3 leaves pane 2 alive — are mechanisable when
  the topology lands.
- A path to self-update that ships no credential.

**What it costs.**

- **Roughly 120 MB downloaded by `npm ci` on every fresh clone and every CI
  leg.** Mitigated on the Linux `verify` leg by `ELECTRON_SKIP_BINARY_DOWNLOAD`,
  which is itself an ADR-0002 clause 6 event and is declared in
  `docs/signing.md`.
- **Installer size and per-renderer memory**, which a system-webview runtime
  would not pay. Accepted under force 1.
- **A hand-written IPC permission surface**, which clause 2 concedes Tauri would
  have given declaratively. The debt is named and the place it is paid is Phase 6.
- **CI billing.** The desktop lane runs on `windows-latest` and `macos-latest`,
  billed at 2× and 10× on a private repository, so it runs on tags and manual
  dispatch only and not on every pull request.
- **A second TypeScript program.** `electron/tsconfig.json` is not an `extends`
  of the root config, so a strictness flag changed in one does not follow into
  the other. That is deliberate — the two describe genuinely different
  environments — and it is a maintenance obligation, not a free choice.

**What this decision does not cover, stated plainly rather than implied.**

- **It is not a security decision about extensions.** Clause 4's three switches
  are a boundary between the renderer and the operating system. Nothing here
  narrows, widens or repairs ADR-0001 Amendment E, and clause 3 exists to stop
  the process split being read as if it did.
- **It makes no performance claim.** No bundle size, frame rate or memory figure
  in this document has been measured on this codebase, and README's rule that
  unverified numbers must not be quoted as characteristics applies to this
  document too. The one number that appears — the Electron download — is a
  published property of the dependency and not a measurement of this project.
- **It does not settle the topology.** Clause 6 is a gate, and until it is run
  clause 5 is provisional.
- **It says nothing about themes, charts, the command registry or the block
  ledger.** Those are Phases 2 through 8 and have their own decisions to make.

**Reversibility.** Moderate at Phase 1 and low afterwards. Today the whole native
host is three files under `electron/` and the browser lane is untouched, so
reverting is a deletion. Once main owns the authoritative store and the panes are
separate documents, the state design has been shaped by the process boundary and
reverting is a rewrite. **Phase 6 is the last cheap exit**, because it proves the
transport in one process before any of it depends on Electron.

---

## Alternatives considered

**Tauri.** Given its strongest case in clause 2, and rejected there on four
grounds — two rendering engines for a graphics product, the required multi-webview
topology being behind an unstable flag with open rendering defects, a Rust
toolchain being the local setup ADR-0002's acceptance test forbids, and no macOS
support in its WebDriver harness. Its capability model is better than Electron's
and this document says so twice, once as an admission and once as a debt with a
place to pay it.

**WinUI 3 / Windows App SDK.** Rejected on two counts, either of which is
sufficient. It is Windows-only, and macOS is a stated target. And it shares no
code with the existing product: the three-pane layout, the virtualizer, the
Tailwind styling, the fault boundaries and the entire extension contract are DOM
and TypeScript, and none of that ports to XAML. This is not a runtime change, it
is a rewrite with the same requirements document.

**An Avalonia hybrid — native chrome hosting a web view for the panes.**
Rejected. It buys nothing the alternatives do not: the panes are still a web view
per platform, so it inherits Tauri's two-engine problem while adding a second
language, a second UI framework and a native/web seam through the middle of the
layout — precisely where the pane dividers, the focus ring and the keyboard
arbitration live. The one thing it would buy, native chrome, is worth less than
the seam costs.

**React Native for Windows.** Rejected, and worth stating carefully because it is
the alternative most likely to be proposed on the grounds that "it is still
React". It shares React; it does not share the DOM. Tailwind does not apply,
`react-resizable-panels` does not apply, the three-pane DOM layout does not port,
inline SVG sparklines do not port, and the entire `src/components/**` tree —
which is inside the 100% coverage gate — would be rewritten against a different
primitive set while the tests that pin its behaviour are DOM tests. Sharing a
component *model* is not sharing components.

**Wails.** Rejected. Its v3 line is alpha, it puts a Go toolchain in the same
position clause 2 rejects a Rust one for, and it has the same two-engine problem
on Windows and macOS. It is the Tauri argument with less maturity and a smaller
ecosystem.

**A packaged progressive web app.** Rejected, briefly, because it answers none of
the requirements: no process-level crash containment, no backdrop material, no
signed installer, no self-update from a private feed, and no path to the
per-pane processes clause 5 describes. It would ship the current product in a
window without a title bar.

**Deferring the runtime choice until after the token pipeline and the command
registry.** Rejected, and it was a live option — Phases 2 through 6 of the plan
genuinely require no Electron, which is an argument that the decision could wait.
It is rejected because the choice constrains those phases even while unbuilt: the
theme injection design in Phase 2 depends on whether custom properties will have
to cross a document boundary, the command registry's `when` predicate in Phase 4
exists *because* `isVisible` cannot cross a process boundary, and the transport
seam in Phase 6 is shaped like `MessagePortMain` on purpose. Deferring the
decision would not have avoided it; it would have made four phases of work depend
on an assumption nobody had written down.
