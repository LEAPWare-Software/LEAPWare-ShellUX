import { describe, expect, it } from 'vitest';
import {
  createRevocableShellAPI,
  createShellAPI,
  createShellStateStore,
  deepFreeze,
} from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellUXError } from '../types';
import type { IShellAPI, RibbonContext } from '../types';
import { makeUnclassifiableValue, makeUnstringifiableValue } from './fixtures';

describe('deepFreeze', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'text'],
    ['a boolean', true],
  ])('returns %s unchanged', (_label, value) => {
    expect(deepFreeze(value)).toBe(value);
  });

  it('returns a symbol unchanged', () => {
    const value = Symbol('shellux.test');
    expect(deepFreeze(value)).toBe(value);
  });

  it('freezes nested objects and arrays', () => {
    const target = { level1: { level2: { values: [1, 2, 3] } } };
    deepFreeze(target);

    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target.level1)).toBe(true);
    expect(Object.isFrozen(target.level1.level2)).toBe(true);
    expect(Object.isFrozen(target.level1.level2.values)).toBe(true);
  });

  it('freezes function-valued properties', () => {
    const method = (): number => 1;
    deepFreeze({ method });
    expect(Object.isFrozen(method)).toBe(true);
  });

  it('freezes a function passed directly', () => {
    const fn = (): void => undefined;
    expect(deepFreeze(fn)).toBe(fn);
    expect(Object.isFrozen(fn)).toBe(true);
  });

  it('terminates on a cyclic graph', () => {
    interface Cyclic {
      name: string;
      self?: Cyclic;
    }
    const node: Cyclic = { name: 'root' };
    node.self = node;

    expect(() => deepFreeze(node)).not.toThrow();
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('short-circuits on an already-frozen object', () => {
    const frozen = Object.freeze({ inner: { untouched: true } });
    expect(deepFreeze(frozen)).toBe(frozen);
    // The guard is what makes cycles terminate; the trade-off is that a
    // caller-frozen shell is treated as fully frozen.
    expect(Object.isFrozen(frozen.inner)).toBe(false);
  });

  it('freezes symbol-keyed properties too', () => {
    const key = Symbol('nested');
    const nested = { deep: true };
    const target: Record<symbol, unknown> = { [key]: nested };
    deepFreeze(target);
    expect(Object.isFrozen(nested)).toBe(true);
  });
});

/**
 * `deepFreeze` is documented in DEVELOPER.md as the way an extension author
 * freezes their own `IShellAPI` test double, so it is reachable from code this
 * repository does not own and can be handed an exotic object. Every route it
 * takes into a value — `Object.isFrozen`, `Object.freeze`, `Reflect.ownKeys`,
 * a property read — re-enters user code on a Proxy, and every one of them can
 * throw. It must stay total.
 */
describe('deepFreeze — hostile objects cannot make it throw', () => {
  it('survives a Proxy whose isExtensible trap throws', () => {
    const hostile = new Proxy(
      {},
      {
        isExtensible(): never {
          throw new Error('extensibility lookup refused');
        },
      },
    );
    // Prove the fixture: the plain operation really does throw.
    expect(() => Object.isFrozen(hostile)).toThrow();

    expect(() => deepFreeze(hostile)).not.toThrow();
    expect(deepFreeze(hostile)).toBe(hostile);
  });

  it('survives a Proxy whose preventExtensions trap throws', () => {
    const hostile = new Proxy(
      {},
      {
        preventExtensions(): never {
          throw new Error('freeze refused');
        },
      },
    );
    expect(() => Object.freeze(hostile)).toThrow();

    expect(() => deepFreeze(hostile)).not.toThrow();
    expect(deepFreeze(hostile)).toBe(hostile);
  });

  it('survives an ownKeys trap that throws after the freeze itself succeeded', () => {
    let calls = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys(target): ArrayLike<string | symbol> {
          calls += 1;
          if (calls > 1) {
            throw new Error('enumeration refused');
          }
          return Reflect.ownKeys(target);
        },
      },
    );

    expect(() => deepFreeze(hostile)).not.toThrow();
    // `Object.freeze` consumed the first call; the walk's own `Reflect.ownKeys`
    // is the one that detonated.
    expect(calls).toBeGreaterThan(1);
  });

  it('keeps freezing the siblings when a get trap throws', () => {
    const readable = { nested: { deep: true } };
    const hostile = new Proxy(
      { boom: {}, ok: readable },
      {
        get(target, key, receiver): unknown {
          if (key === 'boom') {
            throw new Error('property read refused');
          }
          return Reflect.get(target, key, receiver);
        },
      },
    );

    expect(() => deepFreeze(hostile)).not.toThrow();
    // One unreadable property must not abandon the rest of the walk.
    expect(Object.isFrozen(readable)).toBe(true);
    expect(Object.isFrozen(readable.nested)).toBe(true);
  });
});

