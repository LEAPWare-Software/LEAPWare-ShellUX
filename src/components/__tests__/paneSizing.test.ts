import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_STATE, HYDRATION_LIMITS } from '../../core/services/HydrationEngine';
import {
  PANE_FALLBACK_PERCENT,
  PANE_PX,
  clampPanePercent,
  clampToBand,
  isEngineDefaultLayout,
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
