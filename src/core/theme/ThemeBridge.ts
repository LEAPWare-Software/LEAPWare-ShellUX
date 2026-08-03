import { useCallback, useSyncExternalStore } from 'react';
import { EMPTY_THEME, isThemeValue, normalizeTheme } from './normalizeTheme';
import type { ResolvedTheme } from './normalizeTheme';
import type { IShellAPI } from '../types';
import { SEMANTIC_TOKEN_NAME_LIST } from './tokens.generated';
import type { SemanticTokenName } from './tokens.generated';

/**
 * ============================================================================
 * ONE `getComputedStyle` PER THEME CHANGE. NEVER ONE PER CHART.
 * ============================================================================
 * **A canvas cannot read a CSS custom property.** `--chart-1` is a value in the
 * style system; a 2D context takes a colour string. So anything that paints on a
 * canvas has to be HANDED resolved values, and the only way to get them is
 * `getComputedStyle`.
 *
 * `getComputedStyle` forces a style recalculation. Resolving at each chart means
 * one forced recalculation per chart per frame, which is the single easiest way
 * to turn a dense dashboard into a janky one. This bridge resolves the WHOLE
 * semantic set — every name in `SEMANTIC_TOKEN_NAME_LIST` — with exactly one
 * `getComputedStyle(root)` call, freezes the result, and hands the same frozen
 * record to every reader until the theme changes. Pinned by "resolves the whole
 * semantic set with exactly one getComputedStyle call" in
 * `src/core/theme/__tests__/themeBridge.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * TWO POSTURES TOWARDS AN ILLEGAL VALUE, AND THE DIFFERENCE IS THE CALLER
 * ---------------------------------------------------------------------------
 * `normalizeTheme` REJECTS a supplied value outside the grammar, because its
 * caller is an extension at an imperative door and a rejection can be reported to
 * it. `resolveFrom` below FALLS BACK for a value the DOCUMENT reports outside the
 * grammar, because its caller is a theme change and there is nobody to report to:
 * throwing there would take the shell down over a stylesheet the host itself
 * shipped. It is the same asymmetry `ActivationContext`'s sweep effect draws when
 * it guards a call it cannot raise out of.
 *
 * That fallback is not a hole. Everything a document can define arrived either
 * from the generated stylesheet — which `npm run tokens:check` measures — or
 * through `normalizeTheme`, which applies the same grammar with teeth. A value
 * that fails here means one of those two doors was bypassed, and the safe answer
 * to that is to report NOTHING for that name rather than to take the shell down.
 * The seed is `EMPTY_THEME`, whose banner says why the host does not invent a
 * colour to put there. Pinned by "falls back to the seed rather than throwing,
 * for a document property outside the grammar" in the same file.
 * ============================================================================
 */

/**
 * Resolve every semantic token from one element's computed style.
 *
 * ONE `getComputedStyle`. The loop reads properties off the single
 * `CSSStyleDeclaration` it returns, which is a lookup rather than a
 * recalculation.
 *
 * An empty answer — which is what every custom property gives in jsdom, and what
 * a real document gives for a property its stylesheet does not define — falls to
 * `base`, exactly as an omitted key does in `normalizeTheme`. So does a value the
 * document reports that is outside the grammar; see the banner for why that is a
 * fallback here and a rejection there.
 */
function resolveFrom(root: Element, base: ResolvedTheme): ResolvedTheme {
  const computed = getComputedStyle(root);
  const record = Object.create(null) as Record<string, string>;
  for (const name of SEMANTIC_TOKEN_NAME_LIST) {
    const raw = computed.getPropertyValue(name).trim();
    record[name] = isThemeValue(raw) ? raw : base[name];
  }
  return Object.freeze(record) as ResolvedTheme;
}

