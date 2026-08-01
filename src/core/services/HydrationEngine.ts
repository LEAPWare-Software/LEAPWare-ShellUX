import { EXTENSION_ID_PATTERN, RESERVED_IDS } from '../RegistryContext';
import type { PaneId } from '../types';
import { ShellUXError } from '../types';

/**
 * ============================================================================
 * UI STATE HYDRATION — WHAT IS UNTRUSTED HERE, AND WHAT THE NAMESPACE BUYS
 * ============================================================================
 * This module owns the serialization and deserialization of persisted shell UI
 * state: pane sizes, the pane-1 collapsed flag, the active extension id, and a
 * per-extension scope of arbitrary JSON-shaped UI state. It is local-first —
 * one `localStorage` entry, no network, no server round trip.
 *
 * **Persisted data is untrusted input, and is treated exactly as hostile as a
 * plug-in blueprint.** Anybody with devtools open can rewrite the entry by hand,
 * a previous version of the app may have written it, and a second tab may be
 * writing it concurrently. So the read path never spreads what it finds into
 * live state: every value is read ONCE into a local, validated as that local,
 * and written into a fresh host-owned structure. What was validated is what is
 * held. That is the same discipline, and for the same reasons, as the
 * normalisation banner in `RegistryContext.tsx`.
 *
 * **A schema version is written alongside the payload, and a version that is not
 * this one is DISCARDED.** ISSUE-003 allows "migrate or discard"; this
 * implementation discards, deliberately. There has been exactly one schema
 * version in existence, so a migration would be a migration from a version that
 * never shipped — untestable fiction, and dead code the coverage gate would
 * then have to be lied to about. The version field is written so that a future
 * version CAN migrate: the one place to add that is `loadFrom` below, at the
 * `version !== SCHEMA_VERSION` branch, which today returns
 * `'unsupported-version'` for an older payload, a newer one (the user downgraded
 * the app), a missing `v` and a `v` of the wrong type alike. *Tests:*
 * `src/core/services/__tests__/hydrationEngine.test.ts` — "discards a payload
 * from an older schema version", "discards a payload from a FUTURE schema
 * version, rather than guessing at it", "discards a payload with no version at
 * all" and "discards a version of the wrong type, so \"1\" is not 1".
 *
 * ---------------------------------------------------------------------------
 * PER-EXTENSION NAMESPACING IS COLLISION-RESISTANCE, NOT CONFINEMENT
 * ---------------------------------------------------------------------------
 * Per-extension state is namespaced by extension id, and the ONLY thing that
 * buys is that two extensions which both persist a key named `selection` write
 * to two different scopes and cannot overwrite each other by accident.
 *
 * **It confines nothing, and the stronger sentence must not be written here.**
 * ADR-0001 Amendment E forbids it, and the ISSUE-003 specification names the
 * exact phrasing that may not ship — "so one extension cannot read or clobber
 * another's persisted state". It cannot be met in-page by namespacing, for two
 * independent reasons:
 *
 *  - **The scope is an argument, not a closure.** `setExtensionState(id, state)`
 *    takes the scope from its caller. There is no per-extension facade that
 *    closes over a validated id the way `createRevocableShellAPI` does for
 *    badges, because `IShellAPI` has no persistence member and this engine is
 *    host-side. Any holder of the engine can name any scope. That is weaker
 *    than badge scoping, not equal to it.
 *  - **The store is one `localStorage` entry under one origin.** Any script on
 *    the page reads and rewrites it without going through this engine at all,
 *    which is the same shape as `useShellStore()` being public. Nothing
 *    confidential belongs in persisted UI state.
 *
 * *Tests:* the collision-resistance —
 * `src/core/services/__tests__/hydrationEngine.test.ts` — "keeps two extensions
 * that both use the key \"selection\" apart". The absence of confinement, both
 * halves, reproduced rather than asserted in prose — "lets any caller name any
 * scope, so the namespace confines nothing" and "reads and rewrites another
 * extension's scope straight through the storage entry".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------------------------------------------------------
 * It registers no event listener of any kind, pinned by "finds no listener
 * registration in any module outside the hotkey-dispatch allowlist" in
 * `src/__tests__/noEventListener.test.ts` — an allowlist that names
 * `core/hotkeyDispatch.ts` and nothing else, so this module is covered by the
 * scan rather than exempted from it. That sentence used to add that no module
 * under `src/` did, which was true until ISSUE-006 gave the shell a hotkey
 * dispatcher; the claim about THIS module is unchanged. In particular it
 * does not listen for cross-tab storage notifications: two tabs are last-write-
 * wins, and the unit of that is the WHOLE record, because it is written with one
 * `setItem` of one key. A half-written record is therefore not constructible.
 * *Tests:* "the loser's whole record is replaced, never interleaved with the
 * winner's", "interleaving the two tabs still produces one complete record" and
 * "a write that fails on quota leaves the previous record exactly as it was".
 *
 * It also prunes nothing. Persisted state for an extension that is not currently
 * registered is RETAINED, because a lazily loaded extension that has not
 * registered yet is indistinguishable from one that is gone; dropping it would
 * lose the layout of every extension the user has not opened this session. The
 * host decides what to do about an orphan: `selectActiveExtensionId` refuses to
 * hand back an active id the registry does not know, and `forgetExtension` is
 * there for a host that really wants a scope gone. *Tests:* "retains the scope of
 * an extension that is not registered, so a lazily loaded one gets its state
 * back" and "refuses an active extension id the registry no longer knows".
 * ============================================================================
 */

