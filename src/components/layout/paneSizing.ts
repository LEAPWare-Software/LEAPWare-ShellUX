import { DEFAULT_SHELL_STATE, HYDRATION_LIMITS } from '../../core/services/HydrationEngine';
import type { PaneSizes } from '../../core/services/HydrationEngine';
import type { PaneId } from '../../core/types';

/**
 * PANE-SIZE ARITHMETIC FOR `ShellLayout`, AND NOTHING ELSE.
 *
 * Two constant tables and four pure functions, split out of `ShellLayout.tsx`
 * by GitHub issue #95 with no change to any value or branch. Why sizes are
 * percentages measured once into pixels, and why a restored size is clamped, is
 * decisions 1 and 6 of the banner in `ShellLayout.tsx`; that is not restated
 * here. *Tests:* `src/components/__tests__/paneSizing.test.ts`.
 */

/**
 * The pixel intent behind every pane constraint, in one table.
 *
 * `navCollapsed` is the only one of these that is applied as pixels directly —
 * it is a CSS width on a track outside the panel group — and it is listed here
 * so that the 48px in the specification has exactly one home in the code.
 */
export const PANE_PX = Object.freeze({
  navCollapsed: 48,
  navDefault: 240,
  navMin: 176,
  navMax: 400,
  listDefault: 360,
  listMin: 240,
  listMax: 640,
  detailMin: 260,
});

/**
 * Percentages used when the group width cannot be measured.
 *
 * These are the same constraints expressed against a 1360px content area, which
 * is the width `PANE_PX` was chosen for. They keep the layout legal and
 * proportionate rather than pretending to be the pixel values.
 */
export const PANE_FALLBACK_PERCENT = Object.freeze({
  navDefault: 18,
  navMin: 13,
  navMax: 29,
  listDefault: 26,
  listMin: 18,
  listMax: 47,
  detailMin: 19,
});

/**
 * A pixel width as a percentage of `groupWidth`, clamped to a legal band.
 *
 * The lower clamp is what stops a divider dragged fully to one edge from leaving
 * a 0px pane behind: every panel's `minSize` comes through here, so the smallest
 * value any panel can be given is 2% of the group rather than nothing. The
 * library reports the same floor to assistive technology as `aria-valuemin` on
 * the separator, which is what the zero-width test asserts.
 */
export function percentOf(px: number, groupWidth: number, fallbackPercent: number): number {
  if (groupWidth <= 0) {
    return fallbackPercent;
  }
  return Math.min(90, Math.max(2, (px / groupWidth) * 100));
}

/**
 * A restored percentage held to one pane's own live band.
 *
 * `low` and `high` are this pane's `minSize` and `maxSize` at the width measured
 * on THIS load, so a layout saved on a wide monitor and reopened on a narrow one
 * is corrected here rather than being handed to the library and re-clamped by it
 * with a console warning. `Math.min`/`Math.max` rather than an `if`, so the
 * function has one exit and no branch to leave untested.
 */
export function clampToBand(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * A percentage held to the band the ENGINE will store, before it is written.
 *
 * This is not belt and braces. Pane 3 declares a `minSize` and deliberately no
 * `maxSize` — it is the remainder pane — so a layout with both dividers driven
 * fully leading gives it whatever is left, and the engine refuses a slot value
 * outside `[MIN_PANE_PERCENT, MAX_PANE_PERCENT]` by throwing. A throw from a
 * panel resize callback is a throw out of the library's own layout effect, so
 * the value is clamped to what is storable instead. The bounds are the engine's
 * own constants, imported rather than restated, for the reason
 * `HYDRATION_LIMITS` gives about the two ends of this band agreeing.
 */
export function clampPanePercent(value: number): number {
  return clampToBand(
    value,
    HYDRATION_LIMITS.MIN_PANE_PERCENT,
    HYDRATION_LIMITS.MAX_PANE_PERCENT,
  );
}

/**
 * Whether a restored record's pane sizes are the engine's own untouched
 * defaults.
 *
 * BY VALUE, AND THE IDENTITY TEST THIS REPLACES WAS A FALSE SENTINEL. It read
 * `restoredSizes !== DEFAULT_SHELL_STATE.paneSizes` and called the answer
 * "somebody chose a layout". Identity only survives the paths that hand the one
 * shared frozen default straight back — an absent or discarded record. A record
 * that was PARSED gets a fresh `paneSizes` object whatever it holds, so a shell
 * whose record exists only because the user collapsed pane 1, or opened an
 * extension, answered "somebody chose a layout" for a record holding nothing but
 * defaults, and `PANE_PX` was never consulted again on that machine. Comparing
 * the three numbers is the fact the sentinel was reaching for.
 *
 * What that trades away, stated rather than glossed: a user who drags the panes
 * to exactly the engine's default percentages and reloads gets the pixel intent
 * for this width instead of those percentages back. The two are the same layout
 * at the 1360px reference width `PANE_FALLBACK_PERCENT` was written for and
 * differ elsewhere, so that user's reload can move the dividers. It is the
 * narrower error of the two, and it needs a coincidence to reach.
 *
 * The keys come from the defaults themselves rather than from a list written
 * here, so a fourth pane cannot be added to the record and quietly skipped, and
 * `every` rather than a chain of `||` so there is one exit.
 */
export function isEngineDefaultLayout(sizes: PaneSizes): boolean {
  const defaults = DEFAULT_SHELL_STATE.paneSizes;
  return (Object.keys(defaults) as PaneId[]).every((pane) => sizes[pane] === defaults[pane]);
}
