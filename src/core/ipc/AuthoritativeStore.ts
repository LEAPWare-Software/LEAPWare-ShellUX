import type { RibbonContext } from '../types';
import { ShellUXError } from '../types';
import { createShellStateStore } from '../ShellAPI';
import type { PortLike } from './PortLike';
import type {
  CommitMessage,
  HostMessage,
  OriginViolation,
  StoreOperation,
  WriteMessage,
} from './protocol';
import { KNOWN_OPERATION_KINDS, MAIN_ORIGIN, PROTOCOL_VERSION, applyOperation } from './protocol';

/**
 * ============================================================================
 * MAIN OWNS TRUTH. A RENDERER IS NOT TRUSTED.
 * ============================================================================
 * This is the main-process end of the state design: one `ShellStateStore` that
 * is the only authoritative one in the application, N connected replicas, and
 * one rule about who is believed.
 *
 * **Every renderer write is re-validated here, through the store's own
 * validators.** The replica that posted it already ran the identical check —
 * that is what keeps `INVALID_FIELD` and `PAYLOAD_TOO_LARGE` synchronous and
 * identical for a plug-in — so an operation that reaches this door and is
 * refused is one whose renderer BYPASSED its own replica and posted straight at
 * the port. That is not a hypothetical: a renderer is where plug-in code runs,
 * and ADR-0001 records that the in-page boundary is not a sandbox. Re-validating
 * costs one already-written function call per write and is the difference
 * between "the renderer checks" and "the host checks".
 *
 * ---------------------------------------------------------------------------
 * §9 R4 — WHY A DEPTH COUNTER IS NOT ENOUGH AND A RATE LIMIT IS HERE
 * ---------------------------------------------------------------------------
 * `MAX_NOTIFY_DEPTH` in `ShellAPI.ts` bounds a notification cascade WITHIN one
 * store: a listener that writes back re-enters `applyPatch`, which notifies
 * again, and at 16 the store raises `REENTRANT_NOTIFY` instead of following the
 * recursion to a blown stack.
 *
 * **Across processes that counter never fires, and this is the most likely
 * production bug in the whole pivot.** The loop is: replica A applies a write
 * and posts it; main applies and commits; replica B applies the commit and
 * notifies; a listener in B writes; B posts; main commits; A applies and
 * notifies; a listener in A writes. Every hop is a fresh call stack in a fresh
 * store — A's `notifyDepth` is back to 0 by the time B's write arrives — so the
 * cascade never gets deeper than 1 anywhere, `REENTRANT_NOTIFY` is never raised,
 * and the loop runs forever at message rate. Nothing in the single-process design
 * can see it, because in a single process the two listeners are in one store and
 * the counter catches them on the second hop.
 *
 * The only place that CAN see it is the one both hops pass through, which is
 * here. So main counts inbound messages per origin, and an origin that exceeds
 * `MAX_WRITES_PER_WINDOW` within `WRITE_WINDOW_MS` is SEVERED: its writes stop
 * being applied, a `throttled` message tells its replica to stop posting them,
 * and the host is told through `onViolation` so it can do the half this module
 * cannot — reload the pane. There is no un-severing, because a reloaded pane is
 * a new port with a new origin.
 *
 * **Per ORIGIN, not global**, which is the property the storm test is actually
 * about: a wedged pane 3 must not stop pane 2 writing. *Tests:*
 * `src/core/ipc/__tests__/writeStorm.test.ts` — "a two-replica write loop is cut
 * off by main, and not by either notify-depth counter", "severs only the origin
 * that stormed, and leaves the other replica writing" and "counts a malformed
 * message against the same budget an accepted write spends". The contrast that
 * makes the point is in the same file: "the same two listeners in ONE store are
 * stopped by MAX_NOTIFY_DEPTH, which is why it looks sufficient".
 * ============================================================================
 */

/**
 * How many inbound messages one origin may post per window before it is severed.
 *
 * **Chosen against what a real pane does, not against what feels safe.** A
 * renderer writes the shell store from event handlers and effects: a click that
 * changes the selection, a fetch that resolves and sets a context key, a scroll
 * that lands on a new row. Sixty-four such writes inside one second is already
 * an order of magnitude past a human driving a UI, and two orders below what an
 * unbounded cross-process loop reaches — a loop is bounded only by message
 * throughput, which is thousands per second. Anything in between is a pane
 * misbehaving whether or not it is looping.
 *
 * It counts MESSAGES rather than accepted writes, so a renderer cannot buy extra
 * budget by posting rubbish: a malformed message costs the same as a write.
 */