/**
 * The storage members this engine uses, and no more.
 *
 * `localStorage` satisfies it. It is an interface rather than a direct
 * dependency because the engine has to keep working when there is no storage at
 * all — see `resolveAmbientStorage` — and because a test needs to be able to
 * hand it a storage that throws.
 */
export interface ShellStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** How the last hydration attempt ended. Every discard path has its own value. */
export type HydrationOutcome =
  /** Nothing was stored, or there is no storage to read. */
  | 'absent'
  /** A well-formed record of the current schema version was restored. */
  | 'restored'
  /** Storage threw on access or on read. Persistence is degraded to memory. */
  | 'unreadable'
  /** The stored text is longer than `MAX_RAW_LENGTH`; it was not even parsed. */
  | 'oversized'
  /** `JSON.parse` refused it — corrupt, truncated, or nested past what it will follow. */
  | 'unparsable'
  /** Valid JSON, but not this schema version. Never migrated blindly; see the banner. */
  | 'unsupported-version'
  /** Valid JSON of this version, but the wrong shape or an illegal value. */
  | 'malformed';

/** A value that survives a JSON round trip unchanged. Nothing else is stored. */
export type PersistedValue =
  | string
  | number
  | boolean
  | null
  | readonly PersistedValue[]
  | PersistedRecord;

/**
 * A host-owned record of persisted values.
 *
 * **At runtime these have a `null` prototype and are frozen.** That combination
 * is deliberate and is the persistence-layer answer to the question the registry
 * answers with a `Map`: a key here comes from a hand-editable payload, so
 * `__proto__` must not be able to reach `Object.prototype`. A null-prototype
 * object has no prototype chain to pollute, exactly as a `Map` has none — and
 * unlike a `Map` it can be genuinely frozen, which matters because these records
 * are HANDED OUT. `Object.freeze` on a `Map` leaves `map.set(...)` working, so a
 * `Map` handed to a consumer is host state that consumer can edit. The registry
 * has the same split: a private `Map` for the untrusted-key index, frozen
 * host-owned records for everything it returns. This engine keeps its
 * extension-id index in a private `Map` for that reason and hands out these.
 *
 * *Tests:* "hands out a frozen scoped record with a null prototype", and for the
 * filter layered over it, "refuses a __proto__ key inside an extension scope".
 */
export interface PersistedRecord {
  readonly [key: string]: PersistedValue;
}

/** One extension's persisted UI state. */
export type ScopedState = PersistedRecord;

/** What a caller may hand to `setExtensionState`. Validated, never retained. */
export type ScopedStateInput = Readonly<Record<string, unknown>>;

/** Pane sizes, as a percentage of the pane group, one per pane. */
export type PaneSizes = Readonly<Record<PaneId, number>>;

/** The shell state this engine persists, minus the per-extension scopes. */
export interface PersistedShellState {
  readonly paneSizes: PaneSizes;
  readonly isPane1Collapsed: boolean;
  readonly activeExtensionId: string | null;
}

/** A slot of `PersistedShellState` a caller may write. */
export type PersistedSlot = keyof PersistedShellState;

/** A record under construction, frozen before it escapes. */
type MutablePersistedShellState = {
  -readonly [K in keyof PersistedShellState]: PersistedShellState[K];
};

/**
 * The schema version written beside every payload.
 *
 * It is inside the payload rather than in the storage key on purpose: a version
 * in the key makes the previous record unfindable, which is the one thing a
 * migration needs to be able to do.
 */
export const SCHEMA_VERSION = 1;

/** The one storage entry this engine owns. One key, so one atomic write. */
export const STORAGE_KEY = 'leapware-shellux.shell-state';

/**
 * How long a write is held before it reaches storage.
 *
 * Dragging a divider produces a state change per animation frame, and a
 * `setItem` per frame is a synchronous, serializing write on the main thread.
 * The window coalesces every change that arrives inside it into ONE write of the
 * latest record. Pinned by "coalesces a whole drag into one write" in
 * `src/core/services/__tests__/hydrationEngine.test.ts`.
 */
export const DEFAULT_DEBOUNCE_MS = 120;

/**
 * Hard bounds on everything that arrives from outside. A hand-edited payload
 * cannot make the host walk forever, and this engine cannot become the reason
 * the origin's storage quota is exhausted.
 */
export const HYDRATION_LIMITS = {
  /** Max characters of the stored record. A longer entry is discarded unparsed. */
  MAX_RAW_LENGTH: 65536,
  /** Max length of any single persisted string. */
  MAX_STRING_LENGTH: 4096,
  /** Max length of a key inside an extension's scope. */
  MAX_KEY_LENGTH: 64,
  /** Max container nesting inside one extension's scope; the root is depth 0. */
  MAX_DEPTH: 8,
  /** Max total values normalised for one extension's scope. */
  MAX_NODES: 512,
  /** Max keys in one record. */
  MAX_KEYS: 64,
  /** Max items in one array. */
  MAX_ITEMS: 256,
  /** Max extension scopes in the whole record. */
  MAX_EXTENSIONS: 64,
  /**
   * The legal band for a pane size, as a percentage.
   *
   * These are ISSUE-002's own clamp, restated rather than imported: the import
   * would run from `src/core/**` into `src/components/**`, which is backwards —
   * the layout depends on the host, never the other way round. The two must
   * agree, and if they ever drift the symptom is a restored layout that the
   * layout immediately re-clamps, not a broken shell. A restored size outside
   * the band is an illegal payload and the whole record is discarded.
   */
  MIN_PANE_PERCENT: 2,
  MAX_PANE_PERCENT: 90,
  /**
   * How deep a listener cascade this engine will follow before refusing.
   *
   * Same reasoning, and the same existing error code, as `MAX_NOTIFY_DEPTH` in
   * `ShellAPI.ts`: a listener is a signal to re-read, and one that writes back
   * turns an unbounded recursion into a `RangeError` from a blown stack unless
   * something caps it.
   */
  MAX_NOTIFY_DEPTH: 16,
} as const;

