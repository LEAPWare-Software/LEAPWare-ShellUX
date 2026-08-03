import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ============================================================================
 * THE ADAPTER, WITH THE LIBRARY REPLACED BY A RECORDER
 * ============================================================================
 * **jsdom has no canvas 2D context, so a real ECharts instance cannot be built
 * under vitest.** Shimming one would be a large fake whose fidelity nobody could
 * check; the honest move is to replace the four functions this adapter actually
 * calls and assert the SHAPE and ORDER of the calls.
 *
 * What that proves: the tree-shaking list is registered, a theme is registered
 * BEFORE `init` (the order is the whole of R7's workaround), the option handed
 * to `setOption` carries the resolved colours and both extra channels, and
 * `dispose` reaches the instance.
 *
 * What it does not prove, stated because it matters: that anything is painted.
 * `e2e/` is the only lane that can see a pixel, and this file's claims stop at
 * the library's front door.
 * ============================================================================
 */

vi.mock('echarts/core', () => ({
  init: vi.fn(),
  registerTheme: vi.fn(),
  use: vi.fn(),
}));
vi.mock('echarts/charts', () => ({
  LineChart: 'LineChart',
  BarChart: 'BarChart',
  ScatterChart: 'ScatterChart',
}));
vi.mock('echarts/components', () => ({
  AriaComponent: 'AriaComponent',
  GridComponent: 'GridComponent',
  LegendComponent: 'LegendComponent',
  TitleComponent: 'TitleComponent',
  TooltipComponent: 'TooltipComponent',
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: 'CanvasRenderer' }));

const { init, registerTheme, use } = await import('echarts/core');
const { THEME_NAME, echartsRenderer, toEChartsOption, toEChartsTheme } = await import(
  '../echartsRenderer'
);
const { buildChartOption } = await import('../ChartRenderer');
const { buildChartPalette } = await import('../chartPalette');
const { normalizeChartSpec } = await import('../chartSpec');
const { markedTheme } = await import('./palette');

/** A stand-in for a live ECharts instance. */
function fakeInstance() {
  return { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
}

function sampleOption(kind: 'line' | 'bar' = 'line') {
  return buildChartOption(
    normalizeChartSpec({
      kind,
      title: 'Throughput',
      xLabel: 'month',
      yLabel: 'requests',
      categories: ['Jan', 'Feb'],
      series: [
        { name: 'a', values: [1, 2] },
        { name: 'b', values: [3, 4] },
        { name: 'c', values: [5, 6] },
      ],
    }),
    buildChartPalette(markedTheme()),
  );
}

describe('echartsRenderer — the pure translation', () => {
  it('puts the chrome colours in the theme and the series colours nowhere near it', () => {
    const theme = toEChartsTheme(buildChartPalette(markedTheme()));

    expect(theme['backgroundColor']).toBe('transparent');
    expect(JSON.stringify(theme)).toContain('value-of--chart-grid');
    expect(JSON.stringify(theme)).toContain('value-of--chart-tooltip-bg');
    // A theme-level colour LIST would be consumed in series order, so a
    // reordered chart would silently repaint. `colorIndex` belongs to a series,
    // so the option carries it and the theme must not.
    expect(theme['color']).toBeUndefined();
    expect(JSON.stringify(theme)).not.toContain('value-of--chart-1"');
  });

  it('maps every host channel onto an ECharts one, and never animates', () => {
    const option = toEChartsOption(sampleOption('bar')) as Record<string, unknown>;
    const series = option['series'] as Record<string, unknown>[];

    // §3.7's motion budget: a payload that republishes on a timer would never
    // be still if the chart animated.
    expect(option['animation']).toBe(false);
    expect(series.map((entry) => entry['type'])).toEqual(['bar', 'bar', 'bar']);
    expect(series.map((entry) => entry['symbol'])).toEqual(['circle', 'rect', 'triangle']);
    expect((series[0]?.['itemStyle'] as Record<string, unknown>)['color']).toBe(
      'value-of--chart-1',
    );
    // The dash is expressed TWICE, because a dashed stroke says nothing on a
    // bar: as a line type for lines, and as a decal for filled areas.
    expect((series[1]?.['lineStyle'] as Record<string, unknown>)['type']).toBe('dashed');
    expect((series[0]?.['itemStyle'] as Record<string, unknown>)['decal']).toBeNull();
    expect((series[1]?.['itemStyle'] as Record<string, unknown>)['decal']).not.toBeNull();
    expect((option['xAxis'] as Record<string, unknown>)['data']).toEqual(['Jan', 'Feb']);
    expect((option['yAxis'] as Record<string, unknown>)['name']).toBe('requests');
    expect((option['title'] as Record<string, unknown>)['text']).toBe('Throughput');
    expect((option['legend'] as Record<string, unknown>)['data']).toEqual(['a', 'b', 'c']);
  });

  it('maps a line chart onto the line series type', () => {
    const option = toEChartsOption(sampleOption('line')) as Record<string, unknown>;
    const series = option['series'] as Record<string, unknown>[];
    expect(series.every((entry) => entry['type'] === 'line')).toBe(true);
  });
});

describe('echartsRenderer — the four calls it makes', () => {
  beforeEach(() => {
    vi.mocked(init).mockReset();
    vi.mocked(registerTheme).mockReset();
  });

  it('registers exactly the tree-shaken feature list at module scope', () => {
    // Not the whole library. This list IS the bundle cost, so it is asserted
    // rather than left as a claim in a docblock.
    expect(vi.mocked(use)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(use).mock.calls[0]?.[0]).toEqual([
      'LineChart',
      'BarChart',
      'ScatterChart',
      'GridComponent',
      'TitleComponent',
      'TooltipComponent',
      'LegendComponent',
      'AriaComponent',
      'CanvasRenderer',
    ]);
  });

  it('registers the theme BEFORE init, which is the whole of the R7 workaround', () => {
    const order: string[] = [];
    vi.mocked(registerTheme).mockImplementation(() => {
      order.push('registerTheme');
    });
    vi.mocked(init).mockImplementation(() => {
      order.push('init');
      return fakeInstance() as never;
    });

    echartsRenderer.create(document.createElement('div'), buildChartPalette(markedTheme()));

    // ECharts reads a theme at `init` and has no setter, so registering after
    // would produce a chart wearing the PREVIOUS theme — the exact silent
    // failure R7 warns about.
    expect(order).toEqual(['registerTheme', 'init']);
    expect(vi.mocked(registerTheme).mock.calls[0]?.[0]).toBe(THEME_NAME);
    expect(vi.mocked(init).mock.calls[0]?.[1]).toBe(THEME_NAME);
    expect(vi.mocked(init).mock.calls[0]?.[2]).toEqual({ renderer: 'canvas' });
  });

  it('forwards setOption, resize and dispose to the instance, and never merges', () => {
    const live = fakeInstance();
    vi.mocked(init).mockReturnValue(live as never);

    const instance = echartsRenderer.create(
      document.createElement('div'),
      buildChartPalette(markedTheme()),
    );
    instance.setOption(sampleOption());
    instance.resize();
    instance.dispose();

    expect(live.setOption).toHaveBeenCalledTimes(1);
    // `notMerge`. A merge would leave a series on screen after the publisher
    // removed it, which is a chart claiming data that is gone.
    expect(live.setOption.mock.calls[0]?.[1]).toBe(true);
    expect(live.resize).toHaveBeenCalledTimes(1);
    expect(live.dispose).toHaveBeenCalledTimes(1);
  });

  it('names itself, so an inspector can say which engine drew', () => {
    expect(echartsRenderer.id).toBe('echarts');
    expect(Object.isFrozen(echartsRenderer)).toBe(true);
  });
});
