import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import {
  EXTENSION_ID_PATTERN,
  REGISTRY_LIMITS,
  RESERVED_IDS,
  clampMetricValue,
  normalizeNavigationTree,
} from './RegistryContext';
import type {
  BlockKind,
  ContextKeyValue,
  IShellAPI,
  NavigationNode,
  RibbonContext,
  StructuredPayload,
} from './types';
import { ShellUXError } from './types';
import { createPayloadChannelStore } from './payload/PayloadChannel';
import type { PayloadChannelStore } from './payload/PayloadChannel';
import { createThemeBridge } from './theme/ThemeBridge';
import type { ThemeBridgeStore } from './theme/ThemeBridge';
import type { ResolvedTheme } from './theme/normalizeTheme';

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
   *  - **It observes, WITHIN ONE RENDERER.** `listener` runs after the commit and
   *    BEFORE the writing statement returns, so it reads every value any other
   *    holder IN THE SAME REALM writes — including one writing through its own
   *    deep-frozen `IShellAPI`. See "sees the new value synchronously, before the
   *    writer returns, within one renderer". The scope qualifier is not
   *    decoration; see the correction below.
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
   *
   * --------------------------------------------------------------------------
   * **CORRECTION — THE SYNCHRONOUS GUARANTEE IS SCOPED TO ONE RENDERER.**
   * --------------------------------------------------------------------------
   * The three bullets above are stated as though every holder of every handle
   * were in one realm, which was true when they were written and is not once
   * `src/core/ipc/**` puts a replica in each renderer. Across renderers the
   * guarantee is FALSE: pane 2's write is applied and notified locally, then
   * posted, and pane 3's listeners run when the commit arrives — a message
   * later. So a listener does NOT read every value any other holder writes; it
   * reads every value written IN ITS OWN REALM, and learns about the rest
   * afterwards.
   *
   * **The security consequence runs the favourable way, which is why this is a
   * correction rather than a regression.** A listener can no longer throw into
   * ANOTHER PANE'S writer frame, because across the boundary there is no shared
   * frame to throw into — the third bullet's "it throws into the writer's frame"
   * narrows to the writer's own realm. What is lost with it is the assumption
   * that a cross-pane read is instantaneous, which no correct consumer should
   * have been making. *Tests:*
   * `src/core/ipc/__tests__/replicaStore.test.ts` — "a listener runs before the
   * writing statement returns, within the writing renderer" and "a listener in
   * another renderer does not run before the writing statement returns, and
   * cannot throw into it".
   * ==========================================================================
   *
   * **`listener` itself is validated, and it did not used to be.** Everything
   * above is about what a listener may DO once registered — all of it still
   * true, none of it closable. This is the narrower point underneath it: the
   * ARGUMENT must be a function. It is checked, because a `Set` accepts
   * `undefined` happily and `notify` then calls it, which raised a raw
   * `TypeError` into an unrelated writer's frame and left the bad entry in the
   * set so that every subsequent write in the shell threw. That was one
   * mistyped argument away and it is now `INVALID_FIELD` in the frame that made
   * the mistake. *Tests:* `src/core/__tests__/subscribe.test.tsx` — "refuses a
   * listener that is not a function, in the frame that made the mistake" and
   * "leaves the store writable after refusing a non-function listener".
   *
   * @param listener Called after every change that really changed something.
   * @throws {ShellUXError} `INVALID_FIELD` when `listener` is not a function.
   *   Nothing is registered and the store is left exactly as it was.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Update any of the context fields at once.
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
   *  - `selectedItemIds` — an array of distinct strings, at most
   *    `REGISTRY_LIMITS.MAX_SELECTED_ITEMS` of them. Type only per element, for
   *    the same reason as `selectedItemId`. A HOST-OWNED FROZEN COPY is stored.
   *  - `selectedItemId` — a string or `null`. Type only: it is the extension's
   *    own item key, not a host lookup key. **It is a shorthand, not a second
   *    field**: it writes `selectedItemIds` and is then recomputed from it, and
   *    a patch supplying both is decided by `selectedItemIds`. See below.
   *  - `activeExtensionId`, `activeNavNodeId` — `EXTENSION_ID_PATTERN`, not
   *    reserved, or `null`. Both are registry-validated identifiers everywhere
   *    else, so they are held to the registry's own rule here.
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
   * **`selectedItemId` is derived and has ONE writer.** It is recomputed from
   * the final `selectedItemIds` inside the same draft, so no notification can
   * ever carry a `selectedItemId` that is not the last element of the
   * `selectedItemIds` beside it. A patch naming both is not a conflict to be
   * rejected — `patchContext(store.getContext())` names both and must be an exact
   * round trip — so the rule is precedence rather than refusal: `selectedItemIds`
   * decides, and `selectedItemId` is still validated so a malformed shorthand is
   * reported rather than ignored. Pinned by "derives selectedItemId from the last
   * element of selectedItemIds" and "lets selectedItemIds outrank selectedItemId
   * in one patch" in `src/core/__tests__/contextPatch.test.ts`.
   *
   * Only the `RibbonContext` fields are read from `patch`, and only as OWN
   * properties (`Object.hasOwn`, never `in`), so neither a stray key nor an
   * inherited one can become a context field — pinned by "patchContext reads own
   * properties only" in `src/core/__tests__/contextPatch.test.ts`.
   * `undefined` is normalised to each field's own EMPTY value — `null` for the
   * three nullable fields, the shared frozen empty array for `selectedItemIds`.
   * `Object.is(null, undefined)` is `false`, so writing `undefined` through would
   * both report a change that did not happen and make the declared type a runtime
   * lie.
   *
   * A field written with the value it already holds is not a change: no object is
   * allocated, the snapshot keeps its identity, and no listener is notified. For
   * `selectedItemIds` that comparison is ELEMENT-WISE rather than by identity,
   * because a host-owned copy is built on every call and would never be identical
   * to the stored one — pinned by "does not notify when a selection is rewritten
   * with the ids it already holds" in `src/core/__tests__/contextPatch.test.ts`.
   *
   * @throws {ShellUXError} `INVALID_PAYLOAD` when `patch` is not an object, or
   *   refuses to be inspected or read; `INVALID_ID` when `activeExtensionId` or
   *   `activeNavNodeId` is not a registry-valid identifier or `null`;
   *   `INVALID_FIELD` when `selectedItemId` is neither a string nor `null`, or
   *   when `selectedItemIds` is not an array, refuses to be read, holds a
   *   non-string, or repeats an id; `PAYLOAD_TOO_LARGE` when `selectedItemIds`
   *   exceeds `REGISTRY_LIMITS.MAX_SELECTED_ITEMS`; `REENTRANT_NOTIFY`
   *   from the notification cascade, after the fields are committed. Every code
   *   but the last leaves the context exactly as it was; the last does not, and
   *   the paragraphs above say why.
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
   * A one-shot read. `useBadgeCount` at the foot of this module is the
   * subscribing form, and is what a renderer should use.
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
   * **`REENTRANT_NOTIFY` is the asymmetric one, and this list used to omit it.**
   * `badgeCounts.set(...)` runs BEFORE `notify()`, so a cascade that reaches
   * `MAX_NOTIFY_DEPTH` raises out of here with the badge ALREADY COMMITTED — a
   * caller that reads a `@throws` list and concludes rejection-means-nothing-
   * happened is wrong for this code specifically. It is the same asymmetry
   * `patchContext` spells out above, and for the same reason: rolling the write
   * back would mean telling subscribers about a state that no longer exists.
   * Pinned by "raises REENTRANT_NOTIFY from setBadgeCount, with the badge already
   * committed" in `src/core/__tests__/shellApi.test.ts`.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId` or `nodeId`;
   *   `INVALID_FIELD` when `count` is not a non-negative safe integer;
   *   `REENTRANT_NOTIFY` from the notification cascade, after the badge is
   *   committed.
   */
  setBadgeCount(extensionId: string, nodeId: string, count: number): void;
  /**
   * Live metric value for one extension's node, or `undefined` when none was
   * ever set.
   *
   * **The badge doors' exact shape, deliberately.** A metric has the same
   * lifetime, the same scoping question and the same blueprint-override rule a
   * badge has, and giving it a different shape would mean two answers to "why is
   * my runtime write not showing?" where this codebase already has one settled
   * answer. Both arguments are validated, for the reason `getBadgeCount` gives:
   * this is a member of the store, `useShellStore()` is public, and the key is
   * built by interpolating both components.
   *
   * @throws {ShellUXError} `INVALID_ID` when `extensionId` is neither a
   *   registry-valid identifier nor the host scope, or `nodeId` is not a
   *   registry-valid identifier.
   */
  getNavMetric(extensionId: string, nodeId: string): number | undefined;
  /**
   * Set the live metric value for one extension's node.
   *
   * `value` is CLAMPED to `[0, 1]` and REFUSED when non-finite, through
   * `clampMetricValue` in `RegistryContext.tsx` — the same function the registry
   * applies to a declared `NavigationMetric.value`, imported rather than
   * restated so the two doors cannot drift apart.
   *
   * A successful write notifies, so a listener can throw a non-`ShellUXError`
   * into this frame — see `subscribe`. `REENTRANT_NOTIFY` is asymmetric here in
   * exactly the way it is for `setBadgeCount`: the value is committed BEFORE the
   * notification pass, so a cascade reaching `MAX_NOTIFY_DEPTH` raises out of
   * here with the metric already stored. Pinned by "raises REENTRANT_NOTIFY from
   * setNavMetric, with the value already committed" in
   * `src/core/__tests__/navMetric.test.tsx`.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId` or `nodeId`;
   *   `INVALID_FIELD` when `value` is not a finite number; `REENTRANT_NOTIFY`
   *   from the notification cascade, after the value is committed.
   */
  setNavMetric(extensionId: string, nodeId: string, value: number): void;
  /**
   * Set or clear the selected item — a selection of exactly one, or none.
   *
   * Validates its argument, pinned by "setSelectedItem validates its argument"
   * in `src/core/__tests__/shellApi.test.ts`. The check is performed HERE, under
   * the parameter name `"id"`, before the value is handed on as a one-element
   * selection; that is what keeps the rejection naming the parameter the caller
   * actually passed rather than an array index it never wrote.
   *
   * It routes through `setSelectedItems` and therefore through `applyPatch` with
   * a host-built one-field literal, so the `INVALID_PAYLOAD` and `INVALID_ID`
   * outcomes that door can produce are not reachable from here: the patch is
   * always an object and never traps a read. Nor are `PAYLOAD_TOO_LARGE` or the
   * duplicate rejection: one element is neither too many nor a repeat.
   *
   * @throws {ShellUXError} `INVALID_FIELD` when `id` is neither a string nor
   *   `null`; `REENTRANT_NOTIFY` from the notification cascade, after the field
   *   is committed — the cascade itself pinned by "refuses a runaway write
   *   cascade with a typed error, not a RangeError", and the committed half by
   *   "raises REENTRANT_NOTIFY from setSelectedItem, with the field already
   *   committed", both in `src/core/__tests__/contextPatch.test.ts` and both
   *   driving the cascade through this member.
   */
  setSelectedItem(id: string | null): void;
  /**
   * Replace the whole selection. The single writer behind both selection doors.
   *
   * `ids` is untrusted: this member is reachable from plug-in code through the
   * public `useShellStore()`, so the declared `readonly string[]` binds nobody.
   * The array is read once into a host-owned array — length captured, then each
   * element read exactly once — and that copy is what is validated, frozen and
   * stored. Pinned by the "setSelectedItems validates its argument" group in
   * `src/core/__tests__/shellApi.test.ts`.
   *
   * @throws {ShellUXError} `INVALID_FIELD` when `ids` is not an array, refuses to
   *   report its length or an element, holds a non-string, or repeats an id;
   *   `PAYLOAD_TOO_LARGE` when the count exceeds
   *   `REGISTRY_LIMITS.MAX_SELECTED_ITEMS`; `REENTRANT_NOTIFY` from the
   *   notification cascade, after the fields are committed.
   */
  setSelectedItems(ids: readonly string[]): void;
  /**
   * Set or clear the selected pane-1 navigation node.
   *
   * **One path, not two.** `ShellLayout`'s pane-1 click handler used to call
   * `patchContext({ activeNavNodeId })` directly while `IShellAPI` could not
   * write the field at all. Both now come through here, so the rule that decides
   * what `activeNavNodeId` may hold — the registry's own allowlist and reserved
   * words — is applied in one place and named in one message. Pinned by
   * "setActiveNavNode validates its argument" in
   * `src/core/__tests__/shellApi.test.ts`.
   *
   * @throws {ShellUXError} `INVALID_ID` when `nodeId` is neither a registry-valid
   *   identifier nor `null`; `REENTRANT_NOTIFY` from the notification cascade,
   *   after the field is committed.
   */
  setActiveNavNode(nodeId: string | null): void;
  /**
   * Write one of `extensionId`'s context keys.
   *
   * `extensionId` is a PARAMETER here and is closure-captured on the `IShellAPI`
   * facade, which is the same split `getBadgeCount`/`useBadgeCount` make and for
   * the same reason: this is the unscoped host-side store, and it is public, so
   * naming a scope here adds nothing a caller did not already have. The scoping
   * that matters is on the facade an extension holds.
   *
   * The published `RibbonContext.contextKeys` changes only when `extensionId` is
   * the current foreground. See the implementation's docblock.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId` or `key`;
   *   `INVALID_FIELD` when `value` is not a finite number, string, boolean or
   *   `null`; `PAYLOAD_TOO_LARGE` when a string value is too long or the key
   *   would exceed `REGISTRY_LIMITS.MAX_CONTEXT_KEYS`; `REENTRANT_NOTIFY` from
   *   the notification cascade, after the key is committed.
   */
  setContextKey(extensionId: string, key: string, value: ContextKeyValue): void;
  /**
   * Drop every extension's context keys, WITHOUT patching or notifying.
   *
   * The bookkeeping half of a foreground handover; the caller publishes
   * `contextKeys: {}` in the same patch that moves the foreground. Its one caller
   * is `publishForeground` in `ActivationContext.tsx`, and the implementation's
   * docblock says why splitting it that way is what keeps the handover a single
   * coherent notification.
   */
  clearContextKeys(): void;
  /**
   * Delete one extension's badge entry for `nodeId`. Notifies only when an entry
   * was removed. See `IShellAPI.clearBadge`; this is the unscoped door behind it.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId` or `nodeId`;
   *   `REENTRANT_NOTIFY` from the notification cascade, after the entry is
   *   removed.
   */
  clearBadge(extensionId: string, nodeId: string): void;
  /**
   * Replace `extensionId`'s navigation tree with `nodes`, re-normalised through
   * the registry's own tree validator (`normalizeNavigationTree`), and notify.
   * See `IShellAPI.setNavigationTree`; this is the unscoped door behind it.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId`; every code the
   *   tree validator raises; `PAYLOAD_TOO_LARGE` when the scope bound refuses a
   *   new scope; `REENTRANT_NOTIFY` after the tree is stored.
   */
  setNavigationTree(extensionId: string, nodes: readonly NavigationNode[]): void;
  /**
   * The tree last stored for `extensionId` by `setNavigationTree`, or `undefined`
   * when none was — in which case the registered blueprint's tree stands. The
   * returned array is the deep-frozen host-owned copy.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId`.
   */
  getNavigationTree(extensionId: string): readonly NavigationNode[] | undefined;
  /**
   * Delete everything this store holds under `extensionId`'s scope — badges,
   * metrics, context keys and a replacement navigation tree — and free the scope
   * for `STORE_LIMITS.MAX_SCOPES`. ADR-0006 decision 8, GitHub issue #80.
   *
   * `ShellHostProvider` calls it inside `unregister`, before the record is
   * removed, so an id registered again later starts from nothing. When the scope
   * is the current foreground and has published context keys, the published
   * record is emptied in the same notification. Notifies only when something was
   * removed. *Tests:* `src/core/__tests__/lifecycle.test.tsx` — "unregister purges
   * the scope's badges and context keys".
   *
   * Public, like every member here: any holder of the store can purge any scope,
   * which is no more than it could already do by overwriting it.
   *
   * @throws {ShellUXError} `INVALID_ID` for a bad `extensionId`;
   *   `REENTRANT_NOTIFY` from the notification cascade, after the purge.
   */
  purgeScope(extensionId: string): void;
}

