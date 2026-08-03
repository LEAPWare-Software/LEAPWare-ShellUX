import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHostUpdates } from '../useHostUpdates';
import type { HostUpdateState } from '../../core/updates/hostUpdates';

/**
 * ============================================================================
 * A DOCUMENT WITH A NATIVE HOST, AND A DOCUMENT WITHOUT ONE.
 * ============================================================================
 * The absent branch is jsdom's default and every browser tab's default, so it is
 * exercised by any test that does not install a bridge. The present branch is
 * exercised by writing one onto `window` for the duration of one test and
 * removing it afterwards — the same shape `useElementWidth.test.tsx` uses for
 * `ResizeObserver`, and for the same reason: a global stub installed in
 * `src/test/setup.ts` would make the absent branch unreachable, and an
 * unreachable branch is not a covered one whatever the report says.
 *
 * The fake bridge is written by hand rather than mocked, because the thing under
 * test is a contract with a preload: `getState` answers synchronously,
 * `subscribe` returns its own unsubscribe, and the hook must call that
 * unsubscribe rather than keeping a second register of its own.
 * ============================================================================
 */

type Listener = (state: HostUpdateState) => void;

class FakeBridge {
  readonly listeners = new Set<Listener>();
  unsubscribes = 0;
  readonly check = vi.fn();
  readonly restart = vi.fn();

  constructor(private state: HostUpdateState) {}

  getState = (): HostUpdateState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.unsubscribes += 1;
      this.listeners.delete(listener);
    };
  };

  /** Publish, the way the main process would. */
  publish(state: HostUpdateState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

type WithHost = { shelluxHost?: unknown };

/** Install a bridge on `window`, and hand back the uninstaller. */
function installBridge(bridge: FakeBridge): () => void {
  const target = window as unknown as WithHost;
  Object.defineProperty(target, 'shelluxHost', {
    value: { updates: bridge },
    configurable: true,
    writable: true,
  });
  return () => {
    delete target.shelluxHost;
  };
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

/** Renders whatever the hook returns, so an assertion reads the real output. */
function Probe(): ReactElement {
  const updates = useHostUpdates();
  if (updates === null) {
    return <p data-testid="status">no-host</p>;
  }
  return (
    <div>
      <p data-testid="status">{updates.state.status}</p>
      <p data-testid="version">{updates.state.version ?? 'none'}</p>
      <button type="button" onClick={() => updates.check()}>
        check
      </button>
      <button type="button" onClick={() => updates.restart()}>
        restart
      </button>
    </div>
  );
}

describe('useHostUpdates', () => {
  it('answers null in a document with no native host', () => {
    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('no-host');
  });

  it('seeds the first render from the bridge rather than from a placeholder', () => {
    const bridge = new FakeBridge({ status: 'downloaded', version: '2.0.0', detail: null });
    uninstall = installBridge(bridge);

    render(<Probe />);

    expect(screen.getByTestId('status').textContent).toBe('downloaded');
    expect(screen.getByTestId('version').textContent).toBe('2.0.0');
  });

  it('re-renders on every state the host publishes', () => {
    const bridge = new FakeBridge({ status: 'idle', version: null, detail: null });
    uninstall = installBridge(bridge);

    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('idle');

    act(() => {
      bridge.publish({ status: 'checking', version: null, detail: null });
    });
    expect(screen.getByTestId('status').textContent).toBe('checking');

    act(() => {
      bridge.publish({ status: 'error', version: null, detail: 'no feed' });
    });
    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it("unsubscribes through the host's own handle when the document unmounts", () => {
    const bridge = new FakeBridge({ status: 'idle', version: null, detail: null });
    uninstall = installBridge(bridge);

    const view = render(<Probe />);
    expect(bridge.listeners.size).toBe(1);

    view.unmount();

    expect(bridge.unsubscribes).toBe(1);
    expect(bridge.listeners.size).toBe(0);
  });

  it('passes the two intents straight through, with no arguments of its own', () => {
    const bridge = new FakeBridge({ status: 'downloaded', version: null, detail: null });
    uninstall = installBridge(bridge);

    render(<Probe />);
    act(() => {
      screen.getByRole('button', { name: 'check' }).click();
      screen.getByRole('button', { name: 'restart' }).click();
    });

    expect(bridge.check).toHaveBeenCalledTimes(1);
    expect(bridge.check).toHaveBeenCalledWith();
    expect(bridge.restart).toHaveBeenCalledTimes(1);
    expect(bridge.restart).toHaveBeenCalledWith();
  });

  it('answers null when the host object exists but publishes no updates door', () => {
    const target = window as unknown as WithHost;
    Object.defineProperty(target, 'shelluxHost', { value: {}, configurable: true, writable: true });
    uninstall = () => {
      delete target.shelluxHost;
    };

    render(<Probe />);

    expect(screen.getByTestId('status').textContent).toBe('no-host');
  });
});
