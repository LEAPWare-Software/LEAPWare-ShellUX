import type { ContextKeyValue, NavigationNode, RibbonContext, ShellUXErrorCode } from '../types';
import type { ShellStateStore } from '../ShellAPI';

/**
 * ============================================================================
 * THE WIRE FORMAT — WHAT CROSSES, WHAT DOES NOT, AND WHO IS TRUSTED
 * ============================================================================
 * Two unions and one applier. Everything `src/core/ipc/**` puts on a `PortLike`
 * is declared here, so "what can arrive?" has one answer and a reader of
 * `AuthoritativeStore` does not have to reconstruct the set from its handlers.
 *
 * **Direction is in the type, because trust is asymmetric.** A `ReplicaMessage`
 * travels renderer → main and is UNTRUSTED: a renderer process is where plug-in
 * code runs, its port is reachable from that code, and a compromised or merely
 * buggy renderer can post anything at all. Main therefore re-validates every
 * operation through the same `ShellStateStore` validators the replica already
 * ran — see `AuthoritativeStore` — rather than trusting that it did. A
 * `HostMessage` travels main → renderer and IS trusted, in the narrow sense that
 * it originates in the process that owns the truth; a replica still refuses one
 * whose `protocol` is not its own, because a renderer surviving an update is a
 * stale bundle rather than an attack.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT IN THIS FILE, AND WHY EACH WAS DROPPED
 * ---------------------------------------------------------------------------
 * §5 of the native-host plan sketches the shapes; this is the set the code
 * actually needs, and three candidates did not survive contact with it:
 *
 *  - **No `hello` / `sync-request`.** A replica needs the authoritative state
 *    before it can render, but it never has to ask for it: `connect` posts the
 *    opening `resync` as its first act, so the host decides the ordering — which
 *    it must anyway, since it is the host that creates both the view and the
 *    port. A request message would exist only to be answered by the message that
 *    is already sent unprompted.
 *  - **No `revoke`.** Correction 2 in §5 says `REVOKED` becomes an advisory
 *    cached check whose window is closed at the PANE level: main tears the view
 *    down on `unregister`, so the realm dies rather than lingering. A message
 *    saying "you are revoked" would have to be read by something, and the thing
 *    that would read it is the pane that is being destroyed. Killing the view is
 *    the mechanism; a message would be a second mechanism with weaker timing.
 *  - **No per-message acknowledgement.** A write is acknowledged by the `commit`
 *    it causes, which the originator needs anyway for echo suppression. A
 *    separate ack would double the traffic of the exact path §9 R4 says floods.
 *
 * And one that was ADDED, because the code needed it: **`refused`**. Main
 * re-validating a renderer's write is the whole of "a renderer is not trusted",
 * and a re-validation whose rejection nobody can observe is not a check, it is a
 * silent drop. `refused` carries the `ShellUXErrorCode` main decided on back to
 * the originator, and `OriginViolation` reports the same event on main's side.
 * ============================================================================
 */

/**
 * The version every message carries and every door checks.
 *
 * A single integer, bumped whenever a shape below changes in a way an older peer
 * would misread. There is exactly one version in existence, so there is no
 * migration path and there deliberately is not one — the same reasoning
 * `HydrationEngine`'s `SCHEMA_VERSION` records: a migration from a version that
 * never shipped is untestable fiction, and dead code the coverage gate would
 * then have to be lied to about. A message of another version is refused at
 * whichever door received it.
 *
 * The asymmetry with `HydrationEngine` is that BOTH ends check. A persisted
 * record has one reader; a port has two, and after an auto-update (§6) a running
 * renderer can be a build older than the main process that just replaced itself.
 */
export const PROTOCOL_VERSION = 1;

