import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeChartSpec } from '../../../core/chart/chartSpec';
import type { ChartSpec } from '../../../core/chart/chartSpec';
import { EMPTY_THEME } from '../../../core/theme/normalizeTheme';
import type { ResolvedTheme } from '../../../core/theme/normalizeTheme';
import { Chart } from '../Chart';
import { createFakeRenderer } from './fakeRenderer';

/**
 * ============================================================================
 * THE WRAPPER'S LIFETIME RULES, WHICH ARE THE WHOLE OF R7
 * ============================================================================
 * ECharts cannot swap a registered theme on a live instance, so the wrapper has
 * two paths and they cost wildly different amounts: a THEME change disposes and
 * re-initialises every chart in the document, and a DATA change does not. A
 * single effect listing both dependencies would silently make every data tick a
 * full rebuild, and nothing on screen would say so.
 *
 * That is why the assertions below are on an ORDERED LOG of every call rather
 * than on counts. "Did it init after the theme changed?" passes for a wrapper
 * that re-inits on every render; "was the log exactly dispose, create,
 * setOption?" does not.
 *
 * No canvas is involved. jsdom has no 2D context, so `createFakeRenderer` stands
 * in for the library — see `src/core/chart/ChartRenderer.ts` for why that seam
 * exists and `e2e/` for the lane that can see a pixel.
 * ============================================================================
 */

/** A resolved theme whose chart tokens name themselves, keyed by a marker. */
function themeMarked(marker: string): ResolvedTheme {
  const record: Record<string, string> = { ...EMPTY_THEME };
  for (const name of Object.keys(record)) {
    record[name] = `${marker}${name}`;
  }
  return Object.freeze(record) as ResolvedTheme;
}

function spec(title = 'Throughput', values: readonly number[] = [1, 2, 3]): ChartSpec {
  return normalizeChartSpec({
    kind: 'line',
    title,
    xLabel: 'month',
    yLabel: 'requests',
    series: [{ name: 'requests', values }],
  });
}

/** A controllable stand-in for the platform `ResizeObserver`. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {
    /* nothing to record: the width comes from getBoundingClientRect */
  }
  disconnect(): void {
    /* nothing to record */
  }
  fire(): void {
    this.callback();
  }
}

type WithObserver = { ResizeObserver?: unknown };

function installObserver(): () => void {
  FakeResizeObserver.instances = [];
  (globalThis as WithObserver).ResizeObserver = FakeResizeObserver;
  return (): void => {
    delete (globalThis as WithObserver).ResizeObserver;
  };
}

function stubWidth(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 400,
    top: 0,
    left: 0,
    right: width,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as WithObserver).ResizeObserver;
});

describe('Chart — the instance lifetime', () => {
  // Every test in this group stubs a box, because a chart with no box is not
  // built at all — see "builds no instance at all where the host element has no
  // box" below, and the banner in `Chart.tsx` for why that is a production rule
  // rather than an accommodation for jsdom.
  beforeEach(() => {
    stubWidth(800);
  });

  it('builds exactly one instance and hands it the option', () => {
    const fake = createFakeRenderer();
    render(<Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />);

    expect(fake.log).toEqual(['create:div', 'setOption:Throughput']);
    expect(fake.live()).toBe(1);
    // The palette reached the renderer already resolved: a canvas cannot read a
    // custom property, so anything else here would paint nothing.
    expect(fake.palettes[0]?.series[0]).toBe('light:--chart-1');
    expect(fake.options[0]?.series[0]?.color).toBe('light:--chart-1');
  });

  it('disposes and re-initialises on a theme change, and re-applies the preserved option', () => {
    const fake = createFakeRenderer();
    const one = spec();
    const { rerender } = render(
      <Chart spec={one} theme={themeMarked('light:')} renderer={fake.renderer} />,
    );
    fake.log.length = 0;

    rerender(<Chart spec={one} theme={themeMarked('dark:')} renderer={fake.renderer} />);

    // EXACTLY this, in exactly this order. The dispose comes first, so two
    // instances never hold the same host element; the `setOption` comes inside
    // the same effect, so the user sees a repaint and not a blank frame.
    expect(fake.log).toEqual(['dispose', 'create:div', 'setOption:Throughput']);
    expect(fake.live()).toBe(1);
    // The option was PRESERVED across the rebuild — same data, new colours.
    expect(fake.options.at(-1)?.series[0]?.color).toBe('dark:--chart-1');
    expect(fake.options.at(-1)?.series[0]?.values).toEqual([1, 2, 3]);
  });

  it('applies a data change to the live instance without disposing it', () => {
    const fake = createFakeRenderer();
    const theme = themeMarked('light:');
    const { rerender } = render(
      <Chart spec={spec('Throughput')} theme={theme} renderer={fake.renderer} />,
    );
    fake.log.length = 0;

    rerender(<Chart spec={spec('Latency', [9, 8, 7])} theme={theme} renderer={fake.renderer} />);

    // One call, no teardown. If this ever reads `dispose, create, setOption`
    // the two effects have been merged and every data tick costs a rebuild.
    expect(fake.log).toEqual(['setOption:Latency']);
    expect(fake.live()).toBe(1);
  });

  it('does nothing at all when neither the data nor the theme moved', () => {
    const fake = createFakeRenderer();
    const one = spec();
    const theme = themeMarked('light:');
    const { rerender } = render(<Chart spec={one} theme={theme} renderer={fake.renderer} />);
    fake.log.length = 0;

    rerender(<Chart spec={one} theme={theme} renderer={fake.renderer} />);
    expect(fake.log).toEqual([]);
  });

  it('disposes the instance when it unmounts', () => {
    const fake = createFakeRenderer();
    const { unmount } = render(
      <Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />,
    );
    unmount();

    expect(fake.log.at(-1)).toBe('dispose');
    expect(fake.live()).toBe(0);
  });

  it('rebuilds when the renderer itself is swapped, which is the tier-2 path', () => {
    const first = createFakeRenderer('fake-a');
    const second = createFakeRenderer('fake-b');
    const theme = themeMarked('light:');
    const one = spec();
    const { rerender, container } = render(
      <Chart spec={one} theme={theme} renderer={first.renderer} />,
    );

    rerender(<Chart spec={one} theme={theme} renderer={second.renderer} />);

    expect(first.live()).toBe(0);
    expect(second.live()).toBe(1);
    expect(container.querySelector('[data-chart-canvas]')).toHaveAttribute(
      'data-chart-canvas',
      'fake-b',
    );
  });
});

