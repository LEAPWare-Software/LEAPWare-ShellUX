import { useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode, UIEvent } from 'react';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { FaultBoundary } from '../error/FaultBoundary';
import {
  buildOffsets,
  computeWindow,
  computeWindowFromOffsets,
  normalizeRowHeight,
  offsetAt,
  rowHeightAt,
  rowsPerPage,
} from './virtualWindow';

/**
 * ============================================================================
 * THE WINDOWED LIST FOR PANE 2. SIX DECISIONS, AND ONE DEPENDENCY NOT TAKEN.
 * ============================================================================
 *
 * 0. WHY THIS IS HAND-ROLLED, AND THE HONEST ARGUMENT FOR THE OTHER CHOICE.
 *    Nothing already in `package.json` windows a list: `react-resizable-panels`
 *    sizes panes and the six Radix packages are unstyled interaction primitives.
 *    The computation is the ~40 lines of arithmetic in `./virtualWindow.ts`, a
 *    dependency would not shrink what has to pass the 100% coverage gate, and it
 *    would widen the surface `npm audit --omit=dev` has to stay clean over.
 *
 *    **The counter-argument, stated rather than buried: `@tanstack/react-virtual`
 *    gives MEASURED dynamic row heights for free, and this does not.** What is
 *    supported here is *declared* variable heights — `rowHeight` may be a
 *    function of the index, and a prefix-sum table plus a binary search turns
 *    that into a window. Nothing observes the DOM: a row that renders taller
 *    than it declared overlaps its neighbour, and a row whose height changes
 *    after mount is not noticed at all. The moment a real extension needs
 *    content-measured rows, that is the trigger to revisit this decision rather
 *    than to bolt a `ResizeObserver` per row onto this file.
 *
 * 1. THE WINDOW ARITHMETIC LIVES IN A SEPARATE, PURE MODULE. `./virtualWindow.ts`
 *    is imported here and tested directly. jsdom has no layout engine, so the
 *    edge cases that matter — empty list, single item, a 0px-tall container, an
 *    index left past the end after a removal — are asserted as arithmetic rather
 *    than against a fake layout. Its banner has the full argument.
 *
 * 2. ONE TAB STOP, WITH `aria-activedescendant`. NOT A ROVING `tabIndex`.
 *    Roving tabindex puts real DOM focus on a row element. A virtualizer
 *    unmounts row elements as they leave the window, so a scroll that recycles
 *    the focused row drops focus to `<body>` and the next Tab restarts from the
 *    top of the document. That is a reproducible bug, not a theoretical one. The
 *    scroll container holds the only tab stop and names the active row instead.
 *    *Tests:* "keeps a single tab stop on the container rather than roving focus
 *    onto rows" and "keeps focus on the container when the selected row is
 *    recycled out of the window".
 *
 * 3. SCROLL-INTO-VIEW ASSIGNS `element.scrollTop`. IT DOES NOT CALL
 *    `scrollIntoView()`. Two reasons, and either alone would decide it.
 *    `scrollIntoView` scrolls every scrollable ancestor, so a row near the bottom
 *    of pane 2 also drags the page and any wrapping container; and **jsdom does
 *    not implement it at all**, so a test that called it would be asserting
 *    against a no-op that the browser would have behaved differently for.
 *    Assigning `scrollTop` moves exactly one box and is a real, readable value in
 *    jsdom. *Test:* "scrolls the selected row into view by assigning scrollTop
 *    on its own container".
 *
 * 4. `ResizeObserver` IS OPTIONAL, AND THE FALLBACK IS REAL CODE. It does not
 *    exist in jsdom, and it is absent in older embedded WebViews. When it is
 *    there, a pane resize re-measures immediately. When it is not, the viewport
 *    is re-read on every render and on every scroll, which recovers on the next
 *    interaction rather than instantly. **Both branches have tests** — one fakes
 *    the global, one asserts the list still works with it absent — because a
 *    stub installed globally in `src/test/setup.ts` would make the absent branch
 *    unreachable and untested for everybody. *Tests:* "re-measures through a
 *    ResizeObserver when the environment has one" and "still windows correctly
 *    with no ResizeObserver in the environment".
 *
 *    On resize the scroll position is re-read FROM THE LIVE ELEMENT rather than
 *    from React state. "Pane resize mid-scroll" means precisely that the two have
 *    diverged; trusting the cached value is what makes a resize jump the list.
 *
 * 5. EVERY ROW IS ITS OWN FAULT BOUNDARY, AND THE `option` ELEMENT IS OUTSIDE
 *    IT. The host renders the `role="option"` wrapper with its `aria-setsize`
 *    and `aria-posinset`; the extension's row renderer runs inside a
 *    `FaultBoundary` nested within it. So a row that throws still occupies its
 *    place in the set and is still announced as "3 of 100,000" — the position
 *    information belongs to the list, not to the row's content, and a failed row
 *    that silently vanished from the set would misreport every row after it.
 *    *Tests:* "contains a row renderer that throws for one item only" and
 *    "keeps the position of a failed row in the set".
 *
 * ---------------------------------------------------------------------------
 * ACCEPTED LIMITS, recorded rather than discovered later:
 *
 *   - **No scroll anchoring.** Prepending items above the scroll position moves
 *     the content under the viewport; the shell does not compensate. Correct
 *     anchoring needs a stable item identity to pin to and a measured position
 *     for it, and guessing at it is worse than not doing it.
 *   - **No measured heights** — decision 0.
 *   - **The window is recomputed on every render**, not throttled. At the sizes
 *     ISSUE-004 names this is a binary search and some arithmetic; a scroll
 *     throttle would trade blank frames for CPU and is not obviously the right
 *     trade until it is measured on real content.
 *   - **Selection is internal.** There is no controlled `selectedIndex` prop
 *     yet; an extension that wants to drive selection from outside needs one,
 *     and adding it is additive.
 * ============================================================================
 */

