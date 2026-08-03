import { describe, expect, it } from 'vitest';
import { createPortPair, createRecordingPort } from './fakePort';
import type { PortLike } from '../PortLike';

/**
 * The seam's own tests, and they are about the FAKE as much as about the
 * interface: everything else in this directory is proven against a fake port, so
 * the fake has to be shown to behave like the transport it stands in for. Both
 * facts below are properties of `structuredClone`, which is what a real
 * `MessagePortMain` puts a message through, and both are load-bearing —
 * `ReplicaStore` re-creates a null prototype because of the first, and
 * `manifest.ts` splits a blueprint because of the second.
 */
describe('PortLike — the transport seam', () => {
  it('a port that clones strips the null prototype a host-owned record was built with', () => {
    const pair = createPortPair();
    const received: unknown[] = [];
    pair.right.onmessage = (message): void => {
      received.push(message);
    };

    const hostOwned = Object.create(null) as Record<string, unknown>;
    hostOwned.mode = 'compose';
    // Exactly the shape `RibbonContext.contextKeys` is: a frozen, null-prototype
    // record of primitives.
    expect(Object.getPrototypeOf(hostOwned)).toBeNull();

    pair.left.postMessage({ contextKeys: Object.freeze(hostOwned) });

    const [message] = received as [{ contextKeys: Record<string, unknown> }];
    expect(message.contextKeys.mode).toBe('compose');
    // The guarantee is GONE on arrival. Nothing about the value changed; the
    // prototype did.
    expect(Object.getPrototypeOf(message.contextKeys)).toBe(Object.prototype);
  });

  it('a port that clones refuses a React component reference outright', () => {
    const pair = createPortPair();
    // A pane view is a `ComponentType`, which is a function.
    const PaneView = (): null => null;

    expect(() => {
      pair.left.postMessage({ views: { pane2: PaneView } });
    }).toThrow();
  });

  it('a port that clones copies rather than shares, so a later mutation does not cross', () => {
    const pair = createPortPair();
    const received: { rows: string[] }[] = [];
    pair.right.onmessage = (message): void => {
      received.push(message as { rows: string[] });
    };

    const sent = { rows: ['a'] };
    pair.left.postMessage(sent);
    sent.rows.push('b');

    expect(received[0]?.rows).toEqual(['a']);
  });

  it('drops a message posted to an end nobody is reading, rather than queueing it', () => {
    const pair = createPortPair();
    pair.left.postMessage({ type: 'ignored' });

    const seen: unknown[] = [];
    pair.right.onmessage = (message): void => {
      seen.push(message);
    };
    expect(seen).toEqual([]);
    expect(pair.crossed()).toBe(1);
  });

  it('throws rather than hanging when a loop pushes past the cap', () => {
    const pair = createPortPair(4);
    pair.right.onmessage = (): void => {
      pair.right.postMessage({ pong: true });
    };
    pair.left.onmessage = (): void => {
      pair.left.postMessage({ ping: true });
    };

    expect(() => {
      pair.left.postMessage({ ping: true });
    }).toThrow(/Something is looping/u);
  });

  it('a recording port keeps a clone of what was posted, and delivers a clone back', () => {
    const recording = createRecordingPort();
    const seen: unknown[] = [];
    recording.port.onmessage = (message): void => {
      seen.push(message);
    };

    const outbound = { rows: ['a'] };
    recording.port.postMessage(outbound);
    outbound.rows.push('b');
    expect(recording.sent).toEqual([{ rows: ['a'] }]);

    recording.deliver({ type: 'resync' });
    expect(seen).toEqual([{ type: 'resync' }]);
  });

  it('is satisfied by a two-member object, which is the whole point of it', () => {
    // The eventual `MessagePortMain` adapter is this shape and ten lines of
    // event unwrapping; nothing under `src/` knows more about a port than this.
    const minimal: PortLike = { postMessage: (): void => undefined, onmessage: null };
    expect(Object.keys(minimal)).toEqual(['postMessage', 'onmessage']);
  });
});
