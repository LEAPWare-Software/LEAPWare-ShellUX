import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useRegistry, useRegistryRevision } from './RegistryContext';
import {
  ShellStoreContext,
  createRevocableShellAPI,
  createShellStateStore,
  useShellContext,
} from './ShellAPI';
import type { ShellStateStore } from './ShellAPI';
import { createPayloadChannelStore } from './payload/PayloadChannel';
import type { PayloadChannelStore } from './payload/PayloadChannel';
import { createThemeBridge } from './theme/ThemeBridge';
import type { ThemeBridgeStore } from './theme/ThemeBridge';
import { ShellUXError } from './types';
import type { IShellAPI, LEAPExtensionBlueprint } from './types';

/**
 * ============================================================================
 * TWO ORTHOGONAL STATES — READ BEFORE CHANGING ANYTHING HERE
 * ============================================================================
 * Activation is not one boolean. Conflating these two is the defect this module
 * exists to avoid, and it is the kind of defect that only shows up as "why did
 * the mail badge stop updating when I clicked away?".
 *
 * FOREGROUND (`RibbonContext.activeExtensionId`)
 *   Which single extension owns panes 2 and 3 right now. Exactly one, or none.
 *   Losing it REVOKES NOTHING: a backgrounded mail module keeps its `IShellAPI`
 *   and can still push an unread badge into pane 1, which is the entire point of
 *   a shell that hosts more than one thing at a time. `blur()` drops the
 *   foreground and touches nothing else.
 *
 * LIVENESS (an entry in `live`)
 *   Whether a usable `IShellAPI` is held for an extension at all. Minted on
 *   first activation, kept across any number of foreground changes, and ended by
 *   exactly two events: `release(id)`, and the extension being unregistered.
 *   Ending liveness revokes the handle — every later call through it throws
 *   `REVOKED` — and, because a dead extension cannot own a pane, also drops the
 *   foreground if it held it. `release` is pinned by "mints a live IShellAPI on
 *   activation and revokes it on release" in `dataflow.test.tsx`; unregister by
 *   "revocation on unregister is synchronous" in `capability.test.tsx`; and both
 *   together, on one handle, by the teardown test D7 in `capability.test.tsx`.
 *
 * So: liveness outlives foreground, foreground implies liveness, and the arrow
 * never points the other way.
 *
 * **Exactly two. Provider teardown is deliberately not a third**, and it was
 * described as one through two failed implementations. Both were broken in
 * development and correct in production, because a cleanup cannot tell a real
 * unmount from StrictMode's simulated remount — and revoking on teardown buys no
 * security, because the store dies with the provider and a write through a stale
 * handle afterwards reaches an object nothing can read. The full argument is above
 * the sweep effect in this file.
 * ============================================================================
 *
 * ============================================================================
 * THE CONTROLLER SPLIT IS A GUARDRAIL, NOT AN ENFORCED BOUNDARY
 * ============================================================================
 * Read this before describing `ExtensionHostBoundary` as isolation anywhere, and
 * before relying on it as isolation.
 *
 * `ActivationController` is a capability, not information: `release(id)` revokes
 * an extension and `activate(id)` HANDS BACK that extension's scoped `IShellAPI`.
 * Published to the whole provider subtree — which is what this module used to do
 * — any component in that subtree could revoke a sibling extension and then take
 * over its handle. `DEVELOPER.md` went further and *instructed* extension authors
 * to call `useActivation().activate('your-ext')`.
 *
 * So the surface is split by kind:
 *
 *   - `useActivation()` returns the full controller. It resolves through a
 *     context the host provides and refuses to answer at all from inside an
 *     `ExtensionHostBoundary`.
 *   - `ExtensionHostBoundary` is what the host wraps a plugin's subtree in. It
 *     severs the controller context and publishes the extension's own id.
 *   - `useExtensionActivation()` is what a plugin gets: its own id, the current
 *     foreground id, and whether those are the same. No `activate`, no `release`,
 *     no `blur`, and no route to another extension's `shell`.
 *
 * **What that is worth, precisely.** It closes the documented route, and it turns
 * the one mistake this project used to teach into a loud deterministic throw.
 * Neither context object is exported, so a plugin cannot re-provide one through
 * the public API. That is a genuine improvement and it is why the code stays. Pinned
 * by "ExtensionHostBoundary severs the host activation controller" in
 * `src/core/__tests__/capability.test.tsx`, and by "gives a plug-in no capability
 * through the documented channel" in `src/core/__tests__/reflection.test.tsx`.
 *
 * **What it is not.** It is not an enforceable boundary between extensions, and it
 * never will be in-page. The capability does not live in context; it lives in
 * `useMemo`/`useCallback`/`useRef` hook state on this provider's fiber, and React
 * hangs that fiber off the DOM under an own enumerable `__reactFiber$<random>`
 * property. Any script on the page — a third-party extension module is a script on
 * the page — starts at `document.body.firstElementChild`, enumerates
 * `Object.keys`, walks `return`/`child`/`sibling`, and arrives at this controller,
 * at the `live` map holding every extension's `revoke`, and at the store. No DOM
 * ref is needed and nothing has to be exported. Severing a context does not remove
 * a fiber from the tree, so severing context was never going to be enough.
 * `src/core/__tests__/reflection.test.tsx` PERFORMS that escalation rather than
 * describing it; it is a test to preserve, not to relax.
 *
 * Mitigations were investigated and rejected with evidence: freezing fibers or the
 * context object breaks React; deleting `__reactFiber$` breaks all event dispatch;
 * a Proxy wrapper cannot identify its caller; Symbol keys are enumerable through
 * `Reflect.ownKeys`; a ShadowRoot is not in the fiber tree and the DOM parent walk
 * escapes it anyway; lint and compile-time checks never see third-party
 * JavaScript. ADR-0001 Amendment E records all of that, together with the firm
 * condition that VOIDS the decision to settle for a guardrail.
 *
 * Two further limits, both real and neither closable here — and the fact that this
 * list exists at all is the point, because a guarantee that has to be defended by
 * enumerating channels is not structural. Host code that renders plugin components
 * as its own siblings, outside any boundary, hands them host capability; pane
 * rendering, the thing that will do the wrapping in production, is ISSUE-002 and
 * does not exist yet. And `useRegistry` is deliberately not severed, so
 * `unregister` remains a route to ending a sibling's liveness while `getExtension`
 * remains a route to a sibling's unfrozen view components.
 * ============================================================================
 */

/** One activated extension: its id, its host-owned record, and its handle. */
export interface ActiveExtension {
  /** The id the registry validated. */
  readonly id: string;
  /** Host-owned, deep-frozen normalised record — not the plugin's object. */
  readonly blueprint: LEAPExtensionBlueprint;
  /** Deep-frozen, scoped to this extension, and revocable by the host. */
  readonly shell: IShellAPI;
}

/**
 * The read-only view of activation a plugin subtree is given.
 *
 * Facts, not capability. Every field is either the plugin's own id or something
 * it can already read off `IShellAPI.getContext()`; there is nothing here it
 * could not learn anyway, which is the test a member has to pass to be on this
 * interface at all. Pinned by "gives a plug-in no capability through the documented
 * channel" in `src/core/__tests__/reflection.test.tsx`, which asserts the member list
 * is exactly these three.
 */
