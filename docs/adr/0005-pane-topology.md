# ADR 0005 — Pane Topology: Three Processes or Two

- **Status:** **Proposed.** Nothing here is decided and nothing here is built.
  The decision is gated on a spike that cannot be run from this repository; see
  *The gate* below.
- **Date:** 2026-08-02
- **Deciders:** LEAPWare-ShellUX project owner and maintainers
- **Supersedes nothing. Settles** ADR-0004 clause 5 (topology, recorded there as
  provisional) and discharges ADR-0004 clause 6 (the accessibility gate) — *when
  it is accepted, and not before.*
- **Related:** `docs/plans/native-host-pivot.md` §2, §5, §9 R1; ADR-0001
  Amendment E (what a boundary in this project can and cannot be); ADR-0004
  clauses 5 and 6.

> **What changed since ADR-0004 clause 6 was written, and what did not.** Clause
> 6 poses the question as "one tree or N trees?" and says it cannot be resolved
> from this repository. The desk research recorded below shows that the question
> as posed **conflates two things with different answers**, and answers one of
> them from primary sources. It does not answer the other. So this ADR is a
> narrowing, not a resolution, and it stays `Proposed` for exactly that reason.

---

## Context

Phase 6 of the native-host plan is complete: `src/core/ipc/**` proves the
cross-process state design in one process, against a fake transport, under the
existing 100% coverage gate. `PortLike`, `AuthoritativeStore`, `ReplicaStore`,
`protocol.ts` and `manifest.ts` exist and are exercised end to end. **Everything
before Phase 7 is identical whichever topology wins** — that is what made it
correct to build the seam first.

Phase 7 is not identical. It creates the views, and the number of them is this
decision.

### The correction that reframes the whole question

§2 of the plan records it and it must be read before the options: **panes 2 and 3
are always the same extension.** `ExtensionViews` (`src/core/types.ts`) declares
`pane2` and `pane3` on one blueprint, and `ActiveExtension`
(`src/core/ActivationContext.tsx`) carries one blueprint and one `IShellAPI`.
Only one extension is in the foreground at a time.

So a per-pane split puts **one extension in two processes** and yields **zero**
boundary between *different* extensions. Whatever it buys, it is not isolation
between vendors, and the ADR must not call it that. What it genuinely buys is:

- **Crash containment, per pane.** A pane-3 renderer crash leaves the nav tree
  and pane 2 alive. React's `FaultBoundary` cannot do this — it catches render
  throws, not infinite loops, memory exhaustion, or a wedged renderer.
- **Per-pane memory accounting**, which matters for a visualization-heavy pane 3.

Both options below keep the property that actually motivates process isolation:
**an extension crash cannot take the shell down.** The difference between them is
only whether a pane-3 crash also takes pane 2 with it.

---

## The two options

### Option A — three processes

| Process | Contents |
|---|---|
| Main | Authoritative registry and store, geometry, command routing, updater |
| View 0 — host chrome | Rail, pane 1 nav tree, context bar, palette, omnibox |
| View 1 — pane 2 | `views.pane2` |
| View 2 — pane 3 | `views.pane3`, block ledger, floating toolbar |

### Option B — two processes

| Process | Contents |
|---|---|
| Main | As above |
| View 0 — host chrome | As above |
| View 1 — the extension | `views.pane2` **and** `views.pane3`, one document |

### What separates them, stated without the accessibility question

| | A (three) | B (two) |
|---|---|---|
| Extension crash takes the shell down | No | No |
| Pane-3 crash takes pane 2 down | No | **Yes** |
| Per-pane memory accounting | Yes | No |
| Extension bundle loads | **Twice, in two realms** | Once |
| Module-scope state shared between panes 2 and 3 | **Silently stops working** | Works |
| Document boundary between pane 2 and pane 3 | **Yes** | No |
| Document boundary between host chrome and the extension | Yes | Yes |

