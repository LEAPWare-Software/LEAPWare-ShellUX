import type { ReactElement, ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ExtensionRegistryProvider,
  REGISTRY_LIMITS,
  clampMetricValue,
  validateBlueprint,
} from '../RegistryContext';
import { ShellHostProvider } from '../ActivationContext';
import { createRevocableShellAPI, createShellStateStore, useNavMetric, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { NAVIGATION_METRIC_KINDS, ShellUXError } from '../types';
import type { NavigationMetric, ShellUXErrorCode } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * THE PANE-1 METRIC — a declarative field, two doors, one clamp rule
 * ============================================================================
 * `NavigationMetric` is the native-host plan's §4.1 answer to "pane 1 needs to
 * show a quantity" that does NOT reverse `ShellLayout.tsx` decision 5. The
 * alternative — `views.pane1` — would let one extension's renderer take the
 * whole navigation tree down; a validated declarative field cannot.
 *
 * These tests hold five things:
 *
 *   1. The clamp/reject asymmetry, at BOTH doors. Out of range is corrected;
 *      non-finite is refused. One function decides, so the doors cannot drift.
 *   2. The single-read discipline. A `Proxy` that reports one `series` length
 *      while it is measured and another afterwards cannot grow what is stored,
 *      and a plug-in that mutates its own metric object after registration
 *      changes nothing the host holds.
 *   3. The closed vocabulary. `kind` has no fallback and `description` is
 *      required.
 *   4. The store doors are the badge doors' shape: scoped by closure on the
 *      facade, unscoped and validated on the store, `REENTRANT_NOTIFY` raised
 *      after the value is committed.
 *   5. `useNavMetric` is `useBadgeCount`'s shape: it bails out on an unchanged
 *      value and raises `INVALID_ID` during render rather than reading
 *      `undefined`.
 * ============================================================================
 */

function makeMetric(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'bar', value: 0.5, description: 'Half full', ...overrides };
}

function treeWithMetric(metric: unknown): Record<string, unknown>[] {
  return [{ id: 'root-a', label: 'Root A', metric }];
}

/** The normalised metric on the first root of a validated blueprint. */
function firstMetric(navigationTree: Record<string, unknown>[]): NavigationMetric {
  const validated = validateBlueprint(makeBlueprint({ navigationTree }));
  const node = validated.navigationTree[0];
  if (node === undefined || node.metric === undefined) {
    throw new Error('the fixture did not produce a metric');
  }
  return node.metric;
}

