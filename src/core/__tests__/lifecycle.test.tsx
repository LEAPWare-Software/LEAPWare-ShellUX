import { useEffect, useLayoutEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController, ActiveExtension, LifecycleFault } from '../ActivationContext';
import { ShellUXError } from '../types';
import type { IShellAPI } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * LIFECYCLE HOOKS AND THE SCOPE PURGE — ADR-0006 decision 8, step 5
 * ============================================================================
 * GitHub issue #17 (the three hooks) and the purge half of #80. Every hook is
 * plug-in code the host calls, so each case here is about WHEN the host calls
 * it and WHAT a throw costs — and the answer to the second is always "that
 * extension's own registration, and nothing of anyone else's".
 *
 * **That is error containment, not isolation.** Every extension runs in one
 * realm and there is no boundary between them (ADR-0001 Amendment E, pinned by
 * `reflection.test.tsx`). Nothing here claims a hostile extension cannot reach a
 * sibling; it claims an extension whose hook throws does not take a sibling's
 * registration or handle down with it.
 * ============================================================================
 */

interface Harness {
  readonly registry: ExtensionRegistry;
  readonly activation: ActivationController;
  readonly store: ShellStateStore;
}

function mountHost(onLifecycleFault?: (fault: LifecycleFault) => void): { current: Harness } {
  function Providers({ children }: { children: ReactNode }): ReactElement {
    return (
      <ExtensionRegistryProvider runsPluginCode>
        <ShellHostProvider onLifecycleFault={onLifecycleFault}>{children}</ShellHostProvider>
      </ExtensionRegistryProvider>
    );
  }
  const { result } = renderHook(
    (): Harness => ({
      registry: useRegistry(),
      activation: useActivation(),
      store: useShellStore(),
    }),
    { wrapper: Providers },
  );
  return result;
}

function register(host: { current: Harness }, blueprint: unknown): void {
  act(() => {
    const outcome = host.current.registry.register(blueprint);
    if (!outcome.ok) {
      throw outcome.error;
    }
  });
}

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

