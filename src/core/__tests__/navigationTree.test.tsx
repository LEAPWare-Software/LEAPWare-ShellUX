import type { ReactElement, ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionRegistryProvider, REGISTRY_LIMITS, useRegistry } from '../RegistryContext';
import type { ExtensionRegistry } from '../RegistryContext';
import { STORE_LIMITS, createShellStateStore, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import type { ActivationController, ActiveExtension } from '../ActivationContext';
import { ShellUXError } from '../types';
import type { NavigationNode } from '../types';
import { makeBlueprint, makeDeepTree, makeWideTree } from './fixtures';

/**
 * ============================================================================
 * THE RUNTIME NAVIGATION TREE, `clearBadge`, AND THE STORE'S SCOPE BOUND
 * ============================================================================
 * ADR-0006 decision 8: GitHub issue #16 (`setNavigationTree`) and the badge and
 * scope-count halves of #80. The tree door keeps #16's three properties — every
 * node validated when it arrives, the plug-in never holding the stored copy, the
 * bounds holding after the change — and the cases below are one per property.
 *
 * What pane 1 draws from a replaced tree is asserted as DOM text in
 * `src/components/__tests__/ShellLayoutBadges.test.tsx`; nothing here, or
 * there, is a claim about layout, which jsdom cannot observe.
 * ============================================================================
 */

interface Harness {
  readonly registry: ExtensionRegistry;
  readonly activation: ActivationController;
  readonly store: ShellStateStore;
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>{children}</ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

function activated(): { host: { current: Harness }; active: ActiveExtension } {
  const { result } = renderHook(
    (): Harness => ({
      registry: useRegistry(),
      activation: useActivation(),
      store: useShellStore(),
    }),
    { wrapper: Providers },
  );
  let active!: ActiveExtension;
  act(() => {
    expect(result.current.registry.register(makeBlueprint({ id: 'mail-ext' })).ok).toBe(true);
    const outcome = result.current.activation.activate('mail-ext');
    if (!outcome.ok) {
      throw outcome.error;
    }
    active = outcome.active;
  });
  return { host: result, active };
}

function refusal(call: () => void): [string, string | null] {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(ShellUXError);
    return [(error as ShellUXError).code, (error as ShellUXError).field];
  }
  throw new Error('expected a ShellUXError, and nothing was thrown');
}

describe('setNavigationTree', () => {
  it('setNavigationTree re-normalises the whole tree at the door', () => {
    const { host, active } = activated();
    const declared = host.current.registry.getExtension('mail-ext')?.navigationTree;

    // Property 2: what is stored is a fresh, deep-frozen host copy, and nothing
    // the caller holds reaches it.
    const nodes = [
      { id: 'inbox', label: 'Inbox', badgeCount: 2, children: [{ id: 'vip', label: 'VIP' }] },
      { id: 'sent', label: 'Sent', metric: { kind: 'bar', value: 4, description: 'Quota' } },
    ];
    act(() => {
      active.shell.setNavigationTree(nodes as unknown as readonly NavigationNode[]);
    });
    const stored = host.current.store.getNavigationTree('mail-ext') as readonly NavigationNode[];
    expect(stored).not.toBe(nodes);
    expect(stored[1]?.metric?.value).toBe(1);
    nodes[0]!.label = 'Mutated';
    nodes.push({ id: 'late', label: 'Late' } as never);
    expect(stored.map((node) => node.label)).toEqual(['Inbox', 'Sent']);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored[0]?.children?.[0])).toBe(true);

    // Property 1: every node is validated as it arrives, with register's codes,
    // rooted at this door's parameter — and a refused tree stores nothing.
    const cases: [unknown, [string, string | null]][] = [
      ['not an array', ['INVALID_FIELD', 'nodes']],
      [[{ id: 'Bad Id', label: 'x' }], ['INVALID_ID', 'nodes[0].id']],
      [[{ id: 'ok', label: 'x', children: [{ id: '__proto__', label: 'y' }] }], ['RESERVED_ID', 'nodes[0].children[0].id']],
      [[{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }], ['DUPLICATE_ID', 'nodes[1].id']],
      [[{ id: 'a' }], ['MISSING_FIELD', 'nodes[0].label']],
      [[{ id: 'a', label: 'x', badgeCount: -1 }], ['INVALID_FIELD', 'nodes[0].badgeCount']],
      // Property 3: the bounds hold after the change, not only at registration.
      [makeDeepTree(REGISTRY_LIMITS.MAX_NAV_DEPTH + 1), ['PAYLOAD_TOO_LARGE', expect.stringMatching(/^nodes\[0\]/) as unknown as string]],
      [makeWideTree(REGISTRY_LIMITS.MAX_NAV_NODES + 1), ['PAYLOAD_TOO_LARGE', 'nodes']],
    ];
    for (const [candidate, expected] of cases) {
      expect(refusal(() => active.shell.setNavigationTree(candidate as readonly NavigationNode[]))).toEqual(
        expected,
      );
      expect(host.current.store.getNavigationTree('mail-ext')).toBe(stored);
    }

    // At the bounds exactly, it is accepted.
    act(() => {
      active.shell.setNavigationTree(makeDeepTree(REGISTRY_LIMITS.MAX_NAV_DEPTH) as never);
      active.shell.setNavigationTree(makeWideTree(REGISTRY_LIMITS.MAX_NAV_NODES) as never);
    });
    expect(host.current.store.getNavigationTree('mail-ext')).toHaveLength(REGISTRY_LIMITS.MAX_NAV_NODES);

    // The registered record is not what changed: it is the host-owned tree the
    // store holds, and the blueprint's stands untouched beside it.
    expect(host.current.registry.getExtension('mail-ext')?.navigationTree).toBe(declared);
  });

  it('is refused on a revoked handle, like every other write', () => {
    const { host, active } = activated();
    act(() => {
      host.current.activation.release('mail-ext');
    });
    expect(refusal(() => active.shell.setNavigationTree([]))).toEqual(['REVOKED', null]);
    expect(refusal(() => active.shell.clearBadge('root-a'))).toEqual(['REVOKED', null]);
  });

  it('validates the scope at the store doors', () => {
    const store = createShellStateStore();
    expect(refusal(() => store.getNavigationTree('Bad Scope'))).toEqual(['INVALID_ID', 'extensionId']);
    expect(refusal(() => store.setNavigationTree(7 as unknown as string, []))).toEqual([
      'INVALID_ID',
      'extensionId',
    ]);
    expect(refusal(() => store.purgeScope('__proto__'))).toEqual(['INVALID_ID', 'extensionId']);
    expect(refusal(() => store.clearBadge('mail', 'Bad Node'))).toEqual(['INVALID_ID', 'nodeId']);
  });
});

