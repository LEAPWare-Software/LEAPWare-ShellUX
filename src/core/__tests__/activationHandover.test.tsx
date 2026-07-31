import type { ReactElement, ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController, ActiveExtension } from '../ActivationContext';
import type { RibbonContext } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * FOREGROUND HANDOVER — the outgoing extension's state does not come along
 * ============================================================================
 * `selectedItemId` and `activeNavNodeId` belong to whichever extension is in the
 * foreground and to nothing else. `selectedItemId` is a row key in that
 * extension's own list; `activeNavNodeId` names a node in that extension's own
 * navigation tree. When the foreground moves, both are meaningless to the
 * extension that inherits them — and worse than meaningless, because a ribbon
 * predicate asking whether anything is selected answers yes for an item the new
 * extension cannot open, and renders an action whose handler will fail.
 *
 * The host used to publish `activeExtensionId` on its own and leave the other two
 * standing. The mock extensions worked around it with an id-prefix convention,
 * which is a plug-in-side patch for a host-side leak: it only holds if every
 * vendor invents the same convention independently, and it cannot address
 * `activeNavNodeId` at all. These tests hold the host to doing it instead.
 *
 * Three things are asserted, and the third is the one that is easy to get wrong:
 *
 *   1. A real handover clears both fields — whether the new foreground is another
 *      extension, or nothing at all after `blur`, `release` or an unregister.
 *   2. A REPUBLISH of the foreground already in place clears nothing. Republishing
 *      is ordinary, not exotic: the sweep effect re-publishes on every registry
 *      revision, so registering a second extension would otherwise wipe the
 *      selection the user made in the first.
 *   3. The whole handover is ONE notification carrying ONE coherent context.
 *      Clearing the fields in separate writes would publish a snapshot holding the
 *      new `activeExtensionId` beside the old `selectedItemId` — the same torn
 *      state, handed to every subscriber as something it can really read. That is
 *      asserted against what `subscribe` actually delivers, not against the shape
 *      of the code.
 * ============================================================================
 */

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>{children}</ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

interface Harness {
  readonly registry: ExtensionRegistry;
  readonly activation: ActivationController;
  readonly store: ShellStateStore;
}

/** Mount the providers and hand back the three host-side handles. */
function mountHost(): { current: Harness } {
  return renderHook(
    (): Harness => ({
      registry: useRegistry(),
      activation: useActivation(),
      store: useShellStore(),
    }),
    { wrapper: Providers },
  ).result;
}

function register(host: { current: Harness }, blueprint: unknown): void {
  act(() => {
    expect(host.current.registry.register(blueprint).ok).toBe(true);
  });
}

/** Bring `id` to the foreground, failing the test rather than the assertion. */
function activate(host: { current: Harness }, id: string): ActiveExtension {
  let active!: ActiveExtension;
  act(() => {
    const outcome = host.current.activation.activate(id);
    if (!outcome.ok) {
      throw outcome.error;
    }
    active = outcome.active;
  });
  return active;
}

/**
 * Register `mail-ext` and `crm-ext`, activate `mail-ext`, and leave it holding a
 * selection and a navigation node — the state a handover has to clear.
 */
function hostWithMailInForeground(): { current: Harness } {
  const host = mountHost();
  register(host, makeBlueprint({ id: 'mail-ext' }));
  register(host, makeBlueprint({ id: 'crm-ext' }));
  activate(host, 'mail-ext');
  act(() => {
    host.current.store.patchContext({ selectedItemId: 'mail-42', activeNavNodeId: 'root-a' });
  });
  const context = host.current.store.getContext();
  expect(context.activeExtensionId).toBe('mail-ext');
  expect(context.selectedItemId).toBe('mail-42');
  expect(context.activeNavNodeId).toBe('root-a');
  return host;
}

/* -------------------------------------------------------------------------- */
/* 1. A real handover clears the outgoing extension's state                     */
/* -------------------------------------------------------------------------- */