export const MAX_WRITES_PER_WINDOW = 64;

/** The window `MAX_WRITES_PER_WINDOW` is counted over, in milliseconds. */
export const WRITE_WINDOW_MS = 1000;

/** What the host must supply to create the authoritative store. */
export interface AuthoritativeStoreOptions {
  /**
   * The clock the rate limiter reads.
   *
   * **A required parameter with no default, and the absence of the default is
   * the decision.** `Date.now` as a default would be one line and would make the
   * storm test depend on wall-clock timing — the exact shape of flake this
   * repository has no tolerance for, since `verify` runs on three OS legs and R12
   * records this machine as memory-degraded and already OOM-killed twice. A
   * required clock means the storm test hands back a constant and the whole
   * window is deterministic. The Electron host passes `Date.now`.
   */
  readonly now: () => number;
  /**
   * Called when a renderer posts something main refuses.
   *
   * Required for the same reason: a violation nobody is told about is a silent
   * drop, and the host action §5 names for a storm — reload the pane — is not
   * something this module can perform. See `OriginViolation`.
   */
  readonly onViolation: (violation: OriginViolation) => void;
}

/** The main-process end of the replicated store. */
export interface AuthoritativeStore {
  /** The authoritative context. Host chrome renders off this. */
  getContext(): Readonly<RibbonContext>;
  /** `useSyncExternalStore`'s subscribe contract, over the authoritative store. */
  subscribe(listener: () => void): () => void;
  /** The authoritative badge count for one extension's node. */
  getBadgeCount(extensionId: string, nodeId: string): number | undefined;
  /** The authoritative live metric value for one extension's node. */
  getNavMetric(extensionId: string, nodeId: string): number | undefined;
  /**
   * Apply one of MAIN's own writes and commit it to every replica.
   *
   * **Host chrome writes through here and not through a store handle**, and the
   * narrowness is the point: a `ShellStateStore` handed to host code would be a
   * write door that does not broadcast, so a pane-1 click would move main's truth
   * and no renderer would ever hear about it. There is one write door and it
   * broadcasts.
   *
   * @throws {ShellUXError} whatever the store member throws. Main's own writes
   *   are not refused-and-reported the way a renderer's are: a rejection here is
   *   a host bug and belongs in the host's frame.
   */
  dispatch(operation: StoreOperation): void;
  /**
   * Attach one renderer's port under `origin`, and return the detach function.
   *
   * The opening `resync` is posted before this returns, so the replica must
   * already be reading its end — see `PortLike.onmessage`, which drops rather
   * than queues.
   */
  connect(port: PortLike, origin: string): () => void;
}

/** One attached renderer, and its share of the rate-limit budget. */
interface Connection {
  readonly port: PortLike;
  /**
   * The origin MAIN bound to this port.
   *
   * Never the origin a message claims. A renderer that lies in `WriteMessage.origin`
   * cannot spend another pane's budget, because the budget is keyed on this.
   */
  readonly origin: string;
  /** Start of the current window, on `options.now`'s clock. */
  windowStart: number;
  /** Messages received in the current window. */
  messages: number;
  /** Whether this origin has been cut off. There is no route back to `false`. */
  severed: boolean;
}

/**
 * Create the authoritative store.
 *
 * The truth is a plain `createShellStateStore()` — the same store, with the same
 * validators, the same notification semantics and the same `REENTRANT_NOTIFY`
 * cap that a single-process shell has always used. Nothing about being
 * authoritative changes what the store IS; what changes is who may write to it
 * and what happens after a write lands.
 */
