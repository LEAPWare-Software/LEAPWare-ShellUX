import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { NavigationMetric } from '../../core/types';

/**
 * ============================================================================
 * TIER 0. ONE PATH STRING, NO LIBRARY, NO CANVAS, NO PLUG-IN GEOMETRY.
 * ============================================================================
 * The native-host plan's §3.3 splits visualization into three tiers with three
 * different problems. This module is tier 0: a glyph small enough to sit inside
 * a 24px navigation row, drawn from a `d` string this file builds, with no chart
 * instance, no measurement pass and no dependency. Tier 1 and tier 2 belong in a
 * pane that has a canvas to spend on them; nothing here reaches for one.
 *
 * **The construction is `shellIcons.tsx`'s `glyph()`, deliberately.** Same
 * `viewBox`-relative geometry, same `fill="none"`, same `stroke="currentColor"`,
 * same round caps, same `aria-hidden` on the `svg`. The two modules draw the
 * shell's only inline SVG and they draw it the same way, so a change to how the
 * shell paints a 1.25px stroke has two homes and not seven.
 *
 * **What a plug-in contributes here is FOUR VALIDATED PRIMITIVES AND A BOUNDED
 * ARRAY OF NUMBERS, and nothing else reaches the DOM.**
 *
 *  - `kind` is a lookup key held to `NAVIGATION_METRIC_KINDS` at the registry
 *    door. It selects between three host-authored path builders below. It is
 *    never interpolated — not into `d`, not into a class name, not into a
 *    `style`.
 *  - `value` and every element of `series` are numbers the host has already
 *    clamped to `[0, 1]`; they are multiplied by host constants and rounded, so
 *    what lands in `d` is a number this file computed.
 *  - `description` is UNTRUSTED display text and is rendered as a JSX TEXT NODE
 *    inside an `sr-only` span. It is never markup, never a `title` attribute
 *    parsed as anything, never a URL.
 *
 * **There is no `style` prop, no CSS custom property and no colour.** An earlier
 * sketch of this component passed the clamped value into the stylesheet as
 * `--v`; it does not, and the stronger statement is the one that is true: a
 * metric value never reaches CSS at all, so there is no declaration for it to
 * terminate even before it is clamped. Colour comes from `currentColor`, which
 * is the row's own text token, which `design/check-contrast.mjs` measures.
 *
 * *Tests:* `src/components/__tests__/ShellLayoutMetrics.test.tsx` — "draws each
 * metric kind from host-authored geometry only", which asserts that the emitted
 * `d` attribute contains nothing a plug-in supplied and that no element carries
 * an inline style, and "renders a declared navigation metric as a host-drawn
 * glyph with its description".
 * ============================================================================
 */

/**
 * The glyph's drawing box, in `viewBox` units.
 *
 * Wider than tall because two of the three shapes are read along the x axis. The
 * `INSET` keeps a round stroke cap inside the box at both ends, so a `value` of
 * `0` and a `value` of `1` both draw fully rather than being clipped.
 */
const BOX = Object.freeze({ width: 32, height: 12, inset: 2 });

/**
 * Two decimal places.
 *
 * Not cosmetic: `0.1 + 0.2` in a coordinate produces a seventeen-digit tail in
 * the `d` attribute, which makes the memoised string change identity for
 * arithmetic noise and makes a test assertion on it unreadable.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The x coordinate a fraction of the track corresponds to. */
function trackX(fraction: number): number {
  return round2(BOX.inset + fraction * (BOX.width - 2 * BOX.inset));
}

/** The y coordinate a fraction corresponds to: `0` at the floor, `1` at the top. */
function trackY(fraction: number): number {
  return round2(BOX.height - BOX.inset - fraction * (BOX.height - 2 * BOX.inset));
}

/**
 * The path for one metric, from host-authored geometry only.
 *
 * Three shapes, three meanings, and the third deliberately does not use `value`:
 *
 *  - **`bar`** — a track filled from the left to `value`. A `0` draws the round
 *    cap alone, which reads as "empty" rather than disappearing.
 *  - **`sparkline`** — a polyline over `series`. A series the publisher did not
 *    supply, or one holding a single point, has no line in it, so the shape
 *    degenerates to a flat rule at the height `value` implies. That is a
 *    degeneracy WITHIN the requested shape and not a fallback to another one —
 *    `NavigationMetricKind` has no fallback, and this does not give it one.
 *  - **`dot`** — a presence mark in the centre. It says "there is something
 *    here" and says nothing about magnitude, because a lone dot with no track
 *    behind it cannot: a position along an invisible axis is not readable. The
 *    quantity for a `dot` lives in `description`, which is required.
 */
function metricPath(metric: NavigationMetric): string {
  if (metric.kind === 'bar') {
    return `M${trackX(0)} ${trackY(0.5)}H${trackX(metric.value)}`;
  }
  if (metric.kind === 'dot') {
    return `M${round2(BOX.width / 2)} ${trackY(0.5)}h.01`;
  }
  const series = metric.series;
  const points = series === undefined || series.length < 2 ? [metric.value, metric.value] : series;
  const step = (BOX.width - 2 * BOX.inset) / (points.length - 1);
  return points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command}${round2(BOX.inset + index * step)} ${trackY(point)}`;
    })
    .join(' ');
}

export interface MetricGlyphProps {
  /** The host-owned, registry-validated metric to draw. */
  readonly metric: NavigationMetric;
  /**
   * When `true` the geometry is dropped and only the description is rendered.
   *
   * This is what pane 1's collapsed 48px track passes. A 32-unit-wide glyph does
   * not fit beside an icon in a 32px square, and shrinking it to fit would leave
   * a shape too small to read — so the collapsed row keeps the CHANNEL that
   * survives being small, which is the text one. The accessible name of the
   * button is therefore the same in both pane-1 states, which is the property
   * `ShellNavButton`'s own docblock is about. Pinned by "keeps the metric
   * description in the collapsed track and drops the glyph" in
   * `src/components/__tests__/ShellLayoutMetrics.test.tsx`.
   */
  readonly isGlyphHidden: boolean;
}

/**
 * One metric, as a host-drawn glyph plus its `sr-only` description.
 *
 * The `d` string is memoised on the metric object, which is frozen and
 * host-owned — either the registry's record or the single fresh object
 * `NavNodeButton` builds when the store overrides `value`. So the path is
 * rebuilt when the number moves and not on every render of the tree.
 */
export function MetricGlyph({ metric, isGlyphHidden }: MetricGlyphProps): ReactElement {
  const d = useMemo(() => metricPath(metric), [metric]);
  if (isGlyphHidden) {
    return <span className="sr-only">{metric.description}</span>;
  }
  return (
    <span className="ml-auto flex flex-none items-center">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className="h-3 w-8 flex-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
      <span className="sr-only">{metric.description}</span>
    </span>
  );
}