export interface ExtensionActivationView {
  /** The id of the extension whose subtree this is. */
  readonly extensionId: string;
  /** The extension that currently owns panes 2 and 3, or `null`. */
  readonly foregroundExtensionId: string | null;
  /** Whether this extension is the one in the foreground. */
  readonly isForeground: boolean;
}

export interface ActivationSuccess {
  readonly ok: true;
  readonly active: ActiveExtension;
}

export interface ActivationFailure {
  readonly ok: false;
  readonly error: ShellUXError;
}

/**
 * Result of `activate`. A discriminated union rather than an exception, for the
 * same reason as `RegistrationResult`: activation is driven by user input over
 * data the host does not own, so failing to activate must not be able to unmount
 * the shell through an error boundary.
 *
 * That covers every failure `activate` *decides on*. It is not a claim that
 * `activate` cannot throw: publishing the new foreground is a store write, the
 * store notifies synchronously, and `subscribe` is public — so a plugin listener
 * that throws propagates out. See `activate` below, and the tests that pin it.
 */
export type ActivationResult = ActivationSuccess | ActivationFailure;

/**
 * The host's activation capability.
 *
 * **HOST-ONLY BY CONVENTION AND BY GUARDRAIL, NOT BY ENFORCEMENT.** See the second
 * banner at the top of this file. `activate` hands back an extension's scoped
 * `IShellAPI` and `release` revokes one, so this object is not something a plugin
 * subtree may hold; `useActivation` refuses inside an `ExtensionHostBoundary` and
 * plugin code gets `ExtensionActivationView`. What that closes is the documented
 * route. It does not put this object out of reach of a caller who walks React's
 * fiber tree, and nothing in-page can.
 */
export interface ActivationController {
  /**
   * Bring `id` to the foreground, minting its `IShellAPI` if this is its first
   * activation and reusing the existing one if it is not.
   *
   * **Rejects an unusable id rather than throwing for it.** Not for an
   * unregistered id, not for an id that is not even a string: every step of the
   * resolution reads host-owned data only — a `Map` lookup on the registry, a
   * captured string, a facade built from host code — and no rejection message
   * interpolates a value that has not been proven to be a primitive string.
   *
   * It is **not** unconditionally total, and an earlier version of this comment
   * wrongly said it was. Publishing the new foreground writes
   * `activeExtensionId` through the shell store, and the store notifies its
   * subscribers synchronously. `useShellStore().subscribe` is public, so a
   * listener registered by plugin code runs inside that write; if it throws — or
   * if it writes back to the store hard enough to trip `REENTRANT_NOTIFY` — the
   * throw propagates out of here. The same is true of `blur` and `release`. A
   * host that treats listeners as untrusted should guard the call.
   *
   * **Lifecycle hooks (host contract 1.1) add three failures, all returned, none
   * thrown:** `LIFECYCLE_HOOK_THREW` when the extension's `onActivate` threw;
   * `REVOKED` when a hook — its own `onActivate` or the outgoing extension's
   * `onDeactivate` — unregistered it, so `ok` is never returned for a handle that
   * is already dead; and `LIFECYCLE_REENTRY` when this is called from inside a
   * running hook. A hook that throws is otherwise contained; see
   * `ExtensionLifecycle`.
   */
  activate(id: string): ActivationResult;
  /**
   * Drop the foreground. Panes 2 and 3 become unowned.
   *
   * **Revokes nothing.** Every live extension keeps its handle and can keep
   * writing badges. This is not `release`.
   *
   * Not total, for the same reason `activate` is not: dropping the foreground is a
   * store write, the store notifies synchronously, and `subscribe` is public — so a
   * plugin listener that throws comes straight back out of here. Pinned by a test.
   *
   * @throws {ShellUXError} `LIFECYCLE_REENTRY` when called from inside a running
   *   lifecycle hook — refused before anything moves.
   */
  blur(): void;
  /**
   * End an extension's liveness: revoke its `IShellAPI` permanently and, if it
   * held the foreground, drop that too.
   *
   * Not total, for the same reason as `activate` and `blur`. The revocation
   * happens first and unconditionally; the throw, if any, comes from re-publishing
   * the foreground afterwards.
   *
   * Like `activate`, it reports an unusable `id` rather than throwing for it: a
   * non-string is `false`, which is already the answer a `Map` lookup gave and is
   * already what this method means by "there was nothing to release". Pinned by
   * "reports false for a non-string id, without coercing it" in
   * `src/core/__tests__/dataflow.test.tsx`.
   *
   * @returns `true` when an extension was live under `id`, `false` when there
   *   was nothing to release — including when `id` is not a string.
   * @throws {ShellUXError} `LIFECYCLE_REENTRY` when called from inside a running
   *   lifecycle hook — refused before anything is released.
   */
  release(id: string): boolean;
  /**
   * The extension currently in the foreground, or `null`.
   *
   * Liveness is re-checked here rather than trusted from the last commit: an
   * extension unregistered a moment ago is gone and its handle already throws, so
   * reporting it as the foreground would be a lie for as long as it took the
   * sweep effect below to run.
   */
  getActive(): ActiveExtension | null;
}

/** A live extension: what is handed out, plus the host's off-switch for it. */
interface LiveEntry {
  readonly active: ActiveExtension;
  /**
   * Never reachable from `active.shell` — that much is unconditional, and is pinned
   * by "does not expose revoke to the plugin" in
   * `src/core/__tests__/dataflow.test.tsx`. It is reachable from this map, which is a
   * `useRef` on the provider fiber, so it is not out of a hostile caller's reach —
   * pinned by "reaches the provider live map, which holds revoke for every extension"
   * in `src/core/__tests__/reflection.test.tsx`. See the second banner above.
   */
  readonly revoke: () => void;
}

/**
 * The host capability. Neither this nor `ExtensionScopeContext` is exported, so a
 * plugin cannot re-provide either one through the public API to undo the boundary
 * below. That is a guardrail against an honest mistake, not a barrier: see the
 * second banner above for why context is the wrong place to look for the
 * capability in the first place.
 */
const ActivationControllerContext = createContext<ActivationController | null>(null);

/**
 * The id of the extension whose subtree this is, or `null` in host territory.
 *
 * Non-`null` is the marker that says "plugin code lives below here", and it is
 * what `useActivation` refuses on. Set only by `ExtensionHostBoundary`.
 */
const ExtensionScopeContext = createContext<string | null>(null);

