# Shape brief — the ShellUX redesign

**Gate 2 of five.** This is the design in words. No pixels, no hex, no component
diff. What it decides is what the screens at gate 4 are drawn from, so a
disagreement here is cheap and a disagreement there is not.

Register: **product**, per `PRODUCT.md`. Bar: the product register's own test —
would someone fluent in Linear, Raycast or Stripe sit down at this and trust it.

**On generated mocks:** this harness has no native image generation, so the
impeccable flow's mock-exploration step does not run. Stated rather than skipped
silently. Gates 3 and 4 are hand-built HTML artifacts drawn from **real values
produced by a real `design/generate.mjs` run**, which is stronger evidence than a
generated mock and is the reason the previous attempt's screen 1 was not
approvable: it was 22 hand-written hex values and six illegal type sizes.

---

## 1. What is being designed

The whole host surface. Concretely: three panes and their chrome, the navigation
tree and its collapsed rail, list rows, the ledger blocks an extension publishes
into panes 2 and 3, tables, forms, charts, the four command surfaces, and every
empty, loading and error state between them.

**Not** in scope: anything an extension owns, and the extension contract itself.

---

## 2. Design direction

Four references were named. They synthesise into one lane rather than four, and
the lane has a name: **an operator's instrument that is commanded by keyboard and
reports state without decoration.**

- From **Linear**: hierarchy carried by weight, ink and space. Borders are the
  last resort, not the first. Nothing is decorated.
- From **Raycast**: the command surface is a way to work, not a shortcut menu. It
  tells you what Enter does.
- From **a trading terminal**: density is the point. Tabular numerals, chrome that
  recedes, the data being the interface.
- From **Stripe**: one small status vocabulary, applied identically everywhere.

What that rules out, from the same list of four anti-references: no ribbon, no
card grid, no hero metrics, no monospace-as-aesthetic, no large radii, no
illustration, no motion flourish.

---

## 3. The one structural move: the host gets an editorial voice

This is the first-order change and everything else is downstream of it.

Today the shell prints an extension's internal identifiers as human headings. An
operator reads `stock-levels`, `stock-table`, `stock-filter`, a button labelled
*Submit stock-filter*, and a chip beside each heading saying `chart`, `table` or
`form`. That chip is the payload's **type** — a debugging affordance shipped in
the product surface. It is the single loudest reason the shell reads as an
inspector rather than a product.

**The rule: a publisher's string is never presented as a human heading, and a
payload's type is never a user-visible label.**

Three host-side moves, none of which needs a contract change:

1. **The type chip is deleted from the surface.** A table looks like a table.
2. **`Inspect <blockId>` leaves the heading row** and becomes a single overflow
   control on the block, where a debugging affordance belongs. The id is shown
   *inside* the inspector, which is the one place it is the right answer.
3. **Where the contract gives the host nothing human to show, the host shows no
   heading at all** and lets the content lead, delimited by space and a rule.
   Showing nothing is better than showing `stock-table`.

**Freeze-blocked, stated as a limit rather than solved:** `LEAPExtensionBlueprint`
has no `title` field for a block, and no `icon` field for an extension. Both are
frozen pending GitHub #65 (register row D-13). So the host cannot render a human
block title, and the rail's extension rows keep monograms while nav nodes draw
SVGs. The host-side interim for the second is to make the monogram deliberate — a
filled identity tile — so it reads as a chosen mark and not as a failed icon.

---

## 4. Type: the scale does not change, and that is a decision

**`TYPE_BAND_PX = { min: 11, max: 13 }` stays. So does `PADDING_LIMIT_PX = 12`.**

The committed spec proposes replacing the band with an allowlist `{11,12,14,16,18}`
so that "the object the pane is about" can be 16px. That is a real proposal and
this brief rejects it, for two reasons.

**The design reason.** Two of the four named references — Linear and a trading
terminal — buy hierarchy without a size jump. An instrument does not shout. A
16px record title inside a 12px shell is the SaaS-dashboard move, and SaaS
dashboard is on the anti-reference list. `PRODUCT.md` principle 5 says density is
bought with hierarchy, not with shrinking; it does not say hierarchy is bought
with size.

