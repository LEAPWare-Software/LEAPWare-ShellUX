import { describe, expect, it } from 'vitest';
import { CHART_KINDS, CHART_LIMITS, normalizeChartSpec } from '../chartSpec';
import { ShellUXError } from '../../types';

/**
 * ============================================================================
 * THE CHART SPEC TRUST BOUNDARY
 * ============================================================================
 * `normalizeChartSpec` is the runtime half of "a series with a colour and no
 * second channel is not representable". The TYPE half is checked by `tsc` and
 * cannot be checked here — a test that constructs an illegal series would not
 * compile, which is the property, so what this file proves is the other half:
 * that a spec arriving as `data: unknown` through `publishPayload` is held to
 * the same rule the compiler holds a literal to.
 * ============================================================================
 */

/** The smallest valid spec, as a plain object — which is how one really arrives. */
function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'line',
    title: 'Throughput',
    series: [{ name: 'requests', values: [1, 2, 3] }],
    ...overrides,
  };
}

/** The thrown error, or a failure if nothing was thrown. */
function rejectionOf(candidate: unknown): ShellUXError {
  try {
    normalizeChartSpec(candidate);
  } catch (error) {
    return error as ShellUXError;
  }
  throw new Error('normalizeChartSpec accepted a spec it was expected to reject.');
}

describe('normalizeChartSpec — what it accepts', () => {
  it('assigns all three encoding channels from series order, and no colour', () => {
    const spec = normalizeChartSpec(
      minimal({
        series: [
          { name: 'a', values: [1, 2, 3] },
          { name: 'b', values: [3, 2, 1] },
          { name: 'c', values: [2, 2, 2] },
          { name: 'd', values: [0, 0, 0] },
        ],
      }),
    );

    expect(spec.series.map((series) => series.colorIndex)).toEqual([1, 2, 3, 4]);
    expect(spec.series.map((series) => series.dash)).toEqual([
      'solid',
      'dashed',
      'dotted',
      'solid',
    ]);
    expect(spec.series.map((series) => series.marker)).toEqual([
      'circle',
      'square',
      'triangle',
      'diamond',
    ]);
    // The word "color" appears nowhere on a normalised series. This is the
    // runtime restatement of a compile-time fact, and it is worth having: the
    // publisher's object could have carried one, and none of it is retained.
    for (const series of spec.series) {
      expect(Object.keys(series)).toEqual(['name', 'values', 'colorIndex', 'dash', 'marker']);
    }
  });

  it('labels the x axis with ordinals when the publisher supplied none', () => {
    const spec = normalizeChartSpec(minimal());
    expect(spec.categories).toEqual(['1', '2', '3']);
    // A labelling default, not a data default: the host names positions it can
    // count and invents no scale.
    expect(spec.series[0]?.values).toEqual([1, 2, 3]);
  });

  it('keeps the publisher’s own categories when they are supplied', () => {
    const spec = normalizeChartSpec(minimal({ categories: ['Jan', 'Feb', 'Mar'] }));
    expect(spec.categories).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('fills the optional axis labels with the empty string rather than a guess', () => {
    const spec = normalizeChartSpec(minimal());
    expect(spec.xLabel).toBe('');
    expect(spec.yLabel).toBe('');

    const labelled = normalizeChartSpec(minimal({ xLabel: 'month', yLabel: 'requests' }));
    expect(labelled.xLabel).toBe('month');
    expect(labelled.yLabel).toBe('requests');
  });

  it('retains nothing of the caller’s object graph', () => {
    const series = { name: 'a', values: [1, 2, 3] };
    const candidate = minimal({ series: [series] });
    const spec = normalizeChartSpec(candidate);

    expect(spec.series[0]).not.toBe(series);
    expect(spec.series[0]?.values).not.toBe(series.values);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.series)).toBe(true);
    expect(Object.isFrozen(spec.series[0]?.values)).toBe(true);

    // Mutating the caller's array after the fact moves nothing the host holds.
    series.values.push(99);
    expect(spec.series[0]?.values).toEqual([1, 2, 3]);
  });

  it('accepts every kind in the closed vocabulary and nothing else', () => {
    for (const kind of CHART_KINDS) {
      expect(normalizeChartSpec(minimal({ kind })).kind).toBe(kind);
    }
    expect(rejectionOf(minimal({ kind: 'pie' })).field).toBe('kind');
  });
});