function codeOf(call: () => void): string {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(ShellUXError);
    return (error as ShellUXError).code;
  }
  throw new Error('expected a ShellUXError, and nothing was thrown');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('onRelease', () => {
  it('calls onRelease before revocation, and revokes even when it throws', () => {
    const faults: LifecycleFault[] = [];
    const host = mountHost((fault) => {
      faults.push(fault);
    });
    const seen: string[] = [];
    let handle: IShellAPI | null = null;
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onRelease: (): void => {
            // BEFORE revocation: the handle still reaches the store in here.
            (handle as IShellAPI).setBadgeCount('root-a', 41);
            seen.push('onRelease');
            throw new Error('flush failed');
          },
        },
      }),
    );
    handle = activate(host, 'mail-ext').shell;

    let released = false;
    act(() => {
      released = host.current.activation.release('mail-ext');
    });

    expect(released).toBe(true);
    expect(seen).toEqual(['onRelease']);
    expect(host.current.store.getBadgeCount('mail-ext', 'root-a')).toBe(41);
    // ...and the throw kept nothing alive.
    expect(codeOf(() => (handle as IShellAPI).setBadgeCount('root-a', 1))).toBe('REVOKED');
    expect(faults).toEqual([
      { extensionId: 'mail-ext', hook: 'onRelease', error: new Error('flush failed') },
    ]);
    expect(host.current.activation.getActive()).toBeNull();
  });

  it('calls onRelease inside unregister, while the handle still works, and exactly once', () => {
    const host = mountHost();
    let handle: IShellAPI | null = null;
    const writes: string[] = [];
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onRelease: (): void => {
            (handle as IShellAPI).setSelectedItem('flushed');
            writes.push(String(host.current.store.getContext().selectedItemId));
            // Re-entering: the live entry is already gone, so this cannot run
            // the hook a second time.
            host.current.registry.unregister('mail-ext');
          },
        },
      }),
    );
    handle = activate(host, 'mail-ext').shell;

    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
    });

    expect(writes).toEqual(['flushed']);
    expect(codeOf(() => (handle as IShellAPI).getContext())).toBe('REVOKED');
    expect(host.current.registry.getExtension('mail-ext')).toBeUndefined();
  });

  it('is not called for an extension that was never activated, which holds no handle', () => {
    const host = mountHost();
    const onRelease = vi.fn();
    register(host, makeBlueprint({ id: 'mail-ext', lifecycle: { onRelease } }));
    act(() => {
      host.current.registry.unregister('mail-ext');
    });
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('reports a throw to console.error when the host passed no reporter', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = mountHost();
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onRelease: (): void => {
            throw new Error('boom');
          },
        },
      }),
    );
    const handle = activate(host, 'mail-ext').shell;
    act(() => {
      host.current.activation.release('mail-ext');
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('extension "mail-ext" threw from lifecycle.onRelease'),
      new Error('boom'),
    );
    expect(codeOf(() => handle.getContext())).toBe('REVOKED');
  });

  it('still revokes when the reporter itself throws, and when console.error throws', () => {
    const host = mountHost(() => {
      throw new Error('reporter broke');
    });
    const throwing = {
      onRelease: (): void => {
        throw new Error('boom');
      },
    };
    register(host, makeBlueprint({ id: 'mail-ext', lifecycle: throwing }));
    const first = activate(host, 'mail-ext').shell;
    act(() => {
      expect(host.current.activation.release('mail-ext')).toBe(true);
    });
    expect(codeOf(() => first.getContext())).toBe('REVOKED');

    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console broke');
    });
    const bare = mountHost();
    register(bare, makeBlueprint({ id: 'mail-ext', lifecycle: throwing }));
    const second = activate(bare, 'mail-ext').shell;
    act(() => {
      expect(bare.current.activation.release('mail-ext')).toBe(true);
    });
    expect(codeOf(() => second.getContext())).toBe('REVOKED');
  });
});

