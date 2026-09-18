# Changelog

All notable changes to LEAPWare-ShellUX are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from its first release.

**Nothing has been released.** `package.json` declares `0.1.0` and marks the
package `private`; there is no tag, no published artefact and no comparison link
to offer, so everything below sits under Unreleased. Entries are derived from the
commit history rather than written from memory, and each names the commit it came
from so a reader can check it.

## [Unreleased]

### Added

- **The process split: one `BaseWindow`, two `WebContentsView`s, and a host-owned
  focus ring (plan §3.2, §5, Phase 7).** The shell is no longer one renderer.
  `electron/main/paneViews.ts` creates host chrome and an extension surface,
  owns both rectangles through the only `setBounds` calls in the application, and
  puts Mica on the window with **opaque** views — discharging the obligation
  Phase 1 wrote down in the commit where it would be got wrong.
  `paneview.html` and `src/paneview/` are the extension surface's document, which
  holds panes 2 and 3 **in one document** so their ARIA relationships and focus
  order work.
  - **Two views, not three, and the reasoning is asymmetry rather than
    confidence.** `docs/adr/0005-pane-topology.md` is still `Proposed` and its
    deciding arm still needs a human with NVDA. Two-process is the option that is
    safe under either outcome: a clean arm B makes three *available* as an
    additive change, and a bad one means two is already what shipped. Building
    three first would have been the bet that cannot be unwound. Recorded in
    ADR-0001 Amendment O.
  - **Focus arbitration, because the spike measured that startup was
    non-deterministic.** Five identical launches of the unarbitrated two-view
    build put focus on the last-added view four times and on the first once — so
    *which pane the user was typing into after startup was undefined*.
    electron/electron#42339 reproduces on Electron 43.2.0, and two things the
    issue does not say decide the design: the steal is **not** synchronous with
    `addChildView` (so a host that re-asserts on the next line re-asserts too
    early), and **the losing renderer is never told** (so only main can see it).
    `electron/main/focusRing.ts` asserts on load completion, against an injected
    seam — because a single launch of a *broken* ring passes 80% of the time, and
    "launch it and look" is therefore not a test.
  - **Crash containment, observed rather than claimed.** Killing the extension
    renderer produced *"the extension view stopped (reason: crashed, exit code:
    -1); reloading it"*; the rail, pane 1, the context bar and the palette stayed
    up, the view came back, and the focus ring caught the reload-time steal.
  - **`before-input-event` is used for exactly one thing**, and
    `electron/__tests__/noElectronListener.test.ts` says so with a count. It
    carries no DOM target and no `defaultPrevented`, so the suppression rules in
    `src/core/hotkeyDispatch.ts` cannot run there; the renderer keeps them
    unchanged and main's handler is an escape hatch for a wedged renderer.
  - **`electron/**` was never covered by the listener scan, and now is.**
    `src/__tests__/noEventListener.test.ts` resolves its root from its own
    location, so the native host was outside it *by construction*. The new scan is
    deliberately not a copy — `addEventListener` appears zero times in a main
    process and always would, so a copied scan would pass vacuously. It counts
    every `on`/`once`/`off` registration per module, exact in both directions.

- **A desktop packaging lane that produces a real installer, and auto-update from
  a static feed (plan §6, Phase 9).** `electron-builder.yml` — a file rather than
  a `build` key in `package.json`, because JSON cannot carry the argument for each
  decision and this repository argues every one of them beside the line that takes
  it. NSIS on Windows, dmg **and** zip on macOS (the zip because electron-updater
  updates a macOS application from it and a dmg-only release cannot update
  itself), hardened runtime on, and `notarize` deliberately absent so that
  notarization runs when the Apple credentials are present and skips with a
  warning when they are not — which is exactly the "working default when unset"
  column `docs/signing.md` promises.
  - **Observed, not merely configured.** `npm run verify:desktop` on Windows
    produced `leapware-shellux-0.1.0-win-x64.exe` (110 MB), `latest.yml` and a
    blockmap. The packaged application was launched, and its palette offers
    *"Check for updates — last check failed"* — the update state having travelled
    from `electron-updater` through the main process, an IPC channel, the preload
    bridge, a hook and the Phase 4 command registry. The failure is correct: the
    feed host is not provisioned, and the running application reports
    `net::ERR_NAME_NOT_RESOLVED`.
  - **`electron-updater` against the `generic` provider, never `github`.** This
    repository is private on a free plan, and the GitHub provider would require a
    token inside the shipped client, which anyone can extract from an asar in
    seconds. The feed URL is written in exactly one tracked file; electron-builder
    bakes it into `app-update.yml` inside the package, so `electron/main/updater.ts`
    contains no URL and the renderer has no way to name a feed at all.
  - **The surface is a palette command and never a modal.** `checkForUpdates`
    rather than `checkForUpdatesAndNotify`; both commands declare
    `surfaces: ['palette']`. "Check for updates" is offered for every status
    except a development run — **including `error`**, which is when a user most
    wants to press it again, and which is also the only positive evidence that the
    preload bridge loaded at all.
  - `.github/workflows/desktop.yml` on **tags and `workflow_dispatch` only**, on
    `windows-latest` and `macos-latest`, always `--publish never`. Not on every
    pull request: Windows bills at 2x and macOS at 10x, and there is no Linux leg
    to average them down.
  - `docs/RELEASE.md` — the checklist, including the clean-VM SmartScreen
    observation, an actual old-build-updates-itself test, and a section stating
    what is observed versus what is only configured.
