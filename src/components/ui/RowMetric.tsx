import type { ReactElement } from 'react';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { NavigationMetric } from '../../core/types';
import { MetricGlyph } from './MetricGlyph';
import { DELTA_CLASS, DELTA_MARK, DELTA_WORD, deltaDirection, formatDelta } from './rowDelta';

/**
 * ============================================================================
 * TIER 0, IN PANE 2. THE SAME PATH STRING, ONE ROW FURTHER RIGHT.
 * ============================================================================
 * §3.3 of the native-host plan splits visualization into three tiers because
 * panes 2 and 3 are OPPOSITE performance problems. Pane 3 is one chart with up
 * to millions of points, so draw throughput is the enemy and a canvas library
 * earns its instance. Pane 2 is hundreds of tiny charts inside a virtualized
 * list, so INSTANCE OVERHEAD is the enemy: a chart instance per row is a
 * construct and a destroy on every scroll tick, and at 28px rows a screenful is
 * thirty of them.
 *
 * **So this file imports no chart library, and composes `MetricGlyph` rather
 * than drawing a second sparkline of its own.** That is the whole design. The
 * geometry, the `viewBox`, the `stroke="currentColor"`, the `sr-only`
 * description and the memoised `d` string all live in `MetricGlyph.tsx` and are
 * used here unchanged — a change to how the shell draws a 1.25px sparkline has
 * one home and not two. What this component adds is the other two channels a
 * dense row wants and a 32×12 glyph cannot carry: a VALUE and a DELTA.
 *
 * The delta's three channels and the two total functions behind them are in
 * `rowDelta.ts`; see that file's banner for the WCAG 1.4.1 argument.
 *
 * ---------------------------------------------------------------------------
 * `tabular-nums`, WHICH IS NOT A POLISH ITEM
 * ---------------------------------------------------------------------------
 * §3.7 asks for `font-variant-numeric: tabular-nums` on every number, and the
 * reason is specific to this surface: the database remote ticks stock on an
 * interval, so these digits change under a stationary eye. With proportional
 * digits a `1` is narrower than a `7`, so every tick shifts the column — the
 * single most visible "cheap" tell in a dense table. Both numeric spans below
 * carry it.
 *
 * *Tests:* `src/components/__tests__/RowMetric.test.tsx` — "says a rising delta
 * three times over, and colour is only one of them", "says a falling delta three
 * times over", "says an unchanged delta without claiming a direction",
 * "reports a delta it cannot read as unknown rather than as unchanged",
 * "draws the glyph through MetricGlyph rather than a second sparkline" and
 * "keeps both numbers on tabular figures, so a tick does not shift the column".
 * ============================================================================
 */

export interface RowMetricProps {
  /**
   * The glyph to draw, in exactly the shape pane 1 uses. Host-validated at the
   * registry door when it comes from a navigation node; built by the publishing
   * view when it comes from a row.
   */
  readonly metric: NavigationMetric;
  /**
   * The row's current value, ALREADY FORMATTED by whoever owns its units.
   *
   * A string rather than a number, because the host does not know whether this
   * is a count, a currency or a percentage, and a host that guessed would be
   * wrong on two of the three. It is untrusted display text and is rendered as a
   * JSX text node, exactly as `NavigationMetric.description` is.
   */
  readonly value: string;
  /** The change since the previous reading. Its SIGN is the direction. */
  readonly delta: number;
}

/**
 * One pane-2 row's metric: glyph, value, delta.
 *
 * Nothing here is memoised, and that is deliberate rather than an omission. The
 * only expensive thing in the subtree is the `d` string, which `MetricGlyph`
 * already memoises on the metric object; everything else is three spans and a
 * lookup in a frozen record. Wrapping this in `memo` would add a props
 * comparison per row per render to save nothing measurable.
 */
export function RowMetric({ metric, value, delta }: RowMetricProps): ReactElement {
  const direction = deltaDirection(delta);
  return (
    <span className="flex flex-none items-center gap-1">
      <MetricGlyph metric={metric} isGlyphHidden={false} />
      <span className={`tabular-nums text-[11px] ${TOKEN_CLASS.secondaryText}`}>{value}</span>
      <span
        data-delta-direction={direction}
        className={`flex items-center gap-px text-[11px] ${DELTA_CLASS[direction]}`}
      >
        <span aria-hidden="true">{DELTA_MARK[direction]}</span>
        <span className="tabular-nums">{formatDelta(delta)}</span>
        <span className="sr-only">{DELTA_WORD[direction]}</span>
      </span>
    </span>
  );
}
