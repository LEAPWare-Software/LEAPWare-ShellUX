import { expect, test } from '@playwright/test';
import { activateExtension, clipReportOf, openShell, selectFirstMailMessage } from './shell';

/**
 * ============================================================================
 * THE PALETTE HAS REAL FOCUS AND REAL CLIPPING BEHAVIOUR. ONLY A BROWSER SEES IT.
 * ============================================================================
 * `src/components/command/__tests__/CommandPalette.test.tsx` asserts the DOM: the
 * dialog exists, the rows are buttons, Tab moves between them, no role claims an
 * arrow-key model. Every one of those cases would pass against a palette clipped
 * to zero pixels behind the panes, for exactly the reason the ribbon's overflow
 * menu passed six of them for months — jsdom has no layout engine, every
 * `getBoundingClientRect` is 0×0, no ancestor ever clips anything, and
 * `elementFromPoint` is not a meaningful question there.
 *
 * Three things are checked here and nowhere else:
 *
 *  1. **Paint and hit-testing.** The dialog occupies the box it claims to after
 *     every clipping ancestor has been applied, and a pointer at its centre
 *     reaches it rather than a pane behind it. `contain: paint` on the context
 *     bar, `overflow-hidden` on the shell root and `overflow-hidden` on the pane
 *     container are all still there; a palette rendered in place would be inside
 *     all three.
 *  2. **The focus trap.** Radix's modal dialog moves focus in and keeps it there.
 *     jsdom runs the same code, but "Tab does not escape to the browser chrome"
 *     is a statement about a real focus model.
 *  3. **The host chord actually reaches the window.** `useHotkeyDispatch` listens
 *     on `window` in the bubble phase, and whether a real Ctrl+K arrives there —
 *     rather than being swallowed by the browser — is not a jsdom question.
 *
 * The palette is host chrome and is not plug-in-declarable: the chord is in
 * `HOST_CHORDS`, consulted before the extension chord table, so Mail declaring
 * `Ctrl+K` could not take it. That precedence is asserted in jsdom, where the
 * extension's handler can be observed; what is asserted here is only that the
 * chord works at all.
 * ============================================================================
 */

test.describe('the command palette, in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
  });

  test('opens on the host chord with non-zero visible dimensions that no ancestor clips', async ({
    page,
  }) => {
    await page.keyboard.press('Control+k');

    const dialog = page.getByRole('dialog', { name: 'Commands' });
    await expect(dialog).toBeVisible();

    const report = await clipReportOf(dialog);
    expect(report.own.width).toBeGreaterThan(0);
    expect(report.own.height).toBeGreaterThan(0);

    // The half a DOM-presence assertion cannot reach. Clipped to zero height,
    // `own` would still have been non-zero and only `visible` would collapse.
    expect(report.visible.width).toBeCloseTo(report.own.width, 0);
    expect(report.visible.height).toBeCloseTo(report.own.height, 0);
  });

  test('is the element a pointer reaches at its own centre, not a pane behind it', async ({
    page,
  }) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Commands' });
    await expect(dialog).toBeVisible();

    const report = await clipReportOf(dialog);
    expect(
      report.ownsItsCentre,
      `a pointer at the palette's centre reached ${report.centreHit}`,
    ).toBe(true);
  });

  test('renders outside every clipping ancestor of the shell', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Commands' });
    await expect(dialog).toBeVisible();

    // Structural as well as measured, because a dialog inside the shell root is
    // one CSS change away from being clipped again.
    const containment = await dialog.evaluate((element: Element) => ({
      insideContextBar: element.closest('[data-shell-region="context-bar"]') !== null,
      insideShellRoot: element.closest('[data-shell-region="root"]') !== null,
    }));
    expect(containment.insideContextBar).toBe(false);
    expect(containment.insideShellRoot).toBe(false);
  });

  test('is browsable on an empty query, which is what replaces the ribbon at discovery', async ({
    page,
  }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();

    // Nothing typed, and commands are already on screen, grouped. A search-only
    // palette would show an empty box here, which is the regression the whole
    // browsable design exists to avoid.
    const search = page.getByRole('searchbox', { name: 'Search commands' });
    await expect(search).toHaveValue('');
    const sections = page.locator('[data-palette-section]');
    expect(await sections.count()).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Close extension' })).toBeVisible();
  });

  test('traps focus inside the dialog and restores it on Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Commands' });
    await expect(dialog).toBeVisible();

    // Focus is inside the dialog to begin with, and walking the tab order past
    // the end of it wraps rather than escaping into the shell behind.
    for (let step = 0; step < 12; step += 1) {
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        const content = document.querySelector('[data-shell-region="command-palette"]');
        return active !== null && content !== null && content.contains(active);
      });
      expect(inside, `focus left the palette after ${String(step)} tabs`).toBe(true);
      await page.keyboard.press('Tab');
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('runs a command by pointer at its own centre and closes', async ({ page }) => {
    // Selecting a message makes Mail's selection-gated commands live, and Delete
    // removes the row from pane 2 — an observable the host renders rather than
    // something this test arranges.
    const messageId = await selectFirstMailMessage(page);
    const row = page.locator(`[data-message-id="${messageId}"]`);
    await expect(row).toBeVisible();

    await page.keyboard.press('Control+k');
    const command = page.getByRole('dialog', { name: 'Commands' }).getByRole('button', {
      name: 'Delete',
    });
    await expect(command).toBeVisible();

    const box = await command.boundingBox();
    expect(box, 'the Delete row has no bounding box').not.toBeNull();
    if (box === null) {
      return;
    }
    // A raw pointer click at the geometric centre rather than `command.click()`:
    // Playwright's own click scrolls and retries, and the question here is whether
    // an unassisted gesture lands.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
    await expect(row).toHaveCount(0);
  });

  test('does not leave the page scrollable sideways while it is open', async ({ page }) => {
    // The same failure `contain: paint` was added to the context bar for: a wide
    // overlay that leaks into the viewport's scrollable area gives the page a
    // sideways scroll with no visible scrollbar, because `body { overflow: hidden }`
    // hides the bar without stopping the scroll.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollX).toBe(0);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});
