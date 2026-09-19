import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openShell } from './shell';

/**
 * ============================================================================
 * THE TOKENS REACH THE DOM. THIS IS THE ONLY LANE THAT CAN SAY SO.
 * ============================================================================
 * `src/components/__tests__/ShellLayout.test.tsx` says, in its own banner, that
 * "a token can be present while the compiled stylesheet says something else, and
 * these would not notice", and that closing it "is not runnable from vitest".
 * This file is that closure.
 *
 * The gap widened when the colours became tokens, and honestly so. A jsdom
 * assertion used to compare a literal in the component against a literal in the
 * test; it now compares `TOKEN_CLASS.paneBorder` against itself, because the
 * component imports the same constant. `src/core/theme/tokenClasses.ts` states
 * that loss plainly and names two compensations, and this is the second of them:
 *
 *   token JSON → `design/generate.mjs` → `tokens.generated.css` → `@import` in
 *   `index.css` → Tailwind's `var(--x)` colour map → the compiled stylesheet →
 *   **the colour a browser actually paints on the element**
 *
 * Every arrow before the last one is checked by `scripts/check-tokens.mjs`. Only
 * a real engine can check the last one, and until this file existed nothing did:
 * a `content` glob that stopped matching `tokenClasses.ts`, an `@import` Vite
 * failed to inline, a `darkMode` selector that never matched — each of those
 * leaves the entire vitest suite green and the shell unpainted.
 *
 * ---------------------------------------------------------------------------
 * WHY NOTHING HERE STRING-MATCHES A COLOUR
 * ---------------------------------------------------------------------------
 * `getComputedStyle` serialises a colour the engine's way, not the stylesheet's,
 * and a property declared in `oklch()` does not necessarily come back as
 * `rgb(23, 23, 23)`. Asserting on the string would make this file a test of
 * Chromium's serialiser, and it would break on an engine that returned
 * `color(srgb …)` or kept the `oklch()` form. So every colour is resolved to an
 * 8-bit triple in the page, by painting it onto a scratch canvas, and compared
 * numerically.
 *
 * **The expected values are read from the shipped stylesheet, not typed here.**
 * `tokens.generated.css` annotates every colour with the hex the generator
 * resolved, and `check-tokens.mjs` holds that annotation to within one 8-bit
 * step of the `oklch()` beside it. Re-typing the anchors into this file would
 * make it a third copy of the contract with its own way of going stale.
 *
 * **Two 8-bit steps of tolerance**, for two compounding reasons that are both
 * quantisation and neither of which is a real difference: the annotation is the
 * full-precision colour while the declaration is the same colour with its OKLCH
 * rounded for printing, and the browser converts OKLCH to sRGB in its own
 * pipeline. Two steps is far tighter than any wrong-token error — the nearest
 * distinct tokens in this set are dozens of steps apart — and loose enough that
 * this suite does not fail on a Chromium point release.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * It proves the declared colours are the painted colours, and that the painted
 * pair clears its WCAG ratio, in three forced themes. It is still not an
 * accessibility audit: it says nothing about focus order, nothing about colour
 * being the only encoding of a state, and nothing about Mica, a translucent
 * ancestor or sub-pixel anti-aliasing — `design/README.md` "Honest limits" item
 * 3 is the standing statement of that and this file does not widen it.
 * ============================================================================
 */

/** The shipped stylesheet, read from disk so the expected values cannot drift. */
const TOKEN_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.generated.css', import.meta.url)),
  'utf8',
);

/** How far a painted channel may sit from the generator's annotation. */
const TOLERANCE = 2;

/**
 * The generator's own hex annotation for one token in one theme.
 *
 * The theme blocks appear in the stylesheet in a fixed order — light, dark, high
 * contrast — so a block is found by its selector and read to the next `}`.
 */
function annotated(themeSelector: string, token: string): string {
  const start = TOKEN_CSS.indexOf(themeSelector);
  if (start === -1) {
    throw new Error(`e2e: the stylesheet has no ${themeSelector} block.`);
  }
  const block = TOKEN_CSS.slice(start, TOKEN_CSS.indexOf('}', start));
  const match = new RegExp(`${token}:[^;]+;\\s*/\\* (#[0-9a-f]{6}) \\*/`).exec(block);
  if (match === null) {
    throw new Error(`e2e: ${themeSelector} declares no annotated ${token}.`);
  }
  return match[1] as string;
}