- **The preload stopped being empty, and changed extension to do it.**
  `electron/preload/index.cts` compiles to `index.cjs`, because a sandboxed
  preload is loaded into a CommonJS realm and this package declares
  `"type": "module"`. It is the one file in the repository whose **extension is a
  constraint rather than a convention**; `verbatimModuleSyntax` enforces it by
  rejecting ESM syntax in a CommonJS file, and `eslint.config.js` learned `cts` in
  the same change so the file could not escape the lint stage.

- **Graphical visualization in all three panes — three tiers, three different
  problems (plan §3.3).** Panes 2 and 3 are opposite performance problems and no
  single library wins both, so they do not share one.
  - **Tier 0, panes 1 and 2 — no library.** `src/components/ui/RowMetric.tsx`
    composes the existing `MetricGlyph` — the same 32×12 `viewBox`, the same
    memoised `d` string, the same `stroke="currentColor"` — and adds a value and
    a delta. A chart *instance* per row is a construct and a destroy on every
    scroll tick of a virtualized list; a memoised path string has none. Both
    verification remotes now draw one per pane-2 row: `MailPlugin` a sparkline
    of thread activity, `DatabasePlugin` a bar of stock against reorder level.
  - **Tier 1, pane 3 — Apache ECharts 6.1.0 (Apache-2.0), canvas renderer,
    tree-shaken.** `src/components/chart/Chart.tsx` is the ONE wrapper; the one
    file in `src/` that names the library is `src/core/chart/echartsRenderer.ts`,
    reached through the `ChartRenderer` seam in `src/core/chart/ChartRenderer.ts`
    — the same shape as `HydrationEngine`'s `ShellStorage` and `src/core/ipc/`'s
    `PortLike`. **Tier 2 (uPlot) is not in this change.**
- **`normalizeChartSpec` (`src/core/chart/chartSpec.ts`), which makes "never
  encode meaning by colour alone" a compiler property.** A series input has no
  `color` member to write, and the normalised series carries `colorIndex`, `dash`
  AND `marker` as required fields assigned in one statement, so a series with a
  colour and no second channel is not representable. A `color` arriving through
  `publishPayload` — where the compiler was never in the loop — is rejected on
  sight with `INVALID_FIELD`. The series bound is **twelve**, because the colour,
  dash and marker rotations have periods 12, 3 and 4, so a thirteenth series
  would repeat the first in all three channels at once.
- **The pane-3 block ledger.** `src/components/ledger/BlockLedger.tsx` renders a
  vertically scrolling stack of addressable blocks — chart, table, form, text,
  agent — each with a stable id that IS its payload channel, and each with a
  Grafana-style inspector revealing the channel, the kind, the host-assigned
  `revision` and the raw payload without navigating away. The `form` arm renders
  real labelled inputs: pane 3 is a canvas and an input surface at once.
  - **The index rides on a context key and the content on the payload channel.**
    `src/core/ledger/ledgerIndex.ts` reads a comma-separated block list from the
    reserved `ledger` context key. A list of addresses is exactly the cheap
    primitive fact a context key is for; a chart's data is not.
  - Both verification remotes publish blocks, so the ledger has real consumers.
- **A text alternative for every chart.** `ChartDataTable` renders the same
  `ChartSpec` the canvas was built from as a real table — the actual numbers, plus
  the dash and marker of each series — `sr-only` beside the canvas and visibly in
  the inspector. One implementation, two placements.

### Changed

