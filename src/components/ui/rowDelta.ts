import { TOKEN_CLASS } from '../../core/theme/tokenClasses';

/**
 * ============================================================================
 * A DELTA'S THREE CHANNELS, AS PURE DATA AND TWO TOTAL FUNCTIONS.
 * ============================================================================
 * Separated from `RowMetric.tsx` for the reason `omniboxIntent.ts` is separated
 * from `OmniboxComposer.tsx`: a module that exports components and functions
 * both defeats fast refresh, and `eslint-plugin-react-refresh` says so at
 * `--max-warnings 0`. The split is load-bearing beyond the lint rule — these are
 * the parts a test can exercise at their edges without rendering anything.
 *
 * **WCAG 1.4.1 is the whole design.** The direction of a delta is said three
 * times: a shape (the arrow), a word (`sr-only`), and a colour. Remove any one
 * and the row still reads. The three records below are `Record<DeltaDirection,
 * …>` rather than switches so the compiler rejects both a missing member and an
 * invented one, exactly as `NAVIGATION_METRIC_KIND_MEMBERS` does.
 *
 * *Tests:* `src/components/__tests__/RowMetric.test.tsx` — "orders every finite
 * number against zero, and gives NaN no direction" and "writes a sign on a rise
 * and reports a non-finite magnitude as an em dash".
 * ============================================================================
 */

/** Which way a delta points. A closed vocabulary, in the register `BlockKind` is. */
export type DeltaDirection = 'up' | 'down' | 'flat';

/**
 * The direction of a delta, as a TOTAL function of any number.
 *
 * `NaN` fails both comparisons and lands on `flat`, which is the honest answer:
 * a number the host cannot order against zero has no direction, and inventing
 * one would be the host arguing. The magnitude is where that case is reported —
 * see `formatDelta`.
 */
export function deltaDirection(delta: number): DeltaDirection {
  if (delta > 0) {
    return 'up';
  }
  if (delta < 0) {
    return 'down';
  }
  return 'flat';
}

/**
 * A delta as display text, with its sign always written.
 *
 * `+` is spelled for a rise because a bare `3` beside a `-3` puts the whole
 * meaning of the column on one glyph's presence. A non-finite delta reports an
 * em dash rather than the string `NaN`: the value came from a plug-in, the host
 * has nothing to say about it, and "NaN" reads as a defect in the shell.
 */
export function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) {
    return '—';
  }
  return delta > 0 ? `+${String(delta)}` : String(delta);
}

/** The arrow, per direction. `aria-hidden` at the call site: decoration only. */
export const DELTA_MARK: Readonly<Record<DeltaDirection, string>> = Object.freeze({
  up: '▲',
  down: '▼',
  flat: '–',
});

/** The word a screen reader announces. The channel that survives everything. */
export const DELTA_WORD: Readonly<Record<DeltaDirection, string>> = Object.freeze({
  up: 'up',
  down: 'down',
  flat: 'unchanged',
});

/**
 * The colour role, per direction. The third channel, and the weakest.
 *
 * `--chart-positive` / `--chart-negative` rather than `--status-success` /
 * `--status-danger`: a status colour answers "is this thing broken?", and a rise
 * in stock is neither good nor bad — it is a direction on a chart, which is the
 * tier `design/contrast-manifest.json` measures against a plot background.
 */
export const DELTA_CLASS: Readonly<Record<DeltaDirection, string>> = Object.freeze({
  up: TOKEN_CLASS.deltaPositive,
  down: TOKEN_CLASS.deltaNegative,
  flat: TOKEN_CLASS.deltaFlat,
});