describe('clearBadge', () => {
  it('clearBadge deletes the entry rather than writing zero', () => {
    const { host, active } = activated();
    const listener = vi.fn();
    host.current.store.subscribe(listener);

    act(() => {
      active.shell.setBadgeCount('root-a', 5);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    act(() => {
      active.shell.clearBadge('root-a');
    });
    expect(active.shell.getBadgeCount('root-a')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    // Nothing there: nothing moved, nobody woken.
    act(() => {
      active.shell.clearBadge('root-a');
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('the store scope bound', () => {
  it('refuses a scope beyond MAX_SCOPES through the public store, and frees one on purge', () => {
    const store = createShellStateStore();
    for (let index = 0; index < STORE_LIMITS.MAX_SCOPES; index += 1) {
      store.setBadgeCount(`ext-${index}`, 'node', 1);
    }
    // Every door that can create a scope refuses the next one, and stores nothing.
    expect(refusal(() => store.setBadgeCount('one-more', 'node', 1))).toEqual([
      'PAYLOAD_TOO_LARGE',
      'extensionId',
    ]);
    expect(refusal(() => store.setNavMetric('one-more', 'node', 0.5))).toEqual([
      'PAYLOAD_TOO_LARGE',
      'extensionId',
    ]);
    expect(refusal(() => store.setContextKey('one-more', 'key', true))).toEqual([
      'PAYLOAD_TOO_LARGE',
      'extensionId',
    ]);
    expect(refusal(() => store.setNavigationTree('one-more', []))).toEqual([
      'PAYLOAD_TOO_LARGE',
      'extensionId',
    ]);
    expect(store.getBadgeCount('one-more', 'node')).toBeUndefined();

    // A scope already held keeps writing, through every door.
    store.setBadgeCount('ext-0', 'other', 2);
    store.setContextKey('ext-0', 'key', 'v');
    store.setNavigationTree('ext-0', []);
    expect(store.getBadgeCount('ext-0', 'other')).toBe(2);

    // Purging frees exactly one.
    store.purgeScope('ext-0');
    store.setBadgeCount('one-more', 'node', 1);
    expect(store.getBadgeCount('one-more', 'node')).toBe(1);
    expect(refusal(() => store.setBadgeCount('two-more', 'node', 1))[0]).toBe('PAYLOAD_TOO_LARGE');
  });

  it('purgeScope notifies once when it removed something, and not at all when it did not', () => {
    const store = createShellStateStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.purgeScope('nobody');
    expect(listener).not.toHaveBeenCalled();

    // A background scope: the published context does not move, one notify.
    store.setContextKey('mail', 'loaded', true);
    store.setNavMetric('mail', 'inbox', 0.2);
    store.setNavMetric('other', 'inbox', 0.3);
    listener.mockClear();
    store.purgeScope('mail');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getNavMetric('mail', 'inbox')).toBeUndefined();
    expect(store.getNavMetric('other', 'inbox')).toBe(0.3);

    // The foreground scope with no published keys: one notify, context untouched.
    store.patchContext({ activeExtensionId: 'db' });
    store.setBadgeCount('db', 'inbox', 1);
    const before = store.getContext();
    listener.mockClear();
    store.purgeScope('db');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getContext()).toBe(before);

    // The foreground scope WITH published keys: emptied in the one notify.
    store.setContextKey('db', 'ready', 1);
    expect(store.getContext().contextKeys).toEqual({ ready: 1 });
    listener.mockClear();
    store.purgeScope('db');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getContext().contextKeys).toEqual({});
  });
});