/**
 * A write against the shell store, as it crosses the boundary.
 *
 * **One member per `ShellStateStore` write door, with `patchContext` covering
 * four of them.** `setSelectedItem`, `setSelectedItems` and `setActiveNavNode`
 * all funnel into `applyPatch` inside the store and change nothing but context
 * fields, so a replica replicates their EFFECT as a `patch-context` rather than
 * replicating the call. That is not a shortcut: it is what makes the patch on
 * the wire HOST-OWNED. The argument a plug-in hands `patchContext` is an
 * arbitrary object that may re-read differently every time it is touched, so
 * posting the caller's object would let one process apply one value and the
 * other apply another. The replica posts the fields that actually MOVED, read
 * back out of its own store after the write, and those are frozen host-built
 * values that cannot change their mind. See `ReplicaStore`.
 *
 * The ones that are not context fields keep their own shape, because their
 * state is not in the snapshot and cannot be derived from it: a badge (set or
 * cleared), a nav metric, one extension's context-key namespace, and one
 * extension's replacement navigation tree. `clear-context-keys` is the
 * bookkeeping half of a foreground handover and carries nothing; `purge-scope`
 * is the bookkeeping half of an unregister and carries the scope (ADR-0006
 * decision 8).
 *
 * **Every field of every member is a primitive, an array of primitives, or a
 * record of primitives — with one member nested deeper.** `set-navigation-tree`
 * carries a tree: records of primitives, arrays of those, and a metric record,
 * as `normalizeNavigationTree` builds it — still data only, with no function a
 * normaliser could have copied, because the normaliser copies none. That is `ContextKeyValue`'s primitives-only rule doing
 * the work §3.5 of the plan credits it with: the union written for
 * render-phase-getter reasons is what makes this transport free. Nothing here
 * needs a serializer, and nothing here can carry a getter across.
 */
export type StoreOperation =
  | {
      readonly kind: 'patch-context';
      /** Only the fields that moved, host-owned, read back after the local write. */
      readonly patch: Partial<RibbonContext>;
    }
  | {
      readonly kind: 'set-badge-count';
      readonly extensionId: string;
      readonly nodeId: string;
      readonly count: number;
    }
  | {
      readonly kind: 'set-nav-metric';
      readonly extensionId: string;
      readonly nodeId: string;
      /** Already CLAMPED by the replica's own store, so both ends store the same number. */
      readonly value: number;
    }
  | {
      readonly kind: 'set-context-key';
      readonly extensionId: string;
      readonly key: string;
      readonly value: ContextKeyValue;
    }
  | { readonly kind: 'clear-context-keys' }
  | {
      readonly kind: 'clear-badge';
      readonly extensionId: string;
      readonly nodeId: string;
    }
  | {
      readonly kind: 'set-navigation-tree';
      readonly extensionId: string;
      /**
       * The replica's own host-normalised copy, read back after the local write,
       * never the caller's array. Main re-normalises it through the same
       * validator on arrival, so a renderer that bypassed its replica gains
       * nothing by sending a tree of its own.
       */
      readonly nodes: readonly NavigationNode[];
    }
  | { readonly kind: 'purge-scope'; readonly extensionId: string };

/** The discriminant of `StoreOperation`. */
export type StoreOperationKind = StoreOperation['kind'];

/** One member of the union, selected by its discriminant. */
type OperationOfKind<K extends StoreOperationKind> = Extract<StoreOperation, { kind: K }>;

/**
 * How each operation is applied to a store.
 *
 * **A table rather than a `switch`, and the reason is the coverage gate.** An
 * exhaustive `switch` over a closed union wants a `default:` clause the compiler
 * can prove unreachable, and vitest 4 counts that clause as a branch nothing can
 * reach — so it would have to be either deleted (leaving a `switch` a reader
 * cannot tell is exhaustive) or covered by a test that lies about being able to
 * construct the impossible. A `Record` keyed on the union has neither problem:
 * the compiler rejects a missing member and an invented one, exactly as
 * `SHELL_UX_ERROR_CODE_MEMBERS` in `types.ts` does, and there is no fallback arm
 * to justify.
 *
 * It doubles as the runtime allowlist. `KNOWN_OPERATION_KINDS` below is its key
 * set, which is what main uses to refuse a `kind` a renderer invented — so the
 * check and the dispatch cannot drift apart, because they are one object.
 */
