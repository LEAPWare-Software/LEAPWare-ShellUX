# ADR-0005 topology spike — measurements

**These are measurements, not conclusions.** Each row below is a value a machine
observed on a stated date, on a stated build. What they imply for ADR-0005 is
argued in the ADR itself, not here. Where something was not observable, the row
says so rather than substituting a proxy.

Regenerate the source data with `node spike/topology/probe.mjs`, which rewrites
`results.json`. This file is written by hand from that file.

## Run identity

| | |
|---|---|
| Measured at | **2026-08-03T12:34:08Z** |
| Electron | **43.2.0** |
| Chromium | **150.0.7871.129** |
| Node | 24.18.0 |
| Platform | `win32`, OS release 10.0.26200 (Windows 11) |
| `app.isAccessibilitySupportEnabled()` | `false`, in every run |
| Probe transport | `webContents.debugger`, CDP 1.3, attached per web contents. No attach failed in any run. |
| Launcher | `_electron.launch()` from `playwright` 1.62 |

This retires ADR-0005's "what could not be verified" item 2. The numbers below
come from Electron 43.2.0 / Chromium 150 — a release branch this project ships,
not from Chromium `main`.

Four assemblies of the **same** pane markup were measured, plus one relaunch of
the first with arm D's feature flag:

| Label | Assembly |
|---|---|
| `views` | Two `WebContentsView`s in one `BaseWindow`. ADR-0005 option A. |
| `views-armD` | The same, relaunched with `--enable-features=AccessibilityTreeForViews`. |
| `iframes` | One `WebContentsView`, two sibling `<iframe>`s. Two documents, one web contents. |
| `divs` | One `WebContentsView`, two sibling `<div>`s. One document. ADR-0005 option B's pane pair. |
| `views-deferred` | One view; the second added later, which is electron/electron#42339's shape. |

---

## Measurement 1 — do the two views report separate accessibility roots?

| | `views` | `views-armD` | `iframes` | `divs` |
|---|---|---|---|---|
| Web contents | **2** (ids 1, 2) | **2** | 1 | 1 |
| Distinct OS process ids | **2** | **2** | 1 | 1 |
| Frames reported by `Page.getFrameTree` | 1 + 1 | 1 + 1 | **3** | 1 |
| `RootWebArea` nodes, summed over per-frame `Accessibility.getFullAXTree` | **2** | **2** | **3** | **1** |
| `RootWebArea` names | `Topology spike, Pane A` / `Topology spike, Pane B` | same | top document + both panes | `Topology spike, one document, sibling divs` |
| Headings in web contents 1's tree | `Pane A heading, the list pane` only | same | — | both headings |
| Headings in web contents 2's tree | `Pane B heading, the detail pane` only | same | — | — |
| `Accessibility.getFullAXTree` with **no** `frameId` | 29 nodes, 1 heading, per web contents | same | **5 nodes, 0 headings** | 54 nodes, **2 headings** |
| `electronApp.windows()` count | **2** | **2** | 1 | 1 |

Two further readings of the `iframes` row, because it is the one that separates
"document boundary" from "`WebContentsView` boundary":

- One web contents, one renderer process, and still **three** `RootWebArea`s.
- Asked for "the whole tree" with no frame named, that one web contents returned
  **5 nodes and zero headings** — the top document only. The pane headings were
  reachable only by asking for each `frameId` in turn.

### The tree id, and what was not observable

**`ui::AXTreeID` is not exposed by the Chrome DevTools Protocol, and no proxy for
it is recorded here.** The CDP frame ids were distinct in every run and are in
`results.json`, but a frame id is not a tree id and substituting one for the
other would be exactly the kind of inference this spike exists to replace.

**Counting `Chrome_RenderWidgetHostHWND` windows is arm A and it is a human
step.** See `README.md`, arm A. Status: **NOT RUN — needs `inspect.exe`.**

---

## Measurement 2 — does an `aria-labelledby` / `aria-controls` IDREF cross?

The instrument is one control per pane, whose `aria-labelledby` and
`aria-controls` name IDs in the **other** pane, and which carries text of its
own. A resolved IDREF makes the accessible name the other pane's heading. An
unresolved one falls back to the control's own text.

Readings for `#pane-a-cross`, whose `aria-labelledby` is `pane-b-heading` and
whose `aria-controls` is `pane-b-region`:

