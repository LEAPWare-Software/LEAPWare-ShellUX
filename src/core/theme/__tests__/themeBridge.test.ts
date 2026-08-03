import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemeBridge } from '../ThemeBridge';
import { EMPTY_THEME } from '../normalizeTheme';
import { SEMANTIC_TOKEN_NAME_LIST } from '../tokens.generated';
import { ShellUXError } from '../../types';

/**
 * ============================================================================
 * ONE `getComputedStyle` PER THEME CHANGE
 * ============================================================================
 * The claim the bridge exists for is a COUNT, so it is asserted as one: the whole
 * semantic set is resolved with exactly one `getComputedStyle` call, however many
 * names the contract has and however many readers ask for the record afterwards.
 * A per-reader resolve is one forced style recalculation per reader per frame,
 * which is what turns a dense dashboard into a janky one.
 *
 * The second thing asserted here is the posture split: `normalizeTheme` REJECTS a
 * value outside the grammar because its caller can be told, and `resolveFrom`
 * FALLS BACK because a theme change has no caller to tell.
 * ============================================================================
 */

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});

describe('ThemeBridge', () => {
  it('resolves the whole semantic set with exactly one getComputedStyle call', () => {
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(real);

    const bridge = createThemeBridge(document.documentElement);
    expect(spy).toHaveBeenCalledTimes(1);

    // Every reader, forever, gets the same frozen record — no second resolve and
    // no second object identity to defeat a memoised chart theme.
    const first = bridge.getTheme();
    for (let index = 0; index < 20; index += 1) {
      expect(bridge.getTheme()).toBe(first);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(first)).toEqual([...SEMANTIC_TOKEN_NAME_LIST]);
    expect(Object.isFrozen(first)).toBe(true);

    // A theme change is the ONE thing that resolves again.
    bridge.refresh();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reads a document property the stylesheet defines, and falls back for one it does not', () => {
    // jsdom defines no custom properties, which is the fallback case for every
    // name, and is exactly what an un-injected pane document looks like.
    const bare = createThemeBridge(document.documentElement);
    expect(bare.getTheme()).toEqual(EMPTY_THEME);

    document.documentElement.style.setProperty('--surface-app', '#101010');
    const bridge = createThemeBridge(document.documentElement);
    expect(bridge.getTheme()['--surface-app']).toBe('#101010');
    expect(bridge.getTheme()['--text-primary']).toBe(EMPTY_THEME['--text-primary']);
  });

  it('falls back to the seed rather than throwing, for a document property outside the grammar', () => {
    // The posture split. A DOCUMENT value outside the grammar falls back to the
    // seed, because
    // a theme change has nobody to report a rejection to and throwing there would
    // take the shell down over a stylesheet the host shipped. The same value
    // handed to `applyTheme` is refused, because that caller can be told.
    document.documentElement.style.setProperty('--surface-app', 'rebeccapurple');
    const bridge = createThemeBridge(document.documentElement);
    expect(bridge.getTheme()['--surface-app']).toBe(EMPTY_THEME['--surface-app']);

    expect(() => {
      bridge.applyTheme({ '--surface-app': 'rebeccapurple' });
    }).toThrow(ShellUXError);
  });

  it('broadcasts to subscribers on refresh and on applyTheme, and not on subscribe', () => {
    const bridge = createThemeBridge(document.documentElement);
    const seen: string[] = [];
    const stop = bridge.subscribe((theme) => {
      seen.push(theme['--surface-app']);
    });
    // Not called on subscribe: "when do I get the first one?" has one answer, and
    // it is `getTheme()`.
    expect(seen).toEqual([]);

    document.documentElement.style.setProperty('--surface-app', '#111111');
    bridge.refresh();
    expect(seen).toEqual(['#111111']);
    expect(bridge.getTheme()['--surface-app']).toBe('#111111');

    // A normalised third-party theme fills from the CURRENT record rather than
    // from the seed, so a partial theme keeps everything it did not name.
    bridge.applyTheme({ '--text-primary': '#f0f0f0' });
    expect(seen).toEqual(['#111111', '#111111']);
    expect(bridge.getTheme()['--text-primary']).toBe('#f0f0f0');
    expect(bridge.getTheme()['--surface-app']).toBe('#111111');

    stop();
    bridge.refresh();
    expect(seen).toHaveLength(2);
  });

  it('does not call a listener added during a broadcast, nor one removed during it', () => {
    const bridge = createThemeBridge(document.documentElement);
    const calls: string[] = [];
    let dropLater: () => void = () => undefined;
    bridge.subscribe(() => {
      calls.push('first');
      bridge.subscribe(() => {
        calls.push('added-during');
      });
      dropLater();
    });
    dropLater = bridge.subscribe(() => {
      calls.push('second');
    });

    bridge.refresh();
    expect(calls).toEqual(['first']);
  });

  it('is frozen, so no holder can replace one of its members', () => {
    const bridge = createThemeBridge(document.documentElement);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge).sort()).toEqual([
      'applyTheme',
      'getTheme',
      'refresh',
      'subscribe',
    ]);
    expect(() => {
      (bridge as unknown as Record<string, unknown>)['getTheme'] = (): null => null;
    }).toThrow(TypeError);
  });
});
