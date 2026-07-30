import { StrictMode, useEffect } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { createShellAPI, useShellContext, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import {
  ExtensionHostBoundary,
  ShellHostProvider,
  useActivation,
  useExtensionActivation,
} from '../ActivationContext';
import type { ActivationController, ActiveExtension } from '../ActivationContext';
import { ShellUXError } from '../types';
import type { ExtensionViewProps, IShellAPI, RibbonContext } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * WHAT A PLUG-IN SUBTREE IS HANDED, AND WHAT IT IS NOT HANDED
 * ============================================================================
 * `ActivationController` is a capability, not information. `release(id)` revokes
 * an extension; `activate(id)` hands back that extension's scoped `IShellAPI`.
 * Published to the whole provider subtree — which is what the provider used to
 * do — a plug-in component could revoke a sibling and then write through the
 * sibling's handle. Both `DEVELOPER.md` and ADR-0001 claimed that was impossible,
 * and `DEVELOPER.md` additionally *instructed* authors to do it.
 *
 * `ExtensionHostBoundary` is the split, and these tests hold both halves: the host
 * harness keeps the controller, and a subtree the host wrapped is not handed it.
 *
 * **Read this before adding a test here that reads as isolation.** Everything in
 * this file is about what the DOCUMENTED route hands over. The boundary is a
 * guardrail, not an enforced barrier: the controller is reachable by walking React's
 * fiber tree from any DOM node on the page, and `reflection.test.tsx` performs that
 * escalation and asserts it succeeds. See ADR-0001 Amendment E. A test in this file
 * that claimed a plug-in "cannot" obtain the controller would be false; a test that
 * claims it is not *given* the controller is true, and that is what these are.
 * ============================================================================
 */

function Providers({ children }: { children: ReactNode }): JSX.Element {
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

/**
 * Hand the surrounding provider's own store to `into`.
 *
 * A provider owns ONE store for ITS subtree, so a test whose observers live in a
 * second `render` tree has to write through that tree's store rather than
 * through `mountHost`'s, or it asserts nothing at all.
 */
function CaptureStore({ into }: { into: (store: ShellStateStore) => void }): null {
  into(useShellStore());
  return null;
}

function mountHost(): { result: { current: Harness }; unmount: () => void } {
  const { result, unmount } = renderHook(
    (): Harness => ({
      registry: useRegistry(),
      activation: useActivation(),
      store: useShellStore(),
    }),
    { wrapper: Providers },
  );
  return { result, unmount };
}

function activate(host: { current: Harness }, blueprint: unknown): ActiveExtension {
  act(() => {
    expect(host.current.registry.register(blueprint).ok).toBe(true);
  });
  let active!: ActiveExtension;
  act(() => {
    const outcome = host.current.activation.activate((blueprint as { id: string }).id);
    if (!outcome.ok) {
      throw outcome.error;
    }
    active = outcome.active;
  });
  return active;
}

/** Run `call`, assert it threw a `ShellUXError`, and return it. */
function expectShellUXError(call: () => void): ShellUXError {
  let caught: unknown;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  return caught as ShellUXError;
}

/**
 * Unregister `id` WITHOUT letting React commit the resulting render.
 *
 * Deliberately outside `act`: the whole question these tests ask is what a
 * retained handle can do in the window between `unregister` and the sweep effect
 * that follows the commit. Wrapping it in `act` would flush that effect and test
 * nothing. React warns about the un-flushed update, and that warning is the
 * expected consequence of the setup rather than a fault, so it is silenced here
 * and only here.
 */
function unregisterWithoutCommitting(registry: ExtensionRegistry, id: string): void {
  const consoleError = console.error;
  console.error = (): void => undefined;
  try {
    expect(registry.unregister(id)).toBe(true);
  } finally {
    console.error = consoleError;
  }
}

/**
 * React logs the error it re-throws from a failed render. That is expected in
 * these cases, so the console is silenced rather than left to imply a fault.
 */
function expectRenderToThrow(element: JSX.Element, message: string): void {
  const consoleError = console.error;
  console.error = (): void => undefined;
  try {
    expect(() => render(element)).toThrow(message);
  } finally {
    console.error = consoleError;
  }
}

/* -------------------------------------------------------------------------- */
/* D1. The host controller is not reachable from a plug-in subtree             */
/* -------------------------------------------------------------------------- */

describe('ExtensionHostBoundary severs the host activation controller', () => {
  it('refuses useActivation inside the boundary, so no plug-in can release a sibling', () => {
    function HostileView(): JSX.Element {
      // The exploit: the controller carries `release`, and `release` revokes
      // whoever is named. This must not resolve at all.
      useActivation();
      return <span />;
    }

    expectRenderToThrow(
      <Providers>
        <ExtensionHostBoundary extensionId="mail-ext">
          <HostileView />
        </ExtensionHostBoundary>
      </Providers>,
      'useActivation is host-only',
    );
  });

  it('keeps the boundary sticky, so a nested provider does not restore the controller', () => {
    function HostileView(): JSX.Element {
      useActivation();
      return <span />;
    }

    expectRenderToThrow(
      <Providers>
        <ExtensionHostBoundary extensionId="mail-ext">
          {/* Re-providing the host tree from inside a plug-in subtree must not
              hand the capability back. */}
          <ExtensionRegistryProvider>
            <ShellHostProvider>
              <HostileView />
            </ShellHostProvider>
          </ExtensionRegistryProvider>
        </ExtensionHostBoundary>
      </Providers>,
      'useActivation is host-only',
    );
  });

  it('refuses a boundary whose extensionId is not a string, which would clear the scope', () => {
    function HostileView(): JSX.Element {
      useActivation();
      return <span />;
    }

    // `extensionId` is declared `string`, and a plain-JavaScript plug-in that
    // passes `null` used to CLEAR the scope marker rather than set it — at which
    // point a provider nested inside the boundary answered `useActivation()` and
    // handed over a controller. The type declaration was the only thing standing
    // in the way, and a plug-in the compiler never saw is not bound by it.
    expectRenderToThrow(
      <Providers>
        <ExtensionHostBoundary extensionId={null as unknown as string}>
          <ExtensionRegistryProvider>
            <ShellHostProvider>
              <HostileView />
            </ShellHostProvider>
          </ExtensionRegistryProvider>
        </ExtensionHostBoundary>
      </Providers>,
      'ExtensionHostBoundary: "extensionId" must be a string',
    );
  });

  it('still lets a host harness outside the boundary drive the controller', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    expect(active.id).toBe('mail-ext');
    expect(host.result.current.activation.getActive()?.id).toBe('mail-ext');
  });

  it('gives a plug-in subtree facts and no capability', () => {
    let view: Record<string, unknown> | undefined;

    function PluginView(): JSX.Element {
      view = useExtensionActivation() as unknown as Record<string, unknown>;
      return <span />;
    }

    render(
      <Providers>
        <ExtensionHostBoundary extensionId="mail-ext">
          <PluginView />
        </ExtensionHostBoundary>
      </Providers>,
    );

    // Exactly the three read-only facts. No activate, no blur, no release, and
    // no route to any extension's `shell`.
    expect(Object.keys(view ?? {}).sort()).toEqual([
      'extensionId',
      'foregroundExtensionId',
      'isForeground',
    ]);
    for (const key of Reflect.ownKeys(view ?? {})) {
      expect(['activate', 'blur', 'release', 'getActive', 'shell']).not.toContain(String(key));
    }
    expect(Object.isFrozen(view)).toBe(true);
  });

  it('reports its own id and tracks the foreground', () => {
    const seen: Array<{ own: string; foreground: string | null; isForeground: boolean }> = [];

    function PluginView(): JSX.Element {
      const activation = useExtensionActivation();
      seen.push({
        own: activation.extensionId,
        foreground: activation.foregroundExtensionId,
        isForeground: activation.isForeground,
      });
      return <span />;
    }

    let harness!: Harness;
    function CaptureHost(): null {
      harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
      return null;
    }

    render(
      <Providers>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <PluginView />
        </ExtensionHostBoundary>
      </Providers>,
    );

    expect(seen.at(-1)).toEqual({ own: 'mail-ext', foreground: null, isForeground: false });

    act(() => {
      expect(harness.registry.register(makeBlueprint({ id: 'mail-ext' })).ok).toBe(true);
    });
    act(() => {
      expect(harness.activation.activate('mail-ext').ok).toBe(true);
    });
    expect(seen.at(-1)).toEqual({ own: 'mail-ext', foreground: 'mail-ext', isForeground: true });

    act(() => {
      expect(harness.registry.register(makeBlueprint({ id: 'crm-ext' })).ok).toBe(true);
    });
    act(() => {
      expect(harness.activation.activate('crm-ext').ok).toBe(true);
    });
    // A sibling took the panes: the fact is visible, the capability is not.
    expect(seen.at(-1)).toEqual({ own: 'mail-ext', foreground: 'crm-ext', isForeground: false });
  });

  it('does NOT sever useRegistry, so unregister stays a route to ending a sibling', () => {
    let outcome: boolean | undefined;
    let siblingShell!: IShellAPI;

    let harness!: Harness;
    function CaptureHost(): null {
      harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
      return null;
    }

    function PluginView(): JSX.Element {
      const registry = useRegistry();
      return (
        <button
          type="button"
          onClick={(): void => {
            outcome = registry.unregister('crm-ext');
          }}
        >
          unregister sibling
        </button>
      );
    }

    render(
      <Providers>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <PluginView />
        </ExtensionHostBoundary>
      </Providers>,
    );

    // The host activates the sibling, as only the host can.
    act(() => {
      expect(harness.registry.register(makeBlueprint({ id: 'crm-ext' })).ok).toBe(true);
    });
    act(() => {
      const result = harness.activation.activate('crm-ext');
      if (!result.ok) {
        throw result.error;
      }
      siblingShell = result.active.shell;
    });

    act(() => {
      screen.getByRole('button', { name: 'unregister sibling' }).click();
    });

    // This is the accepted limit recorded in ADR-0001 Amendment B, not an
    // oversight, and it is pinned here so nobody reads the boundary above as a
    // stronger guarantee than it is: `unregister` carries no authorisation, so a
    // plug-in can still end a sibling's liveness through the registry. What the
    // boundary removes is `release` and, crucially, `activate` — the route to
    // *obtaining* the sibling's handle. Ending liveness without gaining anything
    // is vandalism; gaining the handle was privilege escalation.
    expect(outcome).toBe(true);
    expect(expectShellUXError(() => siblingShell.setSelectedItem('msg-1')).code).toBe('REVOKED');
  });

  it('refuses useExtensionActivation outside a boundary', () => {
    function HostComponent(): JSX.Element {
      useExtensionActivation();
      return <span />;
    }
    expectRenderToThrow(
      <Providers>
        <HostComponent />
      </Providers>,
      'useExtensionActivation must be called inside an <ExtensionHostBoundary>',
    );
  });

  it('refuses useActivation outside ShellHostProvider, as before', () => {
    function Consumer(): JSX.Element {
      useActivation();
      return <span />;
    }
    expectRenderToThrow(<Consumer />, 'useActivation must be called inside a <ShellHostProvider>.');
  });
});

/* -------------------------------------------------------------------------- */
/* D2. Unregistering revokes immediately, not one commit later                 */
/* -------------------------------------------------------------------------- */

describe('revocation on unregister is synchronous', () => {
  it('refuses a write made in the same event handler as the unregister', () => {
    let caught: unknown;
    let landed: string | null | undefined;

    function HostButton(): JSX.Element {
      const registry = useRegistry();
      const activation = useActivation();
      const store = useShellStore();
      return (
        <button
          type="button"
          onClick={(): void => {
            registry.register(makeBlueprint({ id: 'mail-ext' }));
            const outcome = activation.activate('mail-ext');
            if (!outcome.ok) {
              throw outcome.error;
            }
            registry.unregister('mail-ext');
            // The sweep effect has not run: it cannot have, this handler has not
            // yielded. The handle must already be dead anyway.
            try {
              outcome.active.shell.setSelectedItem('landed-anyway');
            } catch (error) {
              caught = error;
            }
            landed = store.getContext().selectedItemId;
          }}
        >
          go
        </button>
      );
    }

    render(
      <Providers>
        <HostButton />
      </Providers>,
    );
    act(() => {
      screen.getByRole('button', { name: 'go' }).click();
    });

    expect(caught).toBeInstanceOf(ShellUXError);
    expect((caught as ShellUXError).code).toBe('REVOKED');
    expect(landed).toBeNull();
  });

  it('is still refused after the microtask queue has drained', async () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));

    unregisterWithoutCommitting(host.result.current.registry, 'mail-ext');
    // The reviewer's point: the gap was not merely a synchronous window, so
    // yielding must not be a way to slip through it either.
    await Promise.resolve();

    expect(expectShellUXError(() => active.shell.setSelectedItem('msg-1')).code).toBe('REVOKED');
    expect(host.result.current.store.getContext().selectedItemId).toBeNull();
  });

  it('refuses every member, and a badge write too', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));

    unregisterWithoutCommitting(host.result.current.registry, 'mail-ext');

    expect(expectShellUXError(() => active.shell.setSelectedItem('msg-1')).code).toBe('REVOKED');
    expect(expectShellUXError(() => active.shell.setBadgeCount('root-a', 1)).code).toBe('REVOKED');
    expect(expectShellUXError(() => active.shell.getContext()).code).toBe('REVOKED');
    expect(host.result.current.store.getContext().selectedItemId).toBeNull();
    expect(host.result.current.store.getBadgeCount('mail-ext', 'root-a')).toBeUndefined();
  });

  it('stops reporting an unregistered extension as the foreground', () => {
    const host = mountHost();
    activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    expect(host.result.current.activation.getActive()?.id).toBe('mail-ext');

    unregisterWithoutCommitting(host.result.current.registry, 'mail-ext');

    // Not "null after the next commit" — null now.
    expect(host.result.current.activation.getActive()).toBeNull();
  });

  it('keeps a live handle working across an unrelated registry change', () => {
    const host = mountHost();
    const mail = activate(host.result, makeBlueprint({ id: 'mail-ext' }));

    act(() => {
      expect(host.result.current.registry.register(makeBlueprint({ id: 'crm-ext' })).ok).toBe(true);
    });
    act(() => {
      host.result.current.registry.unregister('crm-ext');
    });

    // The liveness predicate answers about `mail-ext` and nothing else.
    act(() => {
      mail.shell.setSelectedItem('msg-1');
    });
    expect(host.result.current.store.getContext().selectedItemId).toBe('msg-1');
  });
});

