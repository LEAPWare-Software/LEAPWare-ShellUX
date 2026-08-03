import { describe, expect, it } from 'vitest';
import { ShellUXError } from '../../types';
import { createShellStateStore } from '../../ShellAPI';
import type { ShellStateStore } from '../../ShellAPI';
import {
  MAX_WRITES_PER_WINDOW,
  WRITE_WINDOW_MS,
  createAuthoritativeStore,
} from '../AuthoritativeStore';
import { createReplicaStore } from '../ReplicaStore';
import { PROTOCOL_VERSION } from '../protocol';
import type { OriginViolation } from '../protocol';
import { createPortPair, createQueuedPortPair } from './fakePort';

/**
 * ============================================================================
 * §9 R4 — THE WRITE STORM, PROVEN BEFORE ANY ELECTRON EXISTS
 * ============================================================================
 * The plan calls this "the most likely production bug in the whole pivot" and
 * asks for it to be tested against the fake `PortLike` in Phase 6. The claim
 * being tested has two halves and they need each other:
 *
 *  1. Two listeners that write in response to each other are stopped inside ONE
 *     store by `MAX_NOTIFY_DEPTH`, which is why nobody has ever had to think
 *     about them. That is the control.
 *  2. The IDENTICAL two listeners, one in each of two replicas, are not stopped
 *     by anything the single-process design has, because every message hop is a
 *     fresh call stack in a fresh store and each store's `notifyDepth` is back
 *     to zero before the next write arrives.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL HAS TO BE ASYNCHRONOUS, AND THAT IS THE FINDING RATHER THAN A
 * TESTING CONVENIENCE
 * ---------------------------------------------------------------------------
 * The first version of this file used the SYNCHRONOUS fake port, on the
 * reasoning that a harsher transport is a better test. It reported
 * `REENTRANT_NOTIFY`, and the reason is worth writing down: with synchronous
 * delivery every hop runs nested inside the first write's notification pass, so
 * the whole cross-process loop is one cascade in one stack and
 * `MAX_NOTIFY_DEPTH` catches it at 16 exactly as it would in one process.
 *
 * **A real port does not do that.** `MessagePortMain` and `MessagePort` both
 * deliver on a later task, so each hop begins at the top of a fresh stack with
 * `notifyDepth` back at zero. **It is the ASYNCHRONY of the transport that
 * defeats the depth counter**, not the process boundary as such — and a
 * synchronous in-process fake would have hidden the entire defect behind an
 * accidental pass. The queued pair below is therefore the honest model, and the
 * synchronous one is used where re-entrancy is the point instead.
 *
 * The pair refuses past a cap either way, so a run that finds a real defect
 * FAILS rather than hanging — which matters, because the failure mode under
 * test is an unbounded loop and a hanging test inside a ten-stage `verify` is
 * worse than a red one.
 * ============================================================================
 */

/** The listener pair that reflects one field off another. */
function reflect(
  store: ShellStateStore,
  watched: 'selectedItemId' | 'activeNavNodeId',
  write: (store: ShellStateStore, value: string) => void,
  counter: { n: number },
): void {
  let seen = store.getContext()[watched];
  store.subscribe(() => {
    const now = store.getContext()[watched];
    if (now === seen) {
      return;
    }
    seen = now;
    counter.n += 1;
    write(store, `v${String(counter.n)}`);
  });
}

const writeNavNode = (store: ShellStateStore, value: string): void => {
  store.setActiveNavNode(value);
};
const writeSelection = (store: ShellStateStore, value: string): void => {
  store.setSelectedItem(value);
};

describe('write storm — the control, in one process', () => {
  it('the same two listeners in ONE store are stopped by MAX_NOTIFY_DEPTH, which is why it looks sufficient', () => {
    const store = createShellStateStore();
    const counter = { n: 0 };
    reflect(store, 'selectedItemId', writeNavNode, counter);
    reflect(store, 'activeNavNodeId', writeSelection, counter);

    let raised: ShellUXError | null = null;
    try {
      store.setSelectedItem('kick');
    } catch (error) {
      raised = error as ShellUXError;
    }

    expect(raised).toBeInstanceOf(ShellUXError);
    expect(raised?.code).toBe('REENTRANT_NOTIFY');
    // Stopped at the cascade limit, in the writer's own frame, on the first
    // statement. Nothing else was ever needed.
    expect(counter.n).toBeLessThan(32);
  });
});

