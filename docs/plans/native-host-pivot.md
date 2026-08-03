# ShellUX → Native Host · Visualization-First · Multi-Theme

---

## 1. Context

`LEAPWare-ShellUX` today is a **browser-only React 18 + Vite 5 + Tailwind 3 SPA**. It is a
pluggable shell host: an IoC extension registry, a per-extension revocable `IShellAPI`,
a three-pane resizable layout with a ribbon, a hydration engine, fault boundaries, and a
row virtualizer. ~11.6k non-test lines, ~19k test lines, 1000+ tests, a 100% coverage gate
over `src/core/**`, `src/components/**`, `src/hooks/**`, and a nine-stage `npm run verify`.

Verified facts about the starting point:

| Claim | Evidence |
|---|---|
| Zero native code | grep `electron`/`tauri`/`ipc`/`preload`/`contextBridge` → 0 hits |
| Zero visualization deps | runtime deps are 6 Radix packages + react + react-dom + react-resizable-panels |
| Zero theming mechanism | `tailwind.config.js` is 8 lines, `theme.extend` empty, **`darkMode` unset** (so Tailwind 3 defaults to `media` — the OS decides and a theme cannot be forced or tested); `src/index.css` is 21 lines with no `:root` and no custom properties |
| Colors are raw literals | 115 color literals in non-test `src/`, all from one family (`neutral`); 51 `dark:` variants; zero accent, semantic, or chart colors |
| Pane 1 is not an extension surface | `ExtensionViews` (`src/core/types.ts:412-426`) declares **`pane2` and `pane3` only** |
| No structured-data channel between panes | `ContextKeyValue = string\|number\|boolean\|null` (`types.ts:115`); the rejection rationale for objects is at `:104-113` |
| Layout measures width exactly once | `ShellLayout.tsx:747-752` — "The measurement is not repeated. There is no observer here." |
| Pane 3 has no input surface | repo-wide grep for `<input>/<textarea>/<select>/contentEditable/role=textbox` in non-test `src/**/*.tsx` → one hit, an `<svg>` |

### The direction

1. ShellUX must be a **native host application**, not a web page.
2. It must **use, enhance, and leapfrog** the Outlook three-pane standard.
3. **Graphical visualization in all three panes.**
4. **Pane 3 must support both visualization and user input.**
5. **Visually stunning, multiple themes.**
6. **Auto-update to a new release from the repo.**

Nothing in the current codebase serves 2–6, and 1 is structurally blocked by ADR-0002.

### Decisions taken

| Decision | Answer |
|---|---|
| Runtime | **Electron 43.x** (Chromium 150, Node 24.18) |
| Targets | Windows 11 primary, macOS. No Linux requirement. |
| Pane isolation | Process isolation per pane — `BaseWindow` + N `WebContentsView` — **see §2, this needs one correction** |
| Engine pinning | Not required |
| Ribbon | **Deleted.** One command registry, four views. |
| Third-party extensions | Undecided → the isolation boundary must stay swappable |
| Approach | Evolve the existing codebase. Do not rewrite. |

Electron over Tauri, decisively: `WebContentsView` (multi-webview-in-one-window) is stable
in Electron and behind an `unstable` flag with open rendering bugs in Tauri; and Win+macOS
under Tauri means **two rendering engines** (WebView2/Blink on Windows, WKWebView on macOS)
for an app whose whole point is heavy graphics.

### Intended outcome

A native desktop shell whose three panes each visualize at a different performance tier,
whose command surface beats the ribbon at discovery rather than imitating it, whose pane 3
is a block ledger that is simultaneously canvas and composer, whose entire visual system —
including chart colors inside extension processes — is driven by one generative token set
that ships many themes cheaply, and which updates itself from a release feed.

---

## 2. Correction to the isolation premise — read before anything else

**When I asked about per-pane isolation, I framed it as "a misbehaving extension in pane 2
cannot crash or leak into pane 3." That framing was wrong, and the code says so.**

`ExtensionViews` declares `pane2` and `pane3` on **one** blueprint, and `ActiveExtension`
(`src/core/ActivationContext.tsx:117-125`) carries one blueprint and one `IShellAPI`.
**Panes 2 and 3 are always the same extension.** Only one extension is in the foreground at
a time. So splitting per pane puts *one extension* in two processes, and yields **zero**
boundary between *different* extensions.

What per-pane isolation genuinely buys, and these are real:

- **Crash containment.** A pane-3 renderer crash leaves the nav tree and pane 2 alive.
  React `FaultBoundary` cannot do this — it catches render throws, not infinite loops,
  memory exhaustion, or a wedged renderer.
- **Per-pane memory accounting**, which matters for a visualization-heavy pane 3.
- **A swappable boundary** — which is the actual requirement behind "third parties undecided."

What it costs:

- One extension's bundle loads **twice**, in two realms. Module-level state that pane 2 and
  pane 3 share today (both mocks do this — `MailPlugin.tsx:315-341`) **stops being shared**.
- It pays ADR-0001 Amendment E's full isolation cost while **not discharging Amendment E's
  trigger** — when third parties become real, per-*extension* isolation is still owed.
- **§9 R1**: it may break the WCAG 2.2 AA keyboard commitment. Unresolved.

**Recommendation: build it, and name it "crash containment," not "isolation," in the ADR.**

**But the three-process topology is a gated decision, not a settled one.** Phase 6 ends with
a named **topology gate** (§8, §9 R1): an NVDA + VoiceOver result on a throwaway two-view
window decides between

- **three processes** — host chrome + pane 2 + pane 3, as above; or
- **two processes** — host chrome + one extension process holding **both** panes 2 and 3.