/** `#rrggbb` as an 8-bit triple, for a numeric comparison. */
function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** The three built-in themes, by the attribute value that selects each. */
const THEMES = [
  { attribute: null, selector: "[data-theme='leapware-light']", name: 'light (the default)' },
  { attribute: 'dark', selector: "[data-theme='leapware-dark']", name: 'dark' },
  {
    attribute: 'leapware-high-contrast',
    selector: "[data-theme='leapware-high-contrast']",
    name: 'high contrast',
  },
] as const;

/** Force a theme by attribute, or remove the attribute for the default. */
async function forceTheme(page: Page, attribute: string | null): Promise<void> {
  await page.evaluate((value) => {
    if (value === null) {
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    document.documentElement.setAttribute('data-theme', value);
  }, attribute);
}

/**
 * A computed colour property of one element, as an 8-bit triple.
 *
 * Resolved through a canvas rather than parsed out of the serialised string.
 * `fillStyle` accepts whatever the engine hands back — `rgb()`, `oklch()`,
 * `color(srgb …)` — and `getImageData` returns the sRGB the compositor will use,
 * which is the number this file is actually about.
 */
async function paintedColor(
  page: Page,
  selector: string,
  property: string,
): Promise<[number, number, number]> {
  return page.evaluate(
    ([target, name]) => {
      const element = document.querySelector(target as string);
      if (element === null) {
        throw new Error(`e2e: no element matches ${String(target)}`);
      }
      const declared = window.getComputedStyle(element).getPropertyValue(name as string);
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) {
        throw new Error('e2e: no 2d context');
      }
      context.fillStyle = declared;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0] as number, data[1] as number, data[2] as number] as [number, number, number];
    },
    [selector, property] as const,
  );
}

/** WCAG 2.x contrast between two 8-bit triples. Same maths as `design/lib`. */
function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]): number => {
    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * channel(rgb[0] as number) +
      0.7152 * channel(rgb[1] as number) +
      0.0722 * channel(rgb[2] as number)
    );
  };
  const one = luminance(a);
  const two = luminance(b);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/** Assert a painted triple is the annotated colour, within quantisation. */
function expectColor(painted: readonly number[], hex: string, what: string): void {
  const wanted = hexToRgb(hex);
  for (const [index, channel] of ['red', 'green', 'blue'].entries()) {
    expect(
      Math.abs((painted[index] as number) - (wanted[index] as number)),
      `${what}: painted rgb(${painted.join(', ')}), stylesheet declares ${hex} — ${channel} channel`,
    ).toBeLessThanOrEqual(TOLERANCE);
  }
}

