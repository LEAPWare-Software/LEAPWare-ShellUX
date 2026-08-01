import { expect, test } from '@playwright/test';
import { activateExtension, clipReportOf, openShell, selectFirstMailMessage } from './shell';

/**
 * ============================================================================
 * REGRESSION: THE OVERFLOW MENU IS REALLY VISIBLE AND REALLY CLICKABLE.
 * ============================================================================
 * The defect this file exists for: the ribbon's overflow menu was clipped out of
 * existence by two `overflow-hidden` ancestors. It had **zero visible pixels**,
 * and a pointer click at its centre hit-tested to a different pane. Six jsdom
 * tests asserted the menu worked, and all six passed — vacuously, because jsdom
 * has no layout engine: every `getBoundingClientRect` is 0x0, no ancestor ever
 * clips anything, and `elementFromPoint` is not a meaningful question there.
 *
 * The fix was to portal the menu under `document.body`, outside every clipping
 * ancestor by construction. These cases assert the *outcome* of that — visible
 * pixels, and a pointer that lands — rather than the implementation, so they
 * keep their teeth if the mechanism is ever replaced.
 *
 * Mail declares five ribbon actions and `RibbonToolbar`'s `INLINE_ACTION_LIMIT`
 * is four, so a selected message is what pushes the fifth into the menu. The
 * split is a hard count and not a width measurement, so no viewport size can
 * move an action in or out of it.
 * ============================================================================
 */

test.describe('the ribbon overflow menu, in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    await selectFirstMailMessage(page);
  });

  test('opens a menu with non-zero visible dimensions that no ancestor clips', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'More actions' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu).toBeVisible();

    const report = await clipReportOf(menu);

    // The original defect measured zero here while every jsdom test was green.
    expect(report.own.width).toBeGreaterThan(0);
    expect(report.own.height).toBeGreaterThan(0);

    // And this is the half a DOM-presence assertion cannot reach: after every
    // clipping ancestor and the viewport have been applied, the menu still
    // occupies the box it claims to. Clipped to zero height, `own` would still
    // have been non-zero and only `visible` would have collapsed.
    expect(report.visible.width).toBeCloseTo(report.own.width, 0);
    expect(report.visible.height).toBeCloseTo(report.own.height, 0);
  });

  test('is the element a pointer reaches at its own centre, not a pane behind it', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu).toBeVisible();

    const report = await clipReportOf(menu);

    // The defect's most user-visible symptom: a click aimed at the menu landed
    // in a different pane. `centreHit` is in the failure message so that a
    // regression names what was in the way instead of only saying "false".
    expect(
      report.ownsItsCentre,
      `a pointer at the menu's centre reached ${report.centreHit}`,
    ).toBe(true);
  });

  test('executes the action when a real pointer clicks a menu item at its centre', async ({
    page,
  }) => {
    // Mail's fifth action is Delete, and it is the one that overflows. Deleting
    // removes the row from pane 2, which is an observable the host renders and
    // not something the test arranges for itself.
    const messageId = await selectFirstMailMessage(page);
    const row = page.locator(`[data-message-id="${messageId}"]`);
    await expect(row).toBeVisible();

    await page.getByRole('button', { name: 'More actions' }).click();
    const item = page.getByRole('menuitem', { name: 'Delete' });
    await expect(item).toBeVisible();

    const box = await item.boundingBox();
    expect(box, 'the Delete menu item has no bounding box').not.toBeNull();
    if (box === null) {
      return;
    }

    // A raw pointer click at the geometric centre, rather than `item.click()`.
    // Playwright's own click would scroll and retry; the whole point here is to
    // reproduce the gesture the user made when the menu was unclickable, with no
    // help, and to require that it lands.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The action ran: the row is gone from the list the host renders.
    await expect(row).toHaveCount(0);
  });

  test('renders the menu outside every clipping ancestor of the ribbon', async ({ page }) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu).toBeVisible();

    // Stated as a structural fact rather than only as a measurement, because it
    // is what makes the measurement above robust instead of lucky: a menu inside
    // the ribbon is one CSS change away from being clipped again.
    const containment = await menu.evaluate((element: Element) => ({
      insideRibbon: element.closest('[data-shell-region="ribbon"]') !== null,
      insideShellRoot: element.closest('[data-shell-region="root"]') !== null,
    }));

    expect(containment.insideRibbon).toBe(false);
    expect(containment.insideShellRoot).toBe(false);
  });
});
