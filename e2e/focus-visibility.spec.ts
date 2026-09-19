import { expect, test } from '@playwright/test';
import type { ElementHandle } from '@playwright/test';
import { activateExtension, openShell } from './shell';

/**
 * ============================================================================
 * A VISIBLE FOCUS INDICATOR, MEASURED RATHER THAN ASSUMED.
 * ============================================================================
 * WCAG 2.2 asks for visible focus indication. The AA target that once put it in
 * scope is withdrawn; decision D-37 makes a visible focus ring part of the 1.0
 * keyboard gate instead (`docs/accessibility.md`). jsdom cannot check it: it computes no styles from a stylesheet, it
 * has no `:focus-visible` matching, and it paints nothing — so a jsdom test can
 * only assert that a class name is present, which is a statement about the
 * source and not about what a user can see.
 *
 * **How this avoids the trap of proving nothing.** The indicator is established
 * by comparing the SAME element focused and unfocused, and focus is moved only
 * with real Tab presses. Programmatically blurring and re-focusing would be
 * simpler and would be wrong: Chromium applies `:focus-visible` on a heuristic
 * about the last input modality, so a scripted `.focus()` can produce a
 * different computed style from the identical keyboard focus and the comparison
 * would be measuring the heuristic rather than the stylesheet.
 *
 * This is a rendering assertion, not a conformance claim. It says every element
 * the Tab order reaches looks different when focused; it does not say the
 * contrast of that difference meets 1.4.11, which needs a contrast computation
 * this file deliberately does not pretend to do.
 * ============================================================================
 */

/** The computed properties any of which can carry a focus indicator. */
interface FocusStyle {
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
  readonly boxShadow: string;
  readonly borderColor: string;
  readonly backgroundColor: string;
  readonly textDecorationLine: string;
}

/** How far to walk the tab order. Comfortably past the context bar and the panes. */
const TAB_STEPS = 14;

async function styleOf(element: ElementHandle<Element>): Promise<FocusStyle> {
  return element.evaluate((node: Element): FocusStyle => {
    const style = window.getComputedStyle(node);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
      borderColor: style.borderColor,
      backgroundColor: style.backgroundColor,
      textDecorationLine: style.textDecorationLine,
    };
  });
}

async function describe(element: ElementHandle<Element>): Promise<string> {
  return element.evaluate((node: Element) => {
    const name =
      node.getAttribute('aria-label') ??
      node.getAttribute('title') ??
      node.textContent?.trim().slice(0, 40) ??
      '';
    return `<${node.tagName.toLowerCase()}> ${name}`.trim();
  });
}

function differs(focused: FocusStyle, blurred: FocusStyle): boolean {
  return (Object.keys(focused) as (keyof FocusStyle)[]).some(
    (key) => focused[key] !== blurred[key],
  );
}

test.describe('focus visibility across the shell', () => {
  test('gives every element the Tab order reaches a visible focus indicator', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    const visited: {
      readonly element: ElementHandle<Element>;
      readonly label: string;
      readonly focused: FocusStyle;
    }[] = [];

    for (let step = 0; step < TAB_STEPS; step += 1) {
      await page.keyboard.press('Tab');

      const handle = await page.evaluateHandle(() => document.activeElement);
      const element = handle.asElement() as ElementHandle<Element> | null;
      if (element === null) {
        continue;
      }

      const isBody = await element.evaluate((node: Element) => node === document.body);
      if (isBody) {
        continue;
      }

      visited.push({
        element,
        label: await describe(element),
        focused: await styleOf(element),
      });
    }

    // A walk that reached nothing would pass every assertion below vacuously,
    // which is the exact failure mode this whole lane was built to stop.
    expect(visited.length, 'the Tab order reached no focusable element').toBeGreaterThan(4);

    // Focus has now moved past every entry except the last, so each of the rest
    // can be re-measured in its genuinely unfocused state. The last is dropped
    // rather than blurred, because blurring it programmatically is exactly the
    // measurement this test refuses to make.
    for (const entry of visited.slice(0, -1)) {
      const blurred = await styleOf(entry.element);
      expect(
        differs(entry.focused, blurred),
        `${entry.label} looks identical focused and unfocused: ${JSON.stringify(entry.focused)}`,
      ).toBe(true);
    }
  });

  test('shows the focus indicator on a pane divider reached by keyboard', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    const name = 'Resize the list pane';
    const divider = page.getByRole('separator', { name });
    const handle = await divider.elementHandle();
    expect(handle, `no element handle for "${name}"`).not.toBeNull();
    if (handle === null) {
      return;
    }

    const blurred = await styleOf(handle);

    // Walked to with real Tab presses. `.focus()` would be one line, and would
    // measure Chromium's input-modality heuristic rather than the stylesheet -
    // the divider's indicator is a `focus-visible:` background, which a scripted
    // focus can legitimately decline to apply.
    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await handle.evaluate((node: Element) => node === document.activeElement);
    }

    expect(reached, `the Tab order never reached the divider "${name}"`).toBe(true);

    const focused = await styleOf(handle);
    expect(
      differs(focused, blurred),
      `the divider "${name}" looks identical focused and unfocused`,
    ).toBe(true);
  });
});