Two-process keeps panes 2 and 3 in one document, so ARIA relationships and focus order between
them work for free, and **§2.1's shared-module-state problem evaporates entirely**. It loses
only *per-pane* crash containment — an extension crash still cannot take the shell down. Given
R1 is unresolvable from this repository and §2.1 adds real cost to the three-process path,
**the thumb is on the scale for two-process** unless the spike comes back clean. Phase 7's
shape depends on that answer; everything before it is identical either way.

### 2.1 A consequence that must be handled before the split, not after

Both verification remotes keep **module-scope stores** with their own
`getSnapshot`/`subscribe`/`commit` (`MailPlugin.tsx:315-341`, `DatabasePlugin.tsx:299-323`),
precisely because "the host carries only the id, never the item." Pane 3 looks the selected
item up in that module store (`MailPlugin.tsx:655-665`, `DatabasePlugin.tsx:690`).

Under a pane2/pane3 process split the module loads **twice**. Static seed lookups still
resolve — both copies are seeded identically — so it *looks* fine, while every `commit` in
pane 2 becomes invisible to pane 3. **A silent divergence in the reference implementation
extension authors are told to copy is worse than a clean break.**

**Fix in Phase 5, before Phase 7:** both remotes migrate their cross-pane state from module
scope onto `publishPayload`/`subscribePayload` (§4.2). They become the first consumer of that
channel, which is the right proof of it anyway.

---

## 3. Target architecture

### 3.1 Layout — "rail + 3 panes + ledger", not "3 panes + ribbon"

```
┌──┬──────────┬────────────────┬───────────────────────────────┬─────┐
│R │ PANE 1   │ PANE 2         │ PANE 3  (Block Ledger)        │meta │
│A │ nav tree │ virtualized    │ ┌ context bar · 32px ────────┐│rail │
│I │ + metric │ list · 28px    │ ├ block: chart   [inspector] ││(opt)│
│L │  glyphs  │ rows + inline  │ ├ block: table              ││     │
│48│ (CSS)    │ SVG sparklines │ ├ block: agent response     ││     │
│px│          │ + value+delta  │ └ composer (omnibox) ───────┘│     │
└──┴──────────┴────────────────┴───────────────────────────────┴─────┘
```

- **Layout presets cycled by one keystroke** — Focus / Split / Triple / Canvas — rather than
  free-form dragging only. Dragging still works.
- **Every pane visualizes, at three different performance tiers** (§3.3).
- Panes as distinct surfaces separated by a 1px border and a gutter (JetBrains Fleet's
  "islands" model), not welded edge to edge.

### 3.2 Process topology

| Process | Contents |
|---|---|
| **Main** | Authoritative registry (manifests only), authoritative `ShellStateStore`, `BaseWindow` + `WebContentsView` geometry, command routing, keyboard arbitration, focus ring, `HydrationEngine` over a filesystem `ShellStorage`, theme service, updater |
| **Host chrome** (view 0) | Rail, pane 1 nav tree, dividers, 32px context bar, Cmd-K palette, omnibox. Read replica of context |
| **Pane 2** (view 1) | Extension module loads here; `views.pane2` renders here. Read replica |
| **Pane 3** (view 2) | `views.pane3`, block ledger, floating toolbar (it positions against a DOM selection in *this* document, so it cannot be host chrome). Read replica |

All views: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
**Pane 1 does not get a process** — it renders host-owned, already-serializable
`NavigationNode` data.

### 3.3 Visualization — three tiers, three different problems

Panes 2 and 3 are **opposite** performance problems. Pane 2 is hundreds of tiny charts,
mount/unmount dominated → instance overhead is the enemy. Pane 3 is one chart with up to
millions of points → draw throughput is the enemy. **No single library wins both.**

| Tier | Where | What | Why |
|---|---|---|---|
| **0** | Panes 1–2 | **No library.** Hand-rolled inline SVG `<path>` sparklines (7–30 points, memoized `d` string, `stroke="currentColor"`) and CSS-gradient bars driven by a `--v` custom property | A chart *instance* per row means construct/destroy on every scroll tick in a virtualized list. A memoized path string has zero instance cost and inherits theme color for free |
| **1** | Pane 3 standard charts | **Apache ECharts**, canvas renderer, tree-shaken (`echarts/core` + explicit `use([...])`) | Apache-2.0, widest chart coverage, 100k+ points on canvas, a real theming engine |
| **2** | Dense realtime timeseries | **uPlot** (MIT, ~48kB) | Millions of points at 60fps. Docs are poor — budget a wrapper written once |
| esc | Bespoke pixel-controlled viz | **visx** (MIT) | CSS-var-native SVG primitives |

**Rejected:** Lightweight Charts (Apache-2.0 *with* a user-visible TradingView attribution
obligation — a product decision, not an engineering one), AG Charts (zoom, crosshairs,
navigator and annotations are all Enterprise-only), deck.gl (WebGPU path is explicitly not
production-ready), Recharts as primary (SVG ceiling too low), Nivo (bundle cost for defaults
we would override).

**WebGPU: not yet.** Shipped in all major browsers Nov 2025, but the most mature adjacent
stack (luma.gl v9 / deck.gl) still calls its support not production ready. Design the
internal `<Chart>` wrapper so a renderer is swappable; don't bet on it now.

### 3.4 Command surface — one registry, four views

`RibbonAction` is **generalized, not replaced** — the `isVisible(ctx)` predicate,
`onExecute(ctx, shell)`, the structured `Hotkey` and the 60-key `HOTKEY_KEYS` allowlist all
survive. `type RibbonAction = Command` stays as a deprecated alias so mocks and tests migrate
incrementally.

