import { ShellUXError } from '../types';

/**
 * ============================================================================
 * A CHART SPEC CARRIES NO COLOUR, AND THAT IS ENFORCED TWICE.
 * ============================================================================
 * §4.2 of the native-host plan: "Chart specs get **no colour field either**:
 * `normalizeChartSpec` assigns `colorIndex`, `dash` and `marker` from host
 * rotations. A series with a colour and no second channel **is not representable
 * in the type** — that is 'never encode meaning by colour alone' enforced by the
 * compiler rather than asserted in prose."
 *
 * Enforcing it once is not enough, because there are two doors and only one of
 * them has a compiler behind it:
 *
 *  1. **The type half.** `ChartSeriesInput` has no `color` member, so an object
 *     literal carrying one is an excess-property error at the call site. And
 *     `ChartSeries` — what this module RETURNS — declares `colorIndex`, `dash`
 *     and `marker` as REQUIRED, all three assigned in one statement below. A
 *     series with a colour and no second channel cannot be constructed, and a
 *     series with a second channel removed does not compile.
 *  2. **The runtime half.** A spec arriving through `publishPayload` is
 *     `data: unknown` — the compiler was never in that loop. So `color` on a
 *     series is REJECTED ON SIGHT with `INVALID_FIELD` rather than ignored. It
 *     is rejected rather than dropped because a publisher who wrote a colour
 *     meant something by it, and silently drawing a different colour is the
 *     failure mode `BlockKind`'s closed vocabulary refuses in the same words.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SERIES BOUND IS TWELVE, AND WHY IT IS A REJECTION RATHER THAN A WRAP
 * ---------------------------------------------------------------------------
 * There are twelve chart tokens, `--chart-1` … `--chart-12`, which `design/`
 * validated at ≥3:1 against the plot background with 66-pair ΔE2000 separation.
 * A thirteenth series has no thirteenth colour, and the obvious answer — wrap
 * the rotation — is WRONG in a way that is easy to miss: the dash rotation has
 * period 3 and the marker rotation period 4, so their least common multiple is
 * 12 as well. Series 13 would come back with colour 1, dash 1 AND marker 1, i.e.
 * indistinguishable from series 1 in every channel at once. So the bound is a
 * refusal, and `MAX_SERIES` is the number of colours rather than a round number
 * somebody liked. Pinned by "refuses a thirteenth series rather than reusing
 * every channel of the first" in
 * `src/core/chart/__tests__/chartSpec.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It reads the candidate's own properties, so a getter planted on `title` runs
 * once, here, at an imperative door and never on a render path — the same
 * posture `normalizeTheme` takes and for the same reason. What it does NOT do is
 * measure contrast: the twelve colours were measured in `design/`, against the
 * built-in themes only, and a third-party theme's `--chart-*` values are held to
 * `normalizeTheme`'s grammar and to nothing else. That gap is
 * `normalizeTheme.ts`'s, is recorded there, and is not narrowed here.
 * ============================================================================
 */

/**
 * What a chart is drawn AS. A closed host vocabulary with no fallback, in the
 * register `BlockKind` and `NavigationMetricKind` are closed.
 *
 * The asymmetry with `NavigationNode.icon` is the same one `NavigationMetricKind`
 * draws: an unknown icon has an honest fallback because the label is still
 * there, and an unknown SHAPE has none. A series of monthly totals drawn as a
 * scatter says something different from the same numbers drawn as a bar, and
 * there is no third rendering that means "the host did not recognise what you
 * asked for".
 */
export type ChartKind = 'line' | 'bar' | 'scatter';

/** Exhaustiveness pin, in the shape `BLOCK_KIND_MEMBERS` is. */
const CHART_KIND_MEMBERS: Readonly<Record<ChartKind, true>> = Object.freeze({
  line: true,
  bar: true,
  scatter: true,
});

/** `ChartKind` as a runtime allowlist. */
export const CHART_KINDS: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(CHART_KIND_MEMBERS)),
);

/** The second encoding channel: line texture. */
export type ChartDash = 'solid' | 'dashed' | 'dotted';

/** The third: point shape. */
export type ChartMarker = 'circle' | 'square' | 'triangle' | 'diamond';

/**
 * The host's dash rotation. Period 3.
 *
 * `solid` first, because a one-series chart should not look like it is trying to
 * say something by being dashed.
 */
const DASH_ROTATION: readonly ChartDash[] = Object.freeze(['solid', 'dashed', 'dotted']);

