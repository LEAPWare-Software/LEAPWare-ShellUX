import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_SHELL_STATE,
  EMPTY_SCOPED_STATE,
  HYDRATION_LIMITS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createHydrationEngine,
  getDefaultHydrationEngine,
  selectActiveExtensionId,
} from '../HydrationEngine';
import type { HydrationEngine, ScopedStateInput, ShellStorage } from '../HydrationEngine';
import type { ShellUXErrorCode } from '../../types';
import { PANE_IDS, ShellUXError } from '../../types';

/**
 * ============================================================================
 * THE HYDRATION ENGINE UNDER A HOSTILE STORAGE ENTRY
 * ============================================================================
 * Persisted state is user-writable through devtools, so every case below treats
 * the stored text the way `validation.test.ts` treats a plug-in blueprint: as
 * something written by somebody trying to break the host, not by the host.
 *
 * Three groups of claim are pinned here and cited from prose elsewhere:
 *
 *  - **Discards, one per path.** Every way a payload can be refused has its own
 *    `HydrationOutcome`, so "an unknown version is handled by an explicit path"
 *    is checkable rather than inferable from the state being default.
 *  - **Degradation, never a crash.** Storage that throws on access, on read or
 *    on write leaves a fully working engine behind.
 *  - **What the namespace does and does not buy.** Collision-resistance is
 *    asserted; the absence of confinement is REPRODUCED, in the same spirit as
 *    `reflection.test.tsx`, so no reader mistakes one for the other.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Harnesses                                                                   */
/* -------------------------------------------------------------------------- */

interface StorageHarness {
  readonly storage: ShellStorage;
  readonly entries: Map<string, string>;
  setCalls: number;
  /** Non-null makes the next and every later `setItem` throw this value. */
  setFailure: unknown;
  /** Non-null makes `getItem` throw this value. */
  getFailure: unknown;
}

function makeStorage(seed?: string): StorageHarness {
  const entries = new Map<string, string>();
  if (seed !== undefined) {
    entries.set(STORAGE_KEY, seed);
  }
  const harness: StorageHarness = {
    entries,
    setCalls: 0,
    setFailure: null,
    getFailure: null,
    storage: {
      getItem(key: string): string | null {
        if (harness.getFailure !== null) {
          throw harness.getFailure;
        }
        return entries.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        harness.setCalls += 1;
        if (harness.setFailure !== null) {
          throw harness.setFailure;
        }
        entries.set(key, value);
      },
    },
  };
  return harness;
}

/** A complete, legal payload of the current schema version, with overrides. */
function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes: { pane1: 20, pane2: 30, pane3: 50 },
    isPane1Collapsed: true,
    activeExtensionId: 'mail-ext',
    extensions: { 'mail-ext': { selection: 'msg-1' } },
    ...overrides,
  });
}

/**
 * A payload whose `extensions` index is supplied as raw JSON TEXT.
 *
 * `payload` above cannot express the case that matters most here. In a JavaScript
 * object literal `__proto__:` sets the prototype rather than creating an own
 * property, so `JSON.stringify` never emits it and a fixture written that way
 * tests nothing — which is exactly what happened, and is why this helper exists.
 * `JSON.parse`, by contrast, DOES create `__proto__` as an ordinary own property,
 * so a hand-edited storage entry really can carry one.
 */
function payloadWithRawExtensions(extensionsJson: string): string {
  return (
    `{"v":${SCHEMA_VERSION},"paneSizes":{"pane1":20,"pane2":30,"pane3":50},` +
    `"isPane1Collapsed":true,"activeExtensionId":null,"extensions":${extensionsJson}}`
  );
}

/** Run `fn`, require a `ShellUXError` with `code`, and return it. */
function expectRejection(fn: () => void, code: ShellUXErrorCode): ShellUXError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ShellUXError);
    const rejection = error as ShellUXError;
    expect(rejection.code).toBe(code);
    return rejection;
  }
  return expect.fail(`expected a ShellUXError with code ${code}, but nothing was thrown`);
}

/** `depth` nested records, for the recursion-bound cases. */
function deepObject(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: 1 };
  for (let level = 0; level < depth; level += 1) {
    node = { nested: node };
  }
  return node;
}

/** An engine over a storage that is deliberately absent. */
function memoryEngine(): HydrationEngine {
  return createHydrationEngine({ storage: null });
}

/* -------------------------------------------------------------------------- */

describe('createHydrationEngine — an empty start', () => {
  it('starts from the documented defaults when nothing is stored', () => {
    const engine = createHydrationEngine({ storage: makeStorage().storage });
    expect(engine.getLastLoad()).toBe('absent');
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
    expect(engine.listExtensionIds()).toEqual([]);
    expect(engine.isPersistent()).toBe(true);
  });

  it('starts from the defaults with no storage at all, and reports it', () => {
    const engine = memoryEngine();
    expect(engine.getLastLoad()).toBe('absent');
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
    expect(engine.isPersistent()).toBe(false);
  });

  it('covers exactly the pane ids the host declares', () => {
    // The pane keys are derived from `DEFAULT_SHELL_STATE.paneSizes`, whose type
    // pins them to `PaneId`. This asserts the runtime sets agree too, so a pane
    // added to the union in `types.ts` cannot silently go unpersisted.
    expect(new Set(Object.keys(DEFAULT_SHELL_STATE.paneSizes))).toEqual(PANE_IDS);
  });

  it('hands out an empty scope constant that is frozen and has no prototype', () => {
    expect(Object.isFrozen(EMPTY_SCOPED_STATE)).toBe(true);
    expect(Object.getPrototypeOf(EMPTY_SCOPED_STATE)).toBeNull();
  });
});

