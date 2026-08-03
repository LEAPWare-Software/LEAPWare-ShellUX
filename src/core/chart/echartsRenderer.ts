import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { init, registerTheme, use as echartsUse } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartPalette } from './chartPalette';
import type { ChartDash, ChartKind, ChartMarker } from './chartSpec';
import type { ChartInstance, ChartOption, ChartRenderer } from './ChartRenderer';

/**
 * ============================================================================
 * THE ONE FILE IN `src/` THAT NAMES ECHARTS.
 * ============================================================================
 * Tier 1 of §3.3: Apache ECharts 6, Apache-2.0, canvas renderer, tree-shaken.
 * The import list at the top of this file is the tree-shaking: `echarts/core`
 * plus an explicit `use([…])` pulls in three chart types and five components,
 * not the whole library, and the measured bundle cost of exactly this list is
 * recorded in `CHANGELOG.md` rather than estimated.
 *
 * Everything above this file speaks `ChartOption` — the host's own vocabulary in
 * `ChartRenderer.ts`. The translation into ECharts' option schema happens here
 * and nowhere else, which is what makes the renderer swappable: a uPlot adapter
 * (tier 2) would implement the same `ChartRenderer` interface against the same
 * neutral option and no consumer would change.
 *
 * ---------------------------------------------------------------------------
 * R7, PAID IN FULL AND STATED RATHER THAN HIDDEN
 * ---------------------------------------------------------------------------
 * **ECharts cannot swap a registered theme on a live instance.** There is no
 * `setTheme`. A theme change therefore costs a `dispose()` and an `init()`, and
 * the visible consequence is that every chart in the document is torn down and
 * rebuilt when the user picks a theme: option state is preserved by the wrapper
 * and re-applied immediately, but the canvas is genuinely repainted from
 * scratch. That is acceptable for a rare, user-initiated action and it would not
 * be acceptable on a data update — which is why `setOption` exists beside it and
 * why the wrapper is careful about which of the two it reaches for.
 *
 * **One registered theme name, re-registered before each `init`.** ECharts keeps
 * registered themes in a module-global map, so minting a fresh name per theme
 * change would leak an entry per change for the life of the document.
 * Re-registering `THEME_NAME` overwrites in place. That is safe here because a
 * document has exactly one `ThemeBridge` and therefore exactly one live palette;
 * a second palette in the same document would be applied to every chart built
 * after it, and that constraint is written down rather than guarded, because the
 * guard would be a branch nothing can reach.
 *
 * ---------------------------------------------------------------------------
 * WHAT A jsdom TEST CAN AND CANNOT SEE HERE
 * ---------------------------------------------------------------------------
 * `toEChartsTheme` and `toEChartsOption` are exported, pure and fully tested:
 * they are where the colour rotation, the dash mapping and the decal mapping
 * actually happen. `echartsRenderer` itself is four calls into a library, and
 * its test replaces that library with a recorder — so what is proven under
 * vitest is the SHAPE of the calls and their order, never that a pixel appeared.
 * jsdom has no canvas 2D context; `e2e/` is where a real chart is drawn.
 * ============================================================================
 */

// Aliased away from the bare name `use`, which `eslint-plugin-react-hooks` reads
// as React 19's `use` hook and rejects at module scope. The alias is the whole
// of the workaround; nothing about the call changes.
echartsUse([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  // The one component here that is not about drawing: `aria` makes ECharts
  // emit a generated description of the chart onto the container. It is a
  // supplement and NOT the accessible answer — a canvas is opaque to a screen
  // reader and a generated sentence is not a data table. `ChartDataTable`
  // beside every chart is the answer; see `src/components/chart/Chart.tsx`.
  AriaComponent,
  CanvasRenderer,
]);

/** The single registered theme name. See the banner for why there is only one. */
export const THEME_NAME = 'leapware';

/** Host chart kind to ECharts series type. A closed map, compiler-pinned. */
const SERIES_TYPE: Readonly<Record<ChartKind, string>> = Object.freeze({
  line: 'line',
  bar: 'bar',
  scatter: 'scatter',
});

/** Host dash to ECharts `lineStyle.type`. Meaningful for `line`. */
const LINE_TYPE: Readonly<Record<ChartDash, string>> = Object.freeze({
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
});

/** Host marker to ECharts symbol. `square` is spelled `rect` there. */
const SYMBOL: Readonly<Record<ChartMarker, string>> = Object.freeze({
  circle: 'circle',
  square: 'rect',
  triangle: 'triangle',
  diamond: 'diamond',
});

/**
 * Host dash to an ECharts decal, which is the second channel a BAR can carry.
 *
 * A dashed line reads on a line chart and says nothing on a bar, so the same
 * host channel is expressed twice — as a stroke pattern for lines and as a fill
 * pattern for areas. `solid` is `null` rather than an empty decal because
 * ECharts reads `null` as "no decal" and an object with no pattern as a decal
 * that paints nothing, and the two differ on export.
 */
const DECAL: Readonly<Record<ChartDash, Record<string, unknown> | null>> = Object.freeze({
  solid: null,
  dashed: Object.freeze({ symbol: 'rect', dashArrayX: [6, 6], dashArrayY: [6, 6], rotation: 0.8 }),
  dotted: Object.freeze({ symbol: 'circle', dashArrayX: [4, 4], dashArrayY: [4, 4], rotation: 0 }),
});