/**
 * The layout a shell that has never been used starts from.
 *
 * The three percentages are `PANE_FALLBACK_PERCENT` in
 * `src/components/layout/ShellLayout.tsx` — the same defaults expressed against
 * the same reference width — restated here for the reason given on
 * `MIN_PANE_PERCENT` above.
 */
const DEFAULT_PANE_SIZES: PaneSizes = Object.freeze({ pane1: 18, pane2: 26, pane3: 56 });

/**
 * The pane keys, in order, derived from the defaults.
 *
 * `DEFAULT_PANE_SIZES` is declared `Readonly<Record<PaneId, number>>`, so the
 * compiler rejects both a missing pane and an invented one — which makes it the
 * exhaustiveness pin as well as the defaults, in the same shape as
 * `CONTEXT_KEYS` in `ShellAPI.ts`. Pinned against the host union at runtime by
 * "covers exactly the pane ids the host declares".
 */
const PANE_KEYS = Object.keys(DEFAULT_PANE_SIZES) as readonly PaneId[];

/** The state of a shell with nothing persisted. */
export const DEFAULT_SHELL_STATE: PersistedShellState = Object.freeze({
  paneSizes: DEFAULT_PANE_SIZES,
  isPane1Collapsed: false,
  activeExtensionId: null,
});

/**
 * The scope of an extension that has persisted nothing.
 *
 * A shared frozen instance so that a consumer binding to an empty scope gets a
 * stable snapshot identity and does not re-render on every read.
 */
export const EMPTY_SCOPED_STATE: ScopedState = Object.freeze(
  Object.create(null) as Record<string, PersistedValue>,
);

/* -------------------------------------------------------------------------- */
/* Untrusted-value plumbing                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How an object answers the "what shape are you?" question — four-state, because
 * the question can FAIL rather than answer.
 *
 * Same three-state reasoning as `checkArray` in `RegistryContext.tsx`, one state
 * wider. `Array.isArray` throws on a revoked `Proxy`, and `Object.getPrototypeOf`
 * runs a `getPrototypeOf` trap that a `Proxy` is free to detonate. Folding either
 * failure into `'foreign'` would report a value that refused to be inspected as
 * an ordinary wrong type, which tells the reader nothing and hides the one case
 * worth naming.
 *
 * `'record'` is a plain object — prototype `Object.prototype`, or none. A `Date`,
 * a `Map`, a `Set`, a `RegExp` and any class instance are `'foreign'`, and that
 * is the answer to the round-tripping problem: `JSON.stringify(new Map())` is
 * `{}` and `JSON.stringify(new Date())` is a string, so accepting either would
 * mean the value read back is not the value written.
 */
type ValueShape = 'array' | 'record' | 'foreign' | 'unreadable';

function classifyObject(value: object): ValueShape {
  try {
    if (Array.isArray(value)) {
      return 'array';
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return 'record';
    }
    return 'foreign';
  } catch {
    return 'unreadable';
  }
}

/**
 * Describe an untrusted value for a message without touching it.
 *
 * Identical in purpose and in reasoning to `describeUntrusted` in `ShellAPI.ts`:
 * `typeof` invokes nothing, and everything else that turns a value into text
 * consults something the payload's author wrote.
 */
function describeUntrusted(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return `a value of type "${typeof value}"`;
}

/** Mutable accumulator threaded through one scope's normalisation walk. */
interface WalkState {
  visited: number;
}

/**
 * Read one field off a payload, refusing `undefined`.
 *
 * The persisted envelope always carries all four of its fields — `serializeOf`
 * writes them unconditionally — so a missing one means the entry was edited by
 * hand, and the record is discarded rather than half-applied.
 */
function requirePersistedField(source: Record<string, unknown>, field: string): unknown {
  const value: unknown = source[field];
  if (value === undefined) {
    throw new ShellUXError('MISSING_FIELD', `Required field "${field}" is missing.`, field);
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Normalisation of one extension's scoped state                               */
/* -------------------------------------------------------------------------- */

function normalizeNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    // `NaN`, `Infinity` and `-Infinity` all serialize to `null`, so accepting
    // one would silently change both the value and its type on the next load.
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a finite number; NaN and Infinity do not survive a JSON round trip.`,
      path,
    );
  }
  // `-0` serializes to `0`. Normalising it here means the value held in memory
  // is the value that comes back, rather than one that changes on reload.
  return Object.is(value, -0) ? 0 : value;
}

function normalizeString(value: string, path: string): string {
  if (value.length > HYDRATION_LIMITS.MAX_STRING_LENGTH) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum length of ${HYDRATION_LIMITS.MAX_STRING_LENGTH} characters.`,
      path,
    );
  }
  return value;
}

/**
 * Check one key of a scoped record.
 *
 * Keys here are the extension's OWN key names, not host lookup keys, so they are
 * deliberately not held to `EXTENSION_ID_PATTERN` — that would break every
 * extension that spells its state in camelCase. The same reasoning as
 * `assertValidSelectedItemId` in `ShellAPI.ts`. What they are held to is a
 * length bound and the reserved-word list, which is belt and braces on top of
 * the null prototype the record is built with.
 */
