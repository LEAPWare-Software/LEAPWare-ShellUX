import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualizedList } from '../shared/VirtualizedList';
import {
  DEFAULT_ROW_HEIGHT,
  buildOffsets,
  computeWindow,
  computeWindowFromOffsets,
  findIndexAt,
  normalizeRowHeight,
  offsetAt,
  rowHeightAt,
  rowsPerPage,
} from '../shared/virtualWindow';

/**
 * ============================================================================
 * THE VIRTUALIZER, ASSERTED WHERE EACH CLAIM ACTUALLY LIVES.
 * ============================================================================
 * The file is in two halves on purpose.
 *
 * **The arithmetic half** drives `./virtualWindow.ts` directly. jsdom has no
 * layout engine: every box is 0×0 unless a getter is stubbed, and
 * `scrollIntoView` is not implemented at all. ISSUE-004's numeric edge cases —
 * an empty list, a single item, a 0px container, an index left past the end
 * after a removal, a fast scroll landing beyond a shrunken list — are statements
 * about arithmetic, and asserting them through a rendered tree would mean
 * asserting them against a fake layout that agrees with whatever the component
 * happens to do.
 *
 * **The DOM half** drives the real component, with `clientHeight` stubbed on
 * `Element.prototype` so the viewport has a size. That stub is the sibling of
 * the `getBoundingClientRect` stub `ShellLayout.test.tsx` uses, and it is
 * removed after every case.
 *
 * `ResizeObserver` is NOT stubbed in `src/test/setup.ts`, and must not be. A
 * global stub would make the "no ResizeObserver" branch — which is the branch
 * every jsdom test and every older WebView actually takes — unreachable and
 * untested. It is installed and removed per case, and both branches have their
 * own case below.
 * ============================================================================
 */

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'VirtualizedList.tsx');

interface Row {
  readonly id: string;
  readonly text: string;
}

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `row-${index}`,
    text: `Row ${index}`,
  }));
}

const ORIGINAL_CLIENT_HEIGHT = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');

/** Give every element a measurable height, which jsdom otherwise refuses to. */
function stubViewportHeight(height: number): void {
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
}

/** A `ResizeObserver` that exists, remembers its callback, and can be fired. */
class FakeResizeObserver {
  static latest: FakeResizeObserver | null = null;
  readonly notify: () => void;
  observed: Element | null = null;
  disconnected = false;

  constructor(callback: () => void) {
    this.notify = callback;
    FakeResizeObserver.latest = this;
  }

  observe(target: Element): void {
    this.observed = target;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

function installResizeObserver(): void {
  FakeResizeObserver.latest = null;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });
}

interface ListProps {
  readonly items?: readonly Row[];
  readonly rowHeight?: number | ((index: number) => number);
  readonly overscan?: number;
  readonly onSelect?: (index: number) => void;
  readonly rowKey?: (item: Row, index: number) => string;
  readonly renderRow?: (item: Row, index: number) => ReactNode;
  readonly withoutSelectHandler?: boolean;
}

function List({
  items = rows(100),
  rowHeight = 20,
  overscan,
  onSelect,
  rowKey = (item) => item.id,
  renderRow = (item) => <span>{item.text}</span>,
  withoutSelectHandler = false,
}: ListProps): ReactElement {
  return (
    <VirtualizedList
      items={items}
      label="Messages"
      extensionId="sample-ext"
      rowHeight={rowHeight}
      overscan={overscan}
      onSelect={withoutSelectHandler ? undefined : onSelect}
      rowKey={rowKey}
      renderRow={renderRow}
    />
  );
}

function listbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Messages' });
}

function mountedIndices(): number[] {
  return screen
    .queryAllByRole('option')
    .map((option) => Number(option.getAttribute('data-row-index')));
}

/** Every identifier, string literal and template chunk in a module's CODE. */
function codeWords(path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const words: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      words.push(node.text);
    }
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      words.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return words;
}

beforeEach(() => {
  stubViewportHeight(400);
});

afterEach(() => {
  if (ORIGINAL_CLIENT_HEIGHT !== undefined) {
    Object.defineProperty(Element.prototype, 'clientHeight', ORIGINAL_CLIENT_HEIGHT);
  }
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  vi.restoreAllMocks();
});

