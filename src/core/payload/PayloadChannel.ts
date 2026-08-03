import { useCallback, useSyncExternalStore } from 'react';
import { EXTENSION_ID_PATTERN, RESERVED_IDS } from '../RegistryContext';
import { BLOCK_KINDS, ShellUXError } from '../types';
import type { BlockKind, IShellAPI, PayloadValue, StructuredPayload } from '../types';

/**
 * ============================================================================
 * THE STRUCTURED PAYLOAD CHANNEL — AN ANSWER TO `types.ts`, NOT A REVERSAL
 * ============================================================================
 * `ContextKeyValue` is `string | number | boolean | null`, and its docblock says
 * why in three clauses. An object in `RibbonContext` would carry
 *
 *   (1) "getters that re-enter host code during a render-phase predicate",
 *   (2) "a prototype another extension could reach through", and
 *   (3) "an identity no `Object.is` bail-out could compare".
 *
 * **Every one of those is a statement about a LIVE CALLER'S OBJECT REACHING A
 * RENDER PATH. None of them is a statement about structure.** That is the whole
 * of why this module can exist without contradicting the one it quotes. ADR-0001
 * Amendment L quotes all three verbatim and answers each; in short:
 *
 *  1. *Render-phase getters.* A payload NEVER enters `RibbonContext`. It lives in
 *     this store, which is a different object with a different lifetime.
 *     `ShellStateStore.getContext()` does not read it, and `CONTEXT_FIELDS` in
 *     `ShellAPI.ts` — which is `Record<keyof RibbonContext, …>` and therefore
 *     compiler-pinned — does not name it, so a payload could not be added to the
 *     context without somebody deciding in that table what a legal value for it
 *     is. `isVisible(ctx)` is handed a `RibbonContext` and nothing else, so it has
 *     no argument through which to reach one. The publisher's getters run exactly
 *     ONCE, in `copyValue` below, at an imperative door that is never on a render
 *     path. Pinned by "a published payload never enters the context, and
 *     publishing does not move the snapshot" and "an isVisible predicate has no
 *     argument through which to reach a payload" in
 *     `src/core/__tests__/payloadChannel.test.tsx`.
 *  2. *Prototype.* Nothing of the caller's object graph is retained. Every record
 *     is a fresh `Object.create(null)`, every array a fresh frozen array, and
 *     every leaf a primitive. There is no prototype to walk back through because
 *     there is no prototype. Pinned by "takes a null-prototype deep copy, so a
 *     __proto__ key pollutes nothing", same file.
 *  3. *Identity.* Subscribers compare `StructuredPayload.revision`, a
 *     host-assigned monotonic number. **Stated honestly rather than glossed:
 *     republishing identical content DOES bump the revision and DOES notify.**
 *     The host does not deep-compare payloads — a walk over 4096 nodes on every
 *     publish would cost more than the re-render it saves — so the bail-out
 *     `applyPatch` performs field by field has no analogue here. Pinned by "bumps
 *     the revision and notifies even when the republished content is identical",
 *     same file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PRIMITIVE RULE BOUGHT FOR FREE, AND WHAT IT NOW COSTS
 * ---------------------------------------------------------------------------
 * A primitive is bounded by `typeof`. A graph is not, so four bounds that were
 * previously implicit are explicit and live in `PAYLOAD_LIMITS`: depth, node
 * count, host-accounted size, and channels per extension scope.
 *
 * **A CYCLE IS REJECTED, NEVER TRUNCATED.** Truncating is the tempting option
 * because it always succeeds, and it is wrong: the subscriber receives a payload
 * the publisher did not write, cannot distinguish it from one that was, and the
 * publisher is never told. Rejection is one `ShellUXError` at the call site of
 * the bug. A repeated SIBLING is not a cycle and is copied — `{ a: shared, b:
 * shared }` is a directed acyclic graph with a finite copy, and refusing it would
 * reject a payload with nothing wrong with it. Pinned by "rejects a cycle rather
 * than truncating it, and copies a repeated sibling", same file.
 *
 * **NO NEW `ShellUXErrorCode`.** The existing ten cover every rejection here:
 * `INVALID_ID` for a channel name, `INVALID_FIELD` for a shape, a bad kind, a
 * non-primitive leaf and a cycle, `PAYLOAD_TOO_LARGE` for every bound, `REVOKED`
 * from the facade. `SHELL_UX_ERROR_CODE_MEMBERS` in `types.ts` is
 * compiler-pinned, so widening it is a change every reader of that union would
 * have to be told about — for no gain, since no caller could branch on a new code
 * more usefully than on those three plus the `field` path.
 * ============================================================================
 */