export function createAuthoritativeStore(options: AuthoritativeStoreOptions): AuthoritativeStore {
  const truth = createShellStateStore();
  const connections = new Set<Connection>();
  /** Main's own write counter, so a commit from main is labelled like any other. */
  let mainSeq = 0;

  /**
   * Send one commit to every attached replica, INCLUDING the originator.
   *
   * The originator needs it: that is how it retires its optimistic write and
   * learns main's ordering. See `ReplicaStore`'s echo suppression.
   *
   * The pass runs over a snapshot and re-checks membership before each post, for
   * the reason `notify` in `ShellAPI.ts` does the same: posting is a synchronous
   * call into the other end, the other end can write back, and a write can reach
   * a host listener that disconnects a pane. Iterating the live `Set` would then
   * have no useful answer to "what does this loop visit?", and a port detached
   * earlier in the same pass would still be posted to. *Tests:*
   * `src/core/ipc/__tests__/authoritativeStore.test.ts` — "does not post a commit
   * to a replica disconnected earlier in the same broadcast".
   */
  function broadcast(origin: string, seq: number, operation: StoreOperation): void {
    const commit: CommitMessage = {
      type: 'commit',
      protocol: PROTOCOL_VERSION,
      origin,
      seq,
      op: operation,
      context: truth.getContext(),
    };
    for (const connection of Array.from(connections)) {
      if (connections.has(connection)) {
        connection.port.postMessage(commit);
      }
    }
  }

  /** Post one host message to one replica. */
  function send(connection: Connection, message: HostMessage): void {
    connection.port.postMessage(message);
  }

  /**
   * Report a malformed message and drop it.
   *
   * Malformed is not refused: a refusal names a `ShellUXErrorCode` the store
   * decided on for an operation it understood, and nothing here was understood
   * well enough to be handed to the store. The renderer is told nothing, because
   * a renderer that posts a message of a shape this protocol does not define is
   * not running the code that would read the answer.
   */
  function malformed(connection: Connection, message: string): void {
    options.onViolation({ kind: 'malformed', origin: connection.origin, message });
  }

  /**
   * Read an untrusted inbound message as a `WriteMessage`, or report why not.
   *
   * **Reading a field off it invokes nothing, and that is a property of the
   * transport rather than of this function.** A message that has crossed a real
   * port has been structured-cloned, so what arrives is a plain data graph with
   * no getters, no `Proxy` traps and no prototype the sender chose — which is why
   * this reads directly where `applyPatch` in `ShellAPI.ts` has to guard every
   * read behind `readGuarded`. The fakes under `__tests__` clone too, precisely
   * so that this assumption is exercised rather than assumed. *Tests:*
   * `src/core/ipc/__tests__/portLike.test.ts` — "a port that clones strips the
   * null prototype a host-owned record was built with".
   *
   * Every rejection is reported and returns `null`; none throws. A throw would
   * land in a port callback with nowhere to go.
   */
  function readWrite(connection: Connection, message: unknown): WriteMessage | null {
    if (typeof message !== 'object' || message === null) {
      malformed(connection, `a message of type "${typeof message}" is not a protocol message.`);
      return null;
    }
    const candidate = message as Partial<WriteMessage>;
    if (candidate.protocol !== PROTOCOL_VERSION) {
      malformed(
        connection,
        `a message declaring protocol version ${String(candidate.protocol)} cannot be read by version ${PROTOCOL_VERSION}.`,
      );
      return null;
    }
    if (candidate.type !== 'write') {
      malformed(connection, `"${String(candidate.type)}" is not a message type a replica may send.`);
      return null;
    }
    if (typeof candidate.origin !== 'string' || !Number.isSafeInteger(candidate.seq)) {
      malformed(connection, 'a write must carry a string origin and an integer sequence number.');
      return null;
    }
    const operation: unknown = candidate.op;
    if (typeof operation !== 'object' || operation === null) {
      malformed(connection, `a write must carry an operation; received type "${typeof operation}".`);
      return null;
    }
    if (!KNOWN_OPERATION_KINDS.has((operation as StoreOperation).kind)) {
      malformed(
        connection,
        `"${String((operation as StoreOperation).kind)}" is not an operation this protocol defines.`,
      );
      return null;
    }
    return candidate as WriteMessage;
  }

  /**
   * Spend one message from `connection`'s budget, and sever it if that was one
   * too many.
   *
   * Counted BEFORE the message is understood, so malformed traffic costs the same
   * as a write — a renderer that could storm for free by posting rubbish would
   * have defeated the limit by reading it.
   *
   * @returns `true` when the message may proceed.
   */
  function spendBudget(connection: Connection): boolean {
    if (connection.severed) {
      return false;
    }
    const at = options.now();
    if (at - connection.windowStart >= WRITE_WINDOW_MS) {
      connection.windowStart = at;
      connection.messages = 0;
    }
    connection.messages += 1;
    if (connection.messages > MAX_WRITES_PER_WINDOW) {
      connection.severed = true;
      send(connection, {
        type: 'throttled',
        protocol: PROTOCOL_VERSION,
        origin: connection.origin,
        limit: MAX_WRITES_PER_WINDOW,
        windowMs: WRITE_WINDOW_MS,
      });
      options.onViolation({
        kind: 'throttled',
        origin: connection.origin,
        limit: MAX_WRITES_PER_WINDOW,
        windowMs: WRITE_WINDOW_MS,
      });
      return false;
    }
    return true;
  }

  /**
   * Apply one renderer's write to the truth, and commit it to everybody.
   *
   * **The `catch` is where "a renderer is not trusted" becomes observable.** The
   * store raises exactly what it would have raised for a local caller, and the
   * code it chose is carried back to the originator and reported to the host.
   * Nothing is applied and nothing is committed, which is correct: the replica
   * that posted this never applied it either, because its own copy of the same
   * validator would have refused it in the caller's frame — so there is nothing
   * to roll back.
   *
   * **One case is different and is written down rather than discovered: a throw
   * from MAIN'S OWN listener.** `applyOperation` commits before it notifies, so a
   * host listener that throws — or one that drives the cascade into
   * `REENTRANT_NOTIFY` — arrives here with the write ALREADY STANDING, and this
   * function then reports a refusal and broadcasts nothing. That is the same
   * asymmetry `ShellStateStore.patchContext` documents for `REENTRANT_NOTIFY`,
   * one process along, and the consequence is stated exactly: main has the write
   * and the replicas do not until the next commit, which carries the whole
   * context and therefore reconciles them. A host listener that throws is a host
   * bug; this is what it costs. *Tests:*
   * `src/core/ipc/__tests__/authoritativeStore.test.ts` — "reports a refusal when
   * a host listener throws, and says so with the write already standing".
   */
  function accept(connection: Connection, write: WriteMessage): void {
    try {
      applyOperation(truth, write.op);
    } catch (error) {
      const failure =
        error instanceof ShellUXError
          ? { code: error.code, message: error.message }
          : {
              code: 'INVALID_PAYLOAD' as const,
              message: `the operation raised a value of type "${typeof error}".`,
            };
      send(connection, {
        type: 'refused',
        protocol: PROTOCOL_VERSION,
        origin: write.origin,
        seq: write.seq,
        code: failure.code,
        message: failure.message,
      });
      options.onViolation({
        kind: 'refused',
        origin: connection.origin,
        seq: write.seq,
        code: failure.code,
        message: failure.message,
      });
      return;
    }
    // The origin a COMMIT carries is the one the message claimed, because it is
    // what the originator matches its own echo against and only the originator
    // can know which of its writes this was. The origin main polices is
    // `connection.origin`. See `WriteMessage.origin`.
    broadcast(write.origin, write.seq, write.op);
  }

  function connect(port: PortLike, origin: string): () => void {
    const connection: Connection = {
      port,
      origin,
      windowStart: options.now(),
      messages: 0,
      severed: false,
    };
    connections.add(connection);
    port.onmessage = (message: unknown): void => {
      if (!spendBudget(connection)) {
        return;
      }
      const write = readWrite(connection, message);
      if (write !== null) {
        accept(connection, write);
      }
    };
    send(connection, {
      type: 'resync',
      protocol: PROTOCOL_VERSION,
      context: truth.getContext(),
    });
    return (): void => {
      connections.delete(connection);
      port.onmessage = null;
    };
  }

  function dispatch(operation: StoreOperation): void {
    applyOperation(truth, operation);
    mainSeq += 1;
    broadcast(MAIN_ORIGIN, mainSeq, operation);
  }

  // Frozen for the reason `createShellStateStore` freezes its return: this object
  // is the host's one handle on the truth, and a member that could be replaced is
  // a write door that could be silently rerouted.
  return Object.freeze({
    getContext: truth.getContext,
    subscribe: truth.subscribe,
    getBadgeCount: truth.getBadgeCount,
    getNavMetric: truth.getNavMetric,
    dispatch,
    connect,
  });
}