describe('computeWindow — the window arithmetic, with no layout engine involved', () => {
  it('mounts nothing at all for an empty list', () => {
    expect(
      computeWindow({ itemCount: 0, scrollTop: 0, viewportHeight: 400, rowHeight: 20, overscan: 4 }),
    ).toEqual({ start: 0, end: 0 });
  });

  it('mounts the single item of a one-item list', () => {
    expect(
      computeWindow({ itemCount: 1, scrollTop: 0, viewportHeight: 400, rowHeight: 20, overscan: 4 }),
    ).toEqual({ start: 0, end: 1 });
  });

  it('still yields a row when the container is 0px tall, so a pane cannot stay blank', () => {
    // The initial-layout case: a pane measured before it has been laid out.
    // A zero-item window here would need something unrelated to re-render the
    // list before anything was ever visible.
    const window = computeWindow({
      itemCount: 50,
      scrollTop: 0,
      viewportHeight: 0,
      rowHeight: 20,
      overscan: 0,
    });
    expect(window).toEqual({ start: 0, end: 1 });
  });

  it('divides by the row height and never by the item count', () => {
    // The divide-by-zero in this shape of code comes from dividing a scroll
    // position by a MEASURED quantity. Nothing here divides by anything the
    // caller can drive to zero: a rowHeight of 0, NaN, Infinity, a negative or a
    // non-number all resolve to the documented default instead.
    const hostile = [0, Number.NaN, Number.POSITIVE_INFINITY, -20, 'tall'];
    for (const rowHeight of hostile) {
      const window = computeWindow({
        itemCount: 10,
        scrollTop: 100,
        viewportHeight: 400,
        rowHeight: rowHeight as number,
        overscan: 0,
      });
      expect(Number.isInteger(window.start)).toBe(true);
      expect(Number.isInteger(window.end)).toBe(true);
      expect(window.end).toBeGreaterThan(window.start);
    }
    expect(normalizeRowHeight('tall')).toBe(DEFAULT_ROW_HEIGHT);
    expect(normalizeRowHeight(18)).toBe(18);
  });

  it('clamps a start past the end when the list shrinks under a deep scroll', () => {
    // Scrolled to row 500, then all but five items are removed. The window has
    // to land inside the five that remain rather than on an index nobody can
    // render — and it must not be empty.
    expect(
      computeWindow({
        itemCount: 5,
        scrollTop: 10000,
        viewportHeight: 400,
        rowHeight: 20,
        overscan: 2,
      }),
    ).toEqual({ start: 4, end: 5 });
  });

  it('bounds the window by viewport plus overscan rather than by item count', () => {
    const small = computeWindow({
      itemCount: 100,
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 20,
      overscan: 4,
    });
    const huge = computeWindow({
      itemCount: 100000,
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 20,
      overscan: 4,
    });
    expect(huge.end - huge.start).toBe(small.end - small.start);
    expect(huge.end - huge.start).toBeLessThan(40);
  });

  it('treats a negative scroll position and a hostile overscan as zero', () => {
    expect(
      computeWindow({
        itemCount: 100,
        scrollTop: -500,
        viewportHeight: 400,
        rowHeight: 20,
        overscan: Number.NaN,
      }),
    ).toEqual({ start: 0, end: 21 });
  });

  it('overscans equally on both sides of the viewport once scrolled', () => {
    expect(
      computeWindow({
        itemCount: 1000,
        scrollTop: 400,
        viewportHeight: 400,
        rowHeight: 20,
        overscan: 3,
      }),
    ).toEqual({ start: 17, end: 44 });
  });
});

