import { createContext, useContext, useSyncExternalStore } from 'react';
import { EXTENSION_ID_PATTERN, RESERVED_IDS } from './RegistryContext';
import type { IShellAPI, RibbonContext } from './types';
import { PANE_IDS, ShellUXError } from './types';

/**
 * Recursively freeze `value` and everything reachable from it.
 *
 * Cycle-safe: the object is frozen BEFORE its properties are walked, so a
 * back-reference hits the `Object.isFrozen` guard and terminates. That same
 * guard means an already-frozen object is treated as fully frozen — which
 * holds for structures built here, since everything this module freezes it
 * freezes deeply.
 *
 * **Total: it never throws.** That is a contract, not an accident, and it is
 * pinned by "deepFreeze — hostile objects cannot make it throw" in
 * `src/core/__tests__/shellApi.test.ts`.
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
 *
 * Pinned by "refuses a live object in selectedItemId, and never touches it",
 * "refuses a value that throws from every route to a string" and "refuses a
 * non-string without stringifying it" in `src/core/__tests__/contextPatch.test.ts`,
 * and by "setBadgeCount rejects an unstringifiable nodeId with a ShellUXError" in
 * `src/core/__tests__/shellApi.test.ts`.
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
 *
 * **There is exactly one store per shell host** — `ShellHostProvider` owns it
 * and publishes it, and every per-extension facade writes through that one
 * instance. That is what makes a write in one pane observable in another; two
 * stores would be two panes that cannot see each other.
 */
export interface ShellStateStore {
  /**
   * Immutable snapshot of the current context.
   *
   * The returned object's IDENTITY is stable until something actually changes,
   * which is what lets it be used as a `useSyncExternalStore` snapshot and as a
   * `useMemo` dependency.
   */
  getContext(): Readonly<RibbonContext>;
  /**
   * Register `listener`, called after every change that really changed
   * something. Returns the unsubscribe function.
   *
   * This is the `useSyncExternalStore` subscribe contract, and `useShellContext`
   * is built on it. `listener` takes no arguments on purpose: it is a signal to
   * re-read `getContext`, never a carrier of state, so there is no way for a
   * subscriber to be handed something the store does not hold.
   *
   * ==========================================================================
   * **A LISTENER IS A SYNCHRONOUS CALL INTO UNTRUSTED CODE INSIDE ANOTHER
   * HOLDER'S WRITE.** This member is public — `useShellStore()` is — and this
   * docblock said none of what follows, which is why six prose sites downstream
   * concluded that the frozen store cannot be intercepted. Three consequences,
   * each pinned in `src/core/__tests__/subscribe.test.tsx`:
   *
   *  - **It observes.** `listener` runs after the commit and BEFORE the writing
   *    statement returns, so it reads every value any other holder writes —
   *    including one writing through its own deep-frozen `IShellAPI`. See "sees
   *    the new value synchronously, before the writer returns".
   *  - **It re-enters.** `listener` may call `patchContext` from inside the
   *    notification. One shallow cascade is well short of `MAX_NOTIFY_DEPTH`, so
   *    the re-entrant value is simply the one left standing. See "leaves the
   *    attacker's value in place and not the host's".
   *  - **It throws into the writer's frame.** A throwing listener aborts the
   *    pass, so every listener ordered after it — a victim pane's
   *    `useSyncExternalStore` subscription included — is never notified, and the
   *    throw arrives at the writer as whatever the listener chose. It is NOT
   *    necessarily a `ShellUXError`, whatever the writing member's `@throws`
   *    says. See "starves a listener registered later in the same store" and
   *    "delivers a raw TypeError out of patchContext".
   *
   * None of that is a defect in the freeze, and none of it is closable here: a
   * store that notifies nobody is a store no pane can render off. It is the point
   * at which this store's guarantee stops. A host that treats listeners as
   * untrusted must guard its own writes — and `ActivationContext.tsx` does
   * exactly that at the one call site a host cannot reach.
   * ==========================================================================
   */
  subscribe(listener: () => void): () => void;
  /**
   * Update any of the four context fields at once.
   *
   * **This is a trust boundary, not a host-private back door.** An earlier
   * version of this comment claimed it was "not reachable from plugin code, and
   * not validated beyond what the compiler enforces". Both halves were false and
   * the second followed from the first: `useShellStore()` is public by design —
   * ADR-0001 records that as an accepted limit — and a plugin view renders inside
   * `ShellHostProvider`, so plugin code can obtain this store and call this
   * method. The compiler enforces nothing across a boundary a plain-JavaScript
   * plugin can stand on.
   *
   * It is therefore validated to exactly the standard `setSelectedItem` and
   * `setBadgeCount` are held to, field by field:
   *
   *  - `selectedItemId` — a string or `null`. Type only: it is the extension's
   *    own item key, not a host lookup key.
   *  - `activeExtensionId`, `activeNavNodeId` — `EXTENSION_ID_PATTERN`, not
   *    reserved, or `null`. Both are registry-validated identifiers everywhere
   *    else, so they are held to the registry's own rule here.
   *  - `focusedPane` — a member of `PANE_IDS`, or `null`.
   *
   * **Rejection is a `ShellUXError` and the context is left exactly as it was.**
   * The commit happens after every supplied field has been checked, so a patch
   * with one bad field applies none of its good ones — and that now covers a patch
   * that refuses to be *read* as well as one whose value is wrong, because reading
   * a patch is itself a call into plugin code (see `applyPatch`). Pinned by
   * "patchContext is all-or-nothing" and "patchContext survives a patch that refuses
   * to be inspected" in `src/core/__tests__/contextPatch.test.ts`.
   *
   * **`@throws {ShellUXError}` covers what this method DECIDES, not everything that
   * can come out of it.** A successful write notifies, `subscribe` is public, and a
   * listener may throw anything at all into this frame — pinned by "delivers a raw
   * TypeError out of patchContext" in `src/core/__tests__/subscribe.test.tsx`. A
   * caller that must not see a foreign exception has to guard the call.
   *
   * One case is different and it is not a rejection: a `REENTRANT_NOTIFY` raised
   * from the notification cascade. By then the fields have already been committed
   * and listeners have already run, so the write STANDS and the error names the
   * runaway listener rather than undoing the caller's own patch. The same is true
   * of a listener that simply throws. Rolling either one back would mean telling
   * subscribers about a state that no longer exists, which is worse than the
   * asymmetry.
   *
   * Only the four `RibbonContext` fields are read from `patch`, and only as OWN
   * properties (`Object.hasOwn`, never `in`), so neither a stray key nor an
   * inherited one can become a context field — pinned by "patchContext reads own
   * properties only" in `src/core/__tests__/contextPatch.test.ts`.
   * `undefined` is normalised to
   * `null`: every field is declared `... | null`, and `Object.is(null, undefined)`
   * is `false`, so writing `undefined` through would both report a change that
   * did not happen and make the declared type a runtime lie.
   *
   * A field written with the value it already holds is not a change: no object is
   * allocated, the snapshot keeps its identity, and no listener is notified.
   */
  patchContext(patch: Partial<RibbonContext>): void;
  /**
   * Badge count for one extension's node, or `undefined` when none was ever set.
   *
   * **Both arguments are validated, and an earlier version of this comment said
   * `extensionId` was "host-supplied … and is trusted".** It is not: this is a
   * member of the store, `useShellStore()` is public, and the badge key is built
   * by interpolating both components — so an unvalidated argument here ran a
   * plugin's `toString` inside the host, or escaped a raw `TypeError` on a
   * `Symbol`, out of a function contracted to throw `ShellUXError`. Pinned by "the
   * badge scope and node id are validated at both doors" in
   * `src/core/__tests__/shellApi.test.ts`.
   *
   * @throws {ShellUXError} `INVALID_ID` when `extensionId` is neither a
   *   registry-valid identifier nor the host scope, or `nodeId` is not a
   *   registry-valid identifier.
   */
  getBadgeCount(extensionId: string, nodeId: string): number | undefined;
  /**
   * Set the badge count for one extension's node. Validates all three arguments.
   * Pinned by "the badge scope and node id are validated at both doors" and
   * "setBadgeCount rejects an unstringifiable nodeId with a ShellUXError" in
   * `src/core/__tests__/shellApi.test.ts`.
   *
   * A successful write notifies, so a listener can throw a non-`ShellUXError` into
   * this frame — see `subscribe`, and "delivers a raw TypeError out of
   * setBadgeCount" in `src/core/__tests__/subscribe.test.tsx`.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId` or `nodeId`;
   *   `INVALID_FIELD` when `count` is not a non-negative safe integer.
   */
  setBadgeCount(extensionId: string, nodeId: string, count: number): void;
  /**
   * Set or clear the selected item. Validates its argument, pinned by
   * "setSelectedItem validates its argument" in
   * `src/core/__tests__/shellApi.test.ts`.
   */
  setSelectedItem(id: string | null): void;
}

