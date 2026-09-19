# The design-token source of truth

This directory is the **source** for every colour, radius, shadow, duration and
dimension in LEAPWare-ShellUX.

> **This is wired in, and the blockquote that used to live here is gone because
> every clause of it became false.** It read: "Nothing in `src/` reads any of
> this… the shell still paints ~115 raw `neutral-*` literals across 51 `dark:`
> variants." The measured count today is **0 colour literals and 0 `dark:`
> variants** in non-test `src/`, enforced by `src/__tests__/noRawColor.test.ts`,
> which reports a planted palette class by file and line.
>
> `tailwind.config.js` maps every semantic token, `src/index.css` imports
> `src/styles/tokens.generated.css`, and `scripts/check-tokens.mjs` runs inside
> `npm run verify`.
>
> **What still must not be read into a passing `check-contrast.mjs` run.** It is a
> statement about the pairs the manifest declares, in the three built-in themes,
> as WCAG 2.x ratios and CIEDE2000 distances. It is not an accessibility audit, it
> is not a conformance claim, and it says nothing about whether a token reached a
> pixel — that second gap is what `e2e/theme.spec.ts` covers, because jsdom
> applies no stylesheet and cannot. See **Honest limits**.

---

## Running it

Plain Node. No dependencies, no install step, nothing to add to `package.json`.

```bash
node design/check-contrast.mjs --self-test --table   # validate, with the numbers
node design/check-contrast.mjs                       # validate, quietly
node design/generate.mjs --format=css                # the CSS blocks, to stdout
node design/generate.mjs --format=ts                 # the TS module, to stdout
node design/lib/build-manifest.mjs                   # rewrite the manifest
```

