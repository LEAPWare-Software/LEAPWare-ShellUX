# ADR-0005 pane topology spike

A throwaway Electron host, built for one purpose: to let a human with a screen
reader answer the one question `docs/adr/0005-pane-topology.md` cannot be
answered from a repository. **Nothing here is part of the shipping application.**
No file under `spike/` is imported by `src/`, by `electron/`, or by any stage of
`npm run verify`. Delete the directory when ADR-0005 moves to `Accepted`.

The measurable arms have already been run and their numbers are in
[`RESULTS.md`](./RESULTS.md). **Arm B — the one that decides the ADR — has not
been run and cannot be run without NVDA.** That is what this file is for.

---

## Run it

From the repository root, with dependencies already installed:

```
npx electron spike/topology
```

A 1280x720 window opens with two panes side by side. Pane A is on the left, pane
B on the right. Both are the same markup; only how they are assembled differs.

Four assemblies, selected with `--mode=`:

| Command | What is on screen |
|---|---|
| `npx electron spike/topology` | Two `WebContentsView`s. **This is the arm B build.** |
| `npx electron spike/topology --mode=iframes` | One `WebContentsView`, two sibling `<iframe>`s |
| `npx electron spike/topology --mode=divs` | One `WebContentsView`, two sibling `<div>`s |
| `npx electron spike/topology --mode=views-deferred` | One view; the second is added later by the probe |

To re-run the automated arms and rewrite `RESULTS.md`'s source data:

```
node spike/topology/probe.mjs
```

That launches the host ten times — once per assembly, once more with arm D's
feature flag, and five more to count where startup focus lands — writes
`results.json`, and takes about a minute and a half. It needs the window to be
visible and in the foreground for the whole run; every focus
measurement throws rather than records if the window is not, because
`document.hasFocus()` is false in every document of a background window and a
focus arm run against one returns the expected negative for the wrong reason.

---

## Arm B — what to press, and what each outcome means

**You need:** Windows 11, NVDA, and five minutes. Turn on the NVDA speech viewer
(NVDA menu, Tools, Speech Viewer) so the result is readable afterwards rather
than remembered.

**Build:** `npx electron spike/topology`, the default `--mode=views`. Leave the
window focused and unobstructed.

### B1 — Heading enumeration

1. Click once inside **pane A** (the left pane) to put focus there.
2. Press `NVDA+F7`. The Elements List opens. Choose **Headings**.
3. Read the list.

- Both `Pane A heading, the list pane` **and** `Pane B heading, the detail pane`
  are listed → **enumeration spans both views.**
- Only `Pane A heading, the list pane` is listed → **enumeration does not span.**

Repeat with focus in pane B, and record that answer too. An asymmetric result is
a real result and must be written down as one.

### B2 — Landmark enumeration

With focus in pane A, press `NVDA+F7` and choose **Landmarks**. The same two
outcomes, against `Pane A navigation` / `Pane B navigation` and the two regions.

### B3 — Tab traversal

1. Click the **Pane A first control** button.
2. Press `Tab` three times. You are now on **Pane A last control** — NVDA will
   say so. It really is the last focusable element in the pane: the `<nav>` is
   rendered *before* the region on purpose, so nothing follows it.
3. Press `Tab` once more.

- NVDA announces something in **pane B** → **Tab crosses.**
- NVDA announces **Pane A navigation, Skip to the Pane A region** — i.e. focus
  wrapped to the top of pane A — → **Tab does not cross.** This is what the
  automated arm measured; B3 is the check that a real key press and a real AT
  agree with it.

### B4 — Browse mode

With focus in pane A, press `NVDA+Down Arrow` repeatedly and keep going past the
last thing in pane A.

- Reading continues into pane B's content → one browse-mode buffer.
- Reading stops, or wraps back to pane A's heading → two buffers, one per
  document.

### B5 — The control that tells document from view apart

Run B1 and B4 again against `--mode=iframes`. Same two documents, but **one**
`WebContentsView`. If the answers are the same as the two-view build, the
boundary is the document and not the view — which is the finding the automated
arms already reached and which arm B is here to confirm against a real AT.

