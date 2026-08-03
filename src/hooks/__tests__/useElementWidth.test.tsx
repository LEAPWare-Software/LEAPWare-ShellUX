import { useRef } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementWidth } from '../useElementWidth';

/**
 * ============================================================================
 * THE OBSERVER, AND THE RUNTIME THAT HAS NO OBSERVER
 * ============================================================================
 * `src/test/setup.ts` stubs nothing, on purpose, and this file is why that has to
 * stay true. jsdom has no `ResizeObserver`, so the ABSENT branch is the default
 * here and is exercised by every test that does not install one; the PRESENT
 * branch is exercised by installing a fake on `globalThis` for the duration of
 * one test and removing it afterwards.
 *
 * A global stub in `setup.ts` would make the absent branch unreachable — and an
 * unreachable branch is not a covered branch, whatever the coverage report says
 * about a line that is never evaluated. The two directions are asserted here
 * instead, against one runtime that has the API and one that does not.
 * ============================================================================
 */

/** A controllable stand-in for the platform `ResizeObserver`. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Deliver a resize, the way the platform would. */
  fire(): void {
    this.callback();
  }
}

type WithObserver = { ResizeObserver?: unknown };

/** Install the fake, and hand back the uninstaller. */
function installObserver(): () => void {
  FakeResizeObserver.instances = [];
  (globalThis as WithObserver).ResizeObserver = FakeResizeObserver;
  return (): void => {
    delete (globalThis as WithObserver).ResizeObserver;
  };
}

interface ProbeProps {
  readonly isAttached?: boolean;
}

/** Renders the observed element and reports the hook's answer as text. */
function Probe({ isAttached = true }: ProbeProps): ReactElement {
  const { width, ref } = useElementWidth();
  // Captured so a test can assert that the ref identity really is stable.
  const seen = useRef<Set<unknown>>(new Set());
  seen.current.add(ref);
  return (
    <div>
      <span data-testid="width">{width === null ? 'none' : String(width)}</span>
      <span data-testid="refs">{String(seen.current.size)}</span>
      {isAttached ? <div data-testid="box" ref={ref} /> : null}
    </div>
  );
}

function stubWidth(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 600,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as WithObserver).ResizeObserver;
});

describe('useElementWidth', () => {
  it('reports null and observes nothing when ResizeObserver is absent', () => {
    // No install: this is jsdom as `setup.ts` leaves it, and it is the branch an
    // older embedded WebView takes.
    expect(typeof (globalThis as WithObserver).ResizeObserver).not.toBe('function');
    stubWidth(1200);
    render(<Probe />);
    // `null` rather than `0`: the caller's signal is "nothing observed, use your
    // own measurement", which is not the same statement as "the element is 0px".
    expect(screen.getByTestId('width')).toHaveTextContent('none');
  });

  it('reports the observed width when ResizeObserver is present', () => {
    const uninstall = installObserver();
    stubWidth(1200);
    render(<Probe />);

    // Seeded on attach rather than waiting for the first delivery, so a runtime
    // that HAS the API never spends a frame reporting `null`.
    expect(screen.getByTestId('width')).toHaveTextContent('1200');
    const observer = FakeResizeObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer?.observed[0]).toBe(screen.getByTestId('box'));

    // ...and a later delivery moves it.
    stubWidth(700);
    act(() => {
      observer?.fire();
    });
    expect(screen.getByTestId('width')).toHaveTextContent('700');
    uninstall();
  });

  it('disconnects the observer when the element detaches', () => {
    const uninstall = installObserver();
    stubWidth(1200);
    const { rerender, unmount } = render(<Probe />);
    const first = FakeResizeObserver.instances[0];
    expect(first?.disconnected).toBe(false);

    // React hands the ref `null` when the element goes, which is the only
    // teardown signal this hook needs — there is no effect to run out of order
    // with it.
    rerender(<Probe isAttached={false} />);
    expect(first?.disconnected).toBe(true);
    // Nothing was built to replace it.
    expect(FakeResizeObserver.instances).toHaveLength(1);

    unmount();
    uninstall();
  });

  it('keeps one stable ref identity, so the observer is not rebuilt on every render', () => {
    const uninstall = installObserver();
    stubWidth(1200);
    const { rerender } = render(<Probe />);
    stubWidth(900);
    act(() => {
      FakeResizeObserver.instances[0]?.fire();
    });
    rerender(<Probe />);

    // One ref identity across every render, and therefore one observer.
    expect(screen.getByTestId('refs')).toHaveTextContent('1');
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(false);
    uninstall();
  });

  it('floors a sub-pixel width at one whole pixel', () => {
    const uninstall = installObserver();
    stubWidth(0.4);
    render(<Probe />);
    // `react-resizable-panels` renormalises a layout whose numbers do not add up
    // and warns on every render; a zero or fractional divisor is the quickest
    // route to one.
    expect(screen.getByTestId('width')).toHaveTextContent('1');

    stubWidth(1199.6);
    act(() => {
      FakeResizeObserver.instances[0]?.fire();
    });
    expect(screen.getByTestId('width')).toHaveTextContent('1200');
    uninstall();
  });
});
