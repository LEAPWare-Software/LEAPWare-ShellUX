import type { ReactElement } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import {
  ExtensionHostBoundary,
  ShellHostProvider,
  useActivation,
  useExtensionActivation,
} from '../ActivationContext';
import type { ActivationController } from '../ActivationContext';
import { ShellUXError } from '../types';
import type { IShellAPI } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * THIS FILE ASSERTS THE HOLE. IT DOES NOT DENY IT.
 * ============================================================================
 * `ExtensionHostBoundary` severs the `ActivationController` from React context.
 * Every test in `capability.test.tsx` about that is true and stays true.
 *
 * It is not an enforcement boundary, because context is not where the capability
 * lives. The controller is held in `useMemo`/`useCallback`/`useRef` hook state on
 * the `ShellHostProvider` fiber, and React hangs that fiber off the DOM node it
 * rendered under an own enumerable property named `__reactFiber$<random>`. Any
 * script on the page — a third-party extension module is a script on the page —
 * starts at `document.body.firstElementChild`, enumerates `Object.keys`, and
 * walks `return`/`child`/`sibling` to every fiber in the tree, including ones
 * above the boundary. No DOM ref is needed, nothing has to be exported, and
 * severing a context does not remove a fiber from the tree.
 *
 * These tests therefore PERFORM the escalation rather than describing it, in the
 * same register as the D6 mutability test: they obtain the host-only controller
 * from inside a severed plug-in subtree, steal a sibling's `IShellAPI`, write
 * through it, and revoke the sibling. If a future change makes any of this fail,
 * that is a genuinely new property and it needs its own analysis before this file
 * is edited to match — it is NOT a test to relax.
 *
 * `ExtensionHostBoundary` is kept as a GUARDRAIL: it turns the one mistake
 * `DEVELOPER.md` used to actively instruct — call `useActivation()` from your own
 * view — into a loud, deterministic throw. That is worth having. It is not
 * isolation, and ADR-0001 Amendment E records the condition that voids the
 * decision to settle for it.
 *
 * Mitigations investigated and rejected, with evidence, in Amendment E: freezing
 * fibers or the context object breaks React; deleting `__reactFiber$` breaks all
 * event dispatch; a Proxy wrapper cannot identify its caller; Symbol keys are
 * enumerable through `Reflect.ownKeys`; a ShadowRoot is not in the fiber tree and
 * the DOM parent walk escapes it anyway; lint and compile-time checks never see
 * third-party JavaScript.
 * ============================================================================
 */

/**
 * The subset of a React fiber this walk touches.
 *
 * Declared structurally rather than imported: these are React internals, they
 * carry no public type, and depending on one would be depending on a contract
 * React does not offer. The walk is written to survive their absence — every
 * field is optional and every step is guarded — because the point being pinned is
 * "the capability is reachable", not "it is reachable at this exact shape".
 */
interface FiberLike {
  readonly return?: FiberLike | null;
  readonly child?: FiberLike | null;
  readonly sibling?: FiberLike | null;
  readonly alternate?: FiberLike | null;
  readonly memoizedState?: unknown;
}

/** One entry in a function component's hook linked list. */
interface HookLike {
  readonly memoizedState?: unknown;
  readonly next?: unknown;
}

/** How many hooks to follow before assuming the chain is not a hook chain. */
const MAX_HOOKS_PER_FIBER = 64;

/**
 * The React expando key on a DOM node, found the way any script on the page
 * finds it: by enumerating own properties. React assigns these with a plain
 * assignment, so they are own and enumerable and `Object.keys` reports them.
 */