export interface ShellHostProviderProps {
  readonly children: ReactNode;
  /**
   * The shell state store this provider owns. Defaults to a fresh local one.
   *
   * ==========================================================================
   * **THE ONE DOOR THROUGH WHICH TWO DOCUMENTS BECOME ONE SHELL.**
   * ==========================================================================
   * `createReplicaStore` in `src/core/ipc/ReplicaStore.ts` returns a
   * `ShellStateStore` — the same interface, the same validators, the same
   * notification semantics — that additionally posts every write it accepts over
   * a `PortLike` and applies the commits that come back. Handing one in here is
   * the whole of the wiring: everything below this provider goes on calling
   * `patchContext` and `setSelectedItem` exactly as it did in one process, and
   * the selection made in host chrome's pane 1 arrives in the extension view's
   * panes 2 and 3 because the store underneath is replicated rather than because
   * anything above it knows there are two documents.
   *
   * It is optional and the default is a plain local store, so the browser lane
   * and every existing test are unchanged: a document with no host beside it
   * replicates to nobody, which is the correct description of a shell that is
   * the only copy of itself.
   *
   * **Its identity must be stable across renders.** It is captured once, at
   * mount, exactly as the store it replaces was — a second store swapped in
   * later would be a second view of the context that no subscriber is watching.
   * The entry points create it at module scope for that reason, which is also
   * the reason it is not created in an effect: both documents render under
   * `StrictMode`, and an effect-time `connect` would open the port twice.
   */
  readonly store?: ShellStateStore | undefined;
  /**
   * Told when an extension's `lifecycle.onDeactivate` or `lifecycle.onRelease`
   * throws, or when its `onActivate` throws and its activation fails. ADR-0006
   * decision 9 names a throwing hook a tier-1 fault; this is where the loader
   * (step 6) learns of one to mark the plug-in crashed. Defaults to
   * `console.error`. A reporter that throws is ignored: the lifecycle step that
   * was running completes either way.
   */
  readonly onLifecycleFault?: ((fault: LifecycleFault) => void) | undefined;
}

/** A lifecycle hook, by name. See `ExtensionLifecycle` in `./types`. */
export type LifecycleHookName = 'onActivate' | 'onDeactivate' | 'onRelease';

/** One lifecycle hook that threw. */
export interface LifecycleFault {
  /** The extension whose hook threw. */
  readonly extensionId: string;
  readonly hook: LifecycleHookName;
  /** Whatever was thrown, untouched. It is plug-in data; inspect it guardedly. */
  readonly error: unknown;
}

/**
 * What was thrown, in words, without trusting it: an `Error`'s message, or the
 * value's string form, or — when reading either throws — its type.
 */
function describeThrown(error: unknown): string {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return `a value of type "${typeof error}" that could not be read`;
  }
}

/**
 * The failure `activate` returns when the extension it was activating stopped
 * being live while a hook ran — its own `onActivate`, or the outgoing
 * extension's `onDeactivate`, unregistered it. *Tests:*
 * `src/core/__tests__/lifecycle.test.tsx` — "does not report ok for an extension
 * whose onActivate unregistered it".
 */
function endedDuringActivation(id: string, hook: LifecycleHookName): ShellUXError {
  return new ShellUXError(
    'REVOKED',
    `activate: extension "${id}" was unregistered while lifecycle.${hook} ran, so it was not activated and its handle is revoked.`,
    'id',
  );
}

/**
 * Owns the one shell state store and the activation lifecycle for its subtree.
 *
 * Must be rendered inside an `ExtensionRegistryProvider`: activation resolves a
 * blueprint through the registry, and it watches the registry's revision so that
 * unregistering an extension revokes its handle.
 */