/**
 * The bounds a structured payload is measured against.
 *
 * **Its own record rather than four more keys on `REGISTRY_LIMITS`, and the
 * split is a real one.** `REGISTRY_LIMITS` bounds what arrives through the
 * REGISTRY's door: once, at registration, on a manifest. These bound what arrives
 * through an IMPERATIVE door: repeatedly, at runtime, from an already-registered
 * extension. They are measured by different code against different payloads, and
 * there is no value in one being raisable by an edit aimed at the other.
 */
export const PAYLOAD_LIMITS = Object.freeze({
  /**
   * Deepest nesting a payload may have. The root counts as depth 1, so
   * `{ series: [{ points: [1, 2] }] }` reaches depth 4.
   */
  MAX_DEPTH: 6,
  /** Most values — leaves, arrays and records together — one payload may hold. */
  MAX_NODES: 4096,
  /**
   * Largest a payload may be, in the host's own accounting. See `SIZE_OF`.
   *
   * 256 KiB, chosen against what a pane-3 block legitimately is — a table of a
   * few thousand cells, a chart of a few thousand points — rather than against
   * what a transport could carry. The point of the bound is that one extension
   * cannot make the host's copy of its data the largest thing in the process.
   */
  MAX_BYTES: 262_144,
  /** Most channels one extension scope may hold at once. */
  MAX_CHANNELS: 32,
});

/**
 * What each kind of node costs against `MAX_BYTES`.
 *
 * **The host's own accounting, defined here rather than inferred from
 * `JSON.stringify`.** Serialising in order to measure would run a `toJSON` the
 * publisher wrote, throw outright on a cycle before the cycle check could report
 * it properly, and allocate a second copy of the very thing being bounded. So the
 * size is accumulated during the copy walk that was happening anyway. It is an
 * APPROXIMATION of a JSON encoding and is not claimed to be one: what a bound
 * needs is to be deterministic, monotonic in the payload, and impossible for a
 * publisher to game, and this is all three.
 */
const SIZE_OF = Object.freeze({
  /** A `null`, a `boolean` or a `number`, plus one for a separator. */
  SCALAR: 8,
  /** The brackets or braces of a container, plus one for a separator. */
  CONTAINER: 4,
  /** Added to a string's or a key's own length, for its two quotes. */
  QUOTES: 2,
});

/**
 * The mutable accounting carried down the copy walk.
 *
 * `ancestors` holds the containers on the CURRENT PATH and nothing else — added
 * before descending, removed after — so it detects a genuine cycle and does not
 * mistake a repeated sibling for one.
 */
interface CopyState {
  nodes: number;
  bytes: number;
  readonly ancestors: Set<object>;
}

/** A rejection naming a path inside the payload. */
function reject(code: 'INVALID_FIELD' | 'PAYLOAD_TOO_LARGE', message: string, path: string): never {
  throw new ShellUXError(code, `publishPayload: ${message}`, path);
}

/**
 * Read one property off an untrusted value, turning a refusal into a rejection.
 *
 * Reaching a property on a publisher's object is a call into the publisher's
 * code — a `get` trap, an own getter, an `ownKeys` trap, or a revoked `Proxy`
 * whose every internal method throws a raw `TypeError`. This module is contracted
 * to throw `ShellUXError`, so every such read goes through here.
 *
 * ONE guarded read for the whole module, so the bytes/nodes accounting and the
 * rejection wording cannot drift between the array walk and the record walk.
 */
function readOrReject<T>(read: () => T, message: string, path: string): T {
  try {
    return read();
  } catch {
    reject('INVALID_FIELD', message, path);
  }
}