/* -------------------------------------------------------------------------- */
/* D8. Liveness is keyed on the record a handle was minted against             */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * WHY ID PRESENCE IS THE WRONG KEY FOR LIVENESS
 * ============================================================================
 * `unregister(id)` followed by `register(<a new blueprint under the same id>)` is
 * the upgrade path `DEVELOPER.md` documents: "if you need to change what the host
 * shows, unregister and register again". A cooperative author following those
 * instructions used to hit three separate failures, with no hostile code anywhere.
 *
 * React 18 batches two adjacent statements into ONE commit, so every question of
 * the form "is this id still registered?" answers *yes* across the whole
 * operation. The sweep effect saw the id present and skipped the entry; the
 * facade's liveness predicate saw the id present and stayed live. So:
 *
 *   1. The revoked-on-unregister guarantee silently did not apply.
 *   2. Vendor A's retained handle went on writing under a scope vendor B now
 *      owns.
 *   3. `activate(id)` returned the STALE entry, so the host would render the old
 *      version's view components after a successful re-registration.
 *
 * Liveness is therefore keyed on the host-owned record the handle was minted
 * against. The registry builds a fresh record per registration, so "same id" and
 * "same extension" stop being the same question.
 * ============================================================================
 */
describe('re-registering an id does not resurrect the previous handle', () => {
  /**
   * REPLACES an earlier test of the same intent.
   *
   * The old test called through the handle immediately after `unregister` and
   * only then re-registered, which LATCHED the handle before the re-registration
   * had happened. It therefore proved that a latch which has already fired stays
   * fired — never the thing its name claimed. With no call in the gap, and with
   * both registry operations in one commit, the handle stayed live.
   */
  it('revokes an uncalled handle when unregister and register land in one commit', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext', name: 'Vendor A' }));

    act(() => {
      // Two adjacent statements, one commit. Nothing calls through the handle in
      // between, so nothing has had the chance to latch it.
      expect(host.result.current.registry.unregister('mail-ext')).toBe(true);
      expect(
        host.result.current.registry.register(makeBlueprint({ id: 'mail-ext', name: 'Vendor B' }))
          .ok,
      ).toBe(true);
    });

    expect(expectShellUXError(() => active.shell.setSelectedItem('from-vendor-a')).code).toBe(
      'REVOKED',
    );
    expect(host.result.current.store.getContext().selectedItemId).toBeNull();
  });

  it('hands back the new blueprint on re-activation, before any commit has run', () => {
    let firstShell!: IShellAPI;
    let secondName: string | undefined;
    let secondShell!: IShellAPI;

    function HostButton(): JSX.Element {
      const registry = useRegistry();
      const activation = useActivation();
      return (
        <button
          type="button"
          onClick={(): void => {
            registry.register(makeBlueprint({ id: 'mail-ext', name: 'Vendor A' }));
            const first = activation.activate('mail-ext');
            if (!first.ok) {
              throw first.error;
            }
            firstShell = first.active.shell;

            // The whole upgrade, inside one event handler. No commit separates
            // these statements from the activation above or from each other.
            registry.unregister('mail-ext');
            registry.register(makeBlueprint({ id: 'mail-ext', name: 'Vendor B' }));

            const second = activation.activate('mail-ext');
            if (!second.ok) {
              throw second.error;
            }
            secondName = second.active.blueprint.name;
            secondShell = second.active.shell;
          }}
        >
          upgrade
        </button>
      );
    }

    let store!: ShellStateStore;
    render(
      <Providers>
        <CaptureStore
          into={(value): void => {
            store = value;
          }}
        />
        <HostButton />
      </Providers>,
    );
    act(() => {
      screen.getByRole('button', { name: 'upgrade' }).click();
    });

    // The host renders what the registry holds NOW, not the version that
    // happened to be cached under the same id.
    expect(secondName).toBe('Vendor B');
    expect(secondShell).not.toBe(firstShell);

    // The new handle works and the old one is dead.
    act(() => {
      secondShell.setSelectedItem('msg-1');
    });
    expect(store.getContext().selectedItemId).toBe('msg-1');
    expect(expectShellUXError(() => firstShell.setSelectedItem('msg-2')).code).toBe('REVOKED');
    expect(store.getContext().selectedItemId).toBe('msg-1');
  });

  it("keeps vendor A's retained handle out of the badge scope vendor B now owns", () => {
    const host = mountHost();
    const vendorA = activate(host.result, makeBlueprint({ id: 'mail-ext', name: 'Vendor A' }));

    act(() => {
      vendorA.shell.setBadgeCount('root-a', 7);
    });
    expect(host.result.current.store.getBadgeCount('mail-ext', 'root-a')).toBe(7);

    act(() => {
      expect(host.result.current.registry.unregister('mail-ext')).toBe(true);
      expect(
        host.result.current.registry.register(makeBlueprint({ id: 'mail-ext', name: 'Vendor B' }))
          .ok,
      ).toBe(true);
    });

    // The scope `mail-ext` now belongs to vendor B. Vendor A may not write to it.
    expect(expectShellUXError(() => vendorA.shell.setBadgeCount('root-a', 99)).code).toBe('REVOKED');
    expect(host.result.current.store.getBadgeCount('mail-ext', 'root-a')).toBe(7);
  });
});

