import { expect, test } from '@playwright/test';
import { activateExtension, openShell } from './shell';

/**
 * ============================================================================
 * THE ONLY LANE THAT CAN SEE A CHART AT ALL.
 * ============================================================================
 * **jsdom has no canvas 2D context**, so `echartsRenderer.isSupported()` is false
 * under vitest and the library is never constructed there. Every unit test of the
 * chart path runs against `createFakeRenderer`, which proves the WRAPPER's
 * lifetime rules and proves nothing whatsoever about ECharts.
 *
 * Several docblocks say "`e2e/` is where a real chart is drawn" — this file is
 * that claim's evidence, and without it those sentences would be prose pointing
 * at an empty room. `check-citations` cannot catch that: it resolves quoted test
 * TITLES, and a sentence naming a directory resolves against nothing.
 *
 * Three things are asserted and each is unreachable from the other lane:
 *
 *  1. A real `<canvas>` exists inside the wrapper's host element and has a
 *     non-zero box, which is the whole of "ECharts initialised successfully".
 *  2. Nothing was written to the console while it did. ECharts 6 deprecated
 *     `grid.containLabel` and warns per render for it; one such warning per chart
 *     per paint is exactly the noise `IntegrationSuite`'s console guard exists to
 *     prevent, and only a real init can produce it.
 *  3. The accessible alternative is on the page beside the canvas, because a
 *     canvas is opaque to assistive technology and the table is what a screen
 *     reader actually gets.
 * ============================================================================
 */

test.describe('a real chart, really drawn', () => {
  test('initialises ECharts into a canvas with a non-zero box, silently', async ({ page }) => {
    const noise: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        noise.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      noise.push(`pageerror: ${error.message}`);
    });

    await openShell(page);
    // The database remote publishes `stock-levels` as a chart block, so pane 3's
    // ledger holds a real one as soon as this extension is in the foreground.
    await activateExtension(page, 'Database');

    const host = page.locator('[data-chart-canvas="echarts"]').first();
    await expect(host).toBeAttached();

    // The canvas is ECharts' own, appended by `init`. Its presence IS the proof
    // that the library ran; a zero box would mean it errored on the way.
    const canvas = host.locator('canvas').first();
    await expect(canvas).toBeAttached();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // The data table, beside it, for the reader the canvas cannot serve.
    await expect(page.locator('figure table').first()).toBeAttached();

    expect(noise).toEqual([]);
  });

  test('reveals the same chart’s numbers in the block inspector', async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Database');

    await page.getByRole('button', { name: 'Inspect stock-levels' }).click();

    const inspector = page.locator('[data-block-inspector="stock-levels"]');
    await expect(inspector).toBeVisible();
    // The host-assigned change token, which is the only thing a subscriber
    // should compare, and the same `ChartDataTable` the canvas hides beside it.
    await expect(inspector).toContainText('revision');
    await expect(inspector.locator('table')).toBeVisible();
  });
});