**The measured reason.** Everything needed is already legal. Read out of
`src/components/__tests__/ShellLayout.test.tsx`:

| Lever | Status today | Verdict |
|---|---|---|
| Padding 8px and 12px | `paddingOffenders` is a **cap** at 12 (`:886`), so `p-2` and `p-3` pass **now** | Available. The shell simply never uses them. |
| `gap-*` at any value | `PADDING_UTILITY = /^p([trblxyse]?)-(.+)$/` (`:859`) — **gap is not scanned at all** | Entirely unconstrained |
| Weight 400 / 500 / 600 | not scanned | Available |
| Ink tier: primary / secondary / muted | tokens exist | Available |
| Letter-spacing, uppercase micro labels | not scanned | Available |
| Row height tokens | `row-h-*` exist, unconsumed | Available |
| Rules and dividers | tokens exist | Available |
| **Type above 13px** | band, `:911` | **The only thing unavailable** |

So the scale is three sizes — 11 metadata, 12 body, 13 the thing the pane is about
— and the hierarchy is carried by weight, ink and space, which is what those two
references actually do.

**What this buys, and it is the largest cost saving in the plan:** no test rename,
so no `check:citations` sweep across every prose citation of *uses no padding above
p-3 in any rendered state of the shell* and *keeps every declared type size inside
the 11px–13px band in any rendered state*, and no density commit at all.

**The risk, named now rather than discovered at gate 4:** if three sizes plus
weight plus ink reads flat on a real panel, the fallback is the constant change
and the citation sweep that comes with it. That judgement is gate 4's, and it is
one of the things to look for there.

---

## 5. Space: rhythm by nesting depth

`p-1` (4px) is used at literally every nesting level today, which is the definition
of no rhythm and is why every screenshot reads as a wireframe. Assignment by depth,
all of it legal under the existing cap:

| Depth | Padding |
|---|---|
| Pane box | `p-0` |
| Pane header / footer slot | `px-2 py-1` |
| Pane body (scroll container) | `p-2` |
| A block inside the body | `p-2` |
| A row inside a block | `px-2 py-1` |
| A chip inside a row | `px-1` |

Vertical rhythm comes from `gap`, which no gate reads: `gap-3` between blocks,
`gap-2` within a block, `gap-0.5` between a label and its field (currently
`gap-px`, so labels and fields are one visual blob).

---

## 6. Surfaces: three planes that a screenshot can tell apart

Content is the brightest plane, chrome is a distinct recessed plane, the gutter
between panes is the frame. Today chrome and gutter are the same value and the
two visible planes are 1.8% of lightness apart in light and 3.5% in dark, which
does not survive a screenshot, let alone a glare-lit monitor.

This needs curve values to move, so **the numbers are gate 3, not this gate.**
What gate 2 decides is that there are three planes and which is which.

`design/tokens/semantic.json:29` currently argues *for* the present state:
`--surface-app` and `--surface-raised` share a step "on purpose — they are the
same plane, and separating them would be a distinction with no rendering behind
it." That was true when written and is not now: the 32px context bar renders that
plane. **The sentence gets rewritten in the commit that overturns it, not deleted
and not silently overwritten.**

---

## 7. Colour: Restrained, and state-only

The register's floor for product, and this shell stays on it.

- **Accent**: focus, current selection, primary action. Nothing else. Not
  headings, not borders, not the context bar.
- **Status**: a threshold was crossed. Never colour alone — always a word or a
  mark beside it, which is the one colour-blindness accommodation that survives
  having no compliance target.
- **Chart series**: unchanged. Twelve searched, pairwise-validated colours.

Nine of the ten interaction states are missing or drawn with the wrong tier today,
and **every token needed to fix that already exists with zero consumers**. The
redesign is overwhelmingly an act of consumption, not addition. Zero semantic
colour tokens are added.

