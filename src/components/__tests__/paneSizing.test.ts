import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_STATE, HYDRATION_LIMITS } from '../../core/services/HydrationEngine';
import {
  PANE_FALLBACK_PERCENT,
  PANE_PX,
  clampPanePercent,
  clampToBand,
  fitPaneLayout,
  intentFromRecord,
  isEngineDefaultLayout,
  paneBandsAt,
  percentOf,
} from '../layout/paneSizing';

/**
 * ============================================================================
 * THE PANE-SIZE ARITHMETIC, WITHOUT A SHELL AROUND IT.
 * ============================================================================
 * Until GitHub issue #95 these functions lived inside `ShellLayout.tsx` and were
 * reached only through a rendered shell, where jsdom measures every element at
 * 0x0 — so the one branch of `percentOf` a real window takes was exercised only
 * through widths a test stubbed. Here every branch is asserted directly on
 * numbers, and that is all these cases claim: they are arithmetic over chosen
 * inputs, not a statement about layout. What the browser actually lays out is
 * `e2e/shell-layout.spec.ts`'s question, not this file's.
 * ============================================================================
 */

describe('percentOf — a pixel width as a share of the group', () => {
  it('answers the fallback percentage when the group width is zero or negative', () => {
    expect(percentOf(240, 0, 18)).toBe(18);
    expect(percentOf(240, -1, 18)).toBe(18);
  });

  it('converts pixels to a percentage of a measured group width', () => {
    expect(percentOf(240, 1000, 18)).toBe(24);
    expect(percentOf(360, 1000, 26)).toBe(36);
  });

  it('floors the share at 2 percent, so a pane is never given zero width', () => {
    expect(percentOf(1, 1000, 18)).toBe(2);
    expect(percentOf(0, 1000, 18)).toBe(2);
  });

  it('caps the share at 90 percent, however narrow the group', () => {
    expect(percentOf(400, 100, 29)).toBe(90);
  });
});

describe('clampToBand — a restored percentage held to one pane band', () => {
  it('returns a value inside the band unchanged', () => {
    expect(clampToBand(30, 10, 50)).toBe(30);
  });

  it('raises a value below the band to its low edge and lowers one above to its high edge', () => {
    expect(clampToBand(5, 10, 50)).toBe(10);
    expect(clampToBand(75, 10, 50)).toBe(50);
  });
});

describe('clampPanePercent — a percentage held to the band the engine stores', () => {
  it('clamps to the engine own MIN_PANE_PERCENT and MAX_PANE_PERCENT', () => {
    expect(clampPanePercent(0)).toBe(HYDRATION_LIMITS.MIN_PANE_PERCENT);
    expect(clampPanePercent(100)).toBe(HYDRATION_LIMITS.MAX_PANE_PERCENT);
    expect(clampPanePercent(40)).toBe(40);
  });
});

describe('isEngineDefaultLayout — the engine defaults compared by value', () => {
  it('answers true for a fresh copy of the defaults, not only for the shared frozen object', () => {
    expect(isEngineDefaultLayout(DEFAULT_SHELL_STATE.paneSizes)).toBe(true);
    expect(isEngineDefaultLayout({ ...DEFAULT_SHELL_STATE.paneSizes })).toBe(true);
  });

  it('answers false when any one of the three panes differs from its default', () => {
    const defaults = DEFAULT_SHELL_STATE.paneSizes;
    expect(isEngineDefaultLayout({ ...defaults, pane1: defaults.pane1 + 1 })).toBe(false);
    expect(isEngineDefaultLayout({ ...defaults, pane2: defaults.pane2 + 1 })).toBe(false);
    expect(isEngineDefaultLayout({ ...defaults, pane3: defaults.pane3 + 1 })).toBe(false);
  });
});

