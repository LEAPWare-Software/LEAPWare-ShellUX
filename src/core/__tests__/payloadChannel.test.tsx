import { useState } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_LIMITS,
  createPayloadChannelStore,
  useChannelPayload,
} from '../payload/PayloadChannel';
import { createRevocableShellAPI, createShellStateStore } from '../ShellAPI';
import { BLOCK_KINDS, ShellUXError } from '../types';
import type { IShellAPI, RibbonContext, ShellUXErrorCode, StructuredPayload } from '../types';

/**
 * ============================================================================
 * THE STRUCTURED PAYLOAD CHANNEL
 * ============================================================================
 * `ContextKeyValue`'s docblock names three hazards an object in `RibbonContext`
 * would carry, and this channel answers all three rather than reversing any of
 * them. The three answers are the first three groups below, and each is asserted
 * rather than asserted-about:
 *
 *   1. **Render-phase getters** — a payload never enters the context. Publishing
 *      does not move the snapshot, and `isVisible` is handed a `RibbonContext`
 *      whose keys are the five context fields and nothing else.
 *   2. **Prototype** — a host-owned deep copy into null-prototype records and
 *      frozen arrays. A `__proto__` key pollutes nothing and nothing of the
 *      publisher's graph is retained.
 *   3. **Identity** — subscribers compare a host-assigned monotonic revision, and
 *      the honest cost of that is asserted too: an identical republish bumps it
 *      and notifies.
 *
 * The remaining groups hold the bounds the primitive rule used to buy for free,
 * the scoping, and the hook.
 * ============================================================================
 */

function expectRejection(call: () => unknown, code: ShellUXErrorCode, field: string): ShellUXError {
  let caught: unknown;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  const error = caught as ShellUXError;
  expect(error.code).toBe(code);
  expect(error.field).toBe(field);
  return error;
}

/** A live scoped facade over a fresh context store and a fresh payload store. */
function mintFacade(extensionId = 'ext-a'): {
  readonly shell: IShellAPI;
  readonly revoke: () => void;
  readonly context: ReturnType<typeof createShellStateStore>;
  readonly payloads: ReturnType<typeof createPayloadChannelStore>;
} {
  const context = createShellStateStore();
  const payloads = createPayloadChannelStore();
  const revocable = createRevocableShellAPI(context, extensionId, () => true, payloads);
  return { shell: revocable.api, revoke: revocable.revoke, context, payloads };
}

describe('payload channel — answer 1: it never enters RibbonContext', () => {
  it('a published payload never enters the context, and publishing does not move the snapshot', () => {
    const { shell, context } = mintFacade();
    const before = context.getContext();

    shell.publishPayload('rows', 'table', { rows: [{ id: 'a' }] });

    // The SAME snapshot object. Nothing was allocated, so no `useMemo` keyed on
    // it is invalidated and no `useSyncExternalStore` subscriber re-renders.
    expect(context.getContext()).toBe(before);
    // ...and the context still holds exactly the five fields it declares. A
    // payload field could not have been added without a decision in
    // `CONTEXT_FIELDS`, which is `Record<keyof RibbonContext, …>`.
    expect(Object.keys(context.getContext()).sort()).toEqual([
      'activeExtensionId',
      'activeNavNodeId',
      'contextKeys',
      'selectedItemId',
      'selectedItemIds',
    ]);
    // The payload is nevertheless there, on its own store.
    expect(shell.readPayload('rows')?.kind).toBe('table');
  });

  it('an isVisible predicate has no argument through which to reach a payload', () => {
    const { shell, context } = mintFacade();
    shell.publishPayload('rows', 'table', { secret: 'not in the context' });

    // The exact argument a command predicate is handed. Everything reachable from
    // it is walked, and no part of the published payload appears anywhere in it.
    const ctx: RibbonContext = context.getContext();
    const seen = JSON.stringify({
      activeExtensionId: ctx.activeExtensionId,
      activeNavNodeId: ctx.activeNavNodeId,
      selectedItemId: ctx.selectedItemId,
      selectedItemIds: ctx.selectedItemIds,
      contextKeys: { ...ctx.contextKeys },
    });
    expect(seen).not.toContain('not in the context');
    expect(seen).not.toContain('rows');
    // And there is no member on the context to reach one through.
    expect('readPayload' in ctx).toBe(false);
    expect('payloads' in ctx).toBe(false);
  });

  it("runs the publisher's getters exactly once, at the imperative door", () => {
    const { shell } = mintFacade();
    let reads = 0;
    const hostile = {
      get value(): string {
        reads += 1;
        return 'read';
      },
    };
    shell.publishPayload('rows', 'text', hostile);
    expect(reads).toBe(1);

    // Reading the stored payload back, repeatedly, runs nothing of the
    // publisher's: what is stored is a primitive on a host-owned record.
    for (let index = 0; index < 5; index += 1) {
      expect((shell.readPayload('rows')?.data as { value: string }).value).toBe('read');
    }
    expect(reads).toBe(1);
  });
});

