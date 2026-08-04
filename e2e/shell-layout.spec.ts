import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

  test('leaves every contextual command reachable', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    await selectFirstMailMessage(page);

    const actions = page.locator('[data-command-side="extension"] button');
    const count = await actions.count();

    // Mail shows four inline actions plus the overflow trigger once a message is
    // selected. A reflow that dropped one would leave a smaller count here, so
    // the floor is asserted rather than assumed.
    expect(count).toBeGreaterThanOrEqual(5);

    for (let index = 0; index < count; index += 1) {
      const action = actions.nth(index);
      const label = (await action.getAttribute('title')) ?? `action ${index}`;

      // The context bar is its own horizontal scroll container at this width,
      // which is the design: controls stay reachable by scrolling the bar rather
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

    // The shell opens collapsed, and the context bar offers the inverse action.
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

/**
 * The shape of the one entry the shell writes, as far as these two cases read
 * it. Narrower than the engine's own type on purpose: this lane asserts against
 * the bytes in the browser's storage, not against a type the shell shares with
 * itself.
 */
interface StoredRecord {
  readonly paneSizes: { readonly pane1: number; readonly pane2: number; readonly pane3: number };
  readonly isPane1Collapsed: boolean;
}

/** The stored record, parsed, or a failure naming the entry that was missing. */
async function storedRecord(page: Page): Promise<StoredRecord> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(raw, `nothing is stored under ${STORAGE_KEY}`).not.toBeNull();
  return JSON.parse(raw as string) as StoredRecord;
}

/**
 * ============================================================================
 * TWO DATA-DESTROYING DEFECTS, AS SPECIFICATIONS RATHER THAN AS UNIT TESTS.
 * ============================================================================
 * Both were found and fixed with jsdom cases in
 * `src/components/__tests__/ShellLayoutPersistence.test.tsx`, and both are
 * restated here because these two are BEHAVIOURAL statements about a user's
 * saved layout surviving a real reload — the kind that should outlive whatever
 * `ShellLayout` is rewritten into, while a test that mocks `Panel` and reads a
 * render log cannot.
 *
 * Each also gets something the jsdom lane cannot give it. The first drags with a
 * real pointer and measures real pane rectangles either side of a real document
 * reload. The second needs a viewport wide enough for the pixel intent and the
 * engine's percentage defaults to disagree loudly, and jsdom has no viewport at
 * all.
 * ============================================================================
 */

test.describe('a collapse and a re-expansion of pane 1', () => {
  test('leaves the stored layout alone, so a reload still opens on the dragged widths', async ({
    page,
  }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    const handle = page.getByRole('separator', { name: 'Resize the navigation pane' });
    const { sawDragState } = await dragHorizontally(page, handle, 120);
    expect(sawDragState, 'the resize never actually happened, so nothing was persisted').toBe(true);

    const dragged = {
      pane1: await paneWidth(page, 'pane1'),
      pane2: await paneWidth(page, 'pane2'),
    };
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    const chosen = await storedRecord(page);

    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('[data-shell-region="nav-track"]')).toBeVisible();
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(page.locator('[data-shell-region="nav-track"]')).toHaveCount(0);
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);

    // Re-adding pane 1 makes the library renormalise a two-panel group into a
    // three-panel one, and every panel reports the result. None of it is a size
    // the user chose, and the record is where that distinction has to hold.
    const after = await storedRecord(page);
    expect(after.isPane1Collapsed).toBe(false);
    expect(after.paneSizes).toEqual(chosen.paneSizes);

    // And what survived is a layout rather than a pile of slots. One divider
    // moves two panes and leaves the third alone, so a record patched one
    // reported pane at a time keeps a third number that belongs to a width this
    // one never had, and the three stop dividing the whole.
    const total = after.paneSizes.pane1 + after.paneSizes.pane2 + after.paneSizes.pane3;
    expect(total, `the stored percentages are ${JSON.stringify(after.paneSizes)}`).toBeCloseTo(
      100,
      3,
    );

    // The half a stored record cannot prove on its own: the widths really come
    // back, through a fresh document and the browser's own storage.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible();
    expect(await paneWidth(page, 'pane1')).toBeCloseTo(dragged.pane1, 0);
    expect(await paneWidth(page, 'pane2')).toBeCloseTo(dragged.pane2, 0);
  });
});

