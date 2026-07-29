import { describe, expect, it } from 'vitest';
import { createShellAPI, createShellStateStore, deepFreeze } from '../ShellAPI';
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

  it('reports undefined for a node that never had a badge', () => {
    const store = createShellStateStore();
    expect(store.getBadgeCount('root-a')).toBeUndefined();
  });

  it('stores badge counts', () => {
    const store = createShellStateStore();
    store.setBadgeCount('root-a', 0);
    expect(store.getBadgeCount('root-a')).toBe(0);
    store.setBadgeCount('root-a', 12);
    expect(store.getBadgeCount('root-a')).toBe(12);
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

    it('is validated at the store, so patchContext stays the unvalidated host path', () => {
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
