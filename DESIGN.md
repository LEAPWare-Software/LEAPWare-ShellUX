---
name: LEAPWare ShellUX
description: A desktop instrument that hosts operator plugins in three panes, commanded by keyboard.
colors:
  accent-petrol: "#006e65"
  accent-petrol-deep: "#004f48"
  accent-petrol-wash: "#e7f4f1"
  surface-content: "#ffffff"
  surface-frame: "#f6f6f7"
  surface-chrome: "#f0f0f1"
  surface-hover: "#eaebec"
  surface-selected: "#e5e5e7"
  ink-primary: "#1e1f21"
  ink-secondary: "#414448"
  ink-muted: "#5c5f64"
  ink-disabled: "#a6a8ab"
  rule-subtle: "#c9cacd"
  rule-default: "#7e8085"
  status-danger: "#a52f2a"
  status-warning: "#805500"
  status-success: "#007238"
  status-info: "#00688d"
typography:
  focus:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  metadata:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "'tnum' 1"
  mono:
    fontFamily: "'Cascadia Mono', ui-monospace, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  sm: "2px"
  md: "4px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
components:
  button-primary:
    backgroundColor: "{colors.accent-petrol}"
    textColor: "{colors.surface-content}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "24px"
  button-primary-hover:
    backgroundColor: "{colors.accent-petrol-deep}"
  button-quiet:
    backgroundColor: "{colors.surface-content}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "24px"
  button-quiet-hover:
    backgroundColor: "{colors.surface-hover}"
  list-row:
    backgroundColor: "{colors.surface-content}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    padding: "4px 8px"
    height: "32px"
  list-row-hover:
    backgroundColor: "{colors.surface-hover}"
  list-row-selected:
    backgroundColor: "{colors.surface-selected}"
    typography: "{typography.focus}"
  context-bar:
    backgroundColor: "{colors.surface-chrome}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    height: "32px"
  input-field:
    backgroundColor: "{colors.surface-content}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
    height: "24px"
  palette-row-active:
    backgroundColor: "{colors.accent-petrol-wash}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    padding: "4px 12px"
    height: "32px"
---

# Design System: LEAPWare ShellUX

Gate 3 of the redesign (`docs/design/SHAPE-BRIEF.md`). Written 2026-09-18 from the
generated tokens, the gate-1 audit (`docs/design/REDESIGN-SPEC.md`) and the gate-2
brief, with the owner's confirmations of that date: the editorial-voice rule with
plugin titles and icons, the 11 to 13px type band, and a full keyboard-driven palette.

**The colour values above are a mirror, not a source.** Every colour in this shell is
generated: `design/tokens/**` into `design/generate.mjs` into
`src/styles/tokens.generated.css`. The frontmatter repeats the **LEAPWare Light**
values as generated on 2026-09-18 so this file can be read on its own; where the two
ever disagree, the generated stylesheet wins and this file is stale. No value in this
file may be typed into `src/`. Dark and High Contrast carry the same roles at their
own values.

## 1. Overview

**Creative North Star: "The Operator's Instrument"**

ShellUX is read, not visited. An operator keeps one window open for a shift and
reads it the way a pilot reads a panel: at a glance, repeatedly, often while doing
something else. The shell hosts plugins in three panes (navigation, list, detail),
and it owns every pixel of chrome around them. Its job is to make four kinds of work
(monitoring, working a queue, investigating, configuring) feel native in one window
without any of them owning the layout. The test for every decision: **would an
instrument do this?** An instrument states. It does not decorate, sell, or raise its
volume above the reading.

Density is the point, and it is bought with hierarchy, never with shrinking. Three
type sizes, three weights, three ink tiers and a real spatial rhythm do the work a
SaaS dashboard does with big numbers and cards. Chrome recedes into its own plane;
content is the brightest plane; the frame between panes is the quietest. Colour
appears only when something is focused, selected, primary or past a threshold. The
keyboard is a first-class way to drive everything, and the command palette is a
primary surface, not a shortcut menu.

This system rejects, by name, the four anti-references in `PRODUCT.md`: **Enterprise
Windows** (ribbon, chrome-heavy toolbars, grey gradient panels), **SaaS dashboard**
(card grids, hero-metric tiles, warm off-white body, rounded pastel everything),
**Developer tool** (monospace everywhere, dark because tools are dark, an IDE's
tab-and-sidebar-icon grammar), and **Consumer polish** (large radii, illustration,
motion flourishes, chatty microcopy). The fifth anti-reference is the build before
this redesign, which reads as a debug inspector.

