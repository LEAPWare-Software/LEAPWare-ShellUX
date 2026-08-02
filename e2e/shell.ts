import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Helpers shared by the browser lane.
 *
 * Nothing in here asserts a security property, so nothing in here carries a
 * citation. What it does carry is the two geometric primitives the whole lane
 * exists for — a real visible rectangle after every ancestor clip is applied,
 * and a real pointer drag — because those are precisely what jsdom cannot
 * produce and therefore what no helper under `src/` can be reused for.
 */

/**
 * The fixture document, by name.
 *
 * The dev server now serves this same fixture at `/` too — see `vite.config.ts`
 * and `e2e/dev-routing.spec.ts`. This lane keeps navigating to the explicit path
 * on purpose: a helper that went through `/` would make every spec in this
 * directory depend on the routing middleware, so a broken rewrite would present
 * as thirty unrelated failures instead of the three cases written to catch it.
 */
export const FIXTURE_PATH = '/dev.html';

/** The one entry `HydrationEngine` writes, and its debounce window. */
export const STORAGE_KEY = 'leapware-shellux.shell-state';
export const PERSIST_DEBOUNCE_MS = 120;

/** A rectangle, in CSS pixels, in the viewport's coordinate space. */
export interface Rect {
  readonly width: number;
  readonly height: number;
}

/** What an element measures, and what survives its ancestors' clipping. */
export interface ClipReport {
  /** The element's own border box. */
  readonly own: Rect;
  /** That box intersected with every scrolling or clipping ancestor. */
  readonly visible: Rect;
  /** Whether the topmost element at the box's centre is the element or inside it. */
  readonly ownsItsCentre: boolean;
  /** The tag and shell region of whatever really sits at that centre point. */
  readonly centreHit: string;
}

/**
 * Open the fixture shell and wait for the three panes to exist.
 *
 * `ShellLayout` measures the panel group's width once, with a callback ref, and
 * renders no `PanelGroup` at all until it has one — so "the document loaded" is
 * not the same event as "the panes exist", and waiting for the region is what
 * closes that gap.
 */
export async function openShell(page: Page): Promise<void> {
  await page.goto(FIXTURE_PATH);
  await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'List' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Detail' })).toBeVisible();
}

/** Bring an extension to the foreground by its blueprint name, as a user would. */
export async function activateExtension(page: Page, name: string): Promise<void> {
  await page.getByRole('region', { name: 'Navigation' }).getByRole('button', { name }).click();
  await expect(page.getByRole('region', { name: 'Detail' }).getByText(name).first()).toBeVisible();
}

/**
 * Select the first message in the Mail list and return its id.
 *
 * Selecting is what makes Mail's four selection-gated commands visible,
 * which is what pushes the fifth past `INLINE_ACTION_LIMIT` and creates the
 * overflow menu. Without it there is no overflow trigger in the DOM at all.
 */
export async function selectFirstMailMessage(page: Page): Promise<string> {
  const row = page.locator('[data-message-id]').first();
  await expect(row).toBeVisible();
  const id = await row.getAttribute('data-message-id');
  if (id === null) {
    throw new Error('e2e: the first mail row carries no data-message-id.');
  }
  await row.click();
  await expect(page.locator(`[data-message-id="${id}"]`)).toHaveAttribute('aria-current', 'true');
  return id;
}

/**
 * What an element really measures once every clipping ancestor has had its say,
 * and whether a pointer aimed at its centre would actually reach it.
 *
 * **This is the assertion the jsdom suite could not make, and the reason this
 * lane exists.** The context bar's overflow menu was once clipped to zero visible
 * pixels by two `overflow-hidden` ancestors: it was in the DOM, it had
 * `getBoundingClientRect` values in a real browser, and six jsdom tests asserted
 * it worked — because jsdom reports every rect as 0x0 and applies no clipping,
 * so "invisible" and "fine" are the same reading there.
 *
 * `ownsItsCentre` is the half with the most teeth. A box can survive clipping
 * and still be unclickable if something is painted over it, and the original
 * defect hit-tested to a different pane; `elementFromPoint` is the only way to
 * ask the question a user's pointer asks.
 */
export async function clipReportOf(locator: Locator): Promise<ClipReport> {
  return locator.evaluate((element: Element): ClipReport => {
    const rect = element.getBoundingClientRect();

    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;

    // Every ancestor that establishes a clip narrows the visible box. `contain:
    // paint` clips too, and it is on the context bar deliberately, so it is asked
    // about by name rather than inferred from `overflow`.
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const style = window.getComputedStyle(parent);
      const clips =
        style.overflow !== 'visible' ||
        style.overflowX !== 'visible' ||
        style.overflowY !== 'visible' ||
        style.contain.includes('paint');
      if (!clips) {
        continue;
      }
      const box = parent.getBoundingClientRect();
      left = Math.max(left, box.left);
      top = Math.max(top, box.top);
      right = Math.min(right, box.right);
      bottom = Math.min(bottom, box.bottom);
    }

    // The viewport clips as well, and an element scrolled off-screen is exactly
    // as unreachable as one clipped by a parent.
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth);
    bottom = Math.min(bottom, window.innerHeight);

    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(centreX, centreY);

    const describe = (node: Element | null): string => {
      if (node === null) {
        return 'nothing';
      }
      const region = node.closest('[data-shell-region]')?.getAttribute('data-shell-region');
      const pane = node.closest('[data-pane]')?.getAttribute('data-pane');
      const where = region ?? pane ?? 'outside any shell region';
      return `<${node.tagName.toLowerCase()}> in ${where}`;
    };

    return {
      own: { width: rect.width, height: rect.height },
      visible: { width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      ownsItsCentre: hit !== null && (hit === element || element.contains(hit)),
      centreHit: describe(hit),
    };
  });
}

/**
 * Drag an element horizontally with a real pointer, and report whether the drag
 * was ever actually in flight.
 *
 * **The second defect this lane exists for.** A jsdom test named for surviving
 * "a divider drag in flight" never started a drag: jsdom reports every rect as
 * 0x0, so pointer-down could not land inside the handle's hit area, and the test
 * passed while asserting nothing. `sawDragState` is the guard against writing
 * that test again — `react-resizable-panels` sets
 * `data-resize-handle-state="drag"` only once a drag is genuinely underway, so a
 * drag that silently did nothing is distinguishable from one that did.
 *
 * @param steps how many intermediate moves to synthesise. More than one, because
 *   a single jump from press to release is not a gesture the library tracks.
 */
export async function dragHorizontally(
  page: Page,
  handle: Locator,
  deltaX: number,
): Promise<{ sawDragState: boolean }> {
  const box = await handle.boundingBox();
  if (box === null) {
    throw new Error('e2e: the resize handle has no bounding box, so it cannot be dragged.');
  }

  const fromX = box.x + box.width / 2;
  const fromY = box.y + box.height / 2;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();

  let sawDragState = false;
  const stepCount = 12;
  for (let step = 1; step <= stepCount; step += 1) {
    await page.mouse.move(fromX + (deltaX * step) / stepCount, fromY);
    if (!sawDragState) {
      sawDragState = (await handle.getAttribute('data-resize-handle-state')) === 'drag';
    }
  }

  await page.mouse.up();
  return { sawDragState };
}

/** A pane's measured width in CSS pixels, by its region name. */
export async function paneWidth(page: Page, pane: 'pane1' | 'pane2' | 'pane3'): Promise<number> {
  const box = await page.locator(`[data-pane="${pane}"]`).boundingBox();
  if (box === null) {
    throw new Error(`e2e: pane ${pane} has no bounding box.`);
  }
  return box.width;
}
