import type { ContextKeyValue, RibbonContext } from '../types';
import type { ShellStateStore } from '../ShellAPI';
import { createShellStateStore } from '../ShellAPI';
import type { PortLike } from './PortLike';
import type { CommitMessage, HostMessage, RefusedMessage, ResyncMessage } from './protocol';
import { PROTOCOL_VERSION, applyOperation } from './protocol';
import type { StoreOperation } from './protocol';

/**
 * ============================================================================
 * A READ REPLICA THAT IS STILL A `ShellStateStore`
 * ============================================================================
 * This implements `ShellStateStore` — every member, the same signatures, the
 * same synchronous rejections — backed by a local replica of main's truth and an
 * outbound port. **That is the whole reason `IShellAPI.getContext()` keeps its
 * exact signature and `useSyncExternalStore` keeps working across a process
 * split.** A promise-returning `getContext` would have changed the extension
 * contract, every pane component, and the one hook React gives us for tearing;
 * a synchronously-readable replica changes none of them.
 *
 * ---------------------------------------------------------------------------
 * OPTIMISTIC-LOCAL, AUTHORITATIVE-ASYNC — THE ORDER OF EVENTS
 * ---------------------------------------------------------------------------
 * A write through any of the eight write doors does four things, in this order:
 *
 *  1. **Validates**, through the EXISTING, UNCHANGED validators — because the
 *     replica's local state IS a `createShellStateStore()`. `INVALID_FIELD`,
 *     `INVALID_ID` and `PAYLOAD_TOO_LARGE` are therefore raised synchronously,
 *     in the caller's own frame, with the identical code, message and field they
 *     have always had. Nothing about a bad argument became asynchronous.
 *  2. **Applies** locally.
 *  3. **Notifies** locally, synchronously, before the writing statement returns.
 *  4. **Posts** the resulting host-owned change to main.
 *
 * A rejection at step 1 stops all of it: nothing is applied, nothing is
 * notified, and — the part that only exists because of the boundary — NOTHING IS
 * POSTED. A refused write does not become traffic.
 *
 * ---------------------------------------------------------------------------
 * CORRECTION 1 — `subscribe`'s SYNCHRONOUS GUARANTEE IS NOW SCOPED
 * ---------------------------------------------------------------------------
 * `ShellStateStore.subscribe` says a listener "runs after the commit and BEFORE
 * the writing statement returns, so it reads every value any other holder
 * writes". **That is true WITHIN a renderer and false ACROSS renderers**, and
 * the difference is step 4 above: host chrome's listener runs inside host
 * chrome's write, and the extension surface hears about it one message later.
 * The claim is not weakened everywhere — a subscriber in the writing realm still
 * observes the write before the writer returns — it is SCOPED to the realm the
 * write happened in.
 *
 * **This paragraph used to say "pane 2's listener … and pane 3 hears about it
 * one message later", and Phase 7 made that false rather than merely dated.**
 * The topology that was built is the two-process one: panes 2 and 3 are ONE
 * document in ONE renderer (`electron/main/surfaces.ts`,
 * `src/paneview/PaneViewShell.tsx`), so a pane-2 write reaches a pane-3 listener
 * **synchronously**, through the same store, exactly as it did before any of
 * this existed. The pair that is genuinely a message apart is **host chrome and
 * the extension surface**. Naming the wrong pair would have been worse than
 * saying nothing: it would have told a reader that the pane pair with the
 * strongest relationship in the product — a list and its detail — had become
 * asynchronous, which is precisely the cost the two-process topology was chosen
 * to avoid paying.
 *
 * The security consequence runs the favourable way, and it is worth stating
 * because the original docblock treats the synchronous listener as a hazard: a
 * listener can no longer throw into ANOTHER REALM'S writer frame, because there
 * is no shared frame to throw into. A realm's own listeners can still throw into
 * its own writers — and under the two-process topology "its own" includes both
 * extension panes, which is the same exposure the single-process shell had and
 * not a new one. *Tests:*
 * `src/core/ipc/__tests__/replicaStore.test.ts` — "a listener runs before the
 * writing statement returns, within the writing renderer" and "a listener in
 * another renderer does not run before the writing statement returns, and cannot
 * throw into it".
 *
 * ---------------------------------------------------------------------------
 * CORRECTION 3 — TEARING, AND THE SKEW THAT IS NOT TEARING
 * ---------------------------------------------------------------------------
 * `useShellContext`'s docblock says `useSyncExternalStore` gives every subscriber
 * one snapshot object, so two panes cannot show two different values of the same
 * field for the same commit. **That remains exactly true and its scope is one
 * renderer.** It cannot prevent SKEW between renderers: the writing realm applies
 * its own write at step 2 and the other realm sees it after a message, so for one
 * frame the two hold different snapshots. That is not tearing — neither realm is
 * internally inconsistent — and it is not fixed here. §5 says to state it and not
 * fix it, and the reason is that the fix is a synchronous cross-process read,
 * which is the thing this whole design exists to avoid. *Tests:* "two replicas
 * hold different snapshots between a write and its commit, and converge on it".
 *
 * **The re-scoping is the same one correction 1 needed, and for the same
 * reason.** This paragraph used to name panes 2 and 3 as the skewing pair. Under
 * the topology Phase 7 built they are one document and cannot skew from each
 * other at all; the pair that can is host chrome and the extension surface —
 * pane 1's nav tree, the context bar and the palette on one side, the list and
 * the detail on the other. That is a narrower exposure than the original text
 * claimed, and it is narrower in the place it matters most: the surfaces a user
 * watches change together are the ones that still change together.
 *
 * ---------------------------------------------------------------------------
 * CORRECTION 2 — `REVOKED` BECOMES AN ADVISORY CACHED CHECK
 * ---------------------------------------------------------------------------
 * Nothing in this module implements revocation, and that is the correction
 * rather than an omission. `createRevocableShellAPI` keeps its `revoked` latch
 * and its `isLive` predicate unchanged, so the ordinary case — a plug-in calling
 * through a handle its own pane already knows is dead — still throws `REVOKED`
 * synchronously, out of a flag that lives in the same realm as the caller. What
 * changes is that the flag is a CACHED, PANE-LOCAL answer to a question main
 * owns: main unregisters an extension, and until the pane hears about it the
 * pane's copy of `isLive` says the handle is live.
 *
 * **The window is closed at the VIEW level instead, and that is stronger than a
 * message would be.** Main tears down the extension `WebContentsView` on
 * `unregister`, so the entire realm — the handle, the closure it captured, the
 * timer that was about to call through it — stops existing. A `revoke` message
 * would leave the realm alive and racing; killing the view does not race. That is
 * why there is no `revoke` member in the protocol; see the banner in
 * `./protocol`.
 *
 * **This correction survived Phase 7 with one word changed, and the word matters
 * more than it looks.** It said "the `WebContentsView`", singular, at a time when
 * the plan drafted three of them; the topology that was built has ONE extension
 * view holding both panes, so tearing it down ends both panes' realm at once.
 * That makes the correction stronger rather than weaker — there is no second
 * extension realm left holding a stale handle — and it is the same fact that
 * makes the crash containment claim narrower: a pane-3 crash takes pane 2 with
 * it, which docs/adr/0005-pane-topology.md's consequences state outright.
 * ============================================================================
 */

