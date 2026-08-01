/**
 * ============================================================================
 * THE WINDOWING ARITHMETIC, DELIBERATELY SEPARATE FROM THE COMPONENT.
 * ============================================================================
 * Every function here is pure: numbers in, numbers out, no DOM, no React, no
 * closure over anything. That separation is not tidiness, it is what makes the
 * coverage gate mean something.
 *
 * **jsdom has no layout engine.** Every element measures 0×0 unless a test
 * stubs a getter, and `scrollIntoView` is not implemented at all. The edge cases
 * ISSUE-004 actually names — an empty list, a single-item list, a 0px-tall
 * container, a selection index left pointing past the end after items were
 * removed, a fast scroll that lands past the end of a shrunken list — are all
 * statements about *arithmetic*. Asserting them through a rendered tree would
 * mean asserting them against a fake layout; asserting them here means asserting
 * them against the thing that actually decides. `src/components/__tests__/
 * VirtualizedList.test.tsx` does both, and says which is which.
 *
 * **Nothing here divides by an item count.** The zero-height container case
 * produces a divide-by-zero exactly when the divisor is a measured quantity, so
 * the divisor is always a row height, always validated finite and greater than
 * zero, and always falling back to `DEFAULT_ROW_HEIGHT` rather than to `0`. A
 * viewport of height 0 still yields at least one row whenever there are items to
 * show, which is what stops a pane that mounted before layout from staying
 * permanently blank.
 *
 * **Every numeric input is treated as untrusted.** The declared types say
 * `number`, and a declared type is not binding on a plain-JavaScript caller —
 * the same standard `ShellAPI.ts` holds its own doors to. `NaN`, `Infinity`,
 * negative numbers and non-numbers all resolve to a documented fallback rather
 * than propagating into an index.
 * ============================================================================
 */

/** A half-open range of item indices: `[start, end)`. */
export interface WindowRange {
  readonly start: number;
  readonly end: number;
}

/** The window for a list whose rows all declare the same height. */
export interface UniformWindowInput {
  readonly itemCount: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly overscan: number;
}

/** The window for a list with a prefix-sum offset table behind it. */
export interface OffsetWindowInput {
  /** `itemCount + 1` entries: `offsets[i]` is the top of row `i`. */
  readonly offsets: readonly number[];
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly overscan: number;
}

/** What a page-sized keyboard step should move by. */
export interface PageStepInput {
  /** The offset table, or `null` for a uniform-height list. */
  readonly offsets: readonly number[] | null;
  readonly rowHeight: number;
  readonly viewportHeight: number;
  readonly fromIndex: number;
  readonly itemCount: number;
}

/**
 * The height a row is given when its declared height is unusable.
 *
 * 24px is the WCAG 2.5.8 target-size floor and the density the rest of the shell
 * is built at, so a fallback row is a legal row rather than a sliver.
 */
export const DEFAULT_ROW_HEIGHT = 24;

/** The window of an empty list: nothing mounted, and no index in range. */
const EMPTY: WindowRange = Object.freeze({ start: 0, end: 0 });

/**
 * `value` when it is a real number greater than zero, and `fallback` otherwise.
 *
 * `typeof` first, because `Number.isFinite` is the only other thing here that is
 * safe on an arbitrary value and the comparison is not: `>` consults
 * `Symbol.toPrimitive`, `valueOf` and `toString`, any of which a caller may have
 * written. Checking the type before comparing is what makes the comparison safe,
 * the same argument `assertValidIdentifier` in `src/core/ShellAPI.ts` makes.
 */
function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number') {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value > 0 ? value : fallback;
}

/**
 * A usable row height, whatever was handed in.
 *
 * Exported because the component needs the SAME number the window arithmetic
 * used — a spacer sized from a raw `rowHeight` and a window computed from a
 * normalised one would disagree about where row 400 is.
 */
export function normalizeRowHeight(value: unknown): number {
  return positiveNumber(value, DEFAULT_ROW_HEIGHT);
}

/** A count: a whole number at or above zero, whatever was handed in. */
function wholeCount(value: unknown): number {
  return Math.floor(positiveNumber(value, 0));
}

/** `index` forced into `[0, itemCount - 1]`. `itemCount` must be at least 1. */
function clampIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(itemCount - 1, index));
}

/**
 * The half-open range of rows to mount, for a list of uniform row height.
 *
 * `start` is clamped into the list even when the scroll position implies an
 * index far past the end — the "scrolled deep, then the list shrank" case — and
 * `end` is then at least `start + 1` whenever there is anything to show. A list
 * with items in it therefore never resolves to an empty window, which is the
 * failure mode that leaves a pane blank until something unrelated re-renders it.
 *
 * The `+ 1` in `fit` is the partially visible row at the bottom edge: a viewport
 * showing 10.5 rows must mount 11, not 10, or the last one flickers in on scroll.
 */
