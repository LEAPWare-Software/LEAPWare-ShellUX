import { describe, expect, it, vi } from 'vitest';
import { ShellUXError } from '../../types';
import type { RibbonContext } from '../../types';
import type { ShellStateStore } from '../../ShellAPI';
import { createAuthoritativeStore } from '../AuthoritativeStore';
import type { AuthoritativeStore } from '../AuthoritativeStore';
import { createReplicaStore } from '../ReplicaStore';
import { PROTOCOL_VERSION } from '../protocol';
import type { OriginViolation, WriteMessage } from '../protocol';
import { createQueuedPortPair, createRecordingPort } from './fakePort';
import type { QueuedPortPair } from './fakePort';

/**
 * The renderer end, and the four properties Phase 6 exists to prove:
 * a synchronous `getContext`, a re-created null prototype, echo suppression
 * that does not roll a pane backwards, and the three contract corrections §5
 * asks to be recorded rather than footnoted.
 */

interface Pane {
  readonly store: ShellStateStore;
  readonly pair: QueuedPortPair;
}

interface Shell {
  readonly main: AuthoritativeStore;
  readonly violations: OriginViolation[];
  pane(origin: string): Pane;
  /** Deliver every queued message on every pane, repeatedly, until quiet. */
  settle(): void;
}

function shell(): Shell {
  const violations: OriginViolation[] = [];
  const main = createAuthoritativeStore({
    now: (): number => 1_000,
    onViolation: (violation): void => {
      violations.push(violation);
    },
  });
  const panes: Pane[] = [];

  return {
    main,
    violations,
    pane(origin: string): Pane {
      const pair = createQueuedPortPair();
      const store = createReplicaStore({ port: pair.right, origin });
      main.connect(pair.left, origin);
      const pane = { store, pair };
      panes.push(pane);
      return pane;
    },
    settle(): void {
      let moved = true;
      while (moved) {
        moved = false;
        for (const pane of panes) {
          if (pane.pair.waiting() > 0) {
            moved = true;
            pane.pair.flush();
          }
        }
      }
    },
  };
}

/** One replica with no main at all, so what it POSTS can be read directly. */
function loneReplica(origin = 'pane2'): {
  readonly store: ShellStateStore;
  readonly sent: readonly unknown[];
  deliver(message: unknown): void;
} {
  const recording = createRecordingPort();
  const store = createReplicaStore({ port: recording.port, origin });
  return { store, sent: recording.sent, deliver: recording.deliver };
}

/**
 * A commit as main would send it: the operation, plus main's whole context
 * after applying it.
 */
function commitOf(seq: number, selected: string, origin = 'pane2'): unknown {
  return {
    type: 'commit',
    protocol: PROTOCOL_VERSION,
    origin,
    seq,
    op: { kind: 'patch-context', patch: { selectedItemIds: [selected] } },
    context: {
      activeExtensionId: null,
      activeNavNodeId: null,
      selectedItemId: selected,
      selectedItemIds: [selected],
      contextKeys: {},
    } as RibbonContext,
  };
}

/** The operations a replica posted, in order. */
function operations(sent: readonly unknown[]): unknown[] {
  return sent.map((message) => (message as WriteMessage).op);
}

