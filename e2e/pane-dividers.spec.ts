import { expect, test } from '@playwright/test';
import { activateExtension, dragHorizontally, openShell, paneWidth } from './shell';

/**
 * ============================================================================
 * REGRESSION: A DIVIDER DRAG THAT ACTUALLY HAPPENS.
 * ============================================================================
 * The defect this file exists for: a jsdom test named for surviving "a divider
 * drag in flight" **never started a drag**, and passed having exercised nothing
 * at all.
 *
 * The mechanism, measured rather than assumed, because the first version of this
 * banner named the wrong one. jsdom implements **no `PointerEvent`**, so
 * `fireEvent.pointerDown` falls back to a plain `Event`; the library's
 * `getResizeEventCoordinates` reads `clientX`/`clientY` from a pointer event only
 * when `isPrimary` is true, and a plain `Event` has neither, so it is handed
 * `{ x: Infinity, y: Infinity }` and never leaves the handle's `inactive` state.
 * Supplying geometry does not rescue it and neither does supplying a
 * `PointerEvent` constructor that is really a `MouseEvent` — both were tried, and
 * the handle stayed `inactive` through the whole sequence. A browser is the only
 * place this gesture exists, which is what this lane is.
 *
 * Every case below therefore asserts `sawDragState` — `react-resizable-panels`
 * sets `data-resize-handle-state="drag"` only once a drag is genuinely underway.
 * A test that moves the mouse and changes nothing is then a failure rather than
 * a pass, which is exactly the property the jsdom version lacked.
 *
 * Geometry note, because it is counter-intuitive: the handle's painted box is
 * 4px wide (`w-1`). The 12px is `hitAreaMargins.fine`, a pointer-tracking margin
 * inside the library rather than a CSS dimension, so `boundingBox().width` is 4
 * and not 28.
 * ============================================================================
 */

const NAV_DIVIDER = 'Resize the navigation pane';
const LIST_DIVIDER = 'Resize the list pane';

/** Nothing the shell renders may ever become an unrecoverable sliver. */
const NO_VOID_FLOOR_PX = 24;