/* -------------------------------------------------------------------------- */
/* D9. StrictMode's simulated remount must not revoke a live handle            */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * A BUG THAT ONLY HAPPENS IN DEVELOPMENT IS THE WORST SHAPE OF BUG
 * ============================================================================
 * `ShellHostProvider`'s teardown cleanup used to revoke every handle in its live
 * map, and its comment claimed that under StrictMode this was harmless "because
 * the map is still empty because nothing has been activated yet". The map is not
 * empty: passive effects flush child-first, so a descendant that registers and
 * activates from its own mount effect has already put an entry in the map by the
 * time the provider's cleanup runs.
 *
 * The result was a handle that worked in production and was revoked in
 * development. The trigger is the register-and-activate-from-a-mount-effect
 * pattern this repository's own `DEVELOPER.md` documents.
 * ============================================================================
 */
describe('ShellHostProvider under StrictMode', () => {
  it('does not revoke a handle minted by a descendant mount effect', () => {
    const blueprint = makeBlueprint({ id: 'mail-ext' });
    const handles: IShellAPI[] = [];

    function MountingExtension(): null {
      const registry = useRegistry();
      const activation = useActivation();
      useEffect(() => {
        // Exactly the documented pattern: register the module-level singleton,
        // then take the handle. Nothing here releases or unregisters anything.
        registry.register(blueprint);
        const outcome = activation.activate('mail-ext');
        if (!outcome.ok) {
          throw outcome.error;
        }
        handles.push(outcome.active.shell);
      }, [activation, registry]);
      return null;
    }

    let store!: ShellStateStore;
    render(
      <StrictMode>
        <Providers>
          <CaptureStore
            into={(value): void => {
              store = value;
            }}
          />
          <MountingExtension />
        </Providers>
      </StrictMode>,
    );

    // StrictMode ran the mount effect twice, with a cleanup pass in between.
    expect(handles.length).toBe(2);

    // EVERY handle handed out is still usable. Nothing was released and nothing
    // was unregistered, so nothing may have been revoked.
    handles.forEach((shell, index) => {
      const value = `msg-${String(index)}`;
      act(() => {
        shell.setSelectedItem(value);
      });
      expect(store.getContext().selectedItemId).toBe(value);
    });

    // And re-activation still returns the one handle, rather than leaking a
    // second live one for the same extension.
    expect(handles[1]).toBe(handles[0]);
  });

  /**
   * ========================================================================
   * THE WINDOW DID NOT CLOSE; THE TRIGGER JUST NARROWED
   * ========================================================================
   * Replacing the teardown revoke loop with a `mounted` flag moved the defect
   * rather than removing it, and the docblock that replaced it stated a false
   * premise: "Nothing observes the handle between the cleanup and the re-run,
   * because both happen inside one synchronous flush."
   *
   * Something does. Passive effects flush child-first in BOTH directions, so
   * StrictMode's simulated remount runs every destroy (child, then the provider,
   * which sets `mounted` false) and only then every create (child FIRST, the
   * provider LAST). A descendant's mount effect therefore runs while the flag
   * says the provider is gone — and any use of the handle inside that effect saw
   * `isLive()` false and LATCHED the handle revoked for the rest of the session.
   *
   * The test above misses it because it takes the handle in the mount effect and
   * defers the USE to after render. This one uses it where `DEVELOPER.md` says
   * to: in the same effect. Nothing is released and nothing is unregistered, so
   * nothing may be revoked.
   * ========================================================================
   */
  it('does not revoke a handle a descendant USES inside its own mount effect', () => {
    const blueprint = makeBlueprint({ id: 'mail-ext' });
    const handles: IShellAPI[] = [];
    const outcomes: string[] = [];

    function MountingExtension(): null {
      const registry = useRegistry();
      const activation = useActivation();
      useEffect(() => {
        registry.register(blueprint);
        const outcome = activation.activate('mail-ext');
        if (!outcome.ok) {
          throw outcome.error;
        }
        const shell = outcome.active.shell;
        handles.push(shell);
        // The real trigger: use the handle HERE, in the effect that took it.
        try {
          shell.setBadgeCount('root-a', handles.length);
          outcomes.push('ok');
        } catch (error) {
          outcomes.push(error instanceof ShellUXError ? error.code : 'other');
        }
      }, [activation, registry]);
      return null;
    }

    let store!: ShellStateStore;
    render(
      <StrictMode>
        <Providers>
          <CaptureStore
            into={(value): void => {
              store = value;
            }}
          />
          <MountingExtension />
        </Providers>
      </StrictMode>,
    );

    expect(handles.length).toBe(2);
    expect(handles[1]).toBe(handles[0]);
    // Both uses succeeded, and the second badge write is the one that landed.
    expect(outcomes).toEqual(['ok', 'ok']);
    expect(store.getBadgeCount('mail-ext', 'root-a')).toBe(2);

    // And the handle is not latched dead for the rest of the session, which is
    // what the first failing call did to it.
    act(() => {
      handles[0]?.setSelectedItem('msg-1');
    });
    expect(store.getContext().selectedItemId).toBe('msg-1');
  });
});

