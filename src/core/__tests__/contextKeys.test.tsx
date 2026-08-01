import { act, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, REGISTRY_LIMITS, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController, ActiveExtension } from '../ActivationContext';
import { createShellStateStore, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellUXError } from '../types';
import { makeBlueprint, Pane2View, Pane3View } from './fixtures';

/**
 * ============================================================================
 * CONTEXT KEYS — A PURE PREDICATE THAT CAN STILL REACT
 * ============================================================================
 * A `RibbonAction.isVisible` predicate is a pure function of `RibbonContext` and
 * is handed no capability, which is what stops it writing during render. That
 * left a plug-in with no legitimate way to make the ribbon re-evaluate from state
 * the host does not model, and the two obvious answers were both rejected in
 * ADR-0001 Amendment K Decision 1:
 *
 *   - an `invalidateRibbon()` signal, which licenses a predicate to read mutable
 *     module state and so reintroduces the tearing `useSyncExternalStore` exists
 *     to prevent;
 *   - an opaque `extensionState` blob, which is a dumping ground with no
 *     validation story.
 *
 * Context keys are the third answer and the prior art is VS Code's `when`
 * clauses: NAMED, HOST-OWNED, PRIMITIVE values that a visibility expression
 * reads. This file pins the properties that make them safe to hand to untrusted
 * code — the narrow value type, the per-extension scoping, the notification
 * discipline, and the clearing on handover.
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

function activate(host: { current: Harness }, id: string): ActiveExtension {
  const blueprint = makeBlueprint({
    id,
    navigationTree: [{ id: 'root-a', label: 'Root A' }],
    ribbonActions: [],
    views: { pane2: Pane2View, pane3: Pane3View },
  });
  act(() => {
    expect(host.current.registry.register(blueprint).ok).toBe(true);
  });
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
/* The value type is the whole design                                          */
/* -------------------------------------------------------------------------- */