const OPERATION_APPLIERS: {
  readonly [K in StoreOperationKind]: (store: ShellStateStore, op: OperationOfKind<K>) => void;
} = Object.freeze({
  'patch-context': (store, op): void => {
    store.patchContext(op.patch);
  },
  'set-badge-count': (store, op): void => {
    store.setBadgeCount(op.extensionId, op.nodeId, op.count);
  },
  'set-nav-metric': (store, op): void => {
    store.setNavMetric(op.extensionId, op.nodeId, op.value);
  },
  'set-context-key': (store, op): void => {
    store.setContextKey(op.extensionId, op.key, op.value);
  },
  'clear-context-keys': (store): void => {
    store.clearContextKeys();
  },
  'clear-badge': (store, op): void => {
    store.clearBadge(op.extensionId, op.nodeId);
  },
  'set-navigation-tree': (store, op): void => {
    store.setNavigationTree(op.extensionId, op.nodes);
  },
  'purge-scope': (store, op): void => {
    store.purgeScope(op.extensionId);
  },
});

/**
 * The operation kinds this protocol version defines, as a runtime membership
 * test over an untrusted `kind`.
 *
 * Derived from `OPERATION_APPLIERS` rather than transcribed beside it, for the
 * reason `HANDLER_ONLY_MODULES` in `src/__tests__/noEventListener.test.ts` is
 * derived: an allowlist maintained by hand next to the thing it describes is one
 * edit away from being stale, and a stale allowlist here would either refuse an
 * operation the code can apply or admit one it cannot.
 */
export const KNOWN_OPERATION_KINDS: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(OPERATION_APPLIERS)),
);

/**
 * Apply one operation to one store.
 *
 * **The single applier, used by BOTH ends, and that is the point of it.** Main
 * applies a renderer's operation through this function and a replica applies
 * main's commit through the same one, so the two processes cannot disagree about
 * what an operation MEANS — only about when they saw it. Anything that validates
 * here validates identically there, because it is the store's own validator
 * either way.
 *
 * It does not catch. A `ShellUXError` raised by the store is the outcome the
 * caller has to decide about: on the replica it is the plug-in's own synchronous
 * rejection and must reach the calling frame unchanged, and on main it is a
 * renderer that posted something its own replica would have refused. Those are
 * different events and a `try` here would flatten them into one.
 *
 * @throws {ShellUXError} whatever the addressed store member throws — the same
 *   codes, the same messages, the same fields.
 */
export function applyOperation(store: ShellStateStore, operation: StoreOperation): void {
  // One cast, at the one place the union is opened. `OPERATION_APPLIERS` is
  // keyed by the discriminant, so the handler selected is the one declared for
  // this member; the compiler cannot see that through an index it did not
  // narrow, and a per-member `switch` to convince it would reintroduce exactly
  // the unreachable `default:` this table exists to avoid.
  const apply = OPERATION_APPLIERS[operation.kind] as (
    target: ShellStateStore,
    op: StoreOperation,
  ) => void;
  apply(store, operation);
}

/**
 * Renderer → main. **Untrusted.**
 *
 * One member. A replica has exactly one thing to say — "I applied this, and I
 * did it as origin O, write number N" — and every other candidate message was
 * either answered by `connect` or replaced by the commit itself. See the banner.
 */
export interface WriteMessage {
  readonly type: 'write';
  readonly protocol: number;
  /**
   * Which replica posted this.
   *
   * **Main does not take the origin's word for it.** The origin arriving in a
   * message is used only to fill the `commit` the originator matches its own
   * echo against; the origin main RATE-LIMITS and SEVERS is the one it bound to
   * the port in `connect`, which a renderer cannot spell at all. A renderer that
   * lies here can therefore make another pane fail to suppress an echo — a
   * visible glitch in its own frame — and cannot borrow another pane's budget.
   */
  readonly origin: string;
  /** Monotonic per replica. Echoed in the commit; see `ReplicaStore`. */
  readonly seq: number;
  readonly op: StoreOperation;
}

/** The renderer → main union. One member today; see the banner for the dropped ones. */
export type ReplicaMessage = WriteMessage;