/**
 * Bounds the shell store enforces on itself, as opposed to on a blueprint.
 *
 * **`MAX_SCOPES` — how many distinct scopes the store will hold state for at
 * once**, counting every scope that has written a badge, a metric, a context key
 * or a navigation tree since it was last purged, the host's own included. A
 * write that would create one more is refused with `PAYLOAD_TOO_LARGE`; a scope
 * already held keeps writing. GitHub issue #80, ADR-0006 decision 8.
 *
 * **What it is: entry-point validation, at the store's doors.** An extension's
 * own facade can name only its own scope, and `unregister` purges that scope, so
 * through the documented channel the count follows the number of registered
 * extensions. `useShellStore()` is public and names any scope, and this is the
 * bound on that route. It is not a bound on memory in general.
 *
 * **Why it is not in `REGISTRY_LIMITS`.** That object is the contract recorded
 * in `src/sdk/api-surface.json`, and it bounds what a blueprint may declare.
 * This bounds the store, and a plug-in can reach it through its own facade only
 * by being one of more than 1023 extensions registered at once, all writing.
 * The judgement that this is not a contract narrowing is recorded in ADR-0006's
 * dated note of 2026-09-19 under decision 8. *Tests:*
 * `src/core/__tests__/navigationTree.test.tsx` — "refuses a scope beyond
 * MAX_SCOPES through the public store, and frees one on purge".
 */