| | `views` | `views-armD` | `iframes` | `divs` |
|---|---|---|---|---|
| `getElementById('pane-b-heading')` from pane A's document | `null` | `null` | `null` | **found** |
| Computed accessible name | `Pane A cross reference control` | same | same | **`Pane B heading, the detail pane`** |
| Name came from | `contents` fallback | `contents` fallback | `contents` fallback | **`aria-labelledby` relatedElement** |
| The `aria-labelledby` name source is marked | **`invalid: true`** | **`invalid: true`** | **`invalid: true`** | `invalid: false` |
| The `contents` name source is marked | not superseded | not superseded | not superseded | **`superseded: true`** |
| `labelledby` related nodes on the AX node | **0** | **0** | **0** | **1** |
| `controls` related nodes on the AX node | **0** | **0** | **0** | **1** |

`#pane-b-cross`, pointing the other way, gave the mirror-image values in every
run.

**The one-document control was run and it did not refute the framing.** The
IDREF resolves in `divs` and fails in `iframes`. `iframes` is one
`WebContentsView`, one renderer process and one page — so the thing that breaks
the reference is the **document** edge, not the view edge. `views` and `iframes`
produced byte-identical readings on this measurement.

---

## Measurement 3 — does `Tab` from the last control of pane A reach pane B?

Focus was placed on `#pane-a-last`, which is the last focusable element in pane A
(the `<nav>` is rendered before the region on purpose). A `Tab` key-down and
key-up pair was then delivered to the web contents holding that element.

| | `views` | `views-armD` | `iframes` | `divs` |
|---|---|---|---|---|
| Active element before | `pane-a-last` | `pane-a-last` | `pane-a-last` | `pane-a-last` |
| Active element after `Tab` | **`pane-a-nav-link`, still in pane A's document** | same | **`pane-b-nav-link`, in pane B's document** | **`pane-b-nav-link`** |
| Did focus reach pane B? | **No — it wrapped** | **No** | **Yes** | **Yes** |
| Pane B's document after `Tab` | unchanged, `body` | unchanged | `pane-b-nav-link` | — |
| Top document's active element after `Tab` | — | — | moved `frame-a` → `frame-b` | — |

**Host mediation.** In the two-view build, calling `view2.webContents.focus()`
from the main process is what moves keyboard focus into pane B. After that call,
pane A's document still reported `activeElement: pane-a-nav-link` and
`document.hasFocus(): true`. Two documents, each believing it holds focus, with
no signal in either renderer distinguishing them.

**The limit of this measurement, stated rather than glossed.**
`webContents.sendInputEvent` delivers a key to a **chosen** web contents. It
therefore measures where Chromium's sequential focus navigation goes from that
document — which is the question — but it is not the same thing as observing what
the operating system does with a real `Tab` press. Arm B3 in `README.md` is the
check with a real key and a real assistive technology, and it has not been run.

---

## Measurement 4 — does pane A's `document.activeElement` survive a click into pane B?

`#pane-a-text` was focused and typed into, then a left click was dispatched at
`#pane-b-first`'s own coordinates in whichever web contents owns it.

| | `views` | `views-armD` | `iframes` | `divs` |
|---|---|---|---|---|
| Pane A's `activeElement` after the click | **`pane-a-text` — survived** | **survived** | `body` — lost | `pane-b-first` — moved |
| Pane A's `document.hasFocus()` after the click | **`true`** | **`true`** | `false` | — |
| Pane B's `activeElement` after the click | `pane-b-first` | `pane-b-first` | `pane-b-first` | `pane-b-first` |
| Documents reporting `document.hasFocus()` after the click | **2** | **2** | 2 (top frame and pane B — an ancestor chain) | **1** |
| Documents with a non-`body` active element | **2** | **2** | 2 (the `<iframe>` element and its content) | **1** |
| Pane A's text field value | unchanged | unchanged | unchanged | unchanged |

## Measurement 5 — `document.hasFocus()` in the two-view build

Recorded at every point in every `views` run, including at startup and while only
one view held keyboard focus:

> **Both** pane documents reported `document.hasFocus() === true`,
> **simultaneously**, in all readings — `documentsReportingHasFocus: 2` in every
> `views` and `views-armD` snapshot, and in all five startup-focus launches.

In the `divs` assembly the same count was **1**. In `iframes` it was 1 before the
`Tab`, and 2 afterwards in the shape an ancestor frame and its focused child
legitimately produce.

---

## Measurement 6 — electron/electron#42339

**Issue state, checked 2026-08-03 via `gh api repos/electron/electron/issues/42339`:**

| | |
|---|---|
| State | **`open`** |
| Title | `[Feature Request]: addChildView option to stop the added view grabbing focus` |
| Opened | 2024-06-02 |
| Last updated | 2026-07-28 |
| Labels | `enhancement :sparkles:`, `component/accessibility` |
| Comments | 4 |