/**
 * Charge `amount` against the size bound, and reject once it is exceeded.
 *
 * ONE bound check for every kind of node, deliberately. Four copies of
 * `if (state.bytes > MAX_BYTES)` would be four places for the message to drift
 * and four branches whose true side is only reachable by a payload constructed to
 * cross the bound at that exact node.
 */
function charge(state: CopyState, amount: number, path: string): void {
  state.bytes += amount;
  if (state.bytes > PAYLOAD_LIMITS.MAX_BYTES) {
    reject(
      'PAYLOAD_TOO_LARGE',
      `the payload exceeds the maximum size of ${PAYLOAD_LIMITS.MAX_BYTES} bytes.`,
      path,
    );
  }
}

/**
 * Assert that `value` is an identifier the host may key a channel by.
 *
 * The registry's own allowlist and reserved words, imported rather than
 * restated — exactly as `assertValidIdentifier` in `ShellAPI.ts` imports them —
 * so a channel name can carry no path separator, no URL scheme, no markup and no
 * `__proto__`, and this rule cannot drift from the one the registry applies.
 *
 * `method` is a parameter because all three doors reach here and a rejection has
 * to name the one the caller actually used.
 */
function assertValidChannel(value: unknown, method: string): void {
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_ID',
      `${method}: "channel" must be a string; received a value of type "${typeof value}".`,
      'channel',
    );
  }
  if (RESERVED_IDS.has(value) || !EXTENSION_ID_PATTERN.test(value)) {
    // A proven primitive string, so interpolating it is safe.
    throw new ShellUXError(
      'INVALID_ID',
      `${method}: "channel" must match ${String(EXTENSION_ID_PATTERN)} and must not be a reserved identifier; received "${value}".`,
      'channel',
    );
  }
}

/**
 * Build the HOST-OWNED deep copy of one untrusted value.
 *
 * `normalizeNavigationNode`'s discipline, applied to an arbitrary graph. Three
 * rules run the whole walk, and each is what makes the copy trustworthy:
 *
 *  - **Every read happens exactly once, into a local.** A `length` is captured
 *    before the loop that uses it and never re-read; a property is read once and
 *    the local is what is both checked AND stored. A `Proxy` that reports one
 *    value while it is validated and another afterwards has nothing to shift.
 *  - **Every read is guarded**, through `readOrReject`, so a publisher's throwing
 *    trap becomes a rejection naming the path rather than an exception of the
 *    publisher's choosing escaping a `@throws {ShellUXError}` function.
 *  - **Records are built on `Object.create(null)` and frozen.** The prototype
 *    objection in `ContextKeyValue`'s docblock is answered structurally: there is
 *    no prototype on the stored record, so a `__proto__` key is an ordinary own
 *    property that pollutes nothing, and there is no chain for a reader to walk
 *    back into the publisher's realm.
 */
