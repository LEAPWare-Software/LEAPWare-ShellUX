import { describe, expect, it } from 'vitest';
import { createShellStateStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { PANE_IDS, ShellUXError } from '../types';
import type { RibbonContext } from '../types';
import { makeUnstringifiableValue } from './fixtures';

/**
 * ============================================================================
 * patchContext IS A TRUST BOUNDARY
 * ============================================================================
 * `useShellStore()` is public by design, and a plugin view renders inside
 * `ShellHostProvider`, so plugin code can obtain the raw store and call
 * `patchContext` directly. Every value that lands in `RibbonContext` therefore
 * has to be checked here, to the same standard `setSelectedItem` and
 * `setBadgeCount` are held to — otherwise the snapshot the host hands to OTHER
 * extensions' predicates and handlers is whatever one extension chose to put in
 * it, and the declared `string | null` types are a runtime lie.
 *
 * The store used to trust this method on the grounds that it was "host-side" and
 * "not reachable from plugin code". It was reachable, and the compiler enforces
 * nothing across a plain-JavaScript plugin boundary.
 * ============================================================================
 */

/** `patchContext` as a plain-JavaScript caller sees it: no compiler in the way. */
function patchAnything(store: ShellStateStore): (patch: unknown) => void {
  return store.patchContext as (patch: unknown) => void;
}

/** Run `call`, assert it threw a `ShellUXError`, and return it. */
function expectShellUXError(call: () => void): ShellUXError {
  let caught: unknown;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  // A raw TypeError here means the failure path stringified the value it was
  // rejecting, or indexed something it had not proven to be an object.
  expect(caught).toBeInstanceOf(ShellUXError);
  return caught as ShellUXError;
}

describe('patchContext rejects what setSelectedItem rejects', () => {
  it('refuses a live object in selectedItemId, and never touches it', () => {
    const store = createShellStateStore();
    let getterRan = false;
    const injected = {
      get itemId(): string {
        getterRan = true;
        return 'msg-1';
      },
      toString(): never {
        throw new Error('arbitrary attacker code');
      },
    };

    const error = expectShellUXError(() => {
      patchAnything(store)({ selectedItemId: injected });
    });
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('selectedItemId');
    // Reported by type alone: no getter ran, no `toString` ran.
    expect(error.message).toContain('"object"');
    expect(getterRan).toBe(false);
    // And the object never became the value other extensions read.
    expect(store.getContext().selectedItemId).toBeNull();
  });

  it('refuses a value that throws from every route to a string', () => {
    const store = createShellStateStore();
    const hostile = makeUnstringifiableValue({ withToPrimitive: true });
    expect(() => String(hostile)).toThrow();

    const error = expectShellUXError(() => {
      patchAnything(store)({ selectedItemId: hostile });
    });
    expect(error.code).toBe('INVALID_FIELD');
  });

  it.each([
    ['a number', 42],
    ['a boolean', true],
    ['an array', ['msg-1']],
    ['a symbol', Symbol('msg')],
  ])('refuses %s in selectedItemId', (_label, value) => {
    const store = createShellStateStore();
    expect(expectShellUXError(() => patchAnything(store)({ selectedItemId: value })).field).toBe(
      'selectedItemId',
    );
    expect(store.getContext().selectedItemId).toBeNull();
  });

  it('still accepts a string and null', () => {
    const store = createShellStateStore();
    store.patchContext({ selectedItemId: 'msg-1' });
    expect(store.getContext().selectedItemId).toBe('msg-1');
    store.patchContext({ selectedItemId: null });
    expect(store.getContext().selectedItemId).toBeNull();
  });
});

describe('patchContext validates focusedPane against the real PaneId union', () => {
  it.each(Array.from(PANE_IDS))('accepts the pane id %s', (pane) => {
    const store = createShellStateStore();
    store.patchContext({ focusedPane: pane as RibbonContext['focusedPane'] });
    expect(store.getContext().focusedPane).toBe(pane);
  });

  it('accepts null', () => {
    const store = createShellStateStore({ focusedPane: 'pane2' });
    store.patchContext({ focusedPane: null });
    expect(store.getContext().focusedPane).toBeNull();
  });

  it('refuses a string that is not a pane', () => {
    const store = createShellStateStore();
    const error = expectShellUXError(() => {
      patchAnything(store)({ focusedPane: 'pane9' });
    });
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('focusedPane');
    // Provably a string, so naming it is safe and useful.
    expect(error.message).toContain('pane9');
    expect(store.getContext().focusedPane).toBeNull();
  });

  it('refuses a non-string without stringifying it', () => {
    const store = createShellStateStore();
    let ran = false;
    const hostile = {
      toString(): never {
        ran = true;
        throw new Error('arbitrary attacker code');
      },
    };
    const error = expectShellUXError(() => {
      patchAnything(store)({ focusedPane: hostile });
    });
    expect(error.field).toBe('focusedPane');
    expect(error.message).toContain('"object"');
    expect(ran).toBe(false);
  });
});

describe('patchContext validates the two identifier fields', () => {
  it.each(['activeExtensionId', 'activeNavNodeId'] as const)('accepts a legal id in %s', (field) => {
    const store = createShellStateStore();
    patchAnything(store)({ [field]: 'mail-ext' });
    expect(store.getContext()[field]).toBe('mail-ext');
    patchAnything(store)({ [field]: null });
    expect(store.getContext()[field]).toBeNull();
  });

  it.each([
    ['a path', '../escape'],
    ['markup', '<script>'],
    ['uppercase', 'MailExt'],
    ['a URL scheme', 'https://evil'],
    ['an empty string', ''],
    ['a reserved word', 'constructor'],
    ['the host badge scope', '__host__'],
  ])('refuses %s as activeExtensionId', (_label, value) => {
    const store = createShellStateStore();
    const error = expectShellUXError(() => {
      patchAnything(store)({ activeExtensionId: value });
    });
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('activeExtensionId');
    expect(store.getContext().activeExtensionId).toBeNull();
  });

  it('refuses an id that is not registered as a string at all', () => {
    const store = createShellStateStore();
    const error = expectShellUXError(() => {
      patchAnything(store)({ activeNavNodeId: 7 });
    });
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('activeNavNodeId');
    expect(error.message).toContain('string or null');
    expect(error.message).toContain('"number"');
  });
});

describe('patchContext is all-or-nothing', () => {
  it('applies none of a patch whose later field is rejected', () => {
    const store = createShellStateStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getContext();

    expectShellUXError(() => {
      patchAnything(store)({ selectedItemId: 'msg-1', focusedPane: 'pane9' });
    });

    // The good field did not land, the snapshot kept its identity, and nobody
    // was told a change had happened.
    expect(store.getContext()).toBe(before);
    expect(store.getContext().selectedItemId).toBeNull();
    expect(notifications).toBe(0);
  });
});

describe('patchContext requires an object', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'selectedItemId'],
  ])('refuses %s as the patch', (_label, patch) => {
    const store = createShellStateStore();
    const error = expectShellUXError(() => {
      patchAnything(store)(patch);
    });
    // `Object.hasOwn(null, key)` is a raw TypeError; this must not be one.
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.field).toBeNull();
  });
});