test.describe('the token stylesheet reaches the DOM', () => {
  test('resolves the custom properties on the root, so the @import was inlined', async ({
    page,
  }) => {
    await openShell(page);
    // The cheapest possible proof that the whole pipeline connected. There is no
    // `postcss-import` in `postcss.config.js`; Vite inlines CSS `@import`
    // itself, and if it ever stopped doing so this property would be the empty
    // string and every colour below would fall back to an initial value.
    const value = await page.evaluate(() =>
      window.getComputedStyle(document.documentElement).getPropertyValue('--surface-pane').trim(),
    );
    expect(value).not.toBe('');
    expect(value).toContain('oklch');
  });

  test('generates the token utilities, so the content glob still reaches tokenClasses.ts', async ({
    page,
  }) => {
    await openShell(page);
    // `TOKEN_CLASS` is the only file in which most of these strings appear, and
    // Tailwind's scanner is a regular expression over raw text. A `content` glob
    // that stopped matching it would leave every class in the DOM and no rule in
    // the stylesheet — the whole shell unpainted, with a fully green jsdom run.
    const declared = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'bg-surface-pane border-border-default text-text-muted';
      document.body.append(probe);
      const style = window.getComputedStyle(probe);
      const seen = {
        background: style.backgroundColor,
        border: style.borderTopColor,
        color: style.color,
      };
      probe.remove();
      return seen;
    });
    // `rgba(0, 0, 0, 0)` is what an ungenerated `bg-*` leaves behind.
    expect(declared.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(declared.border).not.toBe('rgba(0, 0, 0, 0)');
    expect(declared.color).not.toBe('rgba(0, 0, 0, 0)');
  });

  for (const theme of THEMES) {
    test(`paints the declared colours in the ${theme.name} theme`, async ({ page }) => {
      await openShell(page);
      await forceTheme(page, theme.attribute);

      const surface = await paintedColor(page, '[data-pane="pane2"]', 'background-color');
      expectColor(surface, annotated(theme.selector, '--surface-pane'), 'the pane background');

      const border = await paintedColor(page, '[data-pane="pane2"]', 'border-top-color');
      expectColor(border, annotated(theme.selector, '--border-default'), 'the pane border');

      const divider = await paintedColor(page, '[role="separator"]', 'background-color');
      expectColor(divider, annotated(theme.selector, '--control-divider'), 'the pane divider');
    });

    test(`clears the declared contrast ratios on rendered pixels in the ${theme.name} theme`, async ({
      page,
    }) => {
      await openShell(page);
      await forceTheme(page, theme.attribute);

      // THE ASSERTION NOTHING ELSE IN THIS REPOSITORY MAKES. `check-tokens.mjs`
      // measures colours it read out of a text file; this measures the two
      // colours the compositor actually produced for two elements that are
      // really on the page, and computes the ratio between them.
      const pane = await paintedColor(page, '[data-pane="pane2"]', 'background-color');
      const border = await paintedColor(page, '[data-pane="pane2"]', 'border-top-color');
      const ratio = contrastRatio(border, pane);
      expect(
        ratio,
        `the pane border measured ${ratio.toFixed(2)}:1 against the pane it bounds`,
      ).toBeGreaterThanOrEqual(3);

      // ...and this is the deliberate visible regression, proven rather than
      // asserted in prose. The value it replaces measured 1.26:1 and would fail
      // the line above; see CHANGELOG.md, which announces it in advance.
      const app = await paintedColor(page, '[data-shell-region="root"]', 'background-color');
      const onApp = contrastRatio(border, app);
      expect(onApp, `the pane border measured ${onApp.toFixed(2)}:1 against the app background`)
        .toBeGreaterThanOrEqual(3);
    });
  }

  test('swaps every colour on the same elements when the theme attribute changes', async ({
    page,
  }) => {
    await openShell(page);

    await forceTheme(page, null);
    const lightPane = await paintedColor(page, '[data-pane="pane2"]', 'background-color');
    const lightText = await paintedColor(page, '[data-shell-region="root"]', 'color');

    await forceTheme(page, 'dark');
    const darkPane = await paintedColor(page, '[data-pane="pane2"]', 'background-color');
    const darkText = await paintedColor(page, '[data-shell-region="root"]', 'color');

    // BEFORE AND AFTER ON THE SAME ELEMENT, which is the only form of this
    // assertion that cannot be satisfied by a stylesheet that never changed.
    // It also pins a specificity fact that is easy to break by accident: the
    // light block is selected by `:root` and the dark block by
    // `[data-theme='dark']`, which have IDENTICAL specificity, so the dark block
    // wins on source order alone. Reordering the generator's output would
    // silently disable every non-default theme, and this is what notices.
    expect(darkPane).not.toEqual(lightPane);
    expect(darkText).not.toEqual(lightText);

    // The direction is right, not merely different: the dark pane is darker than
    // the light one and the dark text is lighter than the light theme's.
    expect(contrastRatio(darkPane, [0, 0, 0])).toBeLessThan(contrastRatio(lightPane, [0, 0, 0]));
    expect(contrastRatio(darkText, [0, 0, 0])).toBeGreaterThan(contrastRatio(lightText, [0, 0, 0]));

    await forceTheme(page, null);
    const restored = await paintedColor(page, '[data-pane="pane2"]', 'background-color');
    expect(restored).toEqual(lightPane);
  });

  test('keeps muted body text above 4.5:1 on the pane it is drawn on, in every theme', async ({
    page,
  }) => {
    // The pair that had to be patched by hand per theme before this change:
    // `text-neutral-500` measured 4.18:1 on the dark pane and every muted string
    // in the shell carried a `dark:text-neutral-400` override to fix it. There
    // are no overrides now, so this is the assertion that the single token is
    // genuinely sufficient — measured on painted pixels rather than argued.
    await openShell(page);
    for (const theme of THEMES) {
      await forceTheme(page, theme.attribute);
      const muted = await paintedColor(page, '.text-text-muted', 'color');
      const pane = await paintedColor(page, '[data-pane="pane1"]', 'background-color');
      const ratio = contrastRatio(muted, pane);
      expect(ratio, `muted text measured ${ratio.toFixed(2)}:1 in the ${theme.name} theme`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  test('leaves no dark: rule in the compiled stylesheet with anything to apply to', async ({
    page,
  }) => {
    // THE OBVIOUS FORM OF THIS TEST IS WRONG, AND THE REASON IS WORTH KEEPING.
    //
    // "the compiled stylesheet contains no `.dark\:` rule" was written first and
    // failed, with every `dark:` utility deleted from every component. Tailwind's
    // content scanner is a regular expression over RAW FILE TEXT and has no idea
    // what a comment is, so the docblocks explaining why the variants were
    // removed — which necessarily quote `dark:border-neutral-800` and
    // `dark:text-neutral-400` — regenerate the very rules they describe. The
    // planted-violation fixtures in `src/__tests__/noRawColor.test.ts` were doing
    // the same thing on a larger scale until `content` stopped matching tests.
    //
    // Mangling the prose to hide from the scanner would trade a readable
    // argument for a cleaner build, and two dead rules in a stylesheet cost
    // nothing. So the claim is narrowed to the one that actually matters and is
    // still provable: no `dark:` rule has an element to apply to. That is
    // stronger than the jsdom half — which can only see the class lists the
    // shell renders — because it would also catch a variant introduced by a
    // dependency or left behind by a stale build.
    await openShell(page);
    const applied = await page.evaluate(() => {
      const matched: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // A cross-origin sheet. There are none, but reading one throws.
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes('.dark\\:')) {
            continue;
          }
          // The class the rule is keyed on, unescaped, asked of the document.
          const className = rule.selectorText
            .slice(1, rule.selectorText.indexOf(':where('))
            .replace(/\\/g, '');
          if (document.querySelector(`[class~="${className}"]`) !== null) {
            matched.push(className);
          }
        }
      }
      return matched;
    });
    expect(applied).toEqual([]);
  });
});

