# Wave 3 plan — the system

**Status: PLAN.** Written 2026-09-19 against `main` at `a2bba77`. Nothing below is built
except increment W3-0, which lands in the same change as this file. Every other row is
planned, and says so. This is plan step 5, item 1 in `docs/plans/v1-production.md`:
"Wave plan from `docs/design/SHAPE-BRIEF.md`: rows (D-29, 32px), nav, rail, tables,
forms, palette, states. Serialised on `ShellLayout.tsx` (rule 6)."

Sources, in the order they win when they disagree:

1. **The approved gate-4 screens, revision 4** (D-45): *Shell at rest* (light and dark),
   *Command palette*, *Palette states*, *Plugin manager*, *States*, *Collapsed rail and
   selection toolbar*, *Notifications*, *After Reverse movement: undo strip*. Revision 4
   is the one with the independent critique resolved on the canvas. The canvas is a
   published artifact; the generator and PNG renders are not tracked in this repository.
2. `DESIGN.md` (gate 3): tokens, component rules, the ten states.
3. `docs/design/SHAPE-BRIEF.md` (gate 2) and its measured "today" column.
4. `PRODUCT.md` for who the shell is for and the D-37 keyboard gate.

## What the v4 screens decided that the brief did not

These are the critique resolutions the screens encode. Each is assigned to exactly one
increment below, so none is dropped between the canvas and the code.

| # | Resolution on the v4 canvas | Increment |
|---|---|---|
| R1 | **Region focus by F6 / Shift+F6** in the order context bar → Workspace → list → Item → composer; the focused region draws a **2px petrol rule on its pane header**, and the list's current row carries the focus ring | visual rule W3-4; the chord is **step 6c** |
| R2 | **Notification popover** off the bell: count in the title, *Clear all*, one row per notice with time and a dismiss control, a key footer (Enter open, Del clear, Esc close with focus back on the bell) | W3-7 (blocked, see there) |
| R3 | **Palette zero-query** shows *Recent* with the first row active and ready for Enter; **no-match** says what was searched and offers the closest command; **command failure** is reported inline under the row and the palette stays open, footer Enter becomes *Try again* | W3-6 (visuals and states); arrow keys are **step 6c** (D-40) |
| R4 | **D-40 fallback identity tile**: a plugin with no manifest icon gets a filled tile with its initial, drawn deliberately rather than as a broken icon | W3-3 |
| R5 | **Switch on-state**: the enabled switch is a petrol track with a white thumb; off is a neutral track; disabled is a subtle track with no thumb contrast | W3-5 |
| R6 | **Pressed state** for primary and quiet buttons, one surface step past hover; **banners** in four statuses (error, warning, success, info) inline in the block, status wash plus icon plus a bold first line | W3-1 |
| R7 | **Block error is a wash without a border** — no side stripe, no outline; the icon and the words carry the status | W3-1 (banner), consumed by W3-5 |
| R8 | **Reorder is not accented in the context bar.** Every context-bar command is a quiet button; the accent is spent only where a surface has its one primary action | W3-6 |
| R9 | **Composer placeholder** names its object: "Ask about this item", with an `Enter to run` hint at the trailing edge | W3-8 |

## Rule 6: who owns which file

`ShellLayout.tsx` is the one file several increments must touch. They are **serialised
in the order below** and nothing else may edit it while one is open. Every other file
has exactly one owning increment, so increments with no `ShellLayout.tsx` edit can run
in parallel.

| Increment | Edits `ShellLayout.tsx`? | Owns (no other increment edits these) |
|---|---|---|
| W3-0 | yes, first | `paneSizing.ts`, `e2e/pane-refit.spec.ts` |
| W3-1 | no | `src/core/theme/tokenClasses.ts`, new `src/components/ui/Banner.tsx`, new `src/components/ui/buttonClasses.ts` |
| W3-2 | no | `src/components/shared/VirtualizedList.tsx`, `src/components/ui/RowMetric.tsx`, the row renderers in `src/mocks/**` |
| W3-3 | yes, second | `src/components/layout/ShellNavigation.tsx`, `src/components/ui/shellIcons.tsx` |
| W3-4 | yes, third | `src/components/layout/PaneWrapper.tsx`, `src/components/layout/ShellResizeHandle.tsx` |
| W3-5 | no | `src/components/ledger/LedgerBlock.tsx`, `src/components/ledger/BlockLedger.tsx`, new `src/components/ui/Switch.tsx` |
| W3-6 | no | `src/components/command/CommandPalette.tsx`, `commandListItem.tsx`, `ContextBar.tsx`, `FloatingToolbar.tsx` |
| W3-7 | yes, fourth | new `src/components/command/NotificationPopover.tsx`, new undo-strip component |
| W3-8 | no | `src/components/error/FaultBoundary.tsx`, `src/components/layout/ExtensionPane.tsx`, `src/components/command/OmniboxComposer.tsx` |

W3-1 lands before W3-5, W3-6 and W3-8, which consume `Banner` and the button classes.
Each e2e case below goes in the spec file named; two increments that name the same spec
file are serialised on it the same way.

## The increments