export const STORE_LIMITS = Object.freeze({
  MAX_SCOPES: 1024,
});

/**
 * The one empty selection, shared by every context that has none.
 *
 * Shared rather than freshly allocated so that "nothing is selected" has a
 * stable identity: `applyPatch` compares selections element-wise, but a
 * subscriber holding two snapshots taken while nothing was selected sees one
 * array, which is what makes the empty case cheap in a `useMemo` dependency.
 */
const EMPTY_SELECTION: readonly string[] = Object.freeze([]);

/**
 * The one empty context-key record, shared for the same reason.
 *
 * `Object.create(null)` rather than `{}`: this record is keyed by strings that
 * originate in plug-in code, and although every key is held to
 * `EXTENSION_ID_PATTERN` and `RESERVED_IDS` before it can get in, a record with
 * no prototype has nothing to pollute even if that filter were wrong one day. It
 * is the same belt-and-braces relationship the registry's `Map` stores have with
 * `RESERVED_IDS` — the filter is the rule, the data structure is the guarantee.
 */
const EMPTY_CONTEXT_KEYS: Readonly<Record<string, ContextKeyValue>> = Object.freeze(
  Object.create(null) as Record<string, ContextKeyValue>,
);

/** The empty context: nothing active, nothing selected, nothing published. */
const EMPTY_CONTEXT: Readonly<RibbonContext> = Object.freeze({
  activeExtensionId: null,
  activeNavNodeId: null,
  selectedItemIds: EMPTY_SELECTION,
  selectedItemId: null,
  contextKeys: EMPTY_CONTEXT_KEYS,
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

/**
 * What a read off an untrusted value answers when the read itself THREW.
 *
 * A `Symbol` rather than `undefined` or `null`, because both of those are values
 * a legitimate array element can hold and neither would distinguish "the element
 * is `undefined`" from "reading the element detonated". Module-private and never
 * exported, so no caller can forge it.
 */
const REFUSED: unique symbol = Symbol('refused');

/**
 * Read one property off an untrusted value without letting the read escape.
 *
 * Reaching a property on a plug-in-supplied object is a call into plug-in code —
 * a `get` trap, an own getter, or a revoked `Proxy` whose every internal method
 * throws a raw `TypeError`. This module's banner forbids letting that out of a
 * function contracted to throw `ShellUXError`, so every such read goes through
 * here and a refusal becomes a value rather than an exception.
 */
function readGuarded(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return REFUSED;
  }
}

/**
 * Validate an untrusted selection and build the HOST-OWNED array that is stored.
 *
 * This is `normalizeNavigationNode`'s discipline applied to a runtime argument,
 * and for the same reason the registry states at length: validating a caller's
 * array and then storing the caller's array checks nothing. Every element stays
 * re-readable through a getter, and a `Proxy` is free to report one `length`
 * while it is measured and another afterwards. So the length is captured ONCE,
 * each element is read ONCE into a fresh array, and it is that array which is
 * checked, frozen and stored. What was validated is what is stored.
 *
 * Four rejections, in the order they are decided:
 *
 *  - not an array, or an array that refuses to report its length;
 *  - a length that is not a non-negative safe integer — a real array's never is
 *    not, a `Proxy`'s can be anything;
 *  - more entries than `REGISTRY_LIMITS.MAX_SELECTED_ITEMS`, which is
 *    `PAYLOAD_TOO_LARGE` rather than `INVALID_FIELD` because it is a bound and
 *    not a shape;
 *  - an element that refuses to be read, an element that is not a string, or an
 *    element that repeats one already in the selection.
 *
 * **Duplicates are rejected rather than collapsed**, and that is a decision
 * rather than a default. Deduplicating silently would hand back a selection of a
 * different length from the one the caller asked for, which is exactly the
 * "selection that mysteriously never sticks" failure `assertValidSelectedItemId`
 * refuses to create by coercing. A selection containing the same row twice is the
 * caller's bug and is reported at the call site.
 *
 * `Array.isArray` is used through `readGuarded` because it raises a raw
 * `TypeError` on a revoked `Proxy` — the same leak `checkArray` closes in
 * `RegistryContext.tsx`, reached here by a different door.
 *
 * Pinned by the "setSelectedItems validates its argument" group in
 * `src/core/__tests__/shellApi.test.ts`, which walks all four rejections, and by
 * "patchContext rejects what setSelectedItems rejects" in
 * `src/core/__tests__/contextPatch.test.ts`.
 */
function normalizeSelectedItemIds(
  value: unknown,
  method: string,
  field: string,
): readonly string[] {
  if (readGuarded(() => Array.isArray(value)) !== true) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be an array of strings; received ${describeUntrusted(value)}.`,
      field,
    );
  }
  const count = readGuarded(() => (value as { readonly length: unknown }).length);
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must report a non-negative integer length.`,
      field,
    );
  }
  if (count > REGISTRY_LIMITS.MAX_SELECTED_ITEMS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `${method}: "${field}" exceeds the maximum of ${REGISTRY_LIMITS.MAX_SELECTED_ITEMS} selected items.`,
      field,
    );
  }
  const items: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const item = readGuarded(() => (value as readonly unknown[])[index]);
    if (typeof item !== 'string') {
      throw new ShellUXError(
        'INVALID_FIELD',
        // `item` is not stringified: it is either `REFUSED` or a value that
        // failed the type check, which is exactly when reading it is dangerous.
        `${method}: "${field}[${index}]" must be a string; received ${item === REFUSED ? 'a value that threw while it was being read' : describeUntrusted(item)}.`,
        `${field}[${index}]`,
      );
    }
    if (seen.has(item)) {
      // A proven primitive string, so interpolating it is safe.
      throw new ShellUXError(
        'INVALID_FIELD',
        `${method}: "${field}" repeats the selected item "${item}". A selection holds each item once.`,
        `${field}[${index}]`,
      );
    }
    seen.add(item);
    items.push(item);
  }
  return items.length === 0 ? EMPTY_SELECTION : Object.freeze(items);
}

/**
 * Assert that `value` is something a context key may hold.
 *
 * The union is `string | number | boolean | null` and the check is `typeof`, so
 * nothing is read off the value and nothing it might have defined is invoked.
 * That is the whole argument for primitives-only: a validator this cheap can run
 * on every write, and there is no getter to fire inside a render-phase predicate
 * afterwards. See `IShellAPI.setContextKey`.
 *
 * A `number` must additionally be FINITE. `NaN` and `±Infinity` are numbers a
 * predicate cannot branch on usefully — `NaN !== NaN` catches an author out, and
 * neither survives a round trip through a persisted record — so they are refused
 * at the door rather than left to surprise somebody downstream.
 *
 * Pinned by "setContextKey validates its value" in
 * `src/core/__tests__/contextKeys.test.tsx`.
 */
function assertValidContextKeyValue(value: unknown, method: string, field: string): void {
  if (value === null || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `${method}: "${field}" must be a finite number when it is a number.`,
        field,
      );
    }
    return;
  }
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be a string, a finite number, a boolean or null; received ${describeUntrusted(value)}.`,
      field,
    );
  }
  if (value.length > REGISTRY_LIMITS.MAX_CONTEXT_VALUE_LENGTH) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `${method}: "${field}" exceeds the maximum context-key value length of ${REGISTRY_LIMITS.MAX_CONTEXT_VALUE_LENGTH} characters.`,
      field,
    );
  }
}

/**
 * Validate an untrusted context-key record and build the HOST-OWNED copy stored
 * in the snapshot.
 *
 * Same discipline as `normalizeSelectedItemIds`, applied to an object rather than
 * an array: the key list is obtained once, each value is read exactly once, and
 * it is the resulting fresh record that is checked and frozen. `Object.keys` and
 * every property read go through `readGuarded`, because both re-enter plug-in
 * code — an `ownKeys` trap, a `get` trap, an own getter, or a revoked `Proxy`
 * whose every internal method throws.
 *
 * Keys are held to `assertValidIdentifier`, the registry's own rule, so a key can
 * carry no path separator, no URL scheme, no markup and no `__proto__`. The
 * record is built on `Object.create(null)` regardless — see `EMPTY_CONTEXT_KEYS`.
 *
 * Pinned by "patchContext rejects what setContextKey rejects" in
 * `src/core/__tests__/contextKeys.test.tsx`.
 */
function normalizeContextKeys(
  value: unknown,
  method: string,
  field: string,
): Readonly<Record<string, ContextKeyValue>> {
  if (typeof value !== 'object' || value === null || readGuarded(() => Array.isArray(value))) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be a record of primitives; received ${describeUntrusted(value)}.`,
      field,
    );
  }
  const keys = readGuarded(() => Object.keys(value));
  if (!Array.isArray(keys)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" refused to list its own keys. Nothing was applied.`,
      field,
    );
  }
  if (keys.length > REGISTRY_LIMITS.MAX_CONTEXT_KEYS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `${method}: "${field}" exceeds the maximum of ${REGISTRY_LIMITS.MAX_CONTEXT_KEYS} context keys.`,
      field,
    );
  }
  const record = Object.create(null) as Record<string, ContextKeyValue>;
  for (const key of keys) {
    assertValidIdentifier(key, method, `${field}.${String(key)}`, false);
    const held = readGuarded(() => (value as Record<string, unknown>)[key]);
    if (held === REFUSED) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `${method}: reading "${field}.${key}" threw. Nothing was applied.`,
        `${field}.${key}`,
      );
    }
    assertValidContextKeyValue(held, method, `${field}.${key}`);
    record[key] = held as ContextKeyValue;
  }
  return keys.length === 0 ? EMPTY_CONTEXT_KEYS : Object.freeze(record);
}