/**
 * ============================================================================
 * W3-1: ONE FOCUS MECHANISM, ON `:focus-visible` ONLY.
 * ============================================================================
 * The brief's §8 "cut to one": the two-tone ring (`--focus-ring`, its offset in
 * `--focus-ring-offset`) on keyboard focus, and nothing on a mouse click. Driven
 * against `states.html` (`src/dev/StatesFixture.tsx`), because the button that
 * carries the ring has no consumer in the shell yet.
 *
 * The ring is two box-shadow layers, and Chromium may serialise their colours
 * as `oklch()`, so each colour is painted through a canvas to an 8-bit triple
 * and compared with what the same canvas makes of the token itself.
 * ============================================================================
 */

/** Split a computed `box-shadow` into its layers, at commas outside parentheses. */
function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
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
  return layers;
}

/** The three built-in themes, by the attribute that selects each. */
const FOCUS_THEMES = [
  { attribute: null, name: 'light' },
  { attribute: 'dark', name: 'dark' },
  { attribute: 'leapware-high-contrast', name: 'high contrast' },
] as const;

interface PaintedRing {
  readonly ring: number[];
  readonly offset: number[];
  readonly layers: { readonly rgb: number[]; readonly spread: string | undefined }[];
}

test.describe('the W3-1 focus ring', () => {
  for (const theme of FOCUS_THEMES) {
    test(`paints no ring on a mouse click and the two-tone ring on a Tab, in the ${theme.name} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/states.html');
      await page.evaluate((value) => {
        if (value === null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', value);
      }, theme.attribute);
      const button = page.locator('#fixture-quiet');
      await expect(button).toBeVisible();

      const shadowOf = (): Promise<string> =>
        button.evaluate((node) => window.getComputedStyle(node).boxShadow);
      const atRest = await shadowOf();

      await button.click();
      await expect(button).toBeFocused();
      expect(await shadowOf(), 'a mouse click painted a focus ring').toBe(atRest);

      // Away and back by keyboard, so the focus being measured is a keyboard one.
      await page.keyboard.press('Tab');
      await expect(button).not.toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(button).toBeFocused();
      const focused = await shadowOf();
      expect(focused, 'a Tab painted no focus ring').not.toBe(atRest);

      // Two tones: the offset in the surface colour out to 1px, then the ring
      // colour out to 3px, which is 2px of ring past the 1px offset.
      const painted: PaintedRing = await page.evaluate((layers: string[]) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) throw new Error('e2e: no 2d context');
        const paint = (colour: string): number[] => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = colour;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
        };
        const root = window.getComputedStyle(document.documentElement);
        return {
          ring: paint(root.getPropertyValue('--focus-ring').trim()),
          offset: paint(root.getPropertyValue('--focus-ring-offset').trim()),
          layers: layers.map((layer) => ({
            rgb: paint(/^(?:[a-z]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(layer)?.[0] ?? ''),
            spread: /(-?[\d.]+)px\s*$/.exec(layer)?.[1],
          })),
        };
      }, shadowLayers(focused));
      const ringLayer = painted.layers.find((layer) => layer.spread === '3');
      const offsetLayer = painted.layers.find((layer) => layer.spread === '1');
      expect(ringLayer, `no 3px ring layer in ${focused}`).toBeDefined();
      expect(offsetLayer, `no 1px offset layer in ${focused}`).toBeDefined();
      expect(ringLayer?.rgb).toEqual(painted.ring);
      expect(offsetLayer?.rgb).toEqual(painted.offset);
    });
  }
});