describe('ReplicaStore — property 1: getContext stays synchronous', () => {
  it('reads back a write on the very next statement, with no await anywhere', () => {
    const pane = loneReplica();
    pane.store.setSelectedItem('row-1');
    // Not a promise, not a tick later, not a subscription. The same statement
    // sequence a single-process extension has always written.
    expect(pane.store.getContext().selectedItemId).toBe('row-1');
    expect(pane.store.getContext().selectedItemIds).toEqual(['row-1']);
  });

  it('raises INVALID_FIELD synchronously, with the identical code and field', () => {
    const pane = loneReplica();
    let raised: ShellUXError | null = null;
    try {
      pane.store.setSelectedItem(42 as never);
    } catch (error) {
      raised = error as ShellUXError;
    }
    expect(raised).toBeInstanceOf(ShellUXError);
    expect(raised?.code).toBe('INVALID_FIELD');
    expect(raised?.field).toBe('id');
    // And a refused write is not traffic.
    expect(pane.sent).toEqual([]);
  });

  it('raises PAYLOAD_TOO_LARGE synchronously and posts nothing', () => {
    const pane = loneReplica();
    const tooMany = Array.from({ length: 4_097 }, (_unused, index) => `row-${String(index)}`);
    expect(() => {
      pane.store.setSelectedItems(tooMany);
    }).toThrow(ShellUXError);
    expect(pane.sent).toEqual([]);
  });

  it('posts nothing at all for a write that changed nothing', () => {
    const pane = loneReplica();
    pane.store.setSelectedItem('row-1');
    expect(pane.sent).toHaveLength(1);
    // The store's own identity bail-out, read back rather than re-derived.
    pane.store.setSelectedItem('row-1');
    expect(pane.sent).toHaveLength(1);
  });

  it('keeps a plug-in listener synchronous through useSyncExternalStore’s contract', () => {
    const pane = loneReplica();
    const seen: (string | null)[] = [];
    const unsubscribe = pane.store.subscribe(() => {
      seen.push(pane.store.getContext().selectedItemId);
    });
    pane.store.setSelectedItem('row-1');
    expect(seen).toEqual(['row-1']);
    unsubscribe();
    pane.store.setSelectedItem('row-2');
    expect(seen).toEqual(['row-1']);
  });
});

describe('ReplicaStore — what reaches the wire is host-owned', () => {
  it('posts the values its own store kept, not the caller’s object read a second time', () => {
    const pane = loneReplica();
    let reads = 0;
    // A patch that answers differently every time it is read. `applyPatch` reads
    // it exactly once; a design that posted the caller's object would have
    // handed main the SECOND answer.
    const shifty = {
      get activeNavNodeId(): string {
        reads += 1;
        return reads === 1 ? 'inbox' : 'drafts';
      },
    };
    pane.store.patchContext(shifty);

    expect(pane.store.getContext().activeNavNodeId).toBe('inbox');
    expect(operations(pane.sent)).toEqual([
      { kind: 'patch-context', patch: { activeNavNodeId: 'inbox' } },
    ]);
  });

  it('posts only the fields that moved', () => {
    const pane = loneReplica();
    pane.store.patchContext({ activeExtensionId: 'mail', activeNavNodeId: 'inbox' });
    pane.store.patchContext({ activeExtensionId: 'mail', activeNavNodeId: 'drafts' });

    expect(operations(pane.sent)[1]).toEqual({
      kind: 'patch-context',
      patch: { activeNavNodeId: 'drafts' },
    });
  });

  it('posts the CLAMPED metric value, so both processes store the same number', () => {
    const pane = loneReplica();
    pane.store.setNavMetric('mail', 'inbox', 1.4);
    expect(pane.store.getNavMetric('mail', 'inbox')).toBe(1);
    expect(operations(pane.sent)).toEqual([
      { kind: 'set-nav-metric', extensionId: 'mail', nodeId: 'inbox', value: 1 },
    ]);
  });

  it('posts a badge, a context key and a clear as operations of their own', () => {
    const pane = loneReplica();
    pane.store.setBadgeCount('mail', 'inbox', 3);
    pane.store.setContextKey('mail', 'loaded', true);
    pane.store.clearContextKeys();

    expect(operations(pane.sent)).toEqual([
      { kind: 'set-badge-count', extensionId: 'mail', nodeId: 'inbox', count: 3 },
      { kind: 'set-context-key', extensionId: 'mail', key: 'loaded', value: true },
      { kind: 'clear-context-keys' },
    ]);
    expect(pane.store.getBadgeCount('mail', 'inbox')).toBe(3);
  });

  it('numbers its writes monotonically and declares this protocol version', () => {
    const pane = loneReplica('pane3');
    pane.store.setSelectedItem('a');
    pane.store.setSelectedItem('b');
    expect(pane.sent).toEqual([
      expect.objectContaining({ type: 'write', protocol: PROTOCOL_VERSION, origin: 'pane3', seq: 1 }),
      expect.objectContaining({ type: 'write', protocol: PROTOCOL_VERSION, origin: 'pane3', seq: 2 }),
    ]);
  });
});