describe('createShellStateStore', () => {
  it('starts from the empty context when no seed is supplied', () => {
    const store = createShellStateStore();
    expect(store.getContext()).toEqual({
      activeExtensionId: null,
      activeNavNodeId: null,
      selectedItemId: null,
      focusedPane: null,
    });
  });

  it('applies a seed context', () => {
    const store = createShellStateStore({
      activeExtensionId: 'sample-ext',
      focusedPane: 'pane2',
    });
    expect(store.getContext().activeExtensionId).toBe('sample-ext');
    expect(store.getContext().focusedPane).toBe('pane2');
    expect(store.getContext().selectedItemId).toBeNull();
  });

  it('returns a frozen context snapshot', () => {
    const store = createShellStateStore();
    expect(Object.isFrozen(store.getContext())).toBe(true);

    store.patchContext({ activeNavNodeId: 'root-a' });
    expect(Object.isFrozen(store.getContext())).toBe(true);
    expect(store.getContext().activeNavNodeId).toBe('root-a');
  });

  it('replaces rather than mutates the snapshot on patch', () => {
    const store = createShellStateStore();
    const before = store.getContext();
    store.patchContext({ selectedItemId: 'item-1' });
    expect(store.getContext()).not.toBe(before);
    expect(before.selectedItemId).toBeNull();
  });

  /**
   * ==========================================================================
   * THE STORE OBJECT IS HANDED OUT, SO THE STORE OBJECT IS FROZEN
   * ==========================================================================
   * The state behind the store is unreachable — closure variables, no
   * reflective API for a scope. That was true and it was being used to argue
   * something it does not support: the OBJECT carrying the six methods was a
   * plain mutable literal. `useShellStore()` is public by this repository's own
   * admission, so a plug-in view rendering inside the provider obtains this
   * exact object and, before this test, could assign over `setSelectedItem`,
   * `getContext` or `patchContext` and intercept, suppress or forge every write
   * and read the host and every other extension made through it.
   *
   * No reflection was needed for that. It was the documented public API.
   * `createShellAPI`'s facade had been deep-frozen for exactly this reason for
   * as long as it has existed; the store it sits on had not.
   *
   * **What these tests establish is that no member can be replaced, deleted or
   * added, and nothing wider.** The paragraph above is history, and a later reader
   * drew a conclusion from it that it does not support — that a frozen store cannot
   * be intercepted at all. `subscribe` is one of the six members and intercepts
   * without replacing anything. `subscribe.test.tsx` pins that, and ADR-0001
   * Amendment G records why an inference from these tests to that conclusion is the
   * defect the repository kept repeating.
   * ==========================================================================
   */
  describe('the store object cannot be rewired', () => {
    it('is frozen, so a strict-mode method swap throws and changes nothing', () => {
      const store = createShellStateStore();
      expect(Object.isFrozen(store)).toBe(true);

      const original = store.setSelectedItem;
      // This module is an ES module, therefore strict mode — as is any plug-in
      // bundle, which is also a module.
      expect(() => {
        (store as unknown as Record<string, unknown>)['setSelectedItem'] = (): void => undefined;
      }).toThrow(TypeError);
      expect(store.setSelectedItem).toBe(original);

      store.setSelectedItem('item-1');
      expect(store.getContext().selectedItemId).toBe('item-1');
    });

    it('refuses replacement and deletion of every member, and refuses a new one', () => {
      const store = createShellStateStore();
      const target = store as unknown as Record<string, unknown>;
      const before = { ...target };
      expect(Object.keys(before).sort()).toEqual([
        'getBadgeCount',
        'getContext',
        'patchContext',
        'setBadgeCount',
        'setSelectedItem',
        'subscribe',
      ]);

      for (const key of Object.keys(before)) {
        expect(() => {
          target[key] = (): void => undefined;
        }).toThrow(TypeError);
        expect(() => {
          delete target[key];
        }).toThrow(TypeError);
        expect(target[key]).toBe(before[key]);
      }

      expect(Object.isExtensible(store)).toBe(false);
      expect(() => {
        target['injected'] = (): void => undefined;
      }).toThrow(TypeError);
      expect(() => Object.setPrototypeOf(store, { evil: true })).toThrow(TypeError);
    });

    it('is a silent no-op in sloppy mode, and the members still work', () => {
      const store = createShellStateStore();
      const original = store.patchContext;

      // A `Function` body is sloppy mode by default, so the assignment fails
      // silently instead of throwing. The member must still be the original.
      const sloppyMutate = new Function(
        'target',
        'target.patchContext = null; delete target.getContext; target.extra = 1; return target;',
      ) as (target: unknown) => ShellStateStore;

      expect(() => sloppyMutate(store)).not.toThrow();
      expect(store.patchContext).toBe(original);
      expect(typeof store.getContext).toBe('function');
      expect((store as unknown as Record<string, unknown>)['extra']).toBeUndefined();

      store.patchContext({ focusedPane: 'pane2' });
      expect(store.getContext().focusedPane).toBe('pane2');
    });
  });

  it('reports undefined for a node that never had a badge', () => {
    const store = createShellStateStore();
    expect(store.getBadgeCount('sample-ext', 'root-a')).toBeUndefined();
  });

  it('stores badge counts', () => {
    const store = createShellStateStore();
    store.setBadgeCount('sample-ext', 'root-a', 0);
    expect(store.getBadgeCount('sample-ext', 'root-a')).toBe(0);
    store.setBadgeCount('sample-ext', 'root-a', 12);
    expect(store.getBadgeCount('sample-ext', 'root-a')).toBe(12);
  });

  it('scopes a badge to its extension, so the same node id does not collide', () => {
    const store = createShellStateStore();
    store.setBadgeCount('mail-ext', 'inbox', 7);
    store.setBadgeCount('crm-ext', 'inbox', 3);
    expect(store.getBadgeCount('mail-ext', 'inbox')).toBe(7);
    expect(store.getBadgeCount('crm-ext', 'inbox')).toBe(3);
  });

  /**
   * ==========================================================================
   * THE BADGE SCOPE IS AN UNTRUSTED ARGUMENT TOO
   * ==========================================================================
   * `badgeKey` builds `${extensionId}:${nodeId}`. `setBadgeCount` used to
   * validate `nodeId` and `count` and never `extensionId`, and `getBadgeCount`
   * validated neither — so the one module whose own banner promises never to
   * stringify an untrusted value interpolated two of them. `useShellStore()` is
   * public by this repository's own admission, so both doors are reachable from
   * plug-in code.
   * ==========================================================================
   */
  describe('the badge scope and node id are validated at both doors', () => {
    function expectShellUXErrorFrom(call: () => void): ShellUXError {
      let caught: unknown;
      try {
        call();
      } catch (error) {
        caught = error;
      }
      // A raw Error or TypeError here means the key was built by interpolating a
      // value nobody had proven to be a string.
      expect(caught).toBeInstanceOf(ShellUXError);
      return caught as ShellUXError;
    }

    it('never runs a hostile toString on the write path', () => {
      const store = createShellStateStore();
      let ran = false;
      const hostile = {
        toString(): string {
          ran = true;
          return 'mail-ext';
        },
      };

      const error = expectShellUXErrorFrom(() => {
        (store.setBadgeCount as (scope: unknown, nodeId: string, count: number) => void)(
          hostile,
          'root-a',
          1,
        );
      });
      expect(error.code).toBe('INVALID_ID');
      expect(error.field).toBe('extensionId');
      expect(error.message).toContain('"object"');
      expect(ran).toBe(false);
    });

    it('never runs a hostile toString on the read path either', () => {
      const store = createShellStateStore();
      let ran = false;
      const hostile = {
        toString(): string {
          ran = true;
          return 'mail-ext';
        },
      };

      const error = expectShellUXErrorFrom(() => {
        (store.getBadgeCount as (scope: unknown, nodeId: string) => number | undefined)(
          hostile,
          'root-a',
        );
      });
      expect(error.code).toBe('INVALID_ID');
      expect(error.field).toBe('extensionId');
      expect(ran).toBe(false);
    });

    it('reports a throwing toString as a ShellUXError rather than letting it escape', () => {
      const store = createShellStateStore();
      const hostile = makeUnstringifiableValue({ withToPrimitive: false });
      expect(() => `${hostile as unknown as string}:root-a`).toThrow('stringification refused');

      expect(
        expectShellUXErrorFrom(() => {
          (store.setBadgeCount as (scope: unknown, nodeId: string, count: number) => void)(
            hostile,
            'root-a',
            1,
          );
        }).code,
      ).toBe('INVALID_ID');
    });

    it('reports a Symbol scope as a ShellUXError rather than a raw TypeError', () => {
      const store = createShellStateStore();
      const hostile = Symbol('mail-ext');
      // Template interpolation of a Symbol is a raw TypeError, which is exactly
      // what a function contracted to throw `ShellUXError` may not produce.
      expect(() => `${hostile as unknown as string}:root-a`).toThrow(TypeError);

      const error = expectShellUXErrorFrom(() => {
        (store.getBadgeCount as (scope: unknown, nodeId: string) => number | undefined)(
          hostile,
          'root-a',
        );
      });
      expect(error.code).toBe('INVALID_ID');
      expect(error.message).toContain('"symbol"');
    });

    it('refuses a re-entrant toString before it can write to the store mid-call', () => {
      const store = createShellStateStore();
      let reentered = false;
      const hostile = {
        toString(): string {
          reentered = true;
          store.setSelectedItem('written-from-inside-a-key-build');
          return 'mail-ext';
        },
      };

      expectShellUXErrorFrom(() => {
        (store.setBadgeCount as (scope: unknown, nodeId: string, count: number) => void)(
          hostile,
          'root-a',
          1,
        );
      });
      expect(reentered).toBe(false);
      expect(store.getContext().selectedItemId).toBeNull();
    });

    it.each([
      ['a path', '../escape'],
      ['markup', '<script>'],
      ['uppercase', 'MailExt'],
      ['a reserved word', 'constructor'],
      ['an empty string', ''],
      ['a scope with the separator in it', 'mail:ext'],
    ])('refuses %s as a badge scope', (_label, scope) => {
      const store = createShellStateStore();
      const error = expectShellUXErrorFrom(() => {
        (store.setBadgeCount as (scope: unknown, nodeId: string, count: number) => void)(
          scope,
          'root-a',
          1,
        );
      });
      expect(error.code).toBe('INVALID_ID');
      expect(error.field).toBe('extensionId');
    });

    it('validates the node id on the read path, which used to check nothing at all', () => {
      const store = createShellStateStore();
      const error = expectShellUXErrorFrom(() => {
        (store.getBadgeCount as (scope: string, nodeId: unknown) => number | undefined)(
          'mail-ext',
          { self: 'referential' },
        );
      });
      expect(error.code).toBe('INVALID_ID');
      expect(error.field).toBe('nodeId');
      expect(error.message).toContain('getBadgeCount');
    });

    it('still accepts the host scope, which no extension id can spell', () => {
      const store = createShellStateStore();
      // `createShellAPI` writes here, so it has to remain a legal scope even
      // though `EXTENSION_ID_PATTERN` rejects it.
      const api = createShellAPI(store);
      api.setBadgeCount('root-a', 5);
      expect(store.getBadgeCount('__host__', 'root-a')).toBe(5);
    });

    it('refuses to mint a scoped facade for an extensionId that was never validated', () => {
      const store = createShellStateStore();
      let ran = false;
      const hostile = {
        toString(): string {
          ran = true;
          return 'mail-ext';
        },
      };

      // The REVOKED message names the extension, so the name has to be proven to
      // be a primitive string before the facade exists at all.
      const error = expectShellUXErrorFrom(() => {
        (
          createRevocableShellAPI as unknown as (
            store: ShellStateStore,
            extensionId: unknown,
          ) => unknown
        )(store, hostile);
      });
      expect(error.code).toBe('INVALID_ID');
      expect(error.field).toBe('extensionId');
      expect(ran).toBe(false);
    });
  });

  it('notifies subscribers on a real change and not on a no-op', () => {
    const store = createShellStateStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.patchContext({ activeNavNodeId: 'root-a' });
    expect(notifications).toBe(1);

    // Same value: no allocation, so the snapshot keeps its identity, so nobody
    // is told anything.
    const snapshot = store.getContext();
    store.patchContext({ activeNavNodeId: 'root-a' });
    expect(notifications).toBe(1);
    expect(store.getContext()).toBe(snapshot);

    unsubscribe();
    store.patchContext({ activeNavNodeId: 'root-b' });
    expect(notifications).toBe(1);
  });
});