describe('setContextKey validates its value', () => {
  function callSetContextKey(store: ShellStateStore, value: unknown): () => void {
    return () => {
      (store.setContextKey as (extensionId: string, key: string, value: unknown) => void)(
        'mail-ext',
        'loaded',
        value,
      );
    };
  }

  it.each([
    ['a string', 'ready'],
    ['a number', 42],
    ['zero', 0],
    ['true', true],
    ['false', false],
    ['null', null],
  ])('accepts %s', (_label, value) => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    store.setContextKey('mail-ext', 'loaded', value as string);
    expect(store.getContext().contextKeys['loaded']).toBe(value);
  });

  it.each([
    ['a plain object', { loaded: true }],
    ['an array', ['ready']],
    ['a function', (): boolean => true],
    ['a symbol', Symbol('ready')],
    ['undefined', undefined],
    ['a bigint', BigInt(7)],
  ])('rejects %s, because primitives-only is what keeps this from being a blob', (_label, value) => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    const error = expectShellUXError(callSetContextKey(store, value));
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('value');
    expect(store.getContext().contextKeys['loaded']).toBeUndefined();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s, which a predicate cannot branch on usefully', (_label, value) => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    const error = expectShellUXError(callSetContextKey(store, value));
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.message).toContain('finite number');
  });

  it('does not stringify a rejected value', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    let ran = false;
    const hostile = {
      toString(): never {
        ran = true;
        throw new Error('arbitrary attacker code');
      },
    };
    const error = expectShellUXError(callSetContextKey(store, hostile));
    expect(ran).toBe(false);
    expect(error.message).toContain('"object"');
  });

  it('rejects a string value longer than the registry bound', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    const error = expectShellUXError(
      callSetContextKey(store, 'x'.repeat(REGISTRY_LIMITS.MAX_CONTEXT_VALUE_LENGTH + 1)),
    );
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.field).toBe('value');
  });

  it.each([
    ['a path escape', '../escape'],
    ['a prototype key', '__proto__'],
    ['a reserved key', 'constructor'],
    ['markup', '<script>'],
    ['a non-string', 7],
  ])('holds the key %s to the registry allowlist', (_label, key) => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    const error = expectShellUXError(() => {
      (store.setContextKey as (extensionId: string, key: unknown, value: unknown) => void)(
        'mail-ext',
        key,
        true,
      );
    });
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('key');
  });

  it('refuses one key more than an extension may hold', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    for (let index = 0; index < REGISTRY_LIMITS.MAX_CONTEXT_KEYS; index += 1) {
      store.setContextKey('mail-ext', `key-${String(index)}`, index);
    }
    const error = expectShellUXError(() => {
      store.setContextKey('mail-ext', 'one-too-many', true);
    });
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.field).toBe('key');

    // Rewriting a key it ALREADY holds is not growth and is still allowed at the
    // bound — the check is on new keys, which is what stops a full extension
    // being unable to update its own state.
    expect(() => {
      store.setContextKey('mail-ext', 'key-0', 'updated');
    }).not.toThrow();
    expect(store.getContext().contextKeys['key-0']).toBe('updated');
  });

  it('publishes a frozen, null-prototype record', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    store.setContextKey('mail-ext', 'loaded', true);
    const published = store.getContext().contextKeys;

    expect(Object.isFrozen(published)).toBe(true);
    // Nothing to pollute, whatever the key filter does.
    expect(Object.getPrototypeOf(published)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* patchContext is the same door                                               */
/* -------------------------------------------------------------------------- */

describe('patchContext rejects what setContextKey rejects', () => {
  function patchAnything(store: ShellStateStore): (patch: unknown) => void {
    return store.patchContext as (patch: unknown) => void;
  }

  it.each([
    ['a string', 'loaded'],
    ['null', null],
    ['an array', ['loaded']],
    ['a number', 7],
  ])('refuses %s in place of a record', (_label, value) => {
    const store = createShellStateStore();
    const error = expectShellUXError(() => {
      patchAnything(store)({ contextKeys: value });
    });
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('contextKeys');
  });

  it('refuses a revoked Proxy rather than raising a raw TypeError', () => {
    const store = createShellStateStore();
    const revocable = Proxy.revocable({ loaded: true }, {});
    revocable.revoke();
    const error = expectShellUXError(() => {
      patchAnything(store)({ contextKeys: revocable.proxy });
    });
    expect(error.code).toBe('INVALID_FIELD');
  });

  it('refuses a record that will not list its own keys', () => {
    const store = createShellStateStore();
    const hostile = new Proxy(
      { loaded: true },
      {
        ownKeys(): never {
          throw new Error('ownKeys refused');
        },
      },
    );
    const error = expectShellUXError(() => {
      patchAnything(store)({ contextKeys: hostile });
    });
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.message).toContain('refused to list its own keys');
  });

  it('refuses a value that throws while it is being read', () => {
    const store = createShellStateStore();
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'loaded', {
      enumerable: true,
      get(): never {
        throw new Error('getter refused');
      },
    });
    const error = expectShellUXError(() => {
      patchAnything(store)({ contextKeys: hostile });
    });
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('contextKeys.loaded');
  });

  it('refuses an illegal key and an illegal value through the patch door too', () => {
    const store = createShellStateStore();
    expect(expectShellUXError(() => patchAnything(store)({ contextKeys: { '../x': 1 } })).code).toBe(
      'INVALID_ID',
    );
    expect(
      expectShellUXError(() => patchAnything(store)({ contextKeys: { loaded: {} } })).code,
    ).toBe('INVALID_FIELD');
  });

  it('refuses more keys than an extension may hold', () => {
    const store = createShellStateStore();
    const tooMany: Record<string, boolean> = {};
    for (let index = 0; index <= REGISTRY_LIMITS.MAX_CONTEXT_KEYS; index += 1) {
      tooMany[`key-${String(index)}`] = true;
    }
    const error = expectShellUXError(() => {
      patchAnything(store)({ contextKeys: tooMany });
    });
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(error.field).toBe('contextKeys');
  });

  it('clears the record when contextKeys is spelled undefined', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    store.setContextKey('mail-ext', 'loaded', true);
    patchAnything(store)({ contextKeys: undefined });
    expect(store.getContext().contextKeys).toEqual({});
  });

  it('round-trips its own published record without notifying', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    store.setContextKey('mail-ext', 'loaded', true);
    const before = store.getContext();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.patchContext(before);

    expect(store.getContext()).toBe(before);
    expect(notifications).toBe(0);
  });

  it('treats a record with the same key count but a different key as a change', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    store.setContextKey('mail-ext', 'loaded', true);
    store.patchContext({ contextKeys: { ready: true } });
    expect(store.getContext().contextKeys).toEqual({ ready: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Notification discipline                                                     */
/* -------------------------------------------------------------------------- */

describe('context keys and the notification pass', () => {
  it('notifies when a context key moves, so the ribbon re-evaluates', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.setContextKey('mail-ext', 'loaded', true);
    expect(notifications).toBe(1);
    expect(store.getContext().contextKeys['loaded']).toBe(true);

    store.setContextKey('mail-ext', 'loaded', false);
    expect(notifications).toBe(2);
    expect(store.getContext().contextKeys['loaded']).toBe(false);
  });

  it('does not notify when a context key is rewritten with the value it already holds', () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    store.setContextKey('mail-ext', 'loaded', true);
    const before = store.getContext();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.setContextKey('mail-ext', 'loaded', true);

    // A fresh record is built on every write, so an identity comparison would
    // have woken every subscriber in the shell for a no-op.
    expect(store.getContext()).toBe(before);
    expect(notifications).toBe(0);
  });

  it("does not notify for a background extension's own context key", () => {
    const store = createShellStateStore({ activeExtensionId: 'mail-ext' });
    const before = store.getContext();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.setContextKey('crm-ext', 'loaded', true);

    // The store moved; the published context did not, because only the
    // foreground's namespace is published. Nothing for a subscriber to re-read.
    expect(store.getContext()).toBe(before);
    expect(notifications).toBe(0);
    expect(store.getContext().contextKeys['loaded']).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Scoping, and the handover                                                   */
/* -------------------------------------------------------------------------- */

describe('context-key scoping', () => {
  it("keeps two extensions' context keys apart, and publishes only the foreground's", () => {
    const host = mountHost();
    const mail = activate(host, 'mail-ext');
    const crm = activate(host, 'crm-ext');

    // `crm-ext` is in the foreground after the second activation.
    act(() => {
      crm.shell.setContextKey('loaded', 'crm');
      mail.shell.setContextKey('loaded', 'mail');
    });

    // Both wrote a key called `loaded`; neither overwrote the other, and the
    // published record is the foreground's.
    expect(host.current.store.getContext().contextKeys['loaded']).toBe('crm');

    act(() => {
      host.current.activation.activate('mail-ext');
    });
    // ...and a handover clears every namespace, so mail-ext does not arrive
    // holding what it wrote while it was in the background.
    expect(host.current.store.getContext().contextKeys).toEqual({});
  });

  it('does not let an extension name the scope it writes a context key to', () => {
    const host = mountHost();
    activate(host, 'crm-ext');
    const mail = activate(host, 'mail-ext');

    act(() => {
      // The facade closes over its own id; a third argument is not a parameter.
      (mail.shell.setContextKey as (key: string, value: boolean, scope?: string) => void)(
        'loaded',
        true,
        'crm-ext',
      );
    });

    // It landed in mail-ext's own scope, which is the foreground, so it is
    // published — and it did not land in crm-ext's.
    expect(host.current.store.getContext().contextKeys['loaded']).toBe(true);
    act(() => {
      host.current.activation.activate('crm-ext');
    });
    expect(host.current.store.getContext().contextKeys).toEqual({});
  });

  it('clears every extension\'s context keys on a foreground handover', () => {
    const host = mountHost();
    const mail = activate(host, 'mail-ext');
    activate(host, 'crm-ext');

    // Written while backgrounded, so it is in mail-ext's namespace and is not
    // published.
    act(() => {
      mail.shell.setContextKey('loaded', true);
    });
    expect(host.current.store.getContext().contextKeys).toEqual({});

    // Bring mail-ext back. If the namespaces had survived the handover, its old
    // key would reappear here — describing a pane that was unmounted in between.
    act(() => {
      host.current.activation.activate('mail-ext');
    });
    expect(host.current.store.getContext().contextKeys).toEqual({});
  });

  it('carries the cleared record in the same single notification as the rest of the handover', () => {
    const host = mountHost();
    const mail = activate(host, 'mail-ext');
    act(() => {
      mail.shell.setContextKey('loaded', true);
      mail.shell.setSelectedItems(['msg-1', 'msg-2']);
    });

    const seen: Readonly<Record<string, unknown>>[] = [];
    host.current.store.subscribe(() => {
      seen.push(host.current.store.getContext() as unknown as Readonly<Record<string, unknown>>);
    });

    activate(host, 'crm-ext');

    // One pass, carrying the whole transition. Two passes would have published a
    // snapshot naming the new extension beside the old extension's context keys.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      activeExtensionId: 'crm-ext',
      activeNavNodeId: null,
      selectedItemIds: [],
      selectedItemId: null,
      contextKeys: {},
    });
  });

  it('keeps a live context key when the same foreground is republished', () => {
    const host = mountHost();
    const mail = activate(host, 'mail-ext');
    act(() => {
      mail.shell.setContextKey('loaded', true);
    });

    act(() => {
      // Re-activating the extension already in front is a republish, not a
      // handover — the same rule the selection follows.
      host.current.activation.activate('mail-ext');
    });

    expect(host.current.store.getContext().contextKeys['loaded']).toBe(true);
  });
});