export function ShellHostProvider({
  children,
  store: suppliedStore,
  onLifecycleFault,
}: ShellHostProviderProps): ReactElement {
  const registry = useRegistry();
  const revision = useRegistryRevision();

  // One store, created once, for the provider's whole lifetime. Guarded rather
  // than passed straight to `useRef`, which would build and discard a store on
  // every render — and, with a supplied store, would be the harmless-looking
  // line that discards a REPLICA and its port.
  const storeRef = useRef<ShellStateStore | null>(null);
  storeRef.current ??= suppliedStore ?? createShellStateStore();
  const store: ShellStateStore = storeRef.current;

  // The structured payload channels, and they are a SECOND STORE rather than a
  // slice of the first. That separation is the answer to the first of ADR-0001
  // Amendment K Decision 2's three objections — a payload never enters
  // `RibbonContext`, so a render-phase predicate has no argument through which to
  // reach one and a publisher's getters never run on a render path. See ADR-0001
  // Amendment L and the banner in `payload/PayloadChannel.ts`. Guarded exactly
  // like the store above, and for the same reason.
  const payloadsRef = useRef<PayloadChannelStore | null>(null);
  payloadsRef.current ??= createPayloadChannelStore();
  const payloads: PayloadChannelStore = payloadsRef.current;

  // The theme bridge, resolved ONCE for this document rather than once per
  // reader — see `src/core/theme/ThemeBridge.ts`. Guarded exactly like the two
  // stores above, and for the same reason: an unguarded `useRef(create())` would
  // run one `getComputedStyle` per render and discard all but the first.
  const themesRef = useRef<ThemeBridgeStore | null>(null);
  themesRef.current ??= createThemeBridge(document.documentElement);
  const themes: ThemeBridgeStore = themesRef.current;

  // A Map, deliberately, for the same reason the registry uses one: the keys are
  // extension ids that originate in plugin manifests. Guarded exactly like the
  // store above and for the same reason: `useRef(new Map())` evaluates its
  // argument on every render and uses it only on the first, so the unguarded form
  // builds and discards a Map per render. Never reassigned after this, so `live`
  // is one object for the provider's whole lifetime and is stable in the
  // dependency arrays below.
  const liveRef = useRef<Map<string, LiveEntry> | null>(null);
  liveRef.current ??= new Map<string, LiveEntry>();
  const live: Map<string, LiveEntry> = liveRef.current;
  // The host's authoritative foreground handle. The store's `activeExtensionId`
  // is the published, renderable view of the same fact, kept in step below.
  const foreground = useRef<ActiveExtension | null>(null);

  /**
   * Is a handle minted for `id` against `record` still live?
   *
   * **Keyed on the record, not on the id being present.** This is the whole of
   * the revoked-on-unregister guarantee, and keying it on id presence was a real
   * defect rather than a simplification. `unregister(id)` followed by
   * `register(<a new blueprint under the same id>)` is the upgrade path
   * `DEVELOPER.md` documents, and React 18 batches two adjacent statements into
   * ONE commit — so "is `id` registered?" answered *yes* across the entire
   * operation and the previous vendor's handle stayed live, writing under a scope
   * the new registration owns. No hostile code was required.
   *
   * The registry builds a fresh host-owned record per registration and returns the
   * same object for the lifetime of that registration, including across the
   * StrictMode idempotent re-`register` of an identical blueprint. So record
   * identity is exactly a mint-time token: same id plus a different record is a
   * different extension, and this says so on the very first call rather than
   * relying on a latch that a handle nobody called has never had the chance to
   * fire. Pinned by "re-registering an id does not resurrect the previous handle" in
   * `src/core/__tests__/capability.test.tsx`.
   *
   * **Provider teardown is deliberately NOT one of the questions asked here, and
   * two earlier attempts to make it one were both wrong.** See the note above the
   * sweep effect below. The registry is the only thing consulted.
   */
  const isLive = useCallback(
    (id: string, record: LEAPExtensionBlueprint): boolean =>
      registry.getExtension(id) === record,
    [registry],
  );

  /**
   * Publish `next` as the foreground — and, when the foreground actually MOVES,
   * clear the per-extension context in the same patch.
   *
   * ==========================================================================
   * WHY THE SELECTION AND `activeNavNodeId` GO WITH IT
   * ==========================================================================
   * This used to patch `activeExtensionId` alone, which leaked one extension's
   * state into the next one's. Every leaked field belongs to whichever extension
   * is in the foreground and to nothing else: the selection is a set of row keys
   * in that extension's own list, `activeNavNodeId` names a node in that
   * extension's own navigation tree, and `contextKeys` is a record that extension
   * published about its own panes. None of them means anything to the extension
   * that replaces it, and `contextKeys` is the case where that would be worst —
   * a predicate is a pure function of the context, so a stale key from the
   * previous vendor is indistinguishable to it from one this vendor set.
   *
   * The consequence was not cosmetic. A newly activated extension was handed a
   * selection id belonging to a different vendor, so its `isVisible` predicates
   * asking "is anything selected?" answered TRUE for an item it cannot open, and
   * it rendered ribbon actions whose `onExecute` would fail on the first click.
   * The mock extensions defended themselves by prefixing their item ids, which is
   * a plug-in-side workaround for a host-side leak: it only works if every vendor
   * independently invents the same convention, and it cannot address
   * `activeNavNodeId` at all, since a nav node id is registry-validated and a
   * prefix is not part of that grammar.
   *
   * **One patch, not three.** `applyPatch` validates every supplied field, builds
   * one draft and notifies once, so a subscriber observes the whole transition as
   * a single coherent snapshot. Three separate `patchContext` calls would notify
   * three times, and the first notification would carry the NEW `activeExtensionId`
   * beside the OLD `selectedItemId` — exactly the torn state this is fixing,
   * handed to every subscriber as a real, readable context. Pinned by "never lets
   * a subscriber observe the new extension beside the old selection" in
   * `src/core/__tests__/activationHandover.test.tsx`.
   *
   * **Only on a real move**, which is why `previous` is compared before it is
   * overwritten. Republishing an unchanged foreground is ordinary here, not
   * exotic: `reconcileForeground` runs from the sweep effect on EVERY registry
   * revision, so merely registering a second extension re-publishes the current
   * one; `activate` on the already-foreground id reuses and republishes the same
   * entry; and `blur` is legal when nothing is in the foreground. Clearing on
   * those would wipe a live selection the user had just made, for no transition at
   * all. Pinned by "does not clear a live selection when the same foreground is
   * republished" in `src/core/__tests__/activationHandover.test.tsx`.
   *
   * The comparison is on the `ActiveExtension`'s IDENTITY rather than on its id,
   * for the same reason `isLive` is keyed on the blueprint record and
   * `reconcileForeground` tests the entry: after an unregister/re-register cycle
   * the id can be unchanged while belonging to a different extension, and that
   * extension is entitled to a clean context just as much as one with a new name
   * is. Same id, different record, different vendor.
   * ==========================================================================
   */
  const publishForeground = useCallback(
    (next: ActiveExtension | null): void => {
      const previous = foreground.current;
      foreground.current = next;
      const activeExtensionId = next === null ? null : next.id;
      if (previous === next) {
        // A republish, not a handover. The patch is still made: it is a per-field
        // no-op when the store already agrees, and it is the correction when
        // something has written over the published foreground since.
        store.patchContext({ activeExtensionId });
        return;
      }
      // Two halves of one handover, and the order is load-bearing.
      //
      // FIRST the bookkeeping: `clearContextKeys` drops every extension's
      // context-key namespace and deliberately neither patches nor notifies.
      // SECOND the publication: one patch carrying the new foreground, an empty
      // selection, no nav node and an empty context-key record. Doing the
      // bookkeeping inside the patch is impossible — it is store state, not
      // context state — and doing it after would leave a window in which the
      // published record said "empty" while the namespaces behind it did not.
      //
      // `selectedItemIds` is the field that carries the selection since GitHub
      // issue #14, and it is cleared HERE rather than left to be inferred from
      // `selectedItemId`. Naming both in the one patch is not belt and braces:
      // `applyPatch` resolves the pair with `selectedItemIds` winning, so this
      // says exactly what it means, and the alternative — clearing only the
      // derived shorthand — would have worked by accident through the very
      // precedence rule that exists to stop the two disagreeing.
      store.clearContextKeys();
      store.patchContext({
        activeExtensionId,
        activeNavNodeId: null,
        selectedItemIds: [],
        selectedItemId: null,
        contextKeys: {},
      });
    },
    [store],
  );

  /**
   * Re-derive the foreground from liveness. The foreground must always be a live
   * extension, so an extension that has just lost its liveness loses the
   * foreground with it; one that still has it keeps it, and re-publishing the
   * same entry is a no-op because `patchContext` compares per field — and because
   * `publishForeground` treats an unchanged entry as a republish rather than a
   * handover, so a sweep that moves nothing clears nothing.
   *
   * The test is on the ENTRY's identity, not on the id being a key in the map, for
   * the same reason liveness is keyed on the blueprint record: after an
   * unregister/re-register cycle the id can be present while belonging to a
   * different extension, and "my id is in the map" would then keep a foreground the
   * host has already replaced.
   */
  const reconcileForeground = useCallback((): void => {
    const current = foreground.current;
    const held = current === null ? undefined : live.get(current.id);
    publishForeground(held !== undefined && held.active === current ? current : null);
  }, [live, publishForeground]);

  // Kept in a ref so the controller's identity does not move with the prop; read
  // at the moment of the fault. Assigned in a layout effect rather than during
  // render, so a render React throws away cannot install a reporter.
  const faultReporter = useRef(onLifecycleFault);
  useLayoutEffect(() => {
    faultReporter.current = onLifecycleFault;
  }, [onLifecycleFault]);

  /**
   * Report a lifecycle hook that threw. Never throws: `console` is not the
   * host's object (see the sweep effect's note), and the lifecycle step that was
   * running has to complete either way.
   */
  const reportFault = useCallback((fault: LifecycleFault): void => {
    try {
      const report = faultReporter.current;
      if (report !== undefined) {
        report(fault);
        return;
      }
      console.error(
        `ShellHostProvider: extension "${fault.extensionId}" threw from lifecycle.${fault.hook}. The shell contained it to that extension's registration and carried on.`,
        fault.error,
      );
    } catch {
      // Reporting is best-effort. Completing the lifecycle step is not.
    }
  }, []);

  /**
   * How many lifecycle hooks are running right now. While it is above zero,
   * `activate`, `blur` and `release` refuse with `LIFECYCLE_REENTRY` — see
   * `callHook`.
   */
  const hookDepth = useRef(0);

  /**
   * Call one lifecycle hook with no `this`, counting it in `hookDepth`, and
   * watch what it returns. A SYNCHRONOUS throw propagates to the caller, which
   * decides what it costs; everything else is decided here.
   *
   * **Re-entry is refused, not deferred.** A hook that reaches the controller —
   * which a plug-in is not handed, but host code or a reflective walk can be —
   * and calls `activate`, `blur` or `release` would otherwise run a second
   * handover inside the first: `activate` could recurse through two extensions'
   * `onDeactivate`, or return `ok` for an extension that is no longer in the
   * foreground. Deferring the call would hand it a result it asked for and did
   * not get. So it is refused with a named error at the call, in the hook's own
   * frame. `registry.unregister` is not refused — the registry is not this
   * controller, and a plug-in calling it on itself is ordinary — and `activate`
   * re-checks liveness after each hook instead. *Tests:*
   * `src/core/__tests__/lifecycle.test.tsx` — "refuses an activate made from
   * inside onDeactivate, and the outer handover completes".
   *
   * **An async hook is not awaited, and its rejection is not lost.** The hooks
   * are typed `=> void`, which an `async` function satisfies, so a returned
   * thenable is expected rather than exotic. When the value returned is an
   * object with a callable `then`, a rejection handler is attached that reports
   * through `reportFault` like a synchronous throw; reading `then` or calling it
   * throwing is reported the same way. Nothing waits: an `onActivate` that
   * rejects later does not un-fail or fail an activation already returned, and
   * an `onRelease` that rejects later does not delay the revocation. *Tests:*
   * `src/core/__tests__/lifecycle.test.tsx` — "reports an async hook's rejection
   * through the fault path, without awaiting it".
   */
  const callHook = useCallback(
    (extensionId: string, hook: LifecycleHookName, invoke: () => unknown): void => {
      // The whole call, INCLUDING reading and calling a returned `then`, is
      // inside the counted window: `then` is plug-in code too, and running it
      // after the guard dropped let it re-enter the controller. *Tests:*
      // `src/core/__tests__/lifecycle.test.tsx` — "refuses an activate made from
      // inside a hook's returned then".
      hookDepth.current += 1;
      try {
        const returned: unknown = invoke();
        if (typeof returned !== 'object' || returned === null) {
          return;
        }
        const onRejected = (error: unknown): void => {
          reportFault({ extensionId, hook, error });
        };
        try {
          const then: unknown = (returned as { then?: unknown }).then;
          if (typeof then === 'function') {
            (then as (fulfilled: undefined, rejected: (error: unknown) => void) => unknown).call(
              returned,
              undefined,
              onRejected,
            );
          }
        } catch (error) {
          onRejected(error);
        }
      } finally {
        hookDepth.current -= 1;
      }
    },
    [reportFault],
  );

  /** The named refusal for a controller call made from inside a hook. */
  function reentryError(method: string): ShellUXError {
    return new ShellUXError(
      'LIFECYCLE_REENTRY',
      `${method}: called from inside an extension's lifecycle hook. A hook may not start another activation, blur or release while one is running; the call was refused and changed nothing.`,
      null,
    );
  }

  /**
   * Call `hook` on `entry`'s extension, if it declared one, containing a throw.
   */
  const runHook = useCallback(
    (entry: LiveEntry, hook: 'onDeactivate' | 'onRelease'): void => {
      const declared = entry.active.blueprint.lifecycle?.[hook];
      if (declared === undefined) {
        return;
      }
      try {
        callHook(entry.active.id, hook, () => declared());
      } catch (error) {
        reportFault({ extensionId: entry.active.id, hook, error });
      }
    },
    [callHook, reportFault],
  );

  /**
   * End one extension's liveness: `onRelease`, then revocation. ADR-0006
   * decision 8, GitHub issue #17.
   *
   * **Out of the live map FIRST**, before any plug-in code runs, so an
   * `onRelease` that re-enters — unregistering itself, say — finds nothing left
   * to release and cannot run a second time. The handle does not consult this
   * map, so it still works inside the hook: that is what "before revocation"
   * buys the extension.
   *
   * **Revocation in a `finally`.** `runHook` contains a throw, so nothing should
   * escape it; the `finally` makes "revokes even when it throws" a property of
   * this function's shape rather than of that one's. *Tests:*
   * `src/core/__tests__/lifecycle.test.tsx` — "calls onRelease before
   * revocation, and revokes even when it throws".
   */
  const endLiveness = useCallback(
    (id: string, entry: LiveEntry): void => {
      live.delete(id);
      try {
        runHook(entry, 'onRelease');
      } finally {
        entry.revoke();
        // The bookkeeping half of a teardown: a released extension's channels go
        // with its handle. Leaving them would mean a scope that outlives the
        // extension it belongs to, and a re-registration under the same id
        // inheriting the previous vendor's published data.
        payloads.clearScope(id);
      }
    },
    [live, payloads, runHook],
  );

  /**
   * Tell the extension leaving the foreground, if it is still the live one.
   * `next` is what is about to be published: republishing the current
   * foreground is not a loss, and a foreground whose live entry has gone or been
   * replaced — an id unregistered and registered again in one handler — has no
   * live handle left to be told through.
   */
  const deactivateOutgoing = useCallback(
    (next: ActiveExtension | null): void => {
      const previous = foreground.current;
      if (previous === null || previous === next) {
        return;
      }
      const outgoing = live.get(previous.id);
      if (outgoing === undefined || outgoing.active !== previous) {
        return;
      }
      runHook(outgoing, 'onDeactivate');
    },
    [live, runHook],
  );

  const activate = useCallback(
    (id: string): ActivationResult => {
      if (hookDepth.current > 0) {
        return { ok: false, error: reentryError('activate') };
      }
      const requested: unknown = id;
      if (typeof requested !== 'string') {
        // Reported by type alone. The value is not stringified — a non-string id
        // can be an object whose `toString` throws, and this method may not.
        return {
          ok: false,
          error: new ShellUXError('INVALID_ID', 'activate: "id" must be a string.', 'id'),
        };
      }

      const blueprint = registry.getExtension(requested);
      if (blueprint === undefined) {
        // `requested` is a primitive string here, so interpolating it is safe.
        return {
          ok: false,
          error: new ShellUXError(
            'INVALID_ID',
            `activate: no extension is registered with id "${requested}". Register the blueprint before activating it.`,
            'id',
          ),
        };
      }

      let entry = live.get(requested);
      if (entry !== undefined && entry.active.blueprint !== blueprint) {
        // The registry holds a DIFFERENT record under this id than the one this
        // entry was minted against: the extension was unregistered and something
        // else registered under its id. Same key, different extension.
        //
        // Reached when no commit has separated the re-registration from this call
        // AND this provider did not hear the unregister — which, since the
        // before-unregister subscription below releases the entry itself, means
        // one made before that subscription existed: a descendant's layout effect
        // in the first commit. Without this the cached entry was returned and the
        // host would render the OLD version's view components after a successful
        // upgrade. *Tests:* `src/core/__tests__/lifecycle.test.tsx` — "still
        // replaces a stale entry when activate runs before the provider
        // subscribed".
        entry.revoke();
        live.delete(requested);
        payloads.clearScope(requested);
        entry = undefined;
      }
      if (entry === undefined) {
        // First activation: mint the handle. The host keeps `revoke`; only `api`
        // goes any further than this closure.
        //
        // The third argument is the call-time liveness predicate. Without it,
        // revocation-on-unregister lands only when the sweep effect below runs,
        // one commit later, and every write in between succeeds. `registry`
        // resolves synchronously off a `Map`, so asking it on every call costs a
        // lookup and closes the window outright. `blueprint` is captured as the
        // mint-time token; see `isLive`.
        const revocable = createRevocableShellAPI(
          store,
          requested,
          () => isLive(requested, blueprint),
          // The provider's ONE payload store, so a channel written by this
          // extension's pane 2 is the channel its pane 3 reads. A per-facade
          // store would be the module-scope defect the mocks were migrated off,
          // rebuilt one layer down.
          payloads,
          // ...and the provider's ONE theme bridge, so every extension reads the
          // same resolved record and the document is measured once.
          themes,
        );
        // `Object.freeze`, NOT `deepFreeze`.
        //
        // The two members are frozen at the levels the host owns — the blueprint
        // by the registry, the facade by `createRevocableShellAPI` — and walking
        // deeper would reach the plugin's own view components and ribbon
        // callbacks, which the registry deliberately leaves alone: they are not
        // the host's to freeze and `memo`/`forwardRef` internals break when they
        // are.
        //
        // **The accepted consequence, stated rather than glossed:** those four
        // function objects (`blueprint.views.pane2`, `blueprint.views.pane3`, and
        // each action's `isVisible`/`onExecute`) still accept new own properties.
        // Anything that reaches them can therefore set, say, `defaultProps` on
        // another extension's view component and change what it renders. That is
        // real, it is reproducible, and freezing is not the fix.
        //
        // **It is NOT contained**, and this comment used to claim it was — that
        // the reach "is bounded by who can obtain an `ActiveExtension`, which now
        // means the host-only controller". That does not follow. `getExtension`
        // returns the host-owned record carrying the SAME unfrozen function
        // objects, and `useRegistry` is deliberately not severed at the boundary,
        // so any component in the tree reaches them without an `ActiveExtension`
        // ever existing — pinned in `capability.test.tsx`. The reflective route in
        // `reflection.test.tsx` reaches them too. This is the "No sandbox" limit in
        // ADR-0001 in its plainest form: the architecture defends against accident
        // and collision between mutually untrusting extensions, and against a
        // determined hostile one it does not defend at all.
        entry = Object.freeze({
          active: Object.freeze({ id: requested, blueprint, shell: revocable.api }),
          revoke: revocable.revoke,
        });
        live.set(requested, entry);
      }
      // Re-activation reuses the entry, so an extension that is brought back to
      // the foreground gets the SAME handle it had before. A new one would
      // silently invalidate every reference the extension is holding.
      const taking = foreground.current !== entry.active;
      deactivateOutgoing(entry.active);
      if (live.get(requested) !== entry) {
        // The outgoing extension's `onDeactivate` unregistered THIS one. Nothing
        // live is left to publish; the outgoing extension was told it lost the
        // foreground, so it loses it.
        publishForeground(null);
        return { ok: false, error: endedDuringActivation(requested, 'onDeactivate') };
      }
      publishForeground(entry.active);
      // `onActivate` AFTER the publish, so the context the extension reads is
      // already its own and a context key it writes is not wiped by the
      // handover's clear. Only when the foreground actually moved to it.
      const onActivate = taking ? blueprint.lifecycle?.onActivate : undefined;
      if (onActivate !== undefined) {
        const shell = entry.active.shell;
        try {
          callHook(requested, 'onActivate', () => onActivate(shell));
        } catch (error) {
          // CONTAINED to this extension's registration: its handle is released
          // (`onRelease`, then revocation) and the foreground it had just taken
          // is dropped. Its registration and every other extension's handle are
          // untouched. The live-map check is for an `onActivate` that already
          // ended its own liveness — unregistering itself — before it threw.
          if (live.get(requested) === entry) {
            endLiveness(requested, entry);
          }
          reportFault({ extensionId: requested, hook: 'onActivate', error });
          reconcileForeground();
          return {
            ok: false,
            error: new ShellUXError(
              'LIFECYCLE_HOOK_THREW',
              `activate: extension "${requested}" threw from lifecycle.onActivate, so its activation failed and its handle was released. It threw: ${describeThrown(error)}`,
              'lifecycle.onActivate',
            ),
          };
        }
        if (live.get(requested) !== entry) {
          // `onActivate` returned normally after unregistering its own extension:
          // the handle it was given is revoked, so `ok` would be a lie.
          reconcileForeground();
          return { ok: false, error: endedDuringActivation(requested, 'onActivate') };
        }
      }
      return { ok: true, active: entry.active };
    },
    [
      callHook,
      deactivateOutgoing,
      endLiveness,
      isLive,
      live,
      payloads,
      publishForeground,
      reconcileForeground,
      registry,
      reportFault,
      store,
      themes,
    ],
  );

  const blur = useCallback((): void => {
    if (hookDepth.current > 0) {
      throw reentryError('blur');
    }
    // Foreground only. Liveness is untouched, on purpose.
    deactivateOutgoing(null);
    publishForeground(null);
  }, [deactivateOutgoing, publishForeground]);

  const release = useCallback(
    (id: string): boolean => {
      // This was the one door in the module that took its `string` parameter on
      // trust, and the rule the rest of it follows is that a declared type binds
      // no plain-JavaScript caller: `activate` proves `id` before using it and
      // `ExtensionHostBoundary` proves `extensionId` before using it.
      //
      // **The check is redundant, and the reasoning is written down rather than
      // deleted**, because a later reader who removes it should have to argue
      // with it first. `id` reaches exactly one operation, `Map.prototype.get`.
      // That is a `SameValueZero` key comparison: it invokes no `toString`, no
      // `valueOf`, no `Symbol.toPrimitive` and no Proxy trap, and it cannot
      // throw. A non-string therefore already missed every key and already
      // returned `false`. The value is never interpolated into a message and
      // never stored.
      //
      // `false`, not a thrown `ShellUXError`, and that is the deliberate half.
      // `false` is already this method's documented answer for "there was nothing
      // to release", and it keeps this member consistent with `activate`, which
      // reports an unusable id rather than throwing for it. Pinned by "reports
      // false for a non-string id, without coercing it" in
      // `src/core/__tests__/dataflow.test.tsx`.
      if (hookDepth.current > 0) {
        throw reentryError('release');
      }
      const requested: unknown = id;
      if (typeof requested !== 'string') {
        return false;
      }
      const entry = live.get(requested);
      if (entry === undefined) {
        return false;
      }
      // `onRelease`, then revocation, then the channels. See `endLiveness`.
      endLiveness(requested, entry);
      reconcileForeground();
      return true;
    },
    [endLiveness, live, reconcileForeground],
  );

  const getActive = useCallback((): ActiveExtension | null => {
    const current = foreground.current;
    // The same predicate the facade uses, for the same reason: between an
    // `unregister` and the commit of the sweep effect below, this extension no
    // longer exists and its `shell` already throws `REVOKED`. Returning it would
    // hand the caller an `ActiveExtension` that cannot do anything — and, keyed on
    // the record rather than the id, that now covers an id re-registered by
    // somebody else in the same commit.
    if (current !== null && !isLive(current.id, current.blueprint)) {
      return null;
    }
    return current;
  }, [isLive]);

  /**
   * Inside every `unregister`, BEFORE the registry removes the record: release
   * the extension if it is live against that record — so `onRelease` runs while
   * its handle still works — and purge its store scope. ADR-0006 decision 8,
   * GitHub issues #17 and #80.
   *
   * **Why here and not in the sweep below.** The handle is revoked the moment
   * the registry stops holding the record, so the sweep, which runs after the
   * commit, is too late to call anything "before revocation"; and purging in the
   * sweep would wipe what a NEW registration under the same id had already
   * written in the same commit. The purge runs whether or not the extension was
   * ever activated: a never-activated scope can still hold state written through
   * the public store.
   *
   * **A layout effect**, because every layout effect in a commit runs before any
   * passive one — so this is subscribed before a descendant's mount-time
   * `useEffect` can register, activate and unregister. A descendant doing that
   * from a LAYOUT effect would run first and get only the sweep: revocation
   * without `onRelease`, and a late purge only when the id is not registered
   * again — a same-id re-registration inherits the old scope. Nothing in this
   * repository does that; ADR-0006's step-5 review note states the remainder. The
   * disposer makes StrictMode's simulated remount a clean unsubscribe and
   * resubscribe.
   *
   * *Tests:* `src/core/__tests__/lifecycle.test.tsx` — "unregister purges the
   * scope's badges and context keys".
   */
  useLayoutEffect(
    () =>
      registry.onBeforeUnregister((id, record): void => {
        const entry = live.get(id);
        if (entry !== undefined && entry.active.blueprint === record) {
          endLiveness(id, entry);
        }
        store.purgeScope(id);
      }),
    [endLiveness, live, registry, store],
  );

  /**
   * Unregistering an extension ends its liveness — this is the BOOKKEEPING half.
   *
   * The registry has no authorisation model and no listeners, so the revision
   * counter is the signal: it changes on every registration and removal, and
   * `useEffect` therefore runs immediately after the removal commits. Any live
   * entry the registry no longer holds the matching record for is dropped from the
   * map and its `revoke` latched here, and the foreground is re-derived.
   *
   * **The comparison is on the record, not on the id.** Presence of the id was the
   * wrong question: `unregister` and `register` under the same id land in one
   * commit, so this sweep saw the id present, skipped the entry, and left the
   * previous vendor's handle live. See `isLive` above.
   *
   * **What this effect no longer carries on its own is the guarantee.** An effect
   * runs after the commit, so between `unregister()` and this sweep there was a
   * window — the rest of the calling event handler, and anything awaited from it —
   * in which a retained handle still wrote successfully. That window is closed at
   * the other end now: the facade minted in `activate` re-asks the registry on
   * every call, so an unregistered extension's handle throws `REVOKED` from the
   * statement after `unregister`, not from the next commit. This effect keeps the
   * map and the published foreground tidy; it is not the thing standing between a
   * forgotten extension and the store.
   *
   * ==========================================================================
   * WHY PROVIDER TEARDOWN DOES NOT REVOKE, AFTER TWO ATTEMPTS THAT DID
   * ==========================================================================
   * There used to be a second effect here whose cleanup ended every liveness the
   * provider had granted, on the reasoning that a handle outliving its provider
   * reaches an orphaned store, so a write through it evaporates silently. Both
   * implementations of it were defects, and they were the SAME defect:
   *
   *  1. A revoke loop over the live map, on the premise that under StrictMode the
   *     map "is still empty because nothing has been activated yet". It is not:
   *     passive effects flush child-first, so a descendant that registers and
   *     activates from its own mount effect — the pattern `DEVELOPER.md`
   *     documents — has already filled the map.
   *  2. A `mounted` flag, flipped false in the cleanup and true again in the
   *     effect body, with the premise that "nothing observes the handle between
   *     the cleanup and the re-run, because both happen inside one synchronous
   *     flush". Something does. Passive effects flush child-first in BOTH
   *     directions, so the simulated remount runs every destroy (child, then this
   *     provider → flag false) and only then every create (child FIRST, this
   *     provider LAST). A descendant that USES its handle inside that mount
   *     effect saw the flag false, and `assertLive` latched the handle revoked
   *     for the rest of the session. Reproduced as `["ok", "REVOKED"]`.
   *
   * The common cause is not the mechanism, it is the position: **a cleanup cannot
   * distinguish a real unmount from StrictMode's simulated remount**, so anything
   * that acts there is wrong in development exactly when it is right in
   * production. That is the worst shape a bug has, and it was being paid for
   * something worth nothing: revoking on teardown buys **no security**. The store
   * dies with the provider. A write through a stale handle afterwards reaches an
   * object nothing is subscribed to and nothing can read — it cannot touch a NEW
   * provider's store, because that provider creates its own. The value on offer
   * was diagnostic only, and it was not worth a development-only outage.
   *
   * **So liveness ends by exactly two events, and provider teardown is not one of
   * them:** `release(id)`, and the extension being unregistered. Both are things
   * somebody DID to the extension, both are observable, and neither has a
   * StrictMode double. `capability.test.tsx` pins the consequence for teardown
   * rather than deleting the question.
   * ==========================================================================
   */
  useEffect(() => {
    // `revision` is in the dependency list below and is deliberately not read
    // in this body: it is the CHANGE TRIGGER, not an input. Its value carries no
    // meaning; the only thing it announces is that the registry's contents moved.
    // DO NOT remove it from the dependencies because it looks unused — that
    // silently turns this sweep into a mount-only effect and an unregistered
    // extension keeps a live handle.
    const purges: string[] = [];
    for (const [id, entry] of live) {
      // `isLive` itself, so the sweep's question and the facade's question cannot
      // drift apart. They used to differ because `isLive` also consulted a
      // `mounted` flag this body had to avoid; that flag is gone.
      if (isLive(id, entry.active.blueprint)) {
        continue;
      }
      entry.revoke();
      live.delete(id);
      payloads.clearScope(id);
      // Normally the before-unregister listener has already purged this scope
      // and this entry is not here. It is here when the unregister came before
      // that listener was subscribed (see its note), and then the scope is purged
      // late — unless the id is registered again, in which case the scope is the
      // new registration's and is left alone. *Tests:*
      // `src/core/__tests__/lifecycle.test.tsx` — "purges late, in the sweep, for
      // an unregister made before the provider subscribed".
      if (registry.getExtension(id) === undefined) {
        purges.push(id);
      }
    }
    // **Guarded, and this is the one call site a host cannot guard for itself.**
    // `reconcileForeground` publishes through the store, the store notifies
    // synchronously, and `subscribe` is public — so plugin code runs inside this
    // write. `activate`, `blur` and `release` are all called BY the host, so the
    // advice "guard the call if you treat listeners as untrusted" is actionable
    // for them. Here the caller is React's passive-effect flush and there is no
    // host statement to wrap: a throw escapes it, reaches no error boundary, and
    // unmounts the whole root. One `subscribe` and any registry change that moves
    // the foreground was enough to take the shell down.
    //
    // Catching is safe because the write has already committed by the time a
    // listener runs — `applyPatch` notifies last — so the bookkeeping this effect
    // exists for is complete and the published context is correct. What is left is
    // a listener that misbehaved, which is reported rather than swallowed. It is
    // deliberately not re-raised: there is nowhere to raise it TO that does not
    // cost the shell.
    //
    // **The report is guarded too, and it was not.** `console` is no more the
    // host's object than a listener is: a plug-in that replaces `console.error`
    // with a throwing function turns this reporting call into a SECOND escape from
    // the same effect, and that throw reaches no error boundary and unmounts the
    // whole root — resurrecting exactly the failure this guard exists to prevent.
    // Reproduced as `CONSOLE-THROWS: ESCAPED` followed by React's own
    // `Should not already be working.`; pinned by "survives a console.error that
    // throws" in `capability.test.tsx`. The precondition is global tampering,
    // which ADR-0001's threat model concedes rather than defends against — but the
    // guard is one `try`, which is cheaper than the argument for omitting it.
    // Nothing is attempted in the handler: there is no second reporting channel
    // that is any more the host's than `console` is.
    // Each store write guarded on its own, so one listener's throw neither skips
    // the next purge nor the foreground re-publication.
    const guarded = (work: () => void): void => {
      try {
        work();
      } catch (error) {
        try {
          console.error(
            'ShellHostProvider: a shell store listener threw while the foreground was being re-published after a registry change. The registry sweep completed and the shell is still running; fix the listener. A listener is a signal to re-read the context, not a place to work in.',
            error,
          );
        } catch {
          // Reporting is best-effort. Staying mounted is not.
        }
      }
    };
    for (const id of purges) {
      guarded(() => {
        store.purgeScope(id);
      });
    }
    guarded(reconcileForeground);
  }, [isLive, live, payloads, reconcileForeground, registry, revision, store]);

  const controller = useMemo<ActivationController>(
    () => ({ activate, blur, release, getActive }),
    [activate, blur, release, getActive],
  );

  return (
    <ShellStoreContext.Provider value={store}>
      <ActivationControllerContext.Provider value={controller}>
        {children}
      </ActivationControllerContext.Provider>
    </ShellStoreContext.Provider>
  );
}

