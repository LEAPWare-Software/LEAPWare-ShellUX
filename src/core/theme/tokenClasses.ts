/**
 * ============================================================================
 * ONE NAME PER PAINTED ROLE, AND THE TAILWIND UTILITY THAT CARRIES IT.
 * ============================================================================
 * Before this file, the shell spelled its colours 118 times across seven
 * modules, and the tests that pinned them spelled the same strings again. A
 * token rename was a twenty-file edit, so it never happened, so the colours
 * drifted into whatever the nearest `neutral-*` step was.
 *
 * Every entry below is a COMPLETE Tailwind class, variant prefix included, and
 * that is not a style choice. Tailwind's content scanner is a regular expression
 * over raw file text: it can see `hover:border-border-subtle` written here, and
 * it cannot see `hover:${TOKEN_CLASS.controlBorder}` assembled at runtime. A
 * value spliced together from parts would compile to nothing at all and fail
 * silently in the browser while every jsdom assertion stayed green. So the
 * variant lives in the value, this module is inside `content`'s glob, and the
 * class exists in the stylesheet because the string exists in this file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS WEAKENS. STATED PLAINLY, BECAUSE IT IS A REAL LOSS.
 * ---------------------------------------------------------------------------
 * `ShellLayout.test.tsx` used to assert `toHaveClass('border-neutral-200')`
 * against a literal the component also spelled literally. Two independent
 * spellings of one intent: change the component and the test failed.
 *
 * It now asserts `toHaveClass(TOKEN_CLASS.paneBorder)` against a constant the
 * component imports. **That assertion can no longer catch a component pointed at
 * the wrong token.** Repoint `paneBorder` at `--status-danger` and every one of
 * those tests still passes, because both sides moved together. The test proves
 * the component uses the shell's border role; it does not prove the role is the
 * right colour, and it never again will.
 *
 * Two things are the compensation, and neither is optional:
 *
 *  1. `scripts/check-tokens.mjs` proves the VALUES. It reads the generated CSS
 *     and re-measures every declared pair in `design/contrast-manifest.json`
 *     with `design/lib/`'s own maths, in all three themes. A token whose value
 *     stops clearing AA fails there, where nothing in `src/` could see it.
 *  2. `e2e/theme.spec.ts` proves the COMPILED STYLESHEET applies them. jsdom
 *     loads no CSS, resolves no custom property and computes no used value, so a
 *     green vitest run says nothing whatsoever about whether a colour rendered.
 *     That is precisely the gap `ShellLayout.test.tsx`'s own banner admits it
 *     cannot close, and the browser lane is the only place it closes.
 *
 * The third leg — "is `--border-default` pointed at the right *pane*" — is the
 * one nobody automates. It is a design review.
 *
 * ---------------------------------------------------------------------------
 * WHY SOME ROLES SHARE A TOKEN, AND WHY THAT IS NOT REDUNDANCY
 * ---------------------------------------------------------------------------
 * `paneBorder`, `paneSlotEdge`, `ribbonBorder`, `menuBorder` and `chipBorder`
 * are all `border-border-default` today. They are five names because they are
 * five decisions: `design/README.md` measures `--border-default` against every
 * surface a pane edge is drawn on, and if the overflow menu ever moves to
 * `--surface-overlay`-on-scrim it needs its own row in the contrast manifest and
 * its own answer here. Collapsing them now would make that a find-and-replace
 * over unrelated call sites later.
 * ============================================================================
 */

/**
 * The painted roles of the shell, each as the exact class that carries it.
 *
 * Keys are roles, not token names. A role is what the shell is trying to say;
 * a token is what says it. That indirection is the whole point of the file —
 * `navSelectedRule` stays `navSelectedRule` when `--border-selected` is
 * re-derived, and the diff is one line here.
 */
