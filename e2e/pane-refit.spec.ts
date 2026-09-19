import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  PERSIST_DEBOUNCE_MS,
  STORAGE_KEY,
  activateExtension,
  dragHorizontally,
  openShell,
  paneWidth,
} from './shell';

/**
 * ============================================================================
 * GITHUB ISSUE #23 — THE PANES AFTER A LIVE WINDOW RESIZE, IN PIXELS.
 * ============================================================================
 * `src/components/__tests__/ShellLayoutRefit.test.tsx` asserts the re-fit as
 * arithmetic over widths it stubs, and says so. What only a browser can say is
 * what a real viewport resize does to real pane rectangles: the observer really
 * fires, the library really re-lays the group out, and the pixels either land
 * inside `PANE_PX`'s bands or they do not.
 *
 * **Every width here is set with `page.setViewportSize` AFTER the document has
 * loaded.** A viewport set before load tests the mount-time layout, which other
 * specs already cover; the live resize is the whole subject of this file.
 *
 * **The bands are asserted as `PANE_PX` values scaled by what the panels
 * divide.** The shell converts pixels against the group's width, and the panels
 * divide that width less the two 4px dividers — so a pane sitting exactly on its
 * 176px minimum at a 900px window measures 176 × 892 / 900 ≈ 174.4px. The same
 * scaling is why `shell-layout.spec.ts` measures the 240px intent as 238.8px at
 * 1920. `bandFloor` spells it out rather than widening a tolerance to hide it.
 * ============================================================================
 */

/** `PANE_PX` from `src/components/layout/paneSizing.ts`, restated: this lane asserts pixels, not imports. */
const NAV_MIN = 176;
const NAV_MAX = 400;
const LIST_MIN = 240;
const DETAIL_MIN = 260;
const NAV_DEFAULT = 240;

/** Two dividers, each a 4px `w-1` box. See `pane-dividers.spec.ts`'s geometry note. */
const DIVIDERS_PX = 8;

/** What a pane sitting exactly on `px` measures once the dividers are taken out. */
function bandFloor(px: number, windowWidth: number): number {
  return (px * (windowWidth - DIVIDERS_PX)) / windowWidth;
}

/** The three pane widths, rounded to a tenth of a pixel. */
async function paneWidths(page: Page): Promise<[number, number, number]> {
  const round = (value: number): number => Math.round(value * 10) / 10;
  return [
    round(await paneWidth(page, 'pane1')),
    round(await paneWidth(page, 'pane2')),
    round(await paneWidth(page, 'pane3')),
  ];
}

/** The raw stored record, or `null`. */
async function storedText(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

test.describe('the pane layout after a live window resize', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('keeps every pane inside its pixel band when a restored layout is narrowed live', async ({
    page,
  }) => {
    await openShell(page);
    // A chosen layout whose pane 1 is 13% — 208px at 1600, inside its band, and
    // 117px at 900 if the share were simply kept, which is 59px under it.
    await page.evaluate(
      (key) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            v: 1,
            paneSizes: { pane1: 13, pane2: 30, pane3: 57 },
            isPane1Collapsed: false,
            activeExtensionId: null,
            extensions: {},
          }),
        );
      },
      STORAGE_KEY,
    );
    await page.reload();
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible();
    const [restoredNav] = await paneWidths(page);
    expect(restoredNav, 'the record was not restored').toBeCloseTo(0.13 * (1600 - DIVIDERS_PX), 0);

    await page.setViewportSize({ width: 900, height: 900 });

    await expect
      .poll(async () => paneWidth(page, 'pane1'), {
        message: 'pane 1 was left under its 176px minimum after the window narrowed',
      })
      .toBeGreaterThanOrEqual(bandFloor(NAV_MIN, 900) - 0.5);
    const [nav, list, detail] = await paneWidths(page);
    expect(nav).toBeLessThanOrEqual(bandFloor(NAV_MAX, 900) + 0.5);
    expect(list, 'pane 2 fell under its 240px minimum').toBeGreaterThanOrEqual(
      bandFloor(LIST_MIN, 900) - 0.5,
    );
    expect(detail, 'pane 3 fell under its 260px minimum').toBeGreaterThanOrEqual(
      bandFloor(DETAIL_MIN, 900) - 0.5,
    );
  });

  test('returns to the dragged widths when a narrowed window is widened again, and never rewrites the stored layout', async ({
    page,
  }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');

    // Pane 1 dragged to about 200px: kept as a share, that is about 112px at
    // 900 — under the minimum, so the narrowing below MUST correct it.
    const handle = page.getByRole('separator', { name: 'Resize the navigation pane' });
    const { sawDragState } = await dragHorizontally(page, handle, -40);
    expect(sawDragState, 'the drag never happened, so nothing was chosen').toBe(true);
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    const chosenRecord = await storedText(page);
    expect(chosenRecord, 'the drag was not persisted').not.toBeNull();
    const dragged = await paneWidths(page);
    expect(dragged[0]).toBeLessThan(215);

    await page.setViewportSize({ width: 900, height: 900 });
    await expect
      .poll(async () => paneWidth(page, 'pane1'))
      .toBeGreaterThanOrEqual(bandFloor(NAV_MIN, 900) - 0.5);
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    expect(
      await storedText(page),
      'narrowing the window overwrote the layout the user chose',
    ).toBe(chosenRecord);

    await page.setViewportSize({ width: 1600, height: 900 });
    await expect
      .poll(async () => paneWidths(page), {
        message: 'widening the window did not bring the chosen layout back',
      })
      .toEqual(dragged);
    await page.waitForTimeout(PERSIST_DEBOUNCE_MS * 3);
    expect(await storedText(page)).toBe(chosenRecord);
  });

  test('keeps an untouched navigation pane on its 240px intent across a live resize, where a reload opens it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openShell(page);
    // A band of a few pixels rather than `bandFloor` exactly: measured, the pane
    // opens at 239.1px here, not the 238.5 the divider arithmetic alone predicts,
    // and the difference is sub-pixel layout this case is not about. What it is
    // about is the gap to 360px below.
    const opened = await paneWidth(page, 'pane1');
    expect(opened).toBeGreaterThan(NAV_DEFAULT - 5);
    expect(opened).toBeLessThanOrEqual(NAV_DEFAULT);

    // Scaled with the window, 240px at 1280 would become 360px at 1920.
    await page.setViewportSize({ width: 1920, height: 900 });
    await expect
      .poll(async () => paneWidth(page, 'pane1'), {
        message: 'the navigation pane scaled with the window instead of keeping its 240px intent',
      })
      .toBeLessThan(250);
    const live = await paneWidths(page);
    expect(live[0]).toBeGreaterThan(NAV_DEFAULT - 5);

    // The same width after a real reload: the two paths are one derivation.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Navigation' })).toBeVisible();
    const reloaded = await paneWidths(page);
    for (const [index, width] of reloaded.entries()) {
      expect(width, `pane ${String(index + 1)} differs from the live resize`).toBeCloseTo(
        live[index] as number,
        0,
      );
    }
  });
});