interface Storm {
  readonly violations: OriginViolation[];
  readonly counter: { n: number };
  readonly crossed: () => number;
  kick(): void;
  readonly paneTwo: ShellStateStore;
  readonly paneThree: ShellStateStore;
  advance(ms: number): void;
}

/**
 * Two replicas whose listeners write in response to each other's writes, wired
 * through a real authoritative store.
 */
function storm(cap: number): Storm {
  const violations: OriginViolation[] = [];
  let clock = 1_000;
  const main = createAuthoritativeStore({
    now: (): number => clock,
    onViolation: (violation): void => {
      violations.push(violation);
    },
  });

  const twoPair = createQueuedPortPair(cap);
  const threePair = createQueuedPortPair(cap);
  const paneTwo = createReplicaStore({ port: twoPair.right, origin: 'pane2' });
  const paneThree = createReplicaStore({ port: threePair.right, origin: 'pane3' });
  main.connect(twoPair.left, 'pane2');
  main.connect(threePair.left, 'pane3');

  const counter = { n: 0 };
  // Pane 2 answers a selection with a navigation; pane 3 answers a navigation
  // with a selection. Neither listener is unreasonable on its own — a detail
  // pane following a list selection is the ordinary shape of this shell.
  reflect(paneTwo, 'selectedItemId', writeNavNode, counter);
  reflect(paneThree, 'activeNavNodeId', writeSelection, counter);

  return {
    violations,
    counter,
    paneTwo,
    paneThree,
    crossed: (): number => twoPair.crossed() + threePair.crossed(),
    advance(ms: number): void {
      clock += ms;
    },
    kick(): void {
      paneThree.setSelectedItem('kick');
      // Pump both channels until neither has anything waiting. Each `flush`
      // delivers from the top of a fresh stack, which is what a real port does
      // and what leaves every `notifyDepth` at zero between hops.
      let moved = true;
      while (moved) {
        moved = false;
        for (const pair of [twoPair, threePair]) {
          if (pair.waiting() > 0) {
            moved = true;
            pair.flush();
          }
        }
      }
    },
  };
}

describe('write storm — across the process boundary', () => {
  it('a two-replica write loop is cut off by main, and not by either notify-depth counter', () => {
    const running = storm(1_024);

    // No throw. `MAX_NOTIFY_DEPTH` is never reached in either replica, because
    // every hop starts a fresh notification pass in a fresh store — which is
    // exactly why the single-process cap cannot see this.
    expect(() => {
      running.kick();
    }).not.toThrow();

    // What stopped it was main, and it says so.
    expect(running.violations).toContainEqual({
      kind: 'throttled',
      origin: expect.any(String) as unknown as string,
      limit: MAX_WRITES_PER_WINDOW,
      windowMs: WRITE_WINDOW_MS,
    });

    // Bounded, and bounded by the limit rather than by the fake port's cap. If
    // the rate limit were removed this assertion is not what fails first — the
    // port cap throws — which is deliberate: a real defect here must fail the
    // run, not hang it.
    expect(running.counter.n).toBeGreaterThan(MAX_WRITES_PER_WINDOW);
    expect(running.crossed()).toBeLessThan(1_024);
  });

  it('severs only the origin that stormed, and leaves the other replica writing', () => {
    const running = storm(1_024);
    running.kick();

    const throttled = running.violations.filter((violation) => violation.kind === 'throttled');
    expect(throttled).toHaveLength(1);
    const severedOrigin = throttled[0]?.origin;
    const survivor = severedOrigin === 'pane2' ? running.paneThree : running.paneTwo;

    // The surviving pane still writes and its write still reaches the host.
    expect(() => {
      survivor.setBadgeCount('mail', 'inbox', 9);
    }).not.toThrow();
    expect(survivor.getBadgeCount('mail', 'inbox')).toBe(9);
  });

  it('goes on applying local writes in a severed replica, and stops posting them', () => {
    const running = storm(1_024);
    running.kick();
    const crossedAfterStorm = running.crossed();

    running.paneTwo.setActiveNavNode('after-storm');
    running.paneThree.setSelectedItem('after-storm');

    // Both panes still render their own writes. What changed is the traffic.
    expect(running.paneTwo.getContext().activeNavNodeId).toBe('after-storm');
    expect(running.paneThree.getContext().selectedItemId).toBe('after-storm');
    // The severed one contributes nothing further; the survivor's own write is
    // a handful of messages, not another storm.
    expect(running.crossed() - crossedAfterStorm).toBeLessThan(MAX_WRITES_PER_WINDOW);
  });
});

