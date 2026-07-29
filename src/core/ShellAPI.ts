import { EXTENSION_ID_PATTERN, RESERVED_IDS } from './RegistryContext';
import type { IShellAPI, RibbonContext } from './types';
import { ShellUXError } from './types';

/**
 * Recursively freeze `value` and everything reachable from it.
 *
 * Cycle-safe: the object is frozen BEFORE its properties are walked, so a
 * back-reference hits the `Object.isFrozen` guard and terminates. That same
 * guard means an already-frozen object is treated as fully frozen — which
 * holds for structures built here, since everything this module freezes it
 * freezes deeply.
 *
 * **Total: it never throws.** That is a contract, not an accident.
 * `DEVELOPER.md` tells extension authors to run this over their own `IShellAPI`
 * test doubles, so it is reachable from code this repository does not own — and
 * a test double can be an exotic object. `Object.isFrozen`, `Object.freeze`,
 * `Reflect.ownKeys` and a plain property read all re-enter user code on a Proxy
 * (`isExtensible`, `preventExtensions`, `ownKeys`, `get`), and any of those
 * traps may throw. Each is therefore guarded: an object that refuses to be
 * inspected is returned unchanged, and one property that refuses to be read
 * does not abandon the rest of the walk.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null) {
    return value;
  }
  const kind = typeof value;
  if (kind !== 'object' && kind !== 'function') {
    return value;
  }

  let keys: readonly PropertyKey[];
  try {
    if (Object.isFrozen(value)) {
      return value;
    }
    Object.freeze(value);
    keys = Reflect.ownKeys(value as object);
  } catch {
    // An exotic object — typically a Proxy with a throwing `isExtensible`,
    // `preventExtensions` or `ownKeys` trap — refuses to be inspected or
    // frozen. There is nothing further to do to it, and refusing to freeze is
    // strictly better than propagating the trap's exception to a caller that
    // asked for a freeze.
    return value;
  }

  const target = value as unknown as Record<PropertyKey, unknown>;
  for (const key of keys) {
    try {
      deepFreeze(target[key]);
    } catch {
      // A throwing `get` trap hides this property from the walk. Skip it and
      // keep freezing the siblings; the object itself is already frozen.
    }
  }
  return value;
}

/**
 * Describe an untrusted value for an error message, without touching it.
 *
 * `typeof` is defined for every JavaScript value and invokes nothing — no
 * getter, no Proxy trap, no `toString`, no `toJSON`. Everything else that
 * turns a value into text does invoke something: `JSON.stringify` calls a
 * `toJSON` the plugin wrote, and throws outright on a cycle or a BigInt;
 * `String()` and template interpolation consult `Symbol.toPrimitive`,
 * `toString` and `valueOf`; `+` and `<` do the same. Any of those can throw a
 * raw `TypeError` out of a function whose contract is `@throws {ShellUXError}`,
 * or run attacker code inside the host.
 *
 * So: message building in this module reads no untrusted value. It reports the
 * value's TYPE and stops. The one exception is a value already proven to be a
 * primitive `string`, which can be interpolated safely — the check itself is
 * what makes it safe.
 */
function describeUntrusted(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return `a value of type "${typeof value}"`;
}

/**
 * Host-owned mutable state behind `IShellAPI`. The store is writable; the
 * `IShellAPI` facade layered over it is not.
 */
export interface ShellStateStore {
  /** Immutable snapshot of the current context. */
  getContext(): Readonly<RibbonContext>;
  /** Host-side update. Not reachable from plugin code, and not validated. */
  patchContext(patch: Partial<RibbonContext>): void;
  /** Badge count for a node, or `undefined` when none was ever set. */
  getBadgeCount(nodeId: string): number | undefined;
  /** Set the badge count for a node. Validates its arguments. */
  setBadgeCount(nodeId: string, count: number): void;
  /** Set or clear the selected item. Validates its argument. */
  setSelectedItem(id: string | null): void;
}

/** The empty context: nothing active, nothing selected, nothing focused. */
const EMPTY_CONTEXT: Readonly<RibbonContext> = Object.freeze({
  activeExtensionId: null,
  activeNavNodeId: null,
  selectedItemId: null,
  focusedPane: null,
});