**Key Characteristics:**
- One sans family (Segoe UI Variable Text), three sizes (11, 12, 13px), three weights (400, 500, 600).
- Three surface planes a screenshot can tell apart: content, chrome, frame.
- Restrained colour: petrol accent for focus, selection and the primary action only.
- Ten interaction states drawn identically on every surface.
- Flat. Depth comes from planes and rules; shadows exist only on things that float.
- The host speaks for plugins: no machine identifier is ever shown as a heading.

## 2. Colors: The Petrol Instrument Palette

Near-neutral greys tinted a hair toward blue (hue 264, chroma under 0.01), one petrol
accent (hue 185), and a four-word status vocabulary.

### Primary
- **Instrument Petrol** (accent-petrol, `--accent-solid`): the focus ring, the current selection's marker, and the one primary action per surface. Nothing else. Also the link colour (`--text-link`).
- **Deep Petrol** (accent-petrol-deep, `--accent-solid-hover`, `--accent-text`): the pressed and hover state of a primary action, and accent text on a wash.
- **Petrol Wash** (accent-petrol-wash, `--accent-subtle`): the active row in the command palette and the selected nav node's background. A wash, never a fill that competes with content.

### Neutral
- **Content White** (surface-content, `--surface-pane`): every pane body. The brightest plane, because content is what the operator reads.
- **Frame Grey** (surface-frame, `--surface-app`): the gutter between panes and behind the window. The quietest plane.
- **Chrome Grey** (surface-chrome, `--surface-raised`): the context bar, pane headers, the rail. A recessed plane distinct from both content and frame.
- **Hover Grey** (surface-hover, `--surface-hover`) and **Selected Grey** (surface-selected, `--surface-selected`): row and control states. Selected is darker than hover so the two can coexist on adjacent rows.
- **Ink Primary / Secondary / Muted** (`--text-primary`, `--text-secondary`, `--text-muted`): the three ink tiers. Primary for what the pane is about and row titles; secondary for labels and chrome text; muted for metadata and timestamps. Muted still clears 4.5:1 on content white; it is never "light grey for elegance".
- **Ink Disabled** (`--text-disabled`): disabled controls and nothing else. Disabled is drawn with this ink, not with opacity.
- **Rule Subtle / Default** (`--border-subtle`, `--border-default`): hairline dividers between blocks and the outline of an input. Rules separate; they do not box.

### Status
- **Danger, Warning, Success, Info** (`--status-*`, with `--status-*-subtle` washes and `--text-*` inks): a threshold was crossed. Always paired with a word or a mark. Never colour alone.
- **Banners** (W3-1, `src/components/ui/Banner.tsx`): the status wash, a mark in `--status-*`, and a first line at focus weight in `--text-*`. No border and no side stripe. **The info banner's first line is `--text-primary`, not info ink**: there is no `--text-info` token, and `--status-info` on its own wash is declared at 3:1, a mark's threshold and not a word's, so the dot carries the status. The v4 canvas sets it in `--status-info`; matching the canvas is a `--text-info` token in `design/tokens/**` first. *Tests:* `e2e/theme.spec.ts` — "clears 4.5:1 for every banner's words on its own wash, in every theme".

### Charts
Twelve series (`--chart-1` to `--chart-12`), searched and pairwise-validated per theme, plus grid, axis, label, tooltip, crosshair, sequential and diverging ramps. Chart colour is data colour; it never leaks into chrome.

### Named Rules
**The State-Only Rule.** Colour means state. Accent marks focus, current selection or the primary action; status marks a crossed threshold. If a colour is on screen and none of those four things is true, remove it.

**The One Primary Rule.** At most one petrol-filled control per surface. A second primary action is a quiet button.

**The Generated-Only Rule.** No colour is typed by hand anywhere in `src/`. A new need is a new token in `design/tokens/**`, a row in `design/contrast-manifest.json`, and a regenerated stylesheet, in that order.

## 3. Typography

**UI Font:** Segoe UI Variable Text (with Segoe UI, then `system-ui`)
**Mono Font:** Cascadia Mono (with `ui-monospace`, Consolas)

**Character:** The Windows system face, tuned for small sizes and native to the operator's machine: no webfont, no network dependency, no flash of unstyled text. One family carries headings, labels, body and data; hierarchy comes from weight and ink, not from a second typeface.

### Hierarchy
- **Focus** (600, 13px, 1.35): the object the pane is about. The pane-3 record title, the selected row's title. At most one per pane.
- **Label** (500, 12px, 1.3): pane headers, block titles supplied by a plugin's manifest, button text, nav nodes, palette group names. Ink secondary in chrome, ink primary in content.
- **Body** (400, 12px, 1.4): row titles, form values, prose inside detail blocks. Prose is capped at 72ch.
- **Metadata** (400, 11px, 1.35, tabular figures): timestamps, counts, secondary row lines, chart axes, table cells. Every number in the shell uses tabular figures so a changing value never shifts its column.
- **Mono** (400, 11px): values the operator copies verbatim (an ID inside the inspector, a path, a hash) and nothing else.