/** Rows mounted beyond each edge of the viewport, absorbing fast scrolls. */
const DEFAULT_OVERSCAN = 4;

/**
 * The comfortable row height (D-29), as the declared number an extension can
 * pass for `rowHeight` instead of typing `32`.
 *
 * A constant, not a lookup into `--row-h-comfortable`: `rowHeight` is a plain
 * `number` by decision 0 above — declared, never measured — and reading a CSS
 * custom property back out of the DOM to get a number this file already knows
 * would be the measurement decision 0 refuses, arrived at from the other
 * direction. The two are kept equal by convention: `src/styles/tokens.generated.css`
 * names `--row-h-comfortable: 32px` for exactly this row, and a change to one
 * without the other is a design/ review's job to catch, the same way `paneBorder`
 * being pointed at the wrong colour is.
 */
export const ROW_HEIGHT_COMFORTABLE = 32;

export interface VirtualizedListProps<T> {
  /** The full list. Only the rows in the window are ever mounted. */
  readonly items: readonly T[];
  /** Accessible name for the listbox. HOST TEXT, not a plug-in string. */
  readonly label: string;
  /** Registry-validated extension id, named by a failed row's fallback. */
  readonly extensionId: string | null;
  /**
   * Declared row height: one number for a uniform list, or a function of the
   * index for a variable one. **Declared, never measured** — see decision 0.
   */
  readonly rowHeight: number | ((index: number) => number);
  /** Rows mounted beyond each edge. Defaults to `DEFAULT_OVERSCAN`. */
  readonly overscan?: number | undefined;
  /** Called with the new index whenever selection moves. */
  readonly onSelect?: ((index: number) => void) | undefined;
  /** A stable key per item. Index-based keys break under insertion. */
  readonly rowKey: (item: T, index: number) => string;
  /** The extension's row renderer. Runs inside a per-row `FaultBoundary`. */
  readonly renderRow: (item: T, index: number) => ReactNode;
}

interface RowContentProps<T> {
  readonly render: (item: T, index: number) => ReactNode;
  readonly item: T;
  readonly index: number;
}

/**
 * The extension's row renderer, called from inside its OWN component.
 *
 * This indirection is the difference between a row boundary that works and one
 * that does not, and it is easy to delete by accident. Calling `renderRow(item,
 * index)` in the list's own render and handing the RESULT to a `FaultBoundary`
 * runs the extension's code in the LIST's render — above the boundary — so a
 * renderer that throws for one item takes the whole list down and the boundary
 * never sees it. Reached through a child component, the call happens during that
 * child's render, which is below the boundary, and exactly one row degrades.
 *
 * *Test:* `src/components/__tests__/VirtualizedList.test.tsx` — "contains a row
 * renderer that throws for one item only".
 */
function RowContent<T>({ render, item, index }: RowContentProps<T>): ReactElement {
  return <>{render(item, index)}</>;
}

/** The DOM id of one row, which is what `aria-activedescendant` points at. */
function rowDomId(listId: string, index: number): string {
  return `${listId}-row-${index}`;
}