| Surface | File | Role |
|---|---|---|
| Context bar, 32px | `src/components/command/ContextBar.tsx` | 5–8 contextual commands. Replaces the ribbon at ~⅓ the vertical cost. **Must inherit** `RibbonToolbar`'s portalled Radix menu, `INLINE_ACTION_LIMIT`, `contain: paint` and all eight accessibility fixes from the 2026-07-31 audit |
| Cmd-K palette | `src/components/command/CommandPalette.tsx` | The complete surface. **Browsable on empty query** — grouped categories, recents, suggested-for-selection. This is how it beats the ribbon at *discovery*, which is the ribbon's actual purpose |
| Floating toolbar | `src/components/command/FloatingToolbar.tsx` | Selection-triggered inside pane 3 only. Supplements the context bar, never replaces it |
| Omnibox composer | `src/components/command/OmniboxComposer.tsx` | Persistent, docked at the bottom of pane 3. Warp-style intent auto-detection (`filter` / `command` / `ask`) labelled before submit. **This is the input half of requirement 4** |

Cmd-K = palette; Cmd-P = object jump. Separate, as VS Code does — merging makes both worse.

**Palette containment (decide before building it):** the palette lists **foreground commands
+ host commands + a "switch extension" verb**, and nothing else. Listing a background
extension's commands would be a *wider* route to a plug-in handler than the ribbon ever was —
its `onExecute` would receive a `RibbonContext` whose `contextKeys` belong to a different
extension. Cross-extension search, if wanted, is activate-then-execute: two visible steps.

### 3.5 The `isVisible` problem, and the fix ADR-0001 already wrote

`isVisible` is a **synchronous render-phase boolean**. It cannot cross a process boundary —
ADR-0001:1349-1352 says so. Three of the four command surfaces are host chrome evaluating
predicates for commands whose code lives in a pane process.

**Resolution: `isVisible` gains a declarative sibling, `when?: string`** — an expression over
`RibbonContext`, evaluated by the host against its own replica. `types.ts:180` already names
VS Code as the prior art for context keys, and `ContextKeyValue`'s primitives-only union is
exactly what makes a `when` expression serializable and cheap.

- `when` is **required** for commands appearing in host chrome.
- `isVisible` keeps working as a **pane-local fast path** for pane-local surfaces (the
  floating toolbar). Two tiers, documented.
- `onExecute` stays in the pane process, invoked by command id. Fire-and-forget, so async is fine.

The primitives-only constraint — written for render-phase-getter reasons — turns out to be
what makes the whole cross-process transport free. **It is the best-aged decision in the
codebase and the ADR amendment should say so.**

### 3.6 Theming — generative tokens, injected per document

**CSS custom properties do not cross a document boundary.** With per-pane processes, the
host must do what VS Code does: inject the resolved token set into every pane document at
mount and re-inject on every theme change.

**Pipeline:** `design/tokens/*.tokens.json` (DTCG, stable spec since Oct 2025) →
Style Dictionary v4 → `src/styles/tokens.generated.css` (OKLCH) +
`src/core/theme/tokens.generated.ts`. Generated artifacts are **committed**, because
README's acceptance test is "no local setup"; drift is caught by `npm run tokens:check`.

**Linear's generative model:** a theme is **three inputs** — base color, accent color,
contrast — plus a curve, in OKLCH (perceptually uniform, so equal numeric changes are equal
visual changes). Not a 200-key color dump. This is what makes "multiple themes" a solved
problem rather than a maintenance tax.

**Three tiers:**
- **Primitive** — `--gray-1..12`, `--accent-1..12`, status ramps. Generated. Never referenced
  by component code, never visible to extensions.
- **Semantic** — the only tier extensions may read. ~63 names across surfaces (9), text (9),
  borders (5), focus (4), accent (5), status (8), charts (23).
- **Component** — host only. `--pane-header-h`, `--context-bar-h: 32px`, `--row-h-*`,
  `--rail-w: 48px`, `--radius-*`, `--shadow-*`, `--motion-*`.

**Tokenize color, radius, shadow, motion and dimensions. Do NOT tokenize padding or
font-size.** Reason: the density scan at `ShellLayout.test.tsx:818+` measures padding and type
size, and `typeSizeOffenders` **silently passes** an arbitrary value it cannot parse — so
`text-[var(--type-body)]` would sail through contributing nothing. Padding fails loud; type
size fails silent. Keeping those literal means the density scan survives **byte-for-byte**.

**`darkMode: ['selector', '[data-theme="dark"]']`** — a data attribute, not a class, because
it composes with the per-document injection. But the stronger move is to **delete the 51
`dark:` variants** rather than make them testable: if every color is a token whose *value*
swaps on `[data-theme]`, `dark:border-neutral-800` has nothing left to say. That answers
issue #67 by removing the untested surface, not by testing it.

**A theme is untrusted input reaching a stylesheet.** `normalizeTheme.ts` is a trust boundary
in the same shape as `normalizeNavigationNode`: keys must be members of the host-owned
`SEMANTIC_TOKEN_NAMES` set (so a third-party theme structurally cannot reach `--gray-7`),
values must **match an allowlist pattern** (not survive a denylist), missing keys fill from
the built-in theme, and the whole thing is rejected if it fails the contrast manifest.