/** The host's marker rotation. Period 4, coprime with nothing on purpose. */
const MARKER_ROTATION: readonly ChartMarker[] = Object.freeze([
  'circle',
  'square',
  'triangle',
  'diamond',
]);

/**
 * The bounds a chart spec is held to.
 *
 * `MAX_POINTS` is `PAYLOAD_LIMITS.MAX_NODES`, deliberately the same number: a
 * spec arriving through `publishPayload` has already been bounded at 4096 nodes,
 * so a tighter bound here would reject specs the channel accepted and a looser
 * one would be unreachable through that door. It is nonetheless checked, because
 * `normalizeChartSpec` is also callable directly, where nothing has counted.
 */
export const CHART_LIMITS = Object.freeze({
  MAX_SERIES: 12,
  MAX_POINTS: 4096,
  MAX_TEXT_LENGTH: 200,
});

/** One series as a PUBLISHER may write it. No colour member exists to write. */
export interface ChartSeriesInput {
  readonly name: string;
  readonly values: readonly number[];
}

/** A chart as a publisher may write it. */
export interface ChartSpecInput {
  readonly kind: ChartKind;
  readonly title: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  /** X-axis labels. Defaults to `1..n` over the first series when omitted. */
  readonly categories?: readonly string[];
  readonly series: readonly ChartSeriesInput[];
}

/**
 * One series as the HOST owns it: three encoding channels, all required.
 *
 * `colorIndex` is an INDEX INTO THE TOKEN SET and not a colour. It is `1`-based
 * so that it reads as `--chart-3` rather than as an offset, and the resolution
 * from index to a painted string happens in `chartPalette.ts`, against the theme
 * the `ThemeBridge` resolved. Nothing in this module knows what colour anything
 * is, which is why a hardcoded hex has nowhere to hide here.
 */
export interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
  /** `1`–`12`, host-assigned from series order. */
  readonly colorIndex: number;
  /** The second channel. Host-assigned. */
  readonly dash: ChartDash;
  /** The third channel. Host-assigned. */
  readonly marker: ChartMarker;
}

/** A chart as the host owns it. Every field present, every array frozen. */
export interface ChartSpec {
  readonly kind: ChartKind;
  readonly title: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly ChartSeries[];
}

/** Read one own property off an untrusted candidate, without touching a prototype. */
function own(candidate: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(candidate, key)
    ? (candidate as Record<string, unknown>)[key]
    : undefined;
}

function reject(message: string, field: string): never {
  throw new ShellUXError('INVALID_FIELD', `normalizeChartSpec: ${message}`, field);
}

/** A required display string, bounded and rendered as a text node downstream. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    reject(`${field} must be a string.`, field);
  }
  if (value.length > CHART_LIMITS.MAX_TEXT_LENGTH) {
    reject(`${field} must be at most ${String(CHART_LIMITS.MAX_TEXT_LENGTH)} characters.`, field);
  }
  return value;
}

/** An optional display string. Absent means the empty string, never a guess. */
function optionalText(value: unknown, field: string): string {
  return value === undefined ? '' : requireText(value, field);
}

/**
 * One series, validated and given its three channels.
 *
 * The `color` check runs BEFORE anything else is read, so a publisher who wrote
 * a colour is told about that rather than about whatever the next problem is.
 */
function normalizeSeries(candidate: unknown, index: number, expected: number | null): ChartSeries {
  const field = `series[${String(index)}]`;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    reject(`${field} must be an object.`, field);
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'color')) {
    reject(
      `${field} carries a colour. A series never does: the host assigns colorIndex, dash and ` +
        'marker from its own rotations, so that meaning is never encoded by colour alone.',
      `${field}.color`,
    );
  }
  const values = own(candidate, 'values');
  if (!Array.isArray(values)) {
    reject(`${field}.values must be an array.`, `${field}.values`);
  }
  if (values.length === 0 || values.length > CHART_LIMITS.MAX_POINTS) {
    reject(
      `${field}.values must hold between 1 and ${String(CHART_LIMITS.MAX_POINTS)} points.`,
      `${field}.values`,
    );
  }
  if (expected !== null && values.length !== expected) {
    reject(
      `${field}.values holds ${String(values.length)} points where the chart's x axis has ` +
        `${String(expected)}. A ragged chart is a claim about the axis that is not true.`,
      `${field}.values`,
    );
  }
  const points: number[] = [];
  for (const value of values as readonly unknown[]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      reject(`${field}.values must hold finite numbers only.`, `${field}.values`);
    }
    points.push(value);
  }
  return Object.freeze({
    name: requireText(own(candidate, 'name'), `${field}.name`),
    values: Object.freeze(points),
    // ALL THREE, IN ONE STATEMENT. Deleting any one of them is a type error at
    // this expression, which is what makes "no meaning by colour alone" a
    // compile-time property rather than a convention.
    colorIndex: index + 1,
    dash: DASH_ROTATION[index % DASH_ROTATION.length] as ChartDash,
    marker: MARKER_ROTATION[index % MARKER_ROTATION.length] as ChartMarker,
  });
}