### Named Rules
**The Three-Size Rule.** Type is 11, 12 or 13px. There is no fourth size. The density gate (`TYPE_BAND_PX`) enforces the band; the owner confirmed it on 2026-09-18. Hierarchy that seems to need a bigger size needs a heavier weight, a darker ink, or more space.

**The Weight Ladder Rule.** 400 reads, 500 labels, 600 names the thing in focus. Bold (700) is not used.

**The No-Mono-Chrome Rule.** Monospace is for values the operator copies. It is never used for labels, headings, navigation or buttons; that is the developer-tool anti-reference.

## 4. Elevation

Flat by default. Depth is carried by the three surface planes and by 1px rules, not by shadows. Two shadows exist, and both belong to things that float above the panes.

### Shadow Vocabulary
- **Overlay** (`--shadow-overlay`: `0 1px 2px 0 rgb(0 0 0 / 0.12), 0 4px 10px -2px rgb(0 0 0 / 0.16)`): the floating selection toolbar and tooltips.
- **Popover** (`--shadow-popover`: `0 2px 4px 0 rgb(0 0 0 / 0.1), 0 8px 20px -4px rgb(0 0 0 / 0.18)`): the command palette, menus and the plugin manager's confirm popover.

### Motion
Two durations, one curve: **micro** (`--motion-micro`, 120ms) for hover, press and focus feedback; **base** (`--motion-base`, 180ms) for a popover or palette entering; easing `--motion-ease` (`cubic-bezier(0.4, 0, 0.2, 1)`). Pane resizing, list scrolling and selection changes are instant; the absence of tokens for them is the enforcement. Under `prefers-reduced-motion: reduce`, every transition becomes instant.

### Named Rules
**The Float-Only Shadow Rule.** A shadow means "this is above the panes and will go away". A pane, a row, a block or a card never casts one.

**The Instant-Work Rule.** Nothing the operator does repeatedly (select, scroll, resize, type) waits on an animation.

## 5. Components

### Shell frame
- **Three panes** on the frame plane: pane 1 navigation (240px, collapses to the 48px rail), pane 2 list (360px), pane 3 detail (flex). Dividers are 1px rules on the frame with a wider invisible hit area.
- **Context bar** (32px, chrome plane): host commands on the left, the focused plugin's contextual commands on the right. Label type, ink secondary. It is chrome and never takes the accent.
- **Pane header** (28px, chrome plane): a label-weight title in the operator's words and a single overflow control. No type chips.

### Buttons
- **Shape:** gently squared (4px radius), 24px tall, 12px horizontal padding, label type.
- **Primary:** petrol fill, white label. One per surface.
- **Quiet:** content-white background, ink-primary label, 1px default rule. The default button.
- **States:** hover shifts one surface step (primary to deep petrol, quiet to hover grey) at 120ms; pressed shifts one more step (quiet to selected grey); focus draws the two-tone ring (2px petrol, 1px offset in the surface colour) on `:focus-visible` only; disabled uses disabled ink and a subtle rule on the hover-grey fill, not opacity; loading replaces the label in place with its in-progress verb and a 2px bar along the bottom edge (determinate or indeterminate), keeps the button's width, and is never a centred spinner.
- **Primary pressed is the hover fill plus a 1px inset `--accent-border` rule**, not a darker fill. The accent ramp has no step past `--accent-solid-hover`, so the v4 *States* screen draws pressed this way and the build follows it. A darker pressed fill is a new token in `design/tokens/**` first. Built in W3-1: `src/components/ui/buttonClasses.ts`, `Button.tsx`; *Tests:* `e2e/theme.spec.ts` — "paints pressed one step past hover, on a quiet and on a primary button".

### List rows (pane 2)
- **Height:** 32px (`--row-h-comfortable`, register row D-29) for the two-line row: body-weight title over a metadata line.
- **States:** hover grey on pointer rest (today the primary list has no hover at all); selected grey plus focus-weight title; keyboard focus draws the ring inside the row edge. Selection is not an outlined rounded rectangle; that shape reads as a form field.
- **Instrument layer (Direction B):** a row may carry a per-row series in a 20px band on the right, with threshold bands drawn in status washes. The series is data colour; the row stays neutral.

### Navigation (pane 1) and rail
- **Tree:** label type, ink secondary at rest, ink primary plus petrol wash when current. Children indent with a 1px guide rule.
- **Plugin identity:** each plugin shows its manifest `icon` (a host-owned glyph map key) at 16px in the rail and the tree. A plugin with no icon gets a filled identity tile with its initial, drawn deliberately rather than as a failed icon.
- **Collapsed rail:** 48px, 32px square hit targets, a tooltip carrying the plugin's title and its shortcut.