describe('ReplicaStore — property 2: the null prototype does not survive the wire', () => {
  it('re-creates the null prototype a structured clone strips off the context keys', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    paneTwo.store.patchContext({ activeExtensionId: 'mail' });
    paneTwo.store.setContextKey('mail', 'loaded', true);
    board.settle();

    const paneThree = board.pane('pane3');
    board.settle();

    // The record main built had no prototype; what crossed the port has
    // `Object.prototype` — proven directly in `portLike.test.ts`. What the
    // replica HOLDS has none again, because the commit is applied through
    // `patchContext`, whose `normalizeContextKeys` rebuilds the record.
    for (const store of [paneTwo.store, paneThree.store]) {
      const { contextKeys } = store.getContext();
      expect(contextKeys.loaded).toBe(true);
      expect(Object.getPrototypeOf(contextKeys)).toBeNull();
      expect(Object.isFrozen(contextKeys)).toBe(true);
    }
  });

  it('cannot be polluted by a __proto__ key arriving over the wire', () => {
    const pane = loneReplica();
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });

    // Refused at the identifier allowlist before the record is ever built. The
    // rejection raises out of the port callback rather than being swallowed —
    // see `receive`'s docblock: a message main could not have sent is a forged
    // one, and there is nothing in this realm to report it to.
    expect(() => {
      pane.deliver({
        type: 'resync',
        protocol: PROTOCOL_VERSION,
        context: { contextKeys: hostile } as unknown as RibbonContext,
      });
    }).toThrow(ShellUXError);

    expect(Object.getPrototypeOf(pane.store.getContext().contextKeys)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('ReplicaStore — property 3 preface: echo suppression', () => {
  it('suppresses its own echo, so a commit for an earlier write does not clobber a later one', () => {
    const pane = loneReplica();

    // Two writes, neither committed yet — the user selected a row and then
    // selected another before the host answered.
    pane.store.setSelectedItem('row-1');
    pane.store.setSelectedItem('row-2');
    expect(pane.store.getContext().selectedItemId).toBe('row-2');

    // Main commits the FIRST write. The second is still in flight, so this
    // replica is still ahead of main and its own optimistic value is the better
    // answer. Applying this commit is the defect: the pane would flicker back to
    // `row-1` on every write it makes.
    pane.deliver(commitOf(1, 'row-1'));
    expect(pane.store.getContext().selectedItemId).toBe('row-2');

    // The second commit levels it, and now the authoritative context IS applied
    // even though this replica originated the write.
    pane.deliver(commitOf(2, 'row-2'));
    expect(pane.store.getContext().selectedItemId).toBe('row-2');
  });

  it('applies its own commit once it is level, even when main ordered another renderer first', () => {
    const pane = loneReplica();
    pane.store.setSelectedItem('mine');

    // Main put another renderer's write after this one, so the authoritative
    // answer is not what this replica optimistically holds. Nothing is in
    // flight any more, so the commit is applied rather than suppressed.
    pane.deliver(commitOf(1, 'theirs'));
    expect(pane.store.getContext().selectedItemId).toBe('theirs');
  });

  it('does not notify twice for a badge it wrote itself', () => {
    const board = shell();
    const pane = board.pane('pane2');
    const listener = vi.fn();
    pane.store.subscribe(listener);

    pane.store.setBadgeCount('mail', 'inbox', 3);
    expect(listener).toHaveBeenCalledTimes(1);

    board.settle();
    // The commit came back and was suppressed, so the badge write woke this
    // pane's subscribers exactly once rather than once per hop.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pane.store.getBadgeCount('mail', 'inbox')).toBe(3);
  });

  it('converges on main once it is level, even for a write of its own', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');

    // Two renderers write the same field before either commit is delivered.
    paneTwo.store.setSelectedItem('from-pane-2');
    paneThree.store.setSelectedItem('from-pane-3');
    board.settle();

    // Main decided the order; both replicas hold main's answer, including the
    // one whose own optimistic value lost.
    const authoritative = board.main.getContext().selectedItemId;
    expect(paneTwo.store.getContext().selectedItemId).toBe(authoritative);
    expect(paneThree.store.getContext().selectedItemId).toBe(authoritative);
  });

  it('replicates another renderer’s badge and nav metric, which the context cannot carry', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');

    paneTwo.store.setBadgeCount('mail', 'inbox', 7);
    paneTwo.store.setNavMetric('mail', 'inbox', 0.5);
    board.settle();

    expect(paneThree.store.getBadgeCount('mail', 'inbox')).toBe(7);
    expect(paneThree.store.getNavMetric('mail', 'inbox')).toBe(0.5);
  });

  it('replicates a cleared badge, a replaced navigation tree and a purged scope', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');

    const nodes = [{ id: 'inbox', label: 'Inbox' }];
    paneTwo.store.setBadgeCount('mail', 'inbox', 7);
    paneTwo.store.setNavigationTree('mail', nodes);
    board.settle();
    expect(paneThree.store.getNavigationTree('mail')).toEqual(nodes);

    paneTwo.store.clearBadge('mail', 'inbox');
    board.settle();
    expect(paneThree.store.getBadgeCount('mail', 'inbox')).toBeUndefined();

    paneTwo.store.setBadgeCount('mail', 'inbox', 2);
    paneTwo.store.purgeScope('mail');
    board.settle();
    expect(paneThree.store.getBadgeCount('mail', 'inbox')).toBeUndefined();
    expect(paneThree.store.getNavigationTree('mail')).toBeUndefined();
    expect(board.violations).toEqual([]);
  });

  it("lets any holder of the store purge another extension's scope, across the wire too", () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');
    // Pane 2's extension writes its badge; pane 3 — any other holder — purges
    // that scope, and main and pane 2 apply it. Nothing checks who owns a scope.
    paneTwo.store.setBadgeCount('mail', 'inbox', 7);
    board.settle();
    paneThree.store.purgeScope('mail');
    board.settle();
    expect(board.main.getBadgeCount('mail', 'inbox')).toBeUndefined();
    expect(paneTwo.store.getBadgeCount('mail', 'inbox')).toBeUndefined();
    expect(board.violations).toEqual([]);
  });

  it('posts the normalised tree it kept, not the caller’s array', () => {
    const pane = loneReplica();
    const nodes = [{ id: 'inbox', label: 'Inbox', stray: 'dropped' }];
    pane.store.setNavigationTree('mail', nodes);
    // The port structured-clones, so identity cannot be asserted across it; the
    // key the normaliser does not copy is the witness that what crossed was the
    // replica's own copy.
    const posted = operations(pane.sent)[0] as { nodes: unknown };
    expect(posted.nodes).toEqual([{ id: 'inbox', label: 'Inbox' }]);
  });

  it('replicates a foreground handover, keys and all', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');

    paneTwo.store.patchContext({ activeExtensionId: 'mail' });
    paneTwo.store.setContextKey('mail', 'loaded', true);
    board.settle();
    expect(paneThree.store.getContext().contextKeys.loaded).toBe(true);

    paneTwo.store.clearContextKeys();
    paneTwo.store.patchContext({ activeExtensionId: 'database', contextKeys: {} });
    board.settle();

    expect(Object.keys(paneThree.store.getContext().contextKeys)).toEqual([]);
    expect(paneThree.store.getContext().activeExtensionId).toBe('database');
  });
});

