import { describe, expect, it, vi } from 'vitest';
import { createAuthoritativeStore } from '../AuthoritativeStore';
import type { AuthoritativeStore } from '../AuthoritativeStore';
import { MAIN_ORIGIN, PROTOCOL_VERSION } from '../protocol';
import type { HostMessage, OriginViolation, StoreOperation } from '../protocol';
import { createPortPair } from './fakePort';
import type { PortPair } from './fakePort';

/**
 * Main's end. The claim under test throughout is the one §5 makes in four words
 * — **a renderer is not trusted** — plus the mechanics that make a commit
 * reach everybody exactly once.
 */

interface Harness {
  readonly main: AuthoritativeStore;
  readonly violations: OriginViolation[];
  /** Attach a renderer end and record everything main sends it. */
  attach(origin: string): Renderer;
  /** Advance the injected clock. */
  advance(ms: number): void;
}

interface Renderer {
  readonly received: HostMessage[];
  readonly pair: PortPair;
  /** Post a raw message at main, bypassing any replica. */
  post(message: unknown): void;
  /** Post a well-formed write, bypassing any replica. */
  write(seq: number, op: StoreOperation, origin?: string): void;
  disconnect(): void;
}

function harness(): Harness {
  const violations: OriginViolation[] = [];
  let clock = 1_000;
  const main = createAuthoritativeStore({
    now: (): number => clock,
    onViolation: (violation): void => {
      violations.push(violation);
    },
  });

  return {
    main,
    violations,
    advance(ms: number): void {
      clock += ms;
    },
    attach(origin: string): Renderer {
      const pair = createPortPair();
      const received: HostMessage[] = [];
      pair.right.onmessage = (message): void => {
        received.push(message as HostMessage);
      };
      const disconnect = main.connect(pair.left, origin);
      return {
        received,
        pair,
        post(message: unknown): void {
          pair.right.postMessage(message);
        },
        write(seq: number, op: StoreOperation, claimed = origin): void {
          pair.right.postMessage({
            type: 'write',
            protocol: PROTOCOL_VERSION,
            origin: claimed,
            seq,
            op,
          });
        },
        disconnect,
      };
    },
  };
}

describe('AuthoritativeStore — connection', () => {
  it('sends the authoritative context as the first thing a replica receives', () => {
    const host = harness();
    host.main.dispatch({ kind: 'patch-context', patch: { activeExtensionId: 'mail' } });

    const pane = host.attach('pane2');

    expect(pane.received).toHaveLength(1);
    expect(pane.received[0]).toMatchObject({
      type: 'resync',
      protocol: PROTOCOL_VERSION,
    });
    expect((pane.received[0] as { context: { activeExtensionId: string } }).context.activeExtensionId).toBe(
      'mail',
    );
  });

  it('stops reading and stops sending once a replica is disconnected', () => {
    const host = harness();
    const pane = host.attach('pane2');
    pane.disconnect();

    pane.write(1, { kind: 'patch-context', patch: { activeNavNodeId: 'inbox' } });
    host.main.dispatch({ kind: 'patch-context', patch: { activeNavNodeId: 'drafts' } });

    // Only the opening resync ever arrived, and the post-disconnect write was
    // not read at all.
    expect(pane.received).toHaveLength(1);
    expect(host.main.getContext().activeNavNodeId).toBe('drafts');
  });

  it('does not post a commit to a replica disconnected earlier in the same broadcast', () => {
    const host = harness();
    const paneTwo = host.attach('pane2');
    const paneThree = host.attach('pane3');

    // Delivery is synchronous, so pane 2's handler runs INSIDE the broadcast
    // loop — before the loop has reached pane 3. Detaching pane 3 there is the
    // case a live-`Set` iteration would get wrong.
    const record = paneTwo.pair.right.onmessage;
    let dropped = false;
    paneTwo.pair.right.onmessage = (message): void => {
      record?.(message);
      if (!dropped) {
        dropped = true;
        paneThree.disconnect();
      }
    };

    paneTwo.write(1, { kind: 'patch-context', patch: { activeNavNodeId: 'inbox' } });

    expect(paneTwo.received.map((message) => message.type)).toEqual(['resync', 'commit']);
    // Pane 3 left the set inside the notification that this very write caused,
    // and the broadcast that followed re-checked membership.
    expect(paneThree.received.map((message) => message.type)).toEqual(['resync']);
  });
});

