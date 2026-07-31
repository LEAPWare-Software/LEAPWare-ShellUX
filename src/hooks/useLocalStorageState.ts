import { useCallback, useSyncExternalStore } from 'react';
import {
  EMPTY_SCOPED_STATE,
  getDefaultHydrationEngine,
} from '../core/services/HydrationEngine';
import type {
  HydrationEngine,
  PersistedShellState,
  PersistedSlot,
  ScopedState,
  ScopedStateInput,
} from '../core/services/HydrationEngine';

/**
 * ============================================================================
 * THE REACT BINDING FOR PERSISTED SHELL STATE
 * ============================================================================
 * Two hooks over `HydrationEngine`, shaped like `useState` so that a caller
 * swapping `useState` for one of these changes one line.
 *
 * **There is no flash of default layout, and the mechanism is the whole point.**
 * The value is read during render through `useSyncExternalStore`, off an engine
 * that hydrated synchronously when it was constructed. Nothing is read in a
 * `useEffect`, because an effect runs AFTER the commit: the default layout would
 * paint, the effect would then correct it, and the user would see the
 * correction. Pinned by "renders the persisted value on the very first paint,
 * and never the default" and "never renders the default value at all, not even
 * once, for a restored pane size" in
 * `src/hooks/__tests__/useLocalStorageState.test.tsx`.
 *
 * `useSyncExternalStore` rather than `useState` for the same reason
 * `useShellContext` uses it: two components bound to the same slot must not tear,
 * and the engine is an external store whose snapshot identity is stable until
 * something really changes.
 *
 * **Neither hook throws because storage is unavailable.** That is a property of
 * the engine — with no usable `localStorage` it serves state from memory — and it
 * is asserted here rather than assumed, because it is this layer the requirement
 * is written against. Pinned by "renders and updates with storage unavailable,
 * and nothing throws".
 *
 * The setters DO throw, for one thing and deliberately: a value that would not
 * survive a JSON round trip. `NaN`, `Infinity`, a `Date`, a `Map`, a `Set` and a
 * function all come back as something other than what went in, so accepting one
 * silently would mean the state a component reads on the next load is not the
 * state it wrote. It is the caller's own bug, reported as a `ShellUXError` at the
 * call site, exactly as `setBadgeCount` reports a bad `count`. Pinned by "refuses
 * a value that would not survive the round trip, and says which one".
 * ============================================================================
 */

export interface UseLocalStorageStateOptions {
  /**
   * The engine to bind to. Defaults to the process-wide one over `localStorage`.
   *
   * It exists so a test — or a second shell in one page — can bind to its own
   * engine. Its identity must be stable across renders; the default one is.
   */
  readonly engine?: HydrationEngine;
}

/**
 * Bind to one slot of persisted shell state.
 *
 * @param slot One of `paneSizes`, `isPane1Collapsed`, `activeExtensionId`.
 * @returns The current value and a setter, in `useState` order.
 */
export function useLocalStorageState<K extends PersistedSlot>(
  slot: K,
  options: UseLocalStorageStateOptions = {},
): readonly [PersistedShellState[K], (next: PersistedShellState[K]) => void] {
  const engine = options.engine ?? getDefaultHydrationEngine();

  const getSnapshot = useCallback((): PersistedShellState[K] => engine.getState()[slot], [
    engine,
    slot,
  ]);
  const value = useSyncExternalStore(engine.subscribe, getSnapshot);

  const setValue = useCallback(
    (next: PersistedShellState[K]): void => {
      engine.setSlot(slot, next);
    },
    [engine, slot],
  );

  return [value, setValue];
}

/**
 * Bind to one extension's persisted UI state.
 *
 * An extension that has persisted nothing reads `EMPTY_SCOPED_STATE`, a shared
 * frozen record, rather than `undefined` — so a consumer needs no branch, and the
 * snapshot identity is stable across renders and across extensions that have
 * nothing stored.
 *
 * **The namespace is collision-resistance, not confinement.** Two extensions
 * that both persist a key named `selection` cannot overwrite each other; nothing
 * stops either of them, or any other script in the page, from reading or
 * rewriting the other's scope. The engine's own banner states the limit in full
 * and names the tests that reproduce it; it is not restated more strongly here.
 *
 * @throws {ShellUXError} `INVALID_ID` during render when `extensionId` is not a
 *   registry-valid identifier. That is a loud, deterministic failure at the point
 *   of the mistake, and it is not a storage failure.
 */
export function useExtensionUiState(
  extensionId: string,
  options: UseLocalStorageStateOptions = {},
): readonly [ScopedState, (next: ScopedStateInput) => void] {
  const engine = options.engine ?? getDefaultHydrationEngine();

  const getSnapshot = useCallback(
    (): ScopedState => engine.getExtensionState(extensionId) ?? EMPTY_SCOPED_STATE,
    [engine, extensionId],
  );
  const value = useSyncExternalStore(engine.subscribe, getSnapshot);

  const setValue = useCallback(
    (next: ScopedStateInput): void => {
      engine.setExtensionState(extensionId, next);
    },
    [engine, extensionId],
  );

  return [value, setValue];
}