describe('ReplicaStore — the three contract corrections', () => {
  it('a listener runs before the writing statement returns, within the writing renderer', () => {
    const pane = loneReplica();
    let observedInsideTheWrite: string | null = null;
    pane.store.subscribe(() => {
      observedInsideTheWrite = pane.store.getContext().selectedItemId;
    });

    pane.store.setSelectedItem('row-1');
    // Unchanged from the single-process claim, and it is still true. The
    // correction is about its SCOPE, not about whether it holds.
    expect(observedInsideTheWrite).toBe('row-1');
  });

  it('a listener in another renderer does not run before the writing statement returns, and cannot throw into it', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');

    paneThree.store.subscribe(() => {
      throw new TypeError('pane 3 does not like this write');
    });

    // In one process this listener would run inside pane 2's frame and its
    // throw would arrive here. Across the boundary it does neither.
    expect(() => {
      paneTwo.store.setSelectedItem('row-1');
    }).not.toThrow();
    expect(paneThree.store.getContext().selectedItemId).toBeNull();

    // It runs later, in its own realm, when the commit is delivered — and the
    // throw belongs to that realm.
    expect(() => {
      board.settle();
    }).toThrow(TypeError);
  });

  it('two replicas hold different snapshots between a write and its commit, and converge on it', () => {
    const board = shell();
    const paneTwo = board.pane('pane2');
    const paneThree = board.pane('pane3');

    paneTwo.store.setSelectedItem('row-1');

    // SKEW, not tearing: neither pane is internally inconsistent, and each is
    // showing one coherent snapshot. §5 says to state this and not fix it.
    expect(paneTwo.store.getContext().selectedItemId).toBe('row-1');
    expect(paneThree.store.getContext().selectedItemId).toBeNull();

    board.settle();
    expect(paneThree.store.getContext().selectedItemId).toBe('row-1');
  });

  it('is not where REVOKED lives, and does not pretend to be', () => {
    const pane = loneReplica();
    // `ShellStateStore` has no revocation member and this replica adds none:
    // the latch stays on `createRevocableShellAPI`, in the same realm as the
    // caller, and the authoritative half is the pane teardown. Correction 2.
    expect(Object.keys(pane.store).sort()).toEqual(
      [
        'clearBadge',
        'clearContextKeys',
        'getBadgeCount',
        'getContext',
        'getNavMetric',
        'getNavigationTree',
        'patchContext',
        'purgeScope',
        'setActiveNavNode',
        'setBadgeCount',
        'setContextKey',
        'setNavMetric',
        'setNavigationTree',
        'setSelectedItem',
        'setSelectedItems',
        'subscribe',
      ].sort(),
    );
    expect(Object.isFrozen(pane.store)).toBe(true);
  });
});