**Canvas cannot read CSS custom properties** (confirmed on the ECharts dev list). A
`ThemeBridge` singleton resolves the whole semantic set with **exactly one**
`getComputedStyle(documentElement)` per theme change, registers the ECharts theme, and
broadcasts. Never per chart. Extensions get the resolved palette through
`shell.getTheme()` / `shell.onThemeChange()` — new `IShellAPI` members, deep-frozen and
revocable like every other.

**Windows 11 materials:** `backgroundMaterial: 'mica'` behind the window chrome, **opaque
panes**, acrylic **only** on the palette and popovers. This follows Microsoft's own guidance
verbatim — don't apply backdrop material more than once, and use opaque backgrounds for
vertical panes.

### 3.7 Density that reads as beautiful rather than cramped

- **Borders separate, shadows elevate.** In-pane separation is 1px `--border-subtle`, never a
  shadow. At 11–13px type, a shadow on a non-floating element reads as blur.
- **Three type sizes.** 11px metadata, 13px body/rows, 15–16px pane-3 block titles.
- **`font-variant-numeric: tabular-nums` on every number.** Proportional digits cause
  horizontal jitter on update — the single most visible "cheap" tell in a dense table.
- **Motion budget** 180ms base / 120ms micro, `cubic-bezier(0.4,0,0.2,1)`. Never animate pane
  resize, list scroll, or selection change. The enforceable half: **no token exists** for those.
- **Focus ring** two-tone — `outline: 2px solid var(--focus-ring)` plus an inner
  `box-shadow` ring in opaque surface color, so the indicator survives a chart canvas
  painted underneath.

---

## 4. Contract changes

All three answer an existing rejection rationale rather than reversing it.

### 4.1 Pane 1 visualization — extend `NavigationNode`, do **not** add `views.pane1`

`ShellLayout.tsx` decision 5 states verbatim that "nothing an extension can register makes
the ribbon or pane 1 throw during render — both render validated primitive strings — so
those two boundaries are defence-in-depth." A `views.pane1` makes that **false**: one
extension's metric renderer throwing would take the entire nav tree — every extension's
rows — down to a fault surface.

```ts
export type NavigationMetricKind = 'bar' | 'sparkline' | 'dot';

export interface NavigationMetric {
  readonly kind: NavigationMetricKind;    // lookup key, closed host vocabulary, never interpolated
  readonly value: number;                 // host-CLAMPED to [0,1]; non-finite rejected
  readonly series?: readonly number[];    // each clamped; bounded by MAX_METRIC_POINTS: 32
  readonly description: string;           // REQUIRED — the non-color, non-shape channel WCAG 1.4.1 asks for
}
```

**No color field**, deliberately: a plug-in-supplied color would defeat contrast validation,
so a metric draws in `currentColor` and `--chart-1` and nothing else. `--v` is a **number**,
never a length or color, so a value cannot carry a CSS statement even before clamping.