describe('patchContext normalises undefined to null', () => {
  it.each([
    ['selectedItemId', 'msg-1'],
    ['activeExtensionId', 'mail-ext'],
    ['activeNavNodeId', 'root-a'],
    ['focusedPane', 'pane2'],
  ] as const)('clears %s rather than writing undefined into it', (field, seed) => {
    const store = createShellStateStore({ [field]: seed });
    expect(store.getContext()[field]).toBe(seed);

    patchAnything(store)({ [field]: undefined });

    // `undefined` in a field declared `... | null` makes the declared type a
    // runtime lie for every other extension that reads the snapshot.
    expect(store.getContext()[field]).toBeNull();
    expect(store.getContext()[field]).not.toBeUndefined();
  });

  it('treats undefined on an already-null field as the no-op it is', () => {
    const store = createShellStateStore();
    const before = store.getContext();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    patchAnything(store)({ selectedItemId: undefined });

    // `Object.is(null, undefined)` is false, so the old code allocated and
    // notified here for a change that had not happened.
    expect(store.getContext()).toBe(before);
    expect(notifications).toBe(0);
  });
});

describe('patchContext reads own properties only', () => {
  it('ignores a field inherited from the patch prototype', () => {
    const store = createShellStateStore();
    const patch: unknown = Object.create({
      selectedItemId: 'inherited',
      focusedPane: 'pane3',
    });

    patchAnything(store)(patch);

    // `key in patch` walks the prototype chain; `Object.hasOwn` does not.
    expect(store.getContext().selectedItemId).toBeNull();
    expect(store.getContext().focusedPane).toBeNull();
  });

  it('reads each field exactly once, so a shifting getter cannot substitute a value', () => {
    const store = createShellStateStore();
    let reads = 0;
    const patch: Record<string, unknown> = {};
    Object.defineProperty(patch, 'selectedItemId', {
      enumerable: true,
      get(): unknown {
        reads += 1;
        // Benign while inspected, hostile afterwards — the shape of every
        // time-of-check/time-of-use attack the registry already defends against.
        return reads === 1 ? 'msg-1' : { injected: true };
      },
    });

    patchAnything(store)(patch);

    // Validated as a local and written from that same local, so the second read
    // never happens and the object never reaches the snapshot.
    expect(reads).toBe(1);
    expect(store.getContext().selectedItemId).toBe('msg-1');
  });

  it('still reads an own property on an object with a prototype', () => {
    const store = createShellStateStore();
    const patch: Record<string, unknown> = Object.create({ focusedPane: 'pane3' });
    patch['selectedItemId'] = 'own';

    patchAnything(store)(patch);

    expect(store.getContext().selectedItemId).toBe('own');
    expect(store.getContext().focusedPane).toBeNull();
  });
});

