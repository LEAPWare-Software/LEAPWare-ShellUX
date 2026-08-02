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
  // ---------------------------------------------------------------------
  navSelectedBorder: 'aria-[current]:border-border-subtle',
  navSelectedSurface: 'aria-[current]:bg-surface-selected',
  navSelectedRule: 'aria-[current]:shadow-[inset_2px_0_0_0_var(--border-selected)]',

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
} as const;

/** A role name. Exported so a consumer can key off the record type-safely. */
export type TokenClassRole = keyof typeof TOKEN_CLASS;