/** What the host must supply to create a replica. */
export interface ReplicaStoreOptions {
  /** This renderer's end of the channel to main. */
  readonly port: PortLike;
  /**
   * What main knows this renderer as.
   *
   * It is echoed on every write and matched against every commit, which is how
   * the replica recognises its own echo. Main polices the origin it BOUND to the
   * port rather than this one — see `WriteMessage.origin` — so a replica that
   * spelled it wrong would fail to suppress its own echoes and would spend its
   * own budget doing it.
   */
  readonly origin: string;
}

/**
 * Exhaustiveness pin for the context fields a replica replicates.
 *
 * `Record<keyof RibbonContext, true>` makes the compiler reject both a field this
 * module forgot and one it invented, exactly as `CONTEXT_FIELDS` in `ShellAPI.ts`
 * does for the validation table. A field added to `RibbonContext` cannot become
 * invisible to the transport by nobody noticing: it has to be added here, which
 * is a line in a diff.
 */
const REPLICATED_FIELD_MEMBERS: Readonly<Record<keyof RibbonContext, true>> = Object.freeze({
  activeExtensionId: true,
  activeNavNodeId: true,
  selectedItemId: true,
  selectedItemIds: true,
  contextKeys: true,
});

/** The context fields, as the list `changedFields` walks. */
const REPLICATED_FIELDS = Object.keys(REPLICATED_FIELD_MEMBERS) as readonly (keyof RibbonContext)[];