/* -------------------------------------------------------------------------- */
/* D7. Tearing down the provider revokes what it minted                        */
/* -------------------------------------------------------------------------- */

describe('ShellHostProvider teardown', () => {
  it('does not revoke, and the write it lets through cannot reach a live shell', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    // A second handle, so the two real ending events can each be pinned on a
    // handle of its own rather than one being asserted and the other described.
    // An earlier version of this test claimed "both real ending events" and pinned
    // only `unregister`; ADR-0001 Amendment G records that as the same
    // wider-than-the-premise defect appearing in a test description.
    const secondActive = activate(host.result, makeBlueprint({ id: 'crm-ext' }));
    const orphaned = host.result.current.store;

    act(() => {
      active.shell.setSelectedItem('msg-1');
    });
    expect(orphaned.getContext().selectedItemId).toBe('msg-1');

    host.unmount();

    // Teardown revokes NOTHING, and that is the decision rather than an
    // oversight. Nobody released this extension and nobody unregistered it, so
    // neither of the two events that end liveness happened.
    expect(() => {
      active.shell.setSelectedItem('after-teardown');
    }).not.toThrow();

    // What the write reached is an orphan: the store the dead provider owned,
    // which no component subscribes to and no component can obtain, because
    // `useShellStore` resolves through a context that no longer has a provider.
    expect(orphaned.getContext().selectedItemId).toBe('after-teardown');

    // And this is the property that actually matters, which the revoke-on-teardown
    // version never asserted: the stale handle cannot touch a LIVE shell. A new
    // provider owns its own store, so the retained handle writes nowhere the user
    // can see.
    const next = mountHost();
    expect(next.result.current.store).not.toBe(orphaned);
    act(() => {
      active.shell.setSelectedItem('into-the-void');
    });
    expect(next.result.current.store.getContext().selectedItemId).toBeNull();

    // The two real ending events still work, and each is asserted on a handle this
    // provider minted: `release` on one, `unregister` on the other.
    act(() => {
      expect(host.result.current.activation.release('crm-ext')).toBe(true);
    });
    expect(expectShellUXError(() => secondActive.shell.setSelectedItem('now-dead')).code).toBe(
      'REVOKED',
    );

    act(() => {
      expect(host.result.current.registry.unregister('mail-ext')).toBe(true);
    });
    expect(expectShellUXError(() => active.shell.setSelectedItem('now-dead')).code).toBe('REVOKED');
  });
});

