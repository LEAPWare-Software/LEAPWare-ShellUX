import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizeChartSpec } from '../../../core/chart/chartSpec';
import { ChartDataTable } from '../ChartDataTable';

/**
 * ============================================================================
 * THE TEXT ALTERNATIVE, AS DATA RATHER THAN AS A SENTENCE
 * ============================================================================
 * WCAG 1.1.1 asks for an alternative serving the EQUIVALENT purpose. For a chart
 * that is the numbers, not a summary of them — so what is asserted here is that
 * every point of every series is a real cell in the accessibility tree, and that
 * the two non-colour encoding channels a sighted reader gets from the plot are
 * named in the header rather than left implicit.
 * ============================================================================
 */

function twoSeries() {
  return normalizeChartSpec({
    kind: 'line',
    title: 'Throughput',
    xLabel: 'month',
    yLabel: 'requests',
    categories: ['Jan', 'Feb'],
    series: [
      { name: 'served', values: [10, 20] },
      { name: 'failed', values: [1, 2] },
    ],
  });
}

describe('ChartDataTable', () => {
  it('renders every point of every series as a real table cell', () => {
    render(<ChartDataTable spec={twoSeries()} className="" />);

    for (const value of ['10', '20', '1', '2']) {
      expect(screen.getByRole('cell', { name: value })).toBeInTheDocument();
    }
    // The x axis is a row header, not a cell: it names its row.
    expect(screen.getByRole('rowheader', { name: 'Jan' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Feb' })).toBeInTheDocument();
  });

  it('names the encoding channels a sighted reader gets from the plot', () => {
    render(<ChartDataTable spec={twoSeries()} className="" />);

    // Without these the table describes a chart with one fewer way of telling
    // two series apart than the canvas has.
    expect(screen.getByRole('columnheader', { name: /served solid line, circle marker/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /failed dashed line, square marker/ })).toBeInTheDocument();
    // And the x axis carries the publisher's own label.
    expect(screen.getByRole('columnheader', { name: 'month' })).toBeInTheDocument();
  });

  it('captions the table with the chart’s own title', () => {
    render(<ChartDataTable spec={twoSeries()} className="" />);
    expect(screen.getByRole('table', { name: /Throughput — requests/ })).toBeInTheDocument();
  });

  it('falls back to a host word for an axis the publisher did not label', () => {
    const unlabelled = normalizeChartSpec({
      kind: 'bar',
      title: 'Counts',
      series: [{ name: 'n', values: [4] }],
    });
    render(<ChartDataTable spec={unlabelled} className="" />);

    // "Category" rather than an empty header: a column with no name is a column
    // a screen reader announces as nothing at all.
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    // And the caption carries the title alone, with no dangling separator.
    expect(screen.getByRole('table', { name: 'Counts' })).toBeInTheDocument();
    // The ordinal labels `normalizeChartSpec` supplied are what the rows say.
    expect(screen.getByRole('rowheader', { name: '1' })).toBeInTheDocument();
  });

  it('renders a row per category even when two categories share a label', () => {
    const repeated = normalizeChartSpec({
      kind: 'line',
      title: 'Quarters',
      categories: ['Q1', 'Q1'],
      series: [{ name: 'n', values: [1, 2] }],
    });
    render(<ChartDataTable spec={repeated} className="" />);

    // Keyed on position, not on the label. A duplicate React key drops a row
    // silently, and "Q1" in two different years is the ordinary case.
    expect(screen.getAllByRole('rowheader', { name: 'Q1' })).toHaveLength(2);
  });

  it('puts the caller’s classes on a WRAPPER, because sr-only does not work on a table', () => {
    const { container } = render(<ChartDataTable spec={twoSeries()} className="sr-only" />);

    // CSS table sizing says a table's used width is never below its min-content
    // width, so `width: 1px` on a `<table>` is ignored and `sr-only` silently
    // fails to hide it. The wrapper is a `div`, which has no such rule.
    expect(container.querySelector('table')).not.toHaveClass('sr-only');
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild).toHaveClass('sr-only');
  });
});