/**
 * The fields that MOVED between two snapshots, as a host-owned patch.
 *
 * ==========================================================================
 * **THIS IS WHY A CALLER'S PATCH NEVER REACHES THE WIRE, AND IT IS NOT AN
 * OPTIMISATION.** `patchContext` takes an arbitrary object from a caller that
 * may be plain JavaScript, and `ShellAPI.ts` goes to considerable trouble over
 * the fact that reading such an object is a call into plug-in code: a `get`
 * trap or an own getter may return one value while it is being validated and
 * another afterwards. Posting the caller's object would hand main a SECOND
 * read of it — so the replica could apply `selectedItemId: "a"` locally while
 * main applied `"b"`, and the two processes would disagree permanently with
 * every validator having passed.
 *
 * The values here are read back out of the replica's own store AFTER the write
 * landed. They are the host-built, frozen, already-validated values the store
 * decided to keep: a frozen `selectedItemIds` array built element by element
 * from a single read, and a null-prototype `contextKeys` record built key by
 * key. None of them can re-read differently, because none of them is the
 * caller's.
 * ==========================================================================
 *
 * Identity comparison is exact here and not an approximation: `applyPatch`
 * allocates a new value for a field ONLY when that field really changed —
 * `sameSelection` and `sameContextKeys` are element-wise for precisely that
 * reason — so `Object.is` on the field is the store's own answer to "did this
 * move?", not a re-derivation of it.
 */
function changedFields(
  before: Readonly<RibbonContext>,
  after: Readonly<RibbonContext>,
): Partial<RibbonContext> {
  const patch: Record<string, unknown> = {};
  for (const field of REPLICATED_FIELDS) {
    if (!Object.is(before[field], after[field])) {
      patch[field] = after[field];
    }
  }
  return patch as Partial<RibbonContext>;
}

/**
 * Create a replica store for one renderer.
 *
 * The local state is a plain `createShellStateStore()`. Everything a
 * single-process shell relies on — the identity bail-out that keeps an unchanged
 * write from waking every subscriber, `MAX_NOTIFY_DEPTH`, the all-or-nothing
 * patch, the derivation of `selectedItemId` from `selectedItemIds`, every error
 * code and every message — is therefore inherited rather than reimplemented. A
 * second implementation of those rules is the drift `src/core/command.ts` exists
 * to prevent, one layer down.
 */