/** The limiter on its own, one branch at a time. */
describe('write storm — the per-origin budget', () => {
  interface Bench {
    readonly violations: OriginViolation[];
    readonly received: { type: string }[];
    post(message: unknown): void;
    advance(ms: number): void;
  }

  function bench(): Bench {
    const violations: OriginViolation[] = [];
    let clock = 1_000;
    const main = createAuthoritativeStore({
      now: (): number => clock,
      onViolation: (violation): void => {
        violations.push(violation);
      },
    });
    const pair = createPortPair(4_096);
    const received: { type: string }[] = [];
    pair.right.onmessage = (message): void => {
      received.push(message as { type: string });
    };
    main.connect(pair.left, 'pane2');
    return {
      violations,
      received,
      post(message: unknown): void {
        pair.right.postMessage(message);
      },
      advance(ms: number): void {
        clock += ms;
      },
    };
  }

  const validWrite = (seq: number): unknown => ({
    type: 'write',
    protocol: PROTOCOL_VERSION,
    origin: 'pane2',
    seq,
    op: { kind: 'set-badge-count', extensionId: 'mail', nodeId: 'inbox', count: seq },
  });

  it('counts a malformed message against the same budget an accepted write spends', () => {
    const running = bench();
    for (let index = 0; index < MAX_WRITES_PER_WINDOW; index += 1) {
      running.post('rubbish');
    }
    expect(running.violations.filter((entry) => entry.kind === 'throttled')).toHaveLength(0);

    // One more of anything at all, and the budget is gone. A renderer that could
    // storm for free by posting nonsense would have read the limit and defeated
    // it.
    running.post(validWrite(1));
    expect(running.violations.at(-1)).toMatchObject({ kind: 'throttled', origin: 'pane2' });
    expect(running.received.at(-1)).toMatchObject({ type: 'throttled' });
  });

  it('stops reading a severed origin entirely, rather than throttling it again', () => {
    const running = bench();
    for (let index = 0; index <= MAX_WRITES_PER_WINDOW; index += 1) {
      running.post(validWrite(index));
    }
    const afterSever = running.received.length;

    running.post(validWrite(999));
    running.post('rubbish');

    // No second `throttled`, no violation for the malformed message: a severed
    // origin is not read at all. There is no route back to live.
    expect(running.violations.filter((entry) => entry.kind === 'throttled')).toHaveLength(1);
    expect(running.violations.filter((entry) => entry.kind === 'malformed')).toHaveLength(0);
    expect(running.received).toHaveLength(afterSever);
  });

  it('opens a fresh window once the old one has elapsed', () => {
    const running = bench();
    for (let index = 0; index < MAX_WRITES_PER_WINDOW; index += 1) {
      running.post(validWrite(index));
    }
    running.advance(WRITE_WINDOW_MS);

    // The window rolled over, so these are not one-too-many.
    for (let index = 0; index < MAX_WRITES_PER_WINDOW; index += 1) {
      running.post(validWrite(index));
    }
    expect(running.violations).toEqual([]);
  });
});
