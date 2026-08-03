import type { ResolvedTheme } from '../theme/normalizeTheme';
import type { SemanticTokenName } from '../theme/tokens.generated';

/**
 * ============================================================================
 * THE ONE PLACE A `colorIndex` BECOMES A COLOUR, AND IT READS THE BRIDGE.
 * ============================================================================
 * **A canvas cannot read a CSS custom property.** `--chart-1` is a value in the
 * style system and a 2D context takes a colour string, so a chart has to be
 * HANDED resolved values. `src/core/theme/ThemeBridge.ts` does exactly one
 * `getComputedStyle(documentElement)` per theme change and hands out a frozen
 * `ResolvedTheme`; this module is the only consumer of that record on the chart
 * path, and it does no resolution of its own.
 *
 * **There is no `getComputedStyle` in this file and no colour literal either.**
 * Both absences are load-bearing. A `getComputedStyle` here would be one forced
 * style recalculation per chart per frame, which is the jank the bridge exists
 * to prevent; a literal would be a colour outside `design/`'s pipeline, where
 * `npm run tokens:check` cannot measure its contrast and `noRawColor.test.ts`
 * would reject it — which is exactly what that test is for.
 *
 * The palette's IDENTITY is stable for as long as the resolved theme's is, which
 * is what makes it safe to key a chart instance's lifetime on. See
 * `src/components/chart/Chart.tsx` for why that lifetime matters.
 *
 * *Tests:* `src/core/chart/__tests__/chartPalette.test.ts` — "resolves a series
 * colour from its index and nothing else", "clamps an out-of-range index into
 * the twelve tokens rather than painting nothing" and "reads every chrome colour
 * from the resolved theme".
 * ============================================================================
 */

/**
 * The twelve series token names, spelled out.
 *
 * Written as literals rather than assembled in a loop, and the reason is the one
 * `tokenClasses.ts` gives for spelling complete Tailwind classes: a name built
 * from parts is a name no grep, no rename and no `SemanticTokenName` check can
 * see. `satisfies` holds every member to the generated contract, so a token
 * removed from `design/` fails this file at compile time rather than resolving
 * to `undefined` at paint time.
 */
const SERIES_TOKEN_NAMES = Object.freeze([
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
  '--chart-9',
  '--chart-10',
  '--chart-11',
  '--chart-12',
] as const) satisfies readonly SemanticTokenName[];

/** How many series colour tokens `design/` validated. */
export const CHART_COLOR_COUNT = SERIES_TOKEN_NAMES.length;

/**
 * Every colour a chart paints, already resolved.
 *
 * Frozen and flat rather than nested, because it is compared by identity and
 * rebuilt whole on every theme change; there is nothing here worth a partial
 * update.
 */
export interface ChartPalette {
  /** The twelve series colours, in `colorIndex` order. Index 0 is `--chart-1`. */
  readonly series: readonly string[];
  readonly grid: string;
  readonly axis: string;
  readonly label: string;
  readonly tooltipBackground: string;
  readonly tooltipText: string;
  readonly crosshair: string;
  readonly positive: string;
  readonly negative: string;
}

/**
 * Resolve the whole chart palette from one already-resolved theme.
 *
 * Pure, total, and cheap: twelve record reads and eight more. It is called from
 * a `useMemo` keyed on the theme object, so it runs once per theme change and
 * not once per render.
 */
export function buildChartPalette(theme: ResolvedTheme): ChartPalette {
  return Object.freeze({
    series: Object.freeze(SERIES_TOKEN_NAMES.map((name) => theme[name])),
    grid: theme['--chart-grid'],
    axis: theme['--chart-axis'],
    label: theme['--chart-label'],
    tooltipBackground: theme['--chart-tooltip-bg'],
    tooltipText: theme['--chart-tooltip-text'],
    crosshair: theme['--chart-crosshair'],
    positive: theme['--chart-positive'],
    negative: theme['--chart-negative'],
  });
}

/**
 * The painted colour for a 1-based `colorIndex`.
 *
 * `normalizeChartSpec` cannot emit an index outside `1..12` — it refuses a
 * thirteenth series — so the wrap below is not reachable through that door. It
 * is here because this function is also the one a future renderer, an inspector
 * or a legend will call with an index it read off a stored spec, and a palette
 * lookup that can return `undefined` would put an `undefined` into a canvas call
 * and paint nothing at all. Wrapping is the failure that is still a colour.
 */
export function seriesColor(palette: ChartPalette, colorIndex: number): string {
  const zeroBased = (Math.trunc(colorIndex) - 1) % palette.series.length;
  const wrapped = zeroBased < 0 ? zeroBased + palette.series.length : zeroBased;
  return palette.series[wrapped] as string;
}