export interface ExtensionHostBoundaryProps {
  /** The extension this subtree belongs to. A registry-validated id. */
  readonly extensionId: string;
  readonly children: ReactNode;
}

/**
 * Wrap a plugin's subtree. **The host renders this; a plugin never does.**
 *
 * It does two things: it takes the `ActivationController` out of context for
 * everything below it, and it publishes `extensionId` — which is what
 * `useExtensionActivation` reads and what `useActivation` refuses on.
 *
 * **This is a guardrail, not an enforcement boundary. Read the banner at the top
 * of this file.** Removing the controller from context removes it from the
 * documented route, which is worth having: the one mistake `DEVELOPER.md` used to
 * actively instruct becomes a loud deterministic throw. It does not put the
 * capability out of reach, because context is not where the capability lives.
 *
 * `extensionId` must be a `string`. It is host-supplied in every intended use and
 * is not held to `EXTENSION_ID_PATTERN` here — it is the id the registry already
 * checked — but the TYPE is enforced, because the type declaration is not binding
 * on a plain-JavaScript caller and a non-string is not merely wrong, it is
 * *load-bearing*: `null` or `undefined` CLEARS the scope marker instead of setting
 * it, at which point a provider nested inside this boundary answers
 * `useActivation()` and hands the controller back. A guardrail that a typo
 * silently disables is not a guardrail. The value is never interpolated into the
 * message, so a caller that passes something exotic cannot detonate it here.
 *
 * All of this is pinned under "ExtensionHostBoundary severs the host activation
 * controller" in `src/core/__tests__/capability.test.tsx`, including the nested
 * provider and the non-string `extensionId`.
 */