**Deferred to gate 3, deliberately:** whether the accent moves from the current
blue to petrol. It is two numbers per theme file, it does not re-search the chart
palette (`core.tokens.json:107` authors those twenty-four numbers independently of
the ramp), and it is a decision best made looking at painted swatches rather than
at a hex code in a message.

---

## 8. State vocabulary

Ten states, standardised, drawn identically everywhere. Present gaps, measured:

| State | Today |
|---|---|
| default | present |
| **hover** | `--surface-hover` has **one** consumer in the whole shell. **Pane 2's list rows have no hover affordance at all** — the primary list in the product does not respond to a pointer. |
| **focus** | three competing mechanisms: a ring, a border on the decorative tier that fires on `focus` rather than `focus-visible` (so it triggers on a mouse click), and an outline configured and never used. **Cut to one: the ring, with its two-tone offset drawn.** |
| **active / pressed** | entirely absent. No token, no class, no press feedback anywhere. |
| **disabled** | `aria-disabled:opacity-40`, which fades border and icon together against unknown backgrounds. `--text-disabled` exists for this and is unconsumed. |
| selected | present, and over-drawn — a filled, outlined, rounded rectangle in a vertical list is the universal shape of a **form field**, not of a current item. The outline goes; the rule and the weight already carry it. |
| **loading** | absent. No skeleton. The same sentence is shown for *not yet loaded* and *published nothing*. |
| **error** | `--status-danger`, `--status-danger-subtle` and `--text-danger` are all unconsumed; the fault boundary draws a neutral box. |
| warning / success / info | all unconsumed |
| **empty** | a bare grey sentence. The register asks for empty states that teach the interface. |

---

## 9. Command surfaces: the Raycast lever

One registry, four surfaces (register row D-16). The palette is the least-finished
surface in a product whose command story is its differentiator: its dialog title
uses the identical class string as its own section headings, its scrim is a light
grey wash that **bleaches** the shell instead of dimming it, `UNCATEGORISED` ships
as a user-visible heading, and there is no active row, no shortcut column and no
footer saying what Enter does.

In scope: the scrim, the title, the shortcut column, the footer, row hover, and a
real label for the uncategorised group.

**Not in scope, and this is deliberate:** arrow-key navigation. A Cmd-K palette
that cannot be driven by up and down is not best-in-class, and it should be paid
for — but it costs an entry in `KEY_EVENT_ALLOWLIST`, an allowlist whose entire
value is that it is hard to get into. **Its own change, its own review.** Folding
it into a redesign wave is how allowlists rot.

---

## 10. What is deliberately not done

1. **No font change.** `--font-ui` is already Segoe UI Variable Text on a
   `system-ui` chain, `--font-mono` already resolves Cascadia Mono. A webfont buys
   a typeface nobody asked for and costs a network dependency, a FOUT and an
   ADR-0002 portability question.
2. **No motion added.** The two existing durations are correct and inside the
   register's window. `semantic.json` records that the *absence* of pane-resize,
   list-scroll and selection-change tokens is itself the enforcement.
3. **No new colour tokens.** See §7.
4. **No icon library.** `shellIcons.tsx` is a host-owned `Map`, and that `Map` is a
   security decision: an untrusted `icon` key reaches nothing but `Map.prototype.get`.
   Two glyphs currently do double duty; that is a content fix inside the Map.
5. **No density preference control.** Consuming `row-h-default` is in scope;
   shipping a user-facing switch is a feature and multiplies every visual review
   by three.
6. **No responsive or mobile work.** Desktop Electron window. The structural
   responses — rail collapse, overflow menu — already exist.
7. **No contract change.** `src/core/types.ts` untouched: no field added, renamed
   or widened. Register row D-13.

---

## 11. The one mechanical trap, and it is smaller than reported

`STATE_MARKERS` is how the density scan proves it reached every shell state: each
entry is a class token unique to one state, and a scan that silently failed to
reach a state cannot pass by scanning nothing.

The committed spec says it has five entries and that three are in the change list.
**It has seven** (`ShellLayout.test.tsx:957-978`), and under this brief exactly
**one** breaks:

| Marker | State | Under this brief |
|---|---|---|
| `leading-5` | no extension active (`EmptyPane`) | **Breaks.** Empty states are rewritten. Needs a replacement marker chosen in the same commit. |
| `pl-2` | extension active (tree child indent) | **Undecided, and deliberately not decided here.** The indent value is a gate-4 judgement made looking at a drawn tree, not a value a test fixture gets to pick. If it moves, `border-l` on the tree's guide rule is the replacement marker — it is unique to the tree and appears in no other state. |
| `w-40` | utility drawer open | Untouched |
| `h-8` | navigation collapsed | Untouched. The 32px square stays 32px. |
| `w-44` | overflow menu open | Untouched |
| `w-[32rem]` | command palette open | Untouched |
| `shadow-popover` | floating toolbar visible | Untouched |

The rule, once: **a marker whose class disappears is replaced in the same commit.**
Otherwise the control either fails loudly, which is fine, or passes while proving
nothing, which is the vacuous green this repository has already paid for twice.

---

## 12. How each claim gets verified

| Claim | Where it is checked | Why not elsewhere |
|---|---|---|
| Three surface planes are distinguishable | `e2e/theme.spec.ts`, painted pixels, all three themes | A contrast ratio cannot tell you a plane reads as deliberate |
| The chart heading is a DOM node and clears 4.5:1 | `e2e/chart.spec.ts` | A string ECharts drew into a canvas is invisible to every gate this repository owns |
| The chart heading does not intersect the y-axis label | `e2e/chart.spec.ts` | Geometric. jsdom returns 0×0. |
| The composer is docked to the pane's bottom edge | `e2e/shell-layout.spec.ts` — "rests the omnibox against the bottom edge of pane 3, not against the end of the content" | Geometric |
| A child of the pane body using `flex-1` fills the pane rather than sizing to its content | `e2e/shell-layout.spec.ts` — "gives pane 3 a detail stack that reaches the bottom of the scroll container rather than stopping at its content" | Geometric — and a **separate row because the mutation probe below found it is a separate claim.** Reverting `flex flex-col` on the body leaves the docked-composer case above green: the footer docks off the section's column and never asks anything of the body's. One row would have been one guard doing the work of two. |
| Panes sum to 100 with no console warning | `e2e/pane-dividers.spec.ts` | The percentage path needs a measured width; jsdom measures 0 |
| A pointer at rest over a row changes its background | browser lane | jsdom does not hit-test |
| A primary control paints accent with legible text on it | `e2e/theme.spec.ts` | Painted pixels |
| Density: padding and type across every shell state | vitest, unchanged constants | Reads class tokens; no geometry needed |
| Contrast pairs, all three themes | `design/check-contrast.mjs --self-test --table` | The table is the evidence. "Contrast still passes" is not. |

**Every fix is mutation-probed**: break it, watch the named test go red, restore.
A green suite where the suite cannot observe the behaviour is not evidence.

---

## 13. Assumptions this brief makes

Stated so that silence is not taken as agreement:

1. **The redesign lands before GitHub #65.** Register row D-11 makes #65 the next
   move and D-13 freezes the contract gaps until it runs. Nothing in this brief
   touches the contract, so D-13 stays intact — and #65's author judges the
   contract against a shell whose chart title is not overprinting its own axis.
   Say so if you want #65 first.
2. **Gate 3 arrives with a diff attached.** Showing real painted colour means
   running `generate.mjs` against modified token values on a branch. The values
   are approved after they exist, not before. That is the only honest way to show
   colour.
3. **The five filed defects proceed in parallel** and do not wait on any gate.
   They are correctness, not taste. GitHub #110 through #114.

---

## What is being asked at this gate

Confirm or override, in whatever detail suits:

- **§3**, the editorial-voice rule. The biggest change and the one that most
  changes what the product feels like.
- **§4**, keeping the 11–13px scale. The cheapest decision available and the one
  most likely to be wrong. It is also the easiest to reverse at gate 4.
- **§9**, arrow-key palette navigation as a separate change rather than part of
  this work.
- **§13.1**, redesign before #65.
