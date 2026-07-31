import type { ExtensionViewProps } from '../types';

/** Minimal valid pane views. A component returning `null` is legal React. */
export const Pane2View = (_props: ExtensionViewProps): null => null;
export const Pane3View = (_props: ExtensionViewProps): null => null;

/**
 * A structurally valid blueprint, expressed as a loose record so tests can
 * substitute hostile values that `LEAPExtensionBlueprint` would reject at
 * compile time. Exercising the RUNTIME validator is the entire point.
 */
export function makeBlueprint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sample-ext',
    name: 'Sample Extension',
    version: '1.0.0',
    navigationTree: [
      {
        id: 'root-a',
        label: 'Root A',
        badgeCount: 3,
        children: [{ id: 'child-a', label: 'Child A' }],
      },
      { id: 'root-b', label: 'Root B' },
    ],
    ribbonActions: [
      {
        id: 'act-one',
        label: 'Act One',
        icon: 'save',
        isDisabled: false,
        isVisible: () => true,
        onExecute: () => undefined,
      },
      {
        id: 'act-two',
        label: 'Act Two',
        icon: 'open',
        isVisible: () => false,
        onExecute: () => undefined,
      },
    ],
    views: { pane2: Pane2View, pane3: Pane3View },
    ...overrides,
  };
}

/**
 * A structurally valid ribbon action with `overrides` applied, expressed as a
 * loose record for the same reason `makeBlueprint` is: the point is to hand the
 * RUNTIME validator values `RibbonAction` would reject at compile time.
 */
export function makeAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'act-one',
    label: 'Act One',
    icon: 'save',
    isVisible: () => true,
    onExecute: () => undefined,
    ...overrides,
  };
}

/** A navigation tree `depth` levels deep, for the depth-limit tests. */
export function makeDeepTree(depth: number): Record<string, unknown>[] {
  let node: Record<string, unknown> = { id: `d${depth}`, label: `Level ${depth}` };
  for (let level = depth - 1; level >= 1; level -= 1) {
    node = { id: `d${level}`, label: `Level ${level}`, children: [node] };
  }
  return [node];
}

/** `count` sibling navigation nodes, for the node-count-limit tests. */
export function makeWideTree(count: number): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (let index = 0; index < count; index += 1) {
    nodes.push({ id: `node-${index}`, label: `Node ${index}` });
  }
  return nodes;
}

/** `count` ribbon actions, for the action-count-limit tests. */
export function makeManyActions(count: number): Record<string, unknown>[] {
  const actions: Record<string, unknown>[] = [];
  for (let index = 0; index < count; index += 1) {
    actions.push({
      id: `act-${index}`,
      label: `Action ${index}`,
      icon: 'icon',
      isVisible: () => true,
      onExecute: () => undefined,
    });
  }
  return actions;
}

/** An object whose `id` getter throws — models a hostile, self-detonating payload. */
export function makeExplodingPayload(thrown: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  Object.defineProperty(payload, 'id', {
    enumerable: true,
    get(): never {
      throw thrown;
    },
  });
  return payload;
}

/** A hostile payload plus a counter reporting how often its `id` was read. */
export interface CountingPayload {
  readonly payload: Record<string, unknown>;
  /** Number of times the `id` getter has run so far. */
  reads(): number;
}

/**
 * A structurally valid blueprint whose `id` getter returns a DIFFERENT value on
 * each successive read.
 *
 * `values` is consumed in order; once exhausted the final entry is returned for
 * every further read. This is the shape of the time-of-check/time-of-use attack
 * the registry has to survive: benign while it is inspected, hostile after.
 */
export function makeShiftingIdPayload(values: readonly unknown[]): CountingPayload {
  const payload = makeBlueprint();
  let reads = 0;
  Object.defineProperty(payload, 'id', {
    enumerable: true,
    configurable: true,
    get(): unknown {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      return value;
    },
  });
  return { payload, reads: () => reads };
}

/**
 * A structurally valid blueprint whose `id` getter throws on the Nth read only,
 * returning a benign id on every other read.
 *
 * `makeExplodingPayload` detonates on the FIRST read, which is why it never
 * caught the unguarded re-reads that used to sit outside the try/catch.
 */
export function makeDelayedExplodingPayload(
  explodeOnRead: number,
  thrown: unknown,
): CountingPayload {
  const payload = makeBlueprint();
  let reads = 0;
  Object.defineProperty(payload, 'id', {
    enumerable: true,
    configurable: true,
    get(): unknown {
      reads += 1;
      if (reads === explodeOnRead) {
        throw thrown;
      }
      return 'sample-ext';
    },
  });
  return { payload, reads: () => reads };
}

/**
 * A value that throws from every route to a string: `Symbol.toPrimitive`,
 * `toString` and `valueOf`. `String(value)` on it throws, so anything that
 * stringifies a thrown value defensively has to survive this.
 */
export function makeUnstringifiableValue(options: {
  readonly withToPrimitive: boolean;
}): Record<PropertyKey, unknown> {
  const value: Record<PropertyKey, unknown> = {};
  const detonate = (): never => {
    throw new Error('stringification refused');
  };
  Object.defineProperty(value, 'toString', { value: detonate });
  Object.defineProperty(value, 'valueOf', { value: detonate });
  if (options.withToPrimitive) {
    Object.defineProperty(value, Symbol.toPrimitive, { value: detonate });
  }
  return value;
}

/**
 * A value whose very `instanceof` check throws: a Proxy trapping
 * `getPrototypeOf`, which `instanceof` walks.
 */
export function makeUnclassifiableValue(): unknown {
  return new Proxy(
    {},
    {
      getPrototypeOf(): never {
        throw new Error('prototype lookup refused');
      },
    },
  );
}

/**
 * A `Proxy` that has already been revoked.
 *
 * Every internal method on a revoked `Proxy` throws a raw `TypeError`, including
 * the `IsArray` check that `Array.isArray` performs — which is what makes this
 * the value that finds an unguarded `Array.isArray`. `typeof` is the one
 * operation it answers honestly and without trapping (`"object"`), so it walks
 * straight through a `typeof` check and detonates at the next real inspection.
 */
export function makeRevokedProxy(): unknown {
  const { proxy, revoke } = Proxy.revocable<Record<string, unknown>>({}, {});
  revoke();
  return proxy;
}

/**
 * An array of `items` wrapped in a Proxy whose `length` returns each entry of
 * `lengths` in turn, then repeats the last.
 *
 * `Array.isArray` is true for a Proxy over an array, and `length` on an array
 * is writable, so a `get` trap may report a different value on every read
 * without violating any Proxy invariant. This models a payload that grows after
 * its bounds have been checked: honest while it is measured, larger afterwards.
 */
export function makeShiftingLengthArray(
  items: readonly unknown[],
  lengths: readonly number[],
): unknown[] {
  let reads = 0;
  return new Proxy([...items], {
    get(target, property, receiver): unknown {
      if (property === 'length') {
        const value = lengths[Math.min(reads, lengths.length - 1)];
        reads += 1;
        return value;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
