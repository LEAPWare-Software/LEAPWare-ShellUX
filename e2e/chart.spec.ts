import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { activateExtension, dragHorizontally, openShell, paneWidth } from './shell';

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
 *
 * And, since GitHub #111, #112 and #113, the chart's heading and its well:
 *
 *  4. No title is drawn into the canvas, the DOM heading overlaps no string the
 *     canvas draws, and the y-axis name overlaps no y tick label — read from
 *     ECharts' own display list, not inferred from the option.
 *  5. The heading is a DOM `<figcaption>` in label type whose PAINTED colour
 *     clears 4.5:1 on its PAINTED background, and the canvas host paints the
 *     `--surface-sunken` well the chart rows of the contrast manifest name.
 *
 * HOW (4) READS THE CANVAS, AND WHAT THAT DEPENDS ON. A canvas has no DOM, so
 * the strings' boxes come from the live ECharts instance: the test imports the
 * very `echarts/core` module the page loaded — found by its URL in the resource
 * timeline, because the dev server serves it as an optimised dependency with a
 * version query and a different URL would be a different module with an empty
 * instance map — and asks `getInstanceByDom` for the chart on the host. That
 * couples this case to the Vite dev server's dependency layout. If the layout
 * changes, the lookup throws, loudly, rather than finding no strings and passing.
 * ============================================================================
 */

/** A box in page coordinates. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One string ECharts drew, with its box in PAGE coordinates. */
interface DrawnText extends Box {
  readonly text: string;
}

/** What the live instance drew, and where its plot sits, in page coordinates. */
interface CanvasReport {
  readonly texts: readonly DrawnText[];
  readonly grid: Box;
  readonly yName: string;
}

/** Strict overlap: boxes that merely touch at an edge do not intersect. */
function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/** Every string the chart's live ECharts instance drew, and its plot rectangle. */
async function canvasReport(page: Page, host: Locator): Promise<CanvasReport> {
  const handle = await host.elementHandle();
  if (handle === null) {
    throw new Error('e2e: the chart host has no element.');
  }
  return page.evaluate(async (element) => {
    const url = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/deps/echarts_core.js'));
    if (url === undefined) {
      throw new Error('e2e: the page loaded no echarts_core module; the dev-server layout changed.');
    }
    // ECharts and zrender are untyped from this side of the page boundary; the
    // shapes are narrowed by hand, and a missing member throws rather than
    // yielding an empty list.
    interface ZRect {
      x: number;
      y: number;
      width: number;
      height: number;
      clone(): ZRect;
      applyTransform(matrix: unknown): void;
    }
    interface Drawn {
      style?: { text?: unknown };
      getBoundingRect(): ZRect;
      getComputedTransform(): unknown;
    }
    interface Instance {
      getZr(): { storage: { getDisplayList(update: boolean): Drawn[] } };
      getOption(): { yAxis: { name?: string }[] };
      getModel(): {
        getComponent(type: string, index: number): { coordinateSystem: { getRect(): ZRect } };
      };
    }
    const core = (await import(/* @vite-ignore */ url)) as {
      getInstanceByDom(dom: HTMLElement): Instance | undefined;
    };
    const instance = core.getInstanceByDom(element as HTMLElement);
    if (instance === undefined) {
      throw new Error('e2e: no ECharts instance on the chart host.');
    }
    const origin = (element as HTMLElement).getBoundingClientRect();
    const texts = instance
      .getZr()
      .storage.getDisplayList(true)
      .filter((drawn) => typeof drawn.style?.text === 'string' && drawn.style.text !== '')
      .map((drawn) => {
        const rect = drawn.getBoundingRect().clone();
        const transform = drawn.getComputedTransform();
        if (transform) {
          rect.applyTransform(transform);
        }
        return {
          text: drawn.style?.text as string,
          x: origin.x + rect.x,
          y: origin.y + rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    const plot = instance.getModel().getComponent('grid', 0).coordinateSystem.getRect();
    return {
      texts,
      grid: { x: origin.x + plot.x, y: origin.y + plot.y, width: plot.width, height: plot.height },
      yName: instance.getOption().yAxis[0]?.name ?? '',
    };
  }, handle);
}

/** Drive pane 3 to its pixel minimum by dragging the list divider fully right. */
async function squeezePane3(page: Page): Promise<void> {
  const before = await paneWidth(page, 'pane3');
  const { sawDragState } = await dragHorizontally(
    page,
    page.getByRole('separator', { name: 'Resize the list pane' }),
    3000,
  );
  expect(sawDragState, 'the list divider drag never started').toBe(true);
  expect(await paneWidth(page, 'pane3')).toBeLessThan(before);
}

/** The shipped stylesheet, so an expected colour cannot drift from the generator. */
const TOKEN_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.generated.css', import.meta.url)),
  'utf8',
);

/**
 * The generator's hex annotation for one token in one theme block, as a triple.
 *
 * The same reader as `e2e/theme.spec.ts`, repeated rather than imported because
 * that file keeps it private and this change does not own `e2e/shell.ts`.
 */
function annotated(themeSelector: string, token: string): [number, number, number] {
  const start = TOKEN_CSS.indexOf(themeSelector);
  if (start === -1) {
    throw new Error(`e2e: the stylesheet has no ${themeSelector} block.`);
  }
  const block = TOKEN_CSS.slice(start, TOKEN_CSS.indexOf('}', start));
  const match = new RegExp(`${token}:[^;]+;\\s*/\\* (#[0-9a-f]{6}) \\*/`).exec(block);
  if (match === null) {
    throw new Error(`e2e: ${themeSelector} declares no annotated ${token}.`);
  }
  const hex = match[1] as string;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** WCAG 2.x contrast between two 8-bit triples. Same maths as `design/lib`. */
function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]): number => {
    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * channel(rgb[0] as number) +
      0.7152 * channel(rgb[1] as number) +
      0.0722 * channel(rgb[2] as number)
    );
  };
  const one = luminance(a);
  const two = luminance(b);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/** What the heading is, as painted: its element, ink, ground and type, plus the well. */
