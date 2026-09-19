import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, STORAGE_KEY } from '../core/services/HydrationEngine';
import { RootBoundary } from '../components/error/RootBoundary';
import { ExtensionRegistryProvider, useRegistry } from '../core/RegistryContext';
import type { RegistrationResult } from '../core/RegistryContext';
import { makeBlueprint } from '../core/__tests__/fixtures';
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
  it('composes RootBoundary as the outermost element, above both providers', () => {
    // A boundary that exists but is not wired is the failure mode most likely to
    // ship, so this asserts the SHAPE rather than a behaviour that a boundary
    // one level lower would also produce. `App` is a plain function with no
    // hooks, so calling it returns the element tree directly and the nesting is
    // readable without a renderer.
    //
    // Both halves matter. `RootBoundary` outermost is what makes a throw in
    // either provider's own render catchable at all; `ExtensionRegistryProvider`
    // immediately inside it is the order `ShellHostProvider` depends on, and
    // wrapping the boundary INSIDE a provider would put that provider's render
    // back above every boundary in the tree.
    const tree = App();
    expect(tree.type).toBe(RootBoundary);
    expect((tree.props as { children: { type: unknown } }).children.type).toBe(
      ExtensionRegistryProvider,
    );
  });

  it('leaves no error surface standing when nothing throws', () => {
    // The boundary is transparent on the healthy path: it renders its children
    // and nothing of its own. Without this, the case above would be satisfied by
    // a boundary that is permanently latched.
    render(<App />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('mounts the registry and host providers, so the shell renders at all', () => {
    // Both hooks the shell calls on its first line — `useRegistry` and
    // `useActivation` — throw when their provider is missing, so a shell that
    // renders is proof that both providers are above it and in the right order.
    render(<App />);
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
  });

  it('renders all three panes with an empty registry', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
  });

  it('leaves the context bar contextual side empty when nothing is registered', () => {
    const { container } = render(<App />);
    const contextual = container.querySelector('[data-command-side="extension"]');
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

  it("refuses a lifecycle-declaring registration under App's default, host-chrome-shaped configuration, though no shipped fixture attempts one today", () => {
    // ADR-0006 decision 6's amendment for issue #183: host chrome's own
    // `ExtensionRegistryProvider` runs with no `runsPluginCode` prop here — the
    // default, host-chrome-shaped configuration — so this is the case that
    // stands in for "host chrome never runs plugin lifecycle hooks by default".
    let outcome: RegistrationResult | null = null;

    function Probe(): null {
      const registry = useRegistry();
      outcome = registry.register(makeBlueprint({ lifecycle: { onRelease: () => undefined } }));
      return null;
    }

    render(
      <App>
        <Probe />
      </App>,
    );

    expect(outcome).not.toBeNull();
    // Cast rather than a null-narrowing `if`, matching the convention
    // `lifecycle.test.tsx` uses for a value a nested component assigns:
    // `outcome` is captured by `Probe`'s closure, so TypeScript's control-flow
    // analysis sees only the `= null` initializer at this point in the outer
    // scope and would otherwise narrow the post-check type to `never`.
    const result = outcome as unknown as RegistrationResult;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected the lifecycle-bearing registration to be refused');
    }
    expect(result.error.field).toBe('lifecycle');
  });
});