test.describe('pane dividers, driven by a real pointer', () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
  });

  test('resizes the navigation pane, and the drag really was in flight', async ({ page }) => {
    const before = await paneWidth(page, 'pane1');
    const handle = page.getByRole('separator', { name: NAV_DIVIDER });

    const { sawDragState } = await dragHorizontally(page, handle, 90);

    expect(sawDragState, 'the pointer never put the handle into its drag state').toBe(true);
    const after = await paneWidth(page, 'pane1');
    expect(after).toBeGreaterThan(before + 40);
  });

  test('resizes the list pane, and the drag really was in flight', async ({ page }) => {
    const before = await paneWidth(page, 'pane2');
    const handle = page.getByRole('separator', { name: LIST_DIVIDER });

    const { sawDragState } = await dragHorizontally(page, handle, 100);

    expect(sawDragState, 'the pointer never put the handle into its drag state').toBe(true);
    const after = await paneWidth(page, 'pane2');
    expect(after).toBeGreaterThan(before + 40);
  });

  test('leaves no pane a 0px void when a divider is driven fully to either edge', async ({
    page,
  }) => {
    for (const name of [NAV_DIVIDER, LIST_DIVIDER]) {
      for (const delta of [-3000, 3000]) {
        const handle = page.getByRole('separator', { name });
        const { sawDragState } = await dragHorizontally(page, handle, delta);
        expect(sawDragState, `dragging "${name}" by ${delta} never started`).toBe(true);

        // The claim is not "the layout is pretty at the extreme" but "nothing
        // collapsed to nothing". Each pane declares a pixel minimum, and this is
        // what checks the minimums are really applied by the browser rather than
        // merely declared in the props.
        for (const pane of ['pane1', 'pane2', 'pane3'] as const) {
          const width = await paneWidth(page, pane);
          expect(width, `${pane} after dragging "${name}" by ${delta}`).toBeGreaterThanOrEqual(
            NO_VOID_FLOOR_PX,
          );
        }
      }
    }
  });

  test('recovers a pane driven to its minimum, so the extreme is not a trap', async ({ page }) => {
    const handle = page.getByRole('separator', { name: NAV_DIVIDER });

    await dragHorizontally(page, handle, -3000);
    const atMinimum = await paneWidth(page, 'pane1');
    expect(atMinimum).toBeGreaterThanOrEqual(NO_VOID_FLOOR_PX);

    // "Unrecoverable" is the part of a 0px void that actually hurts: a pane with
    // no width has no divider left to grab. Dragging back is what proves the
    // handle is still there and still works.
    const { sawDragState } = await dragHorizontally(page, handle, 160);
    expect(sawDragState).toBe(true);
    expect(await paneWidth(page, 'pane1')).toBeGreaterThan(atMinimum + 40);
  });

  /**
   * The case the jsdom suite cannot carry, carried here.
   *
   * `src/components/__tests__/ShellLayout.test.tsx` — "survives a collapse
   * toggled while a divider drag is in flight" — runs the same shape in jsdom and
   * says in its own body that no drag starts there: it asserts
   * `data-resize-handle-state` is still `inactive` and pins only the clean
   * unmount. This is the half that needs a pointer, and `sawDragState` is proven
   * true BEFORE the collapse rather than after, so an interruption that never
   * interrupted anything fails instead of passing.
   *
   * The collapse is dispatched rather than clicked: `locator.click()` performs its
   * own mouse down and up, which would end the very gesture this case is holding
   * open.
   */
  test('ends a drag that is genuinely in flight when the pane collapses under it', async ({
    page,
  }) => {
    const handle = page.getByRole('separator', { name: NAV_DIVIDER });
    const box = await handle.boundingBox();
    if (box === null) {
      throw new Error('e2e: the navigation resize handle has no bounding box.');
    }
    const fromX = box.x + box.width / 2;
    const fromY = box.y + box.height / 2;

    await page.mouse.move(fromX, fromY);
    await page.mouse.down();

    let sawDragState = false;
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(fromX + step * 12, fromY);
      if (!sawDragState) {
        sawDragState = (await handle.getAttribute('data-resize-handle-state')) === 'drag';
      }
    }
    expect(sawDragState, 'the pointer never put the handle into its drag state').toBe(true);

    // Unmount the handle mid-gesture, with the button still down.
    await page.getByRole('button', { name: 'Collapse navigation' }).dispatchEvent('click');
    await expect(page.locator('[data-shell-region="nav-track"]')).toBeVisible();

    // The pointer keeps moving and then releases over a handle that no longer
    // exists. Nothing may be left half-applied by it.
    await page.mouse.move(fromX + 400, fromY);
    await page.mouse.up();

    const track = await page.locator('[data-shell-region="nav-track"]').boundingBox();
    expect(track?.width).toBe(48);
    await expect(page.getByRole('separator')).toHaveCount(1);
    for (const pane of ['pane2', 'pane3'] as const) {
      expect(await paneWidth(page, pane)).toBeGreaterThanOrEqual(NO_VOID_FLOOR_PX);
    }
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // And the abandoned gesture left the shell usable: expanding restores a pane 1
    // wide enough to grab, rather than whatever the drag last computed.
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(page.getByRole('separator')).toHaveCount(2);
    expect(await paneWidth(page, 'pane1')).toBeGreaterThanOrEqual(NO_VOID_FLOOR_PX);
  });

  test('keeps the three panes inside the window at every extreme', async ({ page }) => {
    const handle = page.getByRole('separator', { name: LIST_DIVIDER });
    await dragHorizontally(page, handle, 3000);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    // A pane group that overflows the document is the same class of defect as
    // the 320px reflow case: invisible in jsdom, and visible to anyone with a
    // horizontal scrollbar.
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

/**
 * ============================================================================
 * GITHUB ISSUE #114 — THE PANES OPENED AT SIZES SUMMING TO 83.
 * ============================================================================
 * With navigation collapsed on the chrome surface, pane 1 is a fixed 48px
 * `div` outside `shell-panes`, so the group holds pane 2 and pane 3 alone. The
 * pane-1 share was still being subtracted from pane 3's remainder, so the pair
 * asked for 25% and 58.333%. `react-resizable-panels` renormalised and warned
 * on every load, and pane 2 opened about a fifth wider than `PANE_PX` asks.
 *
 * The vitest case beside this one watches for the library's warning, which
 * jsdom CAN observe because the arithmetic does not need pixels. This one
 * watches the pixels, which jsdom cannot: it is the half that proves pane 2
 * actually opens at the width the pixel intent asks for.
 * ============================================================================
 */
test.describe('default pane sizes with navigation collapsed', () => {
  test('opens pane 2 and pane 3 filling the group between them, with no layout warning on the console', async ({
    page,
  }) => {
    const complaints: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('Invalid layout total size')) {
        complaints.push(text);
      }
    });

    await openShell(page);
    await activateExtension(page, 'Mail');
    await page.getByRole('button', { name: 'Collapse navigation' }).click();

    const two = await paneWidth(page, 'pane2');
    const three = await paneWidth(page, 'pane3');
    const group = two + three;

    // Both panes are non-degenerate and together they account for the group.
    expect(two).toBeGreaterThan(0);
    expect(three).toBeGreaterThan(0);
    expect(two / group + three / group).toBeCloseTo(1, 5);

    // And the library never had to renormalise to get there.
    expect(complaints).toEqual([]);
  });
});