/* -------------------------------------------------------------------------- */
/* D6. The documented, accepted limit: plug-in functions stay mutable          */
/* -------------------------------------------------------------------------- */

describe('an ActiveExtension does not freeze the plug-in functions it carries', () => {
  it('pins the accepted limit: the view components and callbacks take new properties', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));

    // Every container the host owns IS frozen.
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.blueprint)).toBe(true);
    expect(Object.isFrozen(active.blueprint.views)).toBe(true);
    expect(Object.isFrozen(active.blueprint.ribbonActions)).toBe(true);
    expect(Object.isFrozen(active.shell)).toBe(true);

    // The four plug-in function objects are NOT, and this is deliberate:
    // freezing them breaks `memo`/`forwardRef` and they are not the host's to
    // freeze. Documented in ADR-0001 and DEVELOPER.md as an accepted limit of
    // the no-sandbox threat model, NOT as something the host prevents.
    const view = active.blueprint.views.pane2 as unknown as Record<string, unknown>;
    expect(Object.isFrozen(view)).toBe(false);
    view['defaultProps'] = { injected: true };
    expect(view['defaultProps']).toEqual({ injected: true });
    delete view['defaultProps'];

    const action = active.blueprint.ribbonActions[0];
    expect(action).toBeDefined();
    expect(Object.isFrozen(action?.isVisible)).toBe(false);
    expect(Object.isFrozen(action?.onExecute)).toBe(false);
    // The action RECORD itself is the host's, and is frozen.
    expect(Object.isFrozen(action)).toBe(true);
  });

  /**
   * The claim that used to sit beside the one above — that the reach "is bounded
   * by who can obtain an `ActiveExtension`, which now means the host-only
   * controller" — was false, and the counter-example needs nothing exotic.
   * `getExtension` hands out the host-owned record, whose `views` hold the SAME
   * unfrozen function objects, and `useRegistry` is deliberately not severed at
   * the boundary. So the reach is bounded by who can call `useRegistry()`, which
   * is any component in the tree.
   */
  it('is not bounded by who holds an ActiveExtension: useRegistry reaches the same objects', () => {
    const SiblingPane2 = (_props: ExtensionViewProps): null => null;
    const SiblingPane3 = (_props: ExtensionViewProps): null => null;

    let harness!: Harness;
    function CaptureHost(): null {
      harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
      return null;
    }

    function PluginView(): JSX.Element {
      // `useRegistry` from inside a boundary. Documented as not severed, and it
      // is the whole counter-example.
      const registry = useRegistry();
      return (
        <button
          type="button"
          onClick={(): void => {
            const sibling = registry.getExtension('crm-ext');
            const view = sibling?.views.pane2 as unknown as Record<string, unknown>;
            view['defaultProps'] = { injected: 'by mail-ext' };
          }}
        >
          tamper
        </button>
      );
    }

    render(
      <Providers>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <PluginView />
        </ExtensionHostBoundary>
      </Providers>,
    );

    act(() => {
      expect(
        harness.registry.register(
          makeBlueprint({
            id: 'crm-ext',
            views: { pane2: SiblingPane2, pane3: SiblingPane3 },
          }),
        ).ok,
      ).toBe(true);
    });
    // Nobody has activated crm-ext, so no `ActiveExtension` for it exists at all.
    expect(harness.activation.getActive()).toBeNull();

    act(() => {
      screen.getByRole('button', { name: 'tamper' }).click();
    });

    // The injection landed on the sibling's real component object.
    expect((SiblingPane2 as unknown as Record<string, unknown>)['defaultProps']).toEqual({
      injected: 'by mail-ext',
    });
    expect(harness.registry.getExtension('crm-ext')?.views.pane2).toBe(SiblingPane2);
  });
});