interface HeadingPaint {
  readonly tag: string;
  readonly ink: [number, number, number];
  readonly ground: [number, number, number];
  readonly well: [number, number, number];
  readonly fontSize: string;
  readonly fontWeight: string;
}

/**
 * The heading's ink and the first opaque background behind it, plus the canvas
 * host's background, each resolved to sRGB through a 1×1 canvas — the same
 * instrument `e2e/theme.spec.ts` uses, so `oklch()` values are compared as the
 * compositor paints them rather than parsed out of a string.
 */
async function headingPaint(figure: Locator): Promise<HeadingPaint> {
  return figure.evaluate((element) => {
    const caption = element.querySelector('figcaption');
    const host = element.querySelector('[data-chart-canvas]');
    if (caption === null || host === null) {
      throw new Error('e2e: the figure has no figcaption or no canvas host.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('e2e: no 2d context');
    }
    const resolve = (css: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0] as number, data[1] as number, data[2] as number, data[3] as number];
    };
    let ground: [number, number, number, number] = [0, 0, 0, 0];
    for (let at: Element | null = caption; at !== null && ground[3] < 255; at = at.parentElement) {
      ground = resolve(window.getComputedStyle(at).backgroundColor);
    }
    if (ground[3] < 255) {
      throw new Error('e2e: no opaque background behind the heading.');
    }
    const style = window.getComputedStyle(caption);
    const ink = resolve(style.color);
    const well = resolve(window.getComputedStyle(host).backgroundColor);
    return {
      tag: caption.tagName,
      ink: [ink[0], ink[1], ink[2]],
      ground: [ground[0], ground[1], ground[2]],
      well: [well[0], well[1], well[2]],
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  });
}

