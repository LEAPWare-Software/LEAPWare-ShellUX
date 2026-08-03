import { describe, expect, it } from 'vitest';
import { buildChartOption } from '../ChartRenderer';
import { buildChartPalette } from '../chartPalette';
import { normalizeChartSpec } from '../chartSpec';
import { markedTheme } from './palette';

/**
 * ============================================================================
 * SPEC + PALETTE → OPTION, WHICH IS WHERE A `colorIndex` FINALLY BECOMES PAINT
 * ============================================================================
 * This is the whole translation every renderer shares. It is pure, so it is
 * tested without a DOM, without a canvas and without a library — which is the
 * reason it lives beside the `ChartRenderer` interface rather than inside an
 * adapter.
 * ============================================================================
 */

function threeSeries() {
  return normalizeChartSpec({
    kind: 'bar',
    title: 'Stock',
    xLabel: 'sku',
    yLabel: 'units',
    categories: ['a', 'b'],
    series: [
      { name: 'on hand', values: [1, 2] },
      { name: 'reserved', values: [3, 4] },
      { name: 'inbound', values: [5, 6] },
    ],
  });
}

describe('buildChartOption', () => {
  it('resolves every series colour from the palette, in colorIndex order', () => {
    const option = buildChartOption(threeSeries(), buildChartPalette(markedTheme()));

    expect(option.series.map((series) => series.color)).toEqual([
      'value-of--chart-1',
      'value-of--chart-2',
      'value-of--chart-3',
    ]);
  });

  it('carries the second and third channels through to the option', () => {
    const option = buildChartOption(threeSeries(), buildChartPalette(markedTheme()));

    // Without these a bar chart of three series would be three colours and
    // nothing else, which is the WCAG 1.4.1 failure the rotation exists to
    // prevent. They are asserted here as well as in `chartSpec.test.ts`,
    // because this is the step that could drop them on the way to a renderer.
    expect(option.series.map((series) => series.dash)).toEqual(['solid', 'dashed', 'dotted']);
    expect(option.series.map((series) => series.marker)).toEqual([
      'circle',
      'square',
      'triangle',
    ]);
  });

  it('carries the chart’s own kind onto every series, and the axis labels through', () => {
    const option = buildChartOption(threeSeries(), buildChartPalette(markedTheme()));

    expect(option.kind).toBe('bar');
    expect(option.series.every((series) => series.kind === 'bar')).toBe(true);
    expect(option.xLabel).toBe('sku');
    expect(option.yLabel).toBe('units');
    expect(option.categories).toEqual(['a', 'b']);
    expect(option.title).toBe('Stock');
  });

  it('freezes the option and every series in it', () => {
    const option = buildChartOption(threeSeries(), buildChartPalette(markedTheme()));

    expect(Object.isFrozen(option)).toBe(true);
    expect(Object.isFrozen(option.series)).toBe(true);
    expect(Object.isFrozen(option.series[0])).toBe(true);
  });
});
