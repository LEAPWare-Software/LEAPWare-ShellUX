# REDESIGN-SPEC — LEAPWare ShellUX design system

Status: **proposal**. Nothing in this file has been implemented. Every measurement
below is either read out of a source file named in the sentence, or read off a
screenshot in `test-results/ui-screenshots/`. Where a claim is an inference from
reading code rather than something observed running, it says so in the sentence.
Nothing here has been through a browser.

Method: the impeccable **product** register — design SERVES the product. The bar
this is audited against is that register's own test: *would a user fluent in
Linear, Figma, Notion, Raycast and Stripe sit down and trust this interface, or
pause at every subtly-off component?* Today the answer is pause, and the
pauses are enumerated in §1.

The hard constraint that shapes all of it: **this repository does not hand-write
colour.** `design/tokens/**` → `design/generate.mjs` → `src/styles/tokens.generated.css`
→ `tailwind.config.js`'s `var(--x)` map → `src/core/theme/tokenClasses.ts` →
components. `design/check-contrast.mjs` gates the values and `e2e/theme.spec.ts`
gates the painted pixels. Everything proposed here lands as token changes plus
components consuming tokens. There is not one hex value in this document that is
proposed for `src/`.

---

## 0. The two constraints that decide most of this document

Read these before §1, because half the audit is downstream of them.

### 0.1 The density contract makes hierarchy arithmetically impossible today

`src/components/__tests__/ShellLayout.test.tsx` declares:

```
const PADDING_LIMIT_PX = 12;
const TYPE_BAND_PX = Object.freeze({ min: 11, max: 13 });
```

and enforces them in *`uses no padding above p-3 in any rendered state of the shell`*
and *`keeps every declared type size inside the 11px–13px band in any rendered state`*.

A type **band** of 11–13px admits three sizes. The impeccable typeset reference
asks product UI for a fixed rem scale at ratio 1.125–1.2; 11 → 13 is a total range
of 1.18, so the entire scale fits inside one step. The shell has one heading size
(`TITLE_CLASS = 'text-[13px] font-semibold'` in `LedgerBlock.tsx`), one body size
(`text-[12px]`, set on the shell root and re-declared in `PaneWrapper`'s
`PANE_CHROME`) and one metadata size (`text-[11px]`). There is no size available
for "the object this pane is about", which is why in `07-inventory-selected.png`
the record name *Relief valve 13mm* is the same size as the sentence under it.

The padding side is worse in practice than the rule is on paper. The rule permits
up to 12px; **the shell uses `p-1` (4px) essentially everywhere** — `PaneWrapper`'s
header, body and drawer slots, `COMMAND_ROW_CHROME`, `ShellNavButton`,
`LedgerBlock`'s section box, every form input, the palette. One padding value
across every nesting level is the definition of no spatial rhythm, and it is what
makes every screenshot read as a wireframe rather than a product.

**This spec proposes changing those two constants.** They live in a test file, not
in `src/core/types.ts`, and they are not part of the frozen extension contract.
The change keeps every tooth the scan has: it must still report `p-8`, `p-[64px]`,
`ps-8`, `text-lg`, `text-9xl`, `text-[2vw]`, `text-[0.625rem]`, and every
unmeasurable arbitrary value including `text-[var(--type-body)]` — the R8 posture
is correct and is not being relaxed. What changes is the shape of the rule:
from a **band** to an **allowlist**.

One detail worth stating because it will surprise the implementer: `arbitraryPx`
converts `rem` at 16px, so `text-[0.6875rem]` already resolves to 11 and passes
the current band. The rem spelling of the scale is legal today; only the sizes
above 13px need the constant to move.

### 0.2 A new semantic token is expensive, and almost none are needed

`design/check-contrast.mjs` is exact in both directions: a semantic colour token
with no row in `design/contrast-manifest.json` fails as `UNREVIEWED`, and a row
naming a token that does not exist fails as `STALE`. `scripts/check-tokens.mjs`
CHECK 4 is exact in both directions too — every colour token needs a
`theme.extend.colors` key and every such key needs a token.

