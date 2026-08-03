import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { buildChartOption } from '../../core/chart/ChartRenderer';
import type { ChartInstance, ChartOption, ChartRenderer } from '../../core/chart/ChartRenderer';
import { buildChartPalette } from '../../core/chart/chartPalette';
import type { ChartSpec } from '../../core/chart/chartSpec';
import type { ResolvedTheme } from '../../core/theme/normalizeTheme';
import { useElementWidth } from '../../hooks/useElementWidth';
import { ChartDataTable } from './ChartDataTable';

/**
 * ============================================================================
 * ONE WRAPPER. NO CONSUMER TOUCHES A CHART LIBRARY, EVER.
 * ============================================================================
 * §3.3 puts Apache ECharts at tier 1 and then asks for the wrapper to be written
 * so the renderer is swappable. This is that wrapper, and the swap point is the
 * `renderer` prop: a `ChartRenderer` from `src/core/chart/ChartRenderer.ts`,
 * which knows nothing about any library. `echartsRenderer` is what production
 * passes; a recorder is what the tests pass; a uPlot adapter at tier 2 would be
 * a third with no change here.
 *
 * ---------------------------------------------------------------------------
 * THE THEME CHANGE COSTS A DISPOSE AND AN INIT. THE COST IS STATED, NOT HIDDEN.
 * ---------------------------------------------------------------------------
 * ECharts registers a theme at `init` and has no way to swap it on a live
 * instance — risk R7 in the pivot plan. So the lifetime of a chart instance is
 * exactly the lifetime of a palette, and that is expressed in the code rather
 * than in a comment: the palette is a parameter of `ChartRenderer.create`, and
 * the effect that builds an instance lists it in its dependencies. **A theme
 * change therefore destroys and rebuilds every chart in the document.**
 *
 * What is preserved across that is the OPTION. `optionRef` holds the last
 * option built, and the newly created instance is handed it inside the same
 * effect, before the browser paints — so the user sees a repaint, not a blank
 * frame followed by data. What is NOT preserved is anything the user did to the
 * instance: a zoom, a pan, a legend item toggled off. ECharts holds that state
 * inside the instance and `dispose()` takes it. That is the honest cost of R7
 * and it is why this must never happen on a data update.
 *
 * A DATA update is the other path, and it is cheap: `setOption` on the live
 * instance, no teardown. The two are separate effects for exactly that reason —
 * one keyed on the palette, one on the option — and a single effect listing both
 * would silently turn every data tick into a full rebuild.
 *
 * ---------------------------------------------------------------------------
 * WIDTH COMES FROM AN OBSERVER, NEVER FROM `window.onresize`
 * ---------------------------------------------------------------------------
 * `useElementWidth` (§4.3) observes the host element. A `window` resize handler
 * would be an ambient listener requiring an entry in `KEY_EVENT_ALLOWLIST`'s
 * sibling scan in `src/__tests__/noEventListener.test.ts` — an allowlist whose
 * whole value is that it is hard to get into — and it would also be WRONG: a
 * pane divider drag changes this element's width without changing the window's.
 *
 * The hook reports `null` where there is no `ResizeObserver`, which is every
 * jsdom test and some older embedded WebViews. The chart then keeps whatever
 * size it was built at, which is the same answer the shell gave before the hook
 * existed.
 *
 * ---------------------------------------------------------------------------
 * NO BOX, NO INSTANCE — AND THAT IS A PRODUCTION RULE, NOT A TEST ACCOMMODATION
 * ---------------------------------------------------------------------------
 * **A canvas renderer cannot size itself from a zero box.** ECharts says so out
 * loud — "Can't get DOM width or height... they should not be 0" — and then
 * fails. Three real situations produce that: a chart mounted inside a pane the
 * user has collapsed, a chart mounted before its container has been laid out,
 * and jsdom, where `getBoundingClientRect` returns 0x0 for everything and there
 * is no 2D context to draw into either.
 *
 * So the instance is not built until the host element reports a box. Until then
 * the figure renders its container and its data TABLE and nothing else, which is
 * the honest state: there is no chart, and the numbers are still readable. When
 * a box appears — the observer fires, or the pane is expanded — the instance is
 * built with the option already preserved.
 *
 * The measurement is `getBoundingClientRect` on the host rather than the hook's
 * width, because the hook reports `null` on a runtime with no `ResizeObserver`
 * and such a runtime still has a real layout. The hook's width is a DEPENDENCY
 * of the measurement, not the measurement itself.
 *
 * **`renderer.isSupported()` is the second half of the same rule.** A box is not
 * enough: a canvas engine also needs a 2D context, and jsdom has none. Both
 * questions are asked in one place and both answer the same way — no instance,
 * and the data table still on the page.
 *
 * ---------------------------------------------------------------------------
 * ACCESSIBILITY, STATED EXACTLY
 * ---------------------------------------------------------------------------
 * **The canvas is `aria-hidden` and that is deliberate.** A canvas is opaque to
 * assistive technology: it has no children and no text, and labelling it would
 * announce a name for a picture whose content stays unreadable. Hiding it and
 * publishing `ChartDataTable` beside it means a screen reader gets THE DATA
 * rather than a promise of it.
 *
 * What that does not fix, and nothing here claims to: the chart is not
 * KEYBOARD-operable. There is no way to tab to a data point, no focusable
 * legend, no keyboard zoom. A user who cannot use a pointer can read every
 * number in the table and cannot interact with the plot. That is a real gap, it
 * is recorded here rather than in a backlog, and closing it is a DOM-overlay
 * problem that a canvas renderer makes harder rather than easier.
 *
 * *Tests:* `src/components/chart/__tests__/Chart.test.tsx` — "builds exactly one
 * instance and hands it the option", "disposes and re-initialises on a theme
 * change, and re-applies the preserved option", "applies a data change to the
 * live instance without disposing it", "resizes from the observer rather than
 * from a window listener", "publishes the data as a table and hides the canvas
 * from assistive technology", "disposes the instance when it unmounts",
 * "builds no instance at all where the host element has no box" and "builds no
 * instance where the engine says the runtime cannot support it".
 * ============================================================================
 */