function copyValue(value: unknown, path: string, depth: number, state: CopyState): PayloadValue {
  if (depth > PAYLOAD_LIMITS.MAX_DEPTH) {
    reject(
      'PAYLOAD_TOO_LARGE',
      `"${path}" is deeper than the maximum payload depth of ${PAYLOAD_LIMITS.MAX_DEPTH}.`,
      path,
    );
  }
  state.nodes += 1;
  if (state.nodes > PAYLOAD_LIMITS.MAX_NODES) {
    reject(
      'PAYLOAD_TOO_LARGE',
      `the payload exceeds the maximum of ${PAYLOAD_LIMITS.MAX_NODES} nodes.`,
      path,
    );
  }

  // ---- Leaves. `PayloadLeaf` is `ContextKeyValue`, and this is that check ----
  if (value === null || typeof value === 'boolean') {
    charge(state, SIZE_OF.SCALAR, path);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      // The rule `setContextKey` applies, for the same reason: `NaN` and
      // `±Infinity` survive no serialisation this payload will meet, and a
      // reader cannot branch on them usefully.
      reject('INVALID_FIELD', `"${path}" must be a finite number when it is a number.`, path);
    }
    charge(state, SIZE_OF.SCALAR, path);
    return value;
  }
  if (typeof value === 'string') {
    charge(state, value.length + SIZE_OF.QUOTES, path);
    return value;
  }

  // ---- Anything that is neither a leaf nor a container ---------------------
  // A function, a symbol, a bigint, `undefined`, or a `Date`/`Map`/`RegExp`/class
  // instance reached below. Refused BY TYPE rather than coerced: `PayloadLeaf` is
  // the leaf contract, and silently turning a `Date` into a string would be the
  // host inventing a representation the publisher did not choose and the
  // subscriber cannot undo.
  if (typeof value !== 'object') {
    reject(
      'INVALID_FIELD',
      `"${path}" must be a string, a finite number, a boolean, null, an array or a plain record; received a value of type "${typeof value}".`,
      path,
    );
  }

  // ---- Cycles, decided before any descent ---------------------------------
  if (state.ancestors.has(value)) {
    reject(
      'INVALID_FIELD',
      `"${path}" closes a cycle. A payload is a tree; a cycle is rejected rather than truncated, because a truncated cycle is a payload you did not publish and your subscriber cannot tell from one you did.`,
      path,
    );
  }

  // `Array.isArray` raises a raw `TypeError` on a revoked `Proxy` — the same leak
  // `checkArray` closes in `RegistryContext.tsx`, reached by another door.
  const isArray = readOrReject(
    () => Array.isArray(value),
    `"${path}" refused to be inspected.`,
    path,
  );

  charge(state, SIZE_OF.CONTAINER, path);
  state.ancestors.add(value);

  const copied = isArray
    ? copyArray(value as readonly unknown[], path, depth, state)
    : copyRecord(value as Record<string, unknown>, path, depth, state);

  state.ancestors.delete(value);
  return copied;
}

/**
 * Copy one array. The length is captured ONCE, before the loop, and the
 * host-owned array is filled with exactly that many entries — so a `Proxy`
 * cannot grow the work the host does after the bound was checked.
 */
function copyArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  state: CopyState,
): PayloadValue {
  const count = readOrReject(
    () => (value as { readonly length: unknown }).length,
    `"${path}" refused to report its length.`,
    path,
  );
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    reject('INVALID_FIELD', `"${path}" must report a non-negative integer length.`, path);
  }
  const items: PayloadValue[] = [];
  for (let index = 0; index < count; index += 1) {
    const elementPath = `${path}[${index}]`;
    const element = readOrReject(
      () => value[index],
      `reading "${elementPath}" threw.`,
      elementPath,
    );
    items.push(copyValue(element, elementPath, depth + 1, state));
  }
  return Object.freeze(items);
}

/**
 * Copy one record onto a fresh null-prototype object.
 *
 * `Object.keys` is guarded because an `ownKeys` trap is publisher code. It is
 * NOT re-checked for being an array afterwards: `Object.keys` returns a real
 * array for every input the specification admits, so a check there would be a
 * branch no payload could reach — and an unreachable branch is deleted here
 * rather than covered by a test that pretends to reach it.
 */
function copyRecord(
  value: Record<string, unknown>,
  path: string,
  depth: number,
  state: CopyState,
): PayloadValue {
  const keys = readOrReject(
    () => Object.keys(value),
    `"${path}" refused to list its own keys.`,
    path,
  );
  // No prototype, so a `__proto__` key arriving here is an ordinary own property
  // of this record and changes nothing about it. There is nothing to pollute.
  const record = Object.create(null) as Record<string, PayloadValue>;
  for (const key of keys) {
    const keyPath = `${path}.${key}`;
    charge(state, key.length + SIZE_OF.QUOTES, keyPath);
    const held = readOrReject(() => value[key], `reading "${keyPath}" threw.`, keyPath);
    record[key] = copyValue(held, keyPath, depth + 1, state);
  }
  return Object.freeze(record);
}

/** One channel's current payload and its subscribers. */
interface ChannelEntry {
  payload: StructuredPayload | null;
  readonly listeners: Set<(payload: StructuredPayload) => void>;
}

