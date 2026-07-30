import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { createShellAPI, createShellStateStore, useShellContext, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ExtensionHostBoundary, ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController } from '../ActivationContext';
import { ShellUXError } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * `subscribe` IS THE LIMIT OF THE STORE CLAIM, AND THIS FILE PINS IT
 * ============================================================================
 * Six sites in this repository used to append a clause to the frozen-store
 * argument that the argument does not license:
 *
 *   > *Its methods are its own.* The returned object is **frozen**, so no holder
 *   > can replace, delete or add a member. Every one of the six validates its
 *   > arguments. Therefore no caller can put a value of the wrong shape into this
 *   > store's context, **and no caller can intercept, suppress or forge the writes
 *   > and reads another holder makes through it.**
 *
 * The first conclusion is true and is pinned in `reflection.test.tsx` and
 * `capability.test.tsx`. The second is false, and the freeze has nothing to do
 * with it. `subscribe` is one of the six frozen members, it is reachable from the
 * public `useShellStore()`, and it runs plug-in code **synchronously inside
 * another holder's write**. Nothing is replaced, so freezing the object changes
 * none of what follows.
 *
 * This file is written in the honest-pinning register already used for the
 * reflection hole (`reflection.test.tsx`) and for plug-in view mutability
 * (`capability.test.tsx`, D6): it asserts the reachable behaviour as the
 * DOCUMENTED, EXPECTED reality rather than wishing it away. Four behaviours, all
 * reproduced:
 *
 *   1. INTERCEPTION — a listener observes every write another holder makes,
 *      before the writer returns.
 *   2. SUPPRESSION OF THE WRITE — a listener re-enters `patchContext` from inside
 *      the notification and the host's value is the one that loses.
 *   3. SUPPRESSION OF THE NOTIFICATION — a throwing listener starves every
 *      listener ordered after it, including a victim pane's
 *      `useSyncExternalStore` subscription.
 *   4. A NON-`ShellUXError` IN THE WRITER'S FRAME — out of `patchContext` and out
 *      of `setBadgeCount`, neither of which is contracted to deliver one.
 *
 * The real limit, stated in the vocabulary of `README.md`: **a listener is a
 * synchronous call into untrusted code inside another holder's write. It can
 * observe, it can re-enter, and it can throw into the writer's frame.** That is
 * not a defect in the freeze and it is not a bug to fix here — a store with no
 * notification is a store no pane can render off. It is the boundary the frozen
 * store's guarantee actually stops at, and if a future change makes any of these
 * assertions fail, that is a genuinely new property that needs its own analysis
 * before this file is edited to match. **It is NOT a file to relax.**
 * ============================================================================
 */

const REFUSED = 'listener refused';

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

/* -------------------------------------------------------------------------- */
/* 1. Interception                                                             */
/* -------------------------------------------------------------------------- */