/**
 * ============================================================================
 * W3-1: THE STATE PRIMITIVES, PAINTED.
 * ============================================================================
 * `docs/design/WAVE3-PLAN.md` W3-1. The buttons and banners have no consumer in
 * the shell yet, so these cases drive `states.html`, a dev-only fixture that is
 * not a build input (`src/dev/StatesFixture.tsx`). Every case below was
 * mutation-probed before merge: the named line was broken, the case was watched
 * going red, and the line was restored.
 *
 * Motion is emulated as reduced for the whole block. The buttons carry a 120ms
 * `--motion-micro` transition that `motion-reduce:transition-none` removes, so
 * a colour read right after a hover or a press is the end state rather than a
 * frame of the transition.
 * ============================================================================
 */

/** The browser lane's fixture for the wave-3 state primitives. */
const STATES_PATH = '/states.html';

async function openStates(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(STATES_PATH);
  await expect(page.getByRole('region', { name: 'Buttons' })).toBeVisible();
}

/** The four banner statuses, and the wash token each is painted on. */
const BANNERS = [
  { status: 'error', wash: '--status-danger-subtle' },
  { status: 'warning', wash: '--status-warning-subtle' },
  { status: 'success', wash: '--status-success-subtle' },
  { status: 'info', wash: '--status-info-subtle' },
] as const;

/** One computed property of the first element matching `selector`, as serialised. */
async function computed(page: Page, selector: string, property: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((node, name) => window.getComputedStyle(node).getPropertyValue(name), property);
}