`check-contrast.mjs` exits non-zero on any failure and is the gate. Since GitHub
#111 it also fails as **UNPAINTED** any contrast row whose background nothing in
`src/` paints — the twelve series had been validated on `--surface-sunken` while
nothing painted it — with unbuilt UI exempted by name in `UNBUILT_BACKGROUNDS`.
It is a `verify` stage: `npm run tokens:check` runs `scripts/check-tokens.mjs` and
then `design/check-contrast.mjs --self-test`, and `ci.yml` runs `tokens:check` on
three operating systems, so an UNPAINTED, UNREVIEWED or STALE row fails a pull
request. (Until the change that repaired #111, no script invoked this file.) Everything
else prints to stdout and writes nothing; `generate.mjs` accepts an output path
as a positional argument and **refuses one under `src/`**, because deciding where
a generated artefact lands is the wiring change's job and not this script's.

---

## The files

| File | What it is |
|---|---|
| `tokens/core.tokens.json` | DTCG. The **generative inputs**: the twelve-step lightness/chroma curve per polarity, the status hues, the chart palette, and the whole component tier. Holds no resolved colour. |
| `tokens/themes/leapware-{light,dark,high-contrast}.tokens.json` | DTCG. One theme each, and each is **three numbers plus an optional curve override** — base hue/chroma, accent hue/chroma, contrast multiplier. No theme names a colour. |
| `tokens/semantic.json` | The **public contract**. 67 names in eight groups, each mapped to a ramp *step* rather than to a value. This is the only tier an extension may read. |
| `contrast-manifest.json` | 165 declared **pairs**. Contrast is a relation, not a property of one token, so there is nothing here to annotate a colour with. |
| `check-contrast.mjs` | Resolves all three themes and validates every row. Zero dependencies. **The gate.** |
| `generate.mjs` | Emits the CSS custom-property blocks and the TypeScript contract module. Zero dependencies. |
| `lib/color.mjs` | OKLCH → sRGB, gamut mapping, WCAG 2.x contrast, CIEDE2000. One copy, imported by both scripts. |
| `lib/resolve.mjs` | Token JSON + one theme → resolved colours. Also one copy, also imported by both. |
| `lib/build-manifest.mjs` | How the manifest's 165 rows — including 66 pairwise chart rows — were produced. Not part of any pipeline. |

**`lib/` exists for one reason.** If the generator's OKLCH-to-sRGB conversion and
the checker's ever disagreed, the checker would be measuring a stylesheet nobody
ships and every green run would mean nothing. One module, one conversion, no
drift.

---

## Three tiers

**Primitive** — `gray-1..12`, `accent-1..12`, four status ramps. Generated from
the curve. **Never emitted to CSS.** The plan says primitives are never visible
to extensions, and in the target architecture the injected stylesheet *is* what a
pane document sees, so emitting them would contradict that on the only surface
where it matters. Semantic tokens resolve to literal `oklch(...)` values.

**Semantic** — the 67 names in `semantic.json`. The only tier an extension reads,
and therefore a contract: a name here cannot be removed without a breaking
change.

**Component** — host-only. `--pane-header-h`, `--context-bar-h`, `--row-h-*`,
`--rail-w`, `--drawer-w`, `--radius-*`, `--shadow-*`, `--motion-*`, `--font-*`.

**Padding and font-size are deliberately not tokenised.** The density scan in
`src/components/__tests__/ShellLayout.test.tsx` parses literal padding and
type-size utilities, and `typeSizeOffenders` **passes silently** on an arbitrary
value it cannot parse — so `text-[var(--type-body)]` would sail through
contributing nothing. Padding fails loud; type size fails silent. Keeping both
literal keeps that scan honest byte-for-byte.

**There is deliberately no motion token for pane resize, list scroll or selection
change.** The absence is the enforcement: a duration that does not exist cannot
be referenced.

---

## The generative model

A theme is base colour, accent colour and a contrast multiplier over a shared
lightness/chroma curve, in OKLCH. Resolution order is fixed:

1. Take the curve for the theme's polarity from `core.tokens.json`.
2. Apply the theme's own per-step overrides, if any.
3. Multiply every step's **distance from step 1** by the contrast multiplier.
   Step 1 is the pane background, so it is fixed by construction — a theme cannot
   raise its own contrast by moving the background out from under everything
   else.
4. Clamp lightness, then gamut-map chroma into sRGB at constant lightness and
   hue.

**Steps are ordered by distance from the pane background, not by lightness.**
That is what lets one semantic contract serve both polarities: `--surface-pane`
is step 1 in every theme, and step 1 is white in the light theme and `#171717` in
the dark one. `--surface-app` is step 2 in every theme, which is *lighter* than
the pane in dark and *darker* in light — matching what the shell already does
today (`bg-neutral-50` app over `bg-white` panes; `bg-neutral-900` app over
`bg-neutral-950` panes).

**Chroma is gamut-mapped by binary search on chroma**, not by clipping channels.
Clipping changes hue and lightness, which silently moves a colour away from the
one the token declares. The generator emits the already-mapped value, so the
browser has nothing left to map and what it paints is what the checker measured.

**The chart series are not put through the contrast multiplier.** Darkening a
categorical palette uniformly gains WCAG contrast and loses CIEDE2000 separation
— it trades the harder constraint for the easier one. The series are authored per
polarity and validated pairwise instead.

---

## What was measured

`node design/check-contrast.mjs --self-test --table`. 495 measurements over 165
declared pairs in three themes. **All pass.**

### The headline pairs

| Pair | Required | Light | Dark | High contrast |
|---|---|---|---|---|
| `--border-default` on `--surface-pane` | 3.00 | **3.95** | **4.53** | **6.01** |
| `--border-default` on `--surface-app` | 3.00 | 3.66 | 4.16 | 5.46 |
| `--border-default` on `--surface-sunken` | 3.00 | 3.47 | 3.78 | 5.13 |
| `--text-muted` on `--surface-pane` | 4.50 | **6.41** | **8.82** | **11.03** |
| `--text-muted` on `--surface-subtle` (worst) | 4.50 | 4.67 | 5.03 | 7.44 |
| `--text-primary` on `--surface-pane` | 4.50 | 16.49 | 15.29 | 21.00 |
| `--border-selected` on `--surface-selected` | 3.00 | 5.10 | 5.96 | 8.28 |
| `--control-divider` on `--surface-app` | 3.00 | 5.94 | 8.10 | 10.03 |
| `--focus-ring` on `--focus-ring-offset` | 3.00 | 6.41 | 8.81 | 11.14 |
| `--border-strong` on `--surface-pane` | 4.50 | 9.79 | 11.73 | 16.86 |
| twelve chart series on `--surface-sunken` (worst) | 3.00 | 3.34 | 4.13 | 3.25 |
| 66 pairwise chart separations (worst) | 12.0 ΔE | **16.83** | **16.85** | 16.83 |

### The resolved anchors

| Token | Light | Dark | High contrast |
|---|---|---|---|
| `--surface-pane` | `#ffffff` | `#171717` | `#ffffff` |
| `--surface-app` | `#f6f6f7` | `#1f1f20` | `#f4f4f4` |
| `--surface-sunken` | `#f0f0f1` | `#262728` | `#ededed` |
| `--border-subtle` | `#c9cacd` | `#515255` | `#8f8f8f` |
| `--border-default` | `#7e8085` | `#7d8086` | `#636363` |
| `--text-muted` | `#5c5f64` | `#b2b6be` | `#3c3c3c` |
| `--text-primary` | `#1e1f21` | `#ebedf0` | `#000000` |
| `--focus-ring` | `#0060ad` | `#7cbaff` | `#003c71` |

### The deliberate visual regressions

Both of these make the shell look **heavier** than it does today. They are
corrections, and they are not free.

**`--border-default` is roughly three times heavier than what it replaces.**
`border-neutral-200` on white measures **1.26:1**. WCAG 2.2 1.4.11 asks 3:1 of a
control's visual boundary, which lands at exactly `#949494` on white; the token
resolves to `#7e8085` at **3.95:1**, because it must also clear 3:1 against
`--surface-app` and `--surface-sunken`, not only against the pane. Every pane
edge, the ribbon's bottom edge, the overflow menu's border and every slot divider
get visibly darker. There is no version of this fix that is invisible. The number
is not padded either — reverting step 9 of the curve to a `neutral-200` lightness
reproduces **1.26:1** exactly, which is how the checker was confirmed to bite.

**`--text-muted` goes from `#737373` to `#5c5f64`**, 4.74:1 → 6.41:1 on white.
4.5:1 alone would have permitted roughly `#767676`. The extra weight buys one
specific property: muted text clears 4.5:1 on **all eight** surfaces, including
`--surface-subtle` at 4.67:1, so a muted string dropped onto a selected row or a
badge chip cannot quietly fail. Today's value fails at 4.18:1 on the dark pane —
`ShellLayout.tsx` already patches that one site by hand with
`dark:text-neutral-400`, and this removes the need for the patch.

### Where APCA reasoning changed a value

WCAG 2.x systematically **overstates** contrast near black, so it will happily
certify white-on-black as 21:1 while readers report halation and eye strain. The
checker computes WCAG ratios because that is what a conformance claim is measured
against; two dark-theme values were chosen against APCA reasoning instead, by
hand:

- **The dark pane is `#171717`, not `#000000`.** WCAG would have rewarded pure
  black with a higher number on every single row.
- **Dark `--text-primary` is `#ebedf0`, not `#ffffff`.** 15.29:1 rather than the
  ~18.9:1 pure white would have scored.

Both trade a WCAG number for legibility. Nothing in this directory computes APCA;
these are recorded decisions, not measurements.

### The chart palette

Twelve categorical series, hues **not** evenly spaced and lightness **not**
uniform. Both are load-bearing: twelve hues 30° apart at one lightness measure
barely 9 ΔE2000 in the magenta-to-purple arc and collapse further in the
yellow-green arc, where the gamut mapper has to pull chroma down and so pulls the
hues together in ΔE terms. The twenty-four lightness values were searched, not
chosen — the objective was to maximise the **worst** of the 66 pairwise distances
subject to every series clearing 3.25:1 on the plot well.

Result: worst pair **16.83 ΔE2000** against a declared floor of 12.

**That floor of 12 is a judgement, not a standard.** No WCAG criterion covers
whether two series in one legend can be told apart. It is written into the
manifest and stated as a judgement there too.

**All 66 pairs are checked, not the 11 adjacent ones.** A legend puts series 1
next to series 7.

### The pairs that were hardest

**Tightest absolute margin: `--chart-9` on `--surface-sunken` in the
high-contrast theme, 3.25 against a 3.00 floor.** Eight percent of headroom, and
the first row that will break under any edit to the curve or to the chart
palette. Watch it.

**Tightest proportional margin: `--text-muted` on `--surface-subtle` in the light
theme, 4.67 against 4.50.** Under four percent. This one row is why `--text-muted`
sits at curve step 10, L 0.485, rather than at the ~0.568 that 4.5:1 *on white
alone* would have permitted — the extra weight is bought entirely to keep muted
text legible on the badge chip.

**`--surface-pane` is not what set `--border-default`. `--surface-sunken` is.**
3:1 on white lands at exactly `#949494`, as expected. The token resolves to
`#7e8085` — 3.95:1 on the pane — because the binding constraint is the *lowest*
of the five backgrounds it is measured against, which is `--surface-sunken` at
3.47:1. The hairline is heavier than a white-background calculation predicts, and
the reason is that the manifest measures it against every surface it is actually
drawn on. That is the difference between a token and a colour, and it is the best
single illustration in this directory of why the manifest declares **pairs**.

**Most redesign consumed: the 66-pair chart separation.** Two failures the first
run surfaced and how each was fixed, recorded because both are easy to reintroduce:

- Series 12 was hue 328, in a magenta arc already holding 272, 300 and 348. It
  measured **9.32 ΔE2000** against series 7 — hue is a weak axis there. It moved
  to 225, in the 200-to-252 gap, where the same angular distance buys far more
  perceptual distance.
- `--chart-sequential-from` was accent step 4 and measured **1.05:1** against the
  plot well: a sequential scale whose first two bins nobody can tell from the
  paper. It moved to step 7.

---

## For whoever wires this

One mapping this token set does **not** decide, flagged rather than left to be
made silently. `ShellNavButton`'s selected state carries *two* boundary
affordances: a 1px `aria-[current]:border-neutral-200` outline **and** the 2px
`inset_2px_0_0_0 neutral-500` rule. `--border-selected` is the rule. The outline
has no obvious token — `--border-default` makes the selected row's edge as heavy
as a pane's, `--border-hover` makes it decorative — and the honest answer may be
that the outline should be dropped, since the README's own argument is that the
state is carried by the rule and the weight rather than by a boundary. That is a
design decision, not a lookup.

---

## Honest limits

**1. This validates the three built-in themes, and nothing in `src/` runs it.**
`native-host-pivot.md` §3.6 says a third-party theme is rejected if it fails the
contrast manifest. That is not what this directory delivers. `normalizeTheme.ts`
would have to run this same maths at **runtime, on untrusted input**, and nothing
here makes that possible without shipping the checker into `src/` — a change this
work was scoped out of. Until then, "third-party themes are validated against the
contrast manifest" is a **plan**, not a property. Do not write it in the present
tense anywhere.

**2. Colour-vision deficiency is not modelled.** CIEDE2000 is a normal-vision
metric. A palette with a worst pair of 16.8 ΔE2000 can still contain a pair that
is indistinguishable under deuteranopia or protanopia, and this pipeline would
not notice. That is why `--chart-positive` and `--chart-negative` carry an
explicit instruction never to be the only encoding of sign, and why the same
caution applies to the twelve series. Adding a CVD simulation to
`check-contrast.mjs` is the obvious next increment and is not done.

**3. It measures colour, not rendering.** Anti-aliasing, sub-pixel positioning,
font weight, a translucent ancestor and Windows 11 Mica behind the window chrome
all change what a user sees, and none of them is visible to a resolver reading
JSON. This is the same class of gap as the one the browser test lane exists to
close for geometry — and there is no equivalent lane for colour.

**4. Ratios are computed on 8-bit quantised sRGB.** That is deliberate: it is what
a stylesheet and every third-party contrast checker operate on, so a number here
can be reproduced by hand. A browser compositing at higher precision may differ
in the third decimal place.

**5. `lib/build-manifest.mjs` and `contrast-manifest.json` can drift.** Editing
the builder without re-running it leaves the two out of step and **nothing
detects that.** The manifest is the artefact the checker reads; the builder is
provenance.

**6. Shadows are theme-independent.** `--shadow-overlay` and `--shadow-popover`
are black at fixed alphas in all three themes. A dark theme genuinely needs a
different shadow — black on near-black elevates nothing — and this is not
modelled. It is a known defect, not an oversight.

**7. The high-contrast theme does not reach the chart tier, and its charts are
marginally WORSE than the default theme's.** Measured: worst series contrast is
**3.25:1** in high contrast against **3.34:1** in light. That is not a rounding
artefact, it falls straight out of two decisions that were made separately and
compose badly — the contrast multiplier is deliberately *not* applied to the
twelve series (see "The generative model"), but it *is* applied to
`--surface-sunken`, so the plot well darkens from `#f0f0f1` to `#ededed` while
the series stay exactly where they were. A user who selects High Contrast and
then looks at a chart gets nothing extra and loses 0.09. The fix is a
multiplier-driven per-polarity lightness offset on the series, re-searched
against all 66 pairs so the separation floor survives it. **It is not done.**
Same family as item 6: a tier the theme system does not actually reach.

**8. `--surface-sunken` is not literally sunken in the dark theme.** It is one
step of separation from the pane in whichever direction the theme separates,
which means it is *lighter* than the pane in dark. The honest name would be
`--surface-inset`; it is called sunken because that is what the plan calls it.
All twelve chart series are validated against it and against nothing else.

**9. The eighth group is new.** The plan names seven groups; `controls` is an
eighth, holding `--control-divider` and `--control-divider-hover`. The pane
divider is a filled 4px bar with hover and drag states, not a border, and folding
it into `--border-strong` would have made one token answer to two different
measurements. Two tokens from the plan's sketch were **dropped** rather than
kept with a caveat: `--surface-disabled`, because disabled is `opacity-40` on the
whole control everywhere in `src/` and no surface is filled; and
`--surface-active`, because the only pressed state in the shell is the divider's
drag, which `--control-divider-hover` now owns.

**10. A passing run is not an audit.** It says the declared pairs clear the
declared numbers in three themes. It says nothing about focus order, about
whether a colour is the *only* encoding of some state, or about any of the WCAG
2.2 AA criteria that are not about contrast. The shell's own README is careful
about this and this file is too.

---

## Portability

Everything here is plain Node with no dependencies, LF line endings, no BOM, no
absolute path, no drive letter and no login name — `npm run check:portability`
scans these files once they are tracked. `generate.mjs` and `check-contrast.mjs`
run on the Node floor declared in `package.json` and need no network access.