describe('the offset table — declared variable row heights, never measured ones', () => {
  it('builds a prefix sum over the declared heights', () => {
    expect(buildOffsets(4, (index) => (index % 2 === 0 ? 30 : 10))).toEqual([0, 30, 40, 70, 80]);
  });

  it('builds an empty table for an empty list', () => {
    expect(buildOffsets(0, () => 20)).toEqual([0]);
  });

  it('falls back to the default height for a row whose height function throws', () => {
    const heights = buildOffsets(3, (index) => {
      if (index === 1) {
        throw new Error('height function exploded');
      }
      return 30;
    });
    expect(heights).toEqual([0, 30, 30 + DEFAULT_ROW_HEIGHT, 60 + DEFAULT_ROW_HEIGHT]);
  });

  it('falls back to the default height for a declared height that is not usable', () => {
    expect(buildOffsets(2, () => 0)).toEqual([0, DEFAULT_ROW_HEIGHT, DEFAULT_ROW_HEIGHT * 2]);
  });

  it('answers zero for a table index that is out of range', () => {
    // Every read of the table goes through this, so the untested-fallback
    // problem `noUncheckedIndexedAccess` would otherwise scatter around lives
    // here, once, with its own case.
    const offsets = [0, 10, 25];
    expect(offsetAt(offsets, 1)).toBe(10);
    expect(offsetAt(offsets, 9)).toBe(0);
    expect(rowHeightAt(offsets, 1)).toBe(15);
    expect(rowHeightAt(offsets, 9)).toBe(0);
  });

  it('binary-searches the first visible row, and clamps past either end', () => {
    const offsets = buildOffsets(8, () => 25);
    expect(findIndexAt(offsets, 0)).toBe(0);
    expect(findIndexAt(offsets, 74)).toBe(2);
    expect(findIndexAt(offsets, 75)).toBe(3);
    expect(findIndexAt(offsets, 99999)).toBe(7);
    expect(findIndexAt([0], 40)).toBe(0);
    expect(findIndexAt([0, 25], 40)).toBe(0);
  });

  it('windows a variable-height list from the table', () => {
    const offsets = buildOffsets(20, (index) => (index % 2 === 0 ? 40 : 10));
    expect(computeWindowFromOffsets({ offsets, scrollTop: 0, viewportHeight: 100, overscan: 0 })).toEqual(
      { start: 0, end: 5 },
    );
    expect(
      computeWindowFromOffsets({ offsets, scrollTop: 100, viewportHeight: 100, overscan: 1 }),
    ).toEqual({ start: 3, end: 10 });
  });

  it('mounts nothing for an empty offset table', () => {
    expect(
      computeWindowFromOffsets({ offsets: [0], scrollTop: 0, viewportHeight: 400, overscan: 4 }),
    ).toEqual({ start: 0, end: 0 });
  });

  it('pages by the rows that fit, and never by fewer than one', () => {
    expect(
      rowsPerPage({ offsets: null, rowHeight: 20, viewportHeight: 400, fromIndex: 0, itemCount: 100 }),
    ).toBe(20);
    // A viewport too short for a whole row still has to move the selection, or
    // the paging keys read as a broken keyboard.
    expect(
      rowsPerPage({ offsets: null, rowHeight: 20, viewportHeight: 5, fromIndex: 0, itemCount: 100 }),
    ).toBe(1);

    const offsets = buildOffsets(20, () => 25);
    expect(rowsPerPage({ offsets, rowHeight: 0, viewportHeight: 100, fromIndex: 0, itemCount: 20 })).toBe(
      4,
    );
    expect(
      rowsPerPage({ offsets, rowHeight: 0, viewportHeight: 100, fromIndex: 18, itemCount: 20 }),
    ).toBe(1);
    expect(rowsPerPage({ offsets: [0], rowHeight: 0, viewportHeight: 100, fromIndex: 0, itemCount: 0 })).toBe(
      1,
    );
  });
});

