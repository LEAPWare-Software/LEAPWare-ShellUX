import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptMessagePort } from '../main/portAdapter';
import type { MessagePortLike } from '../main/portAdapter';

/**
 * ============================================================================
 * THE ADAPTER THE SEAM PREDICTED, AND THE ONE PREDICTION THAT WAS WRONG.
 * ============================================================================
 * `src/core/ipc/PortLike.ts` wrote this adapter's body in a comment and said it
 * would be *"the only code in the pivot's state design that no unit test
 * covers"*. The body held. The claim about coverage did not, and this file is
 * the reason: `MessagePortMain` is structurally three members, so a fake
 * satisfies it in a few lines and the two facts the adapter exists to absorb —
 * the `MessageEvent` wrapper and the mandatory `start()` — are both directly
 * observable with no Electron imported.
 *
 * `electron/**` is outside the 100% coverage gate, which covers `src/core/**`,
 * `src/components/**` and `src/hooks/**`. So this is tested rather than gated,
 * and the two words are not interchangeable.
 * ============================================================================
 */

/** A `MessagePortMain` as far as the adapter is concerned. */
function makePort(): {
  readonly port: MessagePortLike;
  readonly sent: unknown[];
  readonly started: () => number;
  /** Deliver a message from the other end, in the shape a real port delivers it. */
  readonly deliver: (data: unknown) => void;
} {
  const sent: unknown[] = [];
  let starts = 0;
  let handler: ((event: { readonly data: unknown }) => void) | null = null;

  return {
    port: {
      postMessage: (message: unknown): void => {
        sent.push(message);
      },
      on: (event: 'message', listener: (event: { readonly data: unknown }) => void): unknown => {
        expect(event).toBe('message');
        handler = listener;
        return undefined;
      },
      start: (): void => {
        starts += 1;
      },
    },
    sent,
    started: () => starts,
    deliver: (data: unknown): void => {
      // A real `MessagePortMain` delivers a `MessageEvent`, not the message.
      // Unwrapping that is half of what this adapter is for, so the fake must
      // wrap — a fake that handed the message straight through would make the
      // adapter's own bug invisible.
      if (handler !== null) handler({ data });
    },
  };
}

describe('adaptMessagePort', () => {
  it('starts the port, because a port nobody started delivers nothing', () => {
    const fake = makePort();
    adaptMessagePort(fake.port);
    // `AuthoritativeStore.connect` posts its opening `resync` as its first act.
    // A port started one line late loses the snapshot every replica renders
    // from, on a code path with no error in it.
    expect(fake.started()).toBe(1);
  });

  it('unwraps event.data, so the handler sees the message and not the event', () => {
    const fake = makePort();
    const seam = adaptMessagePort(fake.port);
    const received: unknown[] = [];
    seam.onmessage = (message) => received.push(message);

    fake.deliver({ type: 'commit', protocol: 1 });

    expect(received).toEqual([{ type: 'commit', protocol: 1 }]);
  });

  it('forwards a post straight through', () => {
    const fake = makePort();
    const seam = adaptMessagePort(fake.port);

    seam.postMessage({ type: 'write', seq: 1 });

    expect(fake.sent).toEqual([{ type: 'write', seq: 1 }]);
  });

  it('DROPS a message that arrives before a handler is installed, which is PortLike s documented semantics', () => {
    const fake = makePort();
    const seam = adaptMessagePort(fake.port);
    const received: unknown[] = [];

    fake.deliver('lost');
    seam.onmessage = (message) => received.push(message);
    fake.deliver('kept');

    // Dropped, not queued. That is the honest model of a renderer that has not
    // finished booting, and it is why `connect` sends its snapshot rather than
    // waiting to be asked.
    expect(received).toEqual(['kept']);
  });

  it('reads the handler at delivery time, so replacing it takes effect immediately', () => {
    const fake = makePort();
    const seam = adaptMessagePort(fake.port);
    const first: unknown[] = [];
    const second: unknown[] = [];
    seam.onmessage = (message) => first.push(message);
    seam.onmessage = (message) => second.push(message);

    fake.deliver('one');
    seam.onmessage = null;
    fake.deliver('two');

    // Exactly one handler, replacing rather than accumulating — and `null` means
    // nobody is reading, not "keep the last one".
    expect(first).toEqual([]);
    expect(second).toEqual(['one']);
  });
});

describe('the restated PortLike, and why it is restated', () => {
  it('spells the two members the same way src/core/ipc/PortLike.ts does', () => {
    // The main process cannot import that module: `electron/tsconfig.json`
    // compiles with `module: "NodeNext"`, every relative import under `src/` is
    // extensionless because a bundler resolves the renderer, and the compiler
    // answers `TS2835` on every one of them. So the interface is restated in
    // `electron/main/portAdapter.ts` — and a restatement that nothing compares
    // is a copy waiting to drift.
    //
    // A text comparison rather than a type-level one, because a type-level
    // assertion would require importing the module this test exists BECAUSE
    // main cannot import.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, '..', '..', 'src', 'core', 'ipc', 'PortLike.ts'),
      'utf8',
    );
    expect(source).toContain('export type PortMessageHandler = (message: unknown) => void;');
    expect(source).toContain('postMessage(message: unknown): void;');
    expect(source).toContain('onmessage: PortMessageHandler | null;');
  });
});