describe('createHydrationEngine — restoring a well-formed record', () => {
  it('restores every slot and every scope on construction, synchronously', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload()).storage });
    expect(engine.getLastLoad()).toBe('restored');
    expect(engine.getState()).toEqual({
      paneSizes: { pane1: 20, pane2: 30, pane3: 50 },
      isPane1Collapsed: true,
      activeExtensionId: 'mail-ext',
    });
    expect(engine.getExtensionState('mail-ext')).toEqual({ selection: 'msg-1' });
    expect(engine.listExtensionIds()).toEqual(['mail-ext']);
  });

  it('restores a null active extension id, which is a legal value and not an absence', () => {
    const engine = createHydrationEngine({
      storage: makeStorage(payload({ activeExtensionId: null })).storage,
    });
    expect(engine.getLastLoad()).toBe('restored');
    expect(engine.getState().activeExtensionId).toBeNull();
  });

  it('hands out a frozen scoped record with a null prototype', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload()).storage });
    const scoped = engine.getExtensionState('mail-ext');
    expect(Object.isFrozen(scoped)).toBe(true);
    // Structural, not filtered: a `__proto__` key here could not reach
    // `Object.prototype` even if `RESERVED_IDS` were removed, because there is no
    // prototype chain to reach. The filter is the second layer.
    expect(Object.getPrototypeOf(scoped)).toBeNull();
  });

  it('returns undefined for an extension that has persisted nothing', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload()).storage });
    expect(engine.getExtensionState('crm-ext')).toBeUndefined();
  });

  it('keeps a stable state identity until something actually changes', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload()).storage });
    const first = engine.getState();
    expect(engine.getState()).toBe(first);
    engine.setSlot('isPane1Collapsed', true); // already true
    expect(engine.getState()).toBe(first);
    engine.setSlot('isPane1Collapsed', false);
    expect(engine.getState()).not.toBe(first);
  });
});

describe('createHydrationEngine — a payload that is refused, one path at a time', () => {
  const discards: readonly [string, string, string][] = [
    ['corrupt JSON', '{ this is not json', 'unparsable'],
    ['truncated JSON', '{"v":1,"paneSizes":{"pane1":20', 'unparsable'],
    ['valid JSON of the wrong shape — an array', '[]', 'malformed'],
    ['valid JSON of the wrong shape — a bare null', 'null', 'malformed'],
    ['valid JSON of the wrong shape — a bare string', '"restored"', 'malformed'],
    ['valid JSON of the wrong shape — a bare number', '42', 'malformed'],
  ];

  it.each(discards)('discards %s', (_label, raw, outcome) => {
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe(outcome);
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
    expect(engine.listExtensionIds()).toEqual([]);
  });

  it('discards a payload from an older schema version', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload({ v: 0 })).storage });
    expect(engine.getLastLoad()).toBe('unsupported-version');
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
  });

  it('discards a payload from a FUTURE schema version, rather than guessing at it', () => {
    // The user downgraded the app. The newer record may mean anything at all;
    // the only safe reading of it is not to read it.
    const engine = createHydrationEngine({
      storage: makeStorage(payload({ v: SCHEMA_VERSION + 1 })).storage,
    });
    expect(engine.getLastLoad()).toBe('unsupported-version');
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
  });

  it('discards a payload with no version at all', () => {
    const raw = JSON.stringify({ paneSizes: { pane1: 20, pane2: 30, pane3: 50 } });
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('unsupported-version');
  });

  it('discards a version of the wrong type, so "1" is not 1', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload({ v: '1' })).storage });
    expect(engine.getLastLoad()).toBe('unsupported-version');
  });

  it('discards an entry longer than MAX_RAW_LENGTH without even parsing it', () => {
    const parse = vi.spyOn(JSON, 'parse');
    const enormous = `"${'a'.repeat(HYDRATION_LIMITS.MAX_RAW_LENGTH + 1)}"`;
    const engine = createHydrationEngine({ storage: makeStorage(enormous).storage });
    expect(engine.getLastLoad()).toBe('oversized');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('discards what a storage returns that is not a string', () => {
    const harness = makeStorage();
    const lying: ShellStorage = {
      getItem: (): string => 42 as unknown as string,
      setItem: harness.storage.setItem,
    };
    const engine = createHydrationEngine({ storage: lying });
    expect(engine.getLastLoad()).toBe('malformed');
  });

  const malformedFields: readonly [string, Record<string, unknown>][] = [
    ['a missing paneSizes field', { paneSizes: undefined }],
    ['paneSizes that is not an object', { paneSizes: 'wide' }],
    ['paneSizes that is null', { paneSizes: null }],
    ['paneSizes that is an array', { paneSizes: [20, 30, 50] }],
    ['a pane size that is not a number', { paneSizes: { pane1: '20', pane2: 30, pane3: 50 } }],
    ['a missing pane', { paneSizes: { pane1: 20, pane2: 30 } }],
    ['a pane size below the legal band', { paneSizes: { pane1: 0, pane2: 30, pane3: 50 } }],
    ['a pane size above the legal band', { paneSizes: { pane1: 95, pane2: 30, pane3: 50 } }],
    ['a collapsed flag that is not a boolean', { isPane1Collapsed: 'true' }],
    ['a missing collapsed flag', { isPane1Collapsed: undefined }],
    ['an active extension id that is not a string', { activeExtensionId: 7 }],
    ['an active extension id that fails the registry pattern', { activeExtensionId: 'Mail Ext' }],
    ['an active extension id that is a reserved word', { activeExtensionId: 'constructor' }],
    ['a missing active extension id', { activeExtensionId: undefined }],
    ['an extensions index that is not an object', { extensions: 'none' }],
    ['an extensions index that is an array', { extensions: [] }],
    ['a missing extensions index', { extensions: undefined }],
    ['an extension scope that is not an object', { extensions: { 'mail-ext': 3 } }],
    ['an extension scope that is null', { extensions: { 'mail-ext': null } }],
    ['an extension scope that is an array', { extensions: { 'mail-ext': [] } }],
  ];

  it.each(malformedFields)('discards a record with %s', (_label, overrides) => {
    // `JSON.stringify` drops an `undefined` field, which is exactly how the
    // "missing field" cases above are expressed.
    const engine = createHydrationEngine({ storage: makeStorage(payload(overrides)).storage });
    expect(engine.getLastLoad()).toBe('malformed');
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
  });

  it('discards a pane size JSON can express but a JavaScript number cannot hold', () => {
    // `1e400` is legal JSON text and parses to `Infinity`, which is a value no
    // amount of `JSON.stringify` could ever have written. It reaches the
    // validator as a number, so only the finiteness check refuses it.
    const raw =
      `{"v":${SCHEMA_VERSION},"paneSizes":{"pane1":20,"pane2":30,"pane3":1e400},` +
      `"isPane1Collapsed":true,"activeExtensionId":null,"extensions":{}}`;
    const parsed = JSON.parse(raw) as { paneSizes: { pane3: number } };
    expect(parsed.paneSizes.pane3).toBe(Number.POSITIVE_INFINITY);

    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
  });

  it('applies none of a payload whose LATER field is illegal', () => {
    // The pane sizes are perfectly legal and are still not applied: a record is
    // restored whole or not at all, which is what "never blindly spread into live
    // state" means when only part of the payload is wrong.
    const engine = createHydrationEngine({
      storage: makeStorage(
        payload({ paneSizes: { pane1: 40, pane2: 30, pane3: 30 }, isPane1Collapsed: 'yes' }),
      ).storage,
    });
    expect(engine.getLastLoad()).toBe('malformed');
    expect(engine.getState().paneSizes).toEqual(DEFAULT_SHELL_STATE.paneSizes);
  });
});