describe('onActivate and onDeactivate', () => {
  it('a throwing onActivate leaves a healthy sibling fully usable', () => {
    const faults: LifecycleFault[] = [];
    const host = mountHost((fault) => {
      faults.push(fault);
    });
    const calls: string[] = [];
    let brokenHandle: IShellAPI | null = null;
    register(
      host,
      makeBlueprint({
        id: 'healthy-ext',
        lifecycle: {
          onActivate: (shell: IShellAPI): void => {
            calls.push('healthy:onActivate');
            shell.setContextKey('ready', true);
          },
          onDeactivate: (): void => {
            calls.push('healthy:onDeactivate');
          },
        },
      }),
    );
    register(
      host,
      makeBlueprint({
        id: 'broken-ext',
        lifecycle: {
          onActivate: (shell: IShellAPI): void => {
            brokenHandle = shell;
            calls.push('broken:onActivate');
            throw new Error('could not open the connection');
          },
          onRelease: (): void => {
            calls.push('broken:onRelease');
          },
        },
      }),
    );

    const healthy = activate(host, 'healthy-ext');
    act(() => {
      healthy.shell.setBadgeCount('root-a', 4);
    });

    let failure: ShellUXError | null = null;
    act(() => {
      const outcome = host.current.activation.activate('broken-ext');
      expect(outcome.ok).toBe(false);
      failure = outcome.ok ? null : outcome.error;
    });

    // The failure, in words, attributed to the extension that threw.
    expect(failure).toBeInstanceOf(ShellUXError);
    expect((failure as unknown as ShellUXError).code).toBe('LIFECYCLE_HOOK_THREW');
    expect((failure as unknown as ShellUXError).field).toBe('lifecycle.onActivate');
    expect((failure as unknown as ShellUXError).message).toContain(
      'It threw: could not open the connection',
    );
    expect(faults.map((fault) => `${fault.extensionId}:${fault.hook}`)).toEqual([
      'broken-ext:onActivate',
    ]);
    // The broken extension's handle was released — onRelease, then revoked —
    // and it holds no foreground. Its registration is untouched.
    expect(calls).toEqual([
      'healthy:onActivate',
      'healthy:onDeactivate',
      'broken:onActivate',
      'broken:onRelease',
    ]);
    expect(codeOf(() => (brokenHandle as IShellAPI).getContext())).toBe('REVOKED');
    expect(host.current.activation.getActive()).toBeNull();
    expect(host.current.registry.getExtension('broken-ext')).toBeDefined();

    // THE HEALTHY SIBLING: its handle still writes, its badge survived, and it
    // takes the foreground again with its own hook firing.
    act(() => {
      healthy.shell.setBadgeCount('root-a', 5);
    });
    expect(host.current.store.getBadgeCount('healthy-ext', 'root-a')).toBe(5);
    const again = activate(host, 'healthy-ext');
    expect(again.shell).toBe(healthy.shell);
    expect(calls.at(-1)).toBe('healthy:onActivate');
    expect(host.current.store.getContext().contextKeys).toEqual({ ready: true });
  });

  it('fires onActivate only when the foreground moves, and onDeactivate on a switch and on blur', () => {
    const calls: string[] = [];
    const host = mountHost();
    for (const id of ['mail-ext', 'db-ext']) {
      register(
        host,
        makeBlueprint({
          id,
          lifecycle: {
            onActivate: (): void => {
              calls.push(`${id}:onActivate`);
            },
            onDeactivate: (): void => {
              calls.push(`${id}:onDeactivate`);
            },
            onRelease: (): void => {
              calls.push(`${id}:onRelease`);
            },
          },
        }),
      );
    }

    activate(host, 'mail-ext');
    // Re-activating the foreground is not taking it.
    activate(host, 'mail-ext');
    activate(host, 'db-ext');
    act(() => {
      host.current.activation.blur();
    });
    // Blur with nothing in the foreground tells nobody.
    act(() => {
      host.current.activation.blur();
    });
    activate(host, 'mail-ext');
    // Release is not deactivation: onRelease alone.
    act(() => {
      host.current.activation.release('mail-ext');
    });

    expect(calls).toEqual([
      'mail-ext:onActivate',
      'mail-ext:onDeactivate',
      'db-ext:onActivate',
      'db-ext:onDeactivate',
      'mail-ext:onActivate',
      'mail-ext:onRelease',
    ]);
  });

  it('keeps a throwing onDeactivate to its own extension: the handover completes', () => {
    const faults: LifecycleFault[] = [];
    const host = mountHost((fault) => {
      faults.push(fault);
    });
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onDeactivate: (): void => {
            throw 'not an Error';
          },
        },
      }),
    );
    register(host, makeBlueprint({ id: 'db-ext' }));
    const mail = activate(host, 'mail-ext');
    const db = activate(host, 'db-ext');

    expect(host.current.activation.getActive()).toBe(db);
    expect(faults).toEqual([{ extensionId: 'mail-ext', hook: 'onDeactivate', error: 'not an Error' }]);
    // Foreground loss is not revocation, and a throw on the way out is not either.
    expect(() => mail.shell.setBadgeCount('root-a', 1)).not.toThrow();
  });

  it('calls each hook with no this, and calls the copy the registry took', () => {
    const host = mountHost();
    const receivers: unknown[] = [];
    const lifecycle: Record<string, unknown> = {
      onActivate(this: unknown): void {
        receivers.push(this);
      },
    };
    register(host, makeBlueprint({ id: 'mail-ext', lifecycle }));
    // Replacing the hook on the plug-in's own object afterwards changes nothing.
    lifecycle['onActivate'] = (): void => {
      receivers.push('replaced');
    };
    activate(host, 'mail-ext');
    expect(receivers).toEqual([undefined]);
  });

  it('describes a thrown value that is not an Error, and one that cannot be read', () => {
    const host = mountHost(() => undefined);
    const unreadable = {
      toString(): string {
        throw new Error('no');
      },
    };
    register(
      host,
      makeBlueprint({
        id: 'string-ext',
        lifecycle: {
          onActivate: (): void => {
            throw 'a plain string';
          },
        },
      }),
    );
    register(
      host,
      makeBlueprint({
        id: 'opaque-ext',
        lifecycle: {
          onActivate: (): void => {
            throw unreadable;
          },
        },
      }),
    );
    const messages: string[] = [];
    act(() => {
      for (const id of ['string-ext', 'opaque-ext']) {
        const outcome = host.current.activation.activate(id);
        messages.push(outcome.ok ? 'ok' : outcome.error.message);
      }
    });
    expect(messages[0]).toContain('It threw: a plain string');
    expect(messages[1]).toContain('It threw: a value of type "object" that could not be read');
  });

  it('releases only once when onActivate unregisters itself and then throws', () => {
    const calls: string[] = [];
    const host = mountHost(() => undefined);
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onActivate: (): void => {
            host.current.registry.unregister('mail-ext');
            throw new Error('gone');
          },
          onRelease: (): void => {
            calls.push('onRelease');
          },
        },
      }),
    );
    let ok: boolean | null = null;
    act(() => {
      ok = host.current.activation.activate('mail-ext').ok;
    });
    expect(ok).toBe(false);
    expect(calls).toEqual(['onRelease']);
    expect(host.current.activation.getActive()).toBeNull();
  });

  it('does not deactivate a previous foreground whose id was unregistered and registered again', () => {
    const calls: string[] = [];
    const host = mountHost();
    const lifecycle = {
      onDeactivate: (): void => {
        calls.push('onDeactivate');
      },
    };
    register(host, makeBlueprint({ id: 'mail-ext', lifecycle }));
    register(host, makeBlueprint({ id: 'db-ext' }));
    activate(host, 'mail-ext');
    act(() => {
      // One handler, no commit between: the foreground still names the old
      // record, and its live entry is gone (unregister) or replaced (activate).
      host.current.registry.unregister('mail-ext');
      host.current.registry.register(makeBlueprint({ id: 'mail-ext', lifecycle }));
      expect(host.current.activation.activate('mail-ext').ok).toBe(true);
    });
    act(() => {
      host.current.registry.unregister('mail-ext');
      expect(host.current.activation.activate('db-ext').ok).toBe(true);
    });
    expect(calls).toEqual([]);
  });
});