Liveness (the mistake `badgeCount` already made once, per issue #12): scalar via new
`IShellAPI.setNavMetric(nodeId, value)` on the same `(extensionId, nodeId)` scope
`setBadgeCount` uses; series rides §4.2's channel keyed `'nav-metric:'+nodeId`.

### 4.2 Pane 3 structured data — a separate channel, answering `types.ts:104-113`

The three hazards that rationale names, each answered rather than waved away:

| Hazard | Answer |
|---|---|
| "getters that re-enter host code during a render-phase predicate" | The payload **never enters `RibbonContext`**. Separate store slice; `getContext()` does not return it; `isVisible(ctx)` structurally cannot reach it. The caller's getters run **once**, at an imperative door never on a render path |
| "a prototype another extension could reach through" | Host-owned **deep copy** into `Object.create(null)` records and frozen arrays. Nothing of the caller's is retained |
| "an identity no `Object.is` bail-out could compare" | Subscribers compare a **host-assigned monotonic `revision`**, never the object. Stated honestly: republishing identical content *does* bump the revision and *does* notify |

```ts
export type PayloadLeaf = ContextKeyValue;   // Amendment K Decision 2 preserved AT THE LEAVES
export type PayloadValue = PayloadLeaf | readonly PayloadValue[] | { readonly [k: string]: PayloadValue };
export type BlockKind = 'chart' | 'table' | 'form' | 'text' | 'agent';

// IShellAPI additions
publishPayload(channel: string, kind: BlockKind, data: unknown): void;
readPayload(channel: string): StructuredPayload | null;
subscribePayload(channel: string, listener: (p: StructuredPayload) => void): () => void;
```

New bounds the primitive rule bought for free and which must now be paid for explicitly:
depth 6, nodes 4096, bytes 262144, channels 32. Cycles rejected, never truncated.

**No new `ShellUXErrorCode`** — the existing ten cover every rejection, so the compiler-pinned
`SHELL_UX_ERROR_CODE_MEMBERS` at `types.ts:748` is untouched.

Chart specs get **no color field either**: `normalizeChartSpec` assigns `colorIndex`, `dash`
and `marker` from host rotations. A series with a color and no second channel **is not
representable in the type** — that is "never encode meaning by color alone" enforced by the
compiler rather than asserted in prose.

### 4.3 Live dimensions — add an observer, keep the callback ref

`measureGroup` (`ShellLayout.tsx:747-752`) must **not** be replaced. Its synchronous-during-
commit timing *is* the no-flash property, pinned on the render log by
`ShellLayoutPersistence.test.tsx`. New `src/hooks/useElementWidth.ts` sits beside it, with a
`typeof ResizeObserver !== 'function'` guard (jsdom and older embedded WebViews lack it) and
a ≥1px rounded floor to avoid `react-resizable-panels`' renormalization warning. The observer
recomputes percentage **bands** (`minSize`/`maxSize`); it does **not** re-derive `defaultSize`.

`noEventListener.test.ts` needs **no edit** for this — `ResizeObserver`/`observe`/`disconnect`
match neither of its patterns. Do **not** stub `ResizeObserver` in `src/test/setup.ts`; the
7-line file stubs nothing today on purpose, and a global stub makes the absent branch
unreachable and untested.

`ShellLayout.tsx`'s "There is no observer here" banner becomes false and must be rewritten in
the same commit — `check-citations` runs inside `verify`, so this is build-breaking, not cosmetic.

---

## 5. State and IPC across processes

**Main owns truth. Each renderer holds a synchronously-readable replica**, so
`IShellAPI.getContext()` keeps its exact signature and `useSyncExternalStore` keeps working.

Writes are optimistic-local, authoritative-async: the replica validates with the *existing,
unchanged* validators (so `INVALID_FIELD`/`PAYLOAD_TOO_LARGE` stay synchronous and identical),
applies locally, notifies locally, and posts a patch. Main re-validates (a renderer is not
trusted), applies, and broadcasts a commit with an origin sequence the originator uses to
suppress its own echo.

Every payload is structured-clone-safe **by construction**, because `ContextKeyValue` is
primitives only. One catch that is a real defect if forgotten: `Object.create(null)`
prototypes do **not** survive structured clone, so the replica must **re-create** the null
prototype on receipt or the `__proto__` guarantee at `types.ts:193-199` silently degrades.

### Three contract properties that genuinely change — record as corrections, not footnotes

1. **`subscribe`'s synchronous guarantee becomes scoped.** `ShellAPI.ts:126-142` says a
   listener "runs before the writing statement returns, so it reads every value any other
   holder writes." **True within a renderer. False across renderers** — pane 2 sees pane 3's
   write a tick later. The security consequence is favorable (a listener can no longer throw
   into another pane's writer frame) but the claim must be re-scoped and the test re-titled.
2. **`REVOKED` becomes an advisory cached check.** The replica-local flag still throws
   synchronously for the ordinary case; authoritative revocation arrives async. The window is
   closed at the **pane** level instead — main tears down the pane view on `unregister`, so the
   whole realm dies rather than lingering.
3. **`MAX_NOTIFY_DEPTH` is per-replica and no longer sufficient.** A cross-process write loop
   resets the depth counter at every hop, so `REENTRANT_NOTIFY` never fires and the loop runs
   forever at message rate. Mitigation: per-origin rate limit in main + a pane reload.
   **This is a new failure mode the current design cannot see and the most likely production
   bug in the whole pivot.**

Also: `useSyncExternalStore` prevents tearing *within* a renderer but cannot prevent skew
*between* renderers. Two panes can show different snapshots for one frame. State it; don't fix it.

**The blueprint splits at the process boundary.** Components and `onExecute` stay pane-local;
`id`/`name`/`version`/`navigationTree`/command metadata/`when` cross to main as a serializable
`ExtensionManifest`. Extension authors keep writing one object — the split happens inside
`src/core/ipc/manifest.ts`.

**Keyboard is hybrid, renderer-first.** `before-input-event` fires in main *before* DOM
handling and therefore carries **no DOM target and no `defaultPrevented`** — so the existing
`isSuppressed` (IME, editable target, already-handled) cannot run there. Each renderer keeps a
host-owned bootstrap keydown listener running the **unchanged** suppression logic; unmatched
chords go to main. `before-input-event` is used for **exactly one** thing: an escape hatch for
chords that must fire even if a renderer is wedged.

---

## 6. Auto-update from the repo

**Mechanism:** `electron-updater` (part of the electron-builder family), NSIS on Windows and
the `.zip` artifact on macOS, with `autoUpdater.checkForUpdatesAndNotify()` on launch and on
an interval. Update state surfaces as a host command in the palette ("Check for updates",
"Restart to update") and a badge, never a modal that interrupts work.

**The blocker, stated plainly: the repo is private on a free plan.** HANDOFF §5 records that
`GET /repos/.../branches/main/protection` and `/rulesets` both return **403 — "Upgrade to
GitHub Pro or make this repository public."** `electron-updater`'s GitHub provider on a
private repo requires a token **in the shipped client**, which anyone can extract — that is
not an option. Three real paths:

| Option | Cost | Verdict |
|---|---|---|
| **Make the repo public** | Publishes the source | Also fixes branch protection (§9 R11) and private vulnerability reporting (HANDOFF §6.2) — **all three blockers share this root cause** |
| **Pay for GitHub Team/Pro** | ~$4/user/mo | Fixes branch protection and PVR, **does not fix this** — a private repo's release assets still need auth |
| **Static `generic` feed** (S3 / Azure Blob / any static host), published to by a release workflow that *reads* from the private repo | One bucket + one workflow | **Recommended.** Repo stays private, no token ships, updates work. Sign with the same identity as the installer |

**Recommendation: option 3, with option 1 evaluated separately on its own merits** — public
would resolve three tracked blockers at once, so it deserves a real decision rather than being
ruled out by default.

**ADR-0002 collision:** the feed URL is a hardcoded hostname in a tracked non-Markdown file,
which `check-portability.mjs:299-310` fails on sight (`DOCUMENTED_PORTS` holds exactly one
entry today). The fix is a **`DOCUMENTED_ENDPOINTS` table** with one entry and a written
reason — the same declared-not-exempted shape ADR-0002:139-141 asks for, not an allowlist hole.

**Signing risk, flagged rather than solved:** since 26 March 2026, Azure Trusted Signing
(renamed Azure Artifact Signing) has been issuing from two new intermediate CAs, and
executables signed through them are reportedly being SmartScreen-flagged as unrecognized.
**Unverified — treat as live.** Keep the signing provider swappable in `electron-builder.yml`,
keep a traditional OV/EV path viable, and make "download the signed installer on a clean
Win11 VM at SmartScreen defaults and record whether the dialog appears" a **release-checklist
step**. A new signing identity accrues reputation slowly regardless — budget for early
releases being flagged even in the good case.

---

## 7. ADR-0002 — amend, do not supersede

Every native artifact violates ADR-0002's mandate. **Amending it is step one of the work.**
Which clauses at `:62-91` actually bite, measured against `check-portability.mjs`:

| Clause | Bites? | Why |
|---|---|---|
| `:74-75` hardcoded hostname / undocumented port | **Yes, certain break** | The update feed URL (§6) |
| `:79` platform-only script/build command | **Yes in prose; NO in the checker** | `platform-only-invocation` (`:318-327`) matches `cmd.exe\|powershell\|pwsh\|xcopy\|robocopy\|.bat\|.cmd\|.ps1` — `electron-builder --win nsis` matches **none**. The prose forbids what the regex misses. **Fix both in one commit**; relying on the gap is the "written rule with no checker" ADR-0002:225-229 rejects |
| `platform-only-path-separator` (`:329-332`) | **Yes** | Pattern is any backslash in `package.json` or a workflow. **Fix by writing builder paths with forward slashes** — electron-builder accepts them everywhere. No ADR change needed |
| `:76-78` undeclared env assumption | **Yes in prose** | `CSC_LINK`, `APPLE_ID`, `APPLE_TEAM_ID`, feed creds. Fix with a tracked `docs/signing.md` declaring every name, purpose, and working default (unsigned local build) |
| `:63-73`, `:80-86` | No | Unaffected — but a per-user application-data environment variable written literally into any config trips `environment-home-reference`. Use `app.getPath('userData')`. (This row is itself proof the rule bites: naming that variable outright here failed the gate.) |

**The acceptance test stays word for word:**

> A fresh clone on a different operating system runs `npm ci && npm run verify` with no local
> setup and no edits.

`verify` gains **no Electron stage**. The justification is already written in this repo —
`playwright.config.ts:16-21` puts Playwright outside `verify` because the browser download is
outside `npm ci` and outside `package-lock.json`. **Electron's binary and code-signing certs
are the identical argument, one step larger.** A second sentence is added:

> **A packaging acceptance test:** on Windows or macOS with the platform SDK present,
> `npm ci && npm run verify:desktop` produces an installable artifact. This is **not** a
> precondition for contributing; `verify` alone is.

Cost to state honestly: `npm ci` now downloads a ~120MB Electron binary on every fresh clone
and CI leg. Mitigate with `ELECTRON_SKIP_BINARY_DOWNLOAD` on the ubuntu `verify` leg — and
note that reading that variable is itself a clause-6 event, declared in `docs/signing.md`.

**CI:** keep `ci.yml`'s three legs for `verify`. Add `desktop.yml` running `verify:desktop` on
`windows-latest` + `macos-latest`, on tags and `workflow_dispatch` only — not every PR, given
the 2×/10× billing.

---

## 8. Sequencing

Every step leaves the app runnable and `npm run verify` green.

### Phase 0 — prerequisites, no Electron
- **0a. Route the working demo to `/`.** HANDOFF §8 item 3 calls this the highest
  value-to-effort item in the repository. `dev.html` → `src/dev/DevShell.tsx` exists; `npm run
  dev` still serves an empty shell.
- **0b. Fix the two data-destroying layout defects** (`ShellLayout.tsx:731`, `:733-736`) —
  collapsing pane 1 discards the layout and persists percentages summing to 116%. Fix them
  **first**, because 0a makes this an artifact a human is asked to run. Record honestly that
  the pivot later deletes the code they live in; the value is one release of correct behavior
  plus a browser-lane regression test that survives as a behavioral spec.
- **0c. Fix `check-citations`' `patternFor` trailing-placeholder hole** (HANDOFF §6.6 — 17
  cited titles are currently shadowed by prefix matches). **Do this before Phase 2**, because
  the ribbon deletion renames many cited titles at once and this plan is what makes the hole
  load-bearing.

### Phase 1 — Electron wrapper, single process, zero contract change
`BrowserWindow` loading the existing SPA. `electron/main/index.ts` is ~40 lines. All tests
green, `verify` untouched. **A native window exists on day one and issue #39 — "nobody has
ever run the app," the sole tracked Blocker — closes.** Land ADR-0002's amendment here, where
the first non-portable build command appears.

### Phase 2 — token pipeline, no component touched
`design/`, generated CSS + TS, `tailwind.config.js` colors, `darkMode: ['selector', …]`,
`scripts/check-tokens.mjs` + its `node --test`. Verify the Tailwind 3 `<alpha-value>` +
`oklch(var(--x))` shape with one scratch utility **before** committing the semantic set.

### Phase 3 — color migration
115 literals → tokens; delete every `dark:`; rewrite the color half of the 43 `toHaveClass`
against an exported `TOKEN_CLASS` record; add `noRawColor.test.ts`, `theme.test.tsx`,
`e2e/theme.spec.ts`. **The heavier AA-compliant border lands here** (§9 R2). Fix the
`typeSizeOffenders` silent-pass hole in the same change.

### Phase 4 — command registry replaces the ribbon
`Command` + `CommandRegistry` + `when.ts` + all four surfaces. **Delete `RibbonToolbar.tsx`
at the end.** Budget it as a **prose migration, not a file deletion** — `types.ts:41-57`,
`hotkeyDispatch.ts:99`, Amendments H and J, `DEVELOPER.md` and `README.md` all cite it by
name, and `check:citations` fails hard on every stale reference. **Largest unplanned-effort
risk in the plan.**

### Phase 5 — contract additions, still single process
`NavigationMetric` + `MetricGlyph` (§4.1), the structured payload channel + Amendment L
(§4.2), `useElementWidth` (§4.3), `ThemeBridge` + `normalizeTheme` + Amendment M.
**The whole theme contract is exercisable here, before Electron.**
Also **§2.1**: migrate both verification remotes off module-scope cross-pane state onto
`publishPayload`/`subscribePayload`. They become the channel's first consumer.

### Phase 6 — the transport seam, still single process
`src/core/ipc/**` with an **in-process** `PortLike` (a direct function call, shaped like
`HydrationEngine`'s `ShellStorage` seam). `AuthoritativeStore` and `ReplicaStore` both exist,
wired end to end, in one renderer, under full jsdom coverage. **This is where the state design
is proven with no Electron involved** — including the write-storm failure mode.

**Ends with the topology gate (§2).** Run the NVDA + VoiceOver spike against a throwaway
two-view window and decide three-process vs two-process before Phase 7 starts. Write the
result into the ADR either way — a spike whose outcome is not recorded gets re-litigated.

### Phase 7 — `BaseWindow` + `WebContentsView`
Swap `PortLike` for `MessagePortMain`. Three views. Main owns geometry. `HydrationEngine`
moves to main. `paneKeyBridge` replaces `hotkeyDispatch`; host-owned focus ring; the
`noEventListener` allowlist edits + a new `electron/__tests__/noElectronListener.test.ts` +
a cross-document IDREF scan. Land ADR-0001 Amendment L. Mica.

### Phase 8 — charts and the block ledger
ECharts + uPlot are the **first runtime dependencies beyond Radix and React**. Record the
measured bundle delta — README's performance section is explicit that unverified numbers must
not be quoted as characteristics.

### Phase 9 — packaging, signing, auto-update
NSIS + dmg + notarization + `electron-updater` + the release workflow publishing to the feed.
The SmartScreen VM observation is a release-checklist item.

---

## 9. Risks

| # | Risk | Response |
|---|---|---|
| **R1** | **Electron may expose N `WebContentsView`s as N separate platform accessibility trees** (Windows UIA / macOS NSAccessibility). If so, the WCAG 2.2 AA keyboard commitment in `README.md:570` is broken in a way a focus ring does not fix, and screen-reader virtual-cursor navigation across the shell is broken. **I cannot resolve this from the repository.** | **The topology gate at the end of Phase 6** (§2), with real NVDA + VoiceOver. If N trees: collapse to two processes — host chrome + one extension process holding panes 2 and 3 — which also dissolves §2.1. Accepting a documented AA regression is the fallback, not the default. Record the outcome in the ADR whichever way it goes |
| **R2** | **The AA-compliant border is a visible regression.** `border-neutral-200` on white is ~1.19:1; 3:1 needs roughly `#949494`. The shell will look heavier and someone will file it as a bug | CHANGELOG entry stating it in advance. The `--border-subtle` tier keeps the weight off purely decorative rules |
| **R3** | **The ribbon deletion cascades through prose**, and `check:citations` fails hard on each stale title | Its own PR ahead of the component work. Fix the `patternFor` hole (Phase 0c) first so the gate is reliable during the churn |
| **R4** | **Cross-process write storms defeat `MAX_NOTIFY_DEPTH` entirely** | New rate limit + pane reload. Test in Phase 6 against the fake `PortLike`, before Electron exists |
| **R5** | **`<alpha-value>` inside `oklch(var(--x))` on Tailwind 3 is unverified** (`node_modules` not installed) | One scratch utility in Phase 2. Fallback — two variables per token, no opacity modifiers — costs nothing, since the shell uses none today |
| **R6** | **FOUC on `WebContentsView` first paint.** The theme arrives by IPC; the document paints first | Inject the built-in theme of the correct appearance from **preload**, before first paint; the IPC message is a refinement. Not fully designed |
| **R7** | **ECharts cannot swap a registered theme on a live instance** — theme change means `dispose()` + `init()` | The wrapper preserves option state. Visible re-render, acceptable for a rare user-initiated action |
| **R8** | **`typeSizeOffenders`' silent-pass hole is live today.** Tokenizing type size before it is fixed makes the density scan quietly stop measuring type | The most fragile thing found. Fixed in Phase 3 |
| **R9** | **Azure Artifact Signing / SmartScreen flagging** (§6) — unverified, treat as live | Swappable provider; clean-VM observation as a release gate |
| **R10** | **`isVisible` → `when` changes the extension contract**, and some closures are not expressible as an expression | Two tiers: `isVisible` stays a pane-local fast path; `when` is required only for host-chrome commands |
| **R11** | **HANDOFF §5: branch protection is impossible (403), no review has ever been required**, and this is the largest change in the repo's history. PR #33 was +25,796 lines with zero reviews | This plan cannot fix it. Resolve before Phase 7 — and note it shares a root cause with §6's update feed and with the broken vulnerability-reporting path |
| **R12** | **HANDOFF §11: this machine is memory-degraded**; `test:coverage` has been OOM-killed twice. Three renderers plus a Playwright-Electron lane makes it worse | Cap `verify:desktop` and the desktop e2e lane to 1 worker; never run concurrently with `test:coverage` |
| **R13** | Panes 2 and 3 register the **same** extension independently; a non-deterministic manifest diverges | Main compares the two structurally and refuses the second |

---

## 10. Verification

**jsdom can prove none of the visual or native work** — no layout engine,
`getBoundingClientRect` → 0×0, no `matchMedia`, no `ResizeObserver`. This repo has already
shipped two defects through a fully green suite for exactly that reason (HANDOFF §11).
Three lanes, deliberately separate:

| Lane | Runs | Covers |
|---|---|---|
| **`npm run verify`** (unchanged, 9 stages, ~12–13 min) | Every commit, 3 OS legs | Everything pure: `src/core/ipc/**` against a fake `PortLike` (echo suppression, out-of-order commits, write storms, null-prototype re-creation), `when.ts` (a pure parser — the cheapest 100% in the repo), `normalizeTheme`, `normalizeChartSpec`, the payload validator, `focusScope`. **All inside the 100% gate** — HANDOFF §6.5 already criticizes that the gate covers ~72% of tracked source; widening the ungated share is a finding waiting to be filed against this very PR |
| **`npm run test:browser`** (`e2e/`, Chromium) | Every PR | Real pixels. `ribbon-overflow.spec.ts` dies with the ribbon → rewritten as `command-palette.spec.ts` / `context-bar.spec.ts`. New `e2e/theme.spec.ts` proves the **compiled stylesheet** actually applies tokens in each forced theme — the gap `ShellLayout.test.tsx:906-930` already names and cannot itself close. `focus-visibility.spec.ts` upgrades from a *difference* assertion to a *ratio* assertion, closing the gap it names at `:22-26` |
| **`npm run test:desktop`** (new, `e2e-desktop/` via `_electron.launch()`) | Tags + dispatch, Win + macOS | Six things nothing else can see: three `WebContentsView`s exist; Tab from pane 2's last control lands in pane 3's first; a chord in pane 3 reaches the right `onExecute`; a `setSelectedItems` in pane 3 reaches the host context bar within N frames; a divider drag moves pane 3's `setBounds`; **`process.crash()` in pane 3 leaves nav and pane 2 alive** — the one test that proves the topology bought what it cost |

**New gate: `scripts/check-tokens.mjs`** — plain Node, zero dependencies, in
`check-portability.mjs`'s register. Reads the **generated CSS** (not the DTCG source, so the
Style Dictionary transform is validated too) plus a `contrast-manifest.json` declaring
*pairs*, because contrast is a relation. Converts OKLCH → linear sRGB → luminance in-script.
**Exact in both directions**: a semantic token with no manifest row fails as *unreviewed*; a
manifest row naming a dead token fails as *stale*. Runs for every built-in theme, and is
**exported as a function** so `normalizeTheme` refuses a third-party theme against the same
manifest at load time — one rule, one implementation, two callers. Its own `node --test` must
include a deliberately-failing theme fixture so it cannot pass vacuously.

**`check-citations` blast radius, measured:** its test corpus is a raw filesystem walk
(`scripts/check-citations.mjs:854`), so `e2e-desktop/*.spec.ts` and `electron/__tests__/*`
enter automatically, and `electron/**/*.ts` becomes *prose* scanned for citations.

**A name collision, resolved rather than noted.** This section originally called the
Playwright-Electron lane `verify:desktop`, and §7 and ADR-0004 clause 8 both bind that name to
*packaging* — the sentence "`npm ci && npm run verify:desktop` produces an installable
artifact" is the packaging acceptance test and is the older of the two claims. Phase 9 took
the name for packaging, and the lane above is `test:desktop`. Two names, because they are two
different questions: one asks whether an installer comes out, the other asks whether three
views exist and a chord crosses a pane boundary. Phase 9 implements the first; the second
arrives with Phase 7 and does not have to argue about what it is called.

**Correction — this section previously said to pin `directories.output` to `dist/`, and that
is wrong.** `dist/` is Vite's output directory and `vite build` **empties** it, so
main-process and packaged output placed there is destroyed by every renderer build. Phase 1
therefore compiles the main process to **`dist-electron/`**, and Phase 9's builder output
needs its own directory again. The real obligation is the one this section was reaching for:
**every build output directory must be added to `.gitignore` and to `SKIPPED_DIRECTORIES` in
the same commit that creates it**, or `check:citations` walks an unpacked ~200MB app tree on
every run.

**Settled in Phase 9: the third directory is `release/`**, set as `directories.output` in
`electron-builder.yml`, and it is in both lists. The ~200MB figure was an underestimate —
`release/win-unpacked` measured **419 MB** on the first real build.

**Manual acceptance, because no test covers it:** run the app on a real Windows 11 machine and
confirm Mica renders behind the chrome with opaque panes; run NVDA and VoiceOver across the
pane boundary (R1); download the signed installer on a clean VM at SmartScreen defaults (R9);
install an older build and confirm it auto-updates from the feed (§6).

---

## 11. What we explicitly do NOT copy from Outlook

1. **The ribbon.** Not classic, not simplified, not "our own take."
2. **Fixed, non-scalable chrome heights.** Every chrome dimension is a token with a density switch.
3. **Hidden defaults that alter what data is visible** (Focused/Other). An active filter is
   visibly active, in-pane, one click from off.
4. **Two command modes where one is a crippled version of the other.**
5. **Multiple competing, non-unified command surfaces.** One registry or inherit the mess.
6. **A read-only detail pane.** Pane 3 accepts input as a first-class capability, not via a modal.
7. **A text-only information architecture.** Outlook has visualization in no pane; we have it
   in all three. **That is the leapfrog.**