function normalizeKey(key: string, path: string): void {
  if (key.length === 0) {
    throw new ShellUXError('INVALID_FIELD', `Field "${path}" has a key that is empty.`, path);
  }
  if (key.length > HYDRATION_LIMITS.MAX_KEY_LENGTH) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" has a key longer than ${HYDRATION_LIMITS.MAX_KEY_LENGTH} characters.`,
      path,
    );
  }
  if (RESERVED_IDS.has(key)) {
    // `key` came out of `Object.keys`, so it is provably a primitive string and
    // interpolating it runs nothing.
    throw new ShellUXError(
      'RESERVED_ID',
      `Field "${path}" must not use the reserved key "${key}".`,
      path,
    );
  }
}

function normalizeArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  walk: WalkState,
): readonly PersistedValue[] {
  // Read ONCE, into a local, and used for the bound check AND the walk AND the
  // size of the host-owned array, so all three agree on one number. `length` on
  // a Proxy over an array is a `get` trap: it may throw, and it may report one
  // value while it is measured and another afterwards.
  let length: unknown;
  try {
    length = value.length;
  } catch {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `Reading the length of "${path}" threw. Nothing was applied.`,
      path,
    );
  }
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" reported a length that is not a non-negative integer.`,
      path,
    );
  }
  const count = length as number;
  if (count > HYDRATION_LIMITS.MAX_ITEMS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum of ${HYDRATION_LIMITS.MAX_ITEMS} items.`,
      path,
    );
  }
  const items: PersistedValue[] = [];
  for (let index = 0; index < count; index += 1) {
    const itemPath = `${path}[${index}]`;
    let supplied: unknown;
    try {
      supplied = value[index];
    } catch {
      throw new ShellUXError(
        'INVALID_PAYLOAD',
        `Reading "${itemPath}" threw. Nothing was applied.`,
        itemPath,
      );
    }
    items.push(normalizeValue(supplied, itemPath, depth + 1, walk));
  }
  return Object.freeze(items);
}

function normalizeRecordValue(
  value: object,
  path: string,
  depth: number,
  walk: WalkState,
): PersistedRecord {
  // `Object.keys` runs an `ownKeys` trap, which is payload code and may throw.
  // Symbol keys are not returned by it and are therefore dropped silently, which
  // is correct: a symbol key does not survive `JSON.stringify` either.
  let keys: readonly string[];
  try {
    keys = Object.keys(value);
  } catch {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `Field "${path}" refused to list its keys. Nothing was applied.`,
      path,
    );
  }
  if (keys.length > HYDRATION_LIMITS.MAX_KEYS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum of ${HYDRATION_LIMITS.MAX_KEYS} keys.`,
      path,
    );
  }
  const holder = value as Record<string, unknown>;
  const record = Object.create(null) as Record<string, PersistedValue>;
  for (const key of keys) {
    normalizeKey(key, path);
    const keyPath = `${path}.${key}`;
    let supplied: unknown;
    try {
      supplied = holder[key];
    } catch {
      throw new ShellUXError(
        'INVALID_PAYLOAD',
        `Reading "${keyPath}" threw. Nothing was applied.`,
        keyPath,
      );
    }
    record[key] = normalizeValue(supplied, keyPath, depth + 1, walk);
  }
  return Object.freeze(record);
}

/**
 * Validate one untrusted value and return the host-owned copy of it.
 *
 * This is the single door for BOTH directions — a value a caller hands to
 * `setExtensionState`, and a value that came back out of `JSON.parse`. One
 * function rather than two means the write door cannot accept something the read
 * door would reject, which is the failure mode that makes persisted state
 * silently lossy.
 *
 * **The depth cap is what stops a hand-crafted deeply nested payload from
 * blowing the stack in here.** The walk refuses to descend past
 * `MAX_DEPTH` containers, so the recursion is bounded by a constant regardless
 * of what the payload looks like, and `MAX_NODES` bounds the total work
 * independently of the shape. Pinned by "refuses a deeply nested value with a
 * typed error rather than a RangeError" and "refuses a payload with more values
 * than MAX_NODES, however it is shaped".
 *
 * `undefined` is normalised to `null` rather than rejected, for the reason
 * `applyPatch` gives in `ShellAPI.ts`: `JSON.stringify` drops an
 * `undefined`-valued key entirely, so accepting one silently loses it, and every
 * position here admits `null`.
 */
function normalizeValue(
  value: unknown,
  path: string,
  depth: number,
  walk: WalkState,
): PersistedValue {
  walk.visited += 1;
  if (walk.visited > HYDRATION_LIMITS.MAX_NODES) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum of ${HYDRATION_LIMITS.MAX_NODES} values in one extension's state.`,
      path,
    );
  }
  if (value === undefined || value === null) {
    return null;
  }
  const kind = typeof value;
  if (kind === 'boolean') {
    return value as boolean;
  }
  if (kind === 'number') {
    return normalizeNumber(value as number, path);
  }
  if (kind === 'string') {
    return normalizeString(value as string, path);
  }
  if (kind !== 'object') {
    // A function, a symbol or a bigint. None of the three survives
    // `JSON.stringify`: the first two vanish and the third throws.
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a JSON value; received ${describeUntrusted(value)}.`,
      path,
    );
  }
  if (depth >= HYDRATION_LIMITS.MAX_DEPTH) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" nests deeper than the maximum of ${HYDRATION_LIMITS.MAX_DEPTH} levels.`,
      path,
    );
  }
  const shape = classifyObject(value as object);
  if (shape === 'array') {
    return normalizeArray(value as readonly unknown[], path, depth, walk);
  }
  if (shape === 'record') {
    return normalizeRecordValue(value as object, path, depth, walk);
  }
  if (shape === 'unreadable') {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `Field "${path}" refused to be inspected. Nothing was applied.`,
      path,
    );
  }
  throw new ShellUXError(
    'INVALID_FIELD',
    `Field "${path}" must be a plain object, an array or a scalar; a Date, Map, Set or class instance does not survive a JSON round trip.`,
    path,
  );
}