function expectRejection(
  navigationTree: unknown,
  code: ShellUXErrorCode,
  field: string | null,
): ShellUXError {
  let caught: unknown;
  try {
    validateBlueprint(makeBlueprint({ navigationTree }));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  const error = caught as ShellUXError;
  expect(error.code).toBe(code);
  expect(error.field).toBe(field);
  return error;
}

describe('navigation metrics — the registry door', () => {
  it('clamps an out-of-range metric value at both doors and refuses a non-finite one', () => {
    // Registration door: clamped, and the blueprint still registers.
    expect(firstMetric(treeWithMetric(makeMetric({ value: 1.4 }))).value).toBe(1);
    expect(firstMetric(treeWithMetric(makeMetric({ value: -3 }))).value).toBe(0);
    expect(firstMetric(treeWithMetric(makeMetric({ value: 0.25 }))).value).toBe(0.25);

    // Runtime door: the same function, so the same answers.
    const store = createShellStateStore();
    store.setNavMetric('sample-ext', 'root-a', 1.4);
    expect(store.getNavMetric('sample-ext', 'root-a')).toBe(1);
    store.setNavMetric('sample-ext', 'root-a', -3);
    expect(store.getNavMetric('sample-ext', 'root-a')).toBe(0);

    // Non-finite is REFUSED at both, because no clamp makes NaN a fraction.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectRejection(treeWithMetric(makeMetric({ value: bad })), 'INVALID_FIELD', 'navigationTree[0].metric.value');
      expect(() => {
        store.setNavMetric('sample-ext', 'root-a', bad);
      }).toThrow(ShellUXError);
    }
    // And so is a value that is not a number at all.
    expectRejection(treeWithMetric(makeMetric({ value: '0.5' })), 'INVALID_FIELD', 'navigationTree[0].metric.value');
    expectRejection(treeWithMetric(makeMetric({ value: undefined })), 'MISSING_FIELD', 'navigationTree[0].metric.value');

    // The message reports the TYPE and never stringifies the value.
    const error = expectRejection(
      treeWithMetric(makeMetric({ value: Symbol('x') })),
      'INVALID_FIELD',
      'navigationTree[0].metric.value',
    );
    expect(error.message).toContain('a value of type "symbol"');
  });

  it('exports the clamp rule as one function, so the two doors cannot drift', () => {
    expect(clampMetricValue(2, 'probe', 'value')).toBe(1);
    expect(clampMetricValue(-2, 'probe', 'value')).toBe(0);
    expect(clampMetricValue(0, 'probe', 'value')).toBe(0);
    expect(() => clampMetricValue(Number.NaN, 'probe', 'value')).toThrow(ShellUXError);
    expect(() => clampMetricValue(null, 'probe', 'value')).toThrow(ShellUXError);
  });

  it('refuses a metric kind the host does not publish', () => {
    for (const kind of [...NAVIGATION_METRIC_KINDS]) {
      expect(firstMetric(treeWithMetric(makeMetric({ kind }))).kind).toBe(kind);
    }
    const error = expectRejection(
      treeWithMetric(makeMetric({ kind: 'gauge' })),
      'INVALID_FIELD',
      'navigationTree[0].metric.kind',
    );
    // No fallback, and the message says why rather than only that.
    expect(error.message).toContain('no honest fallback');
    expectRejection(treeWithMetric(makeMetric({ kind: 7 })), 'INVALID_FIELD', 'navigationTree[0].metric.kind');
    expectRejection(treeWithMetric(makeMetric({ kind: undefined })), 'MISSING_FIELD', 'navigationTree[0].metric.kind');
    // A prototype-shaped key is not a kind either.
    expectRejection(
      treeWithMetric(makeMetric({ kind: '__proto__' })),
      'INVALID_FIELD',
      'navigationTree[0].metric.kind',
    );
  });

  it('refuses a metric with no description', () => {
    expectRejection(
      treeWithMetric(makeMetric({ description: undefined })),
      'MISSING_FIELD',
      'navigationTree[0].metric.description',
    );
    expectRejection(
      treeWithMetric(makeMetric({ description: '   ' })),
      'INVALID_FIELD',
      'navigationTree[0].metric.description',
    );
    expectRejection(
      treeWithMetric(makeMetric({ description: 42 })),
      'INVALID_FIELD',
      'navigationTree[0].metric.description',
    );
    expectRejection(
      treeWithMetric(makeMetric({ description: 'd'.repeat(REGISTRY_LIMITS.MAX_TEXT_LENGTH + 1) })),
      'PAYLOAD_TOO_LARGE',
      'navigationTree[0].metric.description',
    );
  });

  it('refuses a metric that is not an object at all', () => {
    expectRejection(treeWithMetric('bar'), 'INVALID_FIELD', 'navigationTree[0].metric');
    expectRejection(treeWithMetric([0.5]), 'INVALID_FIELD', 'navigationTree[0].metric');
    expectRejection(treeWithMetric(null), 'INVALID_FIELD', 'navigationTree[0].metric');
  });

  it('bounds the series at MAX_METRIC_POINTS', () => {
    const legal = Array.from({ length: REGISTRY_LIMITS.MAX_METRIC_POINTS }, () => 0.5);
    expect(firstMetric(treeWithMetric(makeMetric({ kind: 'sparkline', series: legal }))).series).toHaveLength(
      REGISTRY_LIMITS.MAX_METRIC_POINTS,
    );
    expectRejection(
      treeWithMetric(makeMetric({ kind: 'sparkline', series: [...legal, 0.5] })),
      'PAYLOAD_TOO_LARGE',
      'navigationTree[0].metric.series',
    );
    expectRejection(
      treeWithMetric(makeMetric({ kind: 'sparkline', series: 'not-an-array' })),
      'INVALID_FIELD',
      'navigationTree[0].metric.series',
    );
    // Every point goes through the same clamp/reject rule the scalar does.
    expect(
      firstMetric(treeWithMetric(makeMetric({ kind: 'sparkline', series: [-1, 0.5, 9] }))).series,
    ).toEqual([0, 0.5, 1]);
    expectRejection(
      treeWithMetric(makeMetric({ kind: 'sparkline', series: [0.5, Number.NaN] })),
      'INVALID_FIELD',
      'navigationTree[0].metric.series[1]',
    );
    // An omitted series is omitted, not defaulted.
    expect(firstMetric(treeWithMetric(makeMetric())).series).toBeUndefined();
  });

  it('captures the series length once, so a shifting length cannot grow what is stored', () => {
    const series = [0.1, 0.2];
    let reads = 0;
    const shifting = new Proxy(series, {
      get(target, key, receiver): unknown {
        if (key === 'length') {
          reads += 1;
          // First read reports 2; every read after it reports the whole array.
          return reads === 1 ? 2 : 32;
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    for (let index = 2; index < 32; index += 1) {
      series.push(0.9);
    }

    const stored = firstMetric(treeWithMetric(makeMetric({ kind: 'sparkline', series: shifting })));
    expect(stored.series).toEqual([0.1, 0.2]);
  });

  it('stores a host-owned frozen metric that a plug-in cannot mutate afterwards', () => {
    const series = [0.1, 0.9];
    const metric = makeMetric({ kind: 'sparkline', series });
    const stored = firstMetric(treeWithMetric(metric));

    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.series)).toBe(true);
    expect(stored.series).not.toBe(series);

    // The plug-in edits its own objects; the registry's copy does not move.
    metric['value'] = 0.99;
    metric['description'] = 'rewritten';
    series[0] = 0.99;
    expect(stored.value).toBe(0.5);
    expect(stored.description).toBe('Half full');
    expect(stored.series?.[0]).toBe(0.1);
  });
});

describe('navigation metrics — the store and facade doors', () => {
  it('scopes setNavMetric by the closure and offers no parameter to name another', () => {
    const store = createShellStateStore();
    store.setNavMetric('ext-a', 'inbox', 0.25);
    store.setNavMetric('ext-b', 'inbox', 0.75);
    // Two vendors, one node id, two entries.
    expect(store.getNavMetric('ext-a', 'inbox')).toBe(0.25);
    expect(store.getNavMetric('ext-b', 'inbox')).toBe(0.75);

    // The facade takes ONE parameter fewer, so there is no scope to aim.
    const api = createRevocableShellAPI(store, 'ext-a').api;
    expect(api.setNavMetric).toHaveLength(2);
    expect(api.getNavMetric).toHaveLength(1);
    (api.setNavMetric as (...args: unknown[]) => void)('inbox', 0.4, 'ext-b');
    expect(store.getNavMetric('ext-a', 'inbox')).toBe(0.4);
    expect(store.getNavMetric('ext-b', 'inbox')).toBe(0.75);
  });

  it('reads back only its own scope through getNavMetric', () => {
    const store = createShellStateStore();
    store.setNavMetric('ext-a', 'inbox', 0.25);
    store.setNavMetric('ext-b', 'inbox', 0.75);
    const api = createRevocableShellAPI(store, 'ext-a').api;
    expect(api.getNavMetric('inbox')).toBe(0.25);
    expect(api.getNavMetric('nothing-here')).toBeUndefined();
  });

  it('validates the metric scope and node id at both store doors', () => {
    const store = createShellStateStore();
    for (const call of [
      (): unknown => store.getNavMetric('Bad Scope', 'inbox'),
      (): unknown => store.getNavMetric('ext-a', '__proto__'),
      (): unknown => store.setNavMetric('Bad Scope', 'inbox', 0.5),
      (): unknown => store.setNavMetric('ext-a', 'constructor', 0.5),
      (): unknown => store.setNavMetric('ext-a', Symbol('x') as unknown as string, 0.5),
    ]) {
      let caught: unknown;
      try {
        call();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ShellUXError);
      expect((caught as ShellUXError).code).toBe('INVALID_ID');
    }
  });

  it('raises REENTRANT_NOTIFY from setNavMetric, with the value already committed', () => {
    const store = createShellStateStore();
    store.subscribe(() => {
      store.setNavMetric('ext-a', 'inbox', 0.5);
    });
    let caught: unknown;
    try {
      store.setNavMetric('ext-a', 'inbox', 0.5);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShellUXError);
    expect((caught as ShellUXError).code).toBe('REENTRANT_NOTIFY');
    // Asymmetric, exactly as `setBadgeCount` is: the write STANDS.
    expect(store.getNavMetric('ext-a', 'inbox')).toBe(0.5);
  });
});

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>{children}</ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

function CaptureStore({ into }: { into: (store: ShellStateStore) => void }): null {
  into(useShellStore());
  return null;
}

interface WatcherProps {
  readonly scope: string;
  readonly nodeId: string;
  readonly onRender?: () => void;
}

function Watcher({ scope, nodeId, onRender }: WatcherProps): ReactElement {
  const metric = useNavMetric(scope, nodeId);
  onRender?.();
  return (
    <span data-testid={`${scope}:${nodeId}`}>{metric === undefined ? 'none' : String(metric)}</span>
  );
}

function mount(children: ReactNode): ShellStateStore {
  let store!: ShellStateStore;
  render(
    <Providers>
      <CaptureStore
        into={(value): void => {
          store = value;
        }}
      />
      {children}
    </Providers>,
  );
  return store;
}

describe('useNavMetric', () => {
  it('re-renders when the metric it watches is written', () => {
    const store = mount(<Watcher scope="ext-a" nodeId="inbox" />);
    expect(screen.getByTestId('ext-a:inbox')).toHaveTextContent('none');
    act(() => {
      store.setNavMetric('ext-a', 'inbox', 0.75);
    });
    expect(screen.getByTestId('ext-a:inbox')).toHaveTextContent('0.75');
  });

  it('does not re-render when the metric is rewritten with the value it already holds', () => {
    let renders = 0;
    const store = mount(
      <Watcher
        scope="ext-a"
        nodeId="inbox"
        onRender={(): void => {
          renders += 1;
        }}
      />,
    );
    act(() => {
      store.setNavMetric('ext-a', 'inbox', 0.75);
    });
    const after = renders;
    act(() => {
      store.setNavMetric('ext-a', 'inbox', 0.75);
      // A different node's write notifies every subscriber and moves nobody
      // else's number, which is the whole reason the bail-out is load-bearing.
      store.setNavMetric('ext-a', 'outbox', 0.1);
    });
    expect(renders).toBe(after);
  });

  it('raises INVALID_ID during render for a malformed metric scope', () => {
    for (const props of [
      { scope: 'Bad Scope', nodeId: 'inbox' },
      { scope: 'ext-a', nodeId: '__proto__' },
    ]) {
      expect(() => {
        render(
          <Providers>
            <Watcher scope={props.scope} nodeId={props.nodeId} />
          </Providers>,
        );
      }).toThrow(ShellUXError);
    }
  });
});