/** The empty context: nothing active, nothing selected, nothing focused. */
const EMPTY_CONTEXT: Readonly<RibbonContext> = Object.freeze({
  activeExtensionId: null,
  activeNavNodeId: null,
  selectedItemId: null,
  focusedPane: null,
});

/** A context under construction. Frozen into a `RibbonContext` before it escapes. */
type MutableRibbonContext = { -readonly [K in keyof RibbonContext]: RibbonContext[K] };

/**
 * Badge scope for `createShellAPI`, the unscoped host-side facade.
 *
 * `EXTENSION_ID_PATTERN` admits neither `_` nor `:`, so this string can never be
 * a registered extension id and can never be produced by concatenating one with
 * a node id. Host badge writes therefore land in a scope no extension's own
 * `setBadgeCount` can name, and so cannot collide with or overwrite an
 * extension's badges.
 *
 * **This is collision-resistance, not confinement, and not secrecy.**
 * `useShellStore()` is public — see `patchContext` above and ADR-0001 — so any
 * code inside the provider can call `getBadgeCount('__host__', nodeId)` and read
 * a host badge, or `setBadgeCount('__host__', ...)` and write one, and the same
 * is true of any extension's scope. What the scoping delivers is that two
 * extensions which both name a node `inbox` cannot collide, and that the scope is
 * not a parameter of the facade an extension holds. It does not confine anything.
 *
 * Both halves are pinned. The collision-resistance: "keeps two extensions that both
 * use the node id \"inbox\" apart" and "does not let an extension name the scope it
 * writes to" in `src/core/__tests__/dataflow.test.tsx`. The absence of confinement:
 * "reaches the host ActivationController by reflection anyway, and steals a sibling
 * handle" in `src/core/__tests__/reflection.test.tsx`, which reads another scope's
 * badge back out of the store.
 */
const HOST_BADGE_SCOPE = '__host__';

/**
 * Compose the badge key for one extension's node.
 *
 * **Both components must already have been proven to be primitive strings.** This
 * interpolates, and interpolation consults `Symbol.toPrimitive`, `toString` and
 * `valueOf` — so calling this with an unproven value runs plugin code inside the
 * host, or throws a raw `TypeError` out of a function contracted to throw
 * `ShellUXError`. **Both** call sites validate first — `getBadgeCount` and
 * `setBadgeCount`, which are the only two functions that reach this one; an earlier
 * version of this sentence said "all four", which counted arguments rather than
 * callers. That validation is the only reason this line is allowed to exist in a
 * module whose banner forbids exactly it, and it is pinned by "the badge scope and
 * node id are validated at both doors" in `src/core/__tests__/shellApi.test.ts`.
 *
 * The two components are unambiguous once validated: `EXTENSION_ID_PATTERN`
 * excludes `:` from both an extension id and a node id, and `HOST_BADGE_SCOPE`
 * contains none either, so the first `:` is always the separator. `("a", "b:c")`
 * and `("a:b", "c")` are not both constructible.
 */