/** Validate a whole scope and return the host-owned copy. */
function normalizeScopedState(value: unknown, path: string): ScopedState {
  if (typeof value !== 'object' || value === null) {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `Field "${path}" must be an object; received ${describeUntrusted(value)}.`,
      path,
    );
  }
  const shape = classifyObject(value);
  if (shape !== 'record') {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `Field "${path}" must be a plain object; received an object of shape "${shape}".`,
      path,
    );
  }
  return normalizeRecordValue(value, path, 0, { visited: 0 });
}

/* -------------------------------------------------------------------------- */
/* Normalisation of the shell's own slots                                      */
/* -------------------------------------------------------------------------- */

/**
 * Assert that `value` is an extension id the host may key on.
 *
 * Held to exactly the registry's own rule, imported rather than restated so the
 * two cannot drift, in the same shape as `assertValidIdentifier` in
 * `ShellAPI.ts`. `__proto__` fails `EXTENSION_ID_PATTERN` on its leading
 * underscore and `constructor` and `prototype` are caught by `RESERVED_IDS`.
 */
function normalizeExtensionId(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_ID',
      `Field "${path}" must be a string; received ${describeUntrusted(value)}.`,
      path,
    );
  }
  if (RESERVED_IDS.has(value) || !EXTENSION_ID_PATTERN.test(value)) {
    // `value` is a proven primitive string, so stringifying it runs nothing.
    throw new ShellUXError(
      'INVALID_ID',
      `Field "${path}" must match ${String(EXTENSION_ID_PATTERN)} and must not be reserved; received ${JSON.stringify(value)}.`,
      path,
    );
  }
  return value;
}

function normalizePaneSizes(value: unknown, path: string): PaneSizes {
  if (typeof value !== 'object' || value === null || classifyObject(value) !== 'record') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a plain object of pane sizes; received ${describeUntrusted(value)}.`,
      path,
    );
  }
  const holder = value as Record<string, unknown>;
  // Seeded so the object's shape is fixed before the loop; every key is
  // overwritten below, because `PANE_KEYS` is exactly the keys of this type.
  const draft: MutablePaneSizes = { pane1: 0, pane2: 0, pane3: 0 };
  for (const pane of PANE_KEYS) {
    const panePath = `${path}.${pane}`;
    const supplied: unknown = holder[pane];
    if (typeof supplied !== 'number' || !Number.isFinite(supplied)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${panePath}" must be a finite number; received ${describeUntrusted(supplied)}.`,
        panePath,
      );
    }
    if (
      supplied < HYDRATION_LIMITS.MIN_PANE_PERCENT ||
      supplied > HYDRATION_LIMITS.MAX_PANE_PERCENT
    ) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${panePath}" must be between ${HYDRATION_LIMITS.MIN_PANE_PERCENT} and ${HYDRATION_LIMITS.MAX_PANE_PERCENT} percent.`,
        panePath,
      );
    }
    draft[pane] = supplied;
  }
  return Object.freeze(draft);
}

/** Pane sizes under construction. */
type MutablePaneSizes = { -readonly [K in keyof PaneSizes]: number };