describe('VirtualizedList — what is mounted, and what the set announces', () => {
  it('mounts a window bounded by the viewport rather than by the item count', () => {
    render(<List items={rows(100000)} />);
    const mounted = mountedIndices();
    // 400px of viewport at 20px a row is 21 rows, plus 4 of overscan each side.
    expect(mounted.length).toBeLessThan(40);
    expect(mounted[0]).toBe(0);
    expect(screen.queryByText('Row 5000')).toBeNull();
  });

  it('renders an empty list as an empty listbox rather than as nothing', () => {
    render(<List items={[]} />);
    expect(listbox()).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(listbox()).not.toHaveAttribute('aria-activedescendant');
  });

  it('mounts the single row of a one-item list', () => {
    render(<List items={rows(1)} />);
    expect(mountedIndices()).toEqual([0]);
  });

  it('tells assistive technology the size of the whole set, not of the window', () => {
    // Without these a screen reader announces "3 of 29" for a 100,000-row list,
    // because the only rows it can see are the mounted ones.
    render(<List items={rows(100000)} />);
    const [first] = screen.getAllByRole('option');
    expect(first).toHaveAttribute('aria-setsize', '100000');
    expect(first).toHaveAttribute('aria-posinset', '1');
  });

  it('sizes the spacer to the whole list so the scrollbar is the real one', () => {
    const { container } = render(<List items={rows(500)} />);
    expect(container.querySelector('[data-virtual-spacer]')).toHaveStyle({ height: '10000px' });
  });

  it('positions the window with a transform rather than by re-laying out rows', () => {
    const { container } = render(<List items={rows(500)} />);
    const element = listbox();
    element.scrollTop = 1000;
    fireEvent.scroll(element);
    expect(container.querySelector('[data-virtual-window]')).toHaveStyle({
      transform: 'translateY(920px)',
    });
  });

  it('recomputes the window as the container is scrolled', () => {
    render(<List items={rows(500)} />);
    const element = listbox();
    expect(mountedIndices()[0]).toBe(0);
    element.scrollTop = 2000;
    fireEvent.scroll(element);
    expect(mountedIndices()[0]).toBe(96);
    expect(screen.getByText('Row 100')).toBeInTheDocument();
  });

  it('honours declared variable row heights', () => {
    const { container } = render(
      <List items={rows(20)} rowHeight={(index) => (index % 2 === 0 ? 40 : 10)} overscan={0} />,
    );
    expect(container.querySelector('[data-virtual-spacer]')).toHaveStyle({ height: '500px' });
    const [first, second] = screen.getAllByRole('option');
    expect(first).toHaveStyle({ height: '40px' });
    expect(second).toHaveStyle({ height: '10px' });
  });

  it('keeps a window over a list that shrinks while it is scrolled deep', () => {
    const { rerender } = render(<List items={rows(500)} />);
    const element = listbox();
    element.scrollTop = 8000;
    fireEvent.scroll(element);
    expect(mountedIndices()[0]).toBe(396);

    rerender(<List items={rows(5)} />);
    // Not blank, and not an index that does not exist.
    const mounted = mountedIndices();
    expect(mounted.length).toBeGreaterThan(0);
    expect(Math.max(...mounted)).toBeLessThan(5);
  });
});

