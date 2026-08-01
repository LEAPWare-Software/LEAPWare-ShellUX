import { expect, test } from '@playwright/test';
import {
  PERSIST_DEBOUNCE_MS,
  STORAGE_KEY,
  activateExtension,
  clipReportOf,
  dragHorizontally,
  openShell,
  paneWidth,
  selectFirstMailMessage,
} from './shell';

/**
 * ============================================================================
 * LAYOUT PROPERTIES THAT ONLY EXIST ONCE SOMETHING LAYS THE PAGE OUT.
 * ============================================================================
 * Reflow, a measured 48px track, and a layout that survives a real reload are
 * all statements about pixels and about a browser's own storage. None of the
 * three is checkable in jsdom: there are no pixels, and a simulated reload is a
 * remount of the same process rather than a fresh document.
 * ============================================================================
 */

test.describe('reflow at 320px', () => {
  // The panel group measures its width ONCE, on mount, through a callback ref —
  // there is no ResizeObserver. Resizing after navigation rescales the panes
  // proportionally without re-deriving the pixel minimums, so the viewport has
  // to be set before the document loads for this to be a real narrow-width test.
  test.use({ viewport: { width: 320, height: 800 } });

  test('does not let the page itself scroll sideways', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    await selectFirstMailMessage(page);

    // An earlier fix introduced exactly this regression: `window.scrollX` was
    // drivable to 376 with no visible scrollbar, because `body { overflow:
    // hidden }` hides a scrollbar without stopping the scroll. Asking for the
    // scroll and then reading the position back is the only way to tell a page
    // that cannot scroll from one that merely looks like it cannot.
    await page.evaluate(() => {
      window.scrollTo(500, 0);
    });

    const geometry = await page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    expect(geometry.scrollX).toBe(0);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  });

  test('leaves every contextual ribbon action reachable', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    await selectFirstMailMessage(page);

    const actions = page.locator('[data-ribbon-side="extension"] button');
    const count = await actions.count();

    // Mail shows four inline actions plus the overflow trigger once a message is
    // selected. A reflow that dropped one would leave a smaller count here, so
    // the floor is asserted rather than assumed.
    expect(count).toBeGreaterThanOrEqual(5);

    for (let index = 0; index < count; index += 1) {
      const action = actions.nth(index);
      const label = (await action.getAttribute('title')) ?? `action ${index}`;

      // The ribbon is its own horizontal scroll container at this width, which
      // is the design: controls stay reachable by scrolling the ribbon rather
      // than by scrolling the page. "Reachable" therefore means reachable AFTER
      // that scroll, and unreachable at any scroll offset is the failure.
      await action.scrollIntoViewIfNeeded();
      const report = await clipReportOf(action);

      expect(report.visible.width, `"${label}" has no visible width`).toBeGreaterThan(0);
      expect(report.visible.height, `"${label}" has no visible height`).toBeGreaterThan(0);
      expect(
        report.ownsItsCentre,
        `a pointer aimed at "${label}" reached ${report.centreHit}`,
      ).toBe(true);
    }
  });

  test('still opens the overflow menu unclipped at this width', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    await selectFirstMailMessage(page);

    const trigger = page.getByRole('button', { name: 'More actions' });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu).toBeVisible();

    const report = await clipReportOf(menu);
    expect(report.visible.width).toBeGreaterThan(0);
    expect(report.visible.height).toBeGreaterThan(0);
    expect(report.ownsItsCentre, `the menu's centre reached ${report.centreHit}`).toBe(true);
  });
});

test.describe('pane 1 collapse to the icon rail', () => {
  test('collapses to a measured 48px track with its glyphs still visible', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    const expanded = await paneWidth(page, 'pane1');
    expect(expanded).toBeGreaterThan(48);

    await page.getByRole('button', { name: 'Collapse navigation' }).click();

    const track = page.locator('[data-shell-region="nav-track"]');
    await expect(track).toBeVisible();

    // Measured, not read off a class. The 48px is an inline style, and a comment
    // in the source claims a `w-12` class that does not exist — so a class-based
    // assertion would be checking the wrong thing even when it passed.
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBe(48);

    // The rail is only useful if what it puts in place of the label is actually
    // painted. An accessible name survives any amount of clipping; a rendered
    // glyph does not.
    //
    /**
     * The glyph is deliberately NOT always an icon. `ShellNavButton` renders a
     * declared node icon when there is one and a monogram letter when there is
     * not, and an extension row declares no icon at all. The jsdom suite can see
     * WHICH branch rendered; only a browser can see that the result occupies
     * pixels, so this asserts the half that one cannot.
     * *Tests:* `src/components/__tests__/ShellLayoutIcons.test.tsx` — "keeps the
     * monogram on the extension rows, which declare no icon at all"
     */
    const railButton = track.getByRole('button', { name: 'Mail' });
    await expect(railButton).toBeVisible();

    const glyph = railButton.locator('[aria-hidden="true"]').first();
    const glyphBox = await glyph.boundingBox();
    expect(glyphBox, 'the collapsed rail row renders no glyph box').not.toBeNull();
    expect(glyphBox?.width).toBeGreaterThan(0);
    expect(glyphBox?.height).toBeGreaterThan(0);

    // ...and that the box is not empty: either host SVG or a monogram character.
    const painted = await glyph.evaluate((node: Element) => ({
      svgCount: node.querySelectorAll('svg').length,
      text: node.textContent?.trim() ?? '',
    }));
    expect(painted.svgCount > 0 || painted.text.length > 0).toBe(true);

    const report = await clipReportOf(railButton);
    expect(report.visible.width).toBeGreaterThan(0);
    expect(report.ownsItsCentre, `the rail button's centre reached ${report.centreHit}`).toBe(true);
  });

  test('restores the full navigation pane when expanded again', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    const expanded = await paneWidth(page, 'pane1');
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('[data-shell-region="nav-track"]')).toBeVisible();

    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(page.locator('[data-shell-region="nav-track"]')).toHaveCount(0);

    const restored = await paneWidth(page, 'pane1');
    expect(restored).toBeGreaterThan(48);
    expect(restored).toBeCloseTo(expanded, 0);
  });
});

test.describe('layout persistence across a real reload', () => {
  test('brings back a pane size the user dragged', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    const handle = page.getByRole('separator', { name: 'Resize the navigation pane' });
    const { sawDragState } = await dragHorizontally(page, handle, 110);
    expect(sawDragState, 'the resize never actually happened, so nothing was persisted').toBe(true);

    const dragged = await paneWidth(page, 'pane1');

    // Writes are debounced so that a whole drag coalesces into one, which means
    // reloading immediately would race the write rather than test the restore.
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(stored, 'nothing was written to the shell state entry').not.toBeNull();

    // A real document reload, not a remount: a new JavaScript context that has
    // to rehydrate from the browser's own storage.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible();

    const restored = await paneWidth(page, 'pane1');
    expect(restored).toBeCloseTo(dragged, 0);
  });

  test('brings back the pane-1 collapsed flag', async ({ page }) => {
    await openShell(page);
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('[data-shell-region="nav-track"]')).toBeVisible();

    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    await page.reload();

    // The shell opens collapsed, and the ribbon offers the inverse action.
    await expect(page.locator('[data-shell-region="nav-track"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  });

  test('brings back the foreground extension', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Inventory Database');

    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    await page.reload();

    await expect(
      page.getByRole('region', { name: 'Detail' }).getByText('Inventory Database').first(),
    ).toBeVisible();
  });
});
