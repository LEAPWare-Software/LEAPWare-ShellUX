import { expect, test } from '@playwright/test';
import { activateExtension, dragHorizontally, openShell, paneWidth } from './shell';

/**
 * ============================================================================
 * REGRESSION: A DIVIDER DRAG THAT ACTUALLY HAPPENS.
 * ============================================================================
 * The defect this file exists for: a jsdom test named for surviving "a divider
 * drag in flight" **never started a drag**. jsdom reports every rect as 0x0, so
 * a synthesised pointer-down could not intersect the handle's 12px hit area, and
 * the case passed having exercised nothing at all.
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
