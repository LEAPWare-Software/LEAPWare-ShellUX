import { describe, expect, it } from 'vitest';
import { CHART_COLOR_COUNT, buildChartPalette, seriesColor } from '../chartPalette';
import { markedTheme } from './palette';

/**
 * ============================================================================
 * THE INDEX-TO-COLOUR STEP, WHICH IS THE ONLY PLACE A COLOUR APPEARS AT ALL
 * ============================================================================
 * Every value below is a marker string naming the token it came from rather
 * than a colour, so an assertion here says WHICH custom property the palette
 * read. A hex in this file would prove less and would put a colour literal
 * under `src/`, which `noRawColor.test.ts` rejects for exactly the reason it
 * would be wrong here: a colour that the generated stylesheet never emitted.
 * ============================================================================
 */

describe('buildChartPalette', () => {
  it('resolves a series colour from its index and nothing else', () => {
    const palette = buildChartPalette(markedTheme());

    expect(palette.series).toHaveLength(CHART_COLOR_COUNT);
    expect(seriesColor(palette, 1)).toBe('value-of--chart-1');
    expect(seriesColor(palette, 7)).toBe('value-of--chart-7');
    expect(seriesColor(palette, CHART_COLOR_COUNT)).toBe('value-of--chart-12');
  });

  it('clamps an out-of-range index into the twelve tokens rather than painting nothing', () => {
    const palette = buildChartPalette(markedTheme());

    // `normalizeChartSpec` cannot emit any of these — it refuses a thirteenth
    // series — so this is about the other callers: an inspector or a legend
    // reading an index off a stored spec. Every answer is a COLOUR; none is
    // `undefined`, which a canvas would paint as nothing at all.
    expect(seriesColor(palette, 13)).toBe('value-of--chart-1');
    expect(seriesColor(palette, 25)).toBe('value-of--chart-1');
    expect(seriesColor(palette, 0)).toBe('value-of--chart-12');
    expect(seriesColor(palette, -1)).toBe('value-of--chart-11');
    expect(seriesColor(palette, 3.7)).toBe('value-of--chart-3');
  });

  it('reads every chrome colour from the resolved theme', () => {
    const palette = buildChartPalette(markedTheme());

    expect(palette.grid).toBe('value-of--chart-grid');
    expect(palette.axis).toBe('value-of--chart-axis');
    expect(palette.label).toBe('value-of--chart-label');
    expect(palette.tooltipBackground).toBe('value-of--chart-tooltip-bg');
    expect(palette.tooltipText).toBe('value-of--chart-tooltip-text');
    expect(palette.crosshair).toBe('value-of--chart-crosshair');
    expect(palette.positive).toBe('value-of--chart-positive');
    expect(palette.negative).toBe('value-of--chart-negative');
  });

  it('freezes what it hands out, so a chart cannot repaint the palette', () => {
    const palette = buildChartPalette(markedTheme());
    expect(Object.isFrozen(palette)).toBe(true);
    expect(Object.isFrozen(palette.series)).toBe(true);
  });
});