describe('payload channel — answer 2: a host-owned deep copy', () => {
  it('takes a null-prototype deep copy, so a __proto__ key pollutes nothing', () => {
    const { shell } = mintFacade();
    const polluted = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}') as unknown;
    shell.publishPayload('rows', 'form', polluted);

    const data = shell.readPayload('rows')?.data as Record<string, unknown>;
    // The key survives as an ORDINARY OWN PROPERTY of a prototypeless record...
    expect(Object.getPrototypeOf(data)).toBeNull();
    expect(Object.hasOwn(data, '__proto__')).toBe(true);
    expect(data['safe']).toBe(1);
    // ...and nothing anywhere was polluted by it.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('retains nothing of the publisher: mutating the source afterwards changes nothing', () => {
    const { shell } = mintFacade();
    const source = { rows: [{ id: 'a' }], title: 'Before' };
    shell.publishPayload('rows', 'table', source);
    const stored = shell.readPayload('rows') as StructuredPayload;

    source.title = 'After';
    source.rows.push({ id: 'b' });
    source.rows[0] = { id: 'rewritten' };

    const data = stored.data as { rows: readonly { id: string }[]; title: string };
    expect(data.title).toBe('Before');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.id).toBe('a');
    // Frozen at every host-owned level.
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.rows)).toBe(true);
    expect(data.rows).not.toBe(source.rows);
  });

  it('rejects a cycle rather than truncating it, and copies a repeated sibling', () => {
    const { shell } = mintFacade();

    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    const error = expectRejection(
      () => {
        shell.publishPayload('rows', 'table', cyclic);
      },
      'INVALID_FIELD',
      'data.self',
    );
    expect(error.message).toContain('closes a cycle');
    // All-or-nothing: the rejected publish left the channel exactly as it was.
    expect(shell.readPayload('rows')).toBeNull();

    // A DIAMOND is not a cycle. It has a finite copy, so refusing it would reject
    // a payload with nothing wrong with it.
    const shared = { id: 'shared' };
    shell.publishPayload('rows', 'table', { left: shared, right: shared });
    const data = shell.readPayload('rows')?.data as {
      left: { id: string };
      right: { id: string };
    };
    expect(data.left.id).toBe('shared');
    expect(data.right.id).toBe('shared');
    // Copied twice, because a tree is what is stored.
    expect(data.left).not.toBe(data.right);

    // ...and a cycle through an ARRAY is refused on the same rule.
    const arm: unknown[] = [];
    arm.push(arm);
    expectRejection(
      () => {
        shell.publishPayload('rows', 'table', { arm });
      },
      'INVALID_FIELD',
      'data.arm[0]',
    );
  });

  it('refuses every leaf that is not a PayloadLeaf, by type rather than by coercion', () => {
    const { shell } = mintFacade();
    for (const [label, value] of [
      ['function', () => undefined],
      ['symbol', Symbol('x')],
      ['bigint', 10n],
      ['undefined', undefined],
    ] as const) {
      const error = expectRejection(
        () => {
          shell.publishPayload('rows', 'text', { leaf: value });
        },
        'INVALID_FIELD',
        'data.leaf',
      );
      expect(error.message).toContain(`a value of type "${label}"`);
    }
    // A non-finite number is refused for the reason `setContextKey` refuses one.
    expectRejection(
      () => {
        shell.publishPayload('rows', 'text', { leaf: Number.NaN });
      },
      'INVALID_FIELD',
      'data.leaf',
    );
    // A `Date` is an object and is walked as a record — it has no own enumerable
    // keys, so what is stored is an empty record and never a coerced string.
    shell.publishPayload('rows', 'text', { when: new Date(0) });
    expect(shell.readPayload('rows')?.data).toEqual({ when: {} });
  });

  it('turns a payload that refuses to be read into a rejection, not a raw TypeError', () => {
    const { shell } = mintFacade();

    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'boom', {
      enumerable: true,
      get(): never {
        throw new TypeError('nope');
      },
    });
    expectRejection(
      () => {
        shell.publishPayload('rows', 'text', throwingGetter);
      },
      'INVALID_FIELD',
      'data.boom',
    );

    const throwingKeys = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new TypeError('nope');
        },
      },
    );
    expectRejection(
      () => {
        shell.publishPayload('rows', 'text', throwingKeys);
      },
      'INVALID_FIELD',
      'data',
    );

    const revocable = Proxy.revocable({ a: 1 }, {});
    revocable.revoke();
    expectRejection(
      () => {
        shell.publishPayload('rows', 'text', revocable.proxy);
      },
      'INVALID_FIELD',
      'data',
    );

    const throwingLength = new Proxy([1, 2], {
      get(target, key, receiver): unknown {
        if (key === 'length') {
          throw new TypeError('nope');
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expectRejection(
      () => {
        shell.publishPayload('rows', 'text', { arm: throwingLength });
      },
      'INVALID_FIELD',
      'data.arm',
    );

    const throwingElement = new Proxy([1, 2], {
      get(target, key, receiver): unknown {
        if (key === '0') {
          throw new TypeError('nope');
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expectRejection(
      () => {
        shell.publishPayload('rows', 'text', { arm: throwingElement });
      },
      'INVALID_FIELD',
      'data.arm[0]',
    );

    // Nothing was stored by any of them.
    expect(shell.readPayload('rows')).toBeNull();
  });

  it('captures an array length once, and refuses a length that is not a count', () => {
    const { shell } = mintFacade();

    const backing = [1, 2];
    let reads = 0;
    const shifting = new Proxy(backing, {
      get(target, key, receiver): unknown {
        if (key === 'length') {
          reads += 1;
          return reads === 1 ? 2 : 64;
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    for (let index = 2; index < 64; index += 1) {
      backing.push(9);
    }
    shell.publishPayload('rows', 'chart', { arm: shifting });
    expect((shell.readPayload('rows')?.data as { arm: readonly number[] }).arm).toEqual([1, 2]);

    for (const bad of ['2', 1.5, -1]) {
      const lying = new Proxy([1, 2], {
        get(target, key, receiver): unknown {
          if (key === 'length') {
            return bad;
          }
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      expectRejection(
        () => {
          shell.publishPayload('other', 'chart', { arm: lying });
        },
        'INVALID_FIELD',
        'data.arm',
      );
    }
  });
});

describe('payload channel — answer 3: a host-assigned monotonic revision', () => {
  it('bumps the revision and notifies even when the republished content is identical', () => {
    const { shell } = mintFacade();
    const seen: number[] = [];
    shell.subscribePayload('rows', (payload) => {
      seen.push(payload.revision);
    });

    shell.publishPayload('rows', 'table', { rows: [1, 2] });
    shell.publishPayload('rows', 'table', { rows: [1, 2] });

    // Stated honestly rather than glossed: identical content is a real
    // notification, because the host does not deep-compare payloads.
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeGreaterThan(seen[0] as number);
    // The object identity is useless for the comparison, which is exactly why
    // the revision exists.
    expect(shell.readPayload('rows')?.revision).toBe(seen[1]);
  });

  it('keeps the revision monotonic across channels, so two blocks are comparable', () => {
    const { shell } = mintFacade();
    shell.publishPayload('chart', 'chart', { points: [1] });
    shell.publishPayload('rows', 'table', { rows: [1] });
    const chart = shell.readPayload('chart') as StructuredPayload;
    const rows = shell.readPayload('rows') as StructuredPayload;
    expect(rows.revision).toBeGreaterThan(chart.revision);
  });

  it('keeps the stored payload identity stable until the channel is republished', () => {
    const { shell } = mintFacade();
    shell.publishPayload('rows', 'table', { rows: [1] });
    const first = shell.readPayload('rows');
    expect(shell.readPayload('rows')).toBe(first);
    shell.publishPayload('rows', 'table', { rows: [1] });
    expect(shell.readPayload('rows')).not.toBe(first);
  });
});

describe('payload channel — bounds, vocabulary and scope', () => {
  it('refuses a channel name that is not a registry-valid identifier', () => {
    const { shell } = mintFacade();
    for (const channel of ['Bad Channel', '__proto__', 'constructor', '../etc', '']) {
      expectRejection(
        () => {
          shell.publishPayload(channel, 'table', {});
        },
        'INVALID_ID',
        'channel',
      );
      expectRejection(() => shell.readPayload(channel), 'INVALID_ID', 'channel');
      expectRejection(
        () => shell.subscribePayload(channel, () => undefined),
        'INVALID_ID',
        'channel',
      );
    }
    expectRejection(
      () => {
        shell.publishPayload(7 as unknown as string, 'table', {});
      },
      'INVALID_ID',
      'channel',
    );
  });

  it('refuses a block kind the host does not publish', () => {
    const { shell } = mintFacade();
    for (const kind of [...BLOCK_KINDS]) {
      shell.publishPayload('rows', kind as 'table', {});
      expect(shell.readPayload('rows')?.kind).toBe(kind);
    }
    for (const kind of ['gauge', 7, undefined]) {
      expectRejection(
        () => {
          shell.publishPayload('rows', kind as 'table', {});
        },
        'INVALID_FIELD',
        'kind',
      );
    }
  });

  it('refuses a listener that is not a function', () => {
    const { shell } = mintFacade();
    expectRejection(
      () => shell.subscribePayload('rows', 7 as unknown as () => void),
      'INVALID_FIELD',
      'listener',
    );
  });

  it('bounds depth, node count, size and channels per scope', () => {
    const { shell } = mintFacade();

    // Depth. The root counts as 1, so MAX_DEPTH nested records is legal and one
    // more is not.
    const nest = (levels: number): unknown => {
      let node: unknown = 'leaf';
      for (let index = 1; index < levels; index += 1) {
        node = { down: node };
      }
      return node;
    };
    shell.publishPayload('rows', 'table', nest(PAYLOAD_LIMITS.MAX_DEPTH));
    expectRejection(
      () => {
        shell.publishPayload('rows', 'table', nest(PAYLOAD_LIMITS.MAX_DEPTH + 1));
      },
      'PAYLOAD_TOO_LARGE',
      'data.down.down.down.down.down.down',
    );

    // Node count. One array plus MAX_NODES leaves is one node too many.
    expectRejection(
      () => {
        shell.publishPayload(
          'rows',
          'table',
          Array.from({ length: PAYLOAD_LIMITS.MAX_NODES }, () => 1),
        );
      },
      'PAYLOAD_TOO_LARGE',
      `data[${PAYLOAD_LIMITS.MAX_NODES - 1}]`,
    );

    // Size, in the host's own accounting.
    expectRejection(
      () => {
        shell.publishPayload('rows', 'table', { big: 'x'.repeat(PAYLOAD_LIMITS.MAX_BYTES) });
      },
      'PAYLOAD_TOO_LARGE',
      'data.big',
    );

    // Channels per scope, counted against what is STORED and only for a channel
    // that is genuinely new.
    const wide = mintFacade('ext-wide').shell;
    for (let index = 0; index < PAYLOAD_LIMITS.MAX_CHANNELS; index += 1) {
      wide.publishPayload(`ch-${index}`, 'text', index);
    }
    // Republishing on a channel already held is not growth.
    wide.publishPayload('ch-0', 'text', 1);
    expectRejection(
      () => {
        wide.publishPayload('one-too-many', 'text', 1);
      },
      'PAYLOAD_TOO_LARGE',
      'channel',
    );
  });

  it('scopes the channel by the closure, so two extensions cannot collide', () => {
    const context = createShellStateStore();
    const payloads = createPayloadChannelStore();
    const a = createRevocableShellAPI(context, 'ext-a', () => true, payloads).api;
    const b = createRevocableShellAPI(context, 'ext-b', () => true, payloads).api;

    a.publishPayload('rows', 'table', { who: 'a' });
    b.publishPayload('rows', 'table', { who: 'b' });

    expect((a.readPayload('rows')?.data as { who: string }).who).toBe('a');
    expect((b.readPayload('rows')?.data as { who: string }).who).toBe('b');
    // There is no parameter through which to name another scope.
    expect(a.publishPayload).toHaveLength(3);
    expect(a.readPayload).toHaveLength(1);
    expect(a.subscribePayload).toHaveLength(2);

    // A channel nothing has ever been published on reads `null`, whether or not
    // the scope exists.
    expect(a.readPayload('never')).toBeNull();
    expect(createRevocableShellAPI(context, 'ext-c', () => true, payloads).api.readPayload('rows')).toBeNull();

    // ...and dropping a scope drops its channels and nobody else's.
    payloads.clearScope('ext-a');
    expect(a.readPayload('rows')).toBeNull();
    expect((b.readPayload('rows')?.data as { who: string }).who).toBe('b');
  });

  it('runs a subscriber synchronously inside the publisher’s frame, and lets it throw there', () => {
    const { shell } = mintFacade();
    const order: string[] = [];
    shell.subscribePayload('rows', () => {
      order.push('listener');
    });
    order.push('before');
    shell.publishPayload('rows', 'table', {});
    order.push('after');
    // Synchronous, and before the publishing statement returned.
    expect(order).toEqual(['before', 'listener', 'after']);

    // A throwing listener reaches the publisher's frame as whatever it chose,
    // which is NOT necessarily a `ShellUXError`. Same limit as
    // `ShellStateStore.subscribe`, reached by a different door.
    shell.subscribePayload('other', () => {
      throw new TypeError('from a listener');
    });
    expect(() => {
      shell.publishPayload('other', 'table', {});
    }).toThrow(TypeError);
  });

  it('does not call a listener added during a pass, nor one removed during it', () => {
    const { shell } = mintFacade();
    const calls: string[] = [];
    let dropLater: () => void = () => undefined;

    shell.subscribePayload('rows', () => {
      calls.push('first');
      shell.subscribePayload('rows', () => {
        calls.push('added-during');
      });
      dropLater();
    });
    dropLater = shell.subscribePayload('rows', () => {
      calls.push('second');
    });

    shell.publishPayload('rows', 'table', {});
    expect(calls).toEqual(['first']);
  });

  it('returns a disposer that is total, so unsubscribing after revocation throws nothing', () => {
    const { shell, revoke } = mintFacade();
    const calls: number[] = [];
    const dispose = shell.subscribePayload('rows', (payload) => {
      calls.push(payload.revision);
    });
    shell.publishPayload('rows', 'table', {});
    expect(calls).toHaveLength(1);
    dispose();
    shell.publishPayload('rows', 'table', {});
    expect(calls).toHaveLength(1);

    // A second subscription, then revocation, then the cleanup React would run
    // on unmount. It must not throw: there is nowhere for a cleanup to raise to.
    const late = shell.subscribePayload('rows', () => undefined);
    revoke();
    expect(() => {
      late();
    }).not.toThrow();
    // Every other member is revoked loudly, including taking a NEW subscription.
    for (const call of [
      (): unknown => {
        shell.publishPayload('rows', 'table', {});
        return null;
      },
      (): unknown => shell.readPayload('rows'),
      (): unknown => shell.subscribePayload('rows', () => undefined),
    ]) {
      expect(call).toThrow(ShellUXError);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The hook                                                                    */
/* -------------------------------------------------------------------------- */

interface ReaderProps {
  readonly shell: IShellAPI;
  readonly channel: string;
  readonly onRender?: () => void;
}

function Reader({ shell, channel, onRender }: ReaderProps): ReactElement {
  const payload = useChannelPayload(shell, channel);
  onRender?.();
  return <span data-testid="payload">{payload === null ? 'none' : String(payload.revision)}</span>;
}

describe('useChannelPayload', () => {
  it('re-renders the reading pane when the channel it watches is republished', () => {
    const { shell } = mintFacade();
    render(<Reader shell={shell} channel="rows" />);
    expect(screen.getByTestId('payload')).toHaveTextContent('none');

    act(() => {
      shell.publishPayload('rows', 'table', { rows: [1] });
    });
    expect(screen.getByTestId('payload')).toHaveTextContent('1');
  });

  it('hands useSyncExternalStore a stable snapshot, so an unchanged channel does not re-render', () => {
    const { shell } = mintFacade();
    let renders = 0;
    function Wrapper(): ReactElement {
      const [, force] = useState(0);
      return (
        <>
          <Reader
            shell={shell}
            channel="rows"
            onRender={(): void => {
              renders += 1;
            }}
          />
          <button
            type="button"
            onClick={(): void => {
              force((value) => value + 1);
            }}
          >
            force
          </button>
        </>
      );
    }
    render(<Wrapper />);
    act(() => {
      shell.publishPayload('rows', 'table', { rows: [1] });
    });
    const after = renders;
    // A publish on a DIFFERENT channel notifies nobody on this one.
    act(() => {
      shell.publishPayload('other', 'table', { rows: [1] });
    });
    expect(renders).toBe(after);
    // ...and the snapshot read on an unrelated re-render is the same object, so
    // `useSyncExternalStore` does not loop.
    const before = shell.readPayload('rows');
    act(() => {
      screen.getByRole('button', { name: 'force' }).click();
    });
    expect(shell.readPayload('rows')).toBe(before);
  });
});