/**
 * Validate an untrusted chart spec and hand back the host's own frozen copy.
 *
 * Nothing of the caller's object graph is retained: every string is re-read,
 * every array is rebuilt and frozen, and the result is a fresh object. That is
 * the same posture `normalizeNavigationNode` and the payload channel's deep copy
 * take, and it is what makes it safe for the host to hold the result across
 * renders.
 *
 * @throws {ShellUXError} `INVALID_PAYLOAD` when the candidate is not a plain
 *   object; `INVALID_FIELD` for every other rejection, with `field` naming the
 *   offending path.
 */
export function normalizeChartSpec(candidate: unknown): ChartSpec {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      'normalizeChartSpec: a chart spec must be a plain object.',
      null,
    );
  }
  const kind = own(candidate, 'kind');
  if (typeof kind !== 'string' || !CHART_KINDS.has(kind)) {
    reject(
      `kind must be one of ${[...CHART_KINDS].join(', ')}. There is no fallback shape, because ` +
        'a fallback would be a statement about the data the publisher never made.',
      'kind',
    );
  }
  const rawSeries = own(candidate, 'series');
  if (!Array.isArray(rawSeries)) {
    reject('series must be an array.', 'series');
  }
  if (rawSeries.length === 0 || rawSeries.length > CHART_LIMITS.MAX_SERIES) {
    reject(
      `series must hold between 1 and ${String(CHART_LIMITS.MAX_SERIES)} entries. The bound is ` +
        'the number of chart colour tokens: a thirteenth series would repeat the first in its ' +
        'colour, its dash AND its marker at once, because the rotations have period 12.',
      'series',
    );
  }

  // The x axis is settled BEFORE any series is read, so every series is checked
  // against one axis rather than against whichever series happened to be first.
  const rawCategories = own(candidate, 'categories');
  let categories: readonly string[] | null = null;
  if (rawCategories !== undefined) {
    if (!Array.isArray(rawCategories)) {
      reject('categories must be an array when it is supplied at all.', 'categories');
    }
    if (rawCategories.length === 0 || rawCategories.length > CHART_LIMITS.MAX_POINTS) {
      reject(
        `categories must hold between 1 and ${String(CHART_LIMITS.MAX_POINTS)} labels.`,
        'categories',
      );
    }
    categories = Object.freeze(
      (rawCategories as readonly unknown[]).map((label, index) =>
        requireText(label, `categories[${String(index)}]`),
      ),
    );
  }

  const title = requireText(own(candidate, 'title'), 'title');
  const xLabel = optionalText(own(candidate, 'xLabel'), 'xLabel');
  const yLabel = optionalText(own(candidate, 'yLabel'), 'yLabel');

  // The x axis length is fixed by `categories` when it was supplied and by the
  // FIRST series otherwise, and every later series is measured against it. A
  // fold rather than a `map`, because "expected" is genuinely carried forward:
  // without it, an omitted `categories` would let series 2 hold a different
  // number of points from series 1 and the ragged-chart rejection would only
  // fire for publishers who happened to label their axis.
  let expected = categories === null ? null : categories.length;
  const series: ChartSeries[] = [];
  for (const [index, entry] of (rawSeries as readonly unknown[]).entries()) {
    const normalized = normalizeSeries(entry, index, expected);
    expected ??= normalized.values.length;
    series.push(normalized);
  }

  // Absent categories become 1-based ordinals over the first series. That is a
  // LABELLING default and not a data default: the host is naming positions it
  // can count, which is the one thing it does know, rather than inventing a
  // scale it does not.
  const first = series[0] as ChartSeries;
  const resolved =
    categories ?? Object.freeze(first.values.map((_unused, index) => String(index + 1)));

  return Object.freeze({
    kind: kind as ChartKind,
    title,
    xLabel,
    yLabel,
    categories: resolved,
    series: Object.freeze(series),
  });
}