The WCAG report ADR-0005 finding 7 refers to is comment 4, by `hmhealey`,
2025-01-31:

> "Not having an option for this is causing accessibility issues for our app by
> messing with keyboard navigation. We have an element that appears whenever
> another element receives focus, and that element steals focus causing issues
> with WCAG compliance and violating 2.1.2 No Keyboard Trap and 2.4.3 Focus
> Order. We've attempted a workaround by sending focus back to the previous view
> when the new view gets focus, but it would be nice if there was a proper way to
> prevent that behaviour."

A maintainer suggestion of `setTopBrowserView` appears earlier in the thread and
the reporter rejects it in comment 2, 2024-07-10: *"setTopBrowserView is
specifically for BrowserViews not WebContentsViews"*. No fix is linked.

### Reproduced, on Electron 43.2.0 — `views-deferred`

| Point in the sequence | Pane A `webContents.isFocused()` | New view `webContents.isFocused()` |
|---|---|---|
| Before, with `#pane-a-text` focused and typed into | **`true`** | — |
| Immediately after `contentView.addChildView(second)`, before any load | **`true`** | `false` |
| After `loadFile()` resolved, plus 400 ms | **`false`** | **`true`** |

`paneALostWebContentsFocus: true`. Two details that matter for Phase 7:

- **The steal is not synchronous with `addChildView`.** It had not happened at
  the first reading and had happened by the second, so a host that re-asserts
  focus on the line after `addChildView` re-asserts it too early.
- **Pane A's renderer never found out.** After the steal its document still
  reported `activeElement: pane-a-text` and `document.hasFocus(): true`. Nothing
  inside the losing renderer can detect this; only the main process can.

### The same hazard at startup, and it is non-deterministic

Five consecutive launches of `--mode=views`, adding two views and calling
`window.focus()`, recording which web contents held focus once both had loaded:

| Launch | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Focused web contents id | 2 | 2 | **1** | 2 | 2 |

Four of five went to the **last** view added; one went to the first. The window
was OS-focused in all five. There is no defined answer, from the same binary and
the same host code, to "which pane is the user typing into after startup".

---

## Measurement 7 — arm D, `--enable-features=AccessibilityTreeForViews`

`views-armD` is `views` relaunched with that switch and nothing else changed.

**Every measurement was identical.** Two web contents, two OS processes, two
`RootWebArea`s, no cross-view headings, IDREF still `invalid: true` with a
`contents` fallback, `Tab` still wrapping inside pane A, both documents still
reporting `document.hasFocus(): true`. The switch changed no machine-observable
value in this build.

**What that does and does not settle.** It shows the flag does not change the
*renderer-side* picture on Chromium 150. It does not show what an assistive
technology sees, which is the part of arm D that needs an AT, and the flag is
`FEATURE_DISABLED_BY_DEFAULT` upstream with no Electron support commitment — so a
different result here would have been a note for a future ADR rather than a
reason to choose a topology.

---

## Arms not run

| Arm | Status | What it needs |
|---|---|---|
| **A — connectedness** | **NOT RUN** | `inspect.exe`, Windows SDK. The UIA/MSAA walk and the `Chrome_RenderWidgetHostHWND` count. `ui::AXTreeID` is not reachable over CDP. |
| **B — enumeration and focus** | **NOT RUN — needs NVDA** | Windows 11 and NVDA. **This is the arm that decides ADR-0005.** Instructions in `README.md`. |
| **C — macOS** | **NOT RUN — needs macOS** | Accessibility Inspector and VoiceOver on a Mac. Not runnable from this machine at all. |
| **D — feature flag** | **RUN, machine-observable half only** | Measurement 7. The AT half of arm D is blocked behind arm B. |

## Other limits of what is above

1. **No screen reader was involved in any measurement on this page.** Every
   number came from the Chrome DevTools Protocol or from Electron's own main
   process. Nothing here is an observation of what a screen-reader user
   experiences.
2. **Key and pointer events were synthesised into a chosen web contents.** They
   are not operating-system input and cannot prove OS-level input routing.
3. **One machine, one platform, one run of each assembly** — except measurement
   6's startup count, which is five. A value that varies run to run would look
   like a fact everywhere else on this page; measurement 6 is the one place that
   was checked, and it did vary.
4. **`divs` puts two `<h1>`s and two `region` landmarks in one document.** That is
   what the assembly means and it is what ADR-0005 option B's extension view
   would contain. It is noted because it is a difference from the per-document
   assemblies that is structural rather than incidental.