So one new semantic colour token costs: an entry in `semantic.json` (which its own
banner calls "a PUBLIC CONTRACT… a name added here is a name that can never be
removed without a breaking change"), one or more `add(...)` declarations in
`design/lib/build-manifest.mjs`, a re-run of that script, a re-committed
`contrast-manifest.json`, a `colors` entry in `tailwind.config.js`, and a
regeneration of both `tokens.generated.css` and `tokens.generated.ts`.

**Given that cost, this spec adds zero semantic colour tokens.** Not one. The
tier is already richer than the UI consuming it: `--accent-solid`,
`--accent-solid-hover`, `--accent-subtle`, `--accent-border`, `--accent-text`,
`--text-on-accent`, `--text-disabled`, `--text-link`, `--surface-sunken`,
`--focus-ring-offset`, all four `--status-*` and all four `--status-*-subtle`
carry `"consumers": []` in `semantic.json` today. The redesign is overwhelmingly
an act of **consumption**, landing in `tokenClasses.ts` — which holds host-internal
role names and is not the public contract — not an act of addition.

---

## 1. Audit

Ranked by how much each one costs a user's trust. **[S]** = structural, the fix
changes composition or a contract; **[C]** = cosmetic, the fix is values and
classes. Each carries the screenshot that shows it.

| # | | Finding | Evidence | One-line diagnosis |
|---|---|---|---|---|
| 1 | **S** | **Pane 3 does not fill its own height; the composer floats mid-pane above ~400px of dead space.** | `01-mail-light.png`, `05-inventory.png` | `PaneWrapper.tsx:122` gives the body `min-h-0 min-w-0 flex-1 overflow-auto p-1` with **no `flex flex-col`**, so the `flex-1` on `ShellLayout.tsx:1637`'s column (audited line; `ShellLayout.tsx:1163` after #95) has no flex parent to fill and sizes to content. The one persistent input surface in the product is parked wherever the ledger happens to end. |
| 2 | **S** | **The selection toolbar is a byte-identical duplicate of the context bar, 40px below it.** | `07-inventory-selected.png`, `08-collapsed-rail.png`, `10-inventory-dark.png` | `FloatingToolbar.tsx` renders every extension command offered to the `floating-toolbar` surface, and the demo extension offers the same six it offers the context bar. Two identical toolbars stacked is the single loudest "nobody looked at this" signal in the whole shell. |
| 3 | **S** | **No type scale and no spacing rhythm.** | every screenshot | §0.1. Three sizes inside 11–13px, `p-1` at every nesting depth. Hierarchy is currently carried by `font-semibold` alone, which the typeset reference names as the muddy-hierarchy failure. |
| 4 | **S** | **The three panes open at proportions nobody chose.** (known defect 3) | console: sizes sum to 83, not 100 | `ShellLayout.tsx:1362` (now `:828` after #95) derives `listDefaultPercent` as a share of the **whole** group (`360/1360 ≈ 26.5`) and `:1377` (now `:847`) derives `detailDefaultPercent` as `100 − paneOneShare − listDefaultPercent`. Both are then handed to the **inner** `PanelGroup`, whose denominator excludes pane 1, so they sum to `100 − navDefaultPercent ≈ 83`. `react-resizable-panels` renormalises, so pane 2 opens roughly 20% wider than the 360px in `PANE_PX`. The author already solved exactly this for the *restored* path at `:1357` (now `:825`) and the *default* path was not given the same rebase. **Inferred from reading the code plus the reported warning; not run.** |
| 5 | **S** | **The chart title overprints the y-axis name and the top tick, and is near-illegible in dark.** (known defects 1 and 2) | `01`, `02`, `05`, `10` | `echartsRenderer.ts:177` sets `title: { text, left: 'left' }` with no `top`; `:184` sets `grid: { left: 48, right: 16, top: 32, bottom: 48 }`; `:188` sets `yAxis: { name: option.yLabel }` with no `nameGap` or `nameLocation`. Three things claim the same 40px band at the top-left. The title is also **painted into a canvas**, so it is unselectable, invisible to assistive technology, and structurally outside the token pipeline — `check-contrast.mjs` cannot measure a string ECharts drew. |
| 5b | **S** | **The chart plot well is never painted, so the twelve series are running outside the pairs `design/` validated them against.** | `01`, `05`, `10` | `--surface-sunken` has zero consumers, and `echartsRenderer.ts:139` sets `backgroundColor: 'transparent'` with a comment saying the contrast pairs "are against the pane, so painting anything else here would invalidate them." But `contrast-manifest.json` validates all twelve series — and `--chart-grid`, `--chart-axis`, `--chart-label` — against **`--surface-sunken`**, not against `--surface-pane`. The comment and the manifest disagree, and the manifest is the thing that was measured. Today's chart paints validated-for-the-well colours onto the pane. Painting the well is not a decoration; it is what makes the existing validation true. |
| 6 | **S** | **Machine identifiers are shipped as human headings.** | `05`, `06`, `07` | `LedgerBlock.tsx:300` renders `{blockId}` as the block's `<h3>` — the user reads *stock-levels*, *stock-table*, *stock-filter*, *mail-activity*, *mail-note*. `:316` renders `Inspect ${blockId}`; `:195` renders `Submit ${blockId}` as the form's primary button label. `:301` renders the payload **kind** (`chart`, `table`, `form`) as a visible chip beside the heading. That chip is a debugging affordance sitting in the product surface. |
| 7 | **S** | **Chrome and content are the same colour, and in dark the whole window is one flat field.** | `02-mail-dark.png`, `10-inventory-dark.png` | `semantic.json` sources both `--surface-app` and `--surface-raised` from `gray` step 2, and states the sharing is deliberate. It was, when nothing rendered chrome; the 32px context bar renders it now. The product register asks for "a second neutral layer for sidebars, toolbars, and panels" and there is not one. In dark, `curve.dark.lightness` 1/2/3 are `0.205 / 0.24 / 0.272` — the two visible planes are 3.5% of L apart. |
| 8 | **S** | **There is no primary action anywhere in the product.** | `05`, `07` | *Reserve one unit*, *Submit stock-filter*, *Inspect stock-levels* and the omnibox submit are the same 1px-outline chip. `--accent-solid`, `--accent-solid-hover` and `--text-on-accent` have zero consumers. A user cannot tell what the pane wants them to do. |
| 9 | **S** | **There is no status vocabulary.** | `05`, `06`, `07` | *below reorder level* is prose in body colour; *low* / *ok* is a bold word in the row. All four `--status-*` and all four `--status-*-subtle` have zero consumers. The one place colour IS used semantically — the row delta — routes through `--chart-positive` / `--chart-negative`, which `tokenClasses.ts` explains is deliberately **not** a status colour. So the shell has a health signal and never draws it. |
| 10 | **S** | **Selected navigation reads as a disabled text input.** | `01`, `06` | `ShellNavButton` stacks three affordances at once on a `rounded-sm border` box: `navSelectedSurface` (fill), `navSelectedBorder` (a full 1px `--border-subtle` outline) and `navSelectedRule` (the 2px inset rule). The full outline is the problem — a filled, outlined, rounded rectangle in a vertical list is the universal shape of a form field, not of a current item. The rule and the semibold weight already carry the state; the outline is contributing the wrong reading. |
| 11 | **S** | **The collapsed rail is debris.** | `08-collapsed-rail.png`, `10` | Badges are `absolute -right-1 -top-1` on a 32px square inside a 48px track (`ShellLayout.tsx:632` when audited; `ShellNavigation.tsx:157` after #95), so a two-digit count overhangs the square, crowds the icon above it and has no minimum width. The track loses its "Navigation" heading entirely. The glyph vocabulary is mixed — extension rows keep monograms by design (`M`, `I`) while nav nodes draw SVGs — so the rail reads as two alphabets. There is no rest-state indication of which item is current beyond the same input-shaped outline as #10. |
| 12 | **C** | **The command palette is the least-finished surface in a Cmd-K product.** | `04-command-palette.png` | The `Dialog.Title` "Commands" (`CommandPalette.tsx:184`) uses the *identical* class string as its own section headings at `:100` — the dialog's title and its subsections are visually the same thing. The scrim is `bg-surface-subtle opacity-60`, a **light grey wash** that bleaches the shell instead of dimming it. There is no active row, no ↑/↓ model, no ⏎ hint, no shortcut column, no footer. `UNCATEGORISED` ships as a user-visible heading. Rows are 24px and gapless. |
| 13 | **C** | **The omnibox looks assembled from three unrelated controls.** | `01`, `05` | The intent chip (`OmniboxComposer.tsx:160`) is a bordered box that looks like a button and is a `<span>`; the submit button at `:183` carries `controlRestBorder` = `border-transparent`, so the arrow glyph floats unattached until hover; the field runs the full pane width (≈780px at 1440) for a single line of text. Three boxes, three different borders, one row. |
| 14 | **C** | **The pane-2 metric column is noise.** | `05`, `06`, `07` | `MetricGlyph` degenerates to `·` or `—` for flat or single-point series — a decorative mark that carries no information but costs a column. The value and delta are `tabular-nums` (correctly, per `RowMetric.tsx`) but the cluster is laid out with `gap-1` and no fixed column widths, so the numbers do not form a column and the left edge of the group is ragged row to row. |
| 15 | **C** | **Tables are not typeset as tables.** | `05`, `06`, `07`, `10` | Lowercase machine column names (`sku`, `on hand`, `reorder level`), numerals left-aligned in numeric columns, no header rule, no zebra, no `tabular-nums`, arbitrary column gaps. In `06` and `10` several `on hand` values render in what appears to be the link/accent colour with nothing explaining why. **That last one is an observation from a screenshot; I did not verify it in `LedgerBlock.tsx`'s `TableBody`.** |
| 16 | **C** | **Forms are a full-width input for a one-character value.** | `05` | `LedgerBlock.tsx:167` gives every field a full-bleed input. *Minimum stock* holds `0` in an 800px box. Labels sit at `gap-px` from their fields, i.e. 1px, so label and field are one visual blob. |
| 17 | **C** | **The context bar has no right margin and no left/right rhythm.** | `05`, `06` | `p-1` puts *Clear record fault* 4px from the window edge, and in `06` the overflow `⋯` sits flush against it. The host cluster and the extension cluster are separated only by `justify-between`, so at wide widths there is a 700px void in the middle of the primary command surface with no divider or grouping. |
| 18 | **C** | **The high-contrast theme is not visibly higher contrast.** | `03-mail-high-contrast.png` vs `01` | At screenshot scale the two are near-indistinguishable. The theme is doing real work in the numbers — `contrast: 1.25` plus curve overrides on steps 7 and 8 — but the surfaces a user actually looks at (1, 2, 3) are untouched by it, because a multiplier on "distance from step 1" is zero at step 1 and tiny at steps 2 and 3. Widening those steps (§3) is what makes this theme visible. |
| 19 | **C** | **Disabled is an opacity hack; focus is single-tone.** | `04` | `COMMAND_ROW_CHROME` uses `aria-disabled:opacity-40`, which `semantic.json` itself flags as "what today's `aria-disabled:opacity-40` should become" under `--text-disabled` — an unconsumed token whose whole reason to exist is this. `--focus-ring-offset` is likewise unconsumed, so the two-tone ring the token set was designed for is never drawn. |
| 20 | **C** | **Elevation does nothing in dark.** | `04` (light), inferred for dark | `core.tokens.json` declares `shadow-overlay` and `shadow-popover` as black at fixed alphas, emitted once into `:root` by `componentTokens(core)` — `design/lib/resolve.mjs:228` takes no theme argument. `design/README.md` "Honest limits" item 6 already records this. On a `0.205`-lightness pane a 0.18-alpha black is a small effect; the popover is separated in dark essentially by its border alone. |

**What is genuinely good and must survive.** The token architecture is better than
most shipping design systems: twelve generative steps, three themes as three
numbers each, contrast declared as *pairs* rather than annotated on colours, a
searched twelve-series chart palette validated pairwise at CIEDE2000, and a
browser lane that measures painted pixels rather than strings. The audit above is
about what the UI does with that, not about the pipeline.

---

## 2. The system

### 2.1 Type scale — fixed rem, five steps, no fluid sizing

Product UI, so `rem` and fixed, per the typeset reference. Five steps, ratio held
between 1.125 and 1.167 above body:

| Role | rem | px | Ratio to previous | Where |
|---|---|---|---|---|
| `micro` | `0.6875rem` | 11 | — | badges, deltas, metadata, section labels, inspector `<pre>` |
| `body` | `0.75rem` | 12 | 1.09 | everything: rows, labels, inputs, command rows, prose. The shell root. |
| `strong` | `0.875rem` | 14 | 1.167 | pane headers, block headings, table column headers |
| `title` | `1rem` | 16 | 1.143 | **the object the pane is about** — the record name, the message subject. Exactly one per pane. |
| `display` | `1.125rem` | 18 | 1.125 | empty states and first-run only. Reserved; at most one on screen. |

Two honest statements about this scale:

- **The `micro`→`body` step is 1.09 and deliberately breaks the ratio.** At 11px
  there is nowhere to go down. That pair is separated by **colour and weight**
  (`--text-muted` at regular vs `--text-primary` at medium), not by size, which is
  what the layout reference's hierarchy table calls combining dimensions. Above
  body the ratio is consistent.
- **13px disappears.** `TITLE_CLASS` moves 13 → 14 and no size sits between body
  and strong. Two sizes one pixel apart is the muddy-hierarchy tell.

Weights: exactly three. `400` body, `500` for `strong` and for selected rows,
`600` for `title` and `display`. No `700` anywhere. `font-ui` is unchanged (§7).

`tabular-nums` is mandatory on every numeric column, not only on `RowMetric` where
it already is.

### 2.2 Spacing — 4px grid, five stops, applied by nesting depth

Allowlist, not a cap: **0, 2, 4, 8, 12** (`p-0`, `p-0.5`, `p-1`, `p-2`, `p-3`).
`p-1.5`, `p-2.5`, `px-3.5` and every arbitrary value stay violations. The ceiling
does **not** move — 12px is right for a dense desktop shell; the defect is that
nothing uses 8 or 12, not that 16 is unavailable.

Assignment by depth, which is what creates rhythm:

| Depth | Padding | Example |
|---|---|---|
| Pane box | `0` | `PaneWrapper` outer |
| Pane header / footer slot | `px-2 py-1` | pane title row, omnibox dock |
| Pane body | `p-2` | scroll container |
| A block inside the body | `p-2` | `LedgerBlock` section |
| A row inside a block | `px-2 py-1` | list rows, table rows, command rows |
| A chip inside a row | `px-1` | badge, intent chip, status pill |

`gap` is the other half and it is **already unconstrained** — `paddingOffenders`
reads padding utilities only. So vertical rhythm between ledger blocks (`gap-3`),
between form fields (`gap-2`) and between a label and its field (`gap-0.5`) needs
no contract change at all. This is the cheapest large win in the document.

### 2.3 Surfaces and the second neutral layer

Three planes that must be distinguishable at a glance in all three themes:

```
pane        (content)  --surface-pane      gray step 1
app         (gutter)   --surface-app       gray step 2
chrome      (bar)      --surface-raised    gray step 3   ← moves
```

Chrome sits **further from the content surface than the gutter is**, which is the
conventional desktop reading: the reading surface is brightest, the command bar is
a distinct recessed plane, the gutter between panes is the frame. Today chrome and
gutter are the same value and there is no second neutral layer at all.

The steps themselves widen (§3), because 1.0 / 0.974 / 0.956 in light is 2.6% and
1.8% of lightness and does not survive a screenshot, let alone a glare-lit
monitor.

**Accepted limit, recorded rather than solved.** `--surface-overlay` is step 1,
identical to the pane. A popover floating over a pane is the same colour as what
it floats over. This cannot be fixed by moving its step, because the ramp is
ordered by *distance from the pane*, so "one step further" means darker in light
and lighter in dark — and light-theme elevation needs *lighter*. Light-theme
elevation therefore stays a shadow; dark-theme elevation is carried by the border
plus a heavier shadow (§3.3). A polarity-independent "elevated" surface is not
expressible in a twelve-step distance ramp and pretending otherwise would put a
`dark:` variant back into `src/`, which is the thing the pipeline exists to stop.

### 2.4 Focus

**The shell has three focus mechanisms today and should have one.**

1. `TOKEN_CLASS.listFocusRing` — `focus-visible:ring-1 focus-visible:ring-focus-ring`,
   used by `VirtualizedList`'s scroll container. A **ring**.
2. `TOKEN_CLASS.controlFocusBorder` — `focus:border-border-subtle`, used by
   `CommandMenuItem`. A **border**, on the decorative tier, and on `focus` rather
   than `focus-visible` — so it fires on a mouse click.
3. `tailwind.config.js` sets `outlineColor: { DEFAULT: 'var(--focus-ring)' }`,
   which nothing in `src/` uses. An **outline**, prepared and unconsumed.

**Ring survives. Outline and border are retired.** The ring is what the
`ringColor.DEFAULT` repoint in `tailwind.config.js` was written for, it is what
`e2e/focus-visibility.spec.ts` already measures, and Tailwind's ring composites
correctly with `rounded-sm`, which is every control in this shell. So:

```
focus-visible:ring-1 focus-visible:ring-focus-ring
focus-visible:ring-offset-1 focus-visible:ring-offset-focus-ring-offset
```

The second line is the change: the **inner opaque ring** in `--focus-ring-offset`,
which is the whole reason that token exists and is currently unconsumed
(`ringOffsetColor.DEFAULT` is already pointed at it in the config). Two-tone
matters here specifically because focus can land on a control sitting over the
chart canvas, where a single-colour ring can land on a same-coloured pixel and
vanish — `semantic.json` says exactly this and nothing draws it.

`controlFocusBorder` is deleted from `tokenClasses.ts` and `CommandMenuItem`
adopts the ring, which also fixes the `focus` → `focus-visible` slip. The
`outlineColor` default in the config stays as a safety net for anything the
browser draws natively; it is not a mechanism the shell reaches for.

`--border-focus` stays in `semantic.json` untouched — it is a public contract name
and removing it is a breaking change. It simply has no host consumer after this,
which the tier already tolerates for a dozen other names.

### 2.5 The state vocabulary, and where each state is missing today

| State | Token(s) | Status |
|---|---|---|
| default | `--surface-pane` / `--text-primary` | present |
| hover | `--surface-hover`, `--border-hover` | **`--surface-hover` has exactly one consumer** — `FaultBoundary`'s retry button, via `faultButtonHover`. Nav rows and command rows get only `controlHoverBorder`, i.e. `--border-subtle`, a decorative tier. **Pane-2 list rows have no hover affordance whatsoever**: `VirtualizedList.tsx:361` is `flex min-w-0 items-center overflow-hidden px-1 aria-selected:font-semibold` plus the two selected-state roles, and nothing else. The primary list in the product does not respond to a pointer. `--border-hover` is unconsumed by deliberate decision, recorded in `tokenClasses.ts`. |
| focus | `--focus-ring` (+ `--focus-ring-offset`) | ring present on `VirtualizedList` only; **offset never drawn**; command rows use a border instead; a third mechanism sits configured and unused. Three vocabularies — see §2.4, which cuts it to one |
| active/pressed | — | **entirely absent.** No token, no class, no press feedback anywhere in the shell. Add as `--surface-selected` used momentarily, not a new token. |
| disabled | `--text-disabled` | **unconsumed.** Currently `aria-disabled:opacity-40` on the whole control, which fades border and icon together and composites against unknown backgrounds — `semantic.json` says so verbatim |
| selected | `--surface-selected` + `--border-selected` + weight | present, and over-drawn (finding #10) |
| loading | `--surface-subtle` | **absent.** No skeleton, no pending affordance. `LedgerBlock` renders "Nothing has been published on this channel yet." for both *not yet loaded* and *genuinely empty* |
| error | `--status-danger`, `--status-danger-subtle`, `--text-danger` | **all three unconsumed.** `FaultBoundary` uses `--border-strong` + `--surface-raised`, i.e. a neutral box |
| warning / success / info | `--status-*` | all unconsumed |
| empty | `--text-muted` | present (`EmptyPane`), but as a bare sentence — the register asks for empty states that teach the interface |

Nine of ten states are either missing or drawn with the wrong tier. **Every token
needed to fix that already exists in `semantic.json`.**

### 2.6 Motion

Unchanged. `--motion-micro` (120ms) and `--motion-base` (180ms) are correct and
inside the register's 150–250ms window. `semantic.json`'s `noMotionForThese` note
records that the absence of pane-resize, list-scroll and selection-change tokens
*is* the enforcement. This spec proposes no motion. See §7.

---

## 3. Token diff

**Zero semantic colour tokens are added.** §0.2 is the reason. What changes:

### 3.1 `design/tokens/core.tokens.json` — four curve values

| Key | Now | Proposed | Why |
|---|---|---|---|
| `curve.light.lightness.2` | `0.974` | `0.966` | the gutter must read as a plane, not as a tint of the pane |
| `curve.light.lightness.3` | `0.956` | `0.938` | chrome and the chart well both live here; 3.8% of L below the pane is a plane, 1.8% is a rendering artefact |
| `curve.dark.lightness.2` | `0.24` | `0.252` | same argument, dark polarity |
| `curve.dark.lightness.3` | `0.272` | `0.300` | ditto — and this is the step the chart plot well sits on, which currently has no visible well at all in `10-inventory-dark.png` |

Everything else in the curve is untouched. Steps 7–12 carry every text and border
measurement in the manifest and there is no reason to move any of them.

Themes affected: **all three.** Light and dark directly. High contrast
additionally, because its own `curve` override names only steps 7 and 8, so 2 and
3 come from core and then get multiplied by `contrast: 1.25` — the widened gap
widens further there, which is exactly what finding #18 asks for and is the
cheapest way to make that theme visible.

### 3.2 `design/tokens/semantic.json` — one source repoint

| Token | Now | Proposed |
|---|---|---|
| `--surface-raised` | `{ ramp: gray, step: 2 }` | `{ ramp: gray, step: 3 }` |

Its `description` must change with it — it currently argues *for* sharing a step
with `--surface-app` ("they are the same plane, and separating them would be a
distinction with no rendering behind it"). There is rendering behind it now: the
32px context bar. Its `consumers` array also still names
`src/components/ui/RibbonToolbar.tsx`, a file the native-host pivot deleted, and
should name `src/components/command/ContextBar.tsx`.

**Known collision, stated rather than hidden:** `--surface-raised` and
`--surface-sunken` then resolve to the same value. They are never adjacent — one
is the bar above the panes, the other is a well inside a pane — and the manifest
measures both independently, so nothing goes unvalidated. The alternative (moving
`--surface-app` to step 3 instead) produces the identical collision with
`--surface-sunken` and reads worse: it makes the gutter deeper than the chrome.

### 3.3 `design/tokens/core.tokens.json` + generator — two component-tier additions

Neither is a semantic token, so neither enters the public contract and neither
needs a manifest row.

**(a) `component.scrim`.** A DTCG colour with alpha, in the shape the shadow
tokens already use:

```
"scrim": { "$type": "color",
           "$value": { "colorSpace": "srgb", "components": [0,0,0], "alpha": 0.45 } }
```

`design/lib/resolve.mjs`'s `componentValueToCss` has cases for `dimension`,
`duration`, `cubicBezier`, `fontFamily` and `shadow`, and **throws on anything
else** — so this needs a `color` case, roughly eight lines, reusing the
components-and-alpha arithmetic that already lives inside the `shadow` case.
Tailwind exposure goes under `theme.extend.backgroundColor`, **not** under
`colors`: `scripts/check-tokens.mjs` CHECK 4 walks `theme.extend.colors` in both
directions, so a `--scrim` key there would fail as `DEAD UTILITY`.

This replaces `bg-surface-subtle opacity-60` on the palette overlay — a light-grey
wash that bleaches the shell in both polarities (finding #12).

**(b) The shadow pair becomes per-polarity.** `componentTokens(core)` in
`resolve.mjs:228` takes no theme argument, so `--shadow-overlay` and
`--shadow-popover` are emitted once into `:root`. Proposal: add a single numeric
input per theme file — `shadow: { $type: number, $value: … }`, a multiplier on
every layer's alpha, `1.0` light, `1.8` dark, `1.0` high contrast — and move the
two shadows out of the `:root` block into each theme block in `generate.mjs`. That
keeps the "a theme is a small number of generative inputs" philosophy intact
(three becomes four) and keeps every alpha inside `design/`, where the pipeline
can see it, rather than in a hand-written `dark:shadow-[…]` in `src/`, which
`tailwind.config.js`'s own banner forbids for precisely this reason.

Cost: ~25 lines across `generate.mjs` and `resolve.mjs`, one line per theme file —
**plus a description change in all three.** `leapware-light.tokens.json`'s
`$description` says a theme is "three generative inputs plus an optional curve
override — base colour, accent colour, contrast multiplier — and nothing else."
That sentence stops being true and must move with the change, exactly as
`--surface-raised`'s does in §3.2. Rule 3: documentation lands in the commit that
makes it true.

### 3.4 `design/contrast-manifest.json`

Not hand-edited. `design/lib/build-manifest.mjs` is re-run and the artefact
re-committed. No `add(...)` declarations change: `--surface-raised` and
`--surface-app` are both already members of `READING_SURFACES`, so every pair
involving them re-measures automatically at the new values. The two things to
watch on the re-run, both of which the checker reports on its own:

- `--border-default` on `--surface-raised` at 3.0 (`NONTEXT`) — the border gets
  *closer* to chrome as chrome darkens in light polarity. Currently comfortable;
  must be re-read, not assumed.
- `--border-subtle` on `--surface-sunken` at 1.2 (`DECOR`) — a legibility floor of
  the project's own, and the widened step 3 moves it.

### 3.5 `tailwind.config.js`

- `theme.extend.colors`: **unchanged**, all 65 names stay, parity holds.
- `theme.extend.backgroundColor`: `{ scrim: 'var(--scrim)' }` — new.
- `theme.extend.fontSize`: **not added.** Font size stays a literal utility, per
  §0.1 and per `semantic.json`'s `notTokenised` note. The scale is enforced by the
  density scan's allowlist, not by a token the scan cannot read.

### 3.6 `src/core/theme/tokenClasses.ts` — where the real diff lives

New role names, each pointing at a token that exists today with zero consumers.
This is the bulk of the redesign and none of it touches the public contract.

| New role | Class | Consumes |
|---|---|---|
| `primaryFill` / `primaryFillHover` / `primaryText` | `bg-accent-solid` / `hover:bg-accent-solid-hover` / `text-text-on-accent` | `--accent-solid`, `--accent-solid-hover`, `--text-on-accent` |
| `rowHover` | `hover:bg-surface-hover` | `--surface-hover` |
| `disabledText` | `aria-disabled:text-text-disabled` | `--text-disabled` |
| `focusRingOffset` | `focus-visible:ring-offset-1 focus-visible:ring-offset-focus-ring-offset` | `--focus-ring-offset` (the two-tone ring's inner band, §2.4) |
| `wellSurface` | `bg-surface-sunken` | `--surface-sunken` (the chart plot well, currently painted `transparent`) |
| `dangerSurface` / `dangerText` / `dangerMark` | `bg-status-danger-subtle` / `text-text-danger` / `text-status-danger` | the danger trio |
| `warningSurface` / `warningText` / `warningMark` | ditto, warning | |
| `successSurface` / `successText` / `successMark` | ditto, success | |
| `infoSurface` / `infoText` / `infoMark` | ditto, info | |
| `linkText` | `text-text-link` | `--text-link` |
| `accentText` | `text-accent-text` | `--accent-text` |
| `tabStrip` | `bg-accent-subtle` + `border-accent-border` | `--accent-subtle`, `--accent-border` |
| `skeletonSurface` | `bg-surface-subtle` | `--surface-subtle` |

Changed roles:

| Role | Now | Proposed |
|---|---|---|
| `navSelectedBorder` | `aria-[current]:border-border-subtle` | **deleted.** The full outline is what makes a selected row read as a text field (finding #10). The inset rule and the weight already carry the state, and `tokenClasses.ts`'s own banner says so. |
| `controlFocusBorder` | `focus:border-border-subtle` | **deleted.** §2.4 — one focus mechanism, and this one also fires on `focus` rather than `focus-visible`, so it triggers on a mouse click. `CommandMenuItem` adopts `listFocusRing` + `focusRingOffset`. |
| `listFocusRing` | `focus-visible:ring-1 focus-visible:ring-focus-ring` | kept, and becomes the shell-wide focus treatment rather than the list's. Worth renaming to `focusRing`; that is a one-line rename in a host-internal file. |
| `controlRestBorder` | `border-transparent` | keep, but the omnibox submit stops using it (finding #13) |

### 3.7 `src/components/__tests__/ShellLayout.test.tsx` — the density contract

| Constant | Now | Proposed |
|---|---|---|
| `PADDING_LIMIT_PX = 12` | a **cap** | `PADDING_STOPS_PX = {0, 2, 4, 8, 12}`, an **allowlist**. Ceiling unchanged; `p-1.5`, `px-3.5`, `p-2.5` become violations that are currently legal. |
| `TYPE_BAND_PX = {min:11, max:13}` | a **band** | `TYPE_SCALE_PX = {11, 12, 14, 16, 18}`, an **allowlist**. `text-[13px]` becomes a violation. |

`typeSizeOffenders`'s R8 posture is preserved verbatim: an unmeasurable arbitrary
value is still reported, `text-[color:…]` is still the only exemption, and
`text-[var(--type-body)]` still fails. The control case
(*`reports p-8, p-[64px], ps-8 and text-lg, so the density scan cannot pass vacuously`*)
grows the new near-neighbours — `text-[13px]`, `text-[15px]`, `p-1.5`, `p-2.5` —
and keeps every existing assertion. The two enforcing tests are renamed to match
the new rule, which is a deliberate, visible diff.

---

## 4. Component-by-component

Line counts are `implementation + tests`, because the repository gates **100%
statements/branches/functions/lines over `src/components/**`** and every new
branch needs a case. An implementation-only estimate here would understate by
roughly half, which is the mistake this column exists to avoid.

| Surface | File | Change | Lines |
|---|---|---|---|
| **Pane shell** | `src/components/layout/PaneWrapper.tsx` | Body becomes `flex flex-col` so children can fill (finding #1). Add a **`footer` slot** outside the scroll container, symmetric with `header`, so the composer docks to the pane's bottom edge instead of scrolling with content. Header padding `p-1` → `px-2 py-1`, body `p-1` → `p-2`. | 25 + 45 |
| **Context bar** | `src/components/command/ContextBar.tsx` | Consume `--surface-raised` at its new step (no class change; the value moves). Padding `p-1` → `px-2 py-1` so the trailing command is not 4px from the window edge (#17). Add a 1px `--border-subtle` vertical rule between the host cluster and the extension cluster so the 700px void reads as a deliberate split. Add hover fill via `rowHover` on `COMMAND_ROW_CHROME`. | 15 + 25 |
| **Command row (all four surfaces)** | `src/components/command/commandListItem.tsx` | `COMMAND_ROW_CHROME`: `p-1` → `px-2 py-1`; add `rowHover`; replace `aria-disabled:opacity-40` with `disabledText` (#19); add `focusRing` + `focusRingOffset` so the four surfaces share one focus vocabulary. Optional: a right-aligned `aria-keyshortcuts` chip, `micro`, `--text-muted` — the attribute is already emitted and nothing renders it. | 20 + 40 |
| **Nav pane / tree** | `src/components/layout/ShellNavigation.tsx` (`ShellNavButton`, `NavigationTree`; in `ShellLayout.tsx` until #95) | Drop `navSelectedBorder` (#10). Child indent `pl-2` → `pl-3` with a 1px `--border-subtle` guide rule at the indent, so tree depth is legible (#10, `05`). Section headings `EXTENSIONS` / `NAVIGATION` become `micro` + `--text-muted` at `px-2` with `gap-2` above. Badge gets `min-w`, `tabular-nums` and `--text-secondary`. Row hover fill. | 40 + 70 |
| **Collapsed rail** | `src/components/layout/ShellNavigation.tsx` (same component, `isCollapsed` branch) | Rail keeps a header — a 28px square holding the collapse control — so pane 1 is not an unlabelled strip (#11). Badge stops being `absolute -right-1 -top-1`: it becomes a bottom-anchored dot for ≤0 vs a `min-w-4` pill clamped to `99+`, inside the 32px square. Current item gets the inset rule only, matching the expanded state. `title` already provides the hover tooltip; keep it. | 35 + 60 |
| **List rows** | `src/components/shared/VirtualizedList.tsx`, `src/components/ui/RowMetric.tsx` | Rows: `px-2 py-1`, `rowHover`, `row-h-default` (28px) consumed from the token that already exists and is unused. `RowMetric`: fixed-width value column so the numbers form a column (#14); glyph suppressed when the series has fewer than three distinct points instead of drawing `·`. | 25 + 55 |
| **Detail pane** | `src/components/layout/ShellLayout.tsx` (pane 3 subtree) | The record title becomes `title` (16px/600) — the one per-pane use of that step. `FloatingToolbar` moves from a docked strip above the content to the pane header's trailing edge, or is dropped when its command set is a subset of the context bar's (#2 — see §6 for which). `OmniboxComposer` moves into `PaneWrapper`'s new `footer` slot (#1). | 30 + 45 |
| **Ledger block** | `src/components/ledger/LedgerBlock.tsx` | `TITLE_CLASS` 13px → `strong` (14px/500). The kind chip (`chart`/`table`/`form`) and the `Inspect ${blockId}` button move behind a single `⋯` control, so debug affordances stop occupying the heading row (#6). Block gap `gap-1` → `gap-3` between blocks, `gap-2` within. `sectionEdge` stays `--border-subtle` — correct tier. | 35 + 60 |
| **Chart** | `src/core/chart/echartsRenderer.ts`, `src/components/chart/Chart.tsx` | **The canvas title is deleted.** `title: { show: false }` in `toEChartsOption`; the `<figcaption>` in `Chart.tsx:222` stops being `sr-only` and becomes the visible `strong` heading above the canvas, in `--text-primary`. That collapses known defects 1 and 2 in one move and puts the string back inside the token pipeline where `check-contrast.mjs` and `e2e/theme.spec.ts` can see it. The **other half of defect 1** is the y-axis: `yAxis` needs explicit `nameLocation: 'end'` and `nameGap`, and `grid.top` drops from 32 to ~12 once the title is gone. Plot well painted `--surface-sunken` via a new `well` field on `ChartPalette` — finding #5b, and **not** a cosmetic addition: it is what brings the chart inside the pairs the manifest already measures. Three consequences to carry: `chartPalette.test.ts`'s *`reads every chrome colour from the resolved theme`* grows a field; the palette's identity keys the chart instance lifetime, so the field must be resolved in `buildChartPalette` and nowhere else; and `toEChartsTheme`'s `backgroundColor: 'transparent'` comment — which asserts the pairs are against the pane — is **wrong today** and must be corrected, not deleted. | 35 + 60 |
| **Table** | `src/components/ledger/LedgerBlock.tsx` (`TableBody`), `src/components/chart/ChartDataTable.tsx` | Column headers `micro`/`--text-muted`/uppercase with a `--border-default` bottom rule. Numeric columns right-aligned with `tabular-nums`. Row `px-2 py-1` with `rowHover`. No zebra — a rule is enough at this density and zebra fights the selected fill. | 30 + 50 |
| **Form** | `src/components/ledger/LedgerBlock.tsx` (`FormBody`) | Fields get a `max-w` appropriate to their content instead of full bleed (#16). Label→field gap `gap-px` → `gap-0.5`; field→field `gap-2`. Submit becomes the pane's primary: `primaryFill` + `primaryText` (#8). Label text `micro` + `--text-muted`. | 20 + 40 |
| **Omnibox** | `src/components/command/OmniboxComposer.tsx` | Chip, field and submit become **one bordered control**: the chip moves inside the field's left inset and loses its own border; the submit loses `controlRestBorder` and gains the field's border on the right; the group gets `max-w` so it stops running 780px (#13). Match list rows gain `rowHover` and the first match is marked visually as the one Enter will run — which the code already does and the UI does not say. | 30 + 50 |
| **Command palette** | `src/components/command/CommandPalette.tsx` | Overlay `bg-surface-subtle opacity-60` → `bg-scrim` (#12). `Dialog.Title` becomes `strong` and stops sharing a class string with `PaletteSection`'s `<h3>`. Rows get `rowHover` and a right-aligned shortcut chip. A footer strip: `↑↓ navigate · ↵ run · esc close`. `UNCATEGORISED` needs a real label — that comes from `CommandRegistry`'s grouping, so it is a one-word fix at the source, not here. **Arrow-key navigation is scoped separately in §6.** | 35 + 60 |
| **Pane sizing** | `src/components/layout/ShellLayout.tsx` (`:1360`–`:1380` when audited; `:789`–`:850` after #95) | Fix defect 3: rebase `listDefaultPercent` onto the inner group's denominator when `showChrome` is true, exactly as `:1357` already does for the restored path, and derive `detailDefaultPercent` as `100 − listDefaultPercent` within that group. | 12 + 35 |
| **Empty & loading states** | `ExtensionPane.tsx` (`EmptyPane`; in `ShellLayout.tsx` until #95), `LedgerBlock.tsx` | `EmptyPane` gets a `display`-size line plus one muted sentence that names the next action, instead of one grey sentence. `LedgerBlock` separates *no payload yet* (skeleton, `skeletonSurface`) from *published nothing* (empty). | 25 + 55 |

**Rough total: ~400 implementation lines, ~740 test lines, ~1,140 lines across 11
files plus 4 design files.** Two of those files — `ShellLayout.tsx` at 1,858 lines
and `LedgerBlock.tsx` at 371 — carry four separate entries each, which matters for
rule 6 (parallel work needs disjoint file ownership). See §6.

---

## 5. Verification plan

### 5.1 What `design/check-contrast.mjs` must assert afterwards

Nothing new is *declared*, because no semantic token is added. What must be
re-read on the re-run of `design/lib/build-manifest.mjs`, in all three themes:

- Every pair whose background is `--surface-raised` or `--surface-app`, because
  both move. `--text-primary`, `--text-muted`, `--text-secondary`,
  `--border-default` and `--border-strong` all have rows against one or both.
- `--border-subtle` on `--surface-sunken`, currently a `1.2` project floor, which
  the widened step 3 moves.
- The twelve chart series against `--surface-sunken` at 3.0 — the well is now
  actually painted, so those rows stop being theoretical.

Run `node design/check-contrast.mjs --self-test --table` and paste the table.
Per rule 2, the table is the evidence; "contrast still passes" is not.

### 5.2 What `e2e/theme.spec.ts` must assert afterwards

The file's existing seven cases all survive unchanged and all remain meaningful.
Two of them get sharper without being edited:

- *`paints the declared colours in the light (the default) theme`* (and its dark
  and high-contrast siblings) already reads `--surface-pane`, `--border-default`
  and `--control-divider` off real elements. **Add a fourth read:**
  `[data-shell-region="context-bar"]`'s `background-color` against the annotated
  `--surface-raised`, which is the whole of §3.2 proven on a painted pixel.
- *`swaps every colour on the same elements when the theme attribute changes`*
  needs no change.

New assertions, described rather than titled, because inventing a test title in a
spec is how `check:citations` gets a citation that resolves vacuously:

| Assertion | Lands in |
|---|---|
| The context bar's painted background differs from the app root's **and** from pane 2's, by more than the 2-step tolerance, in all three themes. This is the one that proves the second neutral layer exists rather than being declared. | `e2e/theme.spec.ts` |
| The chart's visible heading is a DOM element (not canvas pixels), and its painted colour clears 4.5:1 against the painted pane, in all three themes. This is known defects 1 and 2 closed by measurement. | `e2e/chart.spec.ts` |
| The chart heading's bounding box does not intersect the y-axis label's, at the default pane width and at pane 3's minimum. Geometric, so it cannot live in vitest. | `e2e/chart.spec.ts` |
| The three panes' reported sizes sum to 100 within float tolerance on first paint, with no console warning. Known defect 3. | `e2e/pane-dividers.spec.ts` (which already owns `keeps the three panes inside the window at every extreme`) |
| A primary control paints `--accent-solid` with `--text-on-accent` on it, and the pair clears 4.5:1 on painted pixels. Proves §3.6's first row reached the browser. | `e2e/theme.spec.ts` |
| The omnibox composer's bounding box bottom edge is within a few pixels of pane 3's content box bottom — i.e. it is docked, not floating. Finding #1, and purely geometric. | `e2e/shell-layout.spec.ts` |
| A pointer at rest over a list row changes the row's painted background. Finding: hover has no fill today. jsdom cannot hit-test, so this is browser-only by construction. | `e2e/focus-visibility.spec.ts` or a sibling |

The existing focus lane already carries
*`gives every element the Tab order reaches a visible focus indicator`*; the
two-tone ring (§2.4) is a strengthening of what that case measures, not a new one.

### 5.3 What jsdom can still hold

The density scan, at its new constants — the padding allowlist and the type
allowlist — across every state `shellStates()` reaches, with its
did-we-reach-every-state control (*`reaches every rendered state of the shell, proven by a token unique to each`*)
intact. **`STATE_MARKERS` is the trap in this whole plan.** Each entry is a class
string that is supposed to be unique to one shell state, and three of the five are
in this spec's change list:

- `'no extension active'` → `'leading-5'`, which is `EmptyPane` — §4 rewrites it.
- `'extension active'` → `'pl-2'`, the tree's child indent — §4 changes it to `pl-3`.
- `'utility drawer open'` → `'w-40'`, `PaneWrapper`'s drawer slot — §4 touches that
  file, and `tailwind.config.js` records that `w-40` and `h-8` are *deliberately*
  left as literals rather than moved to `w-drawer`/`h-8` utilities **because** they
  are these markers.

The rule, once: **any marker whose class disappears must be replaced in the same
commit.** Otherwise `reaches every rendered state of the shell, proven by a token
unique to each` fails loudly (good), or — if the marker is replaced by another
class that happens to appear elsewhere — it passes while proving nothing, which is
the vacuous-green failure this repository has already paid for twice.

Also jsdom-holdable: the `footer` slot renders only when supplied, `TableBody`
right-aligns numeric columns, `RowMetric` suppresses the degenerate glyph,
`toEChartsOption` emits `title: { show: false }`.

### 5.4 What only a human can judge

Named explicitly, because the repository's own rule 4 is that a green suite is not
evidence where the suite cannot observe the behaviour:

- Whether the three surface planes read as *deliberate* rather than as a
  rendering artefact. A contrast ratio cannot tell you that 3.8% of lightness
  looks like a plane; only eyes on a real panel can.
- Whether the type scale reads as a hierarchy at 12px body on a 96-DPI Windows
  panel with Segoe UI Variable Text. The ratios are arithmetic; the perception is
  not.
- Whether `--surface-raised` at step 3 makes the context bar feel *recessed* or
  *dirty*. This is the single riskiest value in §3.
- Whether the high-contrast theme is now genuinely higher contrast **to a
  low-vision user**, which is a question no checker in this repository has ever
  been able to answer and which GitHub issue #60 already records as open — no
  assistive technology has ever been pointed at this application.
- Whether removing the canvas title is a loss for anyone who exports a chart
  image. It is, and it is an accepted one.

---

## 6. Sequencing

### Wave 1 — the pipeline, alone, first

Nothing in `src/` moves until the token values are settled, because every
component change downstream is judged against them.

1. `core.tokens.json` curve edits + `semantic.json` `--surface-raised` repoint
   (§3.1, §3.2).
2. Re-run `build-manifest.mjs`, regenerate `tokens.generated.css` and `.ts`,
   `npm run tokens:check`, `node design/check-contrast.mjs --self-test --table`.
3. `e2e/theme.spec.ts`'s context-bar read (§5.2).

This wave changes **no component file**. It is one reviewer, one commit, and its
whole diff is numbers plus a regenerated artefact.

### Wave 2 — three defects, in parallel, disjoint files

| Stream | Owns | Blocks on |
|---|---|---|
| A | `src/core/chart/echartsRenderer.ts`, `src/components/chart/*`, `e2e/chart.spec.ts` | wave 1 (the well needs `--surface-sunken` at its new value) |
| B | `src/components/layout/ShellLayout.tsx` **sizing only** (`:1360`–`:1380` when audited; `:789`–`:850` after #95), `e2e/pane-dividers.spec.ts` | nothing |
| C | `src/components/layout/PaneWrapper.tsx` (footer slot + flex body) | nothing |

Streams B and C both eventually touch `ShellLayout.tsx`, so **C lands the
`PaneWrapper` change and B lands first**; C's `ShellLayout` consumption of the
footer slot moves to wave 3.

### Wave 3 — the system, serialised on `ShellLayout.tsx`

`ShellLayout.tsx` is 1,858 lines and carries the nav tree, the rail, pane 3's
composition and the empty state. Rule 6 says two workstreams on one file
serialise, so this is one stream: density constants → nav + rail → pane 3
composition + omnibox docking → empty states.

In parallel, on genuinely disjoint files: `commandListItem.tsx` +
`CommandPalette.tsx` + `ContextBar.tsx` (one stream, since the row chrome is
shared), and `LedgerBlock.tsx` + `ChartDataTable.tsx` (one stream).

**One mechanical gate to clear before the density commit opens.** §3.7 renames the
two enforcing tests, and `scripts/check-citations.mjs` — stage 2 of `npm run verify`
— reads test titles out of the AST and resolves prose citations against them. The
current titles *`uses no padding above p-3 in any rendered state of the shell`* and
*`keeps every declared type size inside the 11px–13px band in any rendered state`*,
and the contract they describe, are referenced in at least `PaneWrapper.tsx`'s
`PANE_CHROME` docblock, `semantic.json`'s `notTokenised` note and `design/README.md`.
Grep for both strings and for `11px–13px` across `**/*.{md,ts,tsx,json,mjs}` and
update every citation **in the same commit as the rename**. This is not a design
question; skipped, it surfaces as a red `verify` on somebody else's machine.

### Wave 4 — the two decisions this spec does not make

- **The floating toolbar (finding #2).** Either it becomes genuinely
  selection-scoped — which means the demo extensions stop offering the same six
  commands to both surfaces, and that is an *extension* change, not a host one —
  or the host suppresses any command already inline on the context bar. The
  second is host-only and shippable now; the first is better and is the kind of
  thing GitHub issue #65's friction log exists to discover. **Recommend the
  host-side suppression as interim, and flag it for #65.**
- **Arrow-key navigation in the palette.** `CommandPalette.tsx`'s banner is right
  that a role whose model is unimplemented is worse than no role, and right that
  implementing it costs an entry in `KEY_EVENT_ALLOWLIST` in
  `src/__tests__/noEventListener.test.ts` — an allowlist whose value is that it is
  hard to get into. But a Cmd-K palette that cannot be driven by ↑/↓ is not
  best-in-class in 2026, and the allowlist already names the list virtualizer and
  the chord dispatcher, both for the same reason. **Recommend paying the cost,
  as its own change, with its own review.** Not folded into a redesign wave.

### What must NOT be touched

**The extension contract is frozen pending issue #65.** Concretely:

- **`src/core/types.ts` — nothing.** Not `LEAPExtensionBlueprint`, not
  `ExtensionViews`, not `NavigationNode`, not `NavigationMetric`, not
  `RibbonContext`, not `PaneId`. No field added, none renamed, none widened.
- **The pane view props** — whatever a pane 2 or pane 3 view receives is
  unchanged.
- **The blueprint shape** — including the absence of an `icon` field on
  `LEAPExtensionBlueprint`, which is why the rail's extension rows keep monograms.
  That asymmetry is a finding (#11) and it is **freeze-blocked**: it cannot be
  fixed without a contract field. The host-only interim is to make the monogram
  square deliberate rather than accidental (a filled tile at `--surface-subtle`
  with the letter in `--text-secondary`) so it reads as an identity chip and not
  as a failed icon.
- **Finding #6 is half freeze-blocked too.** `blockId` is a publisher's string
  and there is no `title` field for a block. The host can stop *presenting* it as
  a heading — move the id into the inspector where it belongs — but it cannot
  render a human title until a contract field exists. The host-only interim is:
  the block heading becomes the payload's own meaning where one exists, and
  otherwise the block renders no heading at all rather than a machine id.
- **`semantic.json`'s existing names.** A name removed there breaks every
  extension bound to it. This spec removes none and adds none.

---

## 7. What this spec does NOT propose, and why

The product register's stated failure mode is **strangeness without purpose**, and
the bar is *earned familiarity*. Each of the following is a thing a redesign is
expected to reach for, and each is deliberately left alone.

1. **No font change.** `--font-ui` is `Segoe UI Variable Text` with a
   `system-ui` chain. This is a Windows Electron shell. The register explicitly
   permits system stacks, and a webfont here would cost a network dependency, a
   FOUT and a portability question (ADR-0002) to buy a typeface nobody asked for.
   `--font-mono` stays too.

2. **No new colour identity.** Base hue 264, accent hue 252, held identical
   across light and dark *specifically* so a user switching themes does not
   experience it as a different product — the dark theme file says so. There is a
   committed brand palette and identity-preservation wins over a fresh one. The
   colour work in this spec is entirely about **using** the palette that exists.

3. **No motion.** `semantic.json`'s `noMotionForThese` note: there is deliberately
   no token for pane-resize, list-scroll or selection-change motion, and "the
   absence is the enforcement: a duration that does not exist cannot be
   referenced." Adding one would be reopening a decision that was made carefully.
   The two durations that do exist are correct.

4. **No density preference control.** `row-h-compact` / `row-h-default` /
   `row-h-comfortable` exist as tokens and are unconsumed. Consuming
   `row-h-default` is in scope; shipping a user-facing density switch is a feature,
   not a redesign, and it multiplies every visual review by three.

5. **No cards, no elevation theatre, no glass.** The ledger block is already a
   bordered section and that is the correct affordance for a stack of published
   payloads. `design/README.md`'s own rule — "borders separate, shadows elevate" —
   is right and is kept. Nothing gains a shadow that is not floating.

6. **No fluid type, no `clamp()`.** The register is explicit: no major product
   design system uses fluid type in app UI, and a heading that shrinks in a
   resizable pane looks worse, not better. The scale is fixed `rem`.

7. **No icon set change.** `src/components/ui/shellIcons.tsx` is a host-owned
   `Map` of inline SVGs, and that `Map` is a *security* decision — an untrusted
   `icon` key reaches nothing but `Map.prototype.get`, so `icon: "__proto__"`
   cannot resolve to anything inherited. Introducing an icon library would either
   break that or duplicate it. Two glyphs are reused for different meanings
   (`Collapse navigation` and `Switch extension` both draw the hamburger, visible
   in `04-command-palette.png`); that is a **content** fix inside the existing
   Map, not a library swap.

8. **No accent-coloured chrome.** The accent stays what `semantic.json` says it
   is: focus, links, primary fills, current selection. Not headings, not borders,
   not the context bar. The register's floor for product is Restrained and this
   shell should stay there.

9. **No responsive/mobile work.** This is a desktop shell in an Electron window.
   Responsive behaviour here is structural — the rail collapse, the overflow menu
   — and both already exist. Breakpoint-driven column layouts would be strangeness
   without purpose.

10. **No change to the token architecture.** No move to Style Dictionary, no
    change to the twelve-step ramp, no restructuring of the semantic tier, no
    switch to the `<alpha-value>` channel form. `generate.mjs` explains why each
    of those is out of scope and each explanation still holds. The pipeline is the
    best thing in this repository; the redesign consumes it rather than
    renegotiating it.

---

## Limits of this document

- Nothing here has been run. No screenshot in this spec was produced by a change
  proposed in it.
- Finding #4's mechanism is **inferred from reading `ShellLayout.tsx:1357–1380`** (now `ShellLayout.tsx:824–850` after #95)
  and matching it against the reported 83% figure. The arithmetic is consistent
  and the author's own comment at `:1340` describes exactly this class of
  denominator error for the sibling path, but the fix has not been executed and
  the sum has not been observed at 100.
- Finding #5's *dark* half — why the title is dimmer than the axis labels, when
  `toEChartsTheme` sets `title.textStyle.color` to `palette.label` like everything
  else — is **not resolved**. Two candidates: ECharts' built-in title default
  winning over the registered theme, or the option-level `title` at
  `echartsRenderer.ts:177` shadowing it. Deleting the canvas title makes the
  question moot, which is part of why that is the recommendation; if the title
  were kept, the mechanism would have to be established in the browser lane first.
- Finding #15's accent-coloured `on hand` values are read off `06` and `10` and
  were **not** traced to a line in `TableBody`.
- The high-contrast observation in #18 is a comparison of two screenshots at
  1440px. The theme's numbers are doing real work; the claim is only that a user
  cannot see them on the surfaces they look at most.
- Every line estimate in §4 is a judgement, not a measurement.
