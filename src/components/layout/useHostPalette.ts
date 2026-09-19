import { useEffect } from 'react';

/**
 * ============================================================================
 * ONE HOST CHORD, TWO DOCUMENTS, AND THE SURFACE THAT OWNS THE PALETTE.
 * ============================================================================
 * The command palette is host chrome's — `HOST_CHORDS` in
 * `src/core/hotkeyDispatch.ts` holds exactly one entry, and
 * `src/components/command/__tests__/hostChrome.test.tsx` pins three independent
 * spellings of "an extension cannot declare it". Phase 7 put panes 2 and 3 in a
 * different document, and that made a question out of something that had never
 * been one: **what happens when the chord is pressed in the surface that does
 * not have the palette in it?**
 *
 * Before this hook, nothing. The extension surface's dispatcher matched the
 * chord, called its handler, set a piece of state no rendered component reads,
 * and the user got silence from a keystroke they use constantly.
 *
 * ---------------------------------------------------------------------------
 * RENDERER-FIRST, AND MAIN ROUTES WHAT THE RENDERER COULD NOT ACT ON
 * ---------------------------------------------------------------------------
 * The obvious alternative is to match the chord in the main process, which
 * already watches `before-input-event` for the escape hatch. It is refused for
 * the reason `electron/main/paneKeyBridge.ts` sets out at length: that event
 * fires BEFORE the renderer's DOM handling and carries neither a target nor
 * `defaultPrevented`, so main cannot tell `Ctrl+K` aimed at the shell from
 * `Ctrl+K` aimed at the omnibox composer the user is typing in. Every
 * suppression rule that answers that question — `isEditableTarget`,
 * `isComposing`, the repeat guard — lives in the renderer and stays there.
 *
 * So the chord is recognised where it always was, and only the surviving INTENT
 * crosses. Main focuses host chrome and tells it to open; see
 * `registerPaletteRouting` in `electron/main/index.ts` for why focus moves as
 * well as the palette opening.
 *
 * ---------------------------------------------------------------------------
 * ONE HOOK FOR BOTH DIRECTIONS, AND IT LIVES HERE RATHER THAN IN `src/hooks/`
 * ---------------------------------------------------------------------------
 * A surface that can ASK is a surface that must also be able to HEAR: host
 * chrome and the extension view load the same preload and the same component,
 * and which of them is which is a prop rather than a build. Splitting this into
 * a sender hook and a receiver hook would have made "who subscribes" a second
 * decision that could disagree with the first one.
 *
 * It sits beside its one caller rather than in `src/hooks/` because it has
 * exactly one caller and no meaning away from it: `useHostUpdates` is a general
 * reading of host state that any surface could want, and this is the answer to
 * one question this component asks about itself.
 * ============================================================================
 */

/** The `panes` half of the preload bridge. Declared in `src/App.tsx`. */
type HostPanesBridge = NonNullable<NonNullable<Window['shelluxHost']>['panes']>;

/** The bridge, or `null` when this document is not running inside the host. */
function hostPanesBridge(): HostPanesBridge | null {
  return window.shelluxHost?.panes ?? null;
}

/**
 * Subscribe to the host's request to open the palette, and get the way to make
 * one.
 *
 * @param onRequested called when another surface's chord reached this one.
 *   **Its identity must be stable** — wrap it in `useCallback` — because it is
 *   the subscription's dependency, and a fresh function every render would
 *   detach and re-attach the listener on every render.
 * @returns the way to hand the chord to the host, or `null` in a browser
 *   document, where there is no other surface and the caller's own palette is
 *   the whole answer.
 */
export function useHostPalette(onRequested: () => void): (() => void) | null {
  const panes = hostPanesBridge();

  useEffect(() => {
    if (panes === null) {
      return undefined;
    }
    // `onPaletteRequest` returns its own unsubscribe, so the cleanup is the
    // host's rather than a second bookkeeping scheme built on top of it — the
    // same shape `useHostUpdates` uses.
    return panes.onPaletteRequest(onRequested);
  }, [panes, onRequested]);

  return panes === null ? null : panes.requestPalette;
}