Row 5 is the one with a cost already being paid. Both verification remotes keep
cross-pane state in module scope (`MailPlugin.tsx`, `DatabasePlugin.tsx`) and
pane 3 looks the selected item up in it. Under option A the module loads twice,
static seed lookups still resolve because both copies are seeded identically, and
so it *looks* fine while every `commit` in pane 2 becomes invisible to pane 3.
Phase 5 has already migrated both remotes onto `publishPayload`/`subscribePayload`
to close that, which means **option A's cost here is paid but option B would not
have needed it paid at all.**

Row 7 is the one this ADR turns on.

---

## Evidence

**Every source below is desk research. None of it was observed running.** The
labels are the ones the research carries: *primary source* (Chromium or Electron
source, or a specification), *report* (a GitHub issue, i.e. somebody's
observation), and *inference* (a conclusion drawn here from the first two).

### 1. The question conflates two things

| Question | Answer | Basis |
|---|---|---|
| Is there one **connected** platform tree, reachable by a parent/child walk from the native window? | **Yes** | Primary source |
| Is there one **traversal unit** — one `AXTree`, one browse-mode document, one Tab ring? | **No.** N of each. | Primary source for the mechanism |

Clause 6 of ADR-0004 asks the first and cares about the second.

### 2. The trees are connected, and Electron gets that for free

Chromium builds a separate accessibility tree per frame, each with an
`AXTreeID`, and composes them on demand:

> "In Chrome's main browser process, the accessibility trees for each frame are
> cached separately, and when an accessibility client (assistive technology)
> walks the accessibility tree, Chromium dynamically composes all of the frames
> into a single virtual accessibility tree on the fly, using those aforementioned
> tree IDs."
> — `docs/accessibility/overview.md`, Chromium `main`
> (https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/overview.md)

And the composition is explicitly across *pages*, not only frames:

> "…each page has its own accessibility tree, but each Chromium *window* must
> have only one accessibility tree, so trees from multiple pages need to be
> combined (possibly also with trees from Views UI)."
> — same file, on `BrowserAccessibilityManager`

The generic mechanism is `views::WebView`, which hangs any `WebContents`' tree
off any `View` as a child tree:

```cpp
GetViewAccessibility().SetChildTreeID(rfh ? rfh->GetAXTreeID()
                                          : ui::AXTreeIDUnknown());
```
— `ui/views/controls/webview/webview.cc`, `NotifyAccessibilityWebContentsChanged`
(https://chromium.googlesource.com/chromium/src/+/main/ui/views/controls/webview/webview.cc)

**Electron uses it, on every platform.** `InspectableWebContentsView` constructs
a `views::WebView` per web contents, and `electron_api_web_contents_view.cc`
wraps exactly that
(https://github.com/electron/electron/blob/main/shell/browser/ui/inspectable_web_contents_view.cc).

**Inference:** the 2020 framing that a `BrowserView`'s tree is *orphaned* from
the window is out of date for v37–v43, and a design built around "the trees are
disconnected" would be built around something that is not true.

### 3. But they are N traversal units, which is what the WCAG commitment depends on

> "Some screen readers expect every tab / every unique web content container to
> be in its own HWND with class name `Chrome_RenderWidgetHostHWND`. … we need a
> fake HWND with the window class as `Chrome_RenderWidgetHostHWND` **as the root
> of the accessibility tree for each tab**."
> — `content/browser/renderer_host/legacy_render_widget_host_win.h`, Chromium `main`

**Inference (high confidence):** N `WebContentsView`s ⇒ N
`Chrome_RenderWidgetHostHWND`s, N `AXTreeID`s, N `BrowserAccessibilityManager`s,
N `AXFragmentRootPlatformNodeWin`s on Windows; on macOS, N
`RenderWidgetHostViewCocoa` roots.

Electron's own maintainer answer, on the predecessor API:

> "…this isn't possible given the way that `BrowserView`s are implemented by
> design. … **You have to navigate between the two views in order to trigger
> accessible tab navigation for the webContents of each.** Screen readers should
> themselves be able to handle this."
> — `codebytere`, electron/electron#26305, 2020-11-12, closed **`wontfix`**
> (https://github.com/electron/electron/issues/26305)

**Version caveat, stated rather than buried:** that is Electron ~11 and
`BrowserView`, not `WebContentsView` in v37–v43. It corroborates the
architecture; it is **not** a reproduced bug report for our target versions.

### 4. ARIA relationships cannot cross, and that one is certain

WAI-ARIA 1.2 defines a valid IDREF as *"a reference to a target element in the
**same document** that has a matching ID"* (https://www.w3.org/TR/wai-aria-1.2/).
Two views are two documents. So `aria-controls`, `aria-labelledby`,
`aria-describedby`, `aria-owns` and `aria-activedescendant` cannot span a view
under either option; the only question is *which* pair of surfaces loses them.

### 5. The enumeration boundary is the DOCUMENT, and connecting the trees would not fix it

A VoiceOver report against Electron `<webview>` — *"When the focus is inside of a
`<webview>`, VoiceOver only reports landmarks from that `<webview>` and not from
the outer window"* (electron/electron#25274) — was reproduced by its own reporter
**in plain Chrome with an ordinary `<iframe>`**, and filed upstream as Chromium
issue 1124703.

**Inference, and it is the load-bearing one in this document:** the boundary that
costs us landmark and heading enumeration exists at every document edge,
including inside a single `WebContents`. Therefore **fixing platform-tree
connectivity would not merge the enumeration**, and neither option A nor option B
removes the boundary. *The choice is only where to put it.*

### 6. Electron ships nothing that changes any of this

| Candidate | Status |
|---|---|
| `ViewAccessibility::SetChildTreeID()` | C++ only. `ChildTreeID` appears **0 times** in `electron/electron`. |
| `--enable-features=AccessibilityTreeForViews` | Real, and `FEATURE_DISABLED_BY_DEFAULT` on Chromium `main` (`ui/accessibility/accessibility_features.cc`). Unshipped. |
| `app.setAccessibilitySupportEnabled` | A global AXMode switch. Does not link trees. Also **reported broken since Electron v37** (electron/electron#48039). |
| `--force-renderer-accessibility` | Forces an AXMode bundle. Does not link trees. |
| electron/electron#26305 | Closed `wontfix`, 2020. |

### 7. A cost that lands on both options and is not about trees at all

electron/electron#42339 (**open**, 2024, explicitly about `WebContentsView` and
`BaseWindow.addChildView`): adding a view steals focus. A commenter reports it
causing WCAG 2.1.2 (No Keyboard Trap) and 2.4.3 (Focus Order) failures in a
shipping application. **Any** multi-view topology inherits this and must
implement focus arbitration by hand; the plan already budgets `paneKeyBridge` and
a host-owned focus ring for Phase 7.

---

## The argument, given the evidence

**Neither option removes the document boundary. The decision is where the shell
can best afford one.**

- **Option A puts a boundary between pane 2 and pane 3.** That is the pair with
  the *strongest* relationship in the whole product: a list and its detail. It is
  where a user Tabs most often, where `aria-activedescendant` and
  `aria-controls` would naturally be used, and where "selected item" must be
  announced in one surface and rendered in another. It is the worst available
  place to put a boundary.
- **Option B puts the only boundary between host chrome and the extension.** That
  pair's relationship is weaker and more arm's-length by design: pane 1 renders
  host-owned `NavigationNode` data, the context bar renders host-owned command
  metadata evaluated through `when` against the host's own replica, and neither
  reaches into the extension's DOM. The relationship is already mediated by
  serializable state — which is precisely what `src/core/ipc/**` now implements.

Option B also dissolves §2.1's shared-module-state hazard outright rather than
migrating around it, and costs only *per-pane* crash containment.

**That is the plan's thumb on the scale (§2, ADR-0004 clause 5), and the research
above pushes it further in the same direction** — chiefly finding 5, which
removes the hope that some connectivity fix would make option A's boundary
harmless.

**It is still not a decision.** See below.

---

## What could not be verified from here, stated plainly

Per ADR-0001 Amendment G, the limits are named rather than glossed. Items 2, 3
and 5 were written before the spike existed and are corrected in place on
2026-08-03 rather than left standing, because a limit that has since been lifted
reads as a live caveat and is not one.

1. **No screen reader has been run.** Not NVDA, not VoiceOver, not Narrator.
   jsdom has no layout engine and no platform accessibility layer; the browser
   lane is Chromium in Playwright, which is not an AT client; and the spike drives
   the Chrome DevTools Protocol, which is not one either. Every claim in this
   document about *what a screen-reader user experiences* remains inference from
   architecture. **This is the standing limit and it is why arm B decides.**
2. ~~No Electron application with two `WebContentsView`s was built or launched.~~
   **Superseded, 2026-08-03.** One was built — `spike/topology/` — and launched
   on **Electron 43.2.0 / Chromium 150.0.7871.129**, which is a release branch
   this project ships rather than Chromium `main`. See *Spike status* above. The
   source reads recorded in *Evidence* are still of `main` and are still labelled
   as such; what has changed is that the architectural inferences drawn from them
   now have measurements from a shipped branch beside them.
3. ~~`kAccessibilityTreeForViews` was confirmed disabled on `main` only.~~
   **Narrowed, 2026-08-03.** Its state on the Chromium 150 branch is still not
   known from source, and no claim about that is made here. What is now known is
   the observable consequence: launching the spike with
   `--enable-features=AccessibilityTreeForViews` changed **no** machine-observable
   value — not the tree count, not the roots, not `Tab`, not IDREF resolution.
   Whether it changes what an AT sees is part of arm B and is unanswered.
4. **No source was found** stating formally that NVDA's browse-mode virtual
   buffer is scoped per document. The Chromium-with-plain-iframe reproduction
   (finding 5) is the better evidence and is what is relied on. **The spike's own
   iframe control now corroborates the mechanism at the DOM and CDP level** — one
   web contents, three `RootWebArea`s, IDREFs failing across the frame edge — but
   it says nothing about NVDA's buffer, which is still arm B4.
5. ~~The decisive Electron issue is six years old and about a different API.~~
   **Partly superseded, 2026-08-03.** electron/electron#26305 is indeed old and
   about `BrowserView`, and no more weight is put on it. electron/electron#42339
   is about `WebContentsView` and `addChildView` specifically, was confirmed open
   on 2026-08-03, and **reproduces on Electron 43.2.0**. Finding 7's cost is
   therefore observed rather than reported.
6. **The spike's key and pointer events are synthesised into a chosen web
   contents.** They measure where Chromium's sequential focus navigation goes from
   a document, which is the question asked — but they are not operating-system
   input and cannot prove OS-level input routing. That is the gap arm B3 closes.
7. **Arm A was not run and could not be automated.** The Chrome DevTools Protocol
   does not expose `ui::AXTreeID`, so the platform-tree count in finding 3 is
   still an inference. No proxy was substituted for it in the spike's results.
8. **Arm C was not run.** No macOS machine was available, so every statement
   about `RenderWidgetHostViewCocoa` and the VoiceOver rotor remains unobserved.

---

## The gate

**The spike that settles this, and it is the only thing that does.**

Build a throwaway `BaseWindow` with two `WebContentsView`s side by side via
`addChildView`, each loading a distinct document with a unique `<h1>`, a unique
`<main>` landmark, and two focusable inputs. Then run four arms:

| Arm | Platform | Tool | Question |
|---|---|---|---|
| **A — connectedness** | Windows 11 | `inspect.exe`, UIA mode, then MSAA/IA2 | Walking down from the top-level window element, do both web-content roots appear as descendants? Are there two `Chrome_RenderWidgetHostHWND` children? |
| **B — enumeration and focus** | Windows 11 | **NVDA**, speech viewer on | With focus in view 1: does `NVDA+F7` → Headings list view 2's `<h1>`? Tabbing from the last control of view 1 — does focus enter view 2, or wrap? |
| **C — macOS** | macOS | Accessibility Inspector, then **VoiceOver** rotor (`Ctrl+Opt+U` → Headings) | The same two questions. |
| **D — future option** | either | relaunch with `--enable-features=AccessibilityTreeForViews` | Does enumeration scope change? |

**Arm B is the one that decides this ADR.** Arms A and C are corroboration; arm D
is research and **not** a shippable strategy, because the feature is
disabled-by-default in Chromium with no Electron support commitment — a positive
result there is a note for a future ADR, not a reason to choose option A.

### Spike status, 2026-08-03

**The spike has been built and the machine-observable half of it has been run.**
It is at `spike/topology/` — a throwaway `BaseWindow` with two
`WebContentsView`s, outside `src/` and outside `electron/`, imported by nothing
and inside no stage of `npm run verify`. `spike/topology/README.md` is the
five-minute script a human runs for arm B; `spike/topology/RESULTS.md` holds the
measurements, with the date and build they were taken on; `results.json` is the
raw output of `node spike/topology/probe.mjs`.

| Arm | Status |
|---|---|
| **A — connectedness** | **NOT RUN.** Needs `inspect.exe`. `ui::AXTreeID` is not exposed by the Chrome DevTools Protocol, so the platform-tree count could not be automated and no proxy was substituted for it. |
| **B — enumeration and focus** | **NOT RUN — needs NVDA.** Unchanged: this is still the arm that decides this ADR. |
| **C — macOS** | **NOT RUN — needs macOS.** Not runnable from the machine the rest of the spike was run on. |
| **D — future option** | **RUN, machine-observable half only.** The switch changed no observable value; the assistive-technology half is blocked behind arm B. |

What was measured, on **Electron 43.2.0 / Chromium 150.0.7871.129, Windows 11**,
on 2026-08-03. Each of these is a value, not an inference; the reasoning and the
limits are in `spike/topology/RESULTS.md`:

1. **Two views, two of everything the protocol can count.** Two `webContents`,
   two operating-system process ids, two `RootWebArea` roots, and neither tree
   containing the other pane's heading. `--enable-features=AccessibilityTreeForViews`
   changed none of it.
2. **`Tab` from the last control of view 1 does not reach view 2 — it wraps to
   the top of view 1.** Getting focus into view 2 required the main process to
   call `webContents.focus()`, and after that call view 1's document still
   reported its own active element and `document.hasFocus(): true`.
3. **`document.hasFocus()` was `true` in BOTH pane documents simultaneously**, in
   every reading of the two-view build. A renderer cannot tell whether it holds
   focus; only the main process can.
4. **A cross-view `aria-labelledby` did not resolve.** Chromium marked the name
   source `invalid` and fell back to the control's own text; `labelledby` and
   `controls` both carried zero related nodes.
5. **The one-document control was run and it confirmed clause 4 above rather than
   refuting it — in the sharper of the two available forms.** The same markup was
   assembled three ways. As two sibling `<div>`s in one document the IDREF
   resolves and `Tab` crosses. As two sibling `<iframe>`s — still **one**
   `WebContentsView`, one renderer process, one page — the IDREF fails with
   readings byte-identical to the two-view build, and that page reports **three**
   `RootWebArea`s. **So the boundary that costs the reference is the document
   edge, and finding 5 above is confirmed by observation rather than inferred
   from a bug report.** `Tab`, however, *does* cross between two iframes in one
   web contents and does *not* cross between two views — so traversal and
   reference resolution do not have the same boundary, and only reference
   resolution is purely a document question.
6. **electron/electron#42339 is still open** (checked 2026-08-03; opened
   2024-06-02, last updated 2026-07-28, labelled `component/accessibility`) **and
   it reproduces here.** Adding a second `WebContentsView` to a window whose
   first view holds keyboard focus moves focus to the new view — not synchronously
   with `addChildView`, but by the time the new view's document has loaded, which
   means a host that re-asserts focus on the next line re-asserts it too early.
   The losing renderer is never told. Five identical launches of the two-view
   build put startup focus on the last-added view four times and on the first view
   once, so **which pane the user is typing into after startup is currently
   undefined.** This lands on option A and option B alike, and Phase 7 must budget
   focus arbitration in the main process whichever is chosen.

**This is evidence, not a decision, and the status line above is unchanged.**
Stating it plainly and once: clauses 2 and 4 are the two halves of the second
bullet in *How the outcome maps to a decision* below, and both came out the way
that bullet calls "the expected result". Nothing above is an observation of an
assistive technology — clause 2 was measured with a synthesised key event
delivered to a chosen web contents, which is not the same thing as a real `Tab`
press reaching a real screen reader. **Arm B is named as the deciding arm and it
has not been run.** Do not accept this ADR on the strength of this section.

### How the outcome maps to a decision

- **Tab crosses and enumeration spans both views:** option A is viable on
  accessibility grounds, and the decision then turns on §2.1's cost alone.
- **Tab does not cross, or enumeration does not span** (the expected result):
  **option B.** One boundary, placed between host chrome and the extension, where
  the relationships are already mediated by serializable state.
- **Option B is also insufficient** — i.e. the host-chrome ↔ extension boundary
  alone breaks the AA commitment: the fallback is a single-`WebContents`
  architecture with iframes (what Electron's own `<webview>` does — *"we attach
  the `webView` to the primary `webContents` as an iframe"*), which removes every
  boundary and gives up crash containment entirely; or a documented AA regression
  with a CHANGELOG entry. **Both are fallbacks, not defaults.**

**The outcome is written into this ADR whichever way it goes, and the status line
changes from `Proposed` to `Accepted` in the same commit.** A spike whose result
is not recorded gets re-litigated by the next person, at the same cost, with no
memory of why.

---

## Consequences

**If accepted as option B**, the following change relative to ADR-0004 clause 5
and to the plan as drafted:

- Phase 7 creates **two** views, not three. `BaseWindow` geometry arbitration is
  correspondingly simpler: one divider between chrome and extension is host-owned,
  and the pane-2/pane-3 divider becomes ordinary in-document layout.
- §2.1's migration of the two verification remotes off module-scope state stays
  done and stays right — it is the right shape for `publishPayload` regardless —
  but stops being load-bearing for correctness.
- `verify:desktop`'s crash test narrows: `process.crash()` in the extension view
  must leave the rail, pane 1 and the command surfaces alive. It can no longer
  assert that pane 2 survives a pane-3 crash, because it will not.
- Per-pane memory accounting is not available. Per-extension accounting is.

**Unaffected either way, and this is why the seam was built first:** everything
in `src/core/ipc/**`. `AuthoritativeStore` does not know how many replicas exist
— `connect(port, origin)` is called once per view and the rate limit is
per-origin, so the storm mitigation works identically for one replica or three.
*Tests:* `src/core/ipc/__tests__/writeStorm.test.ts` — "severs only the origin
that stormed, and leaves the other replica writing".

**Unaffected either way, second:** the blueprint split. `manifest.ts` divides one
blueprint into a serializable `ExtensionManifest` and a pane-local half holding
the components and handlers, and that division is the same whether the pane-local
half lives in one renderer or two. *Tests:*
`src/core/ipc/__tests__/manifest.test.ts` — "really does survive a structured
clone, which the blueprint does not".

---

## Alternatives considered

**One process (no split at all).** Host chrome and the extension in one
`WebContents`, panes as ordinary DOM. This is the only architecture with **zero**
document boundaries, so every accessibility question above disappears, and it is
what Electron's `<webview>` does internally. It is rejected as the *default*
because it gives up crash containment entirely — a wedged extension takes the
whole shell with it, including the only route back to a different extension — and
crash containment is the one thing per-process isolation genuinely buys given the
§2 correction. It is retained as a fallback in the gate above.

**Per-extension processes.** The isolation boundary ADR-0001 Amendment E's
trigger actually asks for, once third-party extensions become real. It is
orthogonal to this decision rather than an alternative to it: only one extension
is in the foreground at a time, so a per-extension split is a statement about
background extensions and about a requirement that is still undecided
(ADR-0004 clause 5's context). Choosing option B does not foreclose it; the
`PortLike` seam is what keeps the boundary swappable, which was the actual
requirement behind "third parties undecided".

**Deciding now, on the research alone.** Rejected. The evidence narrows the
question considerably and points one way, but every claim about what an assistive
technology *does* is inference from source reads of a branch we do not ship, and
the decisive issue report is six years old and about a predecessor API. §9 R1
names a spike; the responsible thing is to run it. **Do not decide this on
speculation** — including on the well-argued speculation in this document.
