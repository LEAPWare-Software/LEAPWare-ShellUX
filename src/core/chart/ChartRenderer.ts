import type { ChartPalette } from './chartPalette';
import type { ChartDash, ChartKind, ChartMarker, ChartSpec } from './chartSpec';
import { seriesColor } from './chartPalette';

/**
 * ============================================================================
 * THE RENDERER SEAM. NOTHING IN THIS FILE KNOWS WHAT ECHARTS IS.
 * ============================================================================
 * §3.3 of the native-host plan puts Apache ECharts at tier 1 and then says, in
 * the same breath, "design the internal `<Chart>` wrapper so a renderer is
 * swappable; don't bet on [WebGPU] now." This module is that seam, and it is the
 * same shape as two seams this repository already has: `HydrationEngine`'s
 * `ShellStorage` and `src/core/ipc/`'s `PortLike`. Each is an interface the host
 * owns, with a real implementation beside it and a fake one in the tests.
 *
 * **Three consequences, and all three are the point:**
 *
 *  1. No consumer imports `echarts`. `Chart.tsx` takes a `ChartRenderer` and
 *     calls four methods on it; the only file in `src/` that names the library
 *     is `echartsRenderer.ts`.
 *  2. `ChartOption` below is the HOST's vocabulary, not ECharts'. A `dash` is
 *     `'dashed'`, not `[5, 5]`; a marker is `'triangle'`, not `'triangle'`
 *     because ECharts happens to spell it that way. The translation into a
 *     library's option schema lives in that library's adapter, so a uPlot or
 *     WebGPU renderer would translate the same neutral object rather than
 *     re-deriving it.
 *  3. It is why `<Chart>` is testable at all. A jsdom canvas has no 2D context,
 *     so a real ECharts instance cannot be constructed under vitest; a fake
 *     renderer records calls and the whole wrapper — including the dispose/init
 *     dance on a theme change — runs against it. What that does NOT prove is
 *     that ECharts paints, and `e2e/` is where that is checked.
 *
 * *Tests:* `src/core/chart/__tests__/chartOption.test.ts` — "resolves every
 * series colour from the palette, in colorIndex order" and "carries the second
 * and third channels through to the option".
 * ============================================================================
 */

/** One series, ready to paint: three channels resolved, no token names left. */
export interface ChartOptionSeries {
  readonly name: string;
  readonly kind: ChartKind;
  readonly values: readonly number[];
  /**
   * The resolved colour string.
   *
   * **A colour appears HERE and never in a `ChartSpec`, and the difference is
   * who wrote it.** A spec is a publisher's, and a publisher supplying a colour
   * would defeat the contrast validation `design/` performed and could encode
   * meaning by colour alone. An option is the HOST's, built from the host's own
   * `colorIndex` rotation against the host's own resolved theme, and something
   * has to hand a string to a canvas eventually. That is this field.
   */
  readonly color: string;
  readonly dash: ChartDash;
  readonly marker: ChartMarker;
}

/** A whole chart, ready to paint. Neutral: no library's schema appears here. */
export interface ChartOption {
  readonly kind: ChartKind;
  readonly title: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly ChartOptionSeries[];
}

/** One live chart. Four verbs, and the wrapper uses exactly these four. */
export interface ChartInstance {
  /** Apply an option to a live instance. Cheap; called on every data change. */
  setOption(option: ChartOption): void;
  /** Re-read the host element's box. Called from `useElementWidth`, never from a resize listener. */
  resize(): void;
  /** Release the instance. After this the object is spent and is never reused. */
  dispose(): void;
}

/** A chart engine. */
export interface ChartRenderer {
  /** A stable identifier, so a test and an inspector can say which engine drew. */
  readonly id: string;
  /**
   * Can this engine run in this runtime at all?
   *
   * **Asked because the answer is sometimes no, and the failure is otherwise a
   * crash rather than a degradation.** A canvas engine needs a 2D context;
   * jsdom has none, and a locked-down embedding may have none either. Without
   * this question the wrapper builds an instance that throws somewhere inside a
   * library, in a render, taking the pane with it.
   *
   * With it, the honest answer is available: no chart, and the data table
   * beside it still readable. That is a WORSE experience and not a broken one,
   * which is the distinction the whole accessible-alternative design already
   * turns on.
   *
   * It must be CHEAP and SIDE-EFFECT-FREE: `Chart` calls it inside an effect
   * that runs on every palette change.
   */
  isSupported(): boolean;
  /**
   * Build an instance inside `host`, painting with `palette`.
   *
   * **The palette is a CONSTRUCTION argument and not a setter, deliberately.**
   * ECharts registers a theme at `init` and cannot swap it on a live instance —
   * risk R7 — so the only honest signature is one where changing the palette
   * means building a new instance. Making that a parameter of `create` puts the
   * cost in the type rather than in a comment on a `setPalette` that would have
   * to dispose behind the caller's back.
   */
  create(host: HTMLElement, palette: ChartPalette): ChartInstance;
}

/**
 * A validated spec plus a resolved palette, as one paintable option.
 *
 * Pure and total. It is the whole of the translation from "what the publisher
 * asked for" to "what a renderer draws", which is why it lives here beside the
 * interface and not inside an adapter: every renderer needs exactly this, and a
 * second renderer deriving it again would be a second place for the colour
 * rotation to drift.
 */
export function buildChartOption(spec: ChartSpec, palette: ChartPalette): ChartOption {
  return Object.freeze({
    kind: spec.kind,
    title: spec.title,
    xLabel: spec.xLabel,
    yLabel: spec.yLabel,
    categories: spec.categories,
    series: Object.freeze(
      spec.series.map((series) =>
        Object.freeze({
          name: series.name,
          kind: spec.kind,
          values: series.values,
          color: seriesColor(palette, series.colorIndex),
          dash: series.dash,
          marker: series.marker,
        }),
      ),
    ),
  });
}
