import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { NavigationMetric } from '../../core/types';
import { RowMetric } from '../ui/RowMetric';
import { deltaDirection, formatDelta } from '../ui/rowDelta';

/**
 * ============================================================================
 * THE PANE-2 ROW METRIC — TIER 0's SECOND SURFACE
 * ============================================================================
 * `RowMetric` exists because a chart instance per row is construct-and-destroy
 * on every scroll tick. What is asserted here is therefore two things and not
 * one: that the delta says its direction in three independent channels, so
 * removing colour loses nothing; and that the drawing is `MetricGlyph`'s and not
 * a second sparkline implementation living beside it.
 *
 * The second is checked structurally rather than by mocking the import: the
 * emitted `svg` carries `stroke="currentColor"` and a `d` built from
 * `MetricGlyph`'s own 32×12 box, which is a fact about the composition that a
 * copy-pasted second implementation would have to reproduce exactly to fake.
 * ============================================================================
 */

const SPARKLINE: NavigationMetric = Object.freeze({
  kind: 'sparkline',
  value: 0.5,
  series: Object.freeze([0, 0.5, 1]),
  description: 'three readings',
});

describe('RowMetric — the delta says its direction three times', () => {
  it('says a rising delta three times over, and colour is only one of them', () => {
    const { container } = render(<RowMetric metric={SPARKLINE} value="128" delta={4} />);
    const delta = container.querySelector('[data-delta-direction]');

    expect(delta).not.toBeNull();
    expect(delta).toHaveAttribute('data-delta-direction', 'up');
    // 1. Shape, hidden from the accessibility tree because it is a picture.
    expect(delta?.querySelector('[aria-hidden="true"]')?.textContent).toBe('▲');
    // 2. Text, which is what a screen reader announces.
    expect(screen.getByText('up')).toHaveClass('sr-only');
    // 3. Colour, the weakest channel, and a token rather than a literal.
    expect(delta).toHaveClass(TOKEN_CLASS.deltaPositive);
    // The magnitude writes its sign rather than leaving it to be inferred.
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('says a falling delta three times over', () => {
    const { container } = render(<RowMetric metric={SPARKLINE} value="12" delta={-7} />);
    const delta = container.querySelector('[data-delta-direction]');

    expect(delta).toHaveAttribute('data-delta-direction', 'down');
    expect(delta?.querySelector('[aria-hidden="true"]')?.textContent).toBe('▼');
    expect(screen.getByText('down')).toHaveClass('sr-only');
    expect(delta).toHaveClass(TOKEN_CLASS.deltaNegative);
    expect(screen.getByText('-7')).toBeInTheDocument();
  });

  it('says an unchanged delta without claiming a direction', () => {
    const { container } = render(<RowMetric metric={SPARKLINE} value="12" delta={0} />);
    const delta = container.querySelector('[data-delta-direction]');

    expect(delta).toHaveAttribute('data-delta-direction', 'flat');
    expect(screen.getByText('unchanged')).toHaveClass('sr-only');
    // The muted tier, not a status colour: nothing has gone right or wrong.
    expect(delta).toHaveClass(TOKEN_CLASS.deltaFlat);
  });

  it('reports a delta it cannot read as unknown rather than as unchanged', () => {
    // A plug-in supplies this number and the host does not clamp it. `NaN` fails
    // both comparisons, so the DIRECTION is honestly `flat`; the MAGNITUDE says
    // it could not be read, rather than rendering the string "NaN" and reading
    // as a defect in the shell.
    render(<RowMetric metric={SPARKLINE} value="?" delta={Number.NaN} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('unchanged')).toBeInTheDocument();
  });

  it('draws the glyph through MetricGlyph rather than a second sparkline', () => {
    const { container } = render(<RowMetric metric={SPARKLINE} value="128" delta={1} />);
    const svg = container.querySelector('svg');

    // `MetricGlyph`'s box, its inherited colour and its `aria-hidden`. A second
    // implementation would have to reproduce all three to pass this.
    expect(svg).toHaveAttribute('viewBox', '0 0 32 12');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe('M2 10 L16 6 L30 2');
    // And the description travels with it, so the row has a text channel for
    // the shape as well as for the delta.
    expect(screen.getByText('three readings')).toHaveClass('sr-only');
  });

  it('keeps both numbers on tabular figures, so a tick does not shift the column', () => {
    const { container } = render(<RowMetric metric={SPARKLINE} value="128" delta={4} />);
    const tabular = container.querySelectorAll('.tabular-nums');
    expect(tabular).toHaveLength(2);
  });
});

describe('RowMetric — the pure halves, at their edges', () => {
  it('orders every finite number against zero, and gives NaN no direction', () => {
    expect(deltaDirection(0.0001)).toBe('up');
    expect(deltaDirection(-0.0001)).toBe('down');
    expect(deltaDirection(0)).toBe('flat');
    expect(deltaDirection(-0)).toBe('flat');
    expect(deltaDirection(Number.NaN)).toBe('flat');
    expect(deltaDirection(Number.POSITIVE_INFINITY)).toBe('up');
  });

  it('writes a sign on a rise and reports a non-finite magnitude as an em dash', () => {
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-3)).toBe('-3');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDelta(Number.NaN)).toBe('—');
  });
});
