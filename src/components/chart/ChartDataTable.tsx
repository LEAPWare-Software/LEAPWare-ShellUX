import type { ReactElement } from 'react';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { ChartSpec } from '../../core/chart/chartSpec';

/**
 * ============================================================================
 * THE ACCESSIBLE HALF OF A CHART, AND IT IS NOT AN AFTERTHOUGHT.
 * ============================================================================
 * **A canvas is opaque to a screen reader.** It has no children, no roles and no
 * text; the pixels ECharts paints are unreadable by assistive technology in a
 * way no `aria-label` fixes, because a label can say "quarterly revenue" and
 * cannot say what any of the numbers are.
 *
 * WCAG 1.1.1 asks for a text alternative that serves the equivalent purpose, and
 * for a chart the equivalent purpose is THE DATA. So every chart the shell draws
 * renders this table from the same `ChartSpec` the canvas was built from — not a
 * summary, not a caption, the actual numbers — and `Chart.tsx` places it
 * `sr-only` beside the canvas. The block inspector renders the same component
 * visibly, which is the Grafana-style "reveal the underlying data without
 * navigating away" §3.1 asks for: one implementation, two placements.
 *
 * **The encoding channels are columns, deliberately.** A sighted user reads
 * "series 2 is the dashed line with square markers" off the plot; a screen
 * reader user reads it off the header. Dropping those columns would leave the
 * table describing a different chart from the one on screen.
 *
 * `tabular-nums` on every cell, per §3.7 — these tables sit beside a payload
 * channel that republishes on a timer, and proportional digits would make the
 * column jitter on every tick.
 *
 * *Tests:* `src/components/chart/__tests__/ChartDataTable.test.tsx` — "renders
 * every point of every series as a real table cell", "names the encoding
 * channels a sighted reader gets from the plot" and "captions the table with the
 * chart’s own title".
 * ============================================================================
 */

export interface ChartDataTableProps {
  readonly spec: ChartSpec;
  /**
   * Classes for the WRAPPER, which is a `div` and not the table.
   *
   * The caller decides whether this table is `sr-only` beside a canvas or on
   * screen in an inspector. It is the SAME table either way, which is the
   * property worth having: an accessible alternative that nobody sighted ever
   * looks at is an accessible alternative nobody notices has rotted.
   *
   * **The wrapper exists because `sr-only` DOES NOT WORK ON A `<table>`, and
   * that was a real defect rather than a tidy-up.** `sr-only` hides an element
   * by making it 1px square and absolutely positioned — and CSS table sizing
   * says a table's used width is never less than its min-content width, so a
   * `width: 1px` on a table is simply ignored. The "hidden" table therefore laid
   * out at its full natural width, and being absolutely positioned with no
   * positioned ancestor it escaped every `overflow: hidden` in the pane and made
   * the whole PAGE scroll sideways at 320px.
   *
   * A `div` has no such rule, so the wrapper shrinks and the table inside it is
   * clipped with it. Caught by "does not let the page itself scroll sideways" in
   * `e2e/shell-layout.spec.ts` — a browser-lane test, because jsdom lays nothing
   * out and could not have seen it.
   */
  readonly className: string;
}

/** The chart's data, as a table. */
export function ChartDataTable({ spec, className }: ChartDataTableProps): ReactElement {
  return (
    <div className={className}>
      <table className="w-full text-[11px] tabular-nums">
        <caption className={`text-left text-[11px] ${TOKEN_CLASS.mutedText}`}>
          {spec.title}
          {spec.yLabel === '' ? '' : ` — ${spec.yLabel}`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-left font-semibold">
              {spec.xLabel === '' ? 'Category' : spec.xLabel}
            </th>
            {spec.series.map((series) => (
              <th key={series.name} scope="col" className="text-left font-semibold">
                {series.name}
                {/*
                  The channels, in words. A sighted reader gets these from the
                  plot; without them this table describes a chart that has one
                  fewer way of telling two series apart than the canvas does.
                */}
                <span className={`block font-normal ${TOKEN_CLASS.mutedText}`}>
                  {`${series.dash} line, ${series.marker} marker`}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/*
            Keyed on the POSITION and not on the label. Two categories may carry
            the same string — "Q1" in two years is the obvious case — and a
            duplicate React key drops a row silently.
          */}
          {spec.categories.map((category, index) => (
            <tr key={`${String(index)}:${category}`}>
              <th scope="row" className="text-left font-normal">
                {category}
              </th>
              {spec.series.map((series) => (
                <td key={series.name}>{String(series.values[index])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