test.describe('the W3-1 state primitives paint their states', () => {
  test('paints pressed one step past hover, on a quiet and on a primary button', async ({
    page,
  }) => {
    await openStates(page);
    const light = THEMES[0].selector;

    // Quiet: rest is the pane, hover is one grey step, pressed is the next.
    await page.hover('#fixture-quiet');
    const quietHover = await paintedColor(page, '#fixture-quiet', 'background-color');
    await page.mouse.down();
    const quietPressed = await paintedColor(page, '#fixture-quiet', 'background-color');
    await page.mouse.up();
    expectColor(quietHover, annotated(light, '--surface-hover'), 'the quiet button on hover');
    expectColor(quietPressed, annotated(light, '--surface-selected'), 'the quiet button pressed');
    expect(quietPressed, 'a pressed quiet button paints its hover background').not.toEqual(
      quietHover,
    );

    // Primary: the ramp has no step past deep petrol, so the v4 canvas draws
    // pressed as deep petrol plus a 1px inset accent rule. The rule is what
    // separates the two states, so the rule is what is asserted.
    await page.hover('#fixture-primary');
    const primaryHover = await paintedColor(page, '#fixture-primary', 'background-color');
    const primaryHoverShadow = await computed(page, '#fixture-primary', 'box-shadow');
    await page.mouse.down();
    const primaryPressed = await paintedColor(page, '#fixture-primary', 'background-color');
    const primaryPressedShadow = await computed(page, '#fixture-primary', 'box-shadow');
    await page.mouse.up();
    expectColor(primaryHover, annotated(light, '--accent-solid-hover'), 'the primary on hover');
    expectColor(primaryPressed, annotated(light, '--accent-solid-hover'), 'the primary pressed');
    expect(primaryPressedShadow).toContain('inset');
    expect(primaryHoverShadow).not.toContain('inset');
  });

  test('draws a disabled button in disabled ink at full opacity', async ({ page }) => {
    await openStates(page);
    for (const theme of THEMES) {
      await forceTheme(page, theme.attribute);
      for (const id of ['#fixture-primary-disabled', '#fixture-quiet-disabled']) {
        const ink = await paintedColor(page, id, 'color');
        expectColor(ink, annotated(theme.selector, '--text-disabled'), `${id} ink`);
        const fill = await paintedColor(page, id, 'background-color');
        expectColor(fill, annotated(theme.selector, '--surface-hover'), `${id} fill`);
        expect(
          await computed(page, id, 'opacity'),
          `${id} is drawn with opacity, not with disabled ink`,
        ).toBe('1');
      }
    }
  });

  test('draws every banner as a wash with no border on any side', async ({ page }) => {
    await openStates(page);
    for (const theme of THEMES) {
      await forceTheme(page, theme.attribute);
      for (const banner of BANNERS) {
        const selector = `[data-banner-status="${banner.status}"]`;
        const widths = [];
        for (const side of ['top', 'right', 'bottom', 'left']) {
          widths.push(await computed(page, selector, `border-${side}-width`));
        }
        expect(widths, `the ${banner.status} banner draws a border`).toEqual([
          '0px',
          '0px',
          '0px',
          '0px',
        ]);
        const wash = await paintedColor(page, selector, 'background-color');
        expectColor(wash, annotated(theme.selector, banner.wash), `the ${banner.status} wash`);
      }
    }
  });

  test("clears 4.5:1 for every banner's words on its own wash, in every theme", async ({
    page,
  }) => {
    await openStates(page);
    for (const theme of THEMES) {
      await forceTheme(page, theme.attribute);
      for (const banner of BANNERS) {
        const selector = `[data-banner-status="${banner.status}"]`;
        const wash = await paintedColor(page, selector, 'background-color');
        for (const part of ['[data-banner-title]', '[data-banner-body]']) {
          const ink = await paintedColor(page, `${selector} ${part}`, 'color');
          const ratio = contrastRatio(ink, wash);
          expect(
            ratio,
            `${banner.status} ${part} measured ${ratio.toFixed(2)}:1 in the ${theme.name} theme`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test('keeps a loading button at its idle width, with its bar inside its own box', async ({
    page,
  }) => {
    await openStates(page);
    const button = page.locator('#fixture-primary');
    const idle = await button.boundingBox();
    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAccessibleName('Reordering');
    const busy = await button.boundingBox();
    const bar = await button.locator('[data-loading-bar]').boundingBox();
    if (idle === null || busy === null || bar === null) {
      throw new Error('e2e: the loading button or its bar has no box');
    }
    expect(Math.abs(busy.width - idle.width), 'the button changed width').toBeLessThan(0.5);
    expect(Math.abs(busy.height - idle.height), 'the button changed height').toBeLessThan(0.5);
    // Inside its own box, along its bottom edge: not a centred spinner.
    expect(bar.height).toBeCloseTo(2, 0);
    expect(bar.x).toBeGreaterThanOrEqual(busy.x - 0.5);
    expect(bar.x + bar.width).toBeLessThanOrEqual(busy.x + busy.width + 0.5);
    expect(bar.y + bar.height).toBeLessThanOrEqual(busy.y + busy.height + 0.5);
    expect(bar.y).toBeGreaterThan(busy.y + busy.height / 2);
  });
});