export const TOKEN_CLASS = {
  // ---------------------------------------------------------------------
  // The application background, behind and between the panes.
  // ---------------------------------------------------------------------
  appSurface: 'bg-surface-app',
  appText: 'text-text-primary',

  // ---------------------------------------------------------------------
  // The pane box. `paneBorder` is THE deliberate visible regression this
  // change lands: `border-neutral-200` measured 1.26:1 on white and
  // `--border-default` measures 3.95:1, which is roughly three times the
  // weight. It is a WCAG 1.4.11 correction, it is not invisible, and
  // CHANGELOG.md says so before anybody files it as a bug.
  //
  // `paneSlotEdge` is `--border-default` rather than `--border-subtle` on
  // `design/README.md`'s explicit authority: it names "every pane edge, the
  // ribbon's bottom edge, the overflow menu's border and every slot divider"
  // as the surfaces that get visibly darker.
  // ---------------------------------------------------------------------
  paneSurface: 'bg-surface-pane',
  paneBorder: 'border-border-default',
  paneText: 'text-text-primary',
  paneSlotEdge: 'border-border-default',

  // ---------------------------------------------------------------------
  // Text tiers. `mutedText` replaces `text-neutral-500` AND the
  // `dark:text-neutral-400` patch beside it. That patch existed because
  // `#737373` measured 4.18:1 on the dark pane — under 4.5:1 — and had to be
  // lightened by hand in one theme only. `--text-muted` resolves per theme
  // and clears 4.5:1 on all eight surfaces in all three themes, so the patch
  // has nothing left to fix and the variant is gone rather than retested.
  // ---------------------------------------------------------------------
  mutedText: 'text-text-muted',
  secondaryText: 'text-text-secondary',

  // ---------------------------------------------------------------------
  // The ribbon. `--surface-raised` rather than `--surface-app`: they resolve
  // to the same value in every built-in theme today, and they are separate
  // decisions — a theme that lifts chrome off the page background changes one
  // and not the other.
  // ---------------------------------------------------------------------
  ribbonSurface: 'bg-surface-raised',
  ribbonBorder: 'border-border-default',
  ribbonText: 'text-text-primary',

  // ---------------------------------------------------------------------
  // The portalled overflow menu. `menuElevation` is `--shadow-popover`,
  // replacing Tailwind's `shadow-md`. Known limit, recorded in
  // `design/README.md` "Honest limits" item 6: the shadow tokens are black at
  // fixed alphas in every theme, so this elevates nothing on a near-black
  // pane. It is not patched with a `dark:` variant here — that would be a
  // colour outside the pipeline, which is the thing this change exists to
  // stop. The fix belongs in `design/`.
  // ---------------------------------------------------------------------
  menuSurface: 'bg-surface-overlay',
  menuBorder: 'border-border-default',
  menuText: 'text-text-primary',
  menuElevation: 'shadow-popover',

  // ---------------------------------------------------------------------
  // Interactive outlines on buttons that are transparent at rest.
  //
  // `--border-subtle` and not `--border-hover`, which would be the obvious
  // read of the name. These outlines are decorative: they hint that a thing is
  // hoverable, and no state depends on being able to see them. R2's response
  // says the subtle tier is what keeps weight off purely decorative rules, and
  // `--border-hover` at `#a6a8ab` would make a hover heavier than a pane edge
  // was before this change. `--border-hover` is therefore left unconsumed, on
  // purpose; it is a contract name, not an obligation.
  // ---------------------------------------------------------------------
  controlRestBorder: 'border-transparent',
  controlHoverBorder: 'hover:border-border-subtle',
  controlFocusBorder: 'focus:border-border-subtle',

  // ---------------------------------------------------------------------
  // Selected navigation row. Three affordances, and only two of them carry
  // the state: the fill is a hint, and the RULE plus the semibold weight are
  // what a low-vision user actually reads. `design/README.md`'s "For whoever
  // wires this" flags exactly this split and declines to decide the outline;
  // it is answered here as the decorative tier, with the rule owning
  // `--border-selected` as that section instructs.
  //
  // The rule is written as an arbitrary shadow against `var(--border-selected)`
  // rather than `theme(colors.border-selected)`. `theme()` resolves at BUILD
  // time to the literal string `var(--border-selected)` anyway, so the two
  // compile identically — but the `theme()` spelling is what let a raw
  // `theme(colors.neutral.400)` hide from every colour scan in this repository
  // until now, and `noRawColor.test.ts` forbids the spelling for that reason.
  //
  // `aria-[current=true]` and not the bare `aria-[current]`, which matches
  // the attribute's PRESENCE and so paints `aria-current="false"` as current.
  // `ShellNavigation.tsx` writes `'true'` or omits the attribute.
  // ---------------------------------------------------------------------
  navSelectedBorder: 'aria-[current=true]:border-border-subtle',
  navSelectedSurface: 'aria-[current=true]:bg-surface-selected',
  navSelectedRule: 'aria-[current=true]:shadow-[inset_2px_0_0_0_var(--border-selected)]',

  // ---------------------------------------------------------------------
  // Selected virtualized row. Same two-channel argument, different ARIA
  // attribute, because a `listbox` option carries `aria-selected` and a
  // navigation button carries `aria-current`.
  // ---------------------------------------------------------------------
  rowSelectedSurface: 'aria-selected:bg-surface-selected',
  rowSelectedRule: 'aria-selected:shadow-[inset_2px_0_0_0_var(--border-selected)]',

  /** The count chip on a navigation row. */
  badgeSurface: 'bg-surface-subtle',

  // ---------------------------------------------------------------------
  // The pane-2 row delta. `--chart-positive` and `--chart-negative` rather
  // than `--status-success` and `--status-danger`, and the two pairs are not
  // interchangeable: a status colour answers "is this thing broken?", and a
  // rise in stock is neither good nor bad — it is a DIRECTION on a chart, and
  // the chart ramp is the tier `design/contrast-manifest.json` measures
  // against a plot background. This is the first consumer of either name.
  //
  // Colour is the WEAKEST of the three channels `RowMetric` gives a delta;
  // the arrow and the `sr-only` word carry it without help. See that file's
  // banner for why all three exist.
  // ---------------------------------------------------------------------
  deltaPositive: 'text-chart-positive',
  deltaNegative: 'text-chart-negative',
  deltaFlat: 'text-text-muted',

  // ---------------------------------------------------------------------
  // The pane divider, which is a filled 4px control and not a border. It has
  // its own token group for that reason — `design/README.md` "Honest limits"
  // item 9 records `controls` as an eighth group added precisely so that one
  // token would not have to answer to two different measurements.
  //
  // Idle and active are `--control-divider` and `--control-divider-hover`, and
  // the direction of travel is baked into the tokens: each theme moves the
  // active state AWAY from its own page background, so this file does not have
  // to know which way is darker.
  // ---------------------------------------------------------------------
  dividerIdle: 'bg-control-divider',
  dividerHover: 'hover:bg-control-divider-hover',
  dividerFocus: 'focus-visible:bg-control-divider-hover',
  dividerDrag: 'data-[resize-handle-state=drag]:bg-control-divider-hover',

  // ---------------------------------------------------------------------
  // The fault surface. Its border is `--border-default` and not
  // `--border-subtle`: an alert box's boundary is a control boundary, which is
  // the 3:1 that WCAG 1.4.11 asks for, and `border-neutral-400` at 2.52:1 on
  // white was failing it. The row variant renders inside a `role="option"`
  // and gets `--text-secondary`, which is the closest tier to the
  // `text-neutral-700` it replaces.
  // ---------------------------------------------------------------------
  faultSurface: 'bg-surface-raised',
  faultBorder: 'border-border-default',
  faultText: 'text-text-primary',
  faultRowText: 'text-text-secondary',
  faultButtonBorder: 'border-border-default',
  faultButtonHover: 'hover:bg-surface-hover',
  faultButtonFocus: 'focus-visible:bg-surface-hover',

  // ---------------------------------------------------------------------
  // Surfaces inside a pane body, used by both verification remotes.
  // `chipBorder` bounds a control; `sectionEdge` is in-pane separation, which
  // §3.7 puts on the subtle tier — "borders separate, shadows elevate", and a
  // rule between two paragraphs is not a control boundary.
  // ---------------------------------------------------------------------
  chipBorder: 'border-border-default',
  sectionEdge: 'border-border-subtle',

  // ---------------------------------------------------------------------
  // The list's focus ring. `ring-focus-ring` is redundant with the
  // `ringColor.DEFAULT` this change repoints in `tailwind.config.js`, and it is
  // written out anyway: a default is a colour that reaches the stylesheet
  // without appearing in any file a scan over `src/` can read, which is exactly
  // how Tailwind's stock `blue-500` ring survived here unnoticed.
  // ---------------------------------------------------------------------
  listFocusRing: 'focus-visible:ring-1 focus-visible:ring-focus-ring',

  // =====================================================================
  // WAVE 3. `docs/design/WAVE3-PLAN.md` makes W3-1 the only increment that
  // edits this file, so every role W3-1 to W3-8 names is declared here at
  // once. The roles under W3-2 to W3-8 have NO consumer until their
  // increment lands; each is the plan's reading of the v4 screens, and the
  // consuming increment's review may still find one wrong. A change it needs
  // lands here as its own serialised edit, never in parallel.
  // =====================================================================

  // ---------------------------------------------------------------------
  // W3-1. The one focus mechanism: the two-tone ring, on `:focus-visible`
  // only, so a mouse click paints nothing and a Tab paints the ring. Written
  // with the width tokens in arbitrary-value form so the ring measures what
  // `--focus-ring-width` and `--focus-ring-offset-width` say rather than
  // Tailwind's own `ring-2`. The offset is painted in `--focus-ring-offset`,
  // which is the surface colour, and that is the second tone.
  // *Tests:* `e2e/focus-visibility.spec.ts` — "paints no ring on a mouse
  // click and the two-tone ring on a Tab, in the light theme", and the same
  // case in dark and high contrast.
  // ---------------------------------------------------------------------
  controlFocusRing:
    'outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-focus-ring ' +
    'focus-visible:ring-offset-[length:var(--focus-ring-offset-width)] focus-visible:ring-offset-focus-ring-offset',

  // ---------------------------------------------------------------------
  // W3-1. Buttons. Hover is one surface step, pressed is one more (DESIGN.md
  // §5 Buttons). `enabled:` gates both, so a disabled button neither hovers
  // nor presses. The primary ramp has no step darker than
  // `--accent-solid-hover`, so the v4 canvas draws primary-pressed as that
  // fill plus a 1px inset `--accent-border` rule; that rule, not the fill, is
  // what separates pressed from hover on a primary button.
  // ---------------------------------------------------------------------
  buttonPrimaryRest: 'border-transparent bg-accent-solid text-text-on-accent',
  buttonPrimaryHover: 'enabled:hover:bg-accent-solid-hover',
  buttonPrimaryPressed:
    'enabled:active:bg-accent-solid-hover enabled:active:shadow-[inset_0_0_0_1px_var(--accent-border)]',
  buttonQuietRest: 'border-border-default bg-surface-pane text-text-primary',
  buttonQuietHover: 'enabled:hover:bg-surface-hover',
  buttonQuietPressed: 'enabled:active:bg-surface-selected',
  /** Disabled ink and a subtle rule on the hover-grey fill. Never opacity. */
  buttonDisabled: 'disabled:border-border-subtle disabled:bg-surface-hover disabled:text-text-disabled',
  /** The in-place loading bar. On a petrol fill it is the label's own ink. */
  buttonLoadingBarPrimary: 'bg-text-on-accent',
  buttonLoadingBarQuiet: 'bg-accent-solid',

  // ---------------------------------------------------------------------
  // W3-1 (banners), W3-2 (row status lines), W3-5 (field error), W3-6
  // (inline failure), W3-8 (crash mark). One status vocabulary, three
  // layers: the WASH a banner or failure sits on, the MARK (an icon or a
  // dot, `--status-*`, 3:1 non-text), and the INK its words are set in
  // (`--text-*`, 4.5:1 on its own wash and on the pane, both pairs declared
  // in `design/contrast-manifest.json`).
  //
  // There is no `--text-info`. The v4 canvas sets the info banner's first
  // line in `--status-info`, and that pair is declared at 3:1 only, so the
  // info first line is `--text-primary` here and the dot carries the status.
  // A `--text-info` token is a design/ change, not a class.
  // ---------------------------------------------------------------------
  statusDangerWash: 'bg-status-danger-subtle',
  statusWarningWash: 'bg-status-warning-subtle',
  statusSuccessWash: 'bg-status-success-subtle',
  statusInfoWash: 'bg-status-info-subtle',
  statusDangerMark: 'text-status-danger',
  statusWarningMark: 'text-status-warning',
  statusSuccessMark: 'text-status-success',
  statusInfoMark: 'text-status-info',
  statusDangerText: 'text-text-danger',
  statusWarningText: 'text-text-warning',
  statusSuccessText: 'text-text-success',
  statusInfoText: 'text-text-primary',

  // ---------------------------------------------------------------------
  // W3-2. List rows at 32px. Hover grey on pointer rest, and the keyboard
  // ring drawn INSIDE the row edge (`ring-inset`) so the list's clip cannot
  // cut it. Dimension roles use the utility form: the layout tokens are not
  // in the colour contract, so a `var()` spelling would fail `theme.test.ts`.
  // ---------------------------------------------------------------------
  rowHeightComfortable: 'h-row-comfortable',
  rowHoverSurface: 'hover:bg-surface-hover',
  rowFocusRingInset:
    'outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-inset focus-visible:ring-focus-ring',

  // ---------------------------------------------------------------------
  // W3-3. The navigation tree and the 48px rail. The current node is primary
  // ink on the petrol wash; children hang off a 1px subtle guide rule. The
  // fallback identity tile (R4) is petrol ink on the petrol wash, the one
  // accent pair W3-3's token list names.
  // ---------------------------------------------------------------------
  railWidth: 'w-rail',
  navCurrentSurface: 'aria-[current=true]:bg-accent-subtle',
  navCurrentText: 'aria-[current=true]:text-text-primary',
  navGuideRule: 'border-border-subtle',
  identityTileSurface: 'bg-accent-subtle',
  identityTileText: 'text-accent-text',
  tooltipSurface: 'bg-surface-overlay',
  tooltipElevation: 'shadow-popover',

  // ---------------------------------------------------------------------
  // W3-4. Pane headers, 28px on the chrome plane. The focused region's 2px
  // petrol rule is driven by `:focus-within` on the pane (a `group`), with
  // no key handling at all.
  // ---------------------------------------------------------------------
  paneHeaderHeight: 'h-pane-header',
  paneHeaderSurface: 'bg-surface-raised',
  paneFocusRule: 'group-focus-within:shadow-[inset_0_-2px_0_0_var(--accent-border)]',

  // ---------------------------------------------------------------------
  // W3-5. Tables, fields and the switch. The error field is a danger rule
  // plus danger ink; the switch's on-track is petrol with a pane-coloured
  // thumb, off is the default rule's grey, disabled is the sunken plane.
  // ---------------------------------------------------------------------
  tableHeaderText: 'text-text-muted',
  tableRule: 'border-border-subtle',
  fieldSurface: 'bg-surface-pane',
  fieldBorder: 'border-border-default',
  fieldErrorBorder: 'border-status-danger',
  switchTrackOff: 'bg-border-default',
  switchTrackOn: 'aria-checked:bg-accent-solid',
  switchTrackDisabled: 'disabled:bg-surface-sunken',
  switchThumb: 'bg-surface-pane',

  // ---------------------------------------------------------------------
  // W3-6. The palette and the context bar. The active row is the petrol
  // wash. There is no scrim token, so the dimming scrim R3 asks for has no
  // role here: that is a design/ change first.
  // ---------------------------------------------------------------------
  contextBarHeight: 'h-context-bar',
  paletteSurface: 'bg-surface-overlay',
  paletteElevation: 'shadow-overlay',
  paletteActiveRow: 'aria-selected:bg-accent-subtle',

  // ---------------------------------------------------------------------
  // W3-8. Skeleton rows and the in-place loading bar of a pane.
  // ---------------------------------------------------------------------
  skeletonSurface: 'bg-surface-subtle',
  paneLoadingBar: 'bg-accent-solid',
} as const;

/** A role name. Exported so a consumer can key off the record type-safely. */
export type TokenClassRole = keyof typeof TOKEN_CLASS;