test.describe('the 240px navigation intent at a wide viewport', () => {
  // 1920px is where the pixel table and the engine's percentage defaults
  // disagree loudest: 240px is 12.5% of it, and the record's own default pane 1
  // is 18%, which is 345.6px. At Playwright's usual 1280 the two are 240 and
  // 230.4 and this case would prove almost nothing.
  test.use({ viewport: { width: 1920, height: 900 } });

  test('survives a reload whose stored record was written for another slot entirely', async ({
    page,
  }) => {
    await openShell(page);
    const opened = await paneWidth(page, 'pane1');
    // A BAND RATHER THAN 240 EXACTLY, AND THE REASON IS NOT SLOPPINESS. The 12.5%
    // the shell computes from `PANE_PX.navDefault` is 12.5% of what the panels
    // divide, which is the group less its two 4px dividers — so the pane measures
    // 238.8px here, not 240. Measured, not guessed. The number that matters is
    // the one this is NOT: the record's own 18% default is 344px at this width,
    // nowhere near the band, so this cannot pass for the wrong reason.
    expect(opened, 'the navigation pane does not open on its 240px intent').toBeGreaterThan(230);
    expect(opened, 'the navigation pane does not open on its 240px intent').toBeLessThan(250);

    // Activating an extension writes the foreground slot. Nobody has touched a
    // divider, so the pane sizes in the record it produces are the engine's
    // untouched defaults — and a shell that reads "a record exists" as "the user
    // chose a layout" never consults its own pixel table again on this machine.
    await activateExtension(page, 'Mail');
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    await storedRecord(page);

    await page.reload();
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible();

    const restored = await paneWidth(page, 'pane1');
    expect(restored, 'the reload moved a divider nobody dragged').toBeCloseTo(opened, 0);
    expect(restored, 'the navigation pane no longer opens on its 240px intent').toBeLessThan(250);
  });
});

/**
 * ============================================================================
 * GITHUB ISSUE #110 — THE COMPOSER HAD NOWHERE TO DOCK.
 * ============================================================================
 * `PaneWrapper`'s body sat inside a `flex-row`, and was not itself a column
 * flex container, so a child using `flex-1` to fill VERTICALLY had no column
 * parent to fill against and sized to its content. The omnibox — the product's
 * one persistent input — came to rest wherever the ledger happened to stop,
 * above as much as 450px of dead pane.
 *
 * jsdom is structurally unable to see this. It does not lay out, and
 * `getBoundingClientRect` returns 0x0, so the 1,739-case suite was green
 * through the whole defect. The vitest side of this fix asserts only that a
 * CLASS is present and says so in its own title; the behaviour is here.
 *
 * **THE FIX HAS TWO SEPARABLE HALVES AND THEY NEED TWO ASSERTIONS.** The issue
 * says so, and a mutation probe confirmed it: reverting `flex flex-col` on the
 * body while leaving the footer wiring in place left the docked-footer case
 * below GREEN, because the footer is a `flex-none` sibling of the body's row
 * inside the section's own column and docks whether or not the BODY is a
 * column. The footer case guards part 2 only. The case after it guards part 1
 * — that a child of the body using `flex-1` now fills the pane instead of
 * sizing to its content — and that is the half the dead space was.
 * ============================================================================
 */
test.describe('the pane footer is docked, not floating', () => {
  test('rests the omnibox against the bottom edge of pane 3, not against the end of the content', async ({
    page,
  }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    await selectFirstMailMessage(page);

    const pane = page.locator('[data-pane="pane3"]');
    const footer = pane.locator('[data-pane-slot="footer"]');
    await expect(footer).toBeVisible();

    const paneBox = await pane.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(paneBox).not.toBeNull();
    expect(footerBox).not.toBeNull();

    // The footer's bottom edge sits within the pane's 1px border of the pane's
    // own bottom edge. A floating composer misses this by hundreds of pixels,
    // which is the point: the tolerance does not have to be clever to
    // discriminate.
    const paneBottom = (paneBox as { y: number; height: number }).y + (paneBox as { height: number }).height;
    const footerBottom =
      (footerBox as { y: number; height: number }).y + (footerBox as { height: number }).height;
    expect(Math.abs(paneBottom - footerBottom)).toBeLessThanOrEqual(2);
  });
});

test.describe('the pane body is a column its children can fill', () => {
  test('gives pane 3 a detail stack that reaches the bottom of the scroll container rather than stopping at its content', async ({
    page,
  }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    // Deliberately NO selection: the shorter the content, the larger the dead
    // space the defect leaves, and the more the assertion discriminates.

    const body = page.locator('[data-pane="pane3"] [data-pane-slot="body"]');
    const stack = body.locator('[data-shell-region="detail-stack"]');
    await expect(stack).toBeVisible();

    const bodyBox = await body.boundingBox();
    const stackBox = await stack.boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(stackBox).not.toBeNull();

    // The body carries `p-1` — 4px each side — so the stack fills it to within
    // the padding. Measured with the fix in place the two agree to the pixel;
    // measured with `flex flex-col` reverted the stack collapses to its own
    // content height, which is hundreds of pixels short. The tolerance below is
    // the padding plus a pixel, not a fudge factor.
    const bodyInner = (bodyBox as { height: number }).height - 8;
    const stackHeight = (stackBox as { height: number }).height;
    expect(bodyInner).toBeGreaterThan(200);
    expect(Math.abs(bodyInner - stackHeight)).toBeLessThanOrEqual(9);
  });
});