describe('foreground handover clears the outgoing extension state', () => {
  it('clears the selected item when a different extension takes the foreground', () => {
    const host = hostWithMailInForeground();

    activate(host, 'crm-ext');

    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBe('crm-ext');
    // `crm-ext` has no row called `mail-42`, and its ribbon predicates must not be
    // told that one is selected.
    expect(context.selectedItemId).toBeNull();
  });

  it('clears the active navigation node when a different extension takes the foreground', () => {
    const host = hostWithMailInForeground();

    activate(host, 'crm-ext');

    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBe('crm-ext');
    // `root-a` is a node in mail-ext's tree. No prefix convention a plug-in could
    // invent would fix this one: a nav node id is registry-validated, and the
    // pattern admits no vendor prefix.
    expect(context.activeNavNodeId).toBeNull();
  });

  it('clears both when the foreground is dropped by blur', () => {
    const host = hostWithMailInForeground();

    act(() => {
      host.current.activation.blur();
    });

    expect(host.current.store.getContext()).toEqual({
      activeExtensionId: null,
      activeNavNodeId: null,
      selectedItemId: null,
      // Never written by anything, here or elsewhere, and deliberately not
      // started here.
      focusedPane: null,
    });
  });

  it('clears both when the foreground extension is released', () => {
    const host = hostWithMailInForeground();

    let released!: boolean;
    act(() => {
      released = host.current.activation.release('mail-ext');
    });

    expect(released).toBe(true);
    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBeNull();
    expect(context.selectedItemId).toBeNull();
    expect(context.activeNavNodeId).toBeNull();
  });

  it('clears both when the foreground is dropped by the unregister sweep', () => {
    const host = hostWithMailInForeground();

    // Not a controller call at all: the foreground moves from inside the sweep
    // effect, which is the one publication path the host does not drive directly.
    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
    });

    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBeNull();
    expect(context.selectedItemId).toBeNull();
    expect(context.activeNavNodeId).toBeNull();
  });

  it('clears both for a new extension registered under the id the old one had', () => {
    const host = hostWithMailInForeground();

    // One commit, so the sweep effect never separates the three statements: the
    // published `activeExtensionId` does not move at all, and an id comparison
    // would therefore see no handover. It is a different vendor's extension under
    // a reused key, and it is entitled to a clean context.
    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
      expect(host.current.registry.register(makeBlueprint({ id: 'mail-ext' })).ok).toBe(true);
      expect(host.current.activation.activate('mail-ext').ok).toBe(true);
    });

    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBe('mail-ext');
    expect(context.selectedItemId).toBeNull();
    expect(context.activeNavNodeId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A republish is not a handover                                            */
/* -------------------------------------------------------------------------- */

describe('a republished foreground is not a handover', () => {
  it('does not clear a live selection when the same foreground is republished', () => {
    const host = hostWithMailInForeground();

    // Re-activating the extension already in the foreground reuses its entry and
    // republishes it. Nothing moved, so nothing may be cleared — the user's
    // selection is live and the extension holding it has not changed.
    const again = activate(host, 'mail-ext');
    expect(again.id).toBe('mail-ext');

    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBe('mail-ext');
    expect(context.selectedItemId).toBe('mail-42');
    expect(context.activeNavNodeId).toBe('root-a');
  });

  it('does not clear a live selection when another extension registers', () => {
    const host = hostWithMailInForeground();
    const before = host.current.store.getContext();

    // A registration bumps the registry revision, and the sweep effect
    // re-publishes the foreground on every revision. This is the path that makes
    // an incidental republish routine rather than exotic.
    register(host, makeBlueprint({ id: 'docs-ext' }));

    // Nothing changed at all, so the snapshot did not even lose its identity.
    expect(host.current.store.getContext()).toBe(before);
    expect(before.selectedItemId).toBe('mail-42');
    expect(before.activeNavNodeId).toBe('root-a');
  });

  it('does not clear a selection when releasing an extension that is not the foreground', () => {
    const host = hostWithMailInForeground();

    activate(host, 'crm-ext');
    act(() => {
      host.current.store.setSelectedItem('crm-7');
    });

    let released!: boolean;
    act(() => {
      released = host.current.activation.release('mail-ext');
    });

    // `reconcileForeground` re-derived the same live entry, so crm-ext keeps both
    // the foreground and the selection it just made.
    expect(released).toBe(true);
    const context = host.current.store.getContext();
    expect(context.activeExtensionId).toBe('crm-ext');
    expect(context.selectedItemId).toBe('crm-7');
  });

  it('does not clear anything when blur is called with nothing in the foreground', () => {
    const host = mountHost();
    act(() => {
      host.current.store.patchContext({ selectedItemId: 'host-row', activeNavNodeId: 'root-a' });
    });
    const before = host.current.store.getContext();

    act(() => {
      host.current.activation.blur();
    });

    // `null` to `null` is not a transition, so there is nothing to hand over and
    // nothing to clear.
    expect(host.current.store.getContext()).toBe(before);
    expect(before.selectedItemId).toBe('host-row');
    expect(before.activeNavNodeId).toBe('root-a');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. The handover is one coherent context                                     */
/* -------------------------------------------------------------------------- */

describe('the handover is one coherent context, not a torn one', () => {
  /**
   * Record what `subscribe` actually delivers.
   *
   * A listener is called after the commit and before the writing statement
   * returns, so `getContext()` inside it is precisely what every subscriber can
   * read at that instant. That makes this the observation the claim is about, and
   * not a restatement of the implementation.
   */
  function recordNotifications(store: ShellStateStore): Readonly<RibbonContext>[] {
    const seen: Readonly<RibbonContext>[] = [];
    store.subscribe(() => {
      seen.push(store.getContext());
    });
    return seen;
  }

  it('never lets a subscriber observe the new extension beside the old selection', () => {
    const host = hostWithMailInForeground();
    const seen = recordNotifications(host.current.store);

    activate(host, 'crm-ext');

    expect(seen.length).toBeGreaterThan(0);
    for (const snapshot of seen) {
      // The torn state, stated as the thing that must never be readable: the
      // incoming extension's id standing beside the outgoing extension's row key.
      const torn =
        snapshot.activeExtensionId === 'crm-ext' &&
        (snapshot.selectedItemId !== null || snapshot.activeNavNodeId !== null);
      expect(torn).toBe(false);
    }
  });

  it('notifies exactly once for the whole handover', () => {
    const host = hostWithMailInForeground();
    const seen = recordNotifications(host.current.store);

    activate(host, 'crm-ext');

    // Three fields moved and one notification carried all three. A separate write
    // per field would be three passes, and the first two would publish exactly the
    // torn snapshot the test above forbids.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      activeExtensionId: 'crm-ext',
      activeNavNodeId: null,
      selectedItemId: null,
      focusedPane: null,
    });
    expect(seen[0]).toBe(host.current.store.getContext());
  });

  it('notifies exactly once when the foreground is dropped by blur', () => {
    const host = hostWithMailInForeground();
    const seen = recordNotifications(host.current.store);

    act(() => {
      host.current.activation.blur();
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      activeExtensionId: null,
      activeNavNodeId: null,
      selectedItemId: null,
      focusedPane: null,
    });
  });
});