describe('IShellAPI', () => {
  function makeApi(initial?: Partial<RibbonContext>): IShellAPI {
    const store = initial === undefined ? createShellStateStore() : createShellStateStore(initial);
    return createShellAPI(store);
  }

  it('sets and clears the selected item', () => {
    const api = makeApi({ activeExtensionId: 'sample-ext' });

    api.setSelectedItem('item-42');
    expect(api.getContext().selectedItemId).toBe('item-42');
    expect(api.getContext().activeExtensionId).toBe('sample-ext');

    api.setSelectedItem(null);
    expect(api.getContext().selectedItemId).toBeNull();
  });

  it('returns a frozen context to plugin code', () => {
    const api = makeApi();
    const context = api.getContext();
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => {
      (context as { selectedItemId: string | null }).selectedItemId = 'hijacked';
    }).toThrow(TypeError);
  });

  it('accepts a valid badge count', () => {
    const api = makeApi();
    expect(() => {
      api.setBadgeCount('root-a', 3);
    }).not.toThrow();
  });

  it.each([
    ['a reserved key', '__proto__'],
    ['a prototype key', 'constructor'],
    ['markup', '<script>'],
    ['a path', '../root'],
    ['uppercase', 'RootA'],
    ['an empty string', ''],
  ])('rejects %s as a badge nodeId', (_label, nodeId) => {
    const api = makeApi();
    let caught: unknown;
    try {
      api.setBadgeCount(nodeId, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShellUXError);
    expect((caught as ShellUXError).code).toBe('INVALID_ID');
    expect((caught as ShellUXError).field).toBe('nodeId');
  });

  it('rejects a non-string badge nodeId', () => {
    const api = makeApi();
    expect(() => {
      (api.setBadgeCount as (nodeId: unknown, count: number) => void)(123, 1);
    }).toThrow(ShellUXError);
  });

  it.each([
    ['a string', 'three'],
    ['a fraction', 1.5],
    ['a negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s as a badge count', (_label, count) => {
    const api = makeApi();
    let caught: unknown;
    try {
      (api.setBadgeCount as (nodeId: string, count: unknown) => void)('root-a', count);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShellUXError);
    expect((caught as ShellUXError).code).toBe('INVALID_FIELD');
    expect((caught as ShellUXError).field).toBe('count');
  });

  /* ---- NEW-A: message building must never touch the value --------------- */

  /** Run `call`, assert it threw a `ShellUXError`, and return it. */
  function expectShellUXError(call: () => void): ShellUXError {
    let caught: unknown;
    try {
      call();
    } catch (error) {
      caught = error;
    }
    // A raw TypeError here means the failure path stringified the value it was
    // rejecting — which is the defect, not an incidental detail.
    expect(caught).toBeInstanceOf(ShellUXError);
    return caught as ShellUXError;
  }

  function callSetBadgeCount(api: IShellAPI, nodeId: unknown): () => void {
    return () => {
      (api.setBadgeCount as (nodeId: unknown, count: number) => void)(nodeId, 1);
    };
  }

  describe('setBadgeCount rejects an unstringifiable nodeId with a ShellUXError', () => {
    it('rejects a circular structure', () => {
      const api = makeApi();
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      // Prove the fixture: the old message-building route really does throw.
      expect(() => JSON.stringify(circular)).toThrow(TypeError);

      const error = expectShellUXError(callSetBadgeCount(api, circular));
      expect(error.code).toBe('INVALID_ID');
      expect(error.field).toBe('nodeId');
      expect(error.message).toContain('"object"');
    });

    it('rejects a BigInt', () => {
      const api = makeApi();
      const value = BigInt(9007199254740993n);
      expect(() => JSON.stringify(value)).toThrow(TypeError);

      const error = expectShellUXError(callSetBadgeCount(api, value));
      expect(error.code).toBe('INVALID_ID');
      expect(error.message).toContain('"bigint"');
    });

    it('never runs a plugin-supplied toJSON', () => {
      const api = makeApi();
      let ran = false;
      const value = {
        toJSON(): never {
          ran = true;
          throw new Error('arbitrary attacker code');
        },
      };

      const error = expectShellUXError(callSetBadgeCount(api, value));
      expect(ran).toBe(false);
      expect(error.code).toBe('INVALID_ID');
    });

    it('never runs toString, valueOf or Symbol.toPrimitive', () => {
      const api = makeApi();
      const value = makeUnstringifiableValue({ withToPrimitive: true });
      expect(() => String(value)).toThrow();

      const error = expectShellUXError(callSetBadgeCount(api, value));
      expect(error.code).toBe('INVALID_ID');
      expect(error.message).toContain('"object"');
    });

    it('rejects a Proxy that traps getPrototypeOf', () => {
      const api = makeApi();
      const value = makeUnclassifiableValue();
      expect(() => value instanceof Error).toThrow();

      const error = expectShellUXError(callSetBadgeCount(api, value));
      expect(error.code).toBe('INVALID_ID');
    });

    it.each([
      ['null', null, 'null'],
      ['undefined', undefined, '"undefined"'],
      ['a symbol', Symbol('hostile'), '"symbol"'],
      ['a function', (): void => undefined, '"function"'],
      ['an array', [], '"object"'],
    ])('describes %s by type alone', (_label, value, fragment) => {
      const api = makeApi();
      const error = expectShellUXError(callSetBadgeCount(api, value));
      expect(error.code).toBe('INVALID_ID');
      expect(error.message).toContain(fragment);
    });

    it('still names the offending value when it is provably a string', () => {
      const api = makeApi();
      const error = expectShellUXError(callSetBadgeCount(api, 'Not A Valid Id'));
      expect(error.code).toBe('INVALID_ID');
      expect(error.message).toContain('Not A Valid Id');
    });
  });

  /* ---- NEW-B: setSelectedItem validates its argument -------------------- */

  describe('setSelectedItem validates its argument', () => {
    function callSetSelectedItem(api: IShellAPI, id: unknown): () => void {
      return () => {
        (api.setSelectedItem as (id: unknown) => void)(id);
      };
    }

    it('accepts a string and null', () => {
      const api = makeApi();
      expect(() => api.setSelectedItem('item-1')).not.toThrow();
      expect(api.getContext().selectedItemId).toBe('item-1');
      expect(() => api.setSelectedItem(null)).not.toThrow();
      expect(api.getContext().selectedItemId).toBeNull();
    });

    it.each([
      ['a number', 42],
      ['undefined', undefined],
      ['a boolean', true],
      ['an array', ['item-1']],
      ['a plain object', { toString: (): string => 'item-1' }],
      ['a symbol', Symbol('item')],
    ])('rejects %s with a ShellUXError', (_label, id) => {
      const api = makeApi();
      const error = expectShellUXError(callSetSelectedItem(api, id));
      expect(error.code).toBe('INVALID_FIELD');
      expect(error.field).toBe('id');
      // The rejected value never reaches the context: the declared
      // `string | null` type stays true at runtime.
      expect(api.getContext().selectedItemId).toBeNull();
    });

    it('does not stringify the rejected value', () => {
      const api = makeApi();
      let ran = false;
      const hostile = {
        toString(): never {
          ran = true;
          throw new Error('arbitrary attacker code');
        },
      };

      const error = expectShellUXError(callSetSelectedItem(api, hostile));
      expect(ran).toBe(false);
      expect(error.message).toContain('"object"');
    });

    it('keeps a rejected object out of the snapshot other extensions read', () => {
      const api = makeApi({ activeExtensionId: 'sample-ext' });
      const injected = { evil: true };

      expectShellUXError(callSetSelectedItem(api, injected));

      const context = api.getContext();
      expect(context.selectedItemId).toBeNull();
      expect(context.selectedItemId).not.toBe(injected);
      // A prior good value also survives a later bad call.
      api.setSelectedItem('item-9');
      expectShellUXError(callSetSelectedItem(api, injected));
      expect(api.getContext().selectedItemId).toBe('item-9');
    });

    // The store, not just the facade, is where the check lives — which is what
    // lets `patchContext` reuse it. See `contextPatch.test.ts` for the patch path;
    // it is NOT an unvalidated host path and this test's name used to say it was.
    it('is validated at the store, not only at the facade in front of it', () => {
      const store = createShellStateStore();
      expect(() => {
        (store.setSelectedItem as (id: unknown) => void)(7);
      }).toThrow(ShellUXError);
      expect(store.getContext().selectedItemId).toBeNull();

      store.setSelectedItem('item-3');
      expect(store.getContext().selectedItemId).toBe('item-3');
      expect(Object.isFrozen(store.getContext())).toBe(true);
    });
  });

  it('is deep-frozen: strict-mode reassignment throws', () => {
    const api = makeApi();
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.setSelectedItem)).toBe(true);

    // This module is an ES module, therefore strict mode.
    expect(() => {
      (api as unknown as Record<string, unknown>)['setSelectedItem'] = (): void => undefined;
    }).toThrow(TypeError);
    expect(() => {
      (api as unknown as Record<string, unknown>)['newMethod'] = (): void => undefined;
    }).toThrow(TypeError);
    expect(() => {
      delete (api as unknown as Record<string, unknown>)['getContext'];
    }).toThrow(TypeError);
  });

  it('is deep-frozen: sloppy-mode reassignment is a silent no-op', () => {
    const api = makeApi();
    const original = api.setSelectedItem;

    // A Function body is sloppy mode by default, so assignment fails silently
    // rather than throwing. The method must still be the original.
    const sloppyMutate = new Function(
      'target',
      'target.setSelectedItem = null; delete target.getContext; target.extra = 1; return target;',
    ) as (target: unknown) => IShellAPI;

    expect(() => sloppyMutate(api)).not.toThrow();
    expect(api.setSelectedItem).toBe(original);
    expect(typeof api.getContext).toBe('function');
    expect((api as unknown as Record<string, unknown>)['extra']).toBeUndefined();

    // And the API still works after the attempted takeover.
    api.setSelectedItem('item-7');
    expect(api.getContext().selectedItemId).toBe('item-7');
  });

  it('cannot have its prototype swapped', () => {
    const api = makeApi();
    expect(Object.isExtensible(api)).toBe(false);
    expect(() => Object.setPrototypeOf(api, { evil: true })).toThrow(TypeError);
  });
});
