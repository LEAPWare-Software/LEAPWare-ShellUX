import { useMemo, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { createShellAPI, useShellContext, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController, ActiveExtension } from '../ActivationContext';
import { ShellUXError } from '../types';
import type { IShellAPI, RibbonContext } from '../types';
import { makeBlueprint, Pane2View, Pane3View } from './fixtures';

/**
 * ============================================================================
 * DATA FLOW — the four properties the plug-in contract has to actually have
 * ============================================================================
 * These are contract tests, not unit tests. Each one describes something an
 * extension author is entitled to assume and states it as an observation the
 * host has to satisfy:
 *
 *   1. A write through one pane's `IShellAPI` is observed by another pane.
 *   2. A `RibbonAction.onExecute` can change shell state.
 *   3. Two extensions that pick the same navigation node id do not collide.
 *   4. A released `IShellAPI` fails loudly and changes nothing.
 *
 * They are deliberately written against the public surface only — the provider,
 * the registry, `useShellContext`, and the activation controller. Nothing here
 * reaches into module internals, so a reimplementation that keeps the contract
 * keeps these tests.
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

/** Register `blueprint`, activate it, and return the live `ActiveExtension`. */
function activate(host: { current: Harness }, blueprint: unknown): ActiveExtension {
  act(() => {
    const registration = host.current.registry.register(blueprint);
    expect(registration.ok).toBe(true);
  });
  let active!: ActiveExtension;
  act(() => {
    const id = (blueprint as { id: string }).id;
    const outcome = host.current.activation.activate(id);
    if (!outcome.ok) {
      throw outcome.error;
    }
    active = outcome.active;
  });
  return active;
}

/**
 * Hand the surrounding provider's own store to `into`.
 *
 * Needed because `mountHost` mounts its own provider tree, and a provider owns
 * ONE store for ITS subtree. A test whose observers are in a second `render`
 * tree must write through that tree's store, not through the harness's, or it
 * asserts nothing at all.
 */
function CaptureStore({ into }: { into: (store: ShellStateStore) => void }): null {
  into(useShellStore());
  return null;
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

/* -------------------------------------------------------------------------- */
/* 1. Cross-pane reactivity                                                    */
/* -------------------------------------------------------------------------- */

describe('cross-pane reactivity', () => {
  it('re-renders a sibling pane when another pane sets the selected item', () => {
    function WritingPane(): ReactElement {
      const store = useShellStore();
      const shell = useMemo(() => createShellAPI(store), [store]);
      return (
        <button
          type="button"
          onClick={(): void => {
            shell.setSelectedItem('msg-42');
          }}
        >
          select
        </button>
      );
    }

    function ObservingPane(): ReactElement {
      const context = useShellContext();
      return <span data-testid="observer">{context.selectedItemId ?? 'nothing'}</span>;
    }

    render(
      <Providers>
        <WritingPane />
        <ObservingPane />
      </Providers>,
    );

    expect(screen.getByTestId('observer')).toHaveTextContent('nothing');

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });

    // The whole point: the OTHER component observed the write.
    expect(screen.getByTestId('observer')).toHaveTextContent('msg-42');
  });

  it('gives every subscriber the same snapshot, so panes cannot tear', () => {
    const seen: Array<Readonly<RibbonContext>> = [];

    function Recorder(): ReactElement {
      const context = useShellContext();
      seen.push(context);
      return <span />;
    }

    let store!: ShellStateStore;
    render(
      <Providers>
        <CaptureStore
          into={(value): void => {
            store = value;
          }}
        />
        <Recorder />
        <Recorder />
      </Providers>,
    );
    seen.length = 0;

    act(() => {
      store.patchContext({ activeNavNodeId: 'root-a' });
    });

    // Both recorders re-rendered off one store, so they cannot disagree.
    expect(seen.length).toBeGreaterThan(0);
    const first = seen[0];
    for (const snapshot of seen) {
      expect(snapshot).toBe(first);
    }
  });

  it('stops subscribing when a pane unmounts', () => {
    let renders = 0;

    function Counter(): ReactElement {
      useShellContext();
      renders += 1;
      return <span />;
    }

    let store!: ShellStateStore;
    const view = render(
      <Providers>
        <CaptureStore
          into={(value): void => {
            store = value;
          }}
        />
        <Counter />
      </Providers>,
    );
    const mounted = renders;
    view.unmount();

    act(() => {
      store.setSelectedItem('msg-1');
    });

    expect(renders).toBe(mounted);
  });

  it('does not re-render when a field is set to the value it already holds', () => {
    let renders = 0;

    function Counter(): ReactElement {
      useShellContext();
      renders += 1;
      return <span />;
    }

    let store!: ShellStateStore;
    render(
      <Providers>
        <CaptureStore
          into={(value): void => {
            store = value;
          }}
        />
        <Counter />
      </Providers>,
    );

    act(() => {
      store.setSelectedItem('msg-7');
    });
    const afterFirstWrite = renders;
    const snapshot = store.getContext();

    act(() => {
      store.setSelectedItem('msg-7');
      store.patchContext({ selectedItemId: 'msg-7' });
      store.patchContext({});
    });

    // No allocation, therefore no new identity, therefore no notify: a
    // downstream `useMemo` keyed on the context must not be invalidated by a
    // write that changed nothing.
    expect(renders).toBe(afterFirstWrite);
    expect(store.getContext()).toBe(snapshot);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. A ribbon action can act                                                  */
/* -------------------------------------------------------------------------- */

describe('RibbonAction.onExecute', () => {
  it('can change shell state through the shell handle it is given', () => {
    const blueprint = makeBlueprint({
      id: 'mail-ext',
      ribbonActions: [
        {
          id: 'reply',
          label: 'Reply',
          icon: 'reply',
          isVisible: (ctx: RibbonContext): boolean => ctx.selectedItemId !== null,
          onExecute: (_ctx: RibbonContext, shell: IShellAPI): void => {
            shell.setSelectedItem('msg-42');
            shell.setBadgeCount('inbox', 1);
          },
        },
      ],
    });

    const host = mountHost();
    const active = activate(host, blueprint);
    const action = active.blueprint.ribbonActions[0];
    expect(action).toBeDefined();

    act(() => {
      action?.onExecute(active.shell.getContext(), active.shell);
    });

    expect(host.current.store.getContext().selectedItemId).toBe('msg-42');
    expect(host.current.store.getBadgeCount('mail-ext', 'inbox')).toBe(1);
  });

  it('receives the same deep-frozen handle the host holds for that extension', () => {
    let received: IShellAPI | undefined;
    const blueprint = makeBlueprint({
      id: 'mail-ext',
      ribbonActions: [
        {
          id: 'reply',
          label: 'Reply',
          icon: 'reply',
          isVisible: (): boolean => true,
          onExecute: (_ctx: RibbonContext, shell: IShellAPI): void => {
            received = shell;
          },
        },
      ],
    });

    const host = mountHost();
    const active = activate(host, blueprint);
    act(() => {
      active.blueprint.ribbonActions[0]?.onExecute(active.shell.getContext(), active.shell);
    });

    expect(received).toBe(active.shell);
    expect(Object.isFrozen(received)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Badge collision-resistance                                               */
/* -------------------------------------------------------------------------- */

describe('badge collision-resistance', () => {
  function makeNavExtension(id: string): Record<string, unknown> {
    return makeBlueprint({
      id,
      navigationTree: [{ id: 'inbox', label: 'Inbox' }],
      ribbonActions: [],
      views: { pane2: Pane2View, pane3: Pane3View },
    });
  }

  it('keeps two extensions that both use the node id "inbox" apart', () => {
    const host = mountHost();
    const mail = activate(host, makeNavExtension('mail-ext'));
    const crm = activate(host, makeNavExtension('crm-ext'));

    act(() => {
      mail.shell.setBadgeCount('inbox', 7);
      crm.shell.setBadgeCount('inbox', 3);
    });

    // Neither overwrote the other.
    expect(host.current.store.getBadgeCount('mail-ext', 'inbox')).toBe(7);
    expect(host.current.store.getBadgeCount('crm-ext', 'inbox')).toBe(3);

    act(() => {
      mail.shell.setBadgeCount('inbox', 0);
    });
    expect(host.current.store.getBadgeCount('mail-ext', 'inbox')).toBe(0);
    expect(host.current.store.getBadgeCount('crm-ext', 'inbox')).toBe(3);
  });

  it('does not let an extension name the scope it writes to', () => {
    const host = mountHost();
    const mail = activate(host, makeNavExtension('mail-ext'));
    activate(host, makeNavExtension('crm-ext'));

    act(() => {
      // A plugin trying to pass someone else's id as an extra argument. The
      // facade closes over its own id; the extra argument is not a parameter.
      (mail.shell.setBadgeCount as (nodeId: string, count: number, scope?: string) => void)(
        'inbox',
        99,
        'crm-ext',
      );
    });

    expect(host.current.store.getBadgeCount('mail-ext', 'inbox')).toBe(99);
    expect(host.current.store.getBadgeCount('crm-ext', 'inbox')).toBeUndefined();
  });

  it('still rejects a malformed node id from the scoped facade', () => {
    const host = mountHost();
    const mail = activate(host, makeNavExtension('mail-ext'));

    const error = expectShellUXError(() => {
      mail.shell.setBadgeCount('../escape', 1);
    });
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('nodeId');
  });

  it('reads back only its own scope, and offers no parameter to name another', () => {
    const host = mountHost();
    const mail = activate(host, makeNavExtension('mail-ext'));
    const crm = activate(host, makeNavExtension('crm-ext'));

    act(() => {
      mail.shell.setBadgeCount('inbox', 7);
      crm.shell.setBadgeCount('inbox', 3);
    });

    // Symmetric with the write half: each handle reads what IT wrote.
    expect(mail.shell.getBadgeCount('inbox')).toBe(7);
    expect(crm.shell.getBadgeCount('inbox')).toBe(3);

    // A plug-in trying to aim the read at a sibling. `getBadgeCount` declares one
    // parameter and the implementation reads one; the scope comes from the
    // closure, so the extra argument reaches nothing and the answer is still its
    // own. This is what stops the read half being a wider capability than the
    // write half it mirrors.
    const aimed = (mail.shell.getBadgeCount as (nodeId: string, scope?: string) => number | undefined)(
      'inbox',
      'crm-ext',
    );
    expect(aimed).toBe(7);

    // And a node nobody ever wrote is `undefined` rather than an error.
    expect(mail.shell.getBadgeCount('archive')).toBeUndefined();

    // The absence of confinement, stated by the same test that states the
    // scoping: the unscoped store is public and reads any scope at all.
    expect(host.current.store.getBadgeCount('crm-ext', 'inbox')).toBe(3);
  });

  it('rejects a malformed node id on the read half too', () => {
    const host = mountHost();
    const mail = activate(host, makeNavExtension('mail-ext'));

    const error = expectShellUXError(() => {
      mail.shell.getBadgeCount('../escape');
    });
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('nodeId');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Activation and revocation                                                */
/* -------------------------------------------------------------------------- */

describe('activation and revocation', () => {
  const MAIL = makeBlueprint({ id: 'mail-ext' });

  it('mints a live IShellAPI on activation and revokes it on release', () => {
    const host = mountHost();
    const active = activate(host, MAIL);
    const retained = active.shell;

    act(() => {
      retained.setSelectedItem('msg-1');
    });
    expect(host.current.store.getContext().selectedItemId).toBe('msg-1');

    let released!: boolean;
    act(() => {
      released = host.current.activation.release('mail-ext');
    });
    expect(released).toBe(true);
    expect(host.current.activation.getActive()).toBeNull();

    // Losing the foreground took mail-ext's selection with it — a handover clears
    // the outgoing extension's own state, which is what
    // `activationHandover.test.tsx` is about. A fresh sentinel is planted here so
    // that "the revoked write changed nothing" is still asserted against a value
    // that can be distinguished from the cleared one; `null` would be satisfied by
    // a write that really did land and really did clear the field.
    expect(host.current.store.getContext().selectedItemId).toBeNull();
    act(() => {
      host.current.store.setSelectedItem('msg-sentinel');
    });

    // The retained reference is now a typed failure, not a silent no-op.
    const error = expectShellUXError(() => {
      retained.setSelectedItem('msg-2');
    });
    expect(error).toBeInstanceOf(ShellUXError);
    expect(error.code).toBe('REVOKED');

    // ...and it changed nothing.
    expect(host.current.store.getContext().selectedItemId).toBe('msg-sentinel');

    // EVERY member, not a representative one. The wave that widened `IShellAPI`
    // from three members to seven (ADR-0001 Amendment K) is exactly the change
    // that could have added a live door onto a revoked handle, so the list here
    // is the whole interface and is checked against `Object.keys` below in "does
    // not expose revoke to the plugin".
    expect(expectShellUXError(() => retained.setSelectedItems(['msg-2'])).code).toBe('REVOKED');
    expect(expectShellUXError(() => retained.setActiveNavNode('root-a')).code).toBe('REVOKED');
    expect(expectShellUXError(() => retained.setBadgeCount('inbox', 1)).code).toBe('REVOKED');
    expect(expectShellUXError(() => retained.getBadgeCount('inbox')).code).toBe('REVOKED');
    expect(expectShellUXError(() => retained.setContextKey('loaded', true)).code).toBe('REVOKED');
    expect(expectShellUXError(() => retained.getContext()).code).toBe('REVOKED');

    // ...and none of them changed anything either.
    expect(host.current.store.getContext().selectedItemId).toBe('msg-sentinel');
    expect(host.current.store.getContext().activeNavNodeId).toBeNull();
    expect(host.current.store.getBadgeCount('mail-ext', 'inbox')).toBeUndefined();
  });

  it('reports false when releasing an extension that was never activated', () => {
    const host = mountHost();
    let released!: boolean;
    act(() => {
      released = host.current.activation.release('mail-ext');
    });
    expect(released).toBe(false);
  });

  it('reports false for a non-string id, without coercing it', () => {
    const host = mountHost();
    const active = activate(host, MAIL);

    let coerced = false;
    // The declared `string` binds no plain-JavaScript caller. This value would
    // release `mail-ext` if anything on the path stringified it — nothing does:
    // the parameter is type-checked, and `Map.prototype.get` compares with
    // `SameValueZero`, which invokes no conversion at all.
    const impostor = {
      toString: (): string => {
        coerced = true;
        return 'mail-ext';
      },
    };

    let released!: boolean;
    act(() => {
      released = (host.current.activation.release as (id: unknown) => boolean)(impostor);
    });

    expect(released).toBe(false);
    expect(coerced).toBe(false);
    // ...and the live extension kept both its liveness and its foreground.
    expect(host.current.activation.getActive()).toBe(active);
    act(() => {
      active.shell.setSelectedItem('msg-1');
    });
    expect(host.current.store.getContext().selectedItemId).toBe('msg-1');
  });

  it('losing the foreground revokes nothing', () => {
    const host = mountHost();
    const mail = activate(host, MAIL);

    act(() => {
      host.current.activation.blur();
    });
    expect(host.current.activation.getActive()).toBeNull();
    expect(host.current.store.getContext().activeExtensionId).toBeNull();

    // A backgrounded mail module can still push an unread badge.
    act(() => {
      mail.shell.setBadgeCount('root-a', 4);
    });
    expect(host.current.store.getBadgeCount('mail-ext', 'root-a')).toBe(4);
  });

  it('keeps the same handle across re-activation', () => {
    const host = mountHost();
    const first = activate(host, MAIL);
    let second!: ActiveExtension;
    act(() => {
      const outcome = host.current.activation.activate('mail-ext');
      if (!outcome.ok) {
        throw outcome.error;
      }
      second = outcome.active;
    });
    expect(second.shell).toBe(first.shell);
    expect(host.current.store.getContext().activeExtensionId).toBe('mail-ext');
  });

  it('never throws: activating an unregistered id is a typed failure', () => {
    const host = mountHost();
    let outcome!: ReturnType<ActivationController['activate']>;
    act(() => {
      outcome = host.current.activation.activate('nobody-ext');
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error('expected an activation failure');
    }
    expect(outcome.error).toBeInstanceOf(ShellUXError);
  });

  it('revokes when the extension is unregistered', () => {
    const host = mountHost();
    const active = activate(host, MAIL);

    act(() => {
      host.current.registry.unregister('mail-ext');
    });

    const error = expectShellUXError(() => {
      active.shell.setSelectedItem('msg-3');
    });
    expect(error.code).toBe('REVOKED');
    expect(host.current.activation.getActive()).toBeNull();
  });

  it('does not expose revoke to the plugin', () => {
    const host = mountHost();
    const active = activate(host, MAIL);
    const surface = active.shell as unknown as Record<string, unknown>;

    // The LITERAL member list, not a count. A count would have let the
    // contract-hardening wave (ADR-0001 Amendment K) widen `IShellAPI` from
    // three members to seven with this test still passing on a number nobody
    // read; spelling the names out is what forced the widening to be a change
    // somebody had to make on purpose, here, in a test named for `revoke`. It
    // did the same job again when the pane-1 metric pair took it from seven to
    // nine, again when the structured payload channel took it to twelve, and
    // again when the theme bridge took it to fourteen.
    expect(Object.keys(surface).sort()).toEqual([
      'getBadgeCount',
      'getContext',
      'getNavMetric',
      'getTheme',
      'onThemeChange',
      'publishPayload',
      'readPayload',
      'setActiveNavNode',
      'setBadgeCount',
      'setContextKey',
      'setNavMetric',
      'setSelectedItem',
      'setSelectedItems',
      'subscribePayload',
    ]);
    for (const key of Reflect.ownKeys(surface)) {
      expect(String(key)).not.toContain('revoke');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Provider discipline                                                         */
/* -------------------------------------------------------------------------- */

describe('provider discipline', () => {
  it('there is exactly one host-owned store behind every facade', () => {
    const seen = new Set<ShellStateStore>();

    function Probe(): ReactElement {
      const store = useShellStore();
      const stable = useRef(store);
      seen.add(store);
      expect(stable.current).toBe(store);
      return <span />;
    }

    render(
      <Providers>
        <Probe />
        <Probe />
      </Providers>,
    );

    expect(seen.size).toBe(1);
  });
});