describe('re-entry and async hooks', () => {
  it('refuses an activate made from inside onDeactivate, and the outer handover completes', () => {
    const host = mountHost();
    const inner: string[] = [];
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onDeactivate: (): void => {
            // Host code reaching the controller from inside a hook.
            const outcome = host.current.activation.activate('mail-ext');
            inner.push(outcome.ok ? 'ok' : outcome.error.code);
            inner.push(codeOf(() => host.current.activation.blur()));
            inner.push(codeOf(() => host.current.activation.release('db-ext')));
          },
        },
      }),
    );
    register(host, makeBlueprint({ id: 'db-ext' }));
    activate(host, 'mail-ext');
    const db = activate(host, 'db-ext');

    expect(inner).toEqual(['LIFECYCLE_REENTRY', 'LIFECYCLE_REENTRY', 'LIFECYCLE_REENTRY']);
    // The outer activation is what happened, and nothing the refused calls asked for.
    expect(host.current.activation.getActive()).toBe(db);
    expect(() => db.shell.getContext()).not.toThrow();
    // The guard is released once the hook returns.
    expect(activate(host, 'mail-ext').id).toBe('mail-ext');
  });

  it("refuses an activate made from inside a hook's returned then", () => {
    const host = mountHost();
    const inner: string[] = [];
    register(
      host,
      makeBlueprint({
        id: 'a-ext',
        lifecycle: {
          onDeactivate: (): unknown => ({
            then(): void {
              const outcome = host.current.activation.activate('c-ext');
              inner.push(outcome.ok ? 'ok' : outcome.error.code);
            },
          }),
        },
      }),
    );
    register(host, makeBlueprint({ id: 'b-ext' }));
    register(host, makeBlueprint({ id: 'c-ext' }));
    activate(host, 'a-ext');
    const b = activate(host, 'b-ext');

    expect(inner).toEqual(['LIFECYCLE_REENTRY']);
    expect(host.current.activation.getActive()).toBe(b);
    expect(host.current.store.getContext().activeExtensionId).toBe('b-ext');
  });

  it('does not report ok for an extension whose onActivate unregistered it', () => {
    const host = mountHost();
    const onRelease = vi.fn();
    let given: IShellAPI | null = null;
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onActivate: (shell: IShellAPI): void => {
            given = shell;
            host.current.registry.unregister('mail-ext');
          },
          onRelease,
        },
      }),
    );
    let outcome: ReturnType<ActivationController['activate']> | null = null;
    act(() => {
      outcome = host.current.activation.activate('mail-ext');
    });
    const result = outcome as unknown as ReturnType<ActivationController['activate']>;
    expect(result.ok).toBe(false);
    expect(result.ok ? null : [result.error.code, result.error.field]).toEqual(['REVOKED', 'id']);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(codeOf(() => (given as IShellAPI).getContext())).toBe('REVOKED');
    expect(host.current.activation.getActive()).toBeNull();
    expect(host.current.store.getContext().activeExtensionId).toBeNull();
  });

  it('does not publish an extension that the outgoing onDeactivate unregistered', () => {
    const host = mountHost();
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onDeactivate: (): void => {
            host.current.registry.unregister('db-ext');
          },
        },
      }),
    );
    register(host, makeBlueprint({ id: 'db-ext' }));
    // db-ext is live before the handover, so the incoming entry is the one killed.
    activate(host, 'db-ext');
    activate(host, 'mail-ext');
    let code: string | null = null;
    act(() => {
      const outcome = host.current.activation.activate('db-ext');
      code = outcome.ok ? 'ok' : outcome.error.code;
    });
    expect(code).toBe('REVOKED');
    expect(host.current.activation.getActive()).toBeNull();
    expect(host.current.store.getContext().activeExtensionId).toBeNull();
  });

  it("reports an async hook's rejection through the fault path, without awaiting it", async () => {
    const faults: LifecycleFault[] = [];
    const host = mountHost((fault) => {
      faults.push(fault);
    });
    const unreadableThen = Object.defineProperty({}, 'then', {
      get(): never {
        throw new Error('then getter');
      },
    });
    register(
      host,
      makeBlueprint({
        id: 'mail-ext',
        lifecycle: {
          onActivate: async (): Promise<void> => {
            await Promise.resolve();
            throw new Error('late activate');
          },
          onDeactivate: (): unknown => unreadableThen,
          onRelease: (): unknown => ({ then: 'not callable' }),
        },
      }),
    );
    register(
      host,
      makeBlueprint({
        id: 'db-ext',
        lifecycle: {
          onActivate: async (): Promise<void> => undefined,
          onRelease: (): unknown => ({
            then(): never {
              throw new Error('then call');
            },
          }),
        },
      }),
    );
    const mail = activate(host, 'mail-ext');
    // Not awaited: the activation succeeded and stays succeeded.
    expect(host.current.activation.getActive()).toBe(mail);
    activate(host, 'db-ext');
    act(() => {
      host.current.activation.release('mail-ext');
      host.current.activation.release('db-ext');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(faults.map((fault) => [fault.extensionId, fault.hook, (fault.error as Error).message])).toEqual([
      ['mail-ext', 'onDeactivate', 'then getter'],
      ['db-ext', 'onRelease', 'then call'],
      ['mail-ext', 'onActivate', 'late activate'],
    ]);
  });
});