/**
 * The host-owned payload store. One per `ShellHostProvider`.
 *
 * **A `Map` of `Map`s, keyed by extension scope then by channel**, for exactly
 * the reasons `contextKeyScopes` is: the keys originate in plug-in manifests, a
 * `Map` has no prototype chain to pollute, and a whole scope is needed at once
 * when an extension goes away.
 *
 * **This is a DIFFERENT OBJECT from `ShellStateStore`, and that separation is the
 * answer to the first of Amendment K Decision 2's three objections rather than a
 * filing decision.** See this module's banner.
 */
export interface PayloadChannelStore {
  /** Publish, taking a host-owned deep copy. See `IShellAPI.publishPayload`. */
  publish(extensionId: string, channel: string, kind: unknown, data: unknown): void;
  /** The current payload on one channel, or `null`. Identity is stable until republished. */
  read(extensionId: string, channel: string): StructuredPayload | null;
  /** Subscribe to one channel. Returns a TOTAL unsubscribe function. */
  subscribe(
    extensionId: string,
    channel: string,
    listener: (payload: StructuredPayload) => void,
  ): () => void;
  /** Drop one extension's channels entirely. The bookkeeping half of a teardown. */
  clearScope(extensionId: string): void;
}

/**
 * Create the payload channel store.
 *
 * Its state is closure variables, for the reason `createShellStateStore`'s is:
 * JavaScript has no reflective API for a scope, so a caller who reaches this
 * object obtains its four methods and never the `Map`s behind them. The object is
 * frozen, so the four cannot be replaced, deleted or added to.
 *
 * **That is a claim about REPLACEMENT and about state reachability, and nothing
 * wider.** `subscribe` runs code the publisher did not write, synchronously,
 * inside the publisher's `publish` frame — it can observe, it can re-enter, and it
 * can throw into that frame. That is the limit `ShellStateStore.subscribe`
 * documents at length, and it is not closable here for the same reason: a channel
 * that notifies nobody is a channel no pane can render off. Pinned by "runs a
 * subscriber synchronously inside the publisher's frame, and lets it throw there"
 * in `src/core/__tests__/payloadChannel.test.tsx`.
 */