function badgeKey(extensionId: string, nodeId: string): string {
  return `${extensionId}:${nodeId}`;
}

/**
 * Assert that `value` is an identifier the host may use as a lookup key.
 *
 * Every such identifier — a badge node id, `activeExtensionId`,
 * `activeNavNodeId` — is held to exactly the rules the registry applied when it
 * accepted the corresponding node, using the same allowlist and the same
 * reserved words, imported rather than restated so the two can never drift
 * apart. `RegistryContext` imports nothing from this module, so the dependency
 * runs one way only. Pinned by "patchContext validates the two identifier fields" in
 * `src/core/__tests__/contextPatch.test.ts` and by "validateBlueprint — identifier
 * hardening" in `src/core/__tests__/validation.test.ts`, which is the registry end
 * of the same allowlist.
 *
 * `value` is `unknown` on purpose. Every caller sits on a trust boundary: the
 * caller may be plain JavaScript, so the runtime value can be anything whatever
 * the declared parameter type says. The type check therefore comes first and its
 * message names only the type — that path is reached *precisely when* the value
 * is not a string, which is exactly when stringifying it is dangerous.
 *
 * `nullable` says whether the field being checked admits `null`; the two
 * messages differ only in saying so, and neither one reads the value.
 */
function assertValidIdentifier(
  value: unknown,
  method: string,
  field: string,
  nullable: boolean,
): void {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_ID',
      `${method}: "${field}" must be a ${nullable ? 'string or null' : 'string'}; received ${describeUntrusted(value)}.`,
      field,
    );
  }
  if (RESERVED_IDS.has(value) || !EXTENSION_ID_PATTERN.test(value)) {
    // `value` is a primitive string here, so interpolating it is safe.
    throw new ShellUXError(
      'INVALID_ID',
      `${method}: "${field}" must match ${String(EXTENSION_ID_PATTERN)} and must not be a reserved identifier; received "${value}".`,
      field,
    );
  }
}

/**
 * Badge node ids are host lookup keys and are never `null`.
 *
 * `method` is a parameter because both badge doors reach here — the write and the
 * read — and a rejection has to name the one the caller actually used.
 */
function assertValidNodeId(nodeId: unknown, method: string): void {
  assertValidIdentifier(nodeId, method, 'nodeId', false);
}

/**
 * Assert that `value` is a badge scope this store may key on.
 *
 * That is either a registry-valid extension id or `HOST_BADGE_SCOPE` itself,
 * which `EXTENSION_ID_PATTERN` deliberately rejects and which `createShellAPI`
 * writes through. The `===` against a primitive string invokes nothing — no
 * `toString`, no `Symbol.toPrimitive`, no Proxy trap — so it is safe to run
 * before the type check.
 *
 * `value` is `unknown` because every caller sits on a trust boundary: the store's
 * members are reachable from plain-JavaScript plugin code through the public
 * `useShellStore()`, so the declared `string` parameter proves nothing at runtime.
 */
function assertValidBadgeScope(value: unknown, method: string): void {
  if (value === HOST_BADGE_SCOPE) {
    return;
  }
  assertValidIdentifier(value, method, 'extensionId', false);
}

/**
 * The selected item id is the extension's own identifier for a row in its own
 * view. The host never uses it as a lookup key, so it is deliberately NOT held
 * to `EXTENSION_ID_PATTERN` — that would break every extension whose records
 * are keyed by a GUID, a path or a number-as-string.
 *
 * Its TYPE is enforced, though, at every door that reaches the field — both
 * `setSelectedItem` and `patchContext`, which is why the method and field names
 * are parameters rather than literals. `RibbonContext.selectedItemId` is declared
 * `string | null` and is handed to other extensions' predicates and handlers;
 * letting an arbitrary object through would make the declaration false at
 * runtime and give one plugin a channel for injecting a live object — with
 * getters, with a prototype — into another plugin's code. Rejecting is
 * consistent with `setBadgeCount`: these are called BY the extension, so a bad
 * argument is the extension's own bug and is reported as an exception. Coercing
 * silently to `null` would hide that bug behind a selection that mysteriously
 * never sticks.
 *
 * Pinned at both doors: "patchContext rejects what setSelectedItem rejects" in
 * `src/core/__tests__/contextPatch.test.ts`, and "setSelectedItem validates its
 * argument" in `src/core/__tests__/shellApi.test.ts`.
 */