/**
 * The React key for a row, from a key function the extension wrote.
 *
 * Guarded on both axes a plug-in can break: it may throw, and it may return
 * something that is not a string. Either answer would otherwise be a failure of
 * the whole list — a thrown key escapes into the pane boundary and takes every
 * row with it — where the honest degradation is one row falling back to a
 * positional key and the rest of the list rendering normally.
 */
function safeRowKey<T>(
  rowKey: (item: T, index: number) => string,
  item: T,
  index: number,
): string {
  let key: unknown;
  try {
    key = rowKey(item, index);
  } catch {
    return `index-${index}`;
  }
  return typeof key === 'string' ? key : `index-${index}`;
}

/**
 * A windowed listbox over `items`.
 *
 * Generic over the item type and ignorant of what a row means: the extension
 * supplies `renderRow`, and this component supplies geometry, selection,
 * keyboard navigation and containment.
 */
export function VirtualizedList<T>({
  items,
  label,
  extensionId,
  rowHeight,
  overscan = DEFAULT_OVERSCAN,
  onSelect,
  rowKey,
  renderRow,
}: VirtualizedListProps<T>): ReactElement {
  const listId = useId();
  // The scroll container is held in STATE rather than in a ref, so that the
  // effects below re-run once it exists. A ref would be `null` on the render
  // that schedules them and would never notify anybody when it stopped being.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Never read. Bumping it is how the `ResizeObserver` below asks for a render,
  // at which point the viewport is re-measured from the live element.
  const [, requestRemeasure] = useState(0);

  // MEASURED DURING RENDER, AND DELIBERATELY NOT HELD IN STATE. This single
  // line is the whole `ResizeObserver`-absent fallback: every render re-reads
  // the live box, so a size change is picked up by the next render whatever
  // caused it — a scroll, a keystroke, or new items. A cached height would need
  // an observer to invalidate it, and the observer is the thing that may not
  // exist. Before the ref has run, `null` reads as a zero-height viewport, which
  // `computeWindow` answers with one row rather than with none.
  const viewportHeight = scrollElement === null ? 0 : scrollElement.clientHeight;

  const itemCount = items.length;
  const uniformHeight = normalizeRowHeight(rowHeight);

  // Rebuilt only when the length or the height function changes. An extension
  // passing an inline arrow for `rowHeight` rebuilds every render; that is its
  // choice to make and the cost is one pass over the list.
  const offsets = useMemo(
    () => (typeof rowHeight === 'function' ? buildOffsets(itemCount, rowHeight) : null),
    [itemCount, rowHeight],
  );

  useEffect(() => {
    if (scrollElement === null) {
      return undefined;
    }
    // `typeof` rather than a bare reference: the global is simply absent in
    // jsdom and in older embedded WebViews, and reading it would throw.
    if (typeof ResizeObserver !== 'function') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      // Read from the LIVE element, never from the `scrollTop` state. A resize
      // arriving mid-scroll is exactly the case where the two have diverged.
      setScrollTop(scrollElement.scrollTop);
      requestRemeasure((tick) => tick + 1);
    });
    observer.observe(scrollElement);
    return () => {
      observer.disconnect();
    };
  }, [scrollElement]);

  const range =
    offsets === null
      ? computeWindow({ itemCount, scrollTop, viewportHeight, rowHeight: uniformHeight, overscan })
      : computeWindowFromOffsets({ offsets, scrollTop, viewportHeight, overscan });

  const totalHeight = offsets === null ? itemCount * uniformHeight : offsetAt(offsets, itemCount);
  const rowTop = (index: number): number =>
    offsets === null ? index * uniformHeight : offsetAt(offsets, index);
  const rowSize = (index: number): number =>
    offsets === null ? uniformHeight : rowHeightAt(offsets, index);

  // Clamped at READ time, not at write time. Items can be removed underneath a
  // selection that was legal when it was made, and a stale index must never
  // reach `items[…]` or `aria-activedescendant`.
  const selected = itemCount === 0 ? -1 : Math.min(selectedIndex, itemCount - 1);
  const isSelectionMounted = selected >= range.start && selected < range.end;

  /** Move selection to `next`, clamped, and bring it into view. */
  const moveTo = (container: HTMLDivElement, next: number): void => {
    if (itemCount === 0) {
      return;
    }
    const index = Math.max(0, Math.min(itemCount - 1, next));
    setSelectedIndex(index);

    const top = rowTop(index);
    const bottom = top + rowSize(index);
    const view = container.clientHeight;
    const current = container.scrollTop;
    if (top < current) {
      container.scrollTop = top;
      setScrollTop(top);
    } else if (bottom > current + view) {
      const target = bottom - view;
      container.scrollTop = target;
      setScrollTop(target);
    }

    if (onSelect !== undefined) {
      onSelect(index);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // `currentTarget` is the scroll container itself and is non-null by
    // construction, which is why nothing here needs a ref or a null guard.
    const container = event.currentTarget;
    const page = rowsPerPage({
      offsets,
      rowHeight: uniformHeight,
      viewportHeight: container.clientHeight,
      fromIndex: selected,
      itemCount,
    });
    const from = selected < 0 ? 0 : selected;

    switch (event.key) {
      case 'ArrowDown':
        moveTo(container, from + 1);
        break;
      case 'ArrowUp':
        moveTo(container, from - 1);
        break;
      case 'Home':
        moveTo(container, 0);
        break;
      case 'End':
        moveTo(container, itemCount - 1);
        break;
      case 'PageDown':
        moveTo(container, from + page);
        break;
      case 'PageUp':
        moveTo(container, from - page);
        break;
      default:
        // Every other key belongs to the page: typing must not be swallowed by
        // a list, and Tab in particular has to keep moving focus out.
        return;
    }
    // Only reached by a key this list actually handled, so the page never loses
    // a scroll or a shortcut to a list that ignored the event anyway.
    event.preventDefault();
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  const mounted: ReactElement[] = [];
  for (let index = range.start; index < range.end; index += 1) {
    const item = items[index] as T;
    mounted.push(
      <div
        key={safeRowKey(rowKey, item, index)}
        id={rowDomId(listId, index)}
        role="option"
        aria-selected={index === selected}
        aria-setsize={itemCount}
        aria-posinset={index + 1}
        data-row-index={index}
        style={{ height: `${rowSize(index)}px` }}
        onClick={() => {
          setSelectedIndex(index);
          if (onSelect !== undefined) {
            onSelect(index);
          }
        }}
        // W3-2 (D-29): the selected fill is `rowSelectedSurface`, and
        // `rowSelectedRule` — the inset left stripe — is dropped rather than
        // kept beside it. R7's "no side stripe, no outline" is written against
        // banners; the same reading applies to a selected row, whose stripe was
        // exactly the border-shaped affordance the plan's "no outline" retires.
        // `aria-selected:font-semibold` is the row's own heavier title weight
        // and needed no change: it already sets the OPTION's font weight, which
        // a row renderer inherits unless it sets its own.
        //
        // `rowFocusRingInset` is written here as the plan names it, and it is
        // HONESTLY NOT YET LIVE: decision 2 above keeps DOM focus on the
        // listbox container, with `aria-activedescendant` naming the current
        // row, so this option element never itself matches `:focus-visible` and
        // the ring cannot paint under today's architecture. Wiring a per-row
        // ring onto a container-focus model needs its own `TOKEN_CLASS` variant
        // (a `group-focus-visible` pairing, not `focus-visible` alone) and W3-2
        // does not add one — rule 6 says a role this file finds it needs waits
        // for its own serialised edit to `tokenClasses.ts` rather than being
        // invented here. The class is left in place for the day that role
        // exists; until then it is inert, and `e2e/list-rows.spec.ts` measures
        // the ring against the mock rows' real, individually-focusable buttons
        // instead, where it truly can paint.
        className={
          'flex min-w-0 items-center overflow-hidden px-1 aria-selected:font-semibold ' +
          `${TOKEN_CLASS.rowSelectedSurface} ${TOKEN_CLASS.rowHoverSurface} ${TOKEN_CLASS.rowFocusRingInset}`
        }
      >
        <FaultBoundary boundaryLabel="This row" extensionId={extensionId} variant="row">
          <RowContent render={renderRow} item={item} index={index} />
        </FaultBoundary>
      </div>,
    );
  }

  return (
    <div
      ref={setScrollElement}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={isSelectionMounted ? rowDomId(listId, selected) : undefined}
      data-virtualized-list=""
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      className={`h-full min-h-0 overflow-y-auto outline-none ${TOKEN_CLASS.listFocusRing}`}
    >
      {/*
        The spacer carries the FULL height of the list, so the scrollbar is the
        real one and its thumb is the right size. The window is absolutely
        positioned inside it and translated to the first mounted row.
      */}
      <div
        data-virtual-spacer=""
        className="relative w-full"
        style={{ height: `${totalHeight}px` }}
      >
        <div
          data-virtual-window=""
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${rowTop(range.start)}px)` }}
        >
          {mounted}
        </div>
      </div>
    </div>
  );
}
