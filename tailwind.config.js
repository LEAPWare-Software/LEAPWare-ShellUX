/**
 * ============================================================================
 * THE SEMANTIC TOKEN SET, AS TAILWIND UTILITIES.
 * ============================================================================
 * Every colour below is `var(--token)` and nothing else. The values live in
 * `src/styles/tokens.generated.css`, which `design/generate.mjs` emits and
 * `design/check-contrast.mjs` validates; this file only decides what a class
 * called `bg-surface-pane` resolves to. A colour literal does not appear here
 * and must not appear anywhere under `src/` — that is asserted by
 * `src/__tests__/noRawColor.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHY `var(--x)` AND NOT THE `<alpha-value>` CHANNEL FORM — MEASURED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 * The pivot plan's risk R5 proposed storing colour *components* (`--surface-pane:
 * 1 0 0`) with `oklch(var(--surface-pane) / <alpha-value>)` here, so that
 * Tailwind's opacity modifiers keep working. Both halves were compiled against
 * the pinned Tailwind (3.4.19) before this file was written:
 *
 *  - The channel form DOES work. `oklch(var(--x) / <alpha-value>)` emits
 *    `oklch(var(--x) / var(--tw-bg-opacity, 1))` for `bg-x` and
 *    `oklch(var(--x) / 0.5)` for `bg-x/50`. R5 is answered: the shape is sound.
 *  - It is nonetheless unusable HERE, because `design/generate.mjs` emits
 *    COMPLETE colour functions — `--surface-pane: oklch(100% 0 264)` — not the
 *    bare components the channel form needs. Substituting one into the other
 *    yields `oklch(oklch(100% 0 264) / 1)`, which is invalid at computed-value
 *    time. `design/` is committed, validated and out of scope to edit, so the
 *    generator's output is the constraint and this is the shape that fits it.
 *
 * The documented fallback was therefore taken, and it costs what the plan said
 * it would cost: opacity modifiers are unavailable on token colours. The shell
 * uses none today — a scan for `-<n>00/<n>` and `bg-black/<n>` over non-test
 * `src/` found zero — so nothing regressed.
 *
 * The failure mode if somebody writes one is SILENT, which is why it is linted.
 * Measured on the same probe: `bg-plain/50` against a bare-`var()` colour emits
 * NO RULE AT ALL — not a wrong colour, not a warning, just an absent declaration
 * and an element that keeps whatever it inherited. `noRawColor.test.ts` fails on
 * an opacity modifier applied to a token colour for that reason, with a planted
 * control, because nothing else in the toolchain would notice.
 *
 * Relative colour syntax — `oklch(from var(--x) l c h / <alpha-value>)` — also
 * compiles and WOULD restore the modifiers. It is deliberately not used: it buys
 * back a feature with no consumer at the cost of a Chromium version floor.
 *
 * ---------------------------------------------------------------------------
 * `darkMode`, AND WHY IT IS CONFIGURED WHILE NOTHING USES IT
 * ---------------------------------------------------------------------------
 * `['selector', '[data-theme="dark"]']` is the two-argument custom-selector form
 * Tailwind 3.4.1 added. Confirmed on 3.4.19 rather than assumed: it emits
 * `.dark\:x:where([data-theme="dark"], [data-theme="dark"] *)`.
 *
 * A data attribute rather than a class, because §3.6 of the pivot plan injects
 * the resolved token set into each pane document and an attribute composes with
 * that, and because it matches the selectors `tokens.generated.css` carries.
 *
 * There are zero `dark:` variants under `src/`, and that is the point. All 51
 * were deleted rather than made testable: when a colour is a token whose VALUE
 * swaps on `[data-theme]`, `dark:border-neutral-800` has nothing left to say.
 * The configuration stays because Phase 7 needs it for the genuinely
 * appearance-conditional cases, and because deleting it would make re-adding one
 * a config change rather than a class. The known future member is the shadow
 * tier — `design/README.md` "Honest limits" item 6 records that
 * `--shadow-overlay` and `--shadow-popover` are black at fixed alphas in every
 * theme, which elevates nothing on a near-black pane — and it is deliberately
 * NOT fixed here with a hand-written `dark:shadow-[…]`, because that would put a
 * colour outside the pipeline, where `scripts/check-tokens.mjs` cannot measure it.
 *
 * One asymmetry, recorded rather than papered over: `tokens.generated.css`
 * matches `[data-theme='leapware-dark']` AND `[data-theme='dark']`, while the
 * `dark:` variant above matches only the latter. Harmless while the count is
 * zero; whoever adds the first `dark:` utility owns reconciling it.
 * ============================================================================
 */