export function createPayloadChannelStore(): PayloadChannelStore {
  const scopes = new Map<string, Map<string, ChannelEntry>>();
  /**
   * The revision counter. STORE-WIDE rather than per channel.
   *
   * Monotonic per channel follows from monotonic overall, and the stronger
   * property is worth having: two payloads published on two channels are
   * comparable, so a pane-3 block reading a chart channel and a table channel can
   * tell which arrived last without the host inventing a clock.
   */
  let revision = 0;

  /** The entry for one channel, creating the scope and the channel when asked to. */
  function entryFor(extensionId: string, channel: string, create: boolean): ChannelEntry | null {
    let scope = scopes.get(extensionId);
    if (scope === undefined) {
      if (!create) {
        return null;
      }
      scope = new Map<string, ChannelEntry>();
      scopes.set(extensionId, scope);
    }
    const existing = scope.get(channel);
    if (existing !== undefined) {
      return existing;
    }
    if (!create) {
      return null;
    }
    if (scope.size >= PAYLOAD_LIMITS.MAX_CHANNELS) {
      // Checked against what is STORED, and only for a channel that is genuinely
      // new — exactly as `setContextKey` checks its own bound. Republishing on a
      // channel already held is not growth and must not start failing at the
      // bound.
      throw new ShellUXError(
        'PAYLOAD_TOO_LARGE',
        `publishPayload: an extension may hold at most ${PAYLOAD_LIMITS.MAX_CHANNELS} channels, and "${channel}" would be one more.`,
        'channel',
      );
    }
    const entry: ChannelEntry = { payload: null, listeners: new Set() };
    scope.set(channel, entry);
    return entry;
  }

  return Object.freeze({
    publish(extensionId: string, channel: string, kind: unknown, data: unknown): void {
      assertValidChannel(channel, 'publishPayload');
      if (typeof kind !== 'string' || !BLOCK_KINDS.has(kind)) {
        throw new ShellUXError(
          'INVALID_FIELD',
          `publishPayload: "kind" must be one of ${[...BLOCK_KINDS].join(', ')}; received a value of type "${typeof kind}". An unknown block kind has no honest fallback, so it is refused rather than rendered as something else.`,
          'kind',
        );
      }
      // COPIED AND VALIDATED FIRST, STORED AFTERWARDS. A payload rejected halfway
      // leaves the channel exactly as it was and notifies nobody, which is the
      // all-or-nothing rule `applyPatch` states for the context, applied here.
      const copied = copyValue(data, 'data', 1, { nodes: 0, bytes: 0, ancestors: new Set() });
      const entry = entryFor(extensionId, channel, true) as ChannelEntry;
      revision += 1;
      const payload: StructuredPayload = Object.freeze({
        channel,
        kind: kind as BlockKind,
        revision,
        data: copied,
      });
      entry.payload = payload;
      // Over a SNAPSHOT, re-checking membership, for the reasons
      // `ShellStateStore.notify` gives: a listener added during the pass is not
      // called by it, and one removed during the pass is not called after its
      // unsubscribe returned.
      for (const listener of Array.from(entry.listeners)) {
        if (entry.listeners.has(listener)) {
          listener(payload);
        }
      }
    },

    read(extensionId: string, channel: string): StructuredPayload | null {
      assertValidChannel(channel, 'readPayload');
      return entryFor(extensionId, channel, false)?.payload ?? null;
    },

    subscribe(
      extensionId: string,
      channel: string,
      listener: (payload: StructuredPayload) => void,
    ): () => void {
      assertValidChannel(channel, 'subscribePayload');
      if (typeof listener !== 'function') {
        throw new ShellUXError(
          'INVALID_FIELD',
          `subscribePayload: "listener" must be a function; received a value of type "${typeof listener}".`,
          'listener',
        );
      }
      // `create: true`, so subscribing to a channel nothing has published on yet
      // is legal — which is the ordinary mount order for two panes, where the
      // reading pane commits before the writing pane's effect has run.
      const entry = entryFor(extensionId, channel, true) as ChannelEntry;
      entry.listeners.add(listener);
      // TOTAL. It reads nothing, validates nothing and throws nothing, so it is
      // safe in a React effect cleanup that runs after this extension has been
      // unregistered. See `IShellAPI.subscribePayload`.
      return (): void => {
        entry.listeners.delete(listener);
      };
    },

    clearScope(extensionId: string): void {
      scopes.delete(extensionId);
    },
  });
}

/**
 * Subscribe a component to one channel on its own `IShellAPI`.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, for exactly the
 * reason `useShellContext` gives: a store read taken during render can be stale
 * by the time the tree commits, and two panes reading at different points would
 * then show two different payloads for one commit.
 *
 * **The snapshot is safe to hand to `useSyncExternalStore` because
 * `readPayload`'s identity is stable.** The host builds one frozen copy per
 * publish and returns that same object until the channel is republished, so two
 * reads with nothing in between are `Object.is`-equal and React bails out. A
 * `readPayload` that rebuilt on every call would re-render its component forever.
 * Pinned by "hands useSyncExternalStore a stable snapshot, so an unchanged
 * channel does not re-render" in `src/core/__tests__/payloadChannel.test.tsx`.
 *
 * @throws {ShellUXError} `REVOKED` during render when the handle has been
 *   revoked, and `INVALID_ID` during render for a malformed channel — the same
 *   loud, deterministic failure `useBadgeCount` chooses over quietly reading
 *   nothing.
 */
export function useChannelPayload(shell: IShellAPI, channel: string): StructuredPayload | null {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) =>
      // The payload argument is deliberately dropped: `useSyncExternalStore`'s
      // contract is a signal to RE-READ, and reading through `getSnapshot` is
      // what keeps the value React renders and the value the store holds the
      // same object.
      shell.subscribePayload(channel, () => {
        onStoreChange();
      }),
    [shell, channel],
  );
  const getSnapshot = useCallback(
    (): StructuredPayload | null => shell.readPayload(channel),
    [shell, channel],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