Tokens are the generated custom properties in `src/styles/tokens.generated.css`,
reached only through `TOKEN_CLASS`; no colour value is typed into `src/`. Every e2e case
is **mutation-probed before merge**: the fix is reverted or the named line is broken, the
case is watched going red, and the output goes in the PR body. A case that stays green
under its probe is not a guard and is rewritten or deleted.

### W3-0 — Re-fit the panes on a width change (#23). **BUILT, this change.**

- Tokens: none. Geometry only (`PANE_PX`).
- e2e, `e2e/pane-refit.spec.ts`, all run and probed 2026-09-19: "keeps every pane inside
  its pixel band when a restored layout is narrowed live", "returns to the dragged widths
  when a narrowed window is widened again, and never rewrites the stored layout", "keeps
  an untouched navigation pane on its 240px intent across a live resize, where a reload
  opens it". The first stays green with the whole change reverted, because the bands
  were already live; it goes red only when the bands are frozen. Stated, not hidden.

### W3-1 — State primitives: pressed, disabled, focus, banners. Planned.

- R6, R7. One focus mechanism (the two-tone ring on `:focus-visible` only), the brief's
  §8 "cut to one". Pressed as one surface step past hover. Disabled uses
  `--text-disabled`, never opacity. `Banner` in four statuses: status wash, icon, a
  bold first line, no border, no side stripe.
- Tokens: `--accent-solid`, `--accent-solid-hover`, `--surface-hover`,
  `--surface-selected`, `--text-disabled`, `--border-subtle`, `--focus-ring`,
  `--focus-ring-offset`, `--focus-ring-width`, `--status-{danger,warning,success,info}`
  and their `-subtle` washes, `--text-danger`, `--text-warning`, `--text-success`,
  `--radius-md`, `--motion-micro`.
- e2e, `e2e/focus-visibility.spec.ts` and `e2e/theme.spec.ts`: a mouse click paints no
  ring and a Tab paints one (probe: switch the ring to `:focus`); a pressed button
  paints a different background from hover (probe: drop the pressed class); a disabled
  button's text is `--text-disabled` and its computed opacity is 1 (probe: restore
  `opacity-40`); an error banner has a zero-width border on all four sides (probe: add
  `border-l-2`); every banner's text clears 4.5:1 on its wash in all three themes.

### W3-2 — List rows at 32px (D-29). Planned.

- Two-line row at `--row-h-comfortable`; hover grey on pointer rest (today the primary
  list has none); selected grey plus focus-weight title, no outline; keyboard focus ring
  inside the row edge.
- Tokens: `--row-h-comfortable`, `--surface-hover`, `--surface-selected`,
  `--text-primary`, `--text-muted`, `--focus-ring`.
- e2e, new `e2e/list-rows.spec.ts`: a row measures 32px tall (probe: the old height
  class); a pointer resting on a row changes its painted background (probe: remove the
  hover class); a selected row has no outline and a heavier title weight; the focus ring
  of the current row is inside the list's clip, not cut by it (probe: ring outside the
  edge — this is the ribbon-overflow class of defect).

### W3-3 — Navigation tree and the 48px rail. Planned. Serialised on `ShellLayout.tsx`.

- R4. Current node: `--text-primary` on `--accent-subtle`; children indent with a 1px
  guide rule. The rail: 32px square targets, a tooltip with the plugin title and its
  shortcut, the badge on the glyph. A plugin with no icon gets the filled initial tile.
- Tokens: `--accent-subtle`, `--accent-text`, `--text-secondary`, `--border-subtle`,
  `--rail-w`, `--surface-overlay`, `--shadow-popover`.
