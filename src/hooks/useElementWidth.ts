import { useCallback, useRef, useState } from 'react';

/**
 * ============================================================================
 * A LIVE WIDTH, BESIDE `measureGroup` AND NOT INSTEAD OF IT
 * ============================================================================
 * `ShellLayout`'s `measureGroup` is a callback ref, and its timing is the
 * property it exists for: a callback ref runs **during commit**, so the group's
 * width is known before the panel group first mounts and `defaultSize` is
 * honoured on the very first layout. There is no flash, and that is pinned on the
 * render log rather than on a screenshot — "records a defaultSize for all three
 * panes, so the render log is not empty" in
 * `src/components/__tests__/ShellLayoutPersistence.test.tsx`. An effect-based
 * measurement would land one paint later and lose exactly that.
 *
 * **So this hook does not replace it, and must not.** It sits beside it and
 * answers a different question: not "how wide was the group when it mounted?"
 * but "how wide is it now?". `ShellLayout` uses the mount-time answer for
 * `defaultSize` — where a panel STARTS — and the live answer for `minSize` and
 * `maxSize`, which are the pixel intents in `PANE_PX` expressed as a share of
 * whatever the window is at this moment. A `defaultSize` re-derived from a live
 * width would feed the value being dragged back in as the starting point, which
 * is the defect decision 6 of `ShellLayout.tsx` describes for a different field.
 *
 * ---------------------------------------------------------------------------
 * THE ABSENT-`ResizeObserver` BRANCH IS REAL, AND IT IS DELIBERATELY NOT STUBBED
 * ---------------------------------------------------------------------------
 * jsdom does not implement `ResizeObserver`, and neither do some older embedded
 * WebViews this shell is expected to run inside. `typeof ResizeObserver !==
 * 'function'` is therefore a branch a real runtime takes, and the hook's answer
 * for it is to observe nothing and report `null` — leaving every caller on its
 * mount-time measurement, which is what the shell did before this hook existed.
 *
 * **`src/test/setup.ts` deliberately does not stub `ResizeObserver`.** That file
 * stubs nothing, on purpose, and a global stub here would make the absent branch
 * unreachable — a branch that no test can reach is a branch nobody has checked,
 * and the 100% gate would report it as covered because the code is never
 * evaluated at all. The branch is exercised in both directions by installing and
 * removing a fake on `globalThis` inside one test file instead. *Tests:*
 * `src/hooks/__tests__/useElementWidth.test.tsx` — "reports null and observes
 * nothing when ResizeObserver is absent" and "reports the observed width when
 * ResizeObserver is present".
 * ============================================================================
 */

/**
 * The smallest width this hook will report.
 *
 * `react-resizable-panels` renormalises a layout whose numbers do not add up and
 * says so on every render; a sub-pixel or zero width divided into percentages is
 * the fastest way to produce one. A floor of one whole pixel keeps every
 * derived percentage finite and keeps the arithmetic on integers.
 */
const MIN_OBSERVED_WIDTH = 1;

/** The element's width, rounded and floored. Never zero, never fractional. */
function flooredWidth(element: Element): number {
  return Math.max(MIN_OBSERVED_WIDTH, Math.round(element.getBoundingClientRect().width));
}

/** What `useElementWidth` hands back. */
export interface ElementWidth {
  /**
   * The observed width in CSS pixels, or `null` when nothing has been observed —
   * because no element is attached, or because this runtime has no
   * `ResizeObserver`. A caller reads `null` as "use whatever you measured
   * yourself" rather than as a width of zero.
   */
  readonly width: number | null;
  /**
   * The callback ref to attach. **Its identity is stable for the component's
   * whole lifetime**, so React attaches it once rather than detaching and
   * reattaching — and disconnecting and rebuilding the observer — on every
   * render. That is what lets a caller compose it with another callback ref
   * inside a `useCallback` whose dependency list is honest.
   */
  readonly ref: (element: Element | null) => void;
}

/**
 * Observe one element's width, for as long as it is mounted.
 *
 * The observer is created when the element attaches and disconnected when React
 * hands the ref `null`, which it does on unmount and before any reattachment. No
 * `useEffect` is involved, so there is no second source of truth about whether an
 * observer exists and no cleanup that can run out of order with the ref.
 *
 * The observer's callback re-reads the element rather than reading the entry's
 * `contentRect`: `contentRect` excludes padding and border, and what every caller
 * here wants is the same box `getBoundingClientRect` reports, so that the live
 * answer and the mount-time answer are measuring the same thing.
 */
export function useElementWidth(): ElementWidth {
  const [width, setWidth] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: Element | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    if (element === null) {
      return;
    }
    if (typeof ResizeObserver !== 'function') {
      // jsdom, and older embedded WebViews. Nothing is observed and the width
      // stays `null`, which is the caller's signal to keep using its own
      // mount-time measurement. See the banner.
      return;
    }
    const live = new ResizeObserver(() => {
      setWidth(flooredWidth(element));
    });
    live.observe(element);
    observer.current = live;
    // Seeded from the element itself rather than waiting for the observer's
    // first delivery, so a runtime that HAS a `ResizeObserver` does not spend a
    // frame reporting `null` and then correct itself.
    setWidth(flooredWidth(element));
  }, []);

  return { width, ref };
}