function normalizeCollapsed(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a boolean; received ${describeUntrusted(value)}.`,
      path,
    );
  }
  return value;
}

function normalizeActiveExtensionId(value: unknown, path: string): string | null {
  // `undefined` and `null` both mean "no extension is active", and only one of
  // the two is representable in JSON.
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeExtensionId(value, path);
}

/**
 * The validator for every writable slot, in one table.
 *
 * `Record<PersistedSlot, ...>` makes the compiler reject both a slot this table
 * forgot and one it invented, so a field added to `PersistedShellState` cannot
 * become writable without someone deciding here what a legal value for it is.
 * The same shape, and the same reason, as `CONTEXT_FIELDS` in `ShellAPI.ts`.
 */
const SLOT_NORMALIZERS: Readonly<{
  [K in PersistedSlot]: (value: unknown, path: string) => PersistedShellState[K];
}> = Object.freeze({
  paneSizes: normalizePaneSizes,
  isPane1Collapsed: normalizeCollapsed,
  activeExtensionId: normalizeActiveExtensionId,
});

/** The writable slots, as a runtime membership test. */
const PERSISTED_SLOTS: ReadonlySet<string> = new Set(Object.keys(SLOT_NORMALIZERS));

/** Validate the whole per-extension index and return a fresh host-owned `Map`. */
function normalizeExtensionMap(value: unknown, path: string): Map<string, ScopedState> {
  if (typeof value !== 'object' || value === null || classifyObject(value) !== 'record') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a plain object of extension scopes; received ${describeUntrusted(value)}.`,
      path,
    );
  }
  const holder = value as Record<string, unknown>;
  const keys = Object.keys(holder);
  if (keys.length > HYDRATION_LIMITS.MAX_EXTENSIONS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum of ${HYDRATION_LIMITS.MAX_EXTENSIONS} extension scopes.`,
      path,
    );
  }
  // A Map, never an object literal: these keys come from a hand-editable
  // payload, and a Map has no prototype chain to pollute. The same decision, for
  // the same reason, as the registry's own store.
  const scopes = new Map<string, ScopedState>();
  for (const key of keys) {
    const id = normalizeExtensionId(key, `${path}.${key}`);
    scopes.set(id, normalizeScopedState(holder[key], `${path}.${id}`));
  }
  return scopes;
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The canonical text for a state and its scopes.
 *
 * Everything reachable from here is host-owned and was built by the normalisers
 * above — fresh objects, bounded depth, no getters and no cycles — so
 * `JSON.stringify` cannot re-enter foreign code and cannot fail on a cycle.
 *
 * The scope order is the `Map`'s insertion order, so two engines that learned
 * about the same extensions in a different order produce different text for the
 * same logical state. That is only ever compared against this engine's own
 * previous text, so it costs nothing.
 */
function serializeOf(
  state: PersistedShellState,
  scopes: ReadonlyMap<string, ScopedState>,
): string {
  const extensions = Object.create(null) as Record<string, ScopedState>;
  for (const [id, scoped] of scopes) {
    extensions[id] = scoped;
  }
  return JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes: state.paneSizes,
    isPane1Collapsed: state.isPane1Collapsed,
    activeExtensionId: state.activeExtensionId,
    extensions,
  });
}

/* -------------------------------------------------------------------------- */
/* Storage resolution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The ambient `localStorage`, or `null` when there is not one this engine can
 * use.
 *
 * **Merely reading the property can throw.** Safari with cookies blocked, and
 * any browser with site data disabled, raise a `SecurityError` on ACCESS rather
 * than on use, so a bare `globalThis.localStorage` in module scope would take
 * the shell down at import time. It is read once, inside a guard, and only when
 * an engine is actually constructed. Pinned by "degrades to memory when reading
 * localStorage throws".
 *
 * The shape check is separate from the guard on purpose: an environment that
 * defines `localStorage` as `undefined`, as `null`, or as an object missing the
 * members this engine calls is not an error, it is simply an environment without
 * storage, and the shell has to run there.
 */
function resolveAmbientStorage(): ShellStorage | null {
  let candidate: unknown;
  try {
    candidate = globalThis.localStorage;
  } catch {
    return null;
  }
  if (candidate === null || typeof candidate !== 'object') {
    return null;
  }
  const holder = candidate as Record<string, unknown>;
  if (typeof holder['getItem'] !== 'function') {
    return null;
  }
  if (typeof holder['setItem'] !== 'function') {
    return null;
  }
  return candidate as ShellStorage;
}

/* -------------------------------------------------------------------------- */
/* Hydration                                                                   */
/* -------------------------------------------------------------------------- */

interface LoadResult {
  readonly outcome: HydrationOutcome;
  readonly state: PersistedShellState;
  readonly extensions: Map<string, ScopedState>;
}

/**
 * Read, validate and rebuild the persisted record. **Never throws.**
 *
 * That is a contract, not an accident: this runs during the construction of an
 * engine, which runs during the first render of whatever binds to it, and a
 * hand-edited storage entry must not be able to take the shell down. Every
 * rejection becomes a `HydrationOutcome` and the defaults, which is what "never
 * blindly spread into live state" means in practice — a payload that fails
 * anywhere contributes NOTHING, rather than contributing its good fields.
 * Pinned by "applies none of a payload whose LATER field is illegal", and by the
 * whole of "createHydrationEngine — hostile payloads".
 */
function loadFrom(storage: ShellStorage | null, key: string): LoadResult {
  const discarded = (outcome: HydrationOutcome): LoadResult => ({
    outcome,
    state: DEFAULT_SHELL_STATE,
    extensions: new Map<string, ScopedState>(),
  });

  if (storage === null) {
    return discarded('absent');
  }
  let raw: unknown;
  try {
    raw = storage.getItem(key);
  } catch {
    return discarded('unreadable');
  }
  if (raw === null) {
    return discarded('absent');
  }
  if (typeof raw !== 'string') {
    return discarded('malformed');
  }
  // Checked BEFORE parsing. An enormous entry is discarded without ever being
  // handed to `JSON.parse`, so the cost of a hostile payload is one length read.
  if (raw.length > HYDRATION_LIMITS.MAX_RAW_LENGTH) {
    return discarded('oversized');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt, truncated, or nested deeply enough that `JSON.parse` itself
    // refuses to follow it — the parser is recursive and answers a payload built
    // to exhaust the stack with a `RangeError`, which is caught here exactly as
    // a `SyntaxError` is.
    return discarded('unparsable');
  }
  if (typeof parsed !== 'object' || parsed === null || classifyObject(parsed) !== 'record') {
    return discarded('malformed');
  }
  const envelope = parsed as Record<string, unknown>;
  // Read ONCE, into a local, and compared before anything else is touched.
  const version: unknown = envelope['v'];
  if (version !== SCHEMA_VERSION) {
    // Older, newer, missing or of the wrong type — all four discard. See the
    // banner: this is where a migration would be selected.
    return discarded('unsupported-version');
  }
  try {
    const state: PersistedShellState = Object.freeze({
      paneSizes: normalizePaneSizes(requirePersistedField(envelope, 'paneSizes'), 'paneSizes'),
      isPane1Collapsed: normalizeCollapsed(
        requirePersistedField(envelope, 'isPane1Collapsed'),
        'isPane1Collapsed',
      ),
      activeExtensionId: normalizeActiveExtensionId(
        requirePersistedField(envelope, 'activeExtensionId'),
        'activeExtensionId',
      ),
    });
    const extensions = normalizeExtensionMap(
      requirePersistedField(envelope, 'extensions'),
      'extensions',
    );
    return { outcome: 'restored', state, extensions };
  } catch {
    return discarded('malformed');
  }
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                  */
/* -------------------------------------------------------------------------- */

export interface HydrationEngineOptions {
  /**
   * Where to persist. Omit for the ambient `localStorage`; pass `null` for an
   * engine that is deliberately memory-only.
   */
  readonly storage?: ShellStorage | null;
  /** The storage entry to own. Defaults to `STORAGE_KEY`. */
  readonly key?: string;
  /** The write-coalescing window. Defaults to `DEFAULT_DEBOUNCE_MS`. */
  readonly debounceMs?: number;
}

export interface HydrationEngine {
  /**
   * The current shell state.
   *
   * The returned object's IDENTITY is stable until something actually changes,
   * which is what lets it back a `useSyncExternalStore` snapshot.
   */
  getState(): PersistedShellState;
  /**
   * Write one slot. The value is validated and a host-owned copy is stored.
   *
   * @throws {ShellUXError} `INVALID_FIELD` for an unknown slot or an illegal
   *   value, `INVALID_ID` for an `activeExtensionId` that is not a registry-valid
   *   identifier, `PAYLOAD_TOO_LARGE` when the resulting record would exceed
   *   `MAX_RAW_LENGTH`. It does NOT throw when storage is unavailable or refuses
   *   the write — that degrades to memory, silently and by design.
   */
  setSlot<K extends PersistedSlot>(slot: K, value: PersistedShellState[K]): void;
  /** One extension's scope, or `undefined` when it has persisted nothing. */
  getExtensionState(extensionId: string): ScopedState | undefined;
  /**
   * Replace one extension's scope.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId`; `INVALID_PAYLOAD`
   *   or `INVALID_FIELD` for a value that would not survive a JSON round trip;
   *   `PAYLOAD_TOO_LARGE` for anything past a bound. Never for a storage failure.
   */
  setExtensionState(extensionId: string, state: ScopedStateInput): void;
  /** Drop one extension's scope. `false` when there was nothing to drop. */
  forgetExtension(extensionId: string): boolean;
  /** Every extension id with a persisted scope, as a fresh host-owned array. */
  listExtensionIds(): readonly string[];
  /** Register a change listener. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Write any pending record to storage now, cancelling the coalescing window. */
  flush(): void;
  /**
   * Flush, then release the timer and the listeners.
   *
   * It does NOT make the engine unusable and does not latch anything. A cleanup
   * cannot tell a real unmount from StrictMode's simulated one, and ADR-0001
   * Amendment F records what happens when something in this position acts as
   * though it can.
   */
  dispose(): void;
  /** Whether the last storage interaction succeeded. `false` means memory-only. */
  isPersistent(): boolean;
  /** How the hydration this engine was constructed with ended. */
  getLastLoad(): HydrationOutcome;
}