function reactKeyOf(node: Element): string | undefined {
  return Object.keys(node).find(
    (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$'),
  );
}

function fiberOf(node: Element): FiberLike {
  const key = reactKeyOf(node);
  expect(key).toBeDefined();
  const fiber = (node as unknown as Record<string, unknown>)[key as string];
  expect(fiber).toBeTypeOf('object');
  return fiber as FiberLike;
}

/** Walk `return` to the top of the tree, which is above any boundary. */
function rootOf(fiber: FiberLike): FiberLike {
  let current = fiber;
  let guard = 0;
  while (current.return !== null && current.return !== undefined && guard < 1024) {
    current = current.return;
    guard += 1;
  }
  return current;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Every value held in hook state anywhere in the tree, plus the one unwrapping
 * step each hook kind needs: `useMemo`/`useCallback` store `[value, deps]` and
 * `useRef` stores `{ current }`.
 */
function reachableHookValues(root: FiberLike): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<FiberLike>();
  const pending: FiberLike[] = [root];

  while (pending.length > 0) {
    const fiber = pending.pop();
    if (fiber === undefined || fiber === null || seen.has(fiber)) {
      continue;
    }
    seen.add(fiber);

    let hook: unknown = fiber.memoizedState;
    let depth = 0;
    while (isObject(hook) && depth < MAX_HOOKS_PER_FIBER) {
      const state: unknown = (hook as HookLike).memoizedState;
      found.push(state);
      if (Array.isArray(state)) {
        found.push(state[0]);
      }
      if (isObject(state) && 'current' in state) {
        found.push(state['current']);
      }
      hook = (hook as HookLike).next;
      depth += 1;
    }

    for (const next of [fiber.child, fiber.sibling, fiber.alternate]) {
      if (next !== null && next !== undefined) {
        pending.push(next);
      }
    }
  }
  return found;
}

/** Recognise the host's `ActivationController` by its four members. */
function isActivationController(value: unknown): value is ActivationController {
  return (
    isObject(value) &&
    typeof value['activate'] === 'function' &&
    typeof value['blur'] === 'function' &&
    typeof value['release'] === 'function' &&
    typeof value['getActive'] === 'function'
  );
}

/** Recognise the host's shell state store by its six members. */
function isShellStateStore(value: unknown): value is ShellStateStore {
  return (
    isObject(value) &&
    typeof value['patchContext'] === 'function' &&
    typeof value['getBadgeCount'] === 'function' &&
    typeof value['setBadgeCount'] === 'function' &&
    typeof value['setSelectedItem'] === 'function' &&
    typeof value['getContext'] === 'function' &&
    typeof value['subscribe'] === 'function'
  );
}

/** Recognise the provider's live map: the host's off-switch for every handle. */
function isLiveMap(value: unknown): value is Map<string, { readonly revoke: () => void }> {
  if (!(value instanceof Map)) {
    return false;
  }
  for (const entry of value.values()) {
    if (!isObject(entry) || typeof entry['revoke'] !== 'function') {
      return false;
    }
  }
  return value.size > 0;
}

function expectShellUXError(call: () => void): ShellUXError {
  let caught: unknown;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  return caught as ShellUXError;
}

interface Harness {
  readonly registry: ExtensionRegistry;
  readonly activation: ActivationController;
  readonly store: ShellStateStore;
}

/**
 * Mount host chrome, a sibling extension owned by someone else, and a plug-in
 * subtree the host wrapped in a boundary. The plug-in view records what the
 * DOCUMENTED channel gives it, which is where the contrast lives.
 */
function mountShellWithPlugin(): {
  readonly harness: Harness;
  readonly pluginView: Record<string, unknown>;
} {
  let harness!: Harness;
  let pluginView!: Record<string, unknown>;

  function CaptureHost(): null {
    harness = { registry: useRegistry(), activation: useActivation(), store: useShellStore() };
    return null;
  }

  function PluginView(): ReactElement {
    pluginView = useExtensionActivation() as unknown as Record<string, unknown>;
    return <span />;
  }

  render(
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <CaptureHost />
        <ExtensionHostBoundary extensionId="mail-ext">
          <PluginView />
        </ExtensionHostBoundary>
      </ShellHostProvider>
    </ExtensionRegistryProvider>,
  );

  act(() => {
    expect(harness.registry.register(makeBlueprint({ id: 'crm-ext' })).ok).toBe(true);
  });
  act(() => {
    expect(harness.activation.activate('crm-ext').ok).toBe(true);
  });

  return { harness, pluginView };
}

/** The reflective route, from the one starting point every script on the page has. */
function reflectFromDocument(): unknown[] {
  const container = document.body.firstElementChild;
  expect(container).not.toBeNull();
  return reachableHookValues(rootOf(fiberOf(container as Element)));
}

describe('the between-extension boundary is not enforceable in-page', () => {
  it('gives a plug-in no capability through the documented channel', () => {
    const { pluginView } = mountShellWithPlugin();

    // This is the guardrail working, and it is genuinely worth having.
    expect(Object.keys(pluginView).sort()).toEqual([
      'extensionId',
      'foregroundExtensionId',
      'isForeground',
    ]);
    expect(pluginView['activate']).toBeUndefined();
    expect(pluginView['release']).toBeUndefined();
  });

  it('reaches the host ActivationController by reflection anyway, and steals a sibling handle', () => {
    const { harness } = mountShellWithPlugin();

    const reachable = reflectFromDocument();
    const controller = reachable.find(isActivationController);
    // The capability lives in hook state, not in context. Severing the context
    // did not, and could not, remove it from the fiber tree.
    expect(controller).toBeDefined();

    let stolen!: IShellAPI;
    act(() => {
      const outcome = (controller as ActivationController).activate('crm-ext');
      if (!outcome.ok) {
        throw outcome.error;
      }
      // `activate` hands back the named extension's scoped `IShellAPI`. This is
      // privilege escalation, performed, not hypothesised.
      stolen = outcome.active.shell;
    });

    act(() => {
      stolen.setSelectedItem('written-through-a-stolen-handle');
    });
    expect(harness.store.getContext().selectedItemId).toBe('written-through-a-stolen-handle');

    // Badge scoping is collision-resistance, not confinement: the stolen handle
    // is scoped to crm-ext, and that is whose scope the write lands in.
    act(() => {
      stolen.setBadgeCount('root-a', 42);
    });
    expect(harness.store.getBadgeCount('crm-ext', 'root-a')).toBe(42);

    // And `release` is on the same object, so the sibling can be revoked too.
    act(() => {
      expect((controller as ActivationController).release('crm-ext')).toBe(true);
    });
    expect(expectShellUXError(() => stolen.getContext()).code).toBe('REVOKED');
  });

  it('reaches the provider live map, which holds revoke for every extension', () => {
    mountShellWithPlugin();

    const liveMap = reflectFromDocument().find(isLiveMap);
    expect(liveMap).toBeDefined();
    const entry = (liveMap as Map<string, { readonly revoke: () => void }>).get('crm-ext');
    expect(entry).toBeDefined();

    // `revoke` is documented as "never reachable from `active.shell`", which is
    // true and is not the same as unreachable.
    expect(typeof entry?.revoke).toBe('function');
  });

  /* ------------------------------------------------------------------------ */
  /* And now the claim that DOES hold, stated as an assertion                  */
  /* ------------------------------------------------------------------------ */

  /**
   * This test was cited as the evidence for the store claim while it only ever
   * passed bad ARGUMENTS. It never tried the other move available to anything
   * holding the object — replacing a member — and that move worked, because the
   * store was returned as a plain mutable object literal. Passing bad arguments
   * proves the validators run; it proves nothing about whether the validators are
   * still the host's. The replacement attempt is now part of this test.
   *
   * **And then it was cited a second time for a property it still does not assert.**
   * The comment below the freeze assertion used to read "nor intercept, suppress or
   * forge the writes and reads every other holder makes through this same object".
   * This test asserts that ASSIGNMENT THROWS, and nothing more. Interception needs no
   * assignment: `subscribe` is one of the six members it enumerates, and it runs
   * plug-in code inside another holder's write. That is reproduced in
   * `subscribe.test.tsx` as the documented reality, and ADR-0001 Amendment G records
   * both the finding and the rule — no security claim in prose without naming the
   * test that exercises it — that this comment was in breach of.
   */
  it('gets the store methods, cannot replace one, and cannot put an illegal value through one', () => {
    const { harness } = mountShellWithPlugin();

    const store = reflectFromDocument().find(isShellStateStore);
    expect(store).toBeDefined();

    // The store's state — `context`, `badgeCounts`, `listeners`, `notifyDepth` —
    // is held in closure variables, and JavaScript has no reflective API for a
    // scope. So the walk gets the METHODS and never the state, and every method
    // validates. This is an integrity control, not entry-point validation: it
    // holds for this caller exactly as it holds for the host.
    expect(Object.keys(store as ShellStateStore).sort()).toEqual([
      'clearContextKeys',
      'getBadgeCount',
      'getContext',
      'getNavMetric',
      'patchContext',
      'setActiveNavNode',
      'setBadgeCount',
      'setContextKey',
      'setNavMetric',
      'setSelectedItem',
      'setSelectedItems',
      'subscribe',
    ]);

    // The object itself is frozen, so the reflective caller cannot put its own
    // function in place of a validator and then feed the context whatever it
    // likes. That is the whole of what the next eight lines assert: assignment
    // throws and the binding is unchanged. It is NOT a claim that writes through
    // this object are unobservable — see the docblock above and
    // `subscribe.test.tsx`.
    const target = store as unknown as Record<string, unknown>;
    const before = { ...target };
    expect(Object.isFrozen(store)).toBe(true);
    for (const key of Object.keys(before)) {
      expect(() => {
        target[key] = (): void => undefined;
      }).toThrow(TypeError);
      expect(target[key]).toBe(before[key]);
    }

    expect(
      expectShellUXError(() => {
        ((store as ShellStateStore).patchContext as (patch: unknown) => void)({
          activeNavNodeId: 'not a legal id',
        });
      }).code,
    ).toBe('INVALID_ID');
    expect(
      expectShellUXError(() => {
        ((store as ShellStateStore).patchContext as (patch: unknown) => void)({
          selectedItemId: { injected: true },
        });
      }).code,
    ).toBe('INVALID_FIELD');
    expect(harness.store.getContext().selectedItemId).toBeNull();
    expect(harness.store.getContext().activeNavNodeId).toBeNull();
  });

  it('never reaches the badge map itself, because it is a closure variable', () => {
    const { harness } = mountShellWithPlugin();
    act(() => {
      harness.store.setBadgeCount('crm-ext', 'root-a', 5);
    });

    // Every `Map` anywhere in hook state, after the write. The registry's own
    // store and the provider's live map are both here; the store's `badgeCounts`
    // is not, and cannot be, because nothing holds a reference to it.
    const maps = reflectFromDocument().filter(
      (value): value is Map<unknown, unknown> => value instanceof Map,
    );
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) {
      expect(map.has('crm-ext:root-a')).toBe(false);
    }
  });
});