function assertValidSelectedItemId(value: unknown, method: string, field: string): void {
  if (value !== null && typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be a string or null; received ${describeUntrusted(value)}.`,
      field,
    );
  }
}

/** The pane ids, as text, for a rejection message. Built once, from the union. */
const PANE_ID_LIST = Array.from(PANE_IDS).join(', ');

/**
 * Assert that `value` is a `PaneId` or `null`.
 *
 * `PaneId` is a type union and vanishes at runtime, so the check runs against
 * `PANE_IDS` — the membership set pinned to the union in `types.ts`. Without it
 * `focusedPane` was declared `PaneId | null` and would hold any string a plugin
 * chose, which every `switch` over the union downstream would then fall through.
 *
 * Pinned by "patchContext validates focusedPane against the real PaneId union" in
 * `src/core/__tests__/contextPatch.test.ts`.
 */
function assertValidPaneId(value: unknown, method: string, field: string): void {
  if (value === null) {
    return;
  }
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be a pane id or null; received ${describeUntrusted(value)}.`,
      field,
    );
  }
  if (!PANE_IDS.has(value)) {
    // `value` is a primitive string here, so interpolating it is safe.
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be one of ${PANE_ID_LIST}, or null; received "${value}".`,
      field,
    );
  }
}

/** Checks one context field's value, or throws `ShellUXError`. */
type ContextFieldValidator = (value: unknown, method: string, field: string) => void;

/**
 * Exhaustiveness pin for `CONTEXT_KEYS` **and** the validation table every write
 * to the context goes through.
 *
 * The shape is the same as `SHELL_UX_ERROR_CODE_MEMBERS` in `types.ts`:
 * `Record<keyof RibbonContext, ...>` makes the compiler reject both a field this
 * module forgot and one it invented. Making the value a validator rather than
 * `true` extends that to the check itself — a field added to `RibbonContext`
 * cannot become patchable without someone deciding, in this table, what a legal
 * value for it is.
 */
const CONTEXT_FIELDS: Readonly<Record<keyof RibbonContext, ContextFieldValidator>> = Object.freeze({
  // Both of these are registry-validated identifiers everywhere else in the
  // host, so they are held to the registry's own rule here.
  activeExtensionId: (value, method, field): void =>
    assertValidIdentifier(value, method, field, true),
  activeNavNodeId: (value, method, field): void => assertValidIdentifier(value, method, field, true),
  // Opaque to the host: type only. See `assertValidSelectedItemId`.
  selectedItemId: assertValidSelectedItemId,
  focusedPane: assertValidPaneId,
});

/** The context's own fields, and the only keys `patchContext` will read. */
const CONTEXT_KEYS = Object.keys(CONTEXT_FIELDS) as readonly (keyof RibbonContext)[];

/**
 * How deep a notification cascade may go before the store refuses to follow it.
 *
 * A listener is a signal to re-read, never a place to write. A listener that
 * writes re-enters `applyPatch`, which notifies again, which calls it again: an
 * unbounded recursion whose natural end is a `RangeError` from a blown stack,
 * thrown at a frame that names nothing useful. The cap converts that into a
 * `ShellUXError` with code `REENTRANT_NOTIFY` raised at the offending write, which
 * says what happened. No legitimate cascade is anywhere near this deep — the host
 * writes the context from event handlers and effects, not from listeners. Pinned by
 * "refuses a runaway write cascade with a typed error, not a RangeError" and
 * "recovers after a cascade is refused, rather than staying convinced it is
 * mid-notify" in `src/core/__tests__/contextPatch.test.ts`.
 *
 * **The cap bounds a RUNAWAY, and nothing narrower.** It is not a defence against a
 * listener that writes ONCE: one shallow cascade is legal and deliberately allowed
 * ("lets a shallow write from a listener through"), which is what makes suppression
 * of another holder's write reachable — see `subscribe` above and
 * `src/core/__tests__/subscribe.test.tsx`.
 */
const MAX_NOTIFY_DEPTH = 16;

/**
 * Create the mutable state store that backs an `IShellAPI`.
 *
 * ============================================================================
 * WHAT THIS STORE GUARANTEES, AND WHERE THE GUARANTEE STOPS
 * ============================================================================
 * Three vocabulary terms are used precisely across this repository: **integrity
 * control** (real and unconditional, holding against any caller however hostile),
 * **entry-point validation** (real at the documented door, bypassable by a caller
 * who reaches internals another way), and **guardrail** (prevents honest mistakes
 * only). This function earns the first, for a claim narrower than the one that
 * used to be written here.
 *
 * **The claim: this store cannot be subverted.** Two halves, both unconditional.
 *
 * *Its state is unreachable.* `context`, `badgeCounts`, `listeners` and
 * `notifyDepth` are **closure variables**. JavaScript has no reflective API for a
 * scope: no `Object.keys` for a closure, no `Reflect` operation that enumerates
 * one, nothing on a function object that exposes what it captured. A caller who
 * walks React's fiber tree — which is possible, and is pinned by
 * `src/core/__tests__/reflection.test.tsx` ("never reaches the badge map itself,
 * because it is a closure variable") — obtains the six METHODS and never the state
 * behind them.
 *
 * *Its methods are its own.* The returned object is **frozen**, so no holder can
 * replace, delete or add a member. Every one of the six validates its arguments.
 * Therefore no caller can put a value of the wrong shape into this store's
 * context: every value that enters the context through this store is well-typed,
 * for any caller however hostile. Pinned by `reflection.test.tsx` ("gets the store
 * methods, cannot replace one, and cannot put an illegal value through one") and by
 * `capability.test.tsx` ("the store handed out by useShellStore is frozen").
 *
 * **That is the whole of it, and a wider clause used to be appended here.** The
 * sentence went on: "and no caller can intercept, suppress or forge the writes and
 * reads another holder makes through it." **False, and the freeze is irrelevant to
 * it.** `subscribe` is one of the six frozen members, it is reachable through the
 * public `useShellStore()`, and it runs plug-in code SYNCHRONOUSLY INSIDE ANOTHER
 * HOLDER'S WRITE. Nothing is replaced, so nothing the freeze does applies. The real
 * limit, stated plainly: **a listener is a synchronous call into untrusted code
 * inside another holder's write; it can observe, it can re-enter, and it can throw
 * into the writer's frame** — including a non-`ShellUXError`, and including a throw
 * that starves every listener ordered after it. All four behaviours are reproduced
 * and pinned in `src/core/__tests__/subscribe.test.tsx`; see the `subscribe`
 * docblock above. This was the same error shape as the one corrected two paragraphs
 * down — a conclusion written one step wider than the premise that licenses it —
 * and ADR-0001 Amendment G is the rule installed to stop it recurring.
 *
 * **The freeze was missing until it was reported, and the claim was being made
 * without it.** This banner previously read "THE STRONGEST TRUE CLAIM IN THIS
 * CODEBASE" and concluded that `RibbonContext`'s declared types are "true at
 * runtime for every caller however hostile". The object was a plain mutable
 * literal. `useShellStore()` is public by design, so a plugin view rendering
 * inside the provider assigned over `setSelectedItem` and swallowed another
 * extension's writes, over `getContext` and forged what a victim pane read, and
 * over `patchContext` and made the host's own foreground publication evaporate.
 * No reflection was required — that was the documented public API. The argument
 * ran from "the state is unreachable" to a conclusion about the methods, and the
 * methods were not covered by the premise.
 *
 * **Where the guarantee stops, stated so it is not extrapolated again.** It is a
 * claim about THIS OBJECT, not a claim about what an arbitrary component is
 * handed. The store is published through React context, and a caller who can
 * reach hook state on a fiber can reach a published context value the same way —
 * substituting a counterfeit object there is not something this code prevents, and
 * nothing in-page can (ADR-0001 Amendment E). So: every value that enters the
 * context THROUGH this store has been validated, for every caller however hostile.
 * Whether a given consumer is reading this store is a different question, and this
 * function does not answer it.
 *
 * Nor is any of this confidentiality: the store holds nothing secret, and reading
 * or writing any scope through it is possible for anything inside the provider.
 * See `useShellStore` and ADR-0001.
 * ============================================================================
 *
 * @param initial Optional seed for the context. Anything omitted starts `null`.
 *   It is validated exactly as a `patchContext` call would be.
 */
export function createShellStateStore(initial?: Partial<RibbonContext>): ShellStateStore {
  let context: Readonly<RibbonContext> = EMPTY_CONTEXT;
  // A Map, never an object literal: badge keys come from plugin-supplied node
  // ids, and a Map has no prototype chain to pollute.
  const badgeCounts = new Map<string, number>();
  const listeners = new Set<() => void>();
  // Depth of the notification cascade currently in flight; see MAX_NOTIFY_DEPTH.
  let notifyDepth = 0;

  // Every member is a standalone function rather than a `this`-dependent
  // method, so `store.subscribe` and `store.getContext` can be handed to
  // `useSyncExternalStore` unbound without losing their receiver.
  function getContext(): Readonly<RibbonContext> {
    return context;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  }

  /**
   * Tell every listener registered when this pass began that something changed.
   *
   * Two things it deliberately does not do.
   *
   * **It does not iterate the live `Set`.** A listener is free to subscribe or
   * unsubscribe while it runs, and mutating a `Set` mid-iteration is exactly the
   * case where "what does this loop visit?" has no useful answer: a listener
   * added during the pass would be called by the pass that had already started,
   * before the change it was registered for. The pass therefore runs over a
   * snapshot, and re-checks membership before each call so a listener that
   * unsubscribed earlier in the SAME pass is not called after its unsubscribe
   * returned. Added-during-pass is not called; removed-during-pass is not called.
   * Both pinned under "notify" in `src/core/__tests__/contextPatch.test.ts`.
   *
   * **It does not recurse without limit.** See `MAX_NOTIFY_DEPTH`.
   *
   * **A third thing it deliberately does not do is CONTAIN a listener.** A throw
   * aborts the pass, so listeners ordered after the thrower are not notified and the
   * throw reaches the writer. That is reachable, documented on `subscribe`, and
   * pinned in `src/core/__tests__/subscribe.test.tsx`. Swallowing it here would mean
   * the writer could not tell a completed notification from a starved one, which is
   * worse; the one call site with nowhere to raise it TO is guarded in
   * `ActivationContext.tsx` instead.
   */
  function notify(): void {
    if (notifyDepth >= MAX_NOTIFY_DEPTH) {
      throw new ShellUXError(
        'REENTRANT_NOTIFY',
        `A shell store listener wrote back to the store, and the notification cascade reached the limit of ${MAX_NOTIFY_DEPTH}. A listener is a signal to re-read the context, not a place to write to it.`,
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
      // Restored even when a listener throws, so one bad listener cannot leave
      // the store permanently convinced it is mid-cascade.
      notifyDepth -= 1;
    }
  }

  /**
   * Validate `patch`, apply it field by field, and notify only if something
   * moved.
   *
   * `method` names the caller in any rejection message, because this one function
   * is the single door onto the context: the public `patchContext`, the seed
   * passed to `createShellStateStore`, and `setSelectedItem` all arrive here.
   *
   * **Validation is not optional and not the caller's job.** `patchContext` is
   * reachable from plugin code through the public `useShellStore()`, so every
   * value that lands in the context is untrusted until this function has checked
   * it against `CONTEXT_FIELDS`. The validators themselves read nothing: they
   * describe by `typeof` and interpolate only a value already proven to be a
   * primitive string.
   *
   * **Reaching the value is itself a call into plugin code, though**, and an
   * earlier version of this comment claimed "nothing here reads an untrusted
   * value" without qualification, which was false. Two operations re-enter code
   * the plugin wrote: `Object.hasOwn` consults a `getOwnPropertyDescriptor` trap,
   * and `patch[key]` consults a `get` trap or an own getter. All four were
   * reproduced escaping raw — a throwing descriptor trap, a throwing `get` trap, a
   * throwing own getter, and a revoked `Proxy`, whose `TypeError` is not an
   * exception a caller of a `@throws {ShellUXError}` function was told to expect.
   * Both operations are therefore guarded, and a patch that refuses to be read is
   * an `INVALID_PAYLOAD` rejection naming the field that refused. Pinned by
   * "patchContext survives a patch that refuses to be inspected" in
   * `src/core/__tests__/contextPatch.test.ts`, which covers all four.
   *
   * **It is all-or-nothing.** The draft is a local and `context` is replaced only
   * after the loop, so a patch whose second field is rejected — or whose second
   * field refuses to be read at all — does not apply its first, and does not
   * notify. Pinned by "applies none of a patch whose later field is rejected" and
   * "applies none of a patch whose later field refuses to be read", same file.
   *
   * The equality check is the other point. Allocating a new frozen object
   * unconditionally — which is what this used to do — gave the context a new
   * IDENTITY on every write, including a write that set a field to the value it
   * already held. Every downstream `useMemo`/`useSyncExternalStore` keyed on the
   * snapshot was then invalidated by a no-op, which both defeats memoisation and
   * makes a "did anything change?" question unanswerable. `Object.is` per field
   * — not a shallow object compare — is what decides, so `NaN` and `-0` behave
   * the way React's own bail-out does.
   */
  function applyPatch(patch: Partial<RibbonContext>, method: string): void {
    // The declared type says "object"; a plain-JavaScript caller can pass
    // anything, and `Object.hasOwn(null, k)` is a raw `TypeError` out of a
    // function contracted to throw `ShellUXError`. Checked as `unknown`, and
    // reported by type alone.
    const candidate: unknown = patch;
    if (typeof candidate !== 'object' || candidate === null) {
      throw new ShellUXError(
        'INVALID_PAYLOAD',
        `${method}: the patch must be an object; received ${describeUntrusted(candidate)}.`,
        null,
      );
    }

    let draft: MutableRibbonContext | null = null;
    for (const key of CONTEXT_KEYS) {
      // `Object.hasOwn`, never `key in patch`: `in` walks the prototype chain, so
      // `patchContext(Object.create({ selectedItemId: 'x' }))` would apply a
      // value the caller never put on the patch — and a plugin can choose that
      // prototype.
      //
      // Guarded because `Object.hasOwn` runs a `getOwnPropertyDescriptor` trap,
      // which is plugin code and is free to throw anything — a revoked `Proxy`
      // throws a raw `TypeError` here.
      let present: boolean;
      try {
        present = Object.hasOwn(candidate, key);
      } catch {
        throw new ShellUXError(
          'INVALID_PAYLOAD',
          `${method}: the patch refused to say whether it has a "${key}" of its own. Nothing was applied.`,
          key,
        );
      }
      if (!present) {
        continue;
      }
      // Guarded for the same reason: this is a `get` trap or an own getter, and
      // the throw would otherwise escape untyped. Read exactly once, into a local.
      let supplied: unknown;
      try {
        supplied = patch[key];
      } catch {
        throw new ShellUXError(
          'INVALID_PAYLOAD',
          `${method}: reading "${key}" off the patch threw. Nothing was applied.`,
          key,
        );
      }
      // `undefined` means "no value", and every context field spells that `null`.
      // Writing `undefined` through would report a change that did not happen —
      // `Object.is(null, undefined)` is `false` — and would put `undefined` in a
      // field declared `string | null`, making the declared type a runtime lie for
      // every other extension that reads the snapshot.
      const value: unknown = supplied === undefined ? null : supplied;
      CONTEXT_FIELDS[key](value, method, key);
      if (Object.is(context[key], value)) {
        continue;
      }
      // Allocated on first real change and not before.
      draft ??= { ...context };
      (draft as Record<string, unknown>)[key] = value;
    }
    if (draft === null) {
      // Nothing changed: no allocation, so the snapshot keeps its identity, and
      // no notify, so no subscriber re-renders.
      return;
    }
    context = Object.freeze(draft);
    notify();
  }

  function patchContext(patch: Partial<RibbonContext>): void {
    applyPatch(patch, 'patchContext');
  }

  function getBadgeCount(extensionId: string, nodeId: string): number | undefined {
    // Both, and before the key is built. This door used to check neither, and it
    // is a door plugin code can reach.
    assertValidBadgeScope(extensionId, 'getBadgeCount');
    assertValidNodeId(nodeId, 'getBadgeCount');
    return badgeCounts.get(badgeKey(extensionId, nodeId));
  }

  function setBadgeCount(extensionId: string, nodeId: string, count: number): void {
    assertValidBadgeScope(extensionId, 'setBadgeCount');
    assertValidNodeId(nodeId, 'setBadgeCount');
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new ShellUXError(
        'INVALID_FIELD',
        'setBadgeCount: "count" must be a non-negative safe integer.',
        'count',
      );
    }
    // Keyed by scope, so two extensions that both call their root node "inbox"
    // write to two different entries instead of overwriting each other.
    badgeCounts.set(badgeKey(extensionId, nodeId), count);
    // Badges are not part of the context snapshot, so `useShellContext` bails
    // out on its own unchanged snapshot. The notify is still correct — the store
    // changed — and it is what a future badge-aware selector will subscribe to.
    notify();
  }

  function setSelectedItem(id: string | null): void {
    // Checked here as well as inside `applyPatch`, and deliberately so: this is
    // the door an extension calls, so the rejection has to name the parameter the
    // extension actually passed — `"id"`, not `"selectedItemId"`. `applyPatch`
    // re-checks the same value under its own field name and finds it good.
    assertValidSelectedItemId(id, 'setSelectedItem', 'id');
    // Validated before it is written, so the frozen snapshot handed to other
    // extensions can never hold anything but a string or null. Routed through
    // `applyPatch` so that re-selecting the already-selected item is the no-op
    // it should be.
    applyPatch({ selectedItemId: id }, 'setSelectedItem');
  }

  if (initial !== undefined) {
    applyPatch(initial, 'createShellStateStore');
  }

  // Frozen, and for the same reason `createRevocableShellAPI` deep-freezes the
  // facade it returns: this object crosses a trust boundary. `useShellStore()` is
  // public, so a plugin view rendering inside the provider holds this exact
  // instance — the one the host and every other extension's facade write through.
  // Unfrozen, a plugin could assign over `setSelectedItem` and record or discard
  // another extension's writes, over `getContext` and forge what a victim pane
  // reads, or over `patchContext` and make the host's own foreground publication
  // evaporate. None of that needed reflection; it was the documented public API.
  //
  // `Object.freeze`, not `deepFreeze`: the members are host-written functions with
  // nothing underneath them worth walking, and a shallow freeze is exactly the
  // property being bought — the six bindings cannot be replaced, deleted, or
  // added to. Pinned by "the store handed out by useShellStore is frozen" in
  // `capability.test.tsx` and "the store object cannot be rewired" in
  // `shellApi.test.ts`.
  //
  // What the freeze does NOT buy is that calls through the object are private:
  // `subscribe` is one of the six, it is public, and it runs plug-in code inside
  // another holder's write. See its docblock and `subscribe.test.tsx`.
  return Object.freeze({
    getContext,
    subscribe,
    patchContext,
    getBadgeCount,
    setBadgeCount,
    setSelectedItem,
  });
}

/**
 * A per-extension `IShellAPI` and the host's handle for switching it off.
 *
 * The two halves are deliberately separate objects. `api` goes DOWN to the
 * plugin; `revoke` stays with the host.
 */
export interface RevocableShellAPI {
  /** The deep-frozen facade to hand to the extension. */
  readonly api: IShellAPI;
  /**
   * Permanently disable `api`. Idempotent.
   *
   * **Not on `api`, and not reachable from it.** It is a property of THIS wrapper,
   * and it closes over a variable no other scope can reach, so a plugin holding
   * `api` has no route to it: `Object.keys(api)` is exactly the three `IShellAPI`
   * members and there is no fourth. That much is an integrity control and holds
   * against any caller, and it is pinned by "does not expose revoke to the plugin"
   * in `src/core/__tests__/dataflow.test.tsx`.
   *
   * **It is not therefore host-only.** An earlier version of this comment
   * concluded that a plugin "cannot revoke itself, and cannot revoke another
   * extension", which does not follow. Whoever holds the wrapper holds `revoke`,
   * and `ShellHostProvider` keeps every wrapper in a `useRef` — which is hook
   * state on a fiber, reachable by reflection from any script on the page. See
   * `src/core/__tests__/reflection.test.tsx`, which performs it, and ADR-0001
   * Amendment E. What this member guarantees is that the reachability is not
   * through `api`; between-extension isolation is not something this architecture
   * delivers.
   */
  revoke(): void;
}

/**
 * Build the deep-frozen, per-extension, revocable `IShellAPI` for `extensionId`.
 *
 * Two properties beyond `createShellAPI`:
 *
 * **1. Badge writes are scoped, and the plugin cannot name the scope.**
 * `extensionId` is captured from the host at mint time and read from this
 * closure on every call. It is not a parameter of `setBadgeCount`, so passing an
 * extra argument — another extension's id, say — reaches nothing: `IShellAPI`
 * declares two parameters and the implementation reads two. That is
 * collision-resistance: it is what stops two vendors' `inbox` badges from
 * overwriting each other. It is not confinement, because the unscoped store
 * behind the facade is public. Pinned by "does not let an extension name the scope
 * it writes to" in `src/core/__tests__/dataflow.test.tsx`.
 *
 * `extensionId` is validated here rather than trusted, because it is
 * interpolated into the `REVOKED` message below. It must be a registry-valid
 * identifier or `HOST_BADGE_SCOPE`; anything else is a `ShellUXError` before the
 * facade exists at all. The host passes an id the registry already accepted, so
 * this only ever fires on a host bug — which is exactly when a raw `TypeError`
 * from a `Symbol`, or an attacker's `toString` running inside the host, would be
 * hardest to trace.
 *
 * **2. Revocation fails loudly.** After `revoke()` every member throws
 * `ShellUXError` with code `REVOKED` and changes nothing. It is deliberately not
 * a silent no-op: a released handle in the hands of a plugin that kept a
 * reference is a bug in that plugin, and a state write that silently evaporates
 * is far harder to diagnose than an exception at the call site. Pinned by "mints a
 * live IShellAPI on activation and revokes it on release" in
 * `src/core/__tests__/dataflow.test.tsx`.
 *
 * **3. Liveness is re-checked at every call, not only when `revoke` is called.**
 * `isLive` is the host's answer to "does this extension still exist?", consulted
 * on entry to every member. It exists because the host's other end of revocation
 * is asynchronous: `ShellHostProvider` sweeps its live map from a `useEffect`, so
 * an extension unregistered in a click handler was still writing through a live
 * handle for the rest of that handler and across an `await` — one commit's worth
 * of a window in which "unregistered means revoked" was false. Asking at call
 * time closes it, synchronously and without the registry needing to know that
 * activation exists. Pinned by "revocation on unregister is synchronous" in
 * `src/core/__tests__/capability.test.tsx`.
 *
 * The observation LATCHES: the first call that finds `isLive()` false marks the
 * handle revoked permanently. **The latch is a convenience, not the guarantee**,
 * and this comment used to claim otherwise — that latching was what stopped a
 * re-registration from resurrecting a handle. It cannot be: a handle nobody
 * happened to call during the gap has nothing to latch on, so everything rests on
 * what `isLive` actually asks. `ShellHostProvider` therefore keys it on the
 * host-owned blueprint record the handle was minted against, not on the id being
 * present — see `ActivationContext.tsx`. Same id plus a different record is a
 * different extension, and the predicate says so on the very first call. Pinned by
 * "re-registering an id does not resurrect the previous handle" in
 * `src/core/__tests__/capability.test.tsx`.
 *
 * The default — for `createShellAPI`, the unscoped host facade, whose liveness is
 * its store's — is a predicate that is always true.
 */
export function createRevocableShellAPI(
  store: ShellStateStore,
  extensionId: string,
  isLive: () => boolean = (): boolean => true,
): RevocableShellAPI {
  // Before anything else, and before the closure captures it: the `REVOKED`
  // message interpolates this value, so it has to be provably a primitive string.
  assertValidBadgeScope(extensionId, 'createRevocableShellAPI');
  let revoked = false;

  function assertLive(method: string): void {
    // Order matters: once revoked, `isLive` is not consulted again. It reaches
    // into the host's registry, and a handle already known to be dead has no
    // business asking anything.
    if (!revoked && !isLive()) {
      revoked = true;
    }
    if (revoked) {
      throw new ShellUXError(
        'REVOKED',
        `${method}: this IShellAPI was revoked when extension "${extensionId}" was released or unregistered, and no longer reaches the shell.`,
        null,
      );
    }
  }

  const api: IShellAPI = {
    setSelectedItem(id: string | null): void {
      assertLive('setSelectedItem');
      store.setSelectedItem(id);
    },

    setBadgeCount(nodeId: string, count: number): void {
      assertLive('setBadgeCount');
      // `extensionId` from the closure, never from the caller.
      store.setBadgeCount(extensionId, nodeId, count);
    },

    getContext(): Readonly<RibbonContext> {
      assertLive('getContext');
      return store.getContext();
    },
  };

  return {
    api: deepFreeze(api),
    revoke: (): void => {
      revoked = true;
    },
  };
}

/**
 * Build the deep-frozen `IShellAPI` facade handed down to a plugin.
 *
 * Freezing matters because the instance crosses a trust boundary: without it a
 * plugin could reassign `setSelectedItem` and observe or suppress calls made by
 * the host or by other plugins holding the same instance. Frozen, an
 * assignment throws in strict mode (all ES modules are strict) and is a silent
 * no-op in sloppy mode — in neither case does the method actually change. Pinned by
 * "is deep-frozen: strict-mode reassignment throws", "is deep-frozen: sloppy-mode
 * reassignment is a silent no-op" and "cannot have its prototype swapped" in
 * `src/core/__tests__/shellApi.test.ts`.
 *
 * **This is a claim about METHOD REPLACEMENT on this instance and nothing wider.**
 * It does not follow that calls through this instance are unobservable: every write
 * reaches the store, the store notifies synchronously, and `subscribe` is public —
 * so a listener sees the write and can throw back into this method's frame. See
 * `ShellStateStore.subscribe` and `src/core/__tests__/subscribe.test.tsx`.
 *
 * This is the UNSCOPED, UNREVOCABLE facade: badge writes through it land in
 * `HOST_BADGE_SCOPE`, which no extension id can name, and the `revoke` handle is
 * discarded rather than returned, so the instance stays live for as long as its
 * store does. It is for host-side code and for extension authors' own test
 * doubles. The handle an extension actually receives is minted by
 * `createRevocableShellAPI` through `ShellHostProvider`, which keeps `revoke`.
 */
export function createShellAPI(store: ShellStateStore): IShellAPI {
  return createRevocableShellAPI(store, HOST_BADGE_SCOPE).api;
}

/* -------------------------------------------------------------------------- */
/* React binding                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The one host-owned store, published to the whole shell subtree.
 *
 * `null` outside a provider so `useShellStore` fails loudly instead of inventing
 * a second store. A per-consumer default store would be the original defect
 * wearing a disguise: every pane would read and write its own state and none
 * would ever observe another's writes.
 *
 * Exported only so that `ShellHostProvider` — which owns the store's lifetime,
 * and is the reason this lives in a `.ts` file with no JSX — can supply it.
 * Nothing else should provide it.
 */
export const ShellStoreContext = createContext<ShellStateStore | null>(null);

/**
 * The host-owned store for the surrounding `ShellHostProvider`.
 *
 * Its identity is stable for the provider's whole lifetime, so it is safe in a
 * dependency array.
 *
 * **This is public, and that includes to plugin code.** A plugin view renders
 * inside the provider, so it can call this and obtain the raw, unscoped,
 * unrevocable store — bypassing its own facade. ADR-0001 records that as an
 * accepted limit of a no-sandbox architecture rather than a hole to be plugged;
 * what follows from it is that the store's own members are a trust boundary and
 * validate their arguments, which is why `patchContext` is checked field by field
 * and `setBadgeCount` is checked at all. Pinned by "the store handed out by
 * useShellStore is frozen" in `src/core/__tests__/capability.test.tsx`, which
 * reaches this exact store from inside a plug-in subtree, and by "useShellStore
 * refuses to invent a second store" in `src/core/__tests__/hostProvider.test.tsx`.
 *
 * The one member whose reachability from here matters most is `subscribe`: read its
 * docblock before concluding anything about what a holder of this store can observe.
 *
 * @throws when called outside `ShellHostProvider`.
 */
export function useShellStore(): ShellStateStore {
  const store = useContext(ShellStoreContext);
  if (store === null) {
    throw new Error('useShellStore must be called inside a <ShellHostProvider>.');
  }
  return store;
}

/**
 * Subscribe to the host context. Re-renders the calling component whenever the
 * context actually changes, and not when it does not.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect: under React 18
 * concurrent rendering a store read taken during render can be stale by the time
 * the tree commits, and two panes reading at different points would then show
 * different selections — tearing. `useSyncExternalStore` is the hook React
 * provides to close exactly that window; it re-checks the snapshot before commit
 * and re-renders synchronously if it moved. Every subscriber that RE-READS therefore
 * reads one snapshot object, so two panes cannot show two different values of the
 * same field for the same commit. That is tearing, and it is pinned by "gives every
 * subscriber the same snapshot, so panes cannot tear" in
 * `src/core/__tests__/dataflow.test.tsx`.
 *
 * **It is not a claim that every pane is told.** `subscribe` is public and a
 * notification pass is aborted by the first listener that throws, so a hostile
 * listener registered ahead of a pane starves it and the pane keeps rendering a
 * stale snapshot until something else re-renders it. Reproduced as "desynchronises a
 * victim pane that subscribed through useShellContext" in
 * `src/core/__tests__/subscribe.test.tsx`.
 *
 * @throws when called outside `ShellHostProvider`.
 */
export function useShellContext(): Readonly<RibbonContext> {
  const store = useShellStore();
  return useSyncExternalStore(store.subscribe, store.getContext);
}