describe('the pixel-intent tables', () => {
  it('keeps the 48px collapsed track and every fallback band inside the percentOf clamp', () => {
    expect(PANE_PX.navCollapsed).toBe(48);
    for (const value of Object.values(PANE_FALLBACK_PERCENT)) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(90);
    }
  });

  it('freezes both tables, so no caller can move a constraint at runtime', () => {
    expect(Object.isFrozen(PANE_PX)).toBe(true);
    expect(Object.isFrozen(PANE_FALLBACK_PERCENT)).toBe(true);
  });
});

describe('paneBandsAt — every pane band at one group width', () => {
  it('converts the pixel minimums and maximums at a measured width, and leaves pane 3 uncapped', () => {
    const bands = paneBandsAt(1000);
    // Closeness rather than equality: 176/1000*100 is 17.599999999999998.
    expect(bands.nav.min).toBeCloseTo(17.6, 10);
    expect(bands.nav.max).toBeCloseTo(40, 10);
    expect(bands.list.min).toBeCloseTo(24, 10);
    expect(bands.list.max).toBeCloseTo(64, 10);
    expect(bands.detail.min).toBeCloseTo(26, 10);
    expect(bands.detail.max).toBe(100);
  });

  it('answers the fallback bands for an unmeasurable width', () => {
    expect(paneBandsAt(0)).toEqual({
      nav: { min: PANE_FALLBACK_PERCENT.navMin, max: PANE_FALLBACK_PERCENT.navMax },
      list: { min: PANE_FALLBACK_PERCENT.listMin, max: PANE_FALLBACK_PERCENT.listMax },
      detail: { min: PANE_FALLBACK_PERCENT.detailMin, max: 100 },
    });
  });
});

describe('intentFromRecord — what a persisted record asks the two leading panes to be', () => {
  it('asks for the pixel intent at the given width when the record holds the engine defaults', () => {
    expect(intentFromRecord({ ...DEFAULT_SHELL_STATE.paneSizes }, true, 1000)).toEqual({
      nav: 24,
      list: 36,
    });
    expect(intentFromRecord({ ...DEFAULT_SHELL_STATE.paneSizes }, false, 1200)).toEqual({
      nav: 20,
      list: 30,
    });
  });

  it('asks for the chosen shares unchanged when pane 1 is in the group', () => {
    expect(intentFromRecord({ pane1: 20, pane2: 30, pane3: 50 }, true, 1000)).toEqual({
      nav: 20,
      list: 30,
    });
  });

  it('re-bases the chosen pane-2 share onto the pair when pane 1 is not in the group', () => {
    // 30 of the 80 panes 2 and 3 hold together.
    expect(intentFromRecord({ pane1: 20, pane2: 30, pane3: 50 }, false, 1000).list).toBe(37.5);
  });
});

describe('fitPaneLayout — an intent held to the bands, pane 3 the remainder', () => {
  const bandsAt800 = paneBandsAt(800);

  it('leaves an intent that fits alone, and gives pane 3 exactly what is left', () => {
    expect(fitPaneLayout({ nav: 25, list: 35 }, bandsAt800, true)).toEqual({
      nav: 25,
      list: 35,
      detail: 40,
    });
  });

  it('lifts a leading pane to its minimum and lowers one to its maximum', () => {
    // 176/800 = 22 and 640/800 = 80.
    expect(fitPaneLayout({ nav: 10, list: 30 }, bandsAt800, true).nav).toBe(22);
    expect(fitPaneLayout({ nav: 10, list: 95 }, bandsAt800, false).list).toBe(80);
  });

  it('floors pane 3 at its own minimum rather than handing it a negative share', () => {
    // 260/800 = 32.5, although 100 - 50 - 80 is -30.
    expect(fitPaneLayout({ nav: 50, list: 80 }, bandsAt800, true).detail).toBe(32.5);
  });

  it('subtracts no pane-1 share when pane 1 is not in the group', () => {
    expect(fitPaneLayout({ nav: 25, list: 35 }, bandsAt800, false).detail).toBe(65);
  });
});