describe('ReplicaStore — inbound messages from main', () => {
  it('installs the opening snapshot', () => {
    const pane = loneReplica();
    pane.deliver({
      type: 'resync',
      protocol: PROTOCOL_VERSION,
      context: { activeExtensionId: 'mail', activeNavNodeId: 'inbox' } as RibbonContext,
    });
    expect(pane.store.getContext().activeExtensionId).toBe('mail');
    // Installing a snapshot is not a local write and is not echoed back.
    expect(pane.sent).toEqual([]);
  });

  it('retires a refused write, so the replica does not go permanently blind', () => {
    const pane = loneReplica();
    pane.store.setSelectedItem('row-1');

    pane.deliver({
      type: 'refused',
      protocol: PROTOCOL_VERSION,
      origin: 'pane2',
      seq: 1,
      code: 'INVALID_FIELD',
      message: 'refused',
    });

    // With the entry retired, the next commit is applied rather than suppressed.
    pane.deliver({
      type: 'commit',
      protocol: PROTOCOL_VERSION,
      origin: '__main__',
      seq: 1,
      op: { kind: 'patch-context', patch: { activeNavNodeId: 'drafts' } },
      context: { activeNavNodeId: 'drafts' } as RibbonContext,
    });
    expect(pane.store.getContext().activeNavNodeId).toBe('drafts');
  });

  it('stops posting once main says it has been throttled, and keeps working locally', () => {
    const pane = loneReplica();
    pane.deliver({
      type: 'throttled',
      protocol: PROTOCOL_VERSION,
      origin: 'pane2',
      limit: 64,
      windowMs: 1_000,
    });

    pane.store.setSelectedItem('row-1');

    // The pane still renders — refusing local writes would break it a second
    // way — it simply stops spending the host's message budget.
    expect(pane.store.getContext().selectedItemId).toBe('row-1');
    expect(pane.sent).toEqual([]);
  });

  const ignored: readonly (readonly [string, unknown])[] = [
    ['a primitive', 'not-a-message'],
    ['null', null],
    [
      'a message from another protocol version',
      { type: 'resync', protocol: 99, context: { activeNavNodeId: 'inbox' } },
    ],
    ['a message type this replica does not handle', { type: 'write', protocol: PROTOCOL_VERSION }],
    ['a type that names a prototype member', { type: 'toString', protocol: PROTOCOL_VERSION }],
  ];

  it.each(ignored)('drops %s without touching the replica', (_label, message) => {
    const pane = loneReplica();
    pane.store.setSelectedItem('row-1');
    pane.deliver(message);
    expect(pane.store.getContext().selectedItemId).toBe('row-1');
  });
});