describe('createHydrationEngine — hostile payloads', () => {
  afterEach(() => {
    // Nothing here may leave a mark on the object graph, whatever it did.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('refuses a __proto__ extension id and leaves Object.prototype untouched', () => {
    const raw = payloadWithRawExtensions('{"__proto__":{"polluted":true}}');
    // The premise of the case, asserted rather than assumed: the parsed payload
    // really does carry `__proto__` as an own key for the validator to refuse.
    expect(Object.hasOwn(JSON.parse(raw) as { extensions: object }, 'extensions')).toBe(true);
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('refuses a __proto__ key inside an extension scope', () => {
    const raw = payloadWithRawExtensions('{"mail-ext":{"__proto__":{"polluted":true}}}');
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('refuses a constructor key inside an extension scope', () => {
    const raw = payload({ extensions: { 'mail-ext': { constructor: 'x' } } });
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
  });

  it('refuses an enormous string inside an otherwise legal scope', () => {
    const raw = payload({
      extensions: {
        'mail-ext': { note: 'a'.repeat(HYDRATION_LIMITS.MAX_STRING_LENGTH + 1) },
      },
    });
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
  });

  it('refuses a deeply nested payload rather than following it', () => {
    const raw = payload({
      extensions: { 'mail-ext': deepObject(HYDRATION_LIMITS.MAX_DEPTH + 4) },
    });
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
  });

  it('refuses more extension scopes than MAX_EXTENSIONS', () => {
    const extensions: Record<string, unknown> = {};
    for (let index = 0; index <= HYDRATION_LIMITS.MAX_EXTENSIONS; index += 1) {
      extensions[`ext-${index}`] = {};
    }
    const engine = createHydrationEngine({ storage: makeStorage(payload({ extensions })).storage });
    expect(engine.getLastLoad()).toBe('malformed');
  });

  it('refuses an extension id that fails the registry pattern', () => {
    const raw = payload({ extensions: { 'Mail Ext': {} } });
    const engine = createHydrationEngine({ storage: makeStorage(raw).storage });
    expect(engine.getLastLoad()).toBe('malformed');
  });
});

describe('setSlot — the write door is a trust boundary too', () => {
  it('writes and reads back every slot', () => {
    const engine = memoryEngine();
    engine.setSlot('paneSizes', { pane1: 25, pane2: 35, pane3: 40 });
    engine.setSlot('isPane1Collapsed', true);
    engine.setSlot('activeExtensionId', 'crm-ext');
    expect(engine.getState()).toEqual({
      paneSizes: { pane1: 25, pane2: 35, pane3: 40 },
      isPane1Collapsed: true,
      activeExtensionId: 'crm-ext',
    });
  });

  it('stores a host-owned copy, so mutating the argument afterwards changes nothing', () => {
    const engine = memoryEngine();
    const sizes = { pane1: 25, pane2: 35, pane3: 40 };
    engine.setSlot('paneSizes', sizes);
    sizes.pane1 = 89;
    expect(engine.getState().paneSizes.pane1).toBe(25);
    expect(Object.isFrozen(engine.getState().paneSizes)).toBe(true);
  });

  it('normalises undefined to null for the active extension id', () => {
    const engine = memoryEngine();
    engine.setSlot('activeExtensionId', 'crm-ext');
    engine.setSlot('activeExtensionId', undefined as unknown as string | null);
    expect(engine.getState().activeExtensionId).toBeNull();
  });

  it('rejects a slot name it does not know', () => {
    const engine = memoryEngine();
    const rejection = expectRejection(
      () => {
        engine.setSlot('paneSizesss' as 'paneSizes', DEFAULT_SHELL_STATE.paneSizes);
      },
      'INVALID_FIELD',
    );
    expect(rejection.field).toBe('slot');
  });

  it('rejects a slot name that is not a string, without stringifying it', () => {
    const engine = memoryEngine();
    const rejection = expectRejection(
      () => {
        engine.setSlot(Symbol('slot') as unknown as 'paneSizes', true as never);
      },
      'INVALID_FIELD',
    );
    expect(rejection.message).toContain('a value of type "symbol"');
  });

  const badSlotValues: readonly [string, 'paneSizes' | 'isPane1Collapsed' | 'activeExtensionId', unknown, ShellUXErrorCode][] =
    [
      ['pane sizes that are not an object', 'paneSizes', 'wide', 'INVALID_FIELD'],
      ['pane sizes that are null', 'paneSizes', null, 'INVALID_FIELD'],
      ['pane sizes that are a Date', 'paneSizes', new Date(), 'INVALID_FIELD'],
      ['a NaN pane size', 'paneSizes', { pane1: Number.NaN, pane2: 30, pane3: 50 }, 'INVALID_FIELD'],
      [
        'an Infinity pane size',
        'paneSizes',
        { pane1: Number.POSITIVE_INFINITY, pane2: 30, pane3: 50 },
        'INVALID_FIELD',
      ],
      ['a pane size below the band', 'paneSizes', { pane1: 1, pane2: 30, pane3: 50 }, 'INVALID_FIELD'],
      ['a pane size above the band', 'paneSizes', { pane1: 91, pane2: 30, pane3: 50 }, 'INVALID_FIELD'],
      ['a collapsed flag that is a string', 'isPane1Collapsed', 'true', 'INVALID_FIELD'],
      ['an active id that is a number', 'activeExtensionId', 7, 'INVALID_ID'],
      ['an active id with a space in it', 'activeExtensionId', 'mail ext', 'INVALID_ID'],
      ['an active id that is reserved', 'activeExtensionId', 'prototype', 'INVALID_ID'],
    ];

  it.each(badSlotValues)('rejects %s', (_label, slot, value, code) => {
    const engine = memoryEngine();
    const before = engine.getState();
    expectRejection(() => {
      engine.setSlot(slot, value as never);
    }, code);
    expect(engine.getState()).toBe(before);
  });
});

describe('setExtensionState — one extension scope at a time', () => {
  it('writes and reads back a scope, as a host-owned frozen copy', () => {
    const engine = memoryEngine();
    const state: Record<string, unknown> = { selection: 'row-3', expanded: ['a', 'b'] };
    engine.setExtensionState('mail-ext', state);
    state['selection'] = 'row-9';
    expect(engine.getExtensionState('mail-ext')).toEqual({
      selection: 'row-3',
      expanded: ['a', 'b'],
    });
  });

  it('accepts every JSON-shaped value, nested', () => {
    const engine = memoryEngine();
    engine.setExtensionState('mail-ext', {
      text: 'x',
      count: 3,
      flag: false,
      nothing: null,
      list: [1, 'two', true, null, [], {}],
      nested: deepObject(3),
    });
    const scoped = engine.getExtensionState('mail-ext');
    expect(scoped).toBeDefined();
    expect(scoped?.['count']).toBe(3);
    expect(scoped?.['list']).toEqual([1, 'two', true, null, [], {}]);
  });

  it('normalises an undefined value to null, because JSON drops the key otherwise', () => {
    const engine = memoryEngine();
    engine.setExtensionState('mail-ext', { selection: undefined });
    expect(engine.getExtensionState('mail-ext')).toEqual({ selection: null });
  });

  it('normalises -0 to 0, because that is what comes back', () => {
    const engine = memoryEngine();
    engine.setExtensionState('mail-ext', { offset: -0 });
    expect(Object.is(engine.getExtensionState('mail-ext')?.['offset'], 0)).toBe(true);
  });

  it('drops a symbol key silently, because JSON.stringify does too', () => {
    const engine = memoryEngine();
    const state: Record<string | symbol, unknown> = { kept: 1 };
    state[Symbol('dropped')] = 2;
    engine.setExtensionState('mail-ext', state as ScopedStateInput);
    expect(engine.getExtensionState('mail-ext')).toEqual({ kept: 1 });
  });

  const roundTripFailures: readonly [string, unknown, ShellUXErrorCode][] = [
    ['NaN', Number.NaN, 'INVALID_FIELD'],
    ['Infinity', Number.POSITIVE_INFINITY, 'INVALID_FIELD'],
    ['-Infinity', Number.NEGATIVE_INFINITY, 'INVALID_FIELD'],
    ['a Date', new Date(0), 'INVALID_FIELD'],
    ['a Map', new Map([['a', 1]]), 'INVALID_FIELD'],
    ['a Set', new Set([1]), 'INVALID_FIELD'],
    ['a RegExp', /x/, 'INVALID_FIELD'],
    ['a function', (): void => undefined, 'INVALID_FIELD'],
    ['a symbol', Symbol('s'), 'INVALID_FIELD'],
    ['a bigint', BigInt(1), 'INVALID_FIELD'],
  ];

  it.each(roundTripFailures)('refuses %s, which would not survive the round trip', (_label, value, code) => {
    const engine = memoryEngine();
    expectRejection(() => {
      engine.setExtensionState('mail-ext', { field: value } as ScopedStateInput);
    }, code);
    expect(engine.getExtensionState('mail-ext')).toBeUndefined();
  });

  it('refuses a scope that is not a plain object', () => {
    const engine = memoryEngine();
    expectRejection(() => {
      engine.setExtensionState('mail-ext', 'state' as unknown as ScopedStateInput);
    }, 'INVALID_PAYLOAD');
    expectRejection(() => {
      engine.setExtensionState('mail-ext', null as unknown as ScopedStateInput);
    }, 'INVALID_PAYLOAD');
    expectRejection(() => {
      engine.setExtensionState('mail-ext', new Date() as unknown as ScopedStateInput);
    }, 'INVALID_PAYLOAD');
  });

  it('accepts a scope built with no prototype at all', () => {
    const engine = memoryEngine();
    const bare = Object.create(null) as Record<string, unknown>;
    bare['selection'] = 'row-1';
    engine.setExtensionState('mail-ext', bare);
    expect(engine.getExtensionState('mail-ext')).toEqual({ selection: 'row-1' });
  });

  const badIds: readonly [string, unknown][] = [
    ['a number', 7],
    ['a space', 'mail ext'],
    ['a path separator', 'mail/ext'],
    ['a reserved word', 'constructor'],
    ['the empty string', ''],
    ['__proto__', '__proto__'],
  ];

  it.each(badIds)('refuses %s as an extension id, at every door', (_label, id) => {
    const engine = memoryEngine();
    expectRejection(() => {
      engine.setExtensionState(id as string, {});
    }, 'INVALID_ID');
    expectRejection(() => {
      engine.getExtensionState(id as string);
    }, 'INVALID_ID');
    expectRejection(() => {
      engine.forgetExtension(id as string);
    }, 'INVALID_ID');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('refuses a key that is empty, over-long, or reserved', () => {
    const engine = memoryEngine();
    expectRejection(() => {
      engine.setExtensionState('mail-ext', { '': 1 });
    }, 'INVALID_FIELD');
    expectRejection(() => {
      engine.setExtensionState('mail-ext', {
        ['k'.repeat(HYDRATION_LIMITS.MAX_KEY_LENGTH + 1)]: 1,
      });
    }, 'PAYLOAD_TOO_LARGE');
    expectRejection(() => {
      engine.setExtensionState('mail-ext', { constructor: 1 });
    }, 'RESERVED_ID');
  });

  it('refuses more keys than MAX_KEYS, more items than MAX_ITEMS, and a longer string', () => {
    const engine = memoryEngine();
    const wide: Record<string, unknown> = {};
    for (let index = 0; index <= HYDRATION_LIMITS.MAX_KEYS; index += 1) {
      wide[`k${index}`] = index;
    }
    expectRejection(() => {
      engine.setExtensionState('mail-ext', wide);
    }, 'PAYLOAD_TOO_LARGE');
    expectRejection(() => {
      engine.setExtensionState('mail-ext', {
        list: new Array<number>(HYDRATION_LIMITS.MAX_ITEMS + 1).fill(0),
      });
    }, 'PAYLOAD_TOO_LARGE');
    expectRejection(() => {
      engine.setExtensionState('mail-ext', {
        note: 'a'.repeat(HYDRATION_LIMITS.MAX_STRING_LENGTH + 1),
      });
    }, 'PAYLOAD_TOO_LARGE');
  });

  it('refuses a deeply nested value with a typed error rather than a RangeError', () => {
    // A hundred thousand levels: a recursive validator with no depth cap answers
    // this with a blown stack, at a frame that names nothing useful. The walk
    // refuses at MAX_DEPTH and never reaches the deep part.
    const engine = memoryEngine();
    const rejection = expectRejection(() => {
      engine.setExtensionState('mail-ext', { deep: deepObject(100_000) });
    }, 'PAYLOAD_TOO_LARGE');
    expect(rejection.message).toContain('nests deeper');
  });

  it('refuses a payload with more values than MAX_NODES, however it is shaped', () => {
    const engine = memoryEngine();
    const many: Record<string, unknown> = {};
    for (let index = 0; index < 3; index += 1) {
      many[`list${index}`] = new Array<number>(HYDRATION_LIMITS.MAX_ITEMS).fill(1);
    }
    const rejection = expectRejection(() => {
      engine.setExtensionState('mail-ext', many);
    }, 'PAYLOAD_TOO_LARGE');
    expect(rejection.message).toContain('values in one extension');
  });

  it('refuses a record whose value getter throws, as a typed rejection', () => {
    const engine = memoryEngine();
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'selection', {
      enumerable: true,
      get(): never {
        throw new Error('read refused');
      },
    });
    const rejection = expectRejection(() => {
      engine.setExtensionState('mail-ext', hostile);
    }, 'INVALID_PAYLOAD');
    expect(rejection.field).toBe('extensions.mail-ext.selection');
  });

  it('refuses a record that will not list its keys', () => {
    const engine = memoryEngine();
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('listing refused');
        },
      },
    );
    expectRejection(() => {
      engine.setExtensionState('mail-ext', hostile);
    }, 'INVALID_PAYLOAD');
  });

  it('refuses a value that refuses to be classified at all', () => {
    const engine = memoryEngine();
    const { proxy, revoke } = Proxy.revocable<Record<string, unknown>>({}, {});
    revoke();
    const rejection = expectRejection(() => {
      engine.setExtensionState('mail-ext', { field: proxy });
    }, 'INVALID_PAYLOAD');
    expect(rejection.message).toContain('refused to be inspected');
  });

  it('refuses an array whose length getter throws', () => {
    const engine = memoryEngine();
    const hostile = new Proxy([1, 2], {
      get(target, property, receiver): unknown {
        if (property === 'length') {
          throw new Error('length refused');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expectRejection(() => {
      engine.setExtensionState('mail-ext', { list: hostile });
    }, 'INVALID_PAYLOAD');
  });

  it('refuses an array whose length is not a non-negative integer', () => {
    const engine = memoryEngine();
    const lengths: readonly unknown[] = ['many', -1];
    for (const reported of lengths) {
      const hostile = new Proxy([1, 2], {
        get(target, property, receiver): unknown {
          if (property === 'length') {
            return reported;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      expectRejection(() => {
        engine.setExtensionState('mail-ext', { list: hostile });
      }, 'INVALID_FIELD');
    }
  });

  it('refuses an array whose item getter throws', () => {
    const engine = memoryEngine();
    const hostile = new Proxy([1, 2], {
      get(target, property, receiver): unknown {
        if (property === '0') {
          throw new Error('item refused');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const rejection = expectRejection(() => {
      engine.setExtensionState('mail-ext', { list: hostile });
    }, 'INVALID_PAYLOAD');
    expect(rejection.field).toBe('extensions.mail-ext.list[0]');
  });

  it('reads a lying length ONCE, so the payload cannot grow after it is measured', () => {
    const engine = memoryEngine();
    const lengths = [2, 5, 5];
    let reads = 0;
    const hostile = new Proxy([1, 2, 3, 4, 5], {
      get(target, property, receiver): unknown {
        if (property === 'length') {
          const value = lengths[Math.min(reads, lengths.length - 1)];
          reads += 1;
          return value;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    engine.setExtensionState('mail-ext', { list: hostile });
    expect(engine.getExtensionState('mail-ext')?.['list']).toEqual([1, 2]);
  });

  it('refuses one more extension scope than MAX_EXTENSIONS', () => {
    const engine = memoryEngine();
    for (let index = 0; index < HYDRATION_LIMITS.MAX_EXTENSIONS; index += 1) {
      engine.setExtensionState(`ext-${index}`, { n: index });
    }
    expectRejection(() => {
      engine.setExtensionState('one-too-many', {});
    }, 'PAYLOAD_TOO_LARGE');
    expect(engine.listExtensionIds()).toHaveLength(HYDRATION_LIMITS.MAX_EXTENSIONS);
  });

  it('refuses a record that would push the whole payload past MAX_RAW_LENGTH', () => {
    const engine = memoryEngine();
    const bulky: Record<string, unknown> = {};
    for (let index = 0; index < 32; index += 1) {
      bulky[`k${index}`] = 'a'.repeat(HYDRATION_LIMITS.MAX_STRING_LENGTH);
    }
    const rejection = expectRejection(() => {
      engine.setExtensionState('mail-ext', bulky);
    }, 'PAYLOAD_TOO_LARGE');
    expect(rejection.message).toContain('Nothing was applied');
    expect(engine.getExtensionState('mail-ext')).toBeUndefined();
  });

  it('forgets a scope, and says so when there was nothing to forget', () => {
    const engine = memoryEngine();
    engine.setExtensionState('mail-ext', { selection: 'a' });
    expect(engine.forgetExtension('crm-ext')).toBe(false);
    expect(engine.forgetExtension('mail-ext')).toBe(true);
    expect(engine.getExtensionState('mail-ext')).toBeUndefined();
  });
});

describe('the namespace — collision-resistance, and the confinement it does not deliver', () => {
  it('keeps two extensions that both use the key "selection" apart', () => {
    const engine = memoryEngine();
    engine.setExtensionState('mail-ext', { selection: 'msg-1' });
    engine.setExtensionState('crm-ext', { selection: 'contact-9' });
    expect(engine.getExtensionState('mail-ext')).toEqual({ selection: 'msg-1' });
    expect(engine.getExtensionState('crm-ext')).toEqual({ selection: 'contact-9' });
  });

  it('lets any caller name any scope, so the namespace confines nothing', () => {
    // The scope is an ARGUMENT here, not a value closed over by a per-extension
    // facade — `IShellAPI` has no persistence member and this engine is
    // host-side. One holder writing as two extensions is the ordinary API.
    const engine = memoryEngine();
    engine.setExtensionState('mail-ext', { selection: 'msg-1' });
    engine.setExtensionState('crm-ext', { selection: 'stolen' });
    engine.setExtensionState('mail-ext', { selection: 'overwritten-by-the-same-caller' });
    expect(engine.getExtensionState('mail-ext')).toEqual({
      selection: 'overwritten-by-the-same-caller',
    });
  });

  it("reads and rewrites another extension's scope straight through the storage entry", () => {
    // No engine API is used for the tampering: this is what any script in the
    // page can do to the one `localStorage` entry, which is why nothing
    // confidential belongs in persisted UI state.
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    engine.setExtensionState('mail-ext', { selection: 'msg-1' });
    engine.flush();

    const raw = harness.entries.get(STORAGE_KEY);
    expect(raw).toBeDefined();
    const record = JSON.parse(raw as string) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    // Read: another extension's persisted state is plainly legible.
    expect(record.extensions['mail-ext']?.['selection']).toBe('msg-1');
    // Clobber: and plainly writable.
    record.extensions['mail-ext'] = { selection: 'rewritten-by-a-sibling' };
    harness.storage.setItem(STORAGE_KEY, JSON.stringify(record));

    const reloaded = createHydrationEngine({ storage: harness.storage });
    expect(reloaded.getExtensionState('mail-ext')).toEqual({
      selection: 'rewritten-by-a-sibling',
    });
  });
});

describe('an extension the registry no longer knows', () => {
  it('refuses an active extension id the registry no longer knows', () => {
    const engine = createHydrationEngine({ storage: makeStorage(payload()).storage });
    expect(selectActiveExtensionId(engine.getState(), new Set(['crm-ext']))).toBeNull();
    expect(selectActiveExtensionId(engine.getState(), new Set(['mail-ext']))).toBe('mail-ext');
  });

  it('answers null when nothing was active, whatever is registered', () => {
    expect(selectActiveExtensionId(DEFAULT_SHELL_STATE, new Set(['mail-ext']))).toBeNull();
  });

  it('retains the scope of an extension that is not registered, so a lazily loaded one gets its state back', () => {
    // Pruning on load cannot tell "uninstalled" from "not loaded yet", and
    // getting that wrong costs the user the layout of every extension they have
    // not opened this session.
    const engine = createHydrationEngine({
      storage: makeStorage(payload({ extensions: { 'not-loaded-yet': { selection: 'x' } } }))
        .storage,
    });
    expect(engine.listExtensionIds()).toEqual(['not-loaded-yet']);
    expect(engine.getExtensionState('not-loaded-yet')).toEqual({ selection: 'x' });
  });
});

describe('writes are debounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a whole drag into one write', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    // Sixty frames of a divider drag.
    for (let frame = 0; frame < 60; frame += 1) {
      engine.setSlot('paneSizes', { pane1: 20 + frame * 0.5, pane2: 30, pane3: 40 });
    }
    expect(harness.setCalls).toBe(0);

    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    expect(harness.setCalls).toBe(1);

    const written = JSON.parse(harness.entries.get(STORAGE_KEY) as string) as {
      paneSizes: { pane1: number };
    };
    expect(written.paneSizes.pane1).toBe(20 + 59 * 0.5);
  });

  it('honours a custom window', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage, debounceMs: 500 });
    engine.setSlot('isPane1Collapsed', true);
    vi.advanceTimersByTime(499);
    expect(harness.setCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(harness.setCalls).toBe(1);
  });

  it('writes immediately on flush, and cancels the pending window', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    engine.setSlot('isPane1Collapsed', true);
    engine.flush();
    expect(harness.setCalls).toBe(1);
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    expect(harness.setCalls).toBe(1);
  });

  it('flushes nothing when nothing is pending', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    engine.flush();
    engine.flush();
    expect(harness.setCalls).toBe(0);
  });

  it('does not schedule a write for a change that changed nothing', () => {
    const harness = makeStorage(payload());
    const engine = createHydrationEngine({ storage: harness.storage });
    engine.setSlot('isPane1Collapsed', true); // already true
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    expect(harness.setCalls).toBe(0);
  });

  it('schedules nothing at all when there is no storage', () => {
    const engine = memoryEngine();
    engine.setSlot('isPane1Collapsed', true);
    // Nothing to assert against a call count; what matters is that advancing the
    // clock and flushing are both no-ops rather than a crash.
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    engine.flush();
    expect(engine.getState().isPane1Collapsed).toBe(true);
  });

  it('flushes and releases on dispose', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.setSlot('isPane1Collapsed', true);
    engine.dispose();
    expect(harness.setCalls).toBe(1);

    engine.setSlot('activeExtensionId', 'mail-ext');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('storage that fails', () => {
  it('degrades to memory when reading throws, and reports it', () => {
    const harness = makeStorage(payload());
    harness.getFailure = new Error('SecurityError');
    const engine = createHydrationEngine({ storage: harness.storage });
    expect(engine.getLastLoad()).toBe('unreadable');
    expect(engine.isPersistent()).toBe(false);
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
    // And it is still a working engine.
    engine.setSlot('isPane1Collapsed', true);
    expect(engine.getState().isPane1Collapsed).toBe(true);
  });

  it('runs with persistence degraded to memory, and nothing throws', () => {
    const engine = memoryEngine();
    expect(() => {
      engine.setSlot('isPane1Collapsed', true);
      engine.setExtensionState('mail-ext', { selection: 'msg-1' });
      engine.flush();
      engine.dispose();
    }).not.toThrow();
    expect(engine.getState().isPane1Collapsed).toBe(true);
    expect(engine.getExtensionState('mail-ext')).toEqual({ selection: 'msg-1' });
    expect(engine.isPersistent()).toBe(false);
  });

  it('a write that fails on quota leaves the previous record exactly as it was', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    engine.setSlot('isPane1Collapsed', true);
    engine.flush();
    const beforeQuota = harness.entries.get(STORAGE_KEY);

    harness.setFailure = new DOMException('exceeded the quota', 'QuotaExceededError');
    expect(() => {
      engine.setSlot('activeExtensionId', 'mail-ext');
      engine.flush();
    }).not.toThrow();

    // One key, one `setItem`: the entry is either the old record or the new one,
    // and a half-written record is not constructible.
    expect(harness.entries.get(STORAGE_KEY)).toBe(beforeQuota);
    expect(engine.isPersistent()).toBe(false);
    // The state itself is intact in memory.
    expect(engine.getState().activeExtensionId).toBe('mail-ext');
  });

  it('retries the pending record on the next flush, so a transient failure recovers', () => {
    const harness = makeStorage();
    const engine = createHydrationEngine({ storage: harness.storage });
    harness.setFailure = new Error('quota');
    engine.setSlot('activeExtensionId', 'mail-ext');
    engine.flush();
    expect(engine.isPersistent()).toBe(false);

    harness.setFailure = null;
    engine.flush();
    expect(engine.isPersistent()).toBe(true);
    const written = JSON.parse(harness.entries.get(STORAGE_KEY) as string) as {
      activeExtensionId: string;
    };
    expect(written.activeExtensionId).toBe('mail-ext');
  });
});

describe('two tabs over one storage entry', () => {
  it("the loser's whole record is replaced, never interleaved with the winner's", () => {
    const harness = makeStorage();
    const tabA = createHydrationEngine({ storage: harness.storage });
    const tabB = createHydrationEngine({ storage: harness.storage });

    tabA.setSlot('paneSizes', { pane1: 40, pane2: 30, pane3: 30 });
    tabA.setExtensionState('mail-ext', { selection: 'from-tab-a' });
    tabA.flush();

    tabB.setSlot('activeExtensionId', 'crm-ext');
    tabB.flush();

    // Last write wins, and the unit of that is the WHOLE record.
    const reloaded = createHydrationEngine({ storage: harness.storage });
    expect(reloaded.getLastLoad()).toBe('restored');
    expect(reloaded.getState()).toEqual({
      paneSizes: DEFAULT_SHELL_STATE.paneSizes,
      isPane1Collapsed: false,
      activeExtensionId: 'crm-ext',
    });
    // Tab A's scope went with tab A's record. That is a lost write, which is what
    // last-write-wins means; what it is NOT is tab A's pane sizes sitting beside
    // tab B's active extension in a record neither tab ever held.
    expect(reloaded.listExtensionIds()).toEqual([]);
  });

  it('interleaving the two tabs still produces one complete record', () => {
    const harness = makeStorage();
    const tabA = createHydrationEngine({ storage: harness.storage });
    const tabB = createHydrationEngine({ storage: harness.storage });

    for (let round = 0; round < 5; round += 1) {
      tabA.setSlot('paneSizes', { pane1: 20 + round, pane2: 30, pane3: 40 });
      tabA.flush();
      tabB.setSlot('isPane1Collapsed', round % 2 === 0);
      tabB.flush();
    }

    const reloaded = createHydrationEngine({ storage: harness.storage });
    expect(reloaded.getLastLoad()).toBe('restored');
    expect(reloaded.getState()).toEqual(tabB.getState());
  });
});

describe('subscribers', () => {
  it('notifies on a real change and not on a no-op', () => {
    const engine = memoryEngine();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);

    engine.setSlot('isPane1Collapsed', true);
    expect(listener).toHaveBeenCalledTimes(1);
    engine.setSlot('isPane1Collapsed', true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    engine.setSlot('isPane1Collapsed', false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not call a listener that unsubscribed earlier in the same pass', () => {
    const engine = memoryEngine();
    const second = vi.fn();
    let unsubscribeSecond = (): void => undefined;
    engine.subscribe(() => {
      unsubscribeSecond();
    });
    unsubscribeSecond = engine.subscribe(second);

    engine.setSlot('isPane1Collapsed', true);
    expect(second).not.toHaveBeenCalled();
  });

  it('refuses a runaway listener cascade with a typed error, not a RangeError', () => {
    const engine = memoryEngine();
    let depth = 0;
    const unsubscribe = engine.subscribe(() => {
      depth += 1;
      engine.setSlot('activeExtensionId', `ext-${depth}`);
    });
    expectRejection(() => {
      engine.setSlot('activeExtensionId', 'ext-0');
    }, 'REENTRANT_NOTIFY');
    // And the engine is not left convinced it is mid-cascade: the depth counter
    // is restored in a `finally`, so once the runaway listener is gone an
    // ordinary write goes through.
    unsubscribe();
    expect(() => {
      engine.setSlot('isPane1Collapsed', true);
    }).not.toThrow();
  });
});

describe('the ambient localStorage', () => {
  const ownDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  function stubAmbient(get: () => unknown): void {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get });
  }

  afterEach(() => {
    if (ownDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', ownDescriptor);
    }
    globalThis.localStorage.clear();
  });

  it('uses the ambient localStorage when there is a usable one', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, payload());
    const engine = createHydrationEngine();
    expect(engine.getLastLoad()).toBe('restored');
    expect(engine.getState().activeExtensionId).toBe('mail-ext');

    engine.setSlot('activeExtensionId', 'crm-ext');
    engine.flush();
    const written = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) as string) as {
      activeExtensionId: string;
    };
    expect(written.activeExtensionId).toBe('crm-ext');
  });

  it('degrades to memory when reading localStorage throws', () => {
    // Safari with cookies blocked raises on ACCESS, not on use, which is why the
    // property is never read outside a guard and never at module scope.
    stubAmbient(() => {
      throw new DOMException('access denied', 'SecurityError');
    });
    const engine = createHydrationEngine();
    expect(engine.isPersistent()).toBe(false);
    expect(engine.getState()).toEqual(DEFAULT_SHELL_STATE);
  });

  const absentShapes: readonly [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['an object with no getItem', {}],
    ['an object with no setItem', { getItem: (): null => null }],
  ];

  it.each(absentShapes)('degrades to memory when localStorage is %s', (_label, value) => {
    stubAmbient(() => value);
    const engine = createHydrationEngine();
    expect(engine.isPersistent()).toBe(false);
    expect(() => {
      engine.setSlot('isPane1Collapsed', true);
      engine.flush();
    }).not.toThrow();
  });

  it('shares one default engine, because two would never observe each other', () => {
    expect(getDefaultHydrationEngine()).toBe(getDefaultHydrationEngine());
  });
});