export function createReplicaStore(options: ReplicaStoreOptions): ShellStateStore {
  const { port, origin } = options;
  const local = createShellStateStore();
  /** Writes this replica has posted and not yet seen committed. */
  const pending = new Set<number>();
  let nextSeq = 0;
  /**
   * Whether main has cut this origin off.
   *
   * One-way: there is no message that clears it, because the mitigation §5 names
   * is a pane reload and a reloaded pane is a new replica. Local writes go on
   * working — refusing them would break the pane in a second way — they simply
   * stop being posted, which is what stops a wedged pane spending the host's
   * message budget while the host arranges to replace it.
   */
  let severed = false;

  function post(operation: StoreOperation): void {
    if (severed) {
      return;
    }
    nextSeq += 1;
    pending.add(nextSeq);
    port.postMessage({
      type: 'write',
      protocol: PROTOCOL_VERSION,
      origin,
      seq: nextSeq,
      op: operation,
    });
  }

  /**
   * Run one context write against the local store and replicate what moved.
   *
   * `apply` throws through this function unchanged — that is step 1 of the four,
   * and it is what keeps a plug-in's bad argument a synchronous rejection in the
   * plug-in's own frame.
   *
   * **A write that changed nothing posts nothing.** `applyPatch` returns the
   * identical snapshot object when no field moved, so the identity test below is
   * the store's own bail-out read back rather than a second opinion about it —
   * and the property it buys is worth naming: re-selecting the row that is
   * already selected is silent in one process today, and stays silent across
   * two. A design that posted unconditionally would have turned every no-op write
   * in the shell into a message, which is the traffic §9 R4 is about.
   */
  function writeContext(apply: () => void): void {
    const before = local.getContext();
    apply();
    const after = local.getContext();
    if (after === before) {
      return;
    }
    post({ kind: 'patch-context', patch: changedFields(before, after) });
  }

  /**
   * Apply main's commit.
   *
   * ==========================================================================
   * **ECHO SUPPRESSION, AND THE BUG IT PREVENTS.** Main broadcasts every commit
   * to every replica INCLUDING the originator, because the originator needs to
   * know its write landed and needs main's ordering. But the originator already
   * applied that write optimistically, and it may have applied LATER writes
   * since. Re-applying the commit would then roll the pane back to a value the
   * user has already moved on from: select row A, select row B, and the commit
   * for A arrives and puts A back. The pane flickers to a stale selection on
   * every write it makes. *Tests:*
   * `src/core/ipc/__tests__/replicaStore.test.ts` — "suppresses its own echo, so
   * a commit for an earlier write does not clobber a later one" and "does not
   * notify twice for a badge it wrote itself".
   *
   * **The suppression is bounded by the pending set, not by the origin alone,
   * and that bound is what makes the replica converge.** While this replica is
   * still ahead of main — some write of its own has not come back — its
   * optimistic state is the better answer and the commit is dropped. The moment
   * it is level, the authoritative context is applied even though this replica
   * originated the write, which is how a replica whose write main ordered
   * BEHIND another renderer's ends up holding main's answer rather than its own.
   * Without that, the last writer in a race would keep a value main does not
   * have, permanently, and nothing would ever correct it.
   * ==========================================================================
   *
   * **The null prototype is re-created here, and by the store rather than by a
   * step somebody has to remember.** `Object.create(null)` does not survive
   * structured clone: `contextKeys` leaves main with no prototype and arrives
   * with `Object.prototype`, which would silently degrade the guarantee
   * `RibbonContext.contextKeys` makes. It is re-created because the commit is
   * applied through `patchContext`, whose `normalizeContextKeys` builds a fresh
   * `Object.create(null)` record key by key on every accepted patch. Installing
   * the decoded record directly — which is the obvious "it is already
   * validated, main built it" optimisation — is exactly the defect. *Tests:*
   * `src/core/ipc/__tests__/replicaStore.test.ts` — "re-creates the null
   * prototype a structured clone strips off the context keys".
   *
   * **What this does NOT cover, stated rather than left to be discovered:**
   * `StructuredPayload.data` is a deep copy into null-prototype records at
   * arbitrary depth, and nothing re-normalises it on receipt because a
   * subscriber is handed the host's own copy. The payload channel does not cross
   * this protocol yet; when it does, it needs an explicit revive on decode, and
   * it will not inherit one from anywhere.
   */
  function onCommit(commit: CommitMessage): void {
    if (commit.origin === origin) {
      pending.delete(commit.seq);
      if (pending.size > 0) {
        return;
      }
      local.patchContext(commit.context);
      return;
    }
    // Another renderer's write. The operation carries what the context cannot —
    // a badge, a nav metric, one extension's key namespace — and the context
    // carries main's exact answer for everything that IS in the snapshot. Both,
    // in that order: the second is usually a no-op the store bails out of, and
    // when it is not, it is main correcting an ordering this replica could not
    // have known.
    applyOperation(local, commit.op);
    local.patchContext(commit.context);
  }

  /**
   * Retire a write main refused.
   *
   * **Small, and load-bearing.** A pending entry that is never retired leaves
   * `pending.size` permanently above zero, which makes `onCommit` suppress every
   * future commit — the replica would go quietly and permanently blind. Reaching
   * a refusal at all means either the renderer bypassed its own replica (in which
   * case there is no pending entry and this deletes nothing) or main's own
   * listener threw while committing this write (in which case there is one, and
   * this is the only thing that clears it).
   *
   * Nothing is rolled back, and that is correct rather than lazy: the replica ran
   * the identical validator before it posted, so an operation main refuses on its
   * merits was never applied here either.
   */
  function onRefused(refused: RefusedMessage): void {
    pending.delete(refused.seq);
  }

  /** Install main's opening snapshot. The same convergence path a commit uses. */
  function onResync(resync: ResyncMessage): void {
    local.patchContext(resync.context);
  }

  /**
   * The handlers, keyed by message type.
   *
   * **A `Map`, not an object literal, and the reason is the same one
   * `ShellAPI.ts` gives for `badgeCounts`.** The key comes off a message, and an
   * object literal has a prototype: a message declaring `type: "toString"` would
   * index a real function off `Object.prototype` and this module would call it
   * with the message. A `Map` has nothing to walk into.
   */
  const handlers = new Map<HostMessage['type'], (message: never) => void>([
    ['commit', onCommit as (message: never) => void],
    ['resync', onResync as (message: never) => void],
    ['refused', onRefused as (message: never) => void],
    [
      'throttled',
      ((): void => {
        severed = true;
      }) as (message: never) => void,
    ],
  ]);

  /**
   * Read one inbound message from main and route it.
   *
   * Main is the host and its messages are not re-validated field by field the way
   * a renderer's are at the other end — the asymmetry is the design, see
   * `./protocol`. Three things are still checked, because none of them implies
   * distrust of main:
   *
   *  - that it is an object at all, so a port shared with something else cannot
   *    take this pane down;
   *  - that its `protocol` is this one, because after an auto-update (§6) a
   *    running renderer can be an older build than the main process that just
   *    replaced itself;
   *  - that its `type` is one this replica handles, which is the same statement
   *    one version along.
   *
   * A message failing any of the three is DROPPED and nothing is reported,
   * because there is no channel back and no host code in this realm to report to.
   *
   * **What is NOT checked is the CONTENT, and a forged message whose content the
   * store refuses raises out of this callback.** That is deliberate and it is
   * the same shape `ShellStateStore.subscribe` documents one layer down: a
   * throw has to go somewhere, and the two alternatives are worse. Swallowing it
   * would leave a replica quietly diverged from main with nothing anywhere
   * saying so; re-validating main's own snapshot field by field before handing
   * it to the validator that is about to validate it would be the same check
   * twice, and would still have to decide what to do with the failure. Main
   * cannot produce such a message — its own store built the value — so reaching
   * this is a forged port message, and a renderer with a forged port message on
   * it has a larger problem than this store. *Tests:*
   * `src/core/ipc/__tests__/replicaStore.test.ts` — "cannot be polluted by a
   * __proto__ key arriving over the wire".
   */
  function receive(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const candidate = message as Partial<HostMessage>;
    if (candidate.protocol !== PROTOCOL_VERSION) {
      return;
    }
    const handler = handlers.get(candidate.type as HostMessage['type']);
    if (handler === undefined) {
      return;
    }
    handler(candidate as never);
  }

  port.onmessage = receive;

  // Frozen, exactly as `createShellStateStore`'s return is, and for the same
  // reason: this object is handed to plug-in code through the public
  // `useShellStore()`, and a member that could be replaced is a write door that
  // could be silently rerouted — or, here, one that could be made to stop
  // posting while going on applying locally, which would desynchronise the pane
  // without any error anywhere.
  return Object.freeze({
    getContext: local.getContext,
    subscribe: local.subscribe,
    getBadgeCount: local.getBadgeCount,
    getNavMetric: local.getNavMetric,

    patchContext(patch: Partial<RibbonContext>): void {
      writeContext(() => {
        local.patchContext(patch);
      });
    },

    setSelectedItem(id: string | null): void {
      writeContext(() => {
        local.setSelectedItem(id);
      });
    },

    setSelectedItems(ids: readonly string[]): void {
      writeContext(() => {
        local.setSelectedItems(ids);
      });
    },

    setActiveNavNode(nodeId: string | null): void {
      writeContext(() => {
        local.setActiveNavNode(nodeId);
      });
    },

    setBadgeCount(extensionId: string, nodeId: string, count: number): void {
      local.setBadgeCount(extensionId, nodeId, count);
      // `count` is a proven non-negative safe integer by the time this runs, and a
      // primitive cannot re-read differently — so unlike a context patch there is
      // nothing here to read back out of the store.
      post({ kind: 'set-badge-count', extensionId, nodeId, count });
    },

    setNavMetric(extensionId: string, nodeId: string, value: number): void {
      local.setNavMetric(extensionId, nodeId, value);
      // Read BACK, because `setNavMetric` CLAMPS: posting the caller's number
      // would store 1 here and 1.4 there. The read cannot miss — the write above
      // either stored a number or threw.
      post({
        kind: 'set-nav-metric',
        extensionId,
        nodeId,
        value: local.getNavMetric(extensionId, nodeId) as number,
      });
    },

    setContextKey(extensionId: string, key: string, value: ContextKeyValue): void {
      local.setContextKey(extensionId, key, value);
      // A proven primitive, like `count` above. The published record that follows
      // from it is main's to rebuild, and main rebuilds it from its own scope map
      // rather than from anything sent here.
      post({ kind: 'set-context-key', extensionId, key, value });
    },

    clearContextKeys(): void {
      local.clearContextKeys();
      post({ kind: 'clear-context-keys' });
    },
  });
}