/**
 * Whether two context-key records hold the same keys with the same values.
 *
 * Element-wise for the same reason `sameSelection` is: a fresh host-owned record
 * is built on every write and is never `Object.is` the stored one, so an identity
 * comparison would report a change for every write and defeat the bail-out that
 * keeps an unchanged write from waking every subscriber in the shell.
 */
function sameContextKeys(
  current: Readonly<Record<string, ContextKeyValue>>,
  next: Readonly<Record<string, ContextKeyValue>>,
): boolean {
  const currentKeys = Object.keys(current);
  if (currentKeys.length !== Object.keys(next).length) {
    return false;
  }
  for (const key of currentKeys) {
    if (!Object.is(current[key], next[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Reads one context field off an untrusted patch, validates it, and returns the
 * HOST-OWNED value to store — which for every scalar field is the value itself.
 */
type ContextFieldNormalizer = (value: unknown, method: string, field: string) => unknown;

/**
 * Exhaustiveness pin for `CONTEXT_KEYS` **and** the validation table every write
 * to the context goes through.
 *
 * The shape is the same as `SHELL_UX_ERROR_CODE_MEMBERS` in `types.ts`:
 * `Record<keyof RibbonContext, ...>` makes the compiler reject both a field this
 * module forgot and one it invented. Making the value a normaliser rather than
 * `true` extends that to the check itself — a field added to `RibbonContext`
 * cannot become patchable without someone deciding, in this table, what a legal
 * value for it is and what host-owned form it is stored in.
 */
const CONTEXT_FIELDS: Readonly<Record<keyof RibbonContext, ContextFieldNormalizer>> = Object.freeze({
  // Both of these are registry-validated identifiers everywhere else in the
  // host, so they are held to the registry's own rule here.
  activeExtensionId: (value, method, field): unknown => {
    assertValidIdentifier(value, method, field, true);
    return value;
  },
  activeNavNodeId: (value, method, field): unknown => {
    assertValidIdentifier(value, method, field, true);
    return value;
  },
  // Opaque to the host: type only. See `assertValidSelectedItemId`.
  selectedItemId: (value, method, field): unknown => {
    assertValidSelectedItemId(value, method, field);
    return value;
  },
  selectedItemIds: normalizeSelectedItemIds,
  contextKeys: normalizeContextKeys,
});

/** The context's own fields, and the only keys `patchContext` will read. */
const CONTEXT_KEYS = Object.keys(CONTEXT_FIELDS) as readonly (keyof RibbonContext)[];

/**
 * What each field means by "no value", for a patch that spells it `undefined`.
 *
 * The three nullable fields spell it `null`; a selection spells it the empty
 * array. Normalising `undefined` at all is the point made on `patchContext`:
 * `Object.is(null, undefined)` is `false`, so passing `undefined` straight
 * through would report a change that did not happen AND put `undefined` in a
 * field whose declared type does not admit it. Pinned to `keyof RibbonContext`
 * for the same reason the table above is.
 */
const CONTEXT_FIELD_EMPTY: Readonly<Record<keyof RibbonContext, unknown>> = Object.freeze({
  activeExtensionId: null,
  activeNavNodeId: null,
  selectedItemId: null,
  selectedItemIds: EMPTY_SELECTION,
  contextKeys: EMPTY_CONTEXT_KEYS,
});

/**
 * Whether two selections hold the same ids in the same order.
 *
 * Element-wise, not by identity: `normalizeSelectedItemIds` builds a fresh
 * host-owned array on every call, so an identity comparison would report a
 * change for every write and defeat the snapshot-identity bail-out `applyPatch`
 * exists to preserve. Order is part of the comparison because it is part of the
 * value — `selectedItemId` is the LAST element, so `['a','b']` and `['b','a']`
 * are two different selections with two different derived ids.
 */
function sameSelection(current: readonly string[], next: readonly string[]): boolean {
  if (current.length !== next.length) {
    return false;
  }
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

/**
 * `selectedItemId`, computed from the selection. The one derivation rule, in one
 * place, so the two fields cannot be made to disagree.
 */
function lastSelected(ids: readonly string[]): string | null {
  // Indexing `-1` on an empty array is `undefined`, so the empty case needs no
  // length test of its own — which keeps this to one branch, both sides of it
  // reachable, rather than a length check plus an `??` fallback the compiler
  // wants and no input can ever take.
  const last = ids[ids.length - 1];
  return last === undefined ? null : last;
}

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
 * because it is a closure variable") — obtains the sixteen METHODS and never the state
 * behind them.
 *
 * *Its methods are its own.* The returned object is **frozen**, so no holder can
 * replace, delete or add a member. Every one of the sixteen that takes an argument validates it.
 * Therefore no caller can put a value of the wrong shape into this store's
 * context: every value that enters the context through this store is well-typed,
 * for any caller however hostile. Pinned by `reflection.test.tsx` ("gets the store
 * methods, cannot replace one, and cannot put an illegal value through one") and by
 * `capability.test.tsx` ("the store handed out by useShellStore is frozen").
 *
 * **"Every one of the twelve" (as the count then was) was false by one member until #83, and the member it
 * was false about was `subscribe`.** It took a listener, added it to a `Set`
 * unchecked, and a stored `undefined` then threw a raw `TypeError` out of the next
 * unrelated write and every write after it. The premise is repaired rather than
 * narrowed — `subscribe` validates now, so this sentence and `SECURITY.md`'s
 * "Integrity controls — unconditional" are both true as written and neither needed
 * softening. Per ADR-0001 Amendment G the repair is named here rather than only in
 * the member's own docblock: `subscribe.test.tsx` ("refuses a listener that is not
 * a function, in the frame that made the mistake" and "leaves the store writable
 * after refusing a non-function listener"). **The second title is the load-bearing
 * one** — the first only proves a bad call is refused, the second proves the shell
 * is still writable afterwards, which is the wedge the guard exists to prevent.
 *
 * **That is the whole of it, and a wider clause used to be appended here.** The
 * sentence went on: "and no caller can intercept, suppress or forge the writes and
 * reads another holder makes through it." **False, and the freeze is irrelevant to
 * it.** `subscribe` is one of the sixteen frozen members, it is reachable through the
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
 * @param initial Optional seed for the context. Anything omitted starts empty —
 *   `null` for the three nullable fields, an empty selection and an empty
 *   context-key record. It is validated exactly as a `patchContext` call would be.
 * @throws {ShellUXError} `INVALID_PAYLOAD`, `INVALID_ID`, `INVALID_FIELD` or
 *   `PAYLOAD_TOO_LARGE` when `initial` is rejected — the same four `patchContext`
 *   decides on, because it is the same door. (`PAYLOAD_TOO_LARGE` joined the list
 *   with the bounded fields `selectedItemIds` and `contextKeys`; a seed naming
 *   either can exceed a `REGISTRY_LIMITS` bound, and a code that can be raised and
 *   is not documented is as wrong as one documented and unreachable.)
 *   `REENTRANT_NOTIFY` is deliberately NOT on this list and is
 *   not reachable here: the seed is applied before this function returns, so
 *   nothing has been handed a store to `subscribe` to yet and the notification
 *   pass has no listener to cascade through.
 */
export function createShellStateStore(initial?: Partial<RibbonContext>): ShellStateStore {
  let context: Readonly<RibbonContext> = EMPTY_CONTEXT;
  // A Map, never an object literal: badge keys come from plugin-supplied node
  // ids, and a Map has no prototype chain to pollute.
  const badgeCounts = new Map<string, number>();
  // The same shape and the same reason as `badgeCounts`: keyed by
  // `${scope}:${node}`, both components proven strings before the key is built,
  // and a `Map` because the node half originates in a plug-in manifest.
  const navMetrics = new Map<string, number>();
  // Context keys, namespaced by extension. Nested rather than flat because the
  // published record needs a whole scope at once; a `Map` at both levels for the
  // same prototype reason as `badgeCounts`. See `setContextKey`.
  const contextKeyScopes = new Map<string, Map<string, ContextKeyValue>>();
  // Replacement navigation trees, one per scope, each the deep-frozen output of
  // `normalizeNavigationTree`. See `setNavigationTree`.
  const navTrees = new Map<string, readonly NavigationNode[]>();
  // Every scope holding state in any of the four maps above since it was last
  // purged. Bounded by `STORE_LIMITS.MAX_SCOPES`; see `claimScope`.
  const scopes = new Set<string>();
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
    // Validated for the same reason every other member is, and thrown HERE
    // rather than filtered at notify time on purpose. `listeners` is a `Set`,
    // so an unchecked `subscribe(undefined)` succeeds and stores `undefined`;
    // `notify` then calls it, `undefined()` raises a raw `TypeError` — not a
    // `ShellUXError` — into whichever unrelated holder happened to write next,
    // every listener ordered after it is starved, and the bad entry stays in
    // the `Set` because the only thing that removes it is the unsubscribe
    // closure returned to the caller who is, by hypothesis, not going to call
    // it. From that point every write in the shell throws. One mistyped
    // argument wedges the shell, and the realistic trigger is not an attacker
    // but `subscribe(cb())` where `cb()` returns nothing.
    //
    // Throwing at the call site puts the error in the frame of the code that
    // made the mistake, which is the entire benefit: filtering at notify time
    // would leave the author's typo surfacing in someone else's stack.
    //
    // It also makes the banner above true. That paragraph says every member
    // taking an argument validates it, `SECURITY.md` repeats it under
    // "Integrity controls — unconditional", and `subscribe` was the one member
    // that did not. See #83.
    if (typeof listener !== 'function') {
      throw new ShellUXError(
        'INVALID_FIELD',
        `subscribe: "listener" must be a function; received ${describeUntrusted(listener)}.`,
        'listener',
      );
    }
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
   * **It is all-or-nothing.** Reading and validating is a complete pass that
   * writes nothing; `context` is replaced only after every supplied field has
   * survived it. So a patch whose second field is rejected — or whose second
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
   * the way React's own bail-out does; `selectedItemIds` is compared with
   * `sameSelection` instead, because a fresh host-owned copy is built on every
   * call and is never `Object.is` the stored one.
   *
   * **SELECTION HAS ONE WRITER, AND THIS IS IT.** `selectedItemIds` is the field
   * that is stored and `selectedItemId` is recomputed from it here, in the SAME
   * draft, so the pair is committed atomically and no notification can carry one
   * without the other. `selectedItemId` supplied in a patch is a SHORTHAND for a
   * selection of one — it is validated under its own name, converted, and then
   * outranked if the same patch also names `selectedItemIds`. Precedence rather
   * than refusal, because `patchContext(store.getContext())` names both and has
   * to be an exact round trip.
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

    // READ AND VALIDATE FIRST, WRITE AFTERWARDS. Nothing below this loop can
    // reject, which is what makes the patch all-or-nothing even though the
    // selection now needs two fields resolved against each other.
    const accepted = new Map<keyof RibbonContext, unknown>();
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
          // Worded to avoid the article: `key` ranges over `CONTEXT_KEYS`, and
          // `activeExtensionId` and `activeNavNodeId` both need "an". Branching
          // on a vowel would be more code than the problem is worth.
          `${method}: the patch refused to say whether "${key}" is its own property. Nothing was applied.`,
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
      // `undefined` means "no value", and each field spells that its own way —
      // `null` for the three nullable ones, the empty array for a selection.
      // Writing `undefined` through would report a change that did not happen —
      // `Object.is(null, undefined)` is `false` — and would put `undefined` in a
      // field whose declared type does not admit it, making that declaration a
      // runtime lie for every other extension that reads the snapshot.
      const value: unknown = supplied === undefined ? CONTEXT_FIELD_EMPTY[key] : supplied;
      // The normaliser returns the HOST-OWNED value to store, which for every
      // scalar field is the value it was handed and for a selection is a fresh
      // frozen copy built from a single read.
      accepted.set(key, CONTEXT_FIELDS[key](value, method, key));
    }

    let draft: MutableRibbonContext | null = null;
    const write = <K extends keyof RibbonContext>(key: K, value: RibbonContext[K]): void => {
      // Allocated on first real change and not before.
      draft ??= { ...context };
      draft[key] = value;
    };

    for (const key of ['activeExtensionId', 'activeNavNodeId'] as const) {
      if (!accepted.has(key)) {
        continue;
      }
      const value = accepted.get(key) as string | null;
      if (!Object.is(context[key], value)) {
        write(key, value);
      }
    }

    // ---- Selection: two doors, one field ------------------------------------
    // `selectedItemId` is the shorthand and is resolved first; `selectedItemIds`
    // is the source of truth and overwrites it when both are supplied. Whichever
    // wins, `selectedItemId` is then DERIVED from the result rather than taken
    // from the patch, which is what makes the two impossible to desynchronise.
    let nextIds: readonly string[] | undefined;
    if (accepted.has('selectedItemId')) {
      const single = accepted.get('selectedItemId') as string | null;
      nextIds = single === null ? EMPTY_SELECTION : Object.freeze([single]);
    }
    if (accepted.has('selectedItemIds')) {
      nextIds = accepted.get('selectedItemIds') as readonly string[];
    }
    if (nextIds !== undefined && !sameSelection(context.selectedItemIds, nextIds)) {
      write('selectedItemIds', nextIds);
      const derived = lastSelected(nextIds);
      if (!Object.is(context.selectedItemId, derived)) {
        write('selectedItemId', derived);
      }
    }

    if (accepted.has('contextKeys')) {
      const nextKeys = accepted.get('contextKeys') as Readonly<Record<string, ContextKeyValue>>;
      if (!sameContextKeys(context.contextKeys, nextKeys)) {
        write('contextKeys', nextKeys);
      }
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

  /**
   * Count `extensionId` as a scope holding state, refusing it when it would be
   * one more than `STORE_LIMITS.MAX_SCOPES`. Called by every write that can
   * create per-scope state, after its arguments are validated and before anything
   * is stored — so a refused write stores nothing. A scope already held is never
   * refused. It stays counted until `purgeScope`, including after a foreground
   * handover empties its context keys.
   */
  function claimScope(extensionId: string, method: string): void {
    if (scopes.has(extensionId)) {
      return;
    }
    if (scopes.size >= STORE_LIMITS.MAX_SCOPES) {
      throw new ShellUXError(
        'PAYLOAD_TOO_LARGE',
        `${method}: the shell store already holds state for ${STORE_LIMITS.MAX_SCOPES} scopes, and "${extensionId}" would be one more. A scope is freed when its extension is unregistered.`,
        'extensionId',
      );
    }
    scopes.add(extensionId);
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
    claimScope(extensionId, 'setBadgeCount');
    // Keyed by scope, so two extensions that both call their root node "inbox"
    // write to two different entries instead of overwriting each other.
    badgeCounts.set(badgeKey(extensionId, nodeId), count);
    // Badges are not part of the context snapshot, so `useShellContext` bails
    // out on its own unchanged snapshot. The notify is still correct — the store
    // changed — and `useBadgeCount` at the foot of this module is the
    // badge-aware selector that subscribes to it. Note that this notify is
    // UNCONDITIONAL: unlike `applyPatch`, a badge written with the value it
    // already holds still wakes every listener, and it is the selector's own
    // `Object.is` bail-out that stops that becoming a re-render.
    notify();
  }

  function getNavMetric(extensionId: string, nodeId: string): number | undefined {
    assertValidBadgeScope(extensionId, 'getNavMetric');
    assertValidNodeId(nodeId, 'getNavMetric');
    return navMetrics.get(badgeKey(extensionId, nodeId));
  }

  function setNavMetric(extensionId: string, nodeId: string, value: number): void {
    assertValidBadgeScope(extensionId, 'setNavMetric');
    assertValidNodeId(nodeId, 'setNavMetric');
    // The registry's own rule, imported rather than restated: clamped for an
    // out-of-range number, refused for a non-finite one.
    const clamped = clampMetricValue(value, 'setNavMetric', 'value');
    claimScope(extensionId, 'setNavMetric');
    navMetrics.set(badgeKey(extensionId, nodeId), clamped);
    // UNCONDITIONAL, exactly as `setBadgeCount`'s notify is: a metric is not part
    // of the context snapshot, so `useShellContext` bails out on its own
    // unchanged snapshot, and it is `useNavMetric`'s `Object.is` bail-out that
    // stops a rewritten value becoming a re-render.
    notify();
  }

  function setSelectedItem(id: string | null): void {
    // Checked here as well as inside `applyPatch`, and deliberately so: this is
    // the door an extension calls, so the rejection has to name the parameter the
    // extension actually passed — `"id"`, not `"selectedItemId"` and certainly
    // not `"ids[0]"`. `applyPatch` re-checks the same value under its own field
    // name and finds it good.
    assertValidSelectedItemId(id, 'setSelectedItem', 'id');
    // Validated before it is written, so the frozen snapshot handed to other
    // extensions can never hold anything but a string or null. Routed through
    // `applyPatch` so that re-selecting the already-selected item is the no-op
    // it should be — and through the SAME field `setSelectedItems` writes, so
    // there is one writer and `selectedItemId` cannot drift from the array.
    applyPatch({ selectedItemId: id }, 'setSelectedItem');
  }

  function setSelectedItems(ids: readonly string[]): void {
    // Normalised HERE, not left to `applyPatch`'s `undefined` rule, and the
    // distinction is not pedantic: on a PATCH, `undefined` means "no value" and
    // a selection spells that the empty array, so `patchContext({ selectedItemIds:
    // undefined })` legitimately clears the selection. On a direct CALL,
    // `setSelectedItems(undefined)` is a plug-in passing a bad argument, and
    // clearing the selection for it would be the silent coercion
    // `assertValidSelectedItemId` refuses for exactly the same reason: a
    // selection that mysteriously empties is worse to find than an exception at
    // the call site. Running the normaliser at the door makes that a rejection.
    //
    // The field name is not re-labelled the way `setSelectedItem`'s is, because
    // here the parameter and the context field mean the same thing, and a
    // rejection naming `"selectedItemIds[2]"` names something the caller can
    // find in the array it passed. `applyPatch` re-checks the host-owned array
    // this produced and finds it good.
    const items = normalizeSelectedItemIds(ids, 'setSelectedItems', 'selectedItemIds');
    applyPatch({ selectedItemIds: items }, 'setSelectedItems');
  }

  function setActiveNavNode(nodeId: string | null): void {
    // Named for the parameter the caller passed, for the same reason
    // `setSelectedItem` re-checks its own: a rejection reading `"nodeId"` is
    // findable in the call, one reading `"activeNavNodeId"` is not.
    assertValidIdentifier(nodeId, 'setActiveNavNode', 'nodeId', true);
    applyPatch({ activeNavNodeId: nodeId }, 'setActiveNavNode');
  }

  /**
   * Write one of `extensionId`'s context keys, and republish the record if that
   * extension is the one in the foreground.
   *
   * **The namespace is a `Map` of `Map`s, and the outer key is the scope.** The
   * badge store is flat and interpolates `${scope}:${node}` because it only ever
   * answers one question at a time; this store has to hand back a WHOLE scope's
   * worth of keys to build the published record, so it is nested — which also
   * means no interpolation, and so no reason for `badgeKey`'s "both components
   * must be proven strings" argument to be repeated here.
   *
   * **Publishing is conditional and the condition is the foreground.** Only the
   * foreground extension's namespace reaches `RibbonContext.contextKeys`, so a
   * background extension writing its own key changes the store and moves nothing
   * a subscriber can see — and therefore does not notify. That is what stops one
   * extension's keys landing in another's predicates without any filtering at the
   * read end. It is also why writing a key you already hold is silent: the record
   * is rebuilt, `sameContextKeys` finds it equal, and `applyPatch` bails out.
   */
  /**
   * One extension's namespace, as the plain record the context publishes.
   *
   * Built fresh on every call from the `Map`, so what is published is a snapshot
   * and not a live view of a structure the store goes on mutating. It is handed
   * to `applyPatch`, which re-validates it through the same `normalizeContextKeys`
   * an untrusted patch goes through and freezes the copy it keeps — one door,
   * host caller and plug-in caller alike.
   */
  function publishedContextKeys(
    scope: ReadonlyMap<string, ContextKeyValue>,
  ): Record<string, ContextKeyValue> {
    const record = Object.create(null) as Record<string, ContextKeyValue>;
    for (const [key, value] of scope) {
      record[key] = value;
    }
    return record;
  }

  function setContextKey(extensionId: string, key: string, value: ContextKeyValue): void {
    assertValidBadgeScope(extensionId, 'setContextKey');
    assertValidIdentifier(key, 'setContextKey', 'key', false);
    assertValidContextKeyValue(value, 'setContextKey', 'value');

    claimScope(extensionId, 'setContextKey');
    let scope = contextKeyScopes.get(extensionId);
    if (scope === undefined) {
      scope = new Map<string, ContextKeyValue>();
      contextKeyScopes.set(extensionId, scope);
    }
    if (!scope.has(key) && scope.size >= REGISTRY_LIMITS.MAX_CONTEXT_KEYS) {
      // Checked against what is STORED, and only for a key that is genuinely
      // new: rewriting one of the keys already held is not growth and must not
      // start failing at the bound.
      throw new ShellUXError(
        'PAYLOAD_TOO_LARGE',
        `setContextKey: an extension may hold at most ${REGISTRY_LIMITS.MAX_CONTEXT_KEYS} context keys, and "${key}" would be one more.`,
        'key',
      );
    }
    scope.set(key, value);

    if (context.activeExtensionId !== extensionId) {
      // Not the foreground: the store moved, the published context did not, and
      // there is nothing for a subscriber to re-read.
      return;
    }
    applyPatch({ contextKeys: publishedContextKeys(scope) }, 'setContextKey');
  }

  /**
   * Drop every extension's context keys. The BOOKKEEPING half of a handover.
   *
   * **It deliberately does not patch the context and does not notify**, and its
   * one caller — `publishForeground` in `ActivationContext.tsx` — is what makes
   * that correct: the handover publishes `contextKeys: {}` inside the SAME single
   * patch that moves `activeExtensionId` and clears the selection, so a
   * subscriber observes one coherent transition. Clearing and notifying here
   * would make that two notifications, and the first would carry the old
   * foreground beside an emptied record — exactly the torn state
   * `publishForeground` exists to prevent.
   *
   * Every namespace goes, not only the outgoing extension's. A background
   * extension that wrote a key since the last handover is describing a pane that
   * is no longer mounted, and leaving its keys behind would mean a namespace that
   * survives a handover it was never told about. Pinned by "clears every
   * extension's context keys on a foreground handover" in
   * `src/core/__tests__/contextKeys.test.tsx`.
   */
  function clearContextKeys(): void {
    contextKeyScopes.clear();
  }

  function clearBadge(extensionId: string, nodeId: string): void {
    assertValidBadgeScope(extensionId, 'clearBadge');
    assertValidNodeId(nodeId, 'clearBadge');
    // A delete, not a write of zero: `getBadgeCount` answers `undefined` after
    // it, and pane 1 falls back to the count the blueprint declared. Clearing an
    // entry that is not there moved nothing, so nobody is woken.
    if (badgeCounts.delete(badgeKey(extensionId, nodeId))) {
      notify();
    }
  }

  function setNavigationTree(extensionId: string, nodes: readonly NavigationNode[]): void {
    assertValidBadgeScope(extensionId, 'setNavigationTree');
    // The registry's own validator, over the WHOLE tree, rooted at the name of
    // this door's parameter. It throws before anything below runs, so a refused
    // tree leaves the previous one in place.
    const tree = normalizeNavigationTree(nodes, 'nodes');
    claimScope(extensionId, 'setNavigationTree');
    navTrees.set(extensionId, tree);
    // UNCONDITIONAL, as `setBadgeCount`'s is: a fresh tree is a fresh identity,
    // and `useNavigationTree` re-renders on it.
    notify();
  }

  function getNavigationTree(extensionId: string): readonly NavigationNode[] | undefined {
    assertValidBadgeScope(extensionId, 'getNavigationTree');
    return navTrees.get(extensionId);
  }

  function purgeScope(extensionId: string): void {
    assertValidBadgeScope(extensionId, 'purgeScope');
    if (!scopes.delete(extensionId)) {
      // Nothing was ever stored under it, or it was purged already.
      return;
    }
    // The flat maps are keyed `${scope}:${node}`, and neither component can hold
    // a `:` (see `badgeKey`), so this prefix matches exactly this scope's keys.
    const prefix = `${extensionId}:`;
    for (const key of Array.from(badgeCounts.keys())) {
      if (key.startsWith(prefix)) {
        badgeCounts.delete(key);
      }
    }
    for (const key of Array.from(navMetrics.keys())) {
      if (key.startsWith(prefix)) {
        navMetrics.delete(key);
      }
    }
    contextKeyScopes.delete(extensionId);
    navTrees.delete(extensionId);
    if (context.activeExtensionId === extensionId && Object.keys(context.contextKeys).length > 0) {
      // The purged scope's keys are the published ones: empty the record in the
      // one notification `applyPatch` makes, rather than notifying twice.
      applyPatch({ contextKeys: {} }, 'purgeScope');
      return;
    }
    notify();
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
  // property being bought — the sixteen bindings cannot be replaced, deleted, or
  // added to. Pinned by "the store handed out by useShellStore is frozen" in
  // `capability.test.tsx` and "the store object cannot be rewired" in
  // `shellApi.test.ts`.
  //
  // What the freeze does NOT buy is that calls through the object are private:
  // `subscribe` is one of the sixteen, it is public, and it runs plug-in code inside
  // another holder's write. See its docblock and `subscribe.test.tsx`.
  return Object.freeze({
    getContext,
    subscribe,
    patchContext,
    getBadgeCount,
    setBadgeCount,
    getNavMetric,
    setNavMetric,
    setSelectedItem,
    setSelectedItems,
    setActiveNavNode,
    setContextKey,
    clearContextKeys,
    clearBadge,
    setNavigationTree,
    getNavigationTree,
    purgeScope,
  });
}

/**
 * The theme bridge the UNSCOPED host facade falls back to, created at most once.
 *
 * **A module singleton, and it earns that rather than reaching for it.**
 * `createThemeBridge` runs a `getComputedStyle` and a 60-name loop IN ITS BODY,
 * so a plain default argument — `themes = createThemeBridge(...)` — would force
 * one style recalculation per `createShellAPI()` call and mint a private bridge
 * for each. That would make "one `getComputedStyle` per theme change, never one
 * per reader" narrower than ADR-0001 Amendment M Decision 3 states it, in the
 * module that states it.
 *
 * `ShellHostProvider` never reaches this: it owns one bridge per provider and
 * passes it explicitly, which is what makes a provider's extensions share a
 * record. What is left for this to answer is `createShellAPI` — the unscoped,
 * unrevocable, host-side facade, and the one extension authors are told to build
 * test doubles against — where there is no provider to take a bridge from.
 *
 * It is created lazily rather than at module scope, so importing this module
 * touches no `document` and an environment without one pays nothing until
 * somebody actually mints an unscoped facade.
 */
let hostThemeBridgeInstance: ThemeBridgeStore | null = null;

function hostThemeBridge(): ThemeBridgeStore {
  hostThemeBridgeInstance ??= createThemeBridge(document.documentElement);
  return hostThemeBridgeInstance;
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
   * `api` has no route to it: `Object.keys(api)` is exactly the sixteen
   * `IShellAPI` members and there is no seventeenth. That much is an integrity control and holds
   * against any caller, and it is pinned by "does not expose revoke to the plugin"
   * in `src/core/__tests__/dataflow.test.tsx`, whose assertion is the literal
   * member list rather than a count — so widening `IShellAPI` from three members
   * to seven in Amendment K, from seven to nine when `setNavMetric` and
   * `getNavMetric` landed, and from nine to twelve when the payload channel did,
   * from twelve to fourteen when `getTheme` and `onThemeChange` did, and from
   * fourteen to sixteen when `clearBadge` and `setNavigationTree` did, were
   * all changes that test had to be told about, which is the point of writing it
   * that way.
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
 * **1. Badge reads and writes are scoped, and the plugin cannot name the scope.**
 * `extensionId` is captured from the host at mint time and read from this
 * closure on every call. It is not a parameter of `setBadgeCount`, so passing an
 * extra argument — another extension's id, say — reaches nothing: `IShellAPI`
 * declares two parameters and the implementation reads two. `getBadgeCount` is
 * scoped by the same closure and for the same reason: a read half that took a
 * scope would have handed every extension every other extension's badges through
 * the documented API, which is a wider capability than the write half it mirrors.
 * That is collision-resistance: it is what stops two vendors' `inbox` badges from
 * overwriting each other. It is not confinement, because the unscoped store
 * behind the facade is public. Pinned by "does not let an extension name the scope
 * it writes to" and "reads back only its own scope, and offers no parameter to
 * name another" in `src/core/__tests__/dataflow.test.tsx`.
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
 * **CORRECTION, ONCE THE PANES ARE PROCESSES: `REVOKED` BECOMES AN ADVISORY
 * CACHED CHECK.** Nothing below changes — `revoked` is still a latch, `isLive`
 * is still consulted on entry to every member, and the ordinary case still throws
 * synchronously in the caller's own frame. What changes is what the flag MEANS.
 * The question "does this extension still exist?" is main's to answer, and a
 * pane holds a cached answer to it: main unregisters an extension, and until the
 * pane hears, the pane's `isLive` says the handle is live and a write through it
 * is applied optimistically to that pane's replica.
 *
 * **The window is closed at the PANE level instead, and that is stronger than
 * making the check asynchronous would be.** Main tears the pane's view down on
 * `unregister`, so the whole realm stops existing — the handle, the closure it
 * captured, and the timer that was about to call through it. An `await`ed
 * liveness check would have left every member of `IShellAPI` returning a promise,
 * which is the contract change `src/core/ipc/ReplicaStore.ts` exists to avoid;
 * a `revoke` MESSAGE would have left the realm alive and racing. See the
 * `REVOKED` correction in that module's banner, and "is not where REVOKED lives,
 * and does not pretend to be" in `src/core/ipc/__tests__/replicaStore.test.ts`.
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
 *
 * @throws {ShellUXError} `INVALID_ID` when `extensionId` is neither a
 *   registry-valid identifier nor `HOST_BADGE_SCOPE`. That is the only outcome
 *   THIS function decides on; what the returned `api`'s sixteen members can raise
 *   is documented on `IShellAPI` in `types.ts`. Pinned by "refuses to mint a
 *   scoped facade for an extensionId that was never validated" in
 *   `src/core/__tests__/shellApi.test.ts`.
 */
export function createRevocableShellAPI(
  store: ShellStateStore,
  extensionId: string,
  isLive: () => boolean = (): boolean => true,
  payloads: PayloadChannelStore = createPayloadChannelStore(),
  themes: ThemeBridgeStore = hostThemeBridge(),
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

    setSelectedItems(ids: readonly string[]): void {
      assertLive('setSelectedItems');
      store.setSelectedItems(ids);
    },

    setActiveNavNode(nodeId: string | null): void {
      assertLive('setActiveNavNode');
      store.setActiveNavNode(nodeId);
    },

    setBadgeCount(nodeId: string, count: number): void {
      assertLive('setBadgeCount');
      // `extensionId` from the closure, never from the caller.
      store.setBadgeCount(extensionId, nodeId, count);
    },

    setContextKey(key: string, value: ContextKeyValue): void {
      assertLive('setContextKey');
      // `extensionId` from the closure, never from the caller — the same scoping
      // the badge doors have, so an extension can publish only into its own
      // namespace and has no parameter with which to name another's.
      store.setContextKey(extensionId, key, value);
    },

    getBadgeCount(nodeId: string): number | undefined {
      assertLive('getBadgeCount');
      // `extensionId` from the closure, never from the caller — the same scoping
      // the write half has, so a handle can read back exactly what it can write
      // and nothing else. There is no parameter through which to aim elsewhere.
      return store.getBadgeCount(extensionId, nodeId);
    },

    clearBadge(nodeId: string): void {
      assertLive('clearBadge');
      // `extensionId` from the closure, never from the caller.
      store.clearBadge(extensionId, nodeId);
    },

    setNavigationTree(nodes: readonly NavigationNode[]): void {
      assertLive('setNavigationTree');
      // `extensionId` from the closure, never from the caller. The store runs the
      // registry's whole-tree validator; nothing of `nodes` is kept.
      store.setNavigationTree(extensionId, nodes);
    },

    setNavMetric(nodeId: string, value: number): void {
      assertLive('setNavMetric');
      // `extensionId` from the closure, never from the caller — the badge
      // doors' scoping exactly, for the reason `NavigationNode.metric` gives.
      store.setNavMetric(extensionId, nodeId, value);
    },

    getNavMetric(nodeId: string): number | undefined {
      assertLive('getNavMetric');
      // `extensionId` from the closure, never from the caller: a scoped write
      // with an unscoped read is not a scope. ADR-0001 Amendment K Decision 4.
      return store.getNavMetric(extensionId, nodeId);
    },

    publishPayload(channel: string, kind: BlockKind, data: unknown): void {
      assertLive('publishPayload');
      // `extensionId` from the closure, never from the caller — the scoping every
      // other write on this facade has.
      payloads.publish(extensionId, channel, kind, data);
    },

    readPayload(channel: string): StructuredPayload | null {
      assertLive('readPayload');
      return payloads.read(extensionId, channel);
    },

    subscribePayload(channel: string, listener: (payload: StructuredPayload) => void): () => void {
      // Liveness is checked when the subscription is TAKEN and deliberately not
      // again when it is dropped: the disposer `payloads.subscribe` returns is
      // total, so a pane unmounting after its extension was unregistered runs a
      // cleanup that throws nothing. See `IShellAPI.subscribePayload`.
      assertLive('subscribePayload');
      return payloads.subscribe(extensionId, channel, listener);
    },

    getTheme(): ResolvedTheme {
      assertLive('getTheme');
      return themes.getTheme();
    },

    onThemeChange(listener: (theme: ResolvedTheme) => void): () => void {
      // Liveness is checked when the subscription is TAKEN and deliberately not
      // again when it is dropped: the disposer is total, so a pane unmounting
      // after its extension was unregistered runs a cleanup that throws nothing.
      assertLive('onThemeChange');
      if (typeof listener !== 'function') {
        throw new ShellUXError(
          'INVALID_FIELD',
          `onThemeChange: "listener" must be a function; received ${describeUntrusted(listener)}.`,
          'listener',
        );
      }
      return themes.subscribe(listener);
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
 * subscriber in one renderer the same snapshot, so panes in it cannot tear" in
 * `src/core/__tests__/dataflow.test.tsx`.
 *
 * **CORRECTION, SINCE `src/core/ipc/**`: the claim holds within ONE RENDERER and
 * says nothing about two.** `useSyncExternalStore` closes a window inside a React
 * tree; it has no view of another process's tree. Two panes reading two replicas
 * can therefore hold different snapshots for one frame — the writing pane applies
 * optimistically and the other one hears about it a message later. That is SKEW,
 * not tearing: neither pane is internally inconsistent, and each is showing one
 * coherent snapshot. §5 of the native-host plan says to state it and not fix it,
 * because the only fix is a synchronous cross-process read, which is what the
 * replicated design exists to avoid. *Tests:*
 * `src/core/ipc/__tests__/replicaStore.test.ts` — "two replicas hold different
 * snapshots between a write and its commit, and converge on it".
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

/**
 * Subscribe to one node's badge count. Re-renders the calling component when
 * that badge changes, and not when anything else in the store does.
 *
 * **This is the badge-aware selector the store has been notifying for and
 * nothing had.** `setBadgeCount` commits its value and notifies, but badges are
 * deliberately not part of the `RibbonContext` snapshot, so a `useShellContext`
 * subscriber re-reads an unchanged snapshot and bails out — a runtime badge write
 * woke every listener and moved nothing. Reading through this hook is what turns
 * that notification into a render. Pinned by "re-renders when the badge it watches
 * is written" in `src/core/__tests__/badgeSelector.test.tsx`.
 *
 * **The snapshot is a primitive, so no memoisation is needed and none is used.**
 * `ShellStateStore.getBadgeCount` returns the `number` its `Map` holds, or
 * `undefined`, and allocates nothing on the way out; two reads of an unchanged
 * badge are therefore `Object.is`-equal and `useSyncExternalStore` bails out by
 * itself. A `useMemo` over it would buy nothing, because there is no identity to
 * stabilise. That bail-out carries more weight here than it does for the context:
 * a badge write notifies UNCONDITIONALLY — it does not compare the way
 * `applyPatch` does — so every badge write anywhere in the shell wakes every one
 * of these subscribers, and only the ones whose own value moved re-render. Pinned
 * by "does not re-render when the badge is rewritten with the value it already
 * holds" and "does not re-render when a different node's badge is written" in the
 * same file.
 *
 * **`extensionId` is a PARAMETER here, and that is deliberately not the
 * `IShellAPI` posture.** `IShellAPI.setBadgeCount` AND `IShellAPI.getBadgeCount`
 * both close over the scope the registry validated and offer no parameter through
 * which to aim elsewhere — the read half was added by GitHub issue #12 and was
 * scoped the same way as the write half precisely so that this contrast stays a
 * contrast; this hook names the scope it reads, because it is a host-side
 * selector over the unscoped store and a sidebar has to read every extension's
 * badges in order to draw them. That is consistent with the store underneath it and adds nothing to
 * what a caller already had: `useShellStore()` is public, so
 * `store.getBadgeCount('other-ext', 'inbox')` was reachable from anywhere inside
 * the provider before this hook existed. Badge scoping is collision-resistance,
 * not confinement — see `HOST_BADGE_SCOPE` above and ADR-0001 Amendment E. Pinned
 * by "reads whatever scope it is handed, including another extension's and the
 * host's" in `src/core/__tests__/badgeSelector.test.tsx`.
 *
 * **Both arguments are validated, and the rejection arrives DURING RENDER.** The
 * check is `store.getBadgeCount`'s own and is not restated here, so the two cannot
 * drift apart — but it runs inside `useSyncExternalStore`'s snapshot read, which
 * is a render-phase call. A component that passes a malformed id therefore fails
 * to render rather than quietly reading `undefined`, which is the same trade
 * `useExtensionUiState` makes in `src/hooks/useLocalStorageState.ts` and for the
 * same reason: a loud, deterministic failure at the point of the mistake. Pinned
 * by "raises INVALID_ID during render for a malformed scope, rather than reading
 * undefined" and "raises INVALID_ID during render for a malformed node id" in
 * `src/core/__tests__/badgeSelector.test.tsx`.
 *
 * @param extensionId The badge scope to read — a registry-valid extension id, or
 *   the host scope `createShellAPI` writes through.
 * @param nodeId The navigation node id within that scope.
 * @returns The badge count, or `undefined` when none was ever set for that node.
 * @throws {ShellUXError} `INVALID_ID` during render when `extensionId` is neither
 *   a registry-valid identifier nor the host scope, or `nodeId` is not a
 *   registry-valid identifier. That is the only code reachable from here: this
 *   hook reads and writes nothing else, so it never notifies and
 *   `REENTRANT_NOTIFY` cannot come out of it.
 * @throws when called outside `ShellHostProvider`.
 */
export function useBadgeCount(extensionId: string, nodeId: string): number | undefined {
  const store = useShellStore();
  const getSnapshot = useCallback(
    (): number | undefined => store.getBadgeCount(extensionId, nodeId),
    [store, extensionId, nodeId],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/**
 * The navigation tree `extensionId` last replaced through `setNavigationTree`,
 * or `undefined` when it has not — in which case the caller renders the
 * registered blueprint's tree. Subscribes, so pane 1 re-renders when the tree is
 * replaced or purged. ADR-0006 decision 8, GitHub issue #16.
 *
 * What this re-renders is observable in jsdom only as DOM text; nothing here is
 * a claim about layout.
 */
export function useNavigationTree(extensionId: string): readonly NavigationNode[] | undefined {
  const store = useShellStore();
  const getSnapshot = useCallback(
    (): readonly NavigationNode[] | undefined => store.getNavigationTree(extensionId),
    [store, extensionId],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/**
 * Subscribe to one node's live metric value. Re-renders the calling component
 * when that metric changes, and not when anything else in the store does.
 *
 * **`useBadgeCount`'s exact shape, and that is the decision rather than a
 * copy-paste.** A metric has the same lifetime a badge has, the same
 * blueprint-versus-store override question, and the same "my runtime write is
 * invisible" failure that issue #12 filed against badges. Rendering the
 * blueprint's `NavigationMetric.value` alone would reproduce that defect
 * exactly, so pane 1 reads through this hook and a store value overrides the
 * declared one — with `??`, never a truthiness test, because a metric written
 * down to `0` is a value and `||` would fall back to a stale blueprint number
 * for the very reading that matters most. Pinned by "overrides a blueprint
 * metric value with the store value, including down to zero" in
 * `src/components/__tests__/ShellLayoutMetrics.test.tsx`.
 *
 * The snapshot is a primitive, so no memoisation is needed and none is used: two
 * reads of an unchanged metric are `Object.is`-equal and `useSyncExternalStore`
 * bails out by itself. That bail-out carries the same weight it does for badges —
 * `setNavMetric` notifies UNCONDITIONALLY, so every metric write anywhere in the
 * shell wakes every one of these subscribers and only the rows whose own number
 * moved re-render. Pinned by "does not re-render when the metric is rewritten
 * with the value it already holds" in `src/core/__tests__/navMetric.test.tsx`.
 *
 * `extensionId` is a PARAMETER here for the reason it is one on `useBadgeCount`:
 * this is a host-side selector over the unscoped store, and a sidebar has to read
 * every extension's metrics in order to draw them. It adds nothing a caller did
 * not already have, because `useShellStore()` is public.
 *
 * **Both arguments are validated, and the rejection arrives DURING RENDER**, by
 * `store.getNavMetric`'s own check rather than a restatement here, so the two
 * cannot drift. A component that passes a malformed id fails to render rather
 * than quietly reading `undefined` — the same trade `useBadgeCount` makes. Pinned
 * by "raises INVALID_ID during render for a malformed metric scope" in
 * `src/core/__tests__/navMetric.test.tsx`.
 *
 * @param extensionId The metric scope to read — a registry-valid extension id,
 *   or the host scope `createShellAPI` writes through.
 * @param nodeId The navigation node id within that scope.
 * @returns The clamped metric value, or `undefined` when none was ever set.
 * @throws {ShellUXError} `INVALID_ID` during render for a malformed scope or node
 *   id. That is the only code reachable from here: this hook reads and writes
 *   nothing else, so it never notifies.
 * @throws when called outside `ShellHostProvider`.
 */
export function useNavMetric(extensionId: string, nodeId: string): number | undefined {
  const store = useShellStore();
  const getSnapshot = useCallback(
    (): number | undefined => store.getNavMetric(extensionId, nodeId),
    [store, extensionId, nodeId],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
