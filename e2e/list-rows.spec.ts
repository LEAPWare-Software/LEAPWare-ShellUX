import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { activateExtension, clipReportOf, openShell } from './shell';

/**
 * ============================================================================
 * W3-2: LIST ROWS AT 32PX (D-29), PAINTED.
 * ============================================================================
 * `docs/design/WAVE3-PLAN.md` W3-2. Every claim here is a painted or a
 * geometric fact jsdom cannot make: a row's real height, a real pointer's
 * hover, a real focus ring's box-shadow keyword and whether the row it is
 * drawn on survives its ancestor's clip, and contrast measured on real pixels
 * in three themes. A jsdom test may not be named for any of these (`CLAUDE.md`,
 * "jsdom is blind") — the DOM-only halves (which status a record maps to, that
 * the mark is `aria-hidden`, the title-weight class) are in
 * `src/components/__tests__/RowStatus.test.tsx` instead.
 *
 * Two mock row renderers, two different jobs: `MailPlugin.tsx`'s rows are real,
 * individually Tab-focusable buttons — not windowed by `VirtualizedList` — so
 * they are where the per-row focus ring is exercised, honestly, against real
 * keyboard focus. `DatabasePlugin.tsx`'s rows are where all four status words
 * are exercised, because that mock is the one that models inventory.
 *
 * `VirtualizedList.tsx`'s own `role="option"` rows are NOT exercised here.
 * Nothing in the shipped shell mounts that component with real content today
 * (`ShellLayout.tsx`'s own banner: "`VirtualizedList` is a component an
 * extension's own `views.pane2` renders, not something the host wraps around
 * it" — and neither mock renders through it), so there is no route to it from
 * `openShell`. Its row wrapper carries `rowHoverSurface` and
 * `rowFocusRingInset` for when an extension does adopt it, and the limitation
 * is recorded in that file's own comment: under its one-tab-stop,
 * `aria-activedescendant` architecture (its own banner, decision 2), an option
 * row never itself matches `:focus-visible`, so the ring cannot paint there
 * yet. That is a stated, unverified limitation, not a claim.
 * ============================================================================
 */

