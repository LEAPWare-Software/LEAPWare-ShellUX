import { afterEach, describe, expect, it } from 'vitest';
import { createRevocableShellAPI, createShellStateStore } from '../ShellAPI';
import { createPayloadChannelStore } from '../payload/PayloadChannel';
import { createThemeBridge } from '../theme/ThemeBridge';
import { EMPTY_THEME } from '../theme/normalizeTheme';
import { SEMANTIC_TOKEN_NAME_LIST } from '../theme/tokens.generated';
import { ShellUXError } from '../types';

/**
 * ============================================================================
 * THE TWO THEME MEMBERS ON `IShellAPI`
 * ============================================================================
 * `getTheme` and `onThemeChange` are what an extension actually holds, and the
 * three things worth pinning about them are the ones that are easy to get wrong:
 * every reader gets the SAME record (so the bridge's one-resolve property is not
 * defeated one layer up), revocation is loud, and the disposer is TOTAL so a
 * cleanup running after revocation does not take the tree down.
 * ============================================================================
 */

function mint(): ReturnType<typeof createRevocableShellAPI> {
  return createRevocableShellAPI(
    createShellStateStore(),
    'ext-a',
    () => true,
    createPayloadChannelStore(),
    createThemeBridge(document.documentElement),
  );
}

afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('IShellAPI theme members', () => {
  it('hands every reader the same frozen record, keyed by the host’s own names', () => {
    const first = mint().api;
    const theme = first.getTheme();
    expect(Object.keys(theme)).toEqual([...SEMANTIC_TOKEN_NAME_LIST]);
    expect(Object.isFrozen(theme)).toBe(true);
    expect(first.getTheme()).toBe(theme);
    // In jsdom the document defines nothing, which is the fallback case.
    expect(theme).toEqual(EMPTY_THEME);
  });

  it('shares one bridge across two extensions, so the document is measured once', () => {
    const store = createShellStateStore();
    const payloads = createPayloadChannelStore();
    document.documentElement.style.setProperty('--surface-app', '#121212');
    const bridge = createThemeBridge(document.documentElement);
    const a = createRevocableShellAPI(store, 'ext-a', () => true, payloads, bridge).api;
    const b = createRevocableShellAPI(store, 'ext-b', () => true, payloads, bridge).api;
    expect(a.getTheme()).toBe(b.getTheme());
    expect(a.getTheme()['--surface-app']).toBe('#121212');
  });

  it('refuses an onThemeChange listener that is not a function', () => {
    const { api } = mint();
    let caught: unknown;
    try {
      api.onThemeChange(7 as unknown as () => void);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShellUXError);
    expect((caught as ShellUXError).code).toBe('INVALID_FIELD');
    expect((caught as ShellUXError).field).toBe('listener');
  });

  it('returns a total theme disposer, so unsubscribing after revocation throws nothing', () => {
    const { api, revoke } = mint();
    const seen: number[] = [];
    const stop = api.onThemeChange(() => {
      seen.push(1);
    });
    revoke();

    // Every member is revoked loudly, including taking a NEW subscription...
    expect(() => api.getTheme()).toThrow(ShellUXError);
    expect(() => api.onThemeChange(() => undefined)).toThrow(ShellUXError);
    // ...and the disposer is not, because React calls an effect cleanup on
    // unmount with nowhere to raise to.
    expect(() => {
      stop();
    }).not.toThrow();
    expect(seen).toHaveLength(0);
  });
});