- **ADR-0002 gained Amendment A, and the checker gained three rules' worth of
  teeth.** ADR-0004 clause 8 named four collisions between the desktop lane and
  the no-local-environment-dependencies mandate *in advance*; all four are settled
  in the change that caused them.
  - **`DOCUMENTED_ENDPOINTS`**, a one-row declaration table beside the existing
    `DOCUMENTED_PORTS`, holding the update feed's host with a written reason. **Not
    an ALLOWLIST entry**: an allowlist switches the rule off for a path, so a
    second host arriving in the same file later is never seen; a declaration names
    one host and leaves every other host still reported. It matches on **exact
    host equality**, because the reserved-suffix list beside it uses `endsWith`
    correctly — every name under `example.com` is reserved — while an endpoint is
    not a suffix and `endsWith` would have accepted a host that merely begins with
    the declared one and continues into a domain somebody else can register.
  - **`platform-only-invocation` now catches what its prose always forbade.** The
    rule matched shells and batch extensions, so `electron-builder --win nsis`
    matched nothing — a build command that pins its output to one platform, which
    the mandate plainly forbids. Pattern and prose are fixed together, because
    relying on the gap is the "written rule with no checker" ADR-0002's own
    Alternatives section rejects. **The portable form is to name no platform:**
    `electron-builder` with no flag builds for the machine it is on, so
    `npm run verify:desktop` is one command everywhere and `desktop.yml` gets its
    platforms from a `runs-on` matrix.
  - **`temp-or-scratch-path` no longer reports a path segment inside a URL.**
    `electron-builder` brought in two packages *named* `tmp` and `temp`, so npm
    wrote registry tarball URLs into the lockfile carrying each of those names as
    a path segment — which is the exact shape the rule looks for.
    Sharpened rather than allowlisted, and the reason is specific: the lockfile
    already has an ALLOWLIST entry for hostnames, and adding this rule to it would
    have switched the rule off for a file that **can** carry a genuine local path
    — a `file:` reference to a directory on the author's disk is exactly what this
    checker exists to catch. A URL reaching somewhere it should not is
    `hardcoded-hostname`'s finding on the same line, so the match is reassigned
    rather than dropped.
  - Both directions of all three rules are pinned in
    `scripts/__tests__/check-portability.test.mjs`: a lookalike host that begins
    with the declared one must still fail, a build command that names no platform
    must not, and a temporary path being *assembled* beside a URL must still fail.
  - **`release/` is the third build output directory**, and it landed in
    `.gitignore` and in `SKIPPED_DIRECTORIES` in `scripts/check-citations.mjs` in
    the same change. The plan's original instruction to point the packager at
    `dist/` was wrong — `vite build` empties it. The citation checker walks the
    working tree rather than the git index, and `release/win-unpacked` measured
    **419 MB**.
  - **The acceptance test is unchanged, word for word.** `verify` gains no
    packaging stage, on the justification already written at `playwright.config.ts`
    for the browser lane: a download outside `npm ci` and outside the lockfile
    belongs outside `verify`, and an Electron binary plus a signing certificate is
    the same argument one step larger. `verify:desktop` is separate and
    subordinate.
- **`docs/signing.md` corrected itself in two places while being implemented.**
  `CSC_IDENTITY_AUTO_DISCOVERY` **cannot** be set from the packaging
  configuration — it is read from `process.env` and has no config key — so
  `desktop.yml` sets it and the config cannot; and the checker that file promised
  "when the packaging configuration exists" is now recorded as **rejected with a
  reason**, because `electron-builder.yml` names no environment variable at all
  and such a check would pass vacuously forever. Seven further names the tool
  reads (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
  `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`, `WIN_CSC_LINK`,
  `WIN_CSC_KEY_PASSWORD`) are now declared.
- **Measured bundle delta, because README's performance section forbids quoting
  unverified numbers as characteristics.** ECharts is the first runtime dependency
  beyond Radix and React. `npm run build`, before and after, on the same machine:

  | Artefact | Before | After | Delta |
  |---|---|---|---|
  | `dist/assets/index-*.js` | 331.39 kB | 893.05 kB | **+561.66 kB** |
  | …gzipped | 105.76 kB | 295.09 kB | **+189.33 kB** |
  | `dist/assets/index-*.css` | 20.95 kB | 21.41 kB | +0.46 kB |
  | …gzipped | 5.08 kB | 5.20 kB | +0.12 kB |

  That is a **169% increase in raw JavaScript** for a tree-shaken build pulling in
  three chart types and five components. It is stated rather than softened: the
  shell is a desktop host loading from disk, not a page over a network, and the
  same figure would be a different decision for a web deployment. `npm audit
  --omit=dev` still reports **0 vulnerabilities**; four packages were added.
- **A theme change disposes and re-initialises every chart in the document
  (risk R7).** ECharts registers a theme at `init` and has no setter for it, so a
  chart instance's lifetime is exactly a palette's lifetime — expressed in the
  code as a parameter of `ChartRenderer.create` rather than as a comment. The
  option is preserved and re-applied inside the same effect, so there is no blank
  frame; what is NOT preserved is anything the user did to the instance — a zoom,
  a pan, a legend item toggled off. A DATA change costs one `setOption` and no
  teardown, and the two are separate effects so the cheap path cannot silently
  become the expensive one.

### Fixed

- **The production audit had been red for six weeks and nobody saw it.** The
  scheduled audit failed on every Monday from 2026-08-10 to 2026-09-14 on a high
  advisory against `js-yaml` 4.0.0–4.3.1 (GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh),
  reached through `electron-updater` — the package that will parse the update
  feed's `latest.yml`, so the advisory sat on exactly the path a public release
  exercises. The lockfile now resolves `js-yaml` 4.3.2. **What made it possible:**
  a failed scheduled run notifies no one, and the dev tree was audited by nothing,
  so the same week-on-week blindness also hid four high advisories in the dev tree
  (`@xmldom/xmldom`, `brace-expansion`, `fast-uri`, `nanoid`) and three moderate
  ones in `vitest`. All seven are resolved in-range; `vitest` and
  `@vitest/coverage-v8` move `^4.1.10` → `^4.1.11`, the one range change. **What
  closes the mechanism:** `npm run audit:all` audits the whole tree as its own job
  ("Audit all dependencies") in `audit-dependencies.yml` and in the scheduled audit,
  and a failing scheduled run now files — or comments on — an issue titled
  "Scheduled dependency audit is failing". Measured: `npm audit --omit=dev` and
  `npm audit`, both "found 0 vulnerabilities", run with npm 11.16.0. **Not done:**
  `audit:all` is not a `verify` stage, and the issue-filing step has not yet been
  seen to fire, because it only runs on a scheduled failure. **Found on the way:**
  `npm audit fix` and `npm update` crash under npm 10.9.8 with `Cannot read
  properties of null (reading 'edgesOut')` against this lockfile; npm 11.16.0 —
  the version `packageManager` declares — does not.

