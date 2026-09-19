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
 *
 * GitHub issue #23 (2026-09-19) added `paneBandsAt`, `intentFromRecord` and
 * `fitPaneLayout` below them: the arithmetic `ShellLayout.tsx` used to spell
 * inline for its mount-time `defaultSize`, lifted out so that the re-fit it now
 * performs on every group-width change is the SAME function and not a second
 * copy that can drift from it.
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

/** One pane's legal share of the group, as the library's `minSize`/`maxSize`. */
export interface PaneBand {
  readonly min: number;
  readonly max: number;
}

/**
 * Every pane's band at one group width.
 *
 * Pane 3 declares a `minSize` and deliberately no `maxSize` — it is the
 * remainder pane — so its `max` is the library's own implicit 100 rather than a
 * constraint this shell invented.
 */
export interface PaneBands {
  readonly nav: PaneBand;
  readonly list: PaneBand;
  readonly detail: PaneBand;
}

/** `PANE_PX`'s minimums and maximums as shares of `width`. See `percentOf`. */
export function paneBandsAt(width: number): PaneBands {
  return {
    nav: {
      min: percentOf(PANE_PX.navMin, width, PANE_FALLBACK_PERCENT.navMin),
      max: percentOf(PANE_PX.navMax, width, PANE_FALLBACK_PERCENT.navMax),
    },
    list: {
      min: percentOf(PANE_PX.listMin, width, PANE_FALLBACK_PERCENT.listMin),
      max: percentOf(PANE_PX.listMax, width, PANE_FALLBACK_PERCENT.listMax),
    },
    detail: {
      min: percentOf(PANE_PX.detailMin, width, PANE_FALLBACK_PERCENT.detailMin),
      max: 100,
    },
  };
}

/**
 * What the two leading panes are ASKED to be, before any band is applied.
 *
 * Pane 3 is not in here because it is never asked for anything: it is the
 * remainder, and `fitPaneLayout` gives it whatever the other two leave.
 */
export interface PaneIntent {
  readonly nav: number;
  readonly list: number;
}

/**
 * The layout a persisted record asks for, as shares of the group it will be laid
 * out in.
 *
 * ONE DERIVATION, USED AT MOUNT AND AGAIN ON EVERY WIDTH CHANGE (GitHub issue
 * #23). That is what makes a live resize to width W land on the layout a reload
 * at W opens on: the two are the same function of the same record.
 *
 * **A record holding the engine's untouched defaults asks for `PANE_PX`**, at
 * `pixelWidth` — see `isEngineDefaultLayout` for why "a record exists" is not
 * "the user chose a layout".
 *
 * **A chosen pane-2 share is re-based onto the group that is actually live.** The
 * record stores three percentages of one width. When pane 1 is not a member of
 * the group — the extension surface, where pane 1 is in another document, or a
 * collapsed pane 1, which is a fixed 48px track outside the group (GitHub issue
 * #114) — `sizes.pane2` is a share of a denominator this group does not have.
 * Dividing by the pair's own total is the same layout expressed against the width
 * it is being laid out in. The denominator cannot be zero: the engine clamps
 * every stored slot into `[MIN_PANE_PERCENT, MAX_PANE_PERCENT]`, whose floor is
 * above zero.
 */
export function intentFromRecord(
  sizes: PaneSizes,
  paneOneIsInGroup: boolean,
  pixelWidth: number,
): PaneIntent {
  if (isEngineDefaultLayout(sizes)) {
    return {
      nav: percentOf(PANE_PX.navDefault, pixelWidth, PANE_FALLBACK_PERCENT.navDefault),
      list: percentOf(PANE_PX.listDefault, pixelWidth, PANE_FALLBACK_PERCENT.listDefault),
    };
  }
  return {
    nav: sizes.pane1,
    list: paneOneIsInGroup ? sizes.pane2 : (sizes.pane2 / (sizes.pane2 + sizes.pane3)) * 100,
  };
}

/** A fitted layout: one share per pane. `nav` is meaningful only when pane 1 is in the group. */
export interface FittedLayout {
  readonly nav: number;
  readonly list: number;
  readonly detail: number;
}

/**
 * An intent held to the bands, with pane 3 given the remainder.
 *
 * The two leading panes are clamped into their own bands, which is where a
 * layout chosen on a wide monitor and shown on a narrow one is corrected rather
 * than handed to the library and re-clamped by it with a console warning. Pane 3
 * takes what is left, floored at its own minimum so that two wide leading panes
 * cannot ask for a negative share.
 *
 * **The pane-1 term is zero whenever pane 1 is not a member of the group**,
 * because leaving it in would subtract a pane that is not there from the width
 * the group divides — GitHub issue #114, where it made the library renormalise
 * and warn on every load.
 *
 * Below roughly 700px the three minimums cannot all be met and this returns a
 * layout summing to more than 100; the library renormalises that and says so.
 * That is the state `ShellLayout.tsx`'s decision 1 measures and explains, and
 * nothing here changes it.
 */
export function fitPaneLayout(
  intent: PaneIntent,
  bands: PaneBands,
  paneOneIsInGroup: boolean,
): FittedLayout {
  const nav = clampToBand(intent.nav, bands.nav.min, bands.nav.max);
  const list = clampToBand(intent.list, bands.list.min, bands.list.max);
  const paneOneShare = paneOneIsInGroup ? nav : 0;
  return { nav, list, detail: Math.max(bands.detail.min, 100 - paneOneShare - list) };
}