export function ExtensionHostBoundary({
  extensionId,
  children,
}: ExtensionHostBoundaryProps): ReactElement {
  const scope: unknown = extensionId;
  if (typeof scope !== 'string') {
    throw new Error(
      'ExtensionHostBoundary: "extensionId" must be a string. A non-string clears the extension scope instead of setting it, which turns the boundary off.',
    );
  }
  return (
    <ExtensionScopeContext.Provider value={scope}>
      <ActivationControllerContext.Provider value={null}>
        {children}
      </ActivationControllerContext.Provider>
    </ExtensionScopeContext.Provider>
  );
}

/**
 * The activation controller for the surrounding `ShellHostProvider`. Its
 * identity is stable, so it is safe in a dependency array.
 *
 * **Host-only.** Inside an `ExtensionHostBoundary` this throws instead of
 * answering, because the controller is a capability and not information — see the
 * second banner at the top of this file, including what that refusal does and does
 * not achieve. Plugin code wanting to know whether it is in the foreground calls
 * `useExtensionActivation`.
 *
 * @throws when called inside an `ExtensionHostBoundary`, or outside
 *   `ShellHostProvider`.
 */
export function useActivation(): ActivationController {
  const scope = useContext(ExtensionScopeContext);
  const controller = useContext(ActivationControllerContext);
  if (scope !== null) {
    // `scope` is NOT interpolated. It is host-supplied in every intended use, but
    // this is the one place a plugin could steer the value, and a message-building
    // `toString` is not worth the convenience of naming the extension here.
    throw new Error(
      'useActivation is host-only: it is not reachable from inside an <ExtensionHostBoundary>. Use useExtensionActivation() for the read-only view.',
    );
  }
  if (controller === null) {
    throw new Error('useActivation must be called inside a <ShellHostProvider>.');
  }
  return controller;
}