/**
 * An ECharts theme object built from the resolved palette.
 *
 * Chrome only — axis, grid, label, tooltip. The SERIES colours are deliberately
 * not put here even though a theme can hold a `color` array: a theme's colour
 * list is consumed in series ORDER, so a chart whose series were reordered would
 * silently repaint in different colours. `colorIndex` is a property of a series,
 * so it is applied per series in the option below and cannot drift with order.
 */
export function toEChartsTheme(palette: ChartPalette): Record<string, unknown> {
  return {
    // Transparent, so the pane's own `--surface-pane` shows through and the
    // chart does not paint a second background over it. The contrast pairs
    // `design/` measured are against the pane, so painting anything else here
    // would invalidate them.
    backgroundColor: 'transparent',
    textStyle: { color: palette.label },
    title: { textStyle: { color: palette.label } },
    legend: { textStyle: { color: palette.label } },
    categoryAxis: {
      axisLine: { lineStyle: { color: palette.axis } },
      axisTick: { lineStyle: { color: palette.axis } },
      axisLabel: { color: palette.label },
      splitLine: { show: false, lineStyle: { color: palette.grid } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: palette.axis } },
      axisTick: { lineStyle: { color: palette.axis } },
      axisLabel: { color: palette.label },
      splitLine: { show: true, lineStyle: { color: palette.grid } },
    },
    tooltip: {
      backgroundColor: palette.tooltipBackground,
      borderColor: palette.axis,
      textStyle: { color: palette.tooltipText },
      axisPointer: { lineStyle: { color: palette.crosshair }, crossStyle: { color: palette.crosshair } },
    },
  };
}

/**
 * A neutral `ChartOption` as an ECharts option.
 *
 * **`animation: false` is a decision, not a default.** §3.7's motion budget
 * forbids animating list scroll, pane resize and selection change, and a chart
 * that grows out of the axis on every data tick is the same class of motion:
 * `MailPlugin`'s and `DatabasePlugin`'s payloads republish on a timer, so an
 * animated chart would never be still.
 */
export function toEChartsOption(option: ChartOption): Record<string, unknown> {
  return {
    animation: false,
    aria: { enabled: true },
    title: { text: option.title, left: 'left' },
    // Explicit margins rather than `containLabel`, which ECharts 6 deprecated in
    // favour of `grid.outerBounds` and warns about on every render. A warning
    // per chart per paint would break "emits no console error or warning while
    // extensions are switched faster than a fetch settles" in
    // `src/__tests__/IntegrationSuite.test.tsx`, which is the repository's only
    // guard against exactly this kind of noise.
    grid: { left: 48, right: 16, top: 32, bottom: 48 },
    tooltip: { trigger: 'axis' },
    legend: { data: option.series.map((series) => series.name), bottom: 0 },
    xAxis: { type: 'category', name: option.xLabel, data: option.categories },
    yAxis: { type: 'value', name: option.yLabel },
    series: option.series.map((series) => ({
      name: series.name,
      type: SERIES_TYPE[series.kind],
      data: series.values,
      symbol: SYMBOL[series.marker],
      showSymbol: true,
      itemStyle: { color: series.color, decal: DECAL[series.dash] },
      lineStyle: { color: series.color, type: LINE_TYPE[series.dash] },
    })),
  };
}

/**
 * The tier-1 renderer.
 *
 * Frozen, for the reason every host store in this repository is: a consumer that
 * reaches this object obtains its members and cannot replace them.
 */
export const echartsRenderer: ChartRenderer = Object.freeze({
  id: 'echarts',

  isSupported(): boolean {
    // **A GLOBAL, NOT A `getContext` CALL.** Asking a probe canvas for a 2D
    // context is the obvious probe and is wrong here twice over: it allocates
    // an element on every call, and in jsdom it reaches
    // `HTMLCanvasElement.prototype.getContext`, which is not implemented and
    // reports an error to the virtual console before returning `null`. That
    // error would break "emits no console error or warning while extensions are
    // switched faster than a fetch settles" in
    // `src/__tests__/IntegrationSuite.test.tsx`.
    //
    // The constructor's mere presence answers the same question with no
    // allocation and no side effect: every browser that can paint a canvas
    // defines `CanvasRenderingContext2D`, and jsdom without the optional
    // `canvas` package does not define it at all.
    return typeof (globalThis as Record<string, unknown>)['CanvasRenderingContext2D'] === 'function';
  },

  create(host: HTMLElement, palette: ChartPalette): ChartInstance {
    registerTheme(THEME_NAME, toEChartsTheme(palette));
    const instance = init(host, THEME_NAME, { renderer: 'canvas' });
    return Object.freeze({
      setOption(option: ChartOption): void {
        // `notMerge` is true: the wrapper always hands a complete option, and a
        // merge would leave a series behind after the publisher removed one.
        instance.setOption(toEChartsOption(option), true);
      },
      resize(): void {
        instance.resize();
      },
      dispose(): void {
        instance.dispose();
      },
    });
  },
});