describe('the scope purge on unregister', () => {
  it("unregister purges the scope's badges and context keys", () => {
    const host = mountHost();
    register(host, makeBlueprint({ id: 'mail-ext' }));
    register(host, makeBlueprint({ id: 'db-ext' }));
    const mail = activate(host, 'mail-ext');
    act(() => {
      mail.shell.setBadgeCount('root-a', 9);
      mail.shell.setNavMetric('root-a', 0.5);
      mail.shell.setContextKey('loaded', true);
      mail.shell.setNavigationTree([{ id: 'root-a', label: 'Only' }]);
      // A sibling's scope, and a scope written through the public store for an
      // extension that was never activated.
      host.current.store.setBadgeCount('db-ext', 'root-a', 2);
    });
    expect(host.current.store.getContext().contextKeys).toEqual({ loaded: true });

    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
      // Synchronously, before any commit: the sweep effect has not run, so what
      // emptied these is the purge inside unregister.
      expect(host.current.store.getBadgeCount('mail-ext', 'root-a')).toBeUndefined();
      expect(host.current.store.getNavMetric('mail-ext', 'root-a')).toBeUndefined();
      expect(host.current.store.getNavigationTree('mail-ext')).toBeUndefined();
      expect(host.current.store.getContext().contextKeys).toEqual({});
    });

    // The sibling's scope is its own and survives.
    expect(host.current.store.getBadgeCount('db-ext', 'root-a')).toBe(2);
    act(() => {
      host.current.registry.unregister('db-ext');
    });
    expect(host.current.store.getBadgeCount('db-ext', 'root-a')).toBeUndefined();

    // Registered again under the same id, it starts from nothing.
    register(host, makeBlueprint({ id: 'mail-ext' }));
    const again = activate(host, 'mail-ext');
    expect(again.shell.getBadgeCount('root-a')).toBeUndefined();
    expect(again.shell.getContext().contextKeys).toEqual({});
  });

  it('does not release a live entry minted against an earlier record, and purges anyway', () => {
    // The documented gap: a descendant that registers, activates and
    // unregisters from a LAYOUT effect runs before the provider subscribes, so
    // it gets only the sweep's revocation. Its passive effect then unregisters
    // the re-registered id while the stale entry is still in the live map.
    const onRelease = vi.fn();
    let store: ShellStateStore | null = null;
    let staleHandle: IShellAPI | null = null;

    function Early(): null {
      const registry = useRegistry();
      const activation = useActivation();
      store = useShellStore();
      useLayoutEffect(() => {
        registry.register(makeBlueprint({ id: 'mail-ext', lifecycle: { onRelease } }));
        const outcome = activation.activate('mail-ext');
        staleHandle = outcome.ok ? outcome.active.shell : null;
        registry.unregister('mail-ext');
        registry.register(makeBlueprint({ id: 'mail-ext', lifecycle: { onRelease } }));
      }, [activation, registry]);
      useEffect(() => {
        (store as ShellStateStore).setBadgeCount('mail-ext', 'root-a', 3);
        registry.unregister('mail-ext');
      }, [registry]);
      return null;
    }

    render(
      <ExtensionRegistryProvider runsPluginCode>
        <ShellHostProvider>
          <Early />
        </ShellHostProvider>
      </ExtensionRegistryProvider>,
    );

    expect(onRelease).not.toHaveBeenCalled();
    expect(codeOf(() => (staleHandle as IShellAPI).getContext())).toBe('REVOKED');
    expect((store as unknown as ShellStateStore).getBadgeCount('mail-ext', 'root-a')).toBeUndefined();
  });
});