/**
 * What activation looks like from inside a plugin's own subtree.
 *
 * Re-renders when the foreground changes, because it reads the foreground from the
 * shell context rather than from the host's ref — the same published fact every
 * other subscriber sees, so a plugin cannot be told one thing while a pane beside
 * it is told another.
 *
 * The returned object is frozen and its identity is stable until one of the two
 * ids moves, so it is safe in a dependency array.
 *
 * @throws when called outside an `ExtensionHostBoundary` — including from host
 *   code, which has the controller and does not need this.
 */
export function useExtensionActivation(): ExtensionActivationView {
  const extensionId = useContext(ExtensionScopeContext);
  // Called before the scope check, unconditionally, so the hook order is fixed
  // whatever the answer. Outside a `ShellHostProvider` this is what throws first,
  // and that is the more fundamental mistake of the two.
  const { activeExtensionId } = useShellContext();
  const view = useMemo<ExtensionActivationView | null>(
    () =>
      extensionId === null
        ? null
        : Object.freeze({
            extensionId,
            foregroundExtensionId: activeExtensionId,
            isForeground: activeExtensionId === extensionId,
          }),
    [extensionId, activeExtensionId],
  );
  if (view === null) {
    throw new Error(
      'useExtensionActivation must be called inside an <ExtensionHostBoundary>, which the host renders around an extension subtree.',
    );
  }
  return view;
}
