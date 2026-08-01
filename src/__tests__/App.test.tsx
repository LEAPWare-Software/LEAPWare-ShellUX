import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, STORAGE_KEY } from '../core/services/HydrationEngine';
import App from '../App';

/**
 * `App` is two providers and the shell, so what is worth asserting here is the
 * wiring — that the providers are present, nested the right way round, and that
 * the shell renders against an empty registry. Everything the shell DOES is
 * asserted in `src/components/__tests__/ShellLayout.test.tsx`.
 *
 * The previous version of this file asserted the placeholder text "ShellUX host"
 * that ISSUE-001 shipped. That placeholder is gone, so the assertion is
 * rewritten rather than adapted.
 *
 * ---------------------------------------------------------------------------
 * ONE CASE HERE IS ABOUT PERSISTENCE, AND IT IS THE ONLY PLACE THE DEFAULT
 * ENGINE IS EXERCISED END TO END.
 * ---------------------------------------------------------------------------
 * `ShellLayout` takes an optional `engine` prop and every other test in the
 * repository supplies one, because the default is a process-wide singleton over
 * the real `localStorage` and a suite that shared it would pass or fail on its
 * own ordering. `App` supplies none — that is the composition ISSUE-003 asks
 * for — so the path a running shell actually takes is asserted exactly once,
 * here.
 *
 * The entry is written at MODULE SCOPE, which is before any test in this file
 * runs and therefore before anything can construct the lazily created default
 * engine. Written any later it would be seeding a storage nothing will read
 * again, because the engine hydrates once, in its constructor. The same
 * reasoning, and the same placement, as the seed in
 * `src/hooks/__tests__/useLocalStorageState.test.tsx`.
 *
 * jsdom measures every element as 0×0, so `ShellLayout` falls back to
 * `PANE_FALLBACK_PERCENT` — 18/26/56 — and the seeded 22/33/45 is
 * distinguishable from it.
 */
globalThis.localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes: { pane1: 22, pane2: 33, pane3: 45 },
    isPane1Collapsed: false,
    activeExtensionId: null,
    extensions: {},
  }),
);

/** The `data-panel-size` of every panel currently in the group, as numbers. */
function panelSizes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-panel-size]')).map((element) =>
    Number(element.getAttribute('data-panel-size')),
  );
}

describe('App', () => {
  it('mounts the registry and host providers, so the shell renders at all', () => {
    // Both hooks the shell calls on its first line — `useRegistry` and
    // `useActivation` — throw when their provider is missing, so a shell that
    // renders is proof that both providers are above it and in the right order.
    render(<App />);
    expect(screen.getByRole('toolbar', { name: 'Shell ribbon' })).toBeInTheDocument();
  });

  it('renders all three panes with an empty registry', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
  });

  it('leaves the ribbon contextual side empty when nothing is registered', () => {
    const { container } = render(<App />);
    const contextual = container.querySelector('[data-ribbon-side="extension"]');
    expect(contextual).not.toBeNull();
    expect(contextual?.querySelectorAll('button')).toHaveLength(0);
  });

  it('restores a layout the shell persisted through the process-wide engine, with nothing wired up here', () => {
    // `App` imports no engine and passes no `engine` prop; `ShellLayout` resolves
    // `getDefaultHydrationEngine()` for itself. So a layout in the one storage
    // entry `STORAGE_KEY` names is on screen without this file composing
    // anything — which is the whole of "persistence is wired into the running
    // shell" as far as the composition root is concerned.
    const { container } = render(<App />);
    expect(panelSizes(container)).toEqual([22, 33, 45]);
    // The unmeasurable-width fallback band, asserted as ABSENT: without the
    // restore this is what the three panels would be.
    expect(panelSizes(container)).not.toEqual([18, 26, 56]);
  });
});