describe('before the provider subscribes', () => {
  it('still replaces a stale entry when activate runs before the provider subscribed', () => {
    const onRelease = vi.fn();
    const handles: IShellAPI[] = [];

    function Early(): null {
      const registry = useRegistry();
      const activation = useActivation();
      useLayoutEffect(() => {
        for (const name of ['Vendor A', 'Vendor B']) {
          registry.unregister('mail-ext');
          registry.register(makeBlueprint({ id: 'mail-ext', name, lifecycle: { onRelease } }));
          const outcome = activation.activate('mail-ext');
          if (outcome.ok) {
            handles.push(outcome.active.shell);
          }
        }
      }, [activation, registry]);
      return null;
    }

    render(
      <ExtensionRegistryProvider runsPluginCode>
        <ShellHostProvider>
          <Early />
        </ShellHostProvider>
      </ExtensionRegistryProvider>,
    );

    // Two distinct handles; the first, minted against Vendor A's record, is dead
    // — without `onRelease`, which is the documented cost of the gap.
    expect(handles).toHaveLength(2);
    expect(handles[0]).not.toBe(handles[1]);
    expect(codeOf(() => handles[0]!.getContext())).toBe('REVOKED');
    expect(() => handles[1]!.getContext()).not.toThrow();
    expect(onRelease).not.toHaveBeenCalled();
  });
});