describe('VirtualizedList — keyboard navigation and focus', () => {
  it('keeps a single tab stop on the container rather than roving focus onto rows', () => {
    // Roving tabindex would put DOM focus on a row element, and a virtualizer
    // unmounts row elements as they leave the window — so a scroll that recycles
    // the focused row drops focus to <body>. One tab stop, named row.
    render(<List />);
    expect(listbox()).toHaveAttribute('tabindex', '0');
    for (const option of screen.getAllByRole('option')) {
      expect(option).not.toHaveAttribute('tabindex');
    }
  });

  it('names the selected row through aria-activedescendant', () => {
    render(<List />);
    const element = listbox();
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    const active = element.getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    const selectedRow = screen.getAllByRole('option').find((option) => option.id === active);
    expect(selectedRow).toHaveAttribute('data-row-index', '1');
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps focus on the container when the selected row is recycled out of the window', () => {
    render(<List items={rows(500)} />);
    const element = listbox();
    act(() => {
      element.focus();
    });
    expect(element).toHaveFocus();

    element.scrollTop = 6000;
    fireEvent.scroll(element);
    // Row 0 is long gone from the DOM. Focus is still where it was, and the
    // dangling activedescendant is dropped rather than pointing at nothing.
    expect(element).toHaveFocus();
    expect(element).not.toHaveAttribute('aria-activedescendant');
  });

  it('moves by row with the arrow keys and clamps at both ends', () => {
    render(<List items={rows(10)} />);
    const element = listbox();
    fireEvent.keyDown(element, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '0');

    fireEvent.keyDown(element, { key: 'ArrowDown' });
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '2');

    fireEvent.keyDown(element, { key: 'End' });
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '9');

    fireEvent.keyDown(element, { key: 'Home' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '0');
  });

  it('moves by a viewport at a time with Page Up and Page Down', () => {
    render(<List items={rows(200)} />);
    const element = listbox();
    fireEvent.keyDown(element, { key: 'PageDown' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '20');
    fireEvent.keyDown(element, { key: 'PageUp' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '0');
  });

  it('pages a variable-height list by the rows that actually fit', () => {
    render(<List items={rows(60)} rowHeight={(index) => (index % 2 === 0 ? 100 : 20)} />);
    const element = listbox();
    fireEvent.keyDown(element, { key: 'PageDown' });
    // 400px of viewport over the 100/20 alternation is six rows, not twenty.
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '6');
  });

  it('leaves every other key to the page, so typing and Tab still work', () => {
    render(<List />);
    const element = listbox();
    const handled = fireEvent.keyDown(element, { key: 'a' });
    // `fireEvent` returns false when a handler called `preventDefault`. A list
    // that swallowed every key would break find-as-you-type and Tab alike.
    expect(handled).toBe(true);
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '0');

    const consumed = fireEvent.keyDown(element, { key: 'ArrowDown' });
    expect(consumed).toBe(false);
  });

  it('does nothing at all when an empty list is navigated', () => {
    render(<List items={[]} />);
    const element = listbox();
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    fireEvent.keyDown(element, { key: 'End' });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(element).not.toHaveAttribute('aria-activedescendant');
  });

  it('scrolls the selected row into view by assigning scrollTop on its own container', () => {
    // NOT `scrollIntoView()`: it scrolls every scrollable ancestor as well, and
    // jsdom does not implement it, so a test asserting it would be asserting
    // against a stub. Assigning `scrollTop` moves exactly one box.
    render(<List items={rows(100)} />);
    const element = listbox();
    expect(element.scrollTop).toBe(0);

    fireEvent.keyDown(element, { key: 'End' });
    // Row 99 spans 1980–2000; a 400px viewport must sit at 1600 to show it.
    expect(element.scrollTop).toBe(1600);

    fireEvent.keyDown(element, { key: 'Home' });
    expect(element.scrollTop).toBe(0);
  });

  it('leaves the scroll position alone when the new row is already visible', () => {
    render(<List items={rows(100)} />);
    const element = listbox();
    fireEvent.keyDown(element, { key: 'End' });
    expect(element.scrollTop).toBe(1600);

    // Row 98 spans 1960–1980, inside the 1600–2000 the container is showing.
    // Nothing needs to move, so nothing does: a list that re-centred on every
    // keystroke would make the content jump under a user who can already see it.
    fireEvent.keyDown(element, { key: 'ArrowUp' });
    expect(element.scrollTop).toBe(1600);
  });

  it('clamps a selection left pointing past the end after items are removed', () => {
    const { rerender } = render(<List items={rows(100)} />);
    fireEvent.keyDown(listbox(), { key: 'End' });
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '99');

    rerender(<List items={rows(5)} />);
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveAttribute('data-row-index', '4');
    expect(selected).toHaveAttribute('aria-setsize', '5');
  });

  it('reports selection to the extension from both the pointer and the keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<List items={rows(10)} onSelect={onSelect} />);
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith(1);

    await user.click(screen.getAllByRole('option')[3] as HTMLElement);
    expect(onSelect).toHaveBeenLastCalledWith(3);
  });

  it('selects without an onSelect handler, because the prop is optional', async () => {
    const user = userEvent.setup();
    render(<List items={rows(10)} withoutSelectHandler />);
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    await user.click(screen.getAllByRole('option')[4] as HTMLElement);
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-index', '4');
  });
});

describe('VirtualizedList — measuring the viewport', () => {
  it('re-measures through a ResizeObserver when the environment has one', () => {
    installResizeObserver();
    stubViewportHeight(100);
    render(<List items={rows(500)} />);
    const before = mountedIndices().length;
    expect(FakeResizeObserver.latest?.observed).toBe(listbox());

    // The pane grows AND the user is part-way down it. The observer must re-read
    // the scroll position from the live element rather than trusting the value
    // React last stored, which is what "resize mid-scroll" means.
    stubViewportHeight(800);
    listbox().scrollTop = 2000;
    act(() => {
      FakeResizeObserver.latest?.notify();
    });
    expect(mountedIndices().length).toBeGreaterThan(before);
    expect(mountedIndices()[0]).toBe(96);
  });

  it('disconnects its ResizeObserver when the list unmounts', () => {
    installResizeObserver();
    const { unmount } = render(<List />);
    const observer = FakeResizeObserver.latest;
    expect(observer?.disconnected).toBe(false);
    unmount();
    expect(observer?.disconnected).toBe(true);
  });

  it('still windows correctly with no ResizeObserver in the environment', () => {
    // jsdom, and every older embedded WebView. The measurement falls back to
    // being re-read on each render, so the size change is picked up by the next
    // interaction rather than instantly — degraded, not broken.
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe('undefined');
    stubViewportHeight(100);
    render(<List items={rows(500)} />);
    const before = mountedIndices().length;

    // The pane grows. Nothing renders, so nothing is noticed yet — that is the
    // limit of this fallback, asserted rather than glossed.
    stubViewportHeight(800);
    expect(mountedIndices().length).toBe(before);

    // The next render re-reads the live box, and the window catches up.
    const element = listbox();
    element.scrollTop = 40;
    fireEvent.scroll(element);
    expect(mountedIndices().length).toBeGreaterThan(before);
  });
});

