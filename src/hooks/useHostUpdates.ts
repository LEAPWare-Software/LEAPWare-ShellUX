import { useEffect, useState } from 'react';
import type { HostUpdateState, HostUpdates } from '../core/updates/hostUpdates';

/**
 * ============================================================================
 * THE ONE NAME THE NATIVE HOST PUTS ON `window`, AND THE ONLY PLACE IT IS READ.
 * ============================================================================
 *
 * `window.shelluxHost` is written by `electron/preload/index.cts` through
 * `contextBridge.exposeInMainWorld`, under `contextIsolation: true` and
 * `sandbox: true`. It is absent everywhere else — in the browser lane, in the
 * Playwright specs and in jsdom — and its absence is the answer to "is there a
 * native host?", not an error.
 *
 * **THE BRIDGE IS NOT VALIDATED HERE, AND THAT IS A DECISION.** Everything this
 * repository validates at a door is *plug-in* data: `validateBlueprint`,
 * `normalizeTheme`, `normalizeChartSpec`, the payload validator. This is the
 * opposite direction. `window.shelluxHost` is written by the host's own preload,
 * in a world an extension cannot reach — a renderer running under
 * `contextIsolation` cannot forge it, and code that could forge it has already
 * won. Validating it would add branches to satisfy the coverage gate against
 * inputs that cannot occur, which is how a suite acquires tests that assert
 * nothing. The one thing that IS checked is presence, because absence is a real
 * and expected state.
 *
 * **STATE ARRIVES BY SUBSCRIPTION, SEEDED SYNCHRONOUSLY.** The preload holds the
 * last state the main process published and answers `getState()` from it, so the
 * first render already has a real value — `idle` at worst, never `null`. The
 * subscription then delivers every change. There is no polling and no `invoke`
 * round trip on mount, which is what keeps the palette from having a state in
 * which it knows nothing.
 * ============================================================================
 */

/**
 * The shape the preload exposes. Declared here because this is the only module
 * that reads it, and a global augmentation that lives beside its single reader
 * cannot drift away from it.
 */
declare global {
  interface Window {
    readonly shelluxHost?: {
      readonly updates?: {
        getState(): HostUpdateState;
        check(): void;
        restart(): void;
        subscribe(listener: (state: HostUpdateState) => void): () => void;
      };
    };
  }
}

type HostUpdateBridge = NonNullable<NonNullable<Window['shelluxHost']>['updates']>;

/** The bridge, or `null` when this document is not running inside the host. */
function hostUpdateBridge(): HostUpdateBridge | null {
  return window.shelluxHost?.updates ?? null;
}

/**
 * The host updater's live state and its two intents, or `null` off the host.
 *
 * The returned object is rebuilt on every render, which matches how
 * `ShellLayout.tsx` already builds `hostCommands` and `createCommandRegistry` —
 * that file's own comment explains why a memo there would be a dependency array
 * spelling "everything". The same reasoning applies to two bound calls.
 */
export function useHostUpdates(): HostUpdates | null {
  const bridge = hostUpdateBridge();

  // Seeded from the bridge rather than from a constant, so the first render is
  // already correct on a host that checked before this document existed.
  const [state, setState] = useState<HostUpdateState>(() =>
    bridge === null ? { status: 'unsupported', version: null, detail: null } : bridge.getState(),
  );

  useEffect(() => {
    if (bridge === null) {
      return undefined;
    }
    // `subscribe` returns its own unsubscribe, so the cleanup is the host's and
    // not a second bookkeeping scheme built on top of it.
    return bridge.subscribe(setState);
  }, [bridge]);

  if (bridge === null) {
    return null;
  }

  return { state, check: bridge.check, restart: bridge.restart };
}