describe('purging late', () => {
  it('purges late, in the sweep, for an unregister made before the provider subscribed', () => {
    let store: ShellStateStore | null = null;
    function Early(): null {
      const registry = useRegistry();
      const activation = useActivation();
      store = useShellStore();
      useLayoutEffect(() => {
        registry.register(makeBlueprint({ id: 'mail-ext' }));
        const outcome = activation.activate('mail-ext');
        if (outcome.ok) {
          outcome.active.shell.setBadgeCount('root-a', 6);
        }
        registry.unregister('mail-ext');
      }, [activation, registry]);
      return null;
    }
    render(
      <ExtensionRegistryProvider runsPluginCode>
        <ShellHostProvider>
          <Early />
        </ShellHostProvider>
      </ExtensionRegistryProvider>,
    );
    expect((store as unknown as ShellStateStore).getBadgeCount('mail-ext', 'root-a')).toBeUndefined();
  });
});

describe('the pre-subscription remainder', () => {
  it('leaves the scope to a same-id re-registration made before the provider subscribed, which inherits it', () => {
    let store: ShellStateStore | null = null;
    let stale: IShellAPI | null = null;
    function Early(): null {
      const registry = useRegistry();
      const activation = useActivation();
      store = useShellStore();
      useLayoutEffect(() => {
        registry.register(makeBlueprint({ id: 'mail-ext', name: 'Vendor A' }));
        const outcome = activation.activate('mail-ext');
        if (outcome.ok) {
          stale = outcome.active.shell;
          stale.setBadgeCount('root-a', 6);
        }
        registry.unregister('mail-ext');
        registry.register(makeBlueprint({ id: 'mail-ext', name: 'Vendor B' }));
      }, [activation, registry]);
      return null;
    }
    render(
      <ExtensionRegistryProvider runsPluginCode>
        <ShellHostProvider>
          <Early />
        </ShellHostProvider>
      </ExtensionRegistryProvider>,
    );
    // The stale handle is dead, but its badge is now vendor B's: the documented
    // remainder of the gap (ADR-0006 step-5 review note), pinned so that closing
    // it is a change somebody makes on purpose.
    expect(codeOf(() => (stale as unknown as IShellAPI).getContext())).toBe('REVOKED');
    expect((store as unknown as ShellStateStore).getBadgeCount('mail-ext', 'root-a')).toBe(6);
  });
});