describe('VirtualizedList — a row that misbehaves', () => {
  it('contains a row renderer that throws for one item only', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <List
        items={rows(10)}
        renderRow={(item, index) => {
          if (index === 3) {
            throw new Error('row 3 is poison');
          }
          return <span>{item.text}</span>;
        }}
      />,
    );
    // The rest of the list is untouched.
    expect(screen.getByText('Row 2')).toBeInTheDocument();
    expect(screen.getByText('Row 4')).toBeInTheDocument();
    expect(mountedIndices()).toHaveLength(10);
    expect(screen.getByText(/row 3 is poison/)).toBeInTheDocument();
  });

  it('keeps the position of a failed row in the set', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <List
        items={rows(10)}
        renderRow={(item, index) => {
          if (index === 3) {
            throw new Error('row 3 is poison');
          }
          return <span>{item.text}</span>;
        }}
      />,
    );
    // The `option` element is rendered OUTSIDE the row boundary, so a failed row
    // still counts. A row that vanished from the set would misreport the
    // position of every row after it.
    const failed = screen.getAllByRole('option')[3];
    expect(failed).toHaveAttribute('aria-posinset', '4');
    expect(failed).toHaveAttribute('aria-setsize', '10');
  });

  it('survives a key function that throws or answers with a non-string', () => {
    render(
      <List
        items={rows(6)}
        rowKey={(item, index) => {
          if (index === 1) {
            throw new Error('key function exploded');
          }
          return index === 2 ? (index as unknown as string) : item.id;
        }}
      />,
    );
    expect(mountedIndices()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('renders extension row content as text, with no HTML-injection path', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(<List items={rows(3)} renderRow={() => hostile} />);
    expect(screen.getAllByText(hostile)).not.toHaveLength(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<img');
  });
});

describe('VirtualizedList — the source', () => {
  it('the module source contains no HTML-injection sink at all', () => {
    const sinks = codeWords(SOURCE).filter((word) =>
      /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|javascript:|data:text\/html/i.test(
        word,
      ),
    );
    expect(sinks).toEqual([]);
  });

  it('the module source names no URL-bearing attribute a plug-in value could reach', () => {
    const urlAttributes = codeWords(SOURCE).filter((word) =>
      /^(?:href|xlinkHref|src|srcSet|formAction|poster)$/.test(word),
    );
    expect(urlAttributes).toEqual([]);
  });

  it('the module source calls no scrollIntoView, which jsdom would silently absorb', () => {
    expect(codeWords(SOURCE).filter((word) => word === 'scrollIntoView')).toEqual([]);
  });

  it('reports a planted sink, so the scans above cannot pass vacuously', () => {
    const planted = ts.createSourceFile(
      'planted.tsx',
      'export const Bad = () => <a href={url} dangerouslySetInnerHTML={{ __html: row }} />;\n',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && /dangerouslySetInnerHTML|^href$/.test(node.text)) {
        found.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(planted);
    expect(found).toEqual(expect.arrayContaining(['dangerouslySetInnerHTML', 'href']));
  });

  it('does not report the docblock, which is why the module may discuss the sinks', () => {
    // The same reason `noEventListener.test.ts` parses instead of grepping: the
    // module's banner names `scrollIntoView` in prose, three times.
    expect(readFileSync(SOURCE, 'utf8')).toContain('scrollIntoView');
  });
});