describe('normalizeChartSpec — what it refuses', () => {
  it('refuses a series carrying a colour, on sight and by name', () => {
    // THE RUNTIME HALF. The compiler stops this at a literal; `publishPayload`
    // hands over `unknown`, so the compiler was never in this loop.
    const rejection = rejectionOf(
      minimal({ series: [{ name: 'a', values: [1], color: '#ff0000' }] }),
    );
    expect(rejection).toBeInstanceOf(ShellUXError);
    expect(rejection.code).toBe('INVALID_FIELD');
    expect(rejection.field).toBe('series[0].color');
    expect(rejection.message).toContain('colour alone');
  });

  it('refuses a thirteenth series rather than reusing every channel of the first', () => {
    const thirteen = Array.from({ length: 13 }, (_unused, index) => ({
      name: `s${String(index)}`,
      values: [1],
    }));
    // Twelve is fine, and is the number of validated colour tokens.
    expect(normalizeChartSpec(minimal({ series: thirteen.slice(0, 12) })).series).toHaveLength(
      CHART_LIMITS.MAX_SERIES,
    );
    const rejection = rejectionOf(minimal({ series: thirteen }));
    expect(rejection.field).toBe('series');
    // The reason, not just the bound: 12, 3 and 4 have an LCM of 12, so series
    // 13 would repeat series 1 in colour, dash AND marker simultaneously.
    expect(rejection.message).toContain('period 12');
  });

  it('refuses a ragged chart even when the publisher labelled no axis', () => {
    const rejection = rejectionOf(
      minimal({
        series: [
          { name: 'a', values: [1, 2, 3] },
          { name: 'b', values: [1, 2] },
        ],
      }),
    );
    expect(rejection.field).toBe('series[1].values');
    expect(rejection.message).toContain('x axis');
  });

  it('refuses a series that disagrees with the categories it was given', () => {
    expect(rejectionOf(minimal({ categories: ['a', 'b'] })).field).toBe('series[0].values');
  });

  it('refuses anything that is not a plain object, with INVALID_PAYLOAD', () => {
    for (const candidate of [null, undefined, 'chart', 42, [], true]) {
      const rejection = rejectionOf(candidate);
      expect(rejection.code).toBe('INVALID_PAYLOAD');
      expect(rejection.field).toBeNull();
    }
  });

  it('refuses a non-finite point, because an axis cannot place one', () => {
    expect(rejectionOf(minimal({ series: [{ name: 'a', values: [1, Number.NaN] }] })).field).toBe(
      'series[0].values',
    );
    expect(
      rejectionOf(minimal({ series: [{ name: 'a', values: [Number.POSITIVE_INFINITY] }] })).field,
    ).toBe('series[0].values');
    expect(rejectionOf(minimal({ series: [{ name: 'a', values: ['3'] }] })).field).toBe(
      'series[0].values',
    );
  });

  it('refuses an empty or oversized series list, an empty series and an empty axis', () => {
    expect(rejectionOf(minimal({ series: [] })).field).toBe('series');
    expect(rejectionOf(minimal({ series: 'a' })).field).toBe('series');
    expect(rejectionOf(minimal({ series: [42] })).field).toBe('series[0]');
    expect(rejectionOf(minimal({ series: [null] })).field).toBe('series[0]');
    expect(rejectionOf(minimal({ series: [[1, 2]] })).field).toBe('series[0]');
    expect(rejectionOf(minimal({ series: [{ name: 'a', values: [] }] })).field).toBe(
      'series[0].values',
    );
    expect(rejectionOf(minimal({ series: [{ name: 'a', values: 3 }] })).field).toBe(
      'series[0].values',
    );
    expect(rejectionOf(minimal({ categories: [] })).field).toBe('categories');
    expect(rejectionOf(minimal({ categories: 'Jan' })).field).toBe('categories');
    expect(rejectionOf(minimal({ categories: [7] })).field).toBe('categories[0]');
  });

  it('refuses missing and oversized display text everywhere it appears', () => {
    const long = 'x'.repeat(CHART_LIMITS.MAX_TEXT_LENGTH + 1);
    expect(rejectionOf(minimal({ title: undefined })).field).toBe('title');
    expect(rejectionOf(minimal({ title: 7 })).field).toBe('title');
    expect(rejectionOf(minimal({ title: long })).field).toBe('title');
    expect(rejectionOf(minimal({ xLabel: 7 })).field).toBe('xLabel');
    expect(rejectionOf(minimal({ yLabel: long })).field).toBe('yLabel');
    expect(rejectionOf(minimal({ series: [{ values: [1] }] })).field).toBe('series[0].name');
  });

  it('refuses more points than the payload channel could ever have carried', () => {
    const tooMany = new Array<number>(CHART_LIMITS.MAX_POINTS + 1).fill(1);
    expect(rejectionOf(minimal({ series: [{ name: 'a', values: tooMany }] })).field).toBe(
      'series[0].values',
    );
    expect(
      rejectionOf(minimal({ categories: new Array<string>(CHART_LIMITS.MAX_POINTS + 1).fill('a') }))
        .field,
    ).toBe('categories');
  });

  it('reads only its own properties, so an inherited colour is neither read nor honoured', () => {
    // A prototype carrying `color` is not the publisher's own property, so the
    // spec is accepted — and the host's rotation is what the series ends up
    // with. `hasOwnProperty` rather than `in` is what makes that true.
    const series = Object.create({ color: '#ff0000' }) as Record<string, unknown>;
    series['name'] = 'a';
    series['values'] = [1, 2];
    const spec = normalizeChartSpec(minimal({ series: [series] }));
    expect(spec.series[0]?.colorIndex).toBe(1);
    expect(Object.keys(spec.series[0] ?? {})).not.toContain('color');
  });
});