---

## What the answer decides

Quoted from `docs/adr/0005-pane-topology.md`, section **How the outcome maps to a
decision**, so that the result cannot be reinterpreted after it is known:

> - **Tab crosses and enumeration spans both views:** option A is viable on
>   accessibility grounds, and the decision then turns on §2.1's cost alone.
> - **Tab does not cross, or enumeration does not span** (the expected result):
>   **option B.** One boundary, placed between host chrome and the extension,
>   where the relationships are already mediated by serializable state.
> - **Option B is also insufficient** — i.e. the host-chrome ↔ extension boundary
>   alone breaks the AA commitment: the fallback is a single-`WebContents`
>   architecture with iframes (what Electron's own `<webview>` does — *"we attach
>   the `webView` to the primary `webContents` as an iframe"*), which removes
>   every boundary and gives up crash containment entirely; or a documented AA
>   regression with a CHANGELOG entry. **Both are fallbacks, not defaults.**

And the sentence that governs what happens next, from the same section:

> **The outcome is written into this ADR whichever way it goes, and the status
> line changes from `Proposed` to `Accepted` in the same commit.** A spike whose
> result is not recorded gets re-litigated by the next person, at the same cost,
> with no memory of why.

Note the disjunction in the second bullet: **"Tab does not cross, OR enumeration
does not span"**. The automated arms have already established the first half of
that disjunction on Windows with Electron 43.2.0 — see `RESULTS.md`, measurement
4. Arm B is still required, because the ADR names it as the deciding arm and
because an inference from a synthesised key event is not an observation of an
assistive technology.

---

## Arm A — connectedness, and the one thing the automated arms could not see

The Chrome DevTools Protocol does not expose `ui::AXTreeID`. No proxy for it is
substituted in `RESULTS.md`. Counting platform trees needs `inspect.exe`
(Windows SDK):

1. `npx electron spike/topology`
2. Open `inspect.exe`, UIA mode.
3. Walk down from the top-level window element `ADR-0005 pane topology spike`.
4. Record whether **both** web-content roots appear as descendants, and how many
   children with the window class `Chrome_RenderWidgetHostHWND` there are.
5. Switch `inspect.exe` to MSAA/IA2 and repeat.

A second, cheaper reading of the same fact: with the spike window open, list the
child windows of the spike window's HWND and count the ones whose class name is
`Chrome_RenderWidgetHostHWND`. Any window-spy tool will do it. It is described
here in prose rather than shipped as a script because a script that only runs on
one operating system is the thing ADR-0002 forbids a tracked file from being.

## Arm C — macOS

Not runnable from this machine. Accessibility Inspector, then VoiceOver rotor
(`Ctrl+Opt+U`, Headings), against the same `--mode=views` build. The same two
questions as B1 and B3.

---

## What is in here

| File | What it is |
|---|---|
| `main.cjs` | The throwaway host. One `BaseWindow`, the four assemblies, and every probe body. |
| `pane.js` | The pane markup, written once and assembled four ways so a difference in result cannot be a difference in markup. |
| `pane-a.html`, `pane-b.html` | One pane per document. Used directly by the two-view and iframe assemblies. |
| `iframes.html`, `divs.html` | The two one-`WebContents` assemblies. |
| `pane.css` | Enough styling to tell the panes apart. Nothing here is measured. |
| `probe.mjs` | Drives the host over CDP and writes `results.json`. |
| `results.json` | Raw output of the last probe run. Regenerate, do not hand-edit. |
| `RESULTS.md` | The measurements, with dates. Written by a human from `results.json`. |

Each pane carries a unique `<h1>`, a `<nav>` landmark, a labelled region, four
focusable controls, and one control whose `aria-labelledby` and `aria-controls`
point at IDs that live in the **other** pane. That last control is the
instrument: where the IDREF resolves, its accessible name becomes the other
pane's heading; where it does not, the name falls back to the control's own text.