/**
 * ============================================================================
 * READING THE PATCH IS ITSELF A CALL INTO PLUGIN CODE
 * ============================================================================
 * `patchContext` is contracted to throw `ShellUXError`, and its docblock claimed
 * "nothing here reads an untrusted value". Two operations do: `Object.hasOwn`
 * consults a `getOwnPropertyDescriptor` trap, and `patch[key]` consults a `get`
 * trap or an own getter. Each of those is code the plug-in wrote, and each of
 * them may throw whatever it likes — including a raw `TypeError` from a revoked
 * `Proxy`, which is not an exception the caller was told to expect.
 *
 * Field-level atomicity is what has to survive: a patch that cannot be read
 * applies none of itself.
 * ============================================================================
 */
describe('patchContext survives a patch that refuses to be inspected', () => {
  it('reports a throwing getOwnPropertyDescriptor trap as a ShellUXError', () => {
    const store = createShellStateStore();
    const hostile = new Proxy(
      { selectedItemId: 'msg-1' },
      {
        getOwnPropertyDescriptor(): never {
          throw new Error('descriptor lookup refused');
        },
      },
    );
    // Prove the fixture: the plain operation really does throw.
    expect(() => Object.hasOwn(hostile, 'selectedItemId')).toThrow('descriptor lookup refused');

    const error = expectShellUXError(() => {
      patchAnything(store)(hostile);
    });
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(store.getContext().selectedItemId).toBeNull();
  });

  it('reports a throwing get trap as a ShellUXError', () => {
    const store = createShellStateStore();
    const hostile = new Proxy(
      { selectedItemId: 'msg-1' },
      {
        get(): never {
          throw new Error('property read refused');
        },
      },
    );
    expect(() => Object.hasOwn(hostile, 'selectedItemId')).not.toThrow();

    const error = expectShellUXError(() => {
      patchAnything(store)(hostile);
    });
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.field).toBe('selectedItemId');
    expect(store.getContext().selectedItemId).toBeNull();
  });

  it('reports a throwing own getter as a ShellUXError', () => {
    const store = createShellStateStore();
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'focusedPane', {
      enumerable: true,
      get(): never {
        throw new Error('getter refused');
      },
    });

    const error = expectShellUXError(() => {
      patchAnything(store)(hostile);
    });
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.field).toBe('focusedPane');
  });

  it('reports a revoked Proxy as a ShellUXError, not a raw TypeError', () => {
    const store = createShellStateStore();
    const revocable = Proxy.revocable({ selectedItemId: 'msg-1' }, {});
    revocable.revoke();
    expect(() => Object.hasOwn(revocable.proxy, 'selectedItemId')).toThrow(TypeError);

    const error = expectShellUXError(() => {
      patchAnything(store)(revocable.proxy);
    });
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('applies none of a patch whose later field refuses to be read', () => {
    const store = createShellStateStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getContext();

    // `selectedItemId` is read before `focusedPane`, and is perfectly good.
    const hostile: Record<string, unknown> = { selectedItemId: 'msg-1' };
    Object.defineProperty(hostile, 'focusedPane', {
      enumerable: true,
      get(): never {
        throw new Error('getter refused');
      },
    });

    expectShellUXError(() => {
      patchAnything(store)(hostile);
    });

    // All-or-nothing survives the new failure mode: the good field did not land,
    // the snapshot kept its identity, and nobody was told a change had happened.
    expect(store.getContext()).toBe(before);
    expect(store.getContext().selectedItemId).toBeNull();
    expect(notifications).toBe(0);
  });
});