/**
 * Build a hydration engine over `options.storage`, hydrating it synchronously.
 *
 * **Hydration is synchronous and happens here, in the constructor.** That is the
 * whole of the no-flash-of-default-layout requirement: a binding that reads this
 * engine during its first render reads restored state, not defaults that an
 * effect corrects one commit later. Pinned by "renders the persisted value on the
 * very first paint, and never the default" in
 * `src/hooks/__tests__/useLocalStorageState.test.tsx`.
 *
 * **Nothing on the returned object throws because storage is unavailable.** The
 * engine is fully functional with `storage: null`: state lives in memory, reads
 * and writes work, and only the mirroring to storage is absent. Pinned by "runs
 * with persistence degraded to memory, and nothing throws".
 */
export function createHydrationEngine(options: HydrationEngineOptions = {}): HydrationEngine {
  const key = options.key ?? STORAGE_KEY;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const storage = options.storage === undefined ? resolveAmbientStorage() : options.storage;

  const loaded = loadFrom(storage, key);
  let current: PersistedShellState = loaded.state;
  // Private, and never handed out: the keys are untrusted, and a `Map` cannot be
  // frozen. What consumers get is the frozen record inside it.
  let extensions: Map<string, ScopedState> = loaded.extensions;
  let currentText = serializeOf(current, extensions);
  const lastLoad: HydrationOutcome = loaded.outcome;

  let persistent = storage !== null && loaded.outcome !== 'unreadable';
  let pendingText: string | null = null;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const listeners = new Set<() => void>();
  let notifyDepth = 0;

  /**
   * Tell every listener registered when this pass began.
   *
   * The pass runs over a snapshot and re-checks membership before each call, so
   * a listener added during the pass is not called by it and one that
   * unsubscribed earlier in the same pass is not called after its unsubscribe
   * returned. Identical to `notify` in `ShellAPI.ts`, and depth-capped for the
   * same reason.
   */
  function notify(): void {
    if (notifyDepth >= HYDRATION_LIMITS.MAX_NOTIFY_DEPTH) {
      throw new ShellUXError(
        'REENTRANT_NOTIFY',
        `A hydration listener wrote back to the engine, and the notification cascade reached the limit of ${HYDRATION_LIMITS.MAX_NOTIFY_DEPTH}. A listener is a signal to re-read the state, not a place to write to it.`,
        null,
      );
    }
    const pending = Array.from(listeners);
    notifyDepth += 1;
    try {
      for (const listener of pending) {
        if (listeners.has(listener)) {
          listener();
        }
      }
    } finally {
      notifyDepth -= 1;
    }
  }

  function flush(): void {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
    if (storage === null || pendingText === null) {
      return;
    }
    try {
      // ONE `setItem` of ONE key, which is what makes two tabs last-write-wins
      // rather than interleaved: the loser's whole record is replaced by the
      // winner's whole record, and a partially written record is not
      // constructible. A quota rejection leaves the previous entry untouched.
      storage.setItem(key, pendingText);
      pendingText = null;
      persistent = true;
    } catch {
      // Quota exhausted, or storage revoked mid-session. The record stays
      // pending, so the next flush retries it, and the engine goes on serving
      // the state from memory. Nothing propagates: a shell that cannot save its
      // layout still has to run.
      persistent = false;
    }
  }

  /**
   * Open the coalescing window if it is not already open.
   *
   * A trailing window rather than a restarting debounce, deliberately: a
   * restarting timer never fires during a continuous drag, so a slow drag would
   * persist nothing until the user let go. This one writes once per window, with
   * whatever the latest record is when it closes.
   */
  function schedule(): void {
    if (storage === null || timer !== null) {
      return;
    }
    timer = globalThis.setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
  }

  /**
   * Commit a candidate state, or decide that nothing moved.
   *
   * The canonical text is the equality test. It is exact — identity changes
   * precisely when the persisted bytes would change — and it is the same string
   * the write needs, so nothing is computed twice.
   */
  function commit(nextState: PersistedShellState, nextExtensions: Map<string, ScopedState>): void {
    const text = serializeOf(nextState, nextExtensions);
    if (text === currentText) {
      // Nothing changed: no assignment, so the snapshot keeps its identity, and
      // no notify, so no subscriber re-renders.
      return;
    }
    if (text.length > HYDRATION_LIMITS.MAX_RAW_LENGTH) {
      throw new ShellUXError(
        'PAYLOAD_TOO_LARGE',
        `The persisted record would exceed the maximum of ${HYDRATION_LIMITS.MAX_RAW_LENGTH} characters. Nothing was applied.`,
        null,
      );
    }
    current = nextState;
    extensions = nextExtensions;
    currentText = text;
    pendingText = text;
    schedule();
    notify();
  }

  function getState(): PersistedShellState {
    return current;
  }

  function setSlot<K extends PersistedSlot>(slot: K, value: PersistedShellState[K]): void {
    // The declared type says "a slot"; a plain-JavaScript caller can pass
    // anything, and an unchecked key would reach `SLOT_NORMALIZERS[slot]` and
    // read a property off it.
    const requested: unknown = slot;
    if (typeof requested !== 'string' || !PERSISTED_SLOTS.has(requested)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `setSlot: "slot" must be one of ${Array.from(PERSISTED_SLOTS).join(', ')}; received ${describeUntrusted(requested)}.`,
        'slot',
      );
    }
    const normalized = SLOT_NORMALIZERS[slot](value, slot);
    const draft: MutablePersistedShellState = { ...current };
    (draft as Record<string, unknown>)[slot] = normalized;
    commit(Object.freeze(draft), extensions);
  }

  function getExtensionState(extensionId: string): ScopedState | undefined {
    return extensions.get(normalizeExtensionId(extensionId, 'extensionId'));
  }

  function setExtensionState(extensionId: string, state: ScopedStateInput): void {
    const id = normalizeExtensionId(extensionId, 'extensionId');
    const scoped = normalizeScopedState(state, `extensions.${id}`);
    const next = new Map(extensions);
    next.set(id, scoped);
    if (next.size > HYDRATION_LIMITS.MAX_EXTENSIONS) {
      throw new ShellUXError(
        'PAYLOAD_TOO_LARGE',
        `The record already holds the maximum of ${HYDRATION_LIMITS.MAX_EXTENSIONS} extension scopes.`,
        'extensionId',
      );
    }
    commit(current, next);
  }

  function forgetExtension(extensionId: string): boolean {
    const id = normalizeExtensionId(extensionId, 'extensionId');
    if (!extensions.has(id)) {
      return false;
    }
    const next = new Map(extensions);
    next.delete(id);
    commit(current, next);
    return true;
  }

  function listExtensionIds(): readonly string[] {
    return Array.from(extensions.keys());
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    flush();
    listeners.clear();
  }

  function isPersistent(): boolean {
    return persistent;
  }

  function getLastLoad(): HydrationOutcome {
    return lastLoad;
  }

  // Frozen for the same reason `createShellStateStore` freezes its store: this
  // object crosses a trust boundary, and an unfrozen member is one a holder can
  // assign over to observe or discard another holder's writes.
  return Object.freeze({
    getState,
    setSlot,
    getExtensionState,
    setExtensionState,
    forgetExtension,
    listExtensionIds,
    subscribe,
    flush,
    dispose,
    isPersistent,
    getLastLoad,
  });
}