describe('ExtensionRegistry.onBeforeUnregister', () => {
  it('unregister completes when a before-unregister listener throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = mountHost();
    register(host, makeBlueprint({ id: 'mail-ext' }));
    const dispose = host.current.registry.onBeforeUnregister(() => {
      throw new Error('listener broke');
    });
    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
    });
    expect(host.current.registry.getExtension('mail-ext')).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('a before-unregister listener threw while "mail-ext" was being unregistered'),
      new Error('listener broke'),
    );

    // ...and when reporting it throws too.
    consoleError.mockImplementation(() => {
      throw new Error('console broke');
    });
    register(host, makeBlueprint({ id: 'mail-ext' }));
    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
    });
    expect(host.current.registry.getExtension('mail-ext')).toBeUndefined();
    dispose();
  });

  it('passes the id and the record being removed, runs nothing for an unknown id, and disposes', () => {
    const host = mountHost();
    register(host, makeBlueprint({ id: 'mail-ext' }));
    const record = host.current.registry.getExtension('mail-ext');
    const seen: unknown[] = [];
    const listener = (id: string, removed: unknown): void => {
      seen.push([id, removed]);
    };
    const first = host.current.registry.onBeforeUnregister(listener);
    // The same function twice is two subscriptions, each with its own disposer.
    const second = host.current.registry.onBeforeUnregister(listener);
    second();

    act(() => {
      expect(host.current.registry.unregister('nobody')).toBe(false);
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
    });
    expect(seen).toEqual([['mail-ext', record]]);

    first();
    register(host, makeBlueprint({ id: 'mail-ext' }));
    act(() => {
      host.current.registry.unregister('mail-ext');
    });
    expect(seen).toHaveLength(1);
  });

  it('removes only the record it was asked to, when a listener re-registers the id', () => {
    const host = mountHost();
    register(host, makeBlueprint({ id: 'mail-ext' }));
    const replacement = makeBlueprint({ id: 'mail-ext', name: 'Replacement' });
    const dispose = host.current.registry.onBeforeUnregister((id) => {
      host.current.registry.unregister(id);
      host.current.registry.register(replacement);
    });
    act(() => {
      expect(host.current.registry.unregister('mail-ext')).toBe(true);
    });
    dispose();
    expect(host.current.registry.getExtension('mail-ext')?.name).toBe('Replacement');
  });

  it('refuses a listener that is not a function', () => {
    const host = mountHost();
    let caught: unknown;
    try {
      host.current.registry.onBeforeUnregister('nope' as unknown as () => void);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShellUXError);
    expect((caught as ShellUXError).code).toBe('INVALID_FIELD');
    expect((caught as ShellUXError).field).toBe('listener');
  });
});

describe('the lifecycle member at registration', () => {
  it('is validated at the door, read once, and absent from the record when not declared', () => {
    const host = mountHost();
    const refused = (lifecycle: unknown): [string, string | null] => {
      const outcome = host.current.registry.register(makeBlueprint({ id: 'bad-ext', lifecycle }));
      return outcome.ok ? ['ok', null] : [outcome.error.code, outcome.error.field];
    };
    expect(refused('not an object')).toEqual(['INVALID_FIELD', 'lifecycle']);
    expect(refused([])).toEqual(['INVALID_FIELD', 'lifecycle']);
    expect(refused({ onRelease: 'nope' })).toEqual(['INVALID_FIELD', 'lifecycle.onRelease']);
    expect(refused({ onActivate: 1 })).toEqual(['INVALID_FIELD', 'lifecycle.onActivate']);

    const onRelease = (): void => undefined;
    register(host, makeBlueprint({ id: 'mail-ext', lifecycle: { onRelease, unknownHook: 1 } }));
    register(host, makeBlueprint({ id: 'db-ext' }));
    const record = host.current.registry.getExtension('mail-ext');
    expect(record?.lifecycle).toEqual({ onRelease });
    expect(Object.isFrozen(record?.lifecycle)).toBe(true);
    expect(host.current.registry.getExtension('db-ext')).not.toHaveProperty('lifecycle');
  });
});

/**
 * #183 — ADR-0006 decision 6's amendment. `mountHost` above sets
 * `runsPluginCode` on its `ExtensionRegistryProvider`, which is why every
 * lifecycle-bearing registration in this file has kept working; this case
 * pins the other half of that guardrail — that the accepted path really does
 * go on to call the hook, not merely that `register` returns `ok: true`.
 */
describe('runsPluginCode — the registry that declares it, actually runs the hooks it accepted', () => {
  it('accepts the same blueprint, and calls onActivate, when the provider declares it runs plugin code', () => {
    const host = mountHost();
    const onActivate = vi.fn();
    register(host, makeBlueprint({ id: 'mail-ext', lifecycle: { onActivate } }));

    activate(host, 'mail-ext');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