export function computeWindow(input: UniformWindowInput): WindowRange {
  const itemCount = wholeCount(input.itemCount);
  if (itemCount === 0) {
    return EMPTY;
  }
  const rowHeight = positiveNumber(input.rowHeight, DEFAULT_ROW_HEIGHT);
  const scrollTop = positiveNumber(input.scrollTop, 0);
  const viewportHeight = positiveNumber(input.viewportHeight, 0);
  const overscan = wholeCount(input.overscan);

  const first = Math.floor(scrollTop / rowHeight);
  const fit = Math.max(1, Math.ceil(viewportHeight / rowHeight) + 1);
  const start = clampIndex(first - overscan, itemCount);
  const end = Math.min(itemCount, start + fit + overscan * 2);
  return { start, end };
}

/**
 * The prefix-sum table for a list of declared, variable row heights.
 *
 * `heightAt` comes from an extension, so it is called inside a guard: a row
 * whose height function throws gets `DEFAULT_ROW_HEIGHT` and the table is still
 * built, rather than one bad row destroying the whole list's geometry.
 *
 * **Declared heights only. Nothing here measures the DOM** — see the
 * dependency note in `VirtualizedList.tsx`.
 */
export function buildOffsets(itemCount: number, heightAt: (index: number) => number): number[] {
  const count = wholeCount(itemCount);
  const offsets: number[] = [0];
  let running = 0;
  for (let index = 0; index < count; index += 1) {
    let declared: unknown;
    try {
      declared = heightAt(index);
    } catch {
      declared = DEFAULT_ROW_HEIGHT;
    }
    running += positiveNumber(declared, DEFAULT_ROW_HEIGHT);
    offsets.push(running);
  }
  return offsets;
}

/**
 * `offsets[index]`, with an out-of-range index answering `0`.
 *
 * `noUncheckedIndexedAccess` is on, so every read of this table is
 * `number | undefined` to the compiler. Funnelling them through one total
 * function is what keeps the `?? 0` in a single place that has its own test,
 * instead of scattering an untested fallback across every call site.
 */
export function offsetAt(offsets: readonly number[], index: number): number {
  return offsets[index] ?? 0;
}

/** The declared height of row `index`, from the table. */
export function rowHeightAt(offsets: readonly number[], index: number): number {
  return Math.max(0, offsetAt(offsets, index + 1) - offsetAt(offsets, index));
}

/**
 * The last row whose top is at or before `position`, by binary search.
 *
 * A linear walk is O(n) per scroll event, which is exactly the cost the
 * virtualizer exists to avoid; at 100,000 rows this is 17 comparisons. The
 * result is clamped into the list, so a `position` past the end of the content
 * answers with the last row rather than with an index nobody can render.
 */
export function findIndexAt(offsets: readonly number[], position: number): number {
  const count = offsets.length - 1;
  if (count <= 0) {
    return 0;
  }
  let low = 0;
  let high = count - 1;
  while (low < high) {
    // Rounded UP: with `low` and `high` adjacent, a rounded-down midpoint is
    // `low` again and the loop never terminates.
    const middle = Math.ceil((low + high) / 2);
    if (offsetAt(offsets, middle) <= position) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** The half-open range of rows to mount, for a list with declared heights. */
export function computeWindowFromOffsets(input: OffsetWindowInput): WindowRange {
  const count = input.offsets.length - 1;
  if (count <= 0) {
    return EMPTY;
  }
  const scrollTop = positiveNumber(input.scrollTop, 0);
  const viewportHeight = positiveNumber(input.viewportHeight, 0);
  const overscan = wholeCount(input.overscan);

  const first = findIndexAt(input.offsets, scrollTop);
  const last = findIndexAt(input.offsets, scrollTop + viewportHeight);
  const start = clampIndex(first - overscan, count);
  const end = Math.min(count, Math.max(start + 1, last + 1 + overscan));
  return { start, end };
}

/**
 * How many rows Page Up / Page Down should move by.
 *
 * At least one, always: a viewport too short to fit a whole row would otherwise
 * make the paging keys do nothing at all, which reads as a broken keyboard
 * rather than as a small window.
 */
export function rowsPerPage(input: PageStepInput): number {
  const viewportHeight = positiveNumber(input.viewportHeight, 0);
  if (input.offsets === null) {
    const rowHeight = positiveNumber(input.rowHeight, DEFAULT_ROW_HEIGHT);
    return Math.max(1, Math.floor(viewportHeight / rowHeight));
  }
  const itemCount = wholeCount(input.itemCount);
  if (itemCount === 0) {
    return 1;
  }
  const from = clampIndex(wholeCount(input.fromIndex), itemCount);
  const limit = offsetAt(input.offsets, from) + viewportHeight;
  let index = from;
  while (index + 1 < itemCount && offsetAt(input.offsets, index + 1) <= limit) {
    index += 1;
  }
  return Math.max(1, index - from);
}