/* -------------------------------------------------------------------------- */
/* D8. The store object a plug-in is handed cannot be rewired                   */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * NO REFLECTION REQUIRED: `useShellStore()` IS THE DOCUMENTED PUBLIC API
 * ============================================================================
 * A plug-in view renders inside `ShellHostProvider`, so `useShellStore()`
 * answers it and hands it the one host-owned store — the same object the host
 * and every other extension's facade write through. That is an accepted limit,
 * recorded in ADR-0001, and the answer to it is that every member of the store
 * validates its arguments.
 *
 * That answer only holds if the members are still the host's. The store was
 * returned as a plain mutable object literal, so a plug-in could assign over
 * `setSelectedItem` and record or discard every write another extension made
 * through its own deep-frozen facade, or over `getContext` and forge what a
 * victim pane reads, or over `patchContext` and make the host's foreground
 * publication evaporate. `createShellAPI`'s facade has been deep-frozen against
 * exactly this since it was written; the store beneath it was not.
 *
 * These tests use the documented channel only. `reflection.test.tsx` pins the
 * same property for a caller who arrives by walking the fiber tree.
 * ============================================================================
 */
describe('the store handed out by useShellStore is frozen', () => {
  it('refuses a method swap from inside an ExtensionHostBoundary', () => {
    let harness!: Harness;
    let storeSeenByPlugin: ShellStateStore | null = null;
    let swapError: unknown;
    const swallowed: (string | null)[] = [];

    function CaptureHost(): null {
      harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
      return null;
    }

    // A plug-in view doing nothing the public API forbids: it asks for the store
    // and tries to put its own function in place of a member.
    function HostileView(): null {
      const store = useShellStore();
      storeSeenByPlugin = store;
      try {
        (store as unknown as Record<string, unknown>)['setSelectedItem'] = (
          id: string | null,
        ): void => {
          swallowed.push(id);
        };
      } catch (error) {
        swapError = error;
      }
      return null;
    }

    render(
      <Providers>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <HostileView />
        </ExtensionHostBoundary>
      </Providers>,
    );

    // One store per provider, and the plug-in got that one — this is the premise
    // the rest of the test rests on, not an incidental check.
    expect(storeSeenByPlugin).toBe(harness.store);
    expect(Object.isFrozen(harness.store)).toBe(true);
    expect(swapError).toBeInstanceOf(TypeError);

    // Now a second extension writes through its OWN deep-frozen facade.
    let victimShell!: IShellAPI;
    act(() => {
      expect(harness.registry.register(makeBlueprint({ id: 'crm-ext' })).ok).toBe(true);
    });
    act(() => {
      const outcome = harness.activation.activate('crm-ext');
      if (!outcome.ok) {
        throw outcome.error;
      }
      victimShell = outcome.active.shell;
    });
    act(() => {
      victimShell.setSelectedItem('crm-selection');
    });

    // The REPLACEMENT interceptor never ran, and the write reached the real
    // context. That is the whole of what this test establishes; it is not a claim
    // that the write is unobservable, because `subscribe` intercepts without
    // replacing anything — see `subscribe.test.tsx` and ADR-0001 Amendment G.
    expect(swallowed).toEqual([]);
    expect(harness.store.getContext().selectedItemId).toBe('crm-selection');
  });

  it('refuses to have getContext forged under a victim pane', () => {
    let harness!: Harness;
    const swapErrors: unknown[] = [];
    let victimSnapshot: Readonly<RibbonContext> | null = null;

    function CaptureHost(): null {
      harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
      return null;
    }

    function HostileView(): null {
      const store = useShellStore();
      for (const member of ['getContext', 'patchContext', 'subscribe'] as const) {
        try {
          (store as unknown as Record<string, unknown>)[member] = (): unknown => ({
            selectedItemId: { injected: true },
            focusedPane: 'pane9',
            activeExtensionId: null,
            activeNavNodeId: null,
          });
        } catch (error) {
          swapErrors.push(error);
        }
      }
      return null;
    }

    // A pane owned by somebody else, reading the context the ordinary way.
    function VictimPane(): null {
      victimSnapshot = useShellContext();
      return null;
    }

    render(
      <Providers>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <HostileView />
        </ExtensionHostBoundary>
        <ExtensionHostBoundary extensionId="crm-ext">
          <VictimPane />
        </ExtensionHostBoundary>
      </Providers>,
    );

    expect(swapErrors).toHaveLength(3);
    for (const error of swapErrors) {
      expect(error).toBeInstanceOf(TypeError);
    }
    // The victim reads the host's real, well-typed snapshot.
    expect(victimSnapshot).toEqual({
      activeExtensionId: null,
      activeNavNodeId: null,
      selectedItemId: null,
      focusedPane: null,
    });
    expect(victimSnapshot).toBe(harness.store.getContext());
  });

  it('keeps the host foreground publication from being swallowed', () => {
    let harness!: Harness;

    function CaptureHost(): null {
      harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
      return null;
    }

    function HostileView(): null {
      const store = useShellStore();
      try {
        (store as unknown as Record<string, unknown>)['patchContext'] = (): void => undefined;
      } catch {
        // Frozen. That is the point of the test; the assertions are below.
      }
      return null;
    }

    render(
      <Providers>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <HostileView />
        </ExtensionHostBoundary>
      </Providers>,
    );

    act(() => {
      expect(harness.registry.register(makeBlueprint({ id: 'crm-ext' })).ok).toBe(true);
    });
    act(() => {
      expect(harness.activation.activate('crm-ext').ok).toBe(true);
    });

    // The published fact and the host's own handle agree. With `patchContext`
    // swapped out they did not: `getActive()` said crm-ext while the context
    // every subscriber reads said nothing was in the foreground.
    expect(harness.store.getContext().activeExtensionId).toBe('crm-ext');
    expect(harness.activation.getActive()?.id).toBe('crm-ext');
  });
});