- e2e, `e2e/shell-layout.spec.ts`: every rail target measures 32 by 32 and is fully
  inside the 48px track (probe: 28px targets); the fallback tile paints a filled
  background with a one-letter text node (probe: render the empty icon slot); the
  tooltip is unclipped and owns its centre point (`clipReportOf`; probe: move it inside
  the track's `overflow-hidden`).
- The tooltip's shortcut text comes from `describeHotkey`, which is step 6c's first
  item. Until 6c lands the tooltip shows the title alone, and says nothing false.

### W3-4 — Pane headers and the focused-region rule. Planned. Serialised on `ShellLayout.tsx`.

- R1, visual half only. Pane header 28px on the chrome plane, one overflow control, a
  label-weight title. The pane holding focus draws a 2px petrol rule on its header,
  driven by `:focus-within` — **no key handling**, so this increment adds nothing to
  `KEY_EVENT_ALLOWLIST`. Dividers become 1px rules with the wider hit area kept.
- Tokens: `--pane-header-h`, `--surface-raised`, `--accent-border`, `--control-divider`,
  `--control-divider-hover`.
- e2e, `e2e/shell-layout.spec.ts`: clicking into the list paints the rule on the list
  header and on no other (probe: `:focus` on the pane rather than `:focus-within`);
  the header measures 28px; the divider paints 1px while a drag from 6px off its centre
  still starts (probe: shrink the hit area) — `pane-dividers.spec.ts` already proves a
  drag really happens and is reused.

### W3-5 — Tables, forms and the switch in pane-3 blocks. Planned.

- R5, R7 consumed. Block title is the manifest `title` in label type; a block with no
  title has no heading (D-40). Tables: metadata-type header, tabular figures, signed
  quantities in status ink with the sign as the word. Fields: 24px, error is a danger
  rule plus a message saying what to fix. The switch as `role="switch"`, on-state petrol.
- Tokens: `--surface-pane`, `--border-default`, `--border-subtle`, `--text-muted`,
  `--status-danger`, `--text-danger`, `--accent-solid`, `--surface-sunken`.
- e2e, new `e2e/blocks.spec.ts`: a block with no title renders no heading element
  (DOM, vitest is enough for this one); a table's number column is right-aligned with
  `tnum` in the computed font features (probe: drop `tabular-nums`); the switch thumb
  sits at the trailing end when on and the leading end when off (geometric; probe: swap
  the translate); a block error paints a wash with zero border width (probe as W3-1).

### W3-6 — Palette and command surfaces. Planned.

- R3, R8. Scrim that dims (never bleaches); dialog title distinct from section labels;
  no "Uncategorised" heading; row hover; footer saying what Enter will do; zero-query
  Recent; no-match with the closest command; inline failure with the palette staying
  open. Context bar commands all quiet.
- Tokens: `--surface-overlay`, `--shadow-overlay`, `--accent-subtle` (active row),
  `--text-muted`, `--status-danger-subtle`, `--context-bar-h`.
- e2e, `e2e/command-palette.spec.ts` and `e2e/context-bar.spec.ts`: the scrim darkens
  the painted shell behind it (sample a pixel before and after; probe: the old light
  wash); the palette is 512px wide and unclipped; a no-match query renders the searched
  text and one closest command (probe: return the empty list); a failing command leaves
  the dialog open with the error under the row (probe: close on failure); no context-bar
  button paints `--accent-solid` (probe: make Reorder primary).
- **Not here:** arrow keys and the active row moving under them (D-40, their own change
  and review, one `KEY_EVENT_ALLOWLIST` entry); the shortcut column (step 6c,
  `describeHotkey`). Until then the active row is the first row, which is what Enter runs.

### W3-7 — Notification popover and undo strip. Planned, **blocked on a decision.**

- R2 and the undo strip. **No host notification channel and no undo channel exist**:
  `IShellAPI` has no member that raises a notice or offers an undo. Drawing the popover
  over nothing would be decoration. The decision (a contract member, or a host-only
  source such as plugin crashes from 6b) must be recorded in `docs/DECISIONS.md` first.
  If it is a contract member it belongs to step 6b, not to this wave.
- Tokens, when unblocked: `--surface-overlay`, `--shadow-popover`, `--status-*`.
- e2e, when unblocked: the popover is unclipped by the context bar (`clipReportOf`,
  exactly the ribbon-overflow defect); Esc returns focus to the bell (focus assertion,
  real browser).

### W3-8 — States: empty, loading, crashed, composer. Planned.

- R9. Empty states teach: what would appear and the one action that makes it appear.
  Loading is skeleton rows or an in-place bar, never a centred spinner, and is a
  different state from "published nothing". A crashed plugin fills its own panes with a
  danger mark, plain words, *Restart plugin* and *View log*. Composer placeholder names
  its object and carries `Enter to run`.
- Tokens: `--surface-subtle` (skeleton), `--accent-solid` (in-place bar),
  `--status-danger`, `--text-muted`.
- e2e, `e2e/shell-layout.spec.ts`: the crash surface fills the pane it replaced (height
  within 1px of the pane body; probe: content-sized box); the other panes stay
  interactive after the crash (click lands; probe: remove the pane boundary); no
  element in a loading pane is centred both ways (probe: the old centred spinner). The
  placeholder text is a DOM fact and stays in vitest.

## Not wave 3

**Step 6 — instrument layer.** Direction B's per-row series in the 20px band with
threshold bands in status washes (the *30 days* column on the v4 list), the list
minimap, the overview state. W3-2 leaves the band's space in the row and draws nothing
in it.

**Step 6c — keyboard.** F6 / Shift+F6 region cycling (R1's chord: a `HOST_CHORDS` entry
in `src/core/hotkeyDispatch.ts`); palette arrow keys (D-40); `describeHotkey` in the
palette shortcut column and the rail tooltips; the selection toolbar's `Shift R` hints;
a focus-order spec for every surface. Each is pinned by a browser case, because focus
order is exactly what jsdom cannot observe.

**Step 6b — plugin manager.** The v4 *Plugin manager* screen is 6b's surface. It
consumes W3-1's banners and W3-5's switch; it is not built in this wave.

## What this plan does not do

- It does not size any increment in time, and does not claim any order beyond the
  `ShellLayout.tsx` serialisation and W3-1 first among its consumers.
- It has not been reviewed by an agent that did not write it (rule 1, D3).
- The e2e cases for W3-1 to W3-8 are designs, not code; none has been run or probed.
- It treats the v4 screens as read from their PNG renders on 2026-09-19. If the canvas
  is edited after approval, this table is stale until re-read.