/** @type {import('tailwindcss').Config} */
export default {
  // Tests are excluded, and that is a fix rather than a tidy-up. Tailwind's
  // scanner is a regular expression over raw text with no idea what a file is
  // for, so every planted-violation fixture in `src/__tests__/noRawColor.test.ts`
  // and every control string in the density scan was compiling into the SHIPPED
  // stylesheet: `e2e/theme.spec.ts` found seven `.dark\:` rules in the built CSS
  // after the last `dark:` utility had been deleted from the shell, all of them
  // generated from strings written to prove those utilities are forbidden.
  //
  // A component cannot depend on a class only a test spells — the test asserts
  // against what the component renders, never the reverse — so nothing real is
  // lost, and the stylesheet stops carrying rules for classes that exist only to
  // be rejected.
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '!./src/**/__tests__/**',
    '!./src/**/*.{test,spec}.{ts,tsx}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // -----------------------------------------------------------------
      // Semantic colour. 65 names, 1:1 with `SEMANTIC_TOKEN_NAME_LIST` in
      // `src/core/theme/tokens.generated.ts` minus the two members that are
      // lengths rather than colours (`--focus-ring-width`,
      // `--focus-ring-offset-width`). The parity is asserted in both
      // directions by `scripts/check-tokens.mjs`, so a token added to the
      // contract without a utility fails, and a utility naming a dead token
      // fails too.
      //
      // The key is the token name minus its leading dashes, deliberately and
      // without abbreviation. `text-text-muted` reads redundantly; it is worth
      // it, because the class name and the custom property are then the same
      // string and every grep, rename and manifest row lines up.
      // -----------------------------------------------------------------
      colors: {
        'surface-app': 'var(--surface-app)',
        'surface-pane': 'var(--surface-pane)',
        'surface-raised': 'var(--surface-raised)',
        'surface-overlay': 'var(--surface-overlay)',
        'surface-sunken': 'var(--surface-sunken)',
        'surface-hover': 'var(--surface-hover)',
        'surface-selected': 'var(--surface-selected)',
        'surface-subtle': 'var(--surface-subtle)',

        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'text-on-accent': 'var(--text-on-accent)',
        'text-disabled': 'var(--text-disabled)',
        'text-link': 'var(--text-link)',
        'text-danger': 'var(--text-danger)',
        'text-warning': 'var(--text-warning)',
        'text-success': 'var(--text-success)',

        'border-subtle': 'var(--border-subtle)',
        'border-hover': 'var(--border-hover)',
        'border-default': 'var(--border-default)',
        'border-selected': 'var(--border-selected)',
        'border-strong': 'var(--border-strong)',
        'border-focus': 'var(--border-focus)',

        'control-divider': 'var(--control-divider)',
        'control-divider-hover': 'var(--control-divider-hover)',

        'focus-ring': 'var(--focus-ring)',
        'focus-ring-offset': 'var(--focus-ring-offset)',

        'accent-subtle': 'var(--accent-subtle)',
        'accent-border': 'var(--accent-border)',
        'accent-solid': 'var(--accent-solid)',
        'accent-solid-hover': 'var(--accent-solid-hover)',
        'accent-text': 'var(--accent-text)',

        'status-danger': 'var(--status-danger)',
        'status-warning': 'var(--status-warning)',
        'status-success': 'var(--status-success)',
        'status-info': 'var(--status-info)',
        'status-danger-subtle': 'var(--status-danger-subtle)',
        'status-warning-subtle': 'var(--status-warning-subtle)',
        'status-success-subtle': 'var(--status-success-subtle)',
        'status-info-subtle': 'var(--status-info-subtle)',

        'chart-1': 'var(--chart-1)',
        'chart-2': 'var(--chart-2)',
        'chart-3': 'var(--chart-3)',
        'chart-4': 'var(--chart-4)',
        'chart-5': 'var(--chart-5)',
        'chart-6': 'var(--chart-6)',
        'chart-7': 'var(--chart-7)',
        'chart-8': 'var(--chart-8)',
        'chart-9': 'var(--chart-9)',
        'chart-10': 'var(--chart-10)',
        'chart-11': 'var(--chart-11)',
        'chart-12': 'var(--chart-12)',
        'chart-grid': 'var(--chart-grid)',
        'chart-axis': 'var(--chart-axis)',
        'chart-label': 'var(--chart-label)',
        'chart-tooltip-bg': 'var(--chart-tooltip-bg)',
        'chart-tooltip-text': 'var(--chart-tooltip-text)',
        'chart-crosshair': 'var(--chart-crosshair)',
        'chart-sequential-from': 'var(--chart-sequential-from)',
        'chart-sequential-to': 'var(--chart-sequential-to)',
        'chart-diverging-low': 'var(--chart-diverging-low)',
        'chart-diverging-mid': 'var(--chart-diverging-mid)',
        'chart-diverging-high': 'var(--chart-diverging-high)',
        'chart-positive': 'var(--chart-positive)',
        'chart-negative': 'var(--chart-negative)',
      },

      // A bare `border` with no colour utility beside it resolves to
      // `borderColor.DEFAULT`, which Tailwind ships as `colors.gray.200` — a
      // raw palette literal reaching the stylesheet through a default rather
      // than through a class, where no scan over `src/` could ever see it.
      // Repointed at the token for the same reason `ringColor.DEFAULT` is.
      borderColor: { DEFAULT: 'var(--border-default)' },
      // `focus-visible:ring-1` in `VirtualizedList` carried Tailwind's default
      // ring colour, which is `blue-500`. Same class of invisible literal.
      ringColor: { DEFAULT: 'var(--focus-ring)' },
      ringOffsetColor: { DEFAULT: 'var(--focus-ring-offset)' },
      outlineColor: { DEFAULT: 'var(--focus-ring)' },

      // Radius, shadow and motion are tokenised; padding and font-size are
      // deliberately NOT — see the density-scan argument in
      // `src/components/__tests__/ShellLayout.test.tsx` and `design/README.md`.
      //
      // `sm` is REDEFINED rather than added: `rounded-sm` is used at eleven
      // sites and Tailwind's default is `0.125rem`, which is 2px, which is
      // exactly what `--radius-sm` resolves to. The emitted declaration changes
      // from a length to a `var()`; the painted pixel does not.
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
        popover: 'var(--shadow-popover)',
      },
      transitionDuration: {
        micro: 'var(--motion-micro)',
        base: 'var(--motion-base)',
      },
      transitionTimingFunction: {
        shell: 'var(--motion-ease)',
      },

      // The component dimension tier. Declared here because the tokens exist
      // and this is where a utility for them belongs; NOT yet consumed, because
      // the rail, the context bar and the row-height switch are Phase 4 and
      // Phase 7 surfaces that do not exist. The two dimensions the shell does
      // use today — the 160px drawer and the 32px collapsed navigation square —
      // are deliberately left as `w-40` and `h-8`: they are the unique state
      // markers the density scan uses to prove it reached every rendered state,
      // and swapping them would edit that scan for no gain.
      height: {
        'pane-header': 'var(--pane-header-h)',
        'context-bar': 'var(--context-bar-h)',
        'row-compact': 'var(--row-h-compact)',
        'row-default': 'var(--row-h-default)',
        'row-comfortable': 'var(--row-h-comfortable)',
      },
      width: {
        rail: 'var(--rail-w)',
        drawer: 'var(--drawer-w)',
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },
    },
  },
  plugins: [],
};
