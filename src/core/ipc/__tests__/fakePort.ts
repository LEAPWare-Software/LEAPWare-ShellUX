import type { PortLike } from '../PortLike';

/**
 * ============================================================================
 * THE FAKE TRANSPORT, AND THE ONE THING IT MUST NOT MAKE EASY
 * ============================================================================
 * Everything under `src/core/ipc/**` is written against `PortLike`, so a fake
 * port is what lets the whole cross-process state design be proven in one jsdom
 * process. The risk that comes with that is precise: **a fake that hands the
 * same object reference to the other end proves the design for a transport that
 * does not exist.** A retained prototype, a live getter, a shared mutable array,
 * a React component that "crosses" because nothing ever tried to serialize it —
 * every one of those is invisible to a fake that just calls the peer's handler.
 *
 * So every port here calls the platform `structuredClone`, which is what a real
 * `MessagePortMain` does. It strips a null prototype, it refuses a function, and
 * it copies rather than shares — the three properties the design has to survive.
 *
 * This file is under `__tests__`, so it is outside the coverage gate, outside
 * `src/__tests__/noEventListener.test.ts`'s module scan, and never shipped.
 * ============================================================================
 */

/** A port that keeps what was posted through it, with no peer at all. */
export interface RecordingPort {
  readonly port: PortLike;
  /** Every message posted, cloned exactly as a real port would clone it. */
  readonly sent: readonly unknown[];
  /** Deliver `message` to whoever is reading this port, as main would. */
  deliver(message: unknown): void;
}

/**
 * A port with no peer, for testing one end in isolation.
 *
 * `deliver` clones too: a test that hands a store an object it still holds a
 * reference to would be testing a transport nobody has.
 */
export function createRecordingPort(): RecordingPort {
  const sent: unknown[] = [];
  const port: PortLike = {
    postMessage(message: unknown): void {
      sent.push(structuredClone(message));
    },
    onmessage: null,
  };
  return {
    port,
    sent,
    deliver(message: unknown): void {
      port.onmessage?.(structuredClone(message));
    },
  };
}

/** Two ports wired to each other, delivering synchronously. */
export interface PortPair {
  readonly left: PortLike;
  readonly right: PortLike;
  /** Messages that have crossed in either direction. */
  crossed(): number;
}

/**
 * Create a connected pair.
 *
 * **Delivery is synchronous and re-entrant**, which is deliberately the harshest
 * in-process model of a message channel: a handler that writes back runs inside
 * the original `postMessage`. A cross-process loop therefore shows up here as
 * unbounded recursion rather than as an unbounded queue, which is easier to
 * observe and impossible to mistake for slowness.
 *
 * `cap` is what stops a test that finds a real defect from hanging the suite
 * instead of failing it. A run that exceeds it throws, naming the cap.
 */
export function createPortPair(cap = 512): PortPair {
  let crossed = 0;

  const spend = (): void => {
    crossed += 1;
    if (crossed > cap) {
      throw new Error(
        `fake port pair: ${String(crossed)} messages crossed, past the cap of ${String(cap)}. Something is looping.`,
      );
    }
  };

  // Both ends are built before either is referenced, so neither closure has to
  // name the other by a binding that does not exist yet.
  const ends: PortLike[] = [];
  const endTowards = (peer: number): PortLike => ({
    postMessage(message: unknown): void {
      spend();
      // Cloned UNCONDITIONALLY, before delivery is even attempted. A real port
      // serializes on post whether or not the other end is reading, and a fake
      // that cloned inside the delivery call would quietly stop refusing an
      // unserializable message the moment nobody was listening — which is
      // exactly the case a test of "this cannot cross" sets up.
      const delivered = structuredClone(message);
      ends[peer]?.onmessage?.(delivered);
    },
    onmessage: null,
  });

  const left = endTowards(1);
  const right = endTowards(0);
  ends.push(left, right);

  return { left, right, crossed: (): number => crossed };
}

/** Two ports wired to each other, delivering only when told to. */
export interface QueuedPortPair extends PortPair {
  /** Deliver everything queued, and everything queued while delivering. */
  flush(): void;
  /** How many messages are waiting. */
  waiting(): number;
}

/**
 * Create a pair that QUEUES.
 *
 * The synchronous pair above is the harsher model and is what a storm test
 * wants; this one is what a test of ORDER wants. Optimistic-local writes,
 * echo suppression and the skew between two renderers are all statements about
 * the interval between a write and its commit, and a transport with no such
 * interval cannot express them.
 */
export function createQueuedPortPair(cap = 512): QueuedPortPair {
  let crossed = 0;
  const queue: { readonly to: number; readonly message: unknown }[] = [];
  const ends: PortLike[] = [];

  const endTowards = (peer: number): PortLike => ({
    postMessage(message: unknown): void {
      crossed += 1;
      if (crossed > cap) {
        throw new Error(
          `fake port pair: ${String(crossed)} messages crossed, past the cap of ${String(cap)}. Something is looping.`,
        );
      }
      queue.push({ to: peer, message: structuredClone(message) });
    },
    onmessage: null,
  });

  const left = endTowards(1);
  const right = endTowards(0);
  ends.push(left, right);

  return {
    left,
    right,
    crossed: (): number => crossed,
    waiting: (): number => queue.length,
    flush(): void {
      while (queue.length > 0) {
        const next = queue.shift();
        ends[next?.to ?? 0]?.onmessage?.(next?.message);
      }
    },
  };
}
