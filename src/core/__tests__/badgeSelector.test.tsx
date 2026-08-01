import type { ReactElement, ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider } from '../RegistryContext';
import { ShellHostProvider } from '../ActivationContext';
import { useBadgeCount, useShellStore } from '../ShellAPI';
import type { ShellStateStore } from '../ShellAPI';
import { ShellUXError } from '../types';

/**
 * ============================================================================
 * THE BADGE-AWARE SELECTOR — the read half of a channel that only ever wrote
 * ============================================================================
 * `IShellAPI.setBadgeCount` was fully implemented, fully validated and fully
 * tested, and the value it wrote was read by no renderer. Badges are
 * deliberately NOT part of the `RibbonContext` snapshot, so the one subscription
 * the shell had — `useShellContext` — re-read an unchanged snapshot on every
 * badge write and bailed out. The store's notify was correct the whole time;
 * nothing was listening for the thing it was announcing.
 *
 * `useBadgeCount` is that listener. These tests hold four things about it:
 *
 *   1. A badge write re-renders the component watching that badge.
 *   2. A badge write does NOT re-render a component watching a different badge,
 *      and nor does re-writing the same value. That is load-bearing rather than
 *      an optimisation: `setBadgeCount` notifies unconditionally, so without the
 *      `Object.is` bail-out every badge write in the shell would re-render every
 *      badge in the sidebar.
 *   3. It reads whatever scope it is handed. The hook takes the scope as a
 *      parameter — which `IShellAPI.setBadgeCount` deliberately does not — and
 *      that is stated as what it is rather than dressed up as a boundary.
 *   4. A malformed argument is a `ShellUXError` raised during render, not a
 *      silent `undefined`.
 *
 * Written against the public surface only: the providers, `useShellStore` and
 * the hook. Nothing here reaches into module internals.
 * ============================================================================
 */

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>{children}</ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

/**
 * Hand the surrounding provider's own store out.
 *
 * A provider owns ONE store for ITS subtree, so a test that writes through some
 * other store asserts nothing at all.
 */
function CaptureStore({ into }: { into: (store: ShellStateStore) => void }): null {
  into(useShellStore());
  return null;
}

interface WatcherProps {
  readonly scope: string;
  readonly nodeId: string;
  /** Called once per render, so a test can count renders that did happen. */
  readonly onRender?: () => void;
}

/** Renders one badge, and reports the value as text so it can be asserted on. */
function Watcher({ scope, nodeId, onRender }: WatcherProps): ReactElement {
  const badge = useBadgeCount(scope, nodeId);
  onRender?.();
  return (
    <span data-testid={`${scope}:${nodeId}`}>{badge === undefined ? 'none' : String(badge)}</span>
  );
}

/** Mount `children` inside a fresh host, and hand back that host's store. */
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

/**
 * Render `element`, expect it to fail with a `ShellUXError`, and return it.
 *
 * React logs the error it re-throws from a failed render. That is expected here,
 * so the console is silenced for the duration rather than left to imply
 * something went wrong.
 */
function expectRenderToThrowShellUXError(element: ReactElement): ShellUXError {
  const consoleError = console.error;
  console.error = (): void => undefined;
  let caught: unknown;
  try {
    render(element);
  } catch (error) {
    caught = error;
  } finally {
    console.error = consoleError;
  }
  // A raw Error or TypeError here would mean the hook swallowed the store's
  // typed rejection and produced its own.
  expect(caught).toBeInstanceOf(ShellUXError);
  return caught as ShellUXError;
}