describe('the seed passed to createShellStateStore is validated too', () => {
  it('refuses a hostile seed', () => {
    const error = expectShellUXError(() => {
      (createShellStateStore as (initial: unknown) => ShellStateStore)({
        focusedPane: 'pane9',
      });
    });
    expect(error.code).toBe('INVALID_FIELD');
    expect(error.message).toContain('createShellStateStore');
  });
});

/**
 * ============================================================================
 * A LISTENER IS A SIGNAL TO RE-READ, NOT A PLACE TO WRITE
 * ============================================================================
 * `notify` used to iterate the live `Set` and recurse without limit, so a
 * listener that wrote back to the store ended in a `RangeError` from a blown
 * stack rather than in anything that named the problem.
 * ============================================================================
 */
describe('notify', () => {
  it('does not call a listener that unsubscribed during the same pass', () => {
    const store = createShellStateStore();
    const calls: string[] = [];

    // Subscribed first, so it runs first and removes the second before its turn.
    let unsubscribeSecond = (): void => undefined;
    store.subscribe(() => {
      calls.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = store.subscribe(() => {
      calls.push('second');
    });

    store.patchContext({ activeNavNodeId: 'root-a' });

    expect(calls).toEqual(['first']);
  });

  it('does not call a listener that subscribed during the pass it would be told about', () => {
    const store = createShellStateStore();
    const calls: string[] = [];

    store.subscribe(() => {
      calls.push('first');
      store.subscribe(() => {
        calls.push('late');
      });
    });

    store.patchContext({ activeNavNodeId: 'root-a' });
    expect(calls).toEqual(['first']);

    // ...but it is told about the next one.
    store.patchContext({ activeNavNodeId: 'root-b' });
    expect(calls).toEqual(['first', 'first', 'late']);
  });

  it('refuses a runaway write cascade with a typed error, not a RangeError', () => {
    const store = createShellStateStore();
    let writes = 0;
    store.subscribe(() => {
      writes += 1;
      // Always a new value, so every pass is a real change and notifies again.
      store.setSelectedItem(`msg-${String(writes)}`);
    });

    const error = expectShellUXError(() => {
      store.setSelectedItem('msg-0');
    });
    expect(error.code).toBe('REENTRANT_NOTIFY');
    expect(error.field).toBeNull();
    // Bounded, and bounded well short of a stack limit.
    expect(writes).toBeLessThan(64);
  });

  it('recovers after a cascade is refused, rather than staying convinced it is mid-notify', () => {
    const store = createShellStateStore();
    let depth = 0;
    const unsubscribe = store.subscribe(() => {
      depth += 1;
      store.setSelectedItem(`msg-${String(depth)}`);
    });

    expectShellUXError(() => {
      store.setSelectedItem('msg-0');
    });
    unsubscribe();

    // The depth counter is restored in a `finally`, so the store still works.
    let notified = false;
    store.subscribe(() => {
      notified = true;
    });
    store.patchContext({ activeNavNodeId: 'root-a' });
    expect(notified).toBe(true);
    expect(store.getContext().activeNavNodeId).toBe('root-a');
  });

  it('lets a shallow write from a listener through', () => {
    const store = createShellStateStore();
    // One level of cascade is not a runaway, and is not refused.
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      store.patchContext({ focusedPane: 'pane1' });
    });
    store.patchContext({ activeNavNodeId: 'root-a' });
    expect(store.getContext().focusedPane).toBe('pane1');
  });
});