describe('a listener intercepts another holder’s write', () => {
  it('sees the new value synchronously, before the writer returns', () => {
    const store = createShellStateStore();
    // The victim writes through its own deep-frozen facade — the object whose
    // methods provably cannot be swapped. That is exactly the point: the freeze
    // is not what is being bypassed.
    const victimApi = createShellAPI(store);

    const observed: (string | null)[] = [];
    const order: string[] = [];
    store.subscribe(() => {
      observed.push(store.getContext().selectedItemId);
      order.push('listener');
    });

    victimApi.setSelectedItem('msg-1');
    order.push('writer-returned');

    // Every write, and the value, and BEFORE the writer's own statement finished.
    expect(observed).toEqual(['msg-1']);
    expect(order).toEqual(['listener', 'writer-returned']);

    victimApi.setSelectedItem('msg-2');
    expect(observed).toEqual(['msg-1', 'msg-2']);
  });

  it('sees a badge write through the same channel', () => {
    const store = createShellStateStore();
    const victimApi = createShellAPI(store);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    victimApi.setBadgeCount('root-a', 4);

    // Badges are not in the context snapshot, but the notify is still real, so a
    // listener learns that a badge moved and can read it back out of the store.
    expect(notifications).toBe(1);
    expect(store.getBadgeCount('__host__', 'root-a')).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Suppression of the write                                                 */
/* -------------------------------------------------------------------------- */

describe('a listener suppresses another holder’s write by re-entering the store', () => {
  it('leaves the attacker’s value in place and not the host’s', () => {
    const store = createShellStateStore();
    let overwritten = false;
    store.subscribe(() => {
      if (overwritten) {
        // One shallow cascade only, so this is nowhere near `MAX_NOTIFY_DEPTH`
        // and no `REENTRANT_NOTIFY` is raised. Suppression does not need a
        // runaway; it needs one re-entrant write.
        return;
      }
      overwritten = true;
      store.patchContext({ selectedItemId: 'attacker-wins' });
    });

    store.patchContext({ selectedItemId: 'host-value' });

    // The host's write committed and was then overwritten from inside its own
    // notification, before `patchContext` returned to the host.
    expect(store.getContext().selectedItemId).toBe('attacker-wins');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Suppression of the notification                                          */
/* -------------------------------------------------------------------------- */

describe('a throwing listener suppresses the notification for every listener after it', () => {
  it('starves a listener registered later in the same store', () => {
    const store = createShellStateStore();
    const victimCalls: (string | null)[] = [];

    // Subscribed FIRST, so it is first in the notification pass.
    store.subscribe(() => {
      throw new Error(REFUSED);
    });
    store.subscribe(() => {
      victimCalls.push(store.getContext().selectedItemId);
    });

    expect(() => {
      store.patchContext({ selectedItemId: 'host-value' });
    }).toThrow(REFUSED);

    // The context moved and the victim was never told.
    expect(victimCalls).toEqual([]);
    expect(store.getContext().selectedItemId).toBe('host-value');
  });

  it('desynchronises a victim pane that subscribed through useShellContext', () => {
    const victimLog: (string | null)[] = [];
    let store!: ShellStateStore;

    function CaptureStore(): null {
      store = useShellStore();
      return null;
    }

    /**
     * A hostile extension's view. It subscribes from a mount effect, and it is
     * rendered BEFORE the victim pane — React flushes passive effects in
     * completion order, so this listener is in the store's `Set` first and is
     * therefore first in every notification pass.
     */
    function HostileView(): null {
      const hostileStore = useShellStore();
      useEffect(
        () =>
          hostileStore.subscribe(() => {
            throw new Error(REFUSED);
          }),
        [hostileStore],
      );
      return null;
    }

    function VictimPane(): JSX.Element {
      const context = useShellContext();
      victimLog.push(context.selectedItemId);
      return <span />;
    }

    render(
      <Providers>
        <CaptureStore />
        <ExtensionHostBoundary extensionId="mail-ext">
          <HostileView />
        </ExtensionHostBoundary>
        <ExtensionHostBoundary extensionId="crm-ext">
          <VictimPane />
        </ExtensionHostBoundary>
      </Providers>,
    );

    victimLog.length = 0;

    expect(() => {
      act(() => {
        store.patchContext({ selectedItemId: 'host-value' });
      });
    }).toThrow(REFUSED);

    // The store holds the new value and the pane rendering it never heard: no
    // re-render was scheduled, because the hostile listener aborted the pass
    // before `useSyncExternalStore`'s own handler was reached.
    expect(store.getContext().selectedItemId).toBe('host-value');
    expect(victimLog).toEqual([]);

    // And it stays that way for every subsequent write, so the pane is
    // desynchronised for as long as nothing else re-renders it.
    expect(() => {
      act(() => {
        store.patchContext({ selectedItemId: 'later-value' });
      });
    }).toThrow(REFUSED);
    expect(store.getContext().selectedItemId).toBe('later-value');
    expect(victimLog).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. A non-ShellUXError in the writer's frame                                 */
/* -------------------------------------------------------------------------- */

describe('a listener throws whatever it likes into the writer’s frame', () => {
  it('delivers a raw TypeError out of patchContext', () => {
    const store = createShellStateStore();
    store.subscribe(() => {
      throw new TypeError(REFUSED);
    });

    let caught: unknown;
    try {
      store.patchContext({ selectedItemId: 'msg-1' });
    } catch (error) {
      caught = error;
    }

    // `patchContext` is contracted `@throws {ShellUXError}`. This is not one, and
    // no validation of the patch could have made it one.
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(ShellUXError);
    // The write itself stands; it is the notification that failed.
    expect(store.getContext().selectedItemId).toBe('msg-1');
  });

  it('delivers a raw TypeError out of setBadgeCount', () => {
    const store = createShellStateStore();
    store.subscribe(() => {
      throw new TypeError(REFUSED);
    });

    let caught: unknown;
    try {
      store.setBadgeCount('mail-ext', 'root-a', 3);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(ShellUXError);
    expect(store.getBadgeCount('mail-ext', 'root-a')).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* The host/store divergence, reached through subscribe instead of a swap       */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * THE SAME OBSERVABLE AS AMENDMENT F ROW (d), BY A DIFFERENT ROUTE
 * ============================================================================
 * Amendment F row (d) is "replace `patchContext` → `activeExtensionId` published
 * as `null` while `getActive()` said `crm-ext`". The freeze closed the
 * replacement route. It did not close this one: a listener re-publishes a lie
 * from inside the host's own foreground write, and the host's authoritative ref
 * and the published context disagree exactly as before.
 * ============================================================================
 */
describe('a listener re-publishes the foreground and the host disagrees with the store', () => {
  it('leaves the store claiming a foreground the host says is nobody', () => {
    const host = mountHost();
    act(() => {
      expect(host.current.registry.register(makeBlueprint({ id: 'mail-ext' })).ok).toBe(true);
    });
    act(() => {
      expect(host.current.activation.activate('mail-ext').ok).toBe(true);
    });
    expect(host.current.store.getContext().activeExtensionId).toBe('mail-ext');

    let lied = false;
    const unsubscribe = host.current.store.subscribe(() => {
      if (lied) {
        return;
      }
      lied = true;
      // A registry-valid id, so nothing the store validates is violated. The
      // store's own guarantee — every value entering the context is well-typed —
      // holds, and is beside the point.
      host.current.store.patchContext({ activeExtensionId: 'a-lie' });
    });

    act(() => {
      host.current.activation.blur();
    });

    // C1b, reproduced: the published fact and the host's own handle disagree.
    expect(host.current.store.getContext().activeExtensionId).toBe('a-lie');
    expect(host.current.activation.getActive()).toBeNull();

    unsubscribe();
  });
});