describe('Chart — the size, and where it comes from', () => {
  it('resizes from the observer rather than from a window listener', () => {
    const uninstall = installObserver();
    stubWidth(800);
    const fake = createFakeRenderer();
    render(<Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />);
    fake.log.length = 0;

    stubWidth(400);
    act(() => {
      FakeResizeObserver.instances[0]?.fire();
    });

    expect(fake.log).toEqual(['resize']);
    uninstall();
  });

  it('keeps the size it was built at where the runtime has no ResizeObserver', () => {
    // jsdom as `src/test/setup.ts` leaves it, and the branch an older embedded
    // WebView takes. The hook reports `null`, the chart is still BUILT — the box
    // is measured off the element, not off the hook — and it never resizes,
    // which is the same answer the shell gave before the hook existed.
    expect(typeof (globalThis as WithObserver).ResizeObserver).not.toBe('function');
    stubWidth(800);
    const fake = createFakeRenderer();
    render(<Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />);

    expect(fake.log).toEqual(['create:div', 'setOption:Throughput']);
    expect(fake.log).not.toContain('resize');
  });

  it('builds no instance at all where the host element has no box', () => {
    // The unstubbed jsdom answer: every element reports 0x0. A canvas renderer
    // errors on that rather than drawing small — ECharts says "Can't get DOM
    // width or height" and fails — so the honest state is no chart. The DATA is
    // still on the page, which is what makes the state honest rather than blank.
    const fake = createFakeRenderer();
    render(<Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />);

    expect(fake.log).toEqual([]);
    expect(fake.live()).toBe(0);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('builds no instance where the engine says the runtime cannot support it', () => {
    // A canvas engine with no 2D context available. jsdom is exactly this, and
    // so is a locked-down embedding. The answer is a chart-shaped hole with the
    // numbers still on the page — a degradation, not a crash inside a library.
    stubWidth(800);
    const unsupported = createFakeRenderer('fake-unsupported', false);
    render(<Chart spec={spec()} theme={themeMarked('light:')} renderer={unsupported.renderer} />);

    expect(unsupported.log).toEqual([]);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('builds the instance when a box finally appears, with the option preserved', () => {
    const uninstall = installObserver();
    stubWidth(0);
    const fake = createFakeRenderer();
    render(<Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />);
    expect(fake.log).toEqual([]);

    // A pane expanded from zero, or a container laid out one frame late.
    stubWidth(640);
    act(() => {
      FakeResizeObserver.instances[0]?.fire();
    });

    expect(fake.log).toEqual(['create:div', 'setOption:Throughput']);
    uninstall();
  });
});

describe('Chart — what a screen reader gets', () => {
  it('publishes the data as a table and hides the canvas from assistive technology', () => {
    stubWidth(800);
    const fake = createFakeRenderer();
    const { container } = render(
      <Chart spec={spec()} theme={themeMarked('light:')} renderer={fake.renderer} />,
    );

    // The canvas host is hidden, because a canvas has no readable content and
    // labelling it would announce a name for a picture nobody can read.
    expect(container.querySelector('[data-chart-canvas]')).toHaveAttribute('aria-hidden', 'true');
    // ...and the numbers are really in the accessibility tree, as a table.
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /requests/ })).toBeInTheDocument();
    for (const value of ['1', '2', '3']) {
      expect(screen.getByRole('cell', { name: value })).toBeInTheDocument();
    }
  });
});