### Detail blocks (pane 3)
- **Block title:** the plugin manifest's human `title`, label type. **When a block has no title, the block has no heading** and is delimited by space and a subtle rule. A block id or payload type is never shown; the id lives inside the inspector, behind the block's overflow control.
- **Rhythm:** 12px between blocks, 8px within a block, 2px between a label and its field.
- **Charts:** the chart title is a DOM heading in label type, never text drawn into the canvas. Axes and ticks in metadata type, chart ink tokens.
- **Composer:** docked to the bottom edge of pane 3, full slot width, chrome plane above a subtle rule.

### Inputs / Fields
- **Style:** content-white fill, 1px default rule, 4px radius, 24px tall, body type.
- **Focus:** the two-tone petrol ring; the rule does not change colour on its own.
- **Error:** danger rule plus a metadata-size message in danger ink beneath, with the word stating what to fix. **Disabled:** disabled ink on the hover-grey fill.

### Command palette (signature component)
The Raycast lever, and the primary way a keyboard operator works.
- **Surface:** popover shadow, content-white, 4px radius, 512px wide, opening over a scrim that **dims** the shell (never a light wash that bleaches it). **There is no scrim token yet**, so the dimming scrim has no `TOKEN_CLASS` role; W3-6 needs one added in `design/tokens/**` first (target, not built).
- **Rows:** 32px, body type, icon at left, **shortcut column at right** in metadata type (from `describeHotkey`), group names in label type. There is no "Uncategorised" heading; ungrouped commands sit under the plugin's title.
- **Keyboard:** up and down move a petrol-wash **active row**; Enter runs it; Escape closes and returns focus to where it came from. A footer states what Enter will do and shows the two or three keys that matter.
- **Empty and error:** a query with no match says what was searched and offers the closest command; a command that fails reports inline in the palette, not in a modal.

### Plugin manager
A host view (pane 1 entry plus a palette command) that lists installed plugins: identity glyph, title, version, contract version, and an enabled switch. States: enabled, disabled, **incompatible** (contract major mismatch, warning status with the reason in words), and **crashed** (danger status, the error in plain language, and a Restart action). Install and remove are quiet buttons; removal confirms inline, not in a modal.

### States (all surfaces)
Ten states, drawn the same way everywhere: default, hover, focus, pressed, disabled, selected, loading (skeleton rows or an in-place bar, never a centred spinner), error, warning / success / info, and empty. **Empty states teach**: they say what would appear here and the one action that makes it appear.

## 6. Do's and Don'ts

### Do:
- **Do** apply the North Star test to every choice: would an instrument do this?
- **Do** keep type at 11, 12 or 13px, and build hierarchy with weight (400, 500, 600), ink tier and space.
- **Do** use tabular figures on every number.
- **Do** keep three planes distinct: content white (`--surface-pane`), chrome grey (`--surface-raised`), frame grey (`--surface-app`).
- **Do** draw focus as the two-tone ring on `:focus-visible` only, and never remove it.
- **Do** pair every status colour with a word or a mark.
- **Do** show the plugin's manifest title and icon, and show nothing where the manifest gives nothing human.
- **Do** give every interactive component all ten states before it ships.
- **Do** measure every visual claim on painted pixels in the browser lane (`e2e/`); jsdom cannot see any of it.

### Don't:
- **Don't** show a publisher's identifier (`stock-table`, *Submit stock-filter*) as a heading, and don't show a payload type chip (`chart`, `table`, `form`).
- **Don't** build **Enterprise Windows**: no ribbon, no chrome-heavy toolbars, no grey gradient panels, no 2010 desktop grammar.
- **Don't** build a **SaaS dashboard**: no card grids, no hero-metric tiles, no warm off-white body, no rounded pastel everything.
- **Don't** build a **developer tool**: no monospace everywhere, no dark theme because tools are dark, no IDE tab-and-sidebar-icon grammar.
- **Don't** add **consumer polish**: no radius above 4px, no illustration, no motion flourishes, no chatty microcopy.
- **Don't** use colour as decoration: not on headings, borders, the context bar, or to "look designed".
- **Don't** type a colour value into `src/`; regenerate from `design/tokens/**`.
- **Don't** use opacity for disabled; use `--text-disabled`.
- **Don't** fake a darker primary pressed state with opacity or a filter; until a token exists, pressed primary is the hover fill plus the inset `--accent-border` rule.
- **Don't** put a shadow on a pane, row, block or card.
- **Don't** use a side-stripe border (a coloured `border-left` over 1px) as an accent on rows, blocks or alerts.
- **Don't** open a modal where inline will do; the palette, the inspector and the plugin manager all confirm in place.
- **Don't** animate selection, scrolling or pane resizing.