/** The three built-in themes, by the attribute that selects each. */
const THEMES = [
  { attribute: null, name: 'light' },
  { attribute: 'dark', name: 'dark' },
  { attribute: 'leapware-high-contrast', name: 'high contrast' },
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
 * A computed colour property of an element, resolved to an 8-bit triple.
 *
 * Painted through a canvas rather than parsed out of the serialised string,
 * exactly as `e2e/theme.spec.ts` does it and for the same reason: Chromium may
 * serialise a declared `oklch()` colour as `rgb()`, `color(srgb …)` or the
 * `oklch()` form itself, and a canvas resolves whichever it is to the same sRGB
 * triple the compositor actually paints.
 */
async function paintedColor(locator: Locator, property: string): Promise<[number, number, number]> {
  return locator.evaluate((node: Element, name: string) => {
    const declared = window.getComputedStyle(node).getPropertyValue(name);
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
  }, property);
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

/** The 1px INSET layer of a computed `box-shadow`, split at commas outside parens. */
function hasInsetLayer(boxShadow: string): boolean {
  const layers: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of boxShadow) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  layers.push(current.trim());
  return layers.some((layer) => /\binset\b/.test(layer));
}

test.describe('list rows at 32px (D-29)', () => {
  test('measures a row 32px tall', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    const row = page.locator('[data-message-id]').first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    if (box === null) {
      throw new Error('e2e: the first mail row has no bounding box.');
    }
    expect(box.height, `row measured ${box.height}px tall`).toBeCloseTo(32, 0);
  });

  test('changes the painted background when a pointer rests on a row', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    const row = page.locator('[data-message-id]').nth(1);
    await expect(row).toBeVisible();

    const atRest = await paintedColor(row, 'background-color');
    await row.hover();
    const hovered = await paintedColor(row, 'background-color');
    expect(hovered, `row painted ${JSON.stringify(hovered)} at rest and on hover alike`).not.toEqual(
      atRest,
    );

    // Away and back, so this is genuinely a HOVER effect and not something that
    // stuck once painted.
    await page.mouse.move(0, 0);
    const after = await paintedColor(row, 'background-color');
    expect(after).toEqual(atRest);
  });

  test('draws a selected row with no outline and a heavier title weight', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    const rows = page.locator('[data-message-id]');
    const target = rows.nth(2);
    await expect(target).toBeVisible();

    const titleBefore = target.locator('[data-row-title]');
    const weightBefore = await titleBefore.evaluate(
      (node) => window.getComputedStyle(node).fontWeight,
    );

    // A mouse click, deliberately: Chromium's `:focus-visible` heuristic does
    // not paint the keyboard ring on a pointer click, so what this measures is
    // the SELECTED appearance alone, uncontaminated by the focus ring case
    // below.
    await target.click();
    await expect(target).toHaveAttribute('aria-current', 'true');

    // `outline-none` in Tailwind 3 compiles to `outline: 2px solid transparent`
    // rather than to a literal `outline-style: none` (kept for forced-colors
    // mode), so the outline is checked by its COLOUR being fully transparent —
    // nothing painted — rather than by its style keyword.
    const outlineColor = await target.evaluate(
      (node) => window.getComputedStyle(node).outlineColor,
    );
    expect(outlineColor, `selected row painted an outline colour: ${outlineColor}`).toBe(
      'rgba(0, 0, 0, 0)',
    );
    const shadow = await target.evaluate((node) => window.getComputedStyle(node).boxShadow);
    expect(shadow, `selected row painted a box-shadow rule: ${shadow}`).toBe('none');

    const weightAfter = await titleBefore.evaluate(
      (node) => window.getComputedStyle(node).fontWeight,
    );
    expect(
      Number(weightAfter),
      `selected title weight ${weightAfter} was not heavier than unselected ${weightBefore}`,
    ).toBeGreaterThan(Number(weightBefore));
  });

  test("keeps the current row's keyboard focus ring inside the list's clip", async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    const row = page.locator('[data-message-id]').first();
    const id = await row.getAttribute('data-message-id');
    await expect(row).toBeVisible();

    // Real Tab presses, not `.focus()`: Chromium's `:focus-visible` heuristic
    // is about input modality, and a scripted focus is not guaranteed to
    // reproduce it — the same reasoning `e2e/focus-visibility.spec.ts` states
    // for walking the Tab order rather than calling `.focus()` directly.
    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        (target) => document.activeElement?.getAttribute('data-message-id') === target,
        id,
      );
    }
    expect(reached, 'the Tab order never reached the first mail row').toBe(true);
    await expect(row).toBeFocused();

    const shadow = await row.evaluate((node) => window.getComputedStyle(node).boxShadow);
    expect(
      hasInsetLayer(shadow),
      `the focused row's ring is not drawn inset: ${shadow}`,
    ).toBe(true);

    // The ring is a `ring-inset` box-shadow, painted entirely inside the row's
    // own border box — so it can only be cut by the list's ancestor clip if the
    // row's own box already is. `clipReportOf` is exactly the ribbon-overflow
    // primitive: the same measurement that caught the overflow menu clipped to
    // zero visible pixels under six vacuously-green jsdom tests.
    const clip = await clipReportOf(row);
    expect(
      clip.visible,
      `the current row is clipped by an ancestor: ${JSON.stringify(clip)}`,
    ).toEqual(clip.own);
  });

  for (const status of [
    { kind: 'warning', word: 'Below reorder point' },
    { kind: 'success', word: 'Delivered' },
    { kind: 'danger', word: 'Delivery overdue' },
    { kind: 'info', word: 'Awaiting supplier' },
  ] as const) {
    test(`renders the ${status.kind} status line's mark and word, clearing 4.5:1 in every theme`, async ({
      page,
    }) => {
      await openShell(page);
      await activateExtension(page, 'Inventory Database');
      const line = page.locator(`[data-row-status="${status.kind}"]`).first();
      await expect(line).toBeVisible();

      const mark = line.locator('[data-row-status-mark]');
      await expect(mark).toHaveAttribute('aria-hidden', 'true');
      expect((await mark.textContent())?.length, 'the status mark carried no glyph').toBeGreaterThan(
        0,
      );

      const word = line.locator('[data-row-status-word]');
      await expect(word).toHaveText(status.word);

      // The row itself is a plain button with no declared background at rest
      // (`rowHoverSurface`/`navSelectedSurface` only paint on hover or
      // selection), so its `background-color` reads as transparent rather
      // than as what a reader actually sees. What is really painted behind
      // the row is the pane it sits in — the same substitution
      // `e2e/theme.spec.ts` makes for muted body text.
      const pane = page.locator('[data-pane="pane2"]');
      for (const theme of THEMES) {
        await forceTheme(page, theme.attribute);
        const ink = await paintedColor(word, 'color');
        const surface = await paintedColor(pane, 'background-color');
        const ratio = contrastRatio(ink, surface);
        expect(
          ratio,
          `${status.kind} status word measured ${ratio.toFixed(2)}:1 on the row in the ${theme.name} theme`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