export interface ChartProps {
  /** A spec that has already been through `normalizeChartSpec`. */
  readonly spec: ChartSpec;
  /**
   * The resolved semantic token set, from `ThemeBridge.getTheme()`.
   *
   * Its IDENTITY is what drives the rebuild, so it must be the bridge's own
   * frozen record and never a fresh object built per render — one of those would
   * dispose and re-init every chart on every render of the ledger.
   */
  readonly theme: ResolvedTheme;
  /** The engine. Required, so nothing defaults its way into importing a library. */
  readonly renderer: ChartRenderer;
}

/** A chart, its accessible table, and nothing else. */
export function Chart({ spec, theme, renderer }: ChartProps): ReactElement {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [isMeasured, setMeasured] = useState(false);
  const { width, ref: observe } = useElementWidth();
  const instanceRef = useRef<ChartInstance | null>(null);
  const appliedRef = useRef<ChartOption | null>(null);

  const palette = useMemo(() => buildChartPalette(theme), [theme]);
  const option = useMemo(() => buildChartOption(spec, palette), [spec, palette]);

  // The option the instance should hold RIGHT NOW, readable from an effect that
  // does not depend on it. Written during render, which is safe because it is
  // the value this render already computed — not a subscription, not a cache.
  const optionRef = useRef(option);
  optionRef.current = option;

  /**
   * One callback ref feeding two consumers.
   *
   * `observe`'s identity is stable for the component's whole lifetime — that is
   * the property `useElementWidth` documents and exists for — so this is stable
   * too, and React attaches it once instead of tearing the observer down on
   * every render.
   */
  const attach = useCallback(
    (element: HTMLDivElement | null): void => {
      setHost(element);
      observe(element);
    },
    [observe],
  );

  // MEASUREMENT. Re-run whenever the element or the observed width moves, so a
  // pane expanded from zero produces a chart rather than staying empty.
  useEffect(() => {
    setMeasured(host !== null && host.getBoundingClientRect().width >= 1);
  }, [host, width]);

  // LIFETIME. Keyed on the palette, because that is what ECharts can only be
  // told at `init`. The preserved option is applied inside the same effect.
  useEffect(() => {
    if (host === null || !isMeasured || !renderer.isSupported()) {
      return;
    }
    const instance = renderer.create(host, palette);
    instanceRef.current = instance;
    appliedRef.current = optionRef.current;
    instance.setOption(optionRef.current);
    return (): void => {
      instanceRef.current = null;
      appliedRef.current = null;
      instance.dispose();
    };
  }, [host, isMeasured, renderer, palette]);

  // DATA. Cheap, and never a teardown. The `appliedRef` check is what keeps a
  // theme change at exactly one `setOption`: the effect above already applied
  // this very object, so this one has nothing to do.
  useEffect(() => {
    const instance = instanceRef.current;
    if (instance === null || appliedRef.current === option) {
      return;
    }
    appliedRef.current = option;
    instance.setOption(option);
  }, [option]);

  // SIZE. From the observer. `instance === null` is read first so that the very
  // first render — no host, no width — exercises it rather than short-circuiting
  // on the width and leaving a branch nothing reaches.
  useEffect(() => {
    const instance = instanceRef.current;
    if (instance === null || width === null) {
      return;
    }
    instance.resize();
  }, [width]);

  return (
    <figure
      data-chart-figure={spec.title}
      className="flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden"
    >
      {/*
        The canvas host. `aria-hidden`, because a canvas has nothing an
        assistive technology can read and pretending otherwise is worse than
        admitting it. The table below carries the content.
      */}
      <div
        ref={attach}
        data-chart-canvas={renderer.id}
        aria-hidden="true"
        className="min-h-[160px] w-full flex-1"
      />
      <figcaption className="sr-only">{spec.title}</figcaption>
      <ChartDataTable spec={spec} className="sr-only" />
    </figure>
  );
}
