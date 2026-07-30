import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useRegistry, useRegistryRevision } from './RegistryContext';
import {
  ShellStoreContext,
  createRevocableShellAPI,
  createShellStateStore,
  useShellContext,
} from './ShellAPI';
import type { ShellStateStore } from './ShellAPI';
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
   * host that treats listeners as untrusted should guard the call; the honest
   * statement is that this method invents no failure of its own.
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
   * @returns `true` when an extension was live under `id`, `false` when there
   *   was nothing to release.
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
}

/**
 * Owns the one shell state store and the activation lifecycle for its subtree.
 *
 * Must be rendered inside an `ExtensionRegistryProvider`: activation resolves a
 * blueprint through the registry, and it watches the registry's revision so that
 * unregistering an extension revokes its handle.
 */
export function ShellHostProvider({ children }: ShellHostProviderProps): ReactElement {
  const registry = useRegistry();
  const revision = useRegistryRevision();

  // One store, created once, for the provider's whole lifetime. Guarded rather
  // than passed straight to `useRef`, which would build and discard a store on
  // every render.
  const storeRef = useRef<ShellStateStore | null>(null);
  storeRef.current ??= createShellStateStore();
  const store: ShellStateStore = storeRef.current;

  // A Map, deliberately, for the same reason the registry uses one: the keys are
  // extension ids that originate in plugin manifests.
  const live = useRef<Map<string, LiveEntry>>(new Map());
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

  const publishForeground = useCallback(
    (next: ActiveExtension | null): void => {
      foreground.current = next;
      store.patchContext({ activeExtensionId: next === null ? null : next.id });
    },
    [store],
  );

  /**
   * Re-derive the foreground from liveness. The foreground must always be a live
   * extension, so an extension that has just lost its liveness loses the
   * foreground with it; one that still has it keeps it, and re-publishing the
   * same id is a no-op because `patchContext` compares per field.
   *
   * The test is on the ENTRY's identity, not on the id being a key in the map, for
   * the same reason liveness is keyed on the blueprint record: after an
   * unregister/re-register cycle the id can be present while belonging to a
   * different extension, and "my id is in the map" would then keep a foreground the
   * host has already replaced.
   */
  const reconcileForeground = useCallback((): void => {
    const current = foreground.current;
    const held = current === null ? undefined : live.current.get(current.id);
    publishForeground(held !== undefined && held.active === current ? current : null);
  }, [publishForeground]);

  const activate = useCallback(
    (id: string): ActivationResult => {
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

      let entry = live.current.get(requested);
      if (entry !== undefined && entry.active.blueprint !== blueprint) {
        // The registry holds a DIFFERENT record under this id than the one this
        // entry was minted against: the extension was unregistered and something
        // else registered under its id. Same key, different extension.
        //
        // Reached when no commit has separated the re-registration from this call
        // — both inside one event handler, say — so the sweep effect below has not
        // run yet. Without this the cached entry was returned and the host would
        // render the OLD version's view components after a successful upgrade.
        entry.revoke();
        live.current.delete(requested);
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
        const revocable = createRevocableShellAPI(store, requested, () =>
          isLive(requested, blueprint),
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
        live.current.set(requested, entry);
      }
      // Re-activation reuses the entry, so an extension that is brought back to
      // the foreground gets the SAME handle it had before. A new one would
      // silently invalidate every reference the extension is holding.
      publishForeground(entry.active);
      return { ok: true, active: entry.active };
    },
    [isLive, publishForeground, registry, store],
  );

  const blur = useCallback((): void => {
    // Foreground only. Liveness is untouched, on purpose.
    publishForeground(null);
  }, [publishForeground]);

  const release = useCallback(
    (id: string): boolean => {
      const entry = live.current.get(id);
      if (entry === undefined) {
        return false;
      }
      entry.revoke();
      live.current.delete(id);
      reconcileForeground();
      return true;
    },
    [reconcileForeground],
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
    for (const [id, entry] of live.current) {
      // `isLive` itself, so the sweep's question and the facade's question cannot
      // drift apart. They used to differ because `isLive` also consulted a
      // `mounted` flag this body had to avoid; that flag is gone.
      if (isLive(id, entry.active.blueprint)) {
        continue;
      }
      entry.revoke();
      live.current.delete(id);
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
    try {
      reconcileForeground();
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
  }, [isLive, reconcileForeground, revision]);

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