/**
 * Badge keys are navigation node ids, so they are held to exactly the rules
 * the registry applied when it accepted those nodes — the same allowlist and
 * the same reserved words, imported rather than restated so the two can never
 * drift apart. `RegistryContext` imports nothing from this module, so the
 * dependency runs one way only.
 *
 * The parameter is typed `string`, but this is a trust boundary: the caller is
 * plugin code that may be plain JavaScript, so the runtime value can be
 * anything. The type check therefore comes first and the message for it names
 * only the type — the failure path is reached *precisely when* the value is not
 * a string, which is exactly when stringifying it is dangerous.
 */
function assertValidNodeId(nodeId: string): void {
  const value: unknown = nodeId;
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_ID',
      `setBadgeCount: "nodeId" must be a string; received ${describeUntrusted(value)}.`,
      'nodeId',
    );
  }
  if (RESERVED_IDS.has(value) || !EXTENSION_ID_PATTERN.test(value)) {
    // `value` is a primitive string here, so interpolating it is safe.
    throw new ShellUXError(
      'INVALID_ID',
      `setBadgeCount: "nodeId" must match ${String(EXTENSION_ID_PATTERN)} and must not be a reserved identifier; received "${value}".`,
      'nodeId',
    );
  }
}

/**
 * The selected item id is the extension's own identifier for a row in its own
 * view. The host never uses it as a lookup key, so it is deliberately NOT held
 * to `EXTENSION_ID_PATTERN` — that would break every extension whose records
 * are keyed by a GUID, a path or a number-as-string.
 *
 * Its TYPE is enforced, though. `RibbonContext.selectedItemId` is declared
 * `string | null` and is handed to other extensions' predicates and handlers;
 * letting an arbitrary object through would make the declaration false at
 * runtime and give one plugin a channel for injecting a live object — with
 * getters, with a prototype — into another plugin's code. Rejecting is
 * consistent with `setBadgeCount`: `IShellAPI` is called BY the extension, so a
 * bad argument is the extension's own bug and is reported as an exception.
 * Coercing silently to `null` would hide that bug behind a selection that
 * mysteriously never sticks.
 */
function assertValidSelectedItemId(id: string | null): void {
  const value: unknown = id;
  if (value !== null && typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `setSelectedItem: "id" must be a string or null; received ${describeUntrusted(value)}.`,
      'id',
    );
  }
}

/**
 * Create the mutable state store that backs an `IShellAPI`.
 *
 * @param initial Optional seed for the context. Anything omitted starts `null`.
 */
export function createShellStateStore(initial?: Partial<RibbonContext>): ShellStateStore {
  let context: Readonly<RibbonContext> = EMPTY_CONTEXT;
  // A Map, never an object literal: badge keys come from plugin-supplied node
  // ids, and a Map has no prototype chain to pollute.
  const badgeCounts = new Map<string, number>();

  const store: ShellStateStore = {
    getContext(): Readonly<RibbonContext> {
      return context;
    },

    patchContext(patch: Partial<RibbonContext>): void {
      context = Object.freeze({ ...context, ...patch });
    },

    getBadgeCount(nodeId: string): number | undefined {
      return badgeCounts.get(nodeId);
    },

    setBadgeCount(nodeId: string, count: number): void {
      assertValidNodeId(nodeId);
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new ShellUXError(
          'INVALID_FIELD',
          'setBadgeCount: "count" must be a non-negative safe integer.',
          'count',
        );
      }
      badgeCounts.set(nodeId, count);
    },

    setSelectedItem(id: string | null): void {
      assertValidSelectedItemId(id);
      // Validated before it is written, so the frozen snapshot handed to other
      // extensions can never hold anything but a string or null.
      context = Object.freeze({ ...context, selectedItemId: id });
    },
  };

  if (initial !== undefined) {
    store.patchContext(initial);
  }

  return store;
}

/**
 * Build the deep-frozen `IShellAPI` facade handed down to a plugin.
 *
 * Freezing matters because the instance crosses a trust boundary: without it a
 * plugin could reassign `setSelectedItem` and observe or suppress calls made by
 * the host or by other plugins holding the same instance. Frozen, an
 * assignment throws in strict mode (all ES modules are strict) and is a silent
 * no-op in sloppy mode — in neither case does the method actually change.
 */
export function createShellAPI(store: ShellStateStore): IShellAPI {
  const api: IShellAPI = {
    setSelectedItem(id: string | null): void {
      store.setSelectedItem(id);
    },

    setBadgeCount(nodeId: string, count: number): void {
      store.setBadgeCount(nodeId, count);
    },

    getContext(): Readonly<RibbonContext> {
      return store.getContext();
    },
  };

  return deepFreeze(api);
}