/* -------------------------------------------------------------------------- */
/* The controller's methods are not total, and the docblocks say so            */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * PUBLISHING THE FOREGROUND IS A STORE WRITE, AND A STORE WRITE NOTIFIES
 * ============================================================================
 * `activate`, `blur` and `release` all publish the foreground through
 * `patchContext`, and the store notifies its subscribers synchronously.
 * `store.subscribe` is public, so a listener registered by plug-in code runs
 * inside that write and its throw comes straight back out. None of the three
 * invents a failure of its own; none of them is total either. Pre-existing, and
 * pinned here so the docblocks stay checkable.
 * ============================================================================
 */
describe('a throwing store listener propagates out of the controller', () => {
  const REFUSED = 'listener refused';

  it('out of activate', () => {
    const host = mountHost();
    act(() => {
      expect(host.result.current.registry.register(makeBlueprint({ id: 'mail-ext' })).ok).toBe(true);
    });
    host.result.current.store.subscribe(() => {
      throw new Error(REFUSED);
    });

    act(() => {
      expect(() => host.result.current.activation.activate('mail-ext')).toThrow(REFUSED);
    });
    // The write itself landed; it is the notification that failed.
    expect(host.result.current.store.getContext().activeExtensionId).toBe('mail-ext');
  });

  it('out of blur', () => {
    const host = mountHost();
    activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    const unsubscribe = host.result.current.store.subscribe(() => {
      throw new Error(REFUSED);
    });

    act(() => {
      expect(() => host.result.current.activation.blur()).toThrow(REFUSED);
    });

    // And the store is not left convinced it is mid-cascade.
    unsubscribe();
    act(() => {
      host.result.current.store.setSelectedItem('msg-1');
    });
    expect(host.result.current.store.getContext().selectedItemId).toBe('msg-1');
  });

  it('out of release', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    host.result.current.store.subscribe(() => {
      throw new Error(REFUSED);
    });

    act(() => {
      expect(() => host.result.current.activation.release('mail-ext')).toThrow(REFUSED);
    });
    // Revocation still happened: the throw is from the foreground publication,
    // which runs after the handle is already dead.
    expect(expectShellUXError(() => active.shell.getContext()).code).toBe('REVOKED');
  });

  /**
   * ========================================================================
   * THE FOURTH PATH HAD NO CALL SITE FOR A HOST TO GUARD
   * ========================================================================
   * `activate`, `blur` and `release` are all called BY the host, so the advice
   * "a host that treats listeners as untrusted should guard the call" is
   * actionable for them. The sweep effect is the fourth path and it is not: the
   * caller is React's passive-effect flush, and the host has no statement there
   * to wrap. A plug-in that subscribes one throwing listener and then causes any
   * registry change that moves the foreground took the whole root down.
   *
   * So this one is guarded inside the effect. The context has already been
   * committed by the time a listener runs, so the bookkeeping the effect exists
   * for is complete; what is left is to report the listener and stay up.
   * ========================================================================
   */
  it('is contained inside the sweep effect, which has no guardable call site', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    const notifications: string[] = [];
    const unsubscribe = host.result.current.store.subscribe(() => {
      notifications.push('notified');
      throw new Error(REFUSED);
    });

    // Unregistering moves the foreground, so the sweep effect re-publishes it.
    // React logs what the host reports here, so the console is captured rather
    // than left to imply a fault.
    const reported: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]): void => {
      reported.push(...args);
    };
    try {
      expect(() => {
        act(() => {
          expect(host.result.current.registry.unregister('mail-ext')).toBe(true);
        });
      }).not.toThrow();
    } finally {
      console.error = consoleError;
    }

    expect(notifications).toEqual(['notified']);
    // The listener was reported rather than swallowed.
    expect(
      reported.some((value) => value instanceof Error && value.message === REFUSED),
    ).toBe(true);

    // The bookkeeping completed: the handle is revoked and the foreground was
    // dropped, because the write commits before the notification runs.
    expect(expectShellUXError(() => active.shell.getContext()).code).toBe('REVOKED');
    expect(host.result.current.store.getContext().activeExtensionId).toBeNull();

    // And the shell is still mounted and usable, which is the whole point. The
    // listener goes first, because it would refuse this write too — and the store
    // must not have been left convinced it is mid-cascade either.
    unsubscribe();
    act(() => {
      host.result.current.store.setSelectedItem('msg-1');
    });
    expect(host.result.current.store.getContext().selectedItemId).toBe('msg-1');
  });

  /**
   * ========================================================================
   * THE REPORT ITSELF WAS A SECOND ESCAPE FROM THE SAME EFFECT
   * ========================================================================
   * The guard above catches the listener and reports it through `console.error`.
   * `console` is not the host's object: a plug-in can replace `console.error`
   * with a throwing function, and that throw leaves the `catch` block, escapes
   * the passive-effect flush, reaches no error boundary, and unmounts the whole
   * root — resurrecting precisely the failure the guard exists to prevent.
   * Reproduced as `CONSOLE-THROWS: ESCAPED` followed by React's own
   * `Should not already be working.`
   *
   * The precondition is global tampering, which ADR-0001's threat model concedes
   * rather than defends against. It is guarded anyway, because the guard is one
   * `try` and is cheaper than the argument for leaving it out.
   * ========================================================================
   */
  it('survives a console.error that throws, which is the report path escaping the guard', () => {
    const host = mountHost();
    const active = activate(host.result, makeBlueprint({ id: 'mail-ext' }));
    const unsubscribe = host.result.current.store.subscribe(() => {
      throw new Error(REFUSED);
    });

    // Only the host's OWN report is detonated. React's warnings still reach the
    // real console, so this test tampers with exactly one call and no more.
    const reported: unknown[] = [];
    let detonations = 0;
    const consoleError = console.error;
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === 'string' && args[0].startsWith('ShellHostProvider:')) {
        detonations += 1;
        throw new Error('CONSOLE-THROWS');
      }
      reported.push(...args);
    };
    try {
      expect(() => {
        act(() => {
          expect(host.result.current.registry.unregister('mail-ext')).toBe(true);
        });
      }).not.toThrow();
    } finally {
      console.error = consoleError;
    }

    // The host did try to report, and the throw did not leave the effect.
    expect(detonations).toBe(1);

    // The bookkeeping the effect exists for still completed.
    expect(expectShellUXError(() => active.shell.getContext()).code).toBe('REVOKED');
    expect(host.result.current.store.getContext().activeExtensionId).toBeNull();

    // And the root is still mounted and usable — the whole point.
    unsubscribe();
    act(() => {
      host.result.current.store.setSelectedItem('msg-1');
    });
    expect(host.result.current.store.getContext().selectedItemId).toBe('msg-1');
  });
});

/* -------------------------------------------------------------------------- */
/* The unscoped host facade has no liveness predicate of its own               */
/* -------------------------------------------------------------------------- */

describe('createShellAPI, the unscoped host facade', () => {
  it('stays live across registry churn, because it is minted from the store', () => {
    const host = mountHost();
    act(() => {
      expect(host.result.current.registry.register(makeBlueprint({ id: 'mail-ext' })).ok).toBe(true);
    });
    act(() => {
      host.result.current.registry.unregister('mail-ext');
    });

    // It is not scoped to an extension, so there is no extension whose
    // disappearance could revoke it. Its liveness is its store's.
    const api: IShellAPI = createShellAPI(host.result.current.store);
    act(() => {
      api.setSelectedItem('msg-1');
    });
    expect(host.result.current.store.getContext().selectedItemId).toBe('msg-1');
  });
});