/** The host-side half of the theme bridge. */
export interface ThemeBridgeStore {
  /**
   * The resolved semantic token set. Its IDENTITY is stable until the theme
   * changes, which is what makes it safe to memoise a chart theme on.
   */
  getTheme(): ResolvedTheme;
  /**
   * Register `listener`, called with the new record after every theme change.
   * Returns a TOTAL unsubscribe function — it throws nothing, ever, for the
   * reason `PayloadChannelStore.subscribe`'s does: a view unmounts after its
   * extension is gone, and React calls a cleanup with nowhere to raise to.
   *
   * It is not called on subscribe; call `getTheme()` for the current value.
   */
  subscribe(listener: (theme: ResolvedTheme) => void): () => void;
  /**
   * Re-resolve from the document and broadcast. **The door a theme picker calls,
   * and the shell does not have one yet** — §3.6 of the native-host plan
   * describes it and nothing in `src/` switches a theme today. It is stated that
   * way rather than left to be discovered: this member is exercised by tests and
   * by no production caller, and the honest reading of that is "the mechanism
   * landed before the control did", not "the shell re-themes itself".
   */
  refresh(): void;
  /**
   * Normalise an untrusted theme against the current one and broadcast it.
   *
   * The one caller of `normalizeTheme`, and the reason its rejections have
   * somewhere to go: this is an imperative door, so a theme outside the grammar
   * is a `ShellUXError` at the call site of the mistake. The current resolved
   * theme is the base, so a partial theme fills from what the document already
   * provides rather than from a placeholder.
   *
   * Like `refresh`, it has no production caller yet. It does NOT write to the
   * DOM: what it produces is the record readers get through `getTheme()`.
   * Injecting a normalised theme into a document is §3.6's per-document injection
   * and is not this change.
   *
   * @throws {ShellUXError} whatever `normalizeTheme` decides on.
   */
  applyTheme(candidate: unknown): void;
}

/**
 * Create the theme bridge for one document.
 *
 * Its state is closure variables, for the reason `createShellStateStore`'s is,
 * and the returned object is frozen so its members cannot be replaced.
 *
 * **The resolve happens once, here, and not on every `getTheme()`.** A
 * `getTheme` that resolved on demand would reintroduce the per-reader
 * `getComputedStyle` this module exists to prevent, and would hand a different
 * object identity to every caller — which defeats memoising a chart theme on it.
 */
export function createThemeBridge(root: Element): ThemeBridgeStore {
  let theme = resolveFrom(root, EMPTY_THEME);
  const listeners = new Set<(theme: ResolvedTheme) => void>();

  function broadcast(next: ResolvedTheme): void {
    theme = next;
    // Over a SNAPSHOT, re-checking membership, for the reasons
    // `ShellStateStore.notify` gives.
    for (const listener of Array.from(listeners)) {
      if (listeners.has(listener)) {
        listener(next);
      }
    }
  }

  return Object.freeze({
    getTheme(): ResolvedTheme {
      return theme;
    },

    subscribe(listener: (theme: ResolvedTheme) => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    refresh(): void {
      broadcast(resolveFrom(root, EMPTY_THEME));
    },

    applyTheme(candidate: unknown): void {
      broadcast(normalizeTheme(candidate, theme));
    },
  });
}

/**
 * Subscribe a component to the resolved theme on its own `IShellAPI`.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, for exactly the
 * reason `useChannelPayload` gives: a read taken during render can be stale by
 * the time the tree commits, and two charts resolving at different points would
 * paint two different palettes in one frame.
 *
 * **The snapshot is safe because `getTheme`'s identity is stable.** The bridge
 * resolves once per theme change and hands the same frozen record to every
 * reader until the next one, so two reads with nothing in between are
 * `Object.is`-equal and React bails out. That identity is also what
 * `src/components/chart/Chart.tsx` keys a chart instance's LIFETIME on — a
 * `getTheme` that rebuilt its record per call would dispose and re-initialise
 * every chart on every render. Pinned by "resolves the whole semantic set with
 * exactly one getComputedStyle call" in
 * `src/core/theme/__tests__/themeBridge.test.ts`.
 *
 * @throws {ShellUXError} `REVOKED` during render when the handle has been
 *   revoked, which is the same loud failure `useChannelPayload` chooses.
 */
export function useShellTheme(shell: IShellAPI): ResolvedTheme {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) =>
      shell.onThemeChange(() => {
        onStoreChange();
      }),
    [shell],
  );
  const getSnapshot = useCallback((): ResolvedTheme => shell.getTheme(), [shell]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export type { ResolvedTheme, SemanticTokenName };