/** The three built-in themes, by the attribute value that selects each. */
const THEMES = [
  { attribute: null, selector: "[data-theme='leapware-light']", name: 'light (the default)' },
  { attribute: 'dark', selector: "[data-theme='leapware-dark']", name: 'dark' },
  {
    attribute: 'leapware-high-contrast',
    selector: "[data-theme='leapware-high-contrast']",
    name: 'high contrast',
  },
] as const;

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

  for (const extension of ['Mail', 'Database'] as const) {
    test(`draws no title into the canvas and keeps the DOM heading clear of every axis string, in ${extension}, at the default and the minimum pane width`, async ({
      page,
    }) => {
      await openShell(page);
      await activateExtension(page, extension);

      for (const width of ['default', 'minimum'] as const) {
        if (width === 'minimum') {
          await squeezePane3(page);
        }
        const figure = page.locator('figure[data-chart-figure]').first();
        const title = (await figure.getAttribute('data-chart-figure')) ?? '';
        expect(title, 'the figure carries no title to look for').not.toBe('');
        const host = figure.locator('[data-chart-canvas="echarts"]');
        const caption = figure.locator('figcaption');
        await expect(host.locator('canvas').first()).toBeAttached();
        // The figure is NAMED by its visible caption in a real accessibility
        // tree — the half jsdom could not answer in `Chart.test.tsx`.
        await expect(page.getByRole('figure', { name: title }).first()).toBeAttached();
        await expect(caption).toBeVisible();
        await expect(caption).toHaveText(title);

        // After a pane resize the observer resizes the instance; wait for the
        // canvas to match its host rather than measuring a stale frame.
        await expect
          .poll(async () => {
            const hostBox = await host.boundingBox();
            const canvasBox = await host.locator('canvas').first().boundingBox();
            return Math.abs((hostBox?.width ?? 0) - (canvasBox?.width ?? -99));
          })
          .toBeLessThanOrEqual(1);

        const where = `${extension}, ${width} pane width`;
        const report = await canvasReport(page, host);
        const headingBox = await caption.boundingBox();
        if (headingBox === null) {
          throw new Error('e2e: the heading has no box.');
        }
        // `toBeVisible()` above is NOT enough on its own: an `sr-only` caption is
        // a 1×1 box and Playwright calls that visible — a mutation probe putting
        // the caption back to `sr-only` left this case green until this line.
        // A 12px label line is at least 12px tall, and the title is wider than
        // one glyph.
        expect(headingBox.height, `${where}: the heading is not a painted line of text`).toBeGreaterThanOrEqual(12);
        expect(headingBox.width, `${where}: the heading is not a painted line of text`).toBeGreaterThanOrEqual(24);

        // Non-vacuity: the canvas really drew strings, including the axis name.
        const yName = report.texts.find((drawn) => drawn.text === report.yName);
        if (yName === undefined) {
          throw new Error(`e2e: ${where}: the y-axis name "${report.yName}" was not drawn.`);
        }
        const yTicks = report.texts.filter(
          (drawn) => drawn !== yName && drawn.x + drawn.width <= report.grid.x,
        );
        expect(yTicks.length, `${where}: fewer than two y tick labels were drawn`).toBeGreaterThanOrEqual(2);

        expect(
          report.texts.map((drawn) => drawn.text),
          `${where}: the canvas drew the title`,
        ).not.toContain(title);
        for (const drawn of report.texts) {
          expect(
            intersects(headingBox, drawn),
            `${where}: the heading overlaps the drawn string "${drawn.text}"`,
          ).toBe(false);
        }
        for (const tick of yTicks) {
          expect(
            intersects(yName, tick),
            `${where}: the y-axis name overlaps the tick "${tick.text}"`,
          ).toBe(false);
        }
      }
    });
  }

  test('paints the heading as DOM text clearing 4.5:1 on the pane, and the plot on the well the series were validated against, in every theme', async ({
    page,
  }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
    const figure = page.locator('figure[data-chart-figure]').first();
    await expect(figure.locator('figcaption')).toBeVisible();

    for (const theme of THEMES) {
      await page.evaluate((value) => {
        if (value === null) {
          document.documentElement.removeAttribute('data-theme');
          return;
        }
        document.documentElement.setAttribute('data-theme', value);
      }, theme.attribute);

      const paint = await headingPaint(figure);
      // A DOM element, not canvas pixels: the check that stops a future change
      // moving the heading back where no gate can measure it.
      expect(paint.tag).toBe('FIGCAPTION');
      // Label type (DESIGN.md: 500, 12px).
      expect(paint.fontSize).toBe('12px');
      expect(paint.fontWeight).toBe('500');
      const ratio = contrastRatio(paint.ink, paint.ground);
      expect(
        ratio,
        `${theme.name}: heading rgb(${paint.ink.join(', ')}) on rgb(${paint.ground.join(', ')}) measured ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);

      // GitHub #111: the host paints the well the manifest measures the chart
      // rows against. Within 2 per channel, the quantisation `theme.spec.ts` allows.
      const wanted = annotated(theme.selector, '--surface-sunken');
      for (const channel of [0, 1, 2] as const) {
        expect(
          Math.abs(paint.well[channel] - wanted[channel]),
          `${theme.name}: the plot well painted rgb(${paint.well.join(', ')}), --surface-sunken is rgb(${wanted.join(', ')})`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });
});