describe('AuthoritativeStore — main owns truth', () => {
  it('applies its own dispatch and commits it under the main origin', () => {
    const host = harness();
    const pane = host.attach('pane2');

    host.main.dispatch({ kind: 'set-badge-count', extensionId: 'mail', nodeId: 'inbox', count: 3 });

    expect(host.main.getBadgeCount('mail', 'inbox')).toBe(3);
    expect(pane.received[1]).toMatchObject({ type: 'commit', origin: MAIN_ORIGIN, seq: 1 });
  });

  it('raises a dispatch rejection into the host frame instead of reporting it', () => {
    const host = harness();
    expect(() => {
      host.main.dispatch({ kind: 'set-badge-count', extensionId: 'mail', nodeId: 'inbox', count: -1 });
    }).toThrow(/non-negative safe integer/u);
    expect(host.violations).toEqual([]);
  });

  it('reads back a clamped nav metric and notifies its own subscribers', () => {
    const host = harness();
    const listener = vi.fn();
    const unsubscribe = host.main.subscribe(listener);

    host.main.dispatch({ kind: 'set-nav-metric', extensionId: 'mail', nodeId: 'inbox', value: 1.4 });
    expect(host.main.getNavMetric('mail', 'inbox')).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    host.main.dispatch({ kind: 'set-nav-metric', extensionId: 'mail', nodeId: 'inbox', value: 0.5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('applies every operation kind the protocol defines', () => {
    const host = harness();
    host.main.dispatch({ kind: 'patch-context', patch: { activeExtensionId: 'mail' } });
    host.main.dispatch({ kind: 'set-context-key', extensionId: 'mail', key: 'loaded', value: true });
    expect(host.main.getContext().contextKeys.loaded).toBe(true);

    host.main.dispatch({ kind: 'clear-context-keys' });
    host.main.dispatch({ kind: 'patch-context', patch: { contextKeys: {} } });
    expect(Object.keys(host.main.getContext().contextKeys)).toEqual([]);
  });
});

describe('AuthoritativeStore — a renderer is not trusted', () => {
  it('re-validates a write its replica would have refused, and applies none of it', () => {
    const host = harness();
    const pane = host.attach('pane2');

    // No `ReplicaStore` would ever post this: its own copy of the identical
    // validator raises in the caller's frame first. Reaching main means the
    // renderer went round its replica.
    pane.write(7, {
      kind: 'patch-context',
      patch: { selectedItemId: 42 } as never,
    });

    expect(host.main.getContext().selectedItemId).toBeNull();
    expect(host.violations).toEqual([
      {
        kind: 'refused',
        origin: 'pane2',
        seq: 7,
        code: 'INVALID_FIELD',
        message: expect.stringContaining('must be a string or null') as unknown as string,
      },
    ]);
    expect(pane.received[1]).toMatchObject({ type: 'refused', seq: 7, code: 'INVALID_FIELD' });
  });

  it('reports a refusal when a host listener throws, and says so with the write already standing', () => {
    const host = harness();
    const pane = host.attach('pane2');
    let thrown = false;
    host.main.subscribe(() => {
      if (!thrown) {
        thrown = true;
        throw new TypeError('a host listener misbehaved');
      }
    });

    pane.write(1, { kind: 'patch-context', patch: { activeNavNodeId: 'inbox' } });

    // The write STANDS: the store commits before it notifies.
    expect(host.main.getContext().activeNavNodeId).toBe('inbox');
    // And it is reported as a refusal, because that is all this door can see.
    expect(host.violations[0]).toMatchObject({ kind: 'refused', code: 'INVALID_PAYLOAD' });
    expect((host.violations[0] as { message: string }).message).toContain('type "object"');
    // No commit was broadcast, which is the cost named in `accept`'s docblock.
    expect(pane.received.map((message) => message.type)).toEqual(['resync', 'refused']);
  });

  it('polices the origin it bound to the port, not the one a message claims', () => {
    const host = harness();
    const pane = host.attach('pane2');

    pane.write(1, { kind: 'patch-context', patch: { selectedItemId: 42 } as never }, 'pane3');

    // The violation names pane 2 — the port main opened — so a lying renderer
    // cannot make another pane wear its refusals.
    expect(host.violations[0]).toMatchObject({ kind: 'refused', origin: 'pane2' });
    // The refusal sent back carries the claimed origin, because that is what the
    // originator matches against.
    expect(pane.received[1]).toMatchObject({ type: 'refused', origin: 'pane3' });
  });
});

describe('AuthoritativeStore — malformed traffic', () => {
  const cases: readonly (readonly [string, unknown, string])[] = [
    ['a primitive', 'not-a-message', 'of type "string"'],
    ['null', null, 'of type "object"'],
    [
      'a message from another protocol version',
      { type: 'write', protocol: 99, origin: 'pane2', seq: 1, op: { kind: 'clear-context-keys' } },
      'protocol version 99',
    ],
    [
      'a message type a replica may not send',
      { type: 'commit', protocol: PROTOCOL_VERSION, origin: 'pane2', seq: 1 },
      '"commit" is not a message type',
    ],
    [
      'a write with no string origin',
      { type: 'write', protocol: PROTOCOL_VERSION, origin: 7, seq: 1, op: { kind: 'clear-context-keys' } },
      'string origin and an integer sequence',
    ],
    [
      'a write with a fractional sequence number',
      {
        type: 'write',
        protocol: PROTOCOL_VERSION,
        origin: 'pane2',
        seq: 1.5,
        op: { kind: 'clear-context-keys' },
      },
      'string origin and an integer sequence',
    ],
    [
      'a write with no operation',
      { type: 'write', protocol: PROTOCOL_VERSION, origin: 'pane2', seq: 1, op: 'clear' },
      'must carry an operation',
    ],
    [
      'a write whose operation is null',
      { type: 'write', protocol: PROTOCOL_VERSION, origin: 'pane2', seq: 1, op: null },
      'must carry an operation',
    ],
    [
      'a write naming an operation kind this protocol does not define',
      {
        type: 'write',
        protocol: PROTOCOL_VERSION,
        origin: 'pane2',
        seq: 1,
        op: { kind: 'drop-database' },
      },
      'is not an operation this protocol defines',
    ],
  ];

  it.each(cases)('reports and drops %s', (_label, message, fragment) => {
    const host = harness();
    const pane = host.attach('pane2');

    pane.post(message);

    expect(host.violations).toHaveLength(1);
    expect(host.violations[0]).toMatchObject({ kind: 'malformed', origin: 'pane2' });
    expect((host.violations[0] as { message: string }).message).toContain(fragment);
    // Nothing was applied and nothing was sent back.
    expect(pane.received.map((entry) => entry.type)).toEqual(['resync']);
  });

  it('does not let a hostile operation kind reach a prototype member', () => {
    const host = harness();
    const pane = host.attach('pane2');

    // `toString` is a real member of `Object.prototype`. An applier table keyed
    // by an object literal would have found a function here.
    pane.post({
      type: 'write',
      protocol: PROTOCOL_VERSION,
      origin: 'pane2',
      seq: 1,
      op: { kind: 'toString' },
    });

    expect(host.violations[0]).toMatchObject({ kind: 'malformed' });
  });
});