/**
 * The active extension id, but only if the registry still knows it.
 *
 * A persisted id can name an extension that has been uninstalled, renamed, or
 * simply not loaded yet. Restoring it blindly would put the shell into a
 * foreground state no registered extension can serve. This is a pure function of
 * its two arguments and reads each value once, so a host may call it on every
 * render.
 *
 * *Test:* "refuses an active extension id the registry no longer knows".
 */
export function selectActiveExtensionId(
  state: PersistedShellState,
  registeredIds: ReadonlySet<string>,
): string | null {
  const candidate = state.activeExtensionId;
  if (candidate === null) {
    return null;
  }
  return registeredIds.has(candidate) ? candidate : null;
}

/**
 * The process-wide engine over the ambient `localStorage`.
 *
 * Lazily created, because reading `localStorage` at module scope throws in the
 * environments this engine exists to survive. It is a shared instance rather
 * than one per consumer for the reason `useShellStore` gives about the shell
 * store: two engines over one storage entry would be two views of the layout
 * that never observe each other's writes.
 *
 * It is not a confinement boundary and is not offered as one — see the banner.
 */
let defaultEngine: HydrationEngine | null = null;

export function getDefaultHydrationEngine(): HydrationEngine {
  defaultEngine ??= createHydrationEngine();
  return defaultEngine;
}