/**
 * Main → renderer, after an accepted write, to EVERY connected replica
 * including the originator.
 *
 * **It carries both the operation and the resulting authoritative context, and
 * neither is redundant.** The operation is how a badge, a nav metric or one
 * extension's context-key namespace crosses at all — none of the three is in the
 * context snapshot, so a replica that were sent only the context would silently
 * stop replicating them. The context is how a replica CONVERGES: main decides
 * the order in which concurrent writes land, and a replica that only replayed
 * operations would reach main's state only if it had seen every operation in
 * main's order, which the originator deliberately has not (it applied its own
 * write early, which is what "optimistic" means).
 */
export interface CommitMessage {
  readonly type: 'commit';
  readonly protocol: number;
  /** The replica whose write this commits. `MAIN_ORIGIN` for main's own writes. */
  readonly origin: string;
  /** The originator's own sequence number, echoed. */
  readonly seq: number;
  readonly op: StoreOperation;
  /** Main's whole context after applying. What every replica converges on. */
  readonly context: RibbonContext;
}

/**
 * Main → renderer, once per connection, before anything else.
 *
 * The opening snapshot. It is not a reply to a request — see the banner — and it
 * is deliberately the same shape a replica already knows how to apply, so a
 * replica has one convergence path rather than two.
 */
export interface ResyncMessage {
  readonly type: 'resync';
  readonly protocol: number;
  readonly context: RibbonContext;
}

/**
 * Main → the originating renderer, when main's re-validation refused its write.
 *
 * **Reaching this means the renderer bypassed its own replica.** A `ReplicaStore`
 * runs the identical validator before it posts, so an operation that main refuses
 * is one that was never applied locally either — which is why there is nothing to
 * roll back and no state attached to this message. What it carries is the reason,
 * so that the renderer end is not left with a write that vanished for no stated
 * cause, and `OriginViolation` carries the same event to main's own host code.
 */
export interface RefusedMessage {
  readonly type: 'refused';
  readonly protocol: number;
  readonly origin: string;
  readonly seq: number;
  readonly code: ShellUXErrorCode;
  readonly message: string;
}

/**
 * Main → a renderer whose write rate tripped the per-origin limit.
 *
 * **This is §9 R4's half of the answer that the renderer can see.** Main has
 * already stopped applying that origin's writes by the time this is posted; the
 * message exists so the replica can stop POSTING them, which is what keeps a
 * wedged pane from spending the host's message budget for the seconds before the
 * host tears it down. A replica that receives it is severed permanently: there is
 * no resumption message, because the mitigation §5 names is a pane reload, and a
 * reloaded pane is a new port and a new origin.
 */
export interface ThrottledMessage {
  readonly type: 'throttled';
  readonly protocol: number;
  readonly origin: string;
  /** Writes permitted per window. */
  readonly limit: number;
  /** The window, in milliseconds. */
  readonly windowMs: number;
}

/** The main → renderer union. */
export type HostMessage = CommitMessage | ResyncMessage | RefusedMessage | ThrottledMessage;

/**
 * The origin main writes under.
 *
 * Host chrome's own writes are commits like any other, so they need an origin to
 * be labelled with; no replica claims this one, so no replica ever suppresses a
 * commit that came from main. It is spelled like `HOST_BADGE_SCOPE` in
 * `ShellAPI.ts` and for the same reason: `EXTENSION_ID_PATTERN` admits neither
 * `_` nor `:`, so this string cannot be produced by any registry-valid id.
 */
export const MAIN_ORIGIN = '__main__';

/**
 * What main reports to its own host code when a renderer misbehaves.
 *
 * **Reported rather than thrown.** These arrive inside a port callback, which is
 * a frame with nowhere to raise to — the same shape `IShellAPI.subscribePayload`
 * describes for a disposer running during unmount. A host that wants to reload a
 * pane, log, or count does it here.
 */
export type OriginViolation =
  | {
      readonly kind: 'malformed';
      /** The origin main bound to the port, never one the message claimed. */
      readonly origin: string;
      readonly message: string;
    }
  | {
      readonly kind: 'refused';
      readonly origin: string;
      readonly seq: number;
      readonly code: ShellUXErrorCode;
      readonly message: string;
    }
  | {
      readonly kind: 'throttled';
      readonly origin: string;
      readonly limit: number;
      readonly windowMs: number;
    };