describe('useBadgeCount', () => {
  it('reads undefined for a node that has never had a badge', () => {
    mount(<Watcher scope="mail-ext" nodeId="inbox" />);
    expect(screen.getByTestId('mail-ext:inbox')).toHaveTextContent('none');
  });

  it('re-renders when the badge it watches is written', () => {
    const store = mount(<Watcher scope="mail-ext" nodeId="inbox" />);

    act(() => {
      store.setBadgeCount('mail-ext', 'inbox', 7);
    });
    // The whole defect, inverted: a runtime badge write is now visible.
    expect(screen.getByTestId('mail-ext:inbox')).toHaveTextContent('7');

    // Including the write back down to zero, which a truthiness test would miss.
    act(() => {
      store.setBadgeCount('mail-ext', 'inbox', 0);
    });
    expect(screen.getByTestId('mail-ext:inbox')).toHaveTextContent('0');
  });

  it('does not re-render when the badge is rewritten with the value it already holds', () => {
    let renders = 0;
    const store = mount(
      <Watcher
        scope="mail-ext"
        nodeId="inbox"
        onRender={(): void => {
          renders += 1;
        }}
      />,
    );

    act(() => {
      store.setBadgeCount('mail-ext', 'inbox', 7);
    });
    const afterFirstWrite = renders;
    expect(afterFirstWrite).toBeGreaterThan(0);

    // `setBadgeCount` notifies unconditionally — it does not compare the way
    // `applyPatch` does — so this listener IS woken. The snapshot is a primitive
    // and `Object.is`-equal, so `useSyncExternalStore` bails out on its own.
    act(() => {
      store.setBadgeCount('mail-ext', 'inbox', 7);
      store.setBadgeCount('mail-ext', 'inbox', 7);
    });
    expect(renders).toBe(afterFirstWrite);
  });

  it("does not re-render when a different node's badge is written", () => {
    let renders = 0;
    const store = mount(
      <Watcher
        scope="mail-ext"
        nodeId="inbox"
        onRender={(): void => {
          renders += 1;
        }}
      />,
    );
    const mounted = renders;

    act(() => {
      // A different node in the same scope, and the same node in a different
      // scope. Neither is the badge this component is watching.
      store.setBadgeCount('mail-ext', 'drafts', 4);
      store.setBadgeCount('crm-ext', 'inbox', 9);
    });

    expect(renders).toBe(mounted);
    expect(screen.getByTestId('mail-ext:inbox')).toHaveTextContent('none');
  });

  it('does not re-render when the shell context changes', () => {
    let renders = 0;
    const store = mount(
      <Watcher
        scope="mail-ext"
        nodeId="inbox"
        onRender={(): void => {
          renders += 1;
        }}
      />,
    );
    const mounted = renders;

    act(() => {
      store.setSelectedItem('msg-42');
      store.patchContext({ activeExtensionId: 'mail-ext', focusedPane: 'pane2' });
    });

    // A badge subscriber is not a context subscriber. Both notifications come
    // down the one `subscribe` channel; only the value decides.
    expect(renders).toBe(mounted);
  });

  it("reads whatever scope it is handed, including another extension's and the host's", () => {
    // The hook takes the scope as a parameter, so it reads any of them. That is
    // what a sidebar drawing every extension's badges needs, and it is no wider
    // than the public `useShellStore()` already was: badge scoping is
    // collision-resistance, not confinement.
    const store = mount(
      <>
        <Watcher scope="mail-ext" nodeId="inbox" />
        <Watcher scope="crm-ext" nodeId="inbox" />
        <Watcher scope="__host__" nodeId="inbox" />
      </>,
    );

    act(() => {
      store.setBadgeCount('mail-ext', 'inbox', 7);
      store.setBadgeCount('crm-ext', 'inbox', 3);
      store.setBadgeCount('__host__', 'inbox', 1);
    });

    // Three scopes, one node id, three different values: nothing collided, and
    // one component read each of the other two's badge.
    expect(screen.getByTestId('mail-ext:inbox')).toHaveTextContent('7');
    expect(screen.getByTestId('crm-ext:inbox')).toHaveTextContent('3');
    expect(screen.getByTestId('__host__:inbox')).toHaveTextContent('1');
  });

  it('raises INVALID_ID during render for a malformed scope, rather than reading undefined', () => {
    const error = expectRenderToThrowShellUXError(
      <Providers>
        <Watcher scope="../escape" nodeId="inbox" />
      </Providers>,
    );
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('extensionId');
    // The store's own rejection, unwrapped: it names the door it came from.
    expect(error.message).toContain('getBadgeCount');
  });

  it('raises INVALID_ID during render for a malformed node id', () => {
    const error = expectRenderToThrowShellUXError(
      <Providers>
        <Watcher scope="mail-ext" nodeId="__proto__" />
      </Providers>,
    );
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('nodeId');
  });
});