- **The omnibox was never docked, and the word "docked" was already in this file
  describing it (GitHub issue #110).** `PaneWrapper`'s body was a flex ITEM of a
  `flex-row` and was not itself a column, so a child using `flex-1` to fill
  vertically had no column parent to fill against and sized to its content; the
  composer, being the last child of the scroll container, came to rest wherever
  the ledger stopped — measured at y≈408 in an 860px pane, above roughly 450px
  of empty pane. **Two changes, and they fix different halves.** The body is now
  `flex flex-col`, so children can fill it; and `PaneWrapper` grows a `footer`
  slot outside the scroll container, symmetric with `header`, which is where
  pane 3's composer now lives. `OmniboxComposer` stopped drawing its own
  `border-t p-1` because the slot draws them.
  - **Found by looking at the running application. 1,739 tests were green
    through it,** which is rule 4 in `CLAUDE.md` and the reason `e2e/` exists.
  - **The two halves needed two browser assertions, and a mutation probe is what
    proved it.** Reverting `flex flex-col` left the docked-footer case green —
    the footer docks off the section's column and asks nothing of the body's.
    `e2e/shell-layout.spec.ts` now carries "gives pane 3 a detail stack that
    reaches the bottom of the scroll container rather than stopping at its
    content" as well, and that one goes red under the same revert. The vitest
    side asserts a class string and says so in its own title.

- **The two content panes opened at sizes summing to 83 and warned on every
  load (GitHub issue #114).** `react-resizable-panels` requires one group's
  panels to sum to 100. When navigation collapses, pane 1 becomes a fixed 48px
  `div` rendered outside `shell-panes`, so the group holds panes 2 and 3 alone —
  but the pane-1 share was still being subtracted from pane 3's remainder. At a
  measured 1440px that is 25 and 58.33333333333334, which the library
  renormalised while warning `Invalid layout total size`, and pane 2 opened
  about a fifth wider than `PANE_PX` asks for. The predicate is now
  `paneOneIsInGroup = showChrome && !isNavCollapsed`, which is the question the
  arithmetic was always asking. No new arithmetic: the same rebase the restored
  path already applied, applied to the predicate that decides it.
  - **Observable in jsdom, unusually for this redesign's defects.**
    `measureGroup` reads a width jsdom reports as 0, `percentOf` falls through to
    `PANE_FALLBACK_PERCENT`, and the library still does the arithmetic and still
    warns — 26 and 56, summing to 82, at that fallback. Both totals are real; the
    number moves with the group width and the defect does not.
  - The existing case "survives a collapse toggled while a divider drag is in
    flight" **expected the defect** at stubbed 1000px geometry: 47.4 and 52.6,
    renormalised up from 36 and 40. It now expects 36 and 64, which is pane 2 at
    exactly its 360px intent.

- **`sr-only` does not work on a `<table>`, and the shell was shipping one.** CSS
  table sizing says a table's used width is never below its min-content width, so
  the `width: 1px` in `sr-only` is ignored; being absolutely positioned with no
  positioned ancestor, the "hidden" chart data table escaped every
  `overflow: hidden` in the pane and made the whole page scroll sideways at 320px.
  `ChartDataTable` now wraps its table in a `div` and the caller's classes go
  there. Caught by `e2e/shell-layout.spec.ts`, in the browser lane, because jsdom
  lays nothing out and could not have seen it.

- **The command registry and its four surfaces — the ribbon is deleted.**
  `src/core/commands/CommandRegistry.ts` holds one collection and four projections
  — `listForSurface`, `listByCategory`, `recents` and `suggestedFor` — and every
  one of them filters through the same `isVisible`/`when` guards. The surfaces are
  `src/components/command/`: `ContextBar.tsx` (32px, replacing the ribbon at about
  a third of the vertical cost), `CommandPalette.tsx` (Cmd-K, **browsable on an
  empty query**), `FloatingToolbar.tsx` (selection-triggered, pane 3 only) and
  `OmniboxComposer.tsx` (**not** docked when this was written, though this entry
  said it was — see the #110 entry at the top of this section, which is the
  change that made the word true).
  `commandListItem.tsx` is the one row all four render, and the one place a plug-in
  string reaches the DOM. See ADR-0001 Amendment N.
- **`Command`, generalising `RibbonAction`.** Four optional fields — `when`,
  `category`, `surfaces`, `priority` — and nothing removed. `RibbonAction` stays as
  a deprecated alias of `Command`, so nothing an extension has written breaks.
  `LEAPExtensionBlueprint` gains `commands` beside `ribbonActions`; **declaring
  both is rejected** rather than merged.
- **A host chord table.** Cmd-K / Ctrl-K opens the palette, and it is consulted
  before the extension chord table, so an extension declaring `Ctrl+K` never
  receives the keystroke while the host wants it. Host chrome is not
  plug-in-declarable: `HostCommand` has no `hotkey` field and the palette glyph is
  absent from `SHELL_ICONS`.
- **A fourth `HydrationEngine` slot, `recentCommandIds`.** Host-minted, namespaced
  keys, bounded at 16, and read tolerantly so a record written before the slot
  existed still restores. `SCHEMA_VERSION` does not move.

### Changed

- **Behavioural regression to expect, stated in advance.** The 32px context bar
  shows at most four contextual commands inline where the ribbon showed the same
  four — the count is unchanged — but the bar is a third of the height, so a
  command that used to be visible at a glance in a taller row is now one keystroke
  (Cmd-K) or one click (the overflow menu) away. That is the trade the plan asks
  for and somebody will file it as a bug.
- **`src/core/ribbonAction.ts` is now `src/core/command.ts`**, with `isVisible`,
  `execute` and `report` unchanged. The rename is the whole of the change: six
  routes to a plug-in handler now share the two guards that two routes used to.


- **The inversion-of-control extension contract** — `src/core/types.ts`
  (`LEAPExtensionBlueprint`, `IShellAPI`, `RibbonContext`, `ShellUXError` and its
  code enum), `src/core/RegistryContext.tsx` (validation, normalisation, the
  registry provider) and `src/core/ShellAPI.ts` (the deep-frozen per-extension API
  and the shell state store). The host owns lifecycle and layout and holds no
  business logic; extensions are supplied to it and never imported by it.
  (`0a6596b`)
- **Reactive shell state.** The store gained `subscribe`, and `useShellContext` is
  built on `useSyncExternalStore`, so a write through one pane's handle reaches
  another. `patchContext` compares per field and skips both the allocation and the
  notification when nothing moved. (`294c9e0`)
- **The activation lifecycle** — `src/core/ActivationContext.tsx`. Foreground and
  liveness as two orthogonal states, a revocable per-extension `IShellAPI` minted
  against a host-owned record, and `ExtensionHostBoundary` with the
  `useActivation` / `useExtensionActivation` split that gives a plug-in subtree
  read-only facts instead of the host capability. (`294c9e0`)
- **Plug-in-registered keyboard shortcuts.** An optional structured `Hotkey` field
  on `RibbonAction`, `src/core/hotkeys.ts` (`hotkeyToken`, `describeHotkey`,
  `matchesHotkey` — pure, no DOM, no listener), the `HOTKEY_KEYS` host allowlist,
  and the `DUPLICATE_HOTKEY` error code. Structured rather than a string, so there
  is no parser at the trust boundary. Chords are scoped to the foreground
  extension, so two extensions may declare the same chord. Declared and validated
  only; nothing dispatched one yet at this point. (`7fb0649`, ADR-0001 Amendment H)
- **The three-pane resizable shell** — `ShellLayout.tsx`, `PaneWrapper.tsx` and
  `RibbonToolbar.tsx`. A 240px navigation tree that collapses to a 48px icon
  track, a 360px list pane, and a flexing third pane with its own header, scroll
  container and trailing drawer. The ribbon renders host actions on the left and
  plug-in contextual actions on the right, filtered through `isVisible`, with
  labels rendered as text nodes only. (`118aaac`)
- **Local persistence** — `src/core/services/HydrationEngine.ts` and
  `src/hooks/useLocalStorageState.ts`. Versioned, validated, debounced, discarding
  rather than migrating an unrecognised schema version, and degrading silently to
  memory when storage is unavailable. Landed wired to nothing. (`118aaac`)
- **Fault containment and a row virtualizer.** `FaultBoundary` stores the thrown
  value and reads nothing off it inside React's error path; the fallback renders no
  plug-in component and no plug-in markup; retry remounts rather than re-renders,
  is user-initiated, and stops after three consecutive failures. Ribbon, pane 1,
  pane 2 and pane 3 each get their own containment. `VirtualizedList` windows on
  declared row heights and never measures the DOM, with the window arithmetic in a
  separate pure module, `virtualWindow.ts`. (`cd52bbf`)
- **Hotkey dispatch.** Exactly one keydown listener, on `window`, in the bubble
  phase, attached by `ShellLayout` and removed on unmount with the identical
  function reference. Chords fire only for the foreground extension, and are gated
  by the same `isVisible` and `isDisabled` predicates as the ribbon button that
  carries them, so a chord is never a wider route to an action than the button
  already is. `aria-keyshortcuts` is advertised on chord-bearing actions in the UI
  Events key-value spelling. (`752ee83`, ADR-0001 Amendment J)
- **Live badges.** `useBadgeCount` is a `useSyncExternalStore` selector over the
  badge map, and the navigation tree prefers a store badge over the blueprint's
  static value, in the expanded tree and in the collapsed icon track alike.
  (`752ee83`)
- **Toolchain and CI.** Vite, React 18, TypeScript in strict mode, Tailwind and
  Vitest/jsdom; `.gitattributes` normalising to LF; a CI workflow running lint,
  typecheck, coverage, build and a production-only audit; a 100% coverage gate over
  `src/core/**` that exits non-zero below the threshold. (`cf84f18`)
- **Declared environment facts, so a wrong toolchain fails at install rather than
  later** — `engines.node`, `.nvmrc` read by CI through `node-version-file`,
  `.npmrc` with `engine-strict`, and `packageManager`. (`e504fd3`)
- **`scripts/check-portability.mjs`**, the mechanical half of ADR-0002: rules over
  `git ls-files` covering absolute paths, drive letters, home directories,
  case-insensitive filename collisions, CRLF, byte-order marks and import casing.
  Wired into `npm run verify` and into CI. (`e504fd3`)
- **`scripts/check-citations.mjs`**, the mechanical half of ADR-0001 Amendment G:
  it parses prose for cited test titles and fails on one that resolves to no test
  in the suite. It checks that a citation which **is** present resolves; it cannot
  tell that a security claim carries no citation at all, and says so. (`118aaac`)
- **Documentation** — the issue manifest, `README.md`, `DEVELOPER.md`, ADR-0001
  (the IoC registry architecture) and ADR-0002 (no local-environment
  dependencies), plus `CONTRIBUTING.md`. (`959e3ee`, `e504fd3`)
- **Two verification mocks under `src/mocks/`** that exercise the public contract
  the way a third party would. They produced eight contract-gap findings. (`118aaac`)

### Changed

- **THE SHELL LOOKS HEAVIER, AND THAT IS THE FIX RATHER THAN A BUG.** Every pane
  edge, the ribbon's bottom edge, the overflow menu's border, every slot divider
  and the fault surface's boundary are now `--border-default`, which resolves to
  `#7e8085` in the light theme. They were `border-neutral-200`, `#e5e5e5`. That is
  **1.26:1 against the pane it bounds, replaced by 3.95:1** — roughly three times
  the ink, visible at a glance, and the reason it is announced here in advance is
  that it will otherwise be filed as a rendering regression.

  It is a WCAG 2.2 §1.4.11 correction: a control's visual boundary must clear 3:1,
  and a 1.26:1 hairline is not a boundary anyone with low vision can find. **There
  is no version of this that is invisible.** 3:1 on white alone would have landed
  at exactly `#949494`; the token is darker than that because the manifest
  measures it against every surface it is actually drawn on, and the binding
  constraint is `--surface-sunken` at 3.47:1 rather than the pane.

  Two smaller changes ride along, both in the same direction. `--text-muted` moves
  from `#737373` to `#5c5f64`, 4.74:1 to 6.41:1 on white — bought so that muted
  text clears 4.5:1 on **all eight** surfaces rather than only on the pane, which
  is what removes the hand-written dark-theme patch that used to sit beside every
  muted string. And the selected-row indicator is now carried by a 2px
  `--border-selected` rule and a semibold label, with the fill demoted to a hint
  and the 1px outline demoted to `--border-subtle`; no fill reaches 3:1 on white
  without reading as a different control entirely.

  Decorative rules are deliberately **not** dragged along: the `--border-subtle`
  tier exists to keep the weight off separation that is not a control boundary,
  and in-pane section rules use it. The numbers are measured rather than asserted
  — `design/check-contrast.mjs` over 165 declared pairs in three themes, and now
  `npm run tokens:check` over the shipped stylesheet as well.
- **Every colour in the shell is a design token, and all 51 `dark:` variants are
  gone.** 118 raw colour literals across seven modules — 114 Tailwind palette
  classes plus four `theme(colors.neutral.*)` spellings inside arbitrary shadow
  values, which no colour search in this repository had ever found — became
  `var(--token)` utilities driven by `src/styles/tokens.generated.css`.

  **The `dark:` variants were deleted rather than made testable, and that is the
  answer to the "exercised by nothing whatsoever" finding.** When a colour is a
  token whose *value* swaps on `[data-theme]`, `dark:border-neutral-800` beside
  `border-border-default` is an override of something that already changed. The
  untested surface is removed instead of tested. `darkMode` stays configured as
  `['selector', '[data-theme="dark"]']` for the genuinely appearance-conditional
  cases that will arrive with per-document theme injection; the allowlist in
  `src/__tests__/noRawColor.test.ts` is **empty**, and the one known future member
  — the shadow tier, which is black at fixed alphas in every theme and elevates
  nothing on a near-black pane — is named there with the note that the fix belongs
  in `design/` rather than in a hand-written variant.

  **What this weakens, stated rather than buried:** the 43 `toHaveClass`
  assertions that pinned colours now assert against a `TOKEN_CLASS` record the
  components import, so they can no longer catch a component pointed at the wrong
  token. `scripts/check-tokens.mjs` measures the values and `e2e/theme.spec.ts`
  measures the compiled stylesheet; the full account is in
  `src/core/theme/tokenClasses.ts`.
- **Tailwind's `content` glob no longer matches test files.** The scanner is a
  regular expression over raw text with no idea what a file is for, so every
  planted-violation fixture and every density-scan control string was compiling
  into the shipped stylesheet — measured, not suspected: seven `.dark\:` rules
  survived in the built CSS after the last `dark:` utility had been deleted from
  the shell. A component cannot depend on a class only a test spells, so nothing
  real is lost.
- **`getExtension(id)` no longer returns the caller's object.** Validation and
  normalisation became one pass, and what is stored is a fresh host-owned record.
  A breaking change to the registry's read contract, made deliberately; the correct
  comparison for an extension author is on `id`. (`0a6596b`, ADR-0001 Amendment A)
- **`onExecute` gained a second parameter**, the `IShellAPI` handle. Before this a
  ribbon action provably could not change anything. Source-compatible for every
  implementer, and still a contract change. (`294c9e0`, ADR-0001 Amendment C)
- **Badge state is keyed by `${extensionId}:${nodeId}`** rather than by the bare
  node id, and the scope is supplied by the host at mint time rather than taken as
  a parameter. (`294c9e0`)
- **Liveness is re-checked at call time and keyed on the mint-time record.** The
  post-commit sweep is kept for bookkeeping and is no longer what stands between a
  forgotten extension and the store. (`294c9e0`, ADR-0001 Amendment D)
- **Provider teardown no longer revokes anything.** Liveness ends by exactly two
  events: `release(id)`, and being unregistered. Two implementations of teardown
  revocation were removed rather than repaired. (`294c9e0`, ADR-0001 Amendment F)
- **The dependency audit moved off the per-push path** onto a lockfile-scoped
  workflow plus a weekly scheduled run, so advisory drift cannot redden an
  unrelated commit. (`e504fd3`)
- **Lint runs at `--max-warnings 0`**, with the `react-refresh` exception narrowed
  to five named exports in `eslint.config.js` rather than suppressed inline. The
  repository holds zero inline suppressions. (`e504fd3`)
- **CI runs on Ubuntu, macOS and Windows**, so cross-platform support is observed
  rather than inferred from the lockfile's optional binaries. (`e504fd3`)
- **The no-listener invariant was narrowed twice rather than deleted** — once for
  the virtualizer's key handling, once for the hotkey dispatcher — each time to an
  exact allowlist asserted in both directions, and each time with the lost static
  guarantee replaced by a stronger runtime one. (`cd52bbf`, `752ee83`)
- **The coverage gate widened** from `src/core/**` to include `src/components/**`
  and `src/hooks/**`, and held at 100% on statements, branches, functions and
  lines. (`118aaac`)
- **The shared ribbon action guards — report, `isVisible`, execute — moved into
  `src/core/ribbonAction.ts`**, so the ribbon and the dispatcher cannot drift.
  Those semantics are security-relevant, and two copies of them would drift
  silently. (`752ee83`)

### Fixed

- **The density scan silently stopped measuring anything it could not parse.**
  `typeSizeOffenders` returned "clean" for any arbitrary type size it failed to
  read as a length, so `text-[var(--type-body)]` sailed through contributing
  nothing while `paddingOffenders` beside it treated the same ambiguity as a
  violation. Tokenising font size before fixing this would have replaced a
  measured type scale with values the scan waves through, and every run would
  have stayed green. Now only Tailwind's explicit `color:`-style data-type hint
  earns an exemption — that is *proof* the value is not a length — and anything
  else the scan cannot convert is reported, matching padding. Padding and font
  size remain deliberately untokenised for this reason, so the scan survives
  byte for byte.
- **A registration hijack through a multi-read id getter.** A value the plug-in can
  still reach is a value the plug-in can still edit, so reading each field once was
  necessary and not sufficient; the host now owns the stored record. Single-read
  access was measured through a logging `Proxy` rather than inferred. (`0a6596b`,
  `a1df19d`)
- **A bounds check that bounded nothing.** A `Proxy` could report an honest
  `length` while it was measured and a larger one afterwards; collections are now
  rebuilt at exactly the bounds-checked length. (`0a6596b`)
- **`validateBlueprint` leaked a raw `TypeError`** when a revoked `Proxy` reached
  any of five unguarded `Array.isArray` sites. (`294c9e0`)
- **The shell state store object was never frozen.** A plug-in view could swap
  `setSelectedItem` through the public `useShellStore()` and swallow another
  extension's writes. (`294c9e0`, ADR-0001 Amendment F)
- **`patchContext` accepted what `setSelectedItem` refused** — an object with a
  getter in `selectedItemId`, an illegal pane id, an unregistered extension id. It
  is now validated field by field against a table pinned to `keyof RibbonContext`,
  applies all-or-nothing, normalises `undefined` to `null` instead of writing a
  value the declared type forbids, and uses `Object.hasOwn` rather than `in`, which
  had been walking the prototype chain. (`294c9e0`)
- **Handle resurrection across `unregister` then `register` under the same id.**
  Id presence was the wrong question; the liveness predicate now compares record
  identity. The same defect also made re-activation after a re-registration return
  the stale entry. (`294c9e0`)
- **A StrictMode path that permanently revoked live handles** — broken in
  development and correct in production, which is the worst shape a bug has.
  (`294c9e0`)
- **An unbounded notify cascade** became a depth-capped `REENTRANT_NOTIFY` raised
  at the offending write, instead of a `RangeError` from a blown stack, with the
  depth counter restored in a `finally`. (`294c9e0`)
- **A cross-extension state leak on foreground handover.** `publishForeground`
  patched only `activeExtensionId`, so a newly activated extension inherited the
  previous one's `selectedItemId` and `activeNavNodeId`. Both are now cleared on a
  real handover and left alone on a redundant republish. (`118aaac`)
- **The ribbon overflow menu was clipped out of existence** by two
  `overflow-hidden` ancestors, so every action past the fourth was unreachable by
  pointer — and six tests asserted it worked, passing vacuously because jsdom has
  no layout engine. The menu is now a portalled Radix dropdown. (`118aaac`)
- **Eight WCAG 2.2 AA blockers**, all of them: the clipped overflow menu above,
  reflow at 320px, dark-mode text contrast from 4.18:1 to 7.85:1, selected-item and
  divider non-text contrast, 24px target sizes, focus returning to the trigger
  after the menu closes, and `aria-disabled` in place of native `disabled` so a
  disabled action stays in the tab order. (`118aaac`)
- **A fault boundary that did not contain the row it was wrapping.** Handing the
  result of `renderRow(item, index)` to a boundary runs extension code *above* it,
  so a throwing row still took the whole list down. The call now happens inside a
  child component below the boundary. (`cd52bbf`)
- **The no-listener claim was pinned to a test covering one module**, so a listener
  added anywhere else would have left it green. Replaced with a scan over every
  non-test module under `src/`, parsed with the TypeScript compiler so prose about
  the absence is not mistaken for the thing itself, and verified by planting a
  listener and watching the suite go red. (`9e80280`)
- **Documentation that was wrong in both directions**: `@throws` declarations
  across `ShellAPI.ts` and `types.ts`, a hotkeys banner claiming four keyboard-event
  fields where the code reads five, an issue manifest carrying no row for
  `src/core/hotkeys.ts`, and a describe block named for badge *isolation* where the
  architecture only delivers badge collision-resistance. (`a1df19d`)
- **Housekeeping with real consequences**: `.claude/settings.local.json` was
  ignored only by a global gitignore that does not travel with a clone;
  `JSX.Element` was resolving through a transitive global and would break on a
  React 19 types bump; two `.gitignore` negations pointed at files that do not
  exist; remaining eager `useRef(new Map())` initialisers became lazy; and
  `release(id)` guards a non-string by returning `false` rather than throwing,
  matching `activate`'s report-do-not-throw contract. (`e504fd3`, `a1df19d`)

### Security

- **`escape` removed from the hotkey allowlist, and `enter` made
  modifier-required.** `HOTKEY_KEYS` admitted both as bare, unmodified chords,
  because the guard refused a bare chord only when the key name was a single
  character. Enter activates the focused control and submits a form in every
  browser and every assistive technology, which is the same reason `space` was
  already excluded — two keys with one failure mode sat on opposite sides of the
  list. `escape` has a second, concrete collision: it is the shell's dismissal key
  and dismisses the dialog dependency this project ships, so an extension holding
  bare `escape` and an open dialog would be in a fight neither side declared. A
  modifier-gated Escape was considered and refused as dead surface, since the
  modified forms are all claimed by the operating system. The allowlist goes from
  61 keys to 60. Done before any dispatcher existed, because once chords fire this
  is a breaking change for every extension that declared one, and the cost only
  rises. (GitHub issue #8, `118aaac`, ADR-0001 Amendment I)
- **The portability checker followed symbolic links and could read files outside
  the repository.** A tracked path that is, or that reaches through, a link is now
  reported by a structural `symlinked-path` rule and is deliberately not read —
  reading it would scan, and could clear, content no clone contains. Detection is
  by the mode git records in the index *and* by `lstat` on every path prefix in the
  working tree, because those are two independent questions and both have to be
  asked; `lstat` also makes a Windows junction detectable with no
  platform-specific code. The checker goes from 19 rules to 20 and gains its first
  tests. (GitHub issue #11, `118aaac`)
- **The same checker confirmed only the last segment of a path's spelling**, so on
  a case-insensitive filesystem it could advise adding a mis-cased path to the
  index — recording the very case collision it exists to prevent, on a developer's
  machine and never in CI. It now walks from the repository root one segment at a
  time, which also closed a separate hole where a specifier could address a path
  outside the repository. (`9e80280`)
- **Roughly sixty documentation claims asserting security the code did not
  deliver were corrected.** These were documentation defects, not runtime ones —
  in every round the code was sound and a conclusion had been written one step
  wider than the premise licensing it. Ten review rounds, eight of which
  reproduced a real defect. The between-extension boundary is **not** enforceable
  in-page: React fiber reflection reaches the host controller from any element on
  the page, verified in the production bundle, and `ExtensionHostBoundary` is
  retained as a guardrail against honest mistakes and documented as nothing more.
  ADR-0001 Amendments E, F and G record the decision, the trigger that voids it,
  and the rule that no security claim may appear in prose without naming the test
  that exercises it. (`294c9e0`)
- **The single-read discipline at the hotkey registration sites was left
  unlicensed** when the hotkey work landed — the claim stood in prose with no test
  asserting it, which is exactly what Amendment G forbids. Nine tests now measure
  it through a logging `Proxy`. (GitHub issue #7, `a1df19d`)
