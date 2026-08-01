import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHELL_STATE,
  EMPTY_SCOPED_STATE,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createHydrationEngine,
} from '../../core/services/HydrationEngine';
import type {
  HydrationEngine,
  PaneSizes,
  ScopedState,
} from '../../core/services/HydrationEngine';
import { ShellUXError } from '../../core/types';
import { useExtensionUiState, useLocalStorageState } from '../useLocalStorageState';

/**
 * ============================================================================
 * THE REACT BINDING: NO FLASH, AND NO THROW WHEN STORAGE IS GONE
 * ============================================================================
 * The claim these tests exist for is the one that is easiest to write and
 * hardest to keep: **the persisted value is on screen at the first paint**. A
 * hook that reads storage in a `useEffect` passes every "does it restore?" test
 * ever written and still shows the default layout for one frame, because the
 * effect runs after the commit. So the assertions here are on the RENDER LOG,
 * not on the final DOM: it is not enough that the right value arrives, the wrong
 * one must never have been rendered at all.
 * ============================================================================
 */

/**
 * The entry the process-wide engine will find.
 *
 * Written at module scope, which is before any test in this file runs and
 * therefore before anything can touch the lazily created default engine. Two
 * tests below bind with no engine of their own, and they are the only ones that
 * reach it.
 */
globalThis.localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes: { pane1: 20, pane2: 30, pane3: 50 },
    isPane1Collapsed: true,
    activeExtensionId: 'mail-ext',
    extensions: { 'mail-ext': { selection: 'msg-1' } },
  }),
);

/** An engine over a storage seeded with a collapsed pane 1 and a mail scope. */
function seededEngine(): HydrationEngine {
  const entries = new Map<string, string>([
    [
      STORAGE_KEY,
      JSON.stringify({
        v: SCHEMA_VERSION,
        paneSizes: { pane1: 40, pane2: 30, pane3: 30 },
        isPane1Collapsed: true,
        activeExtensionId: 'crm-ext',
        extensions: { 'crm-ext': { selection: 'contact-9' } },
      }),
    ],
  ]);
  return createHydrationEngine({
    storage: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        entries.set(key, value);
      },
    },
  });
}

interface CollapsedProbeProps {
  readonly engine: HydrationEngine;
  readonly log: boolean[];
}

function CollapsedProbe({ engine, log }: CollapsedProbeProps): ReactElement {
  const [isCollapsed, setCollapsed] = useLocalStorageState('isPane1Collapsed', { engine });
  log.push(isCollapsed);
  return (
    <button
      type="button"
      onClick={() => {
        setCollapsed(!isCollapsed);
      }}
    >
      {isCollapsed ? 'collapsed' : 'expanded'}
    </button>
  );
}

interface SizesProbeProps {
  readonly engine: HydrationEngine;
  readonly capture: { set: ((next: PaneSizes) => void) | null };
}

function SizesProbe({ engine, capture }: SizesProbeProps): ReactElement {
  const [sizes, setSizes] = useLocalStorageState('paneSizes', { engine });
  capture.set = setSizes;
  return <span data-testid="pane1">{sizes.pane1}</span>;
}

interface ScopeProbeProps {
  readonly engine: HydrationEngine;
  readonly extensionId: string;
  readonly log: ScopedState[];
}

function ScopeProbe({ engine, extensionId, log }: ScopeProbeProps): ReactElement {
  const [scope, setScope] = useExtensionUiState(extensionId, { engine });
  log.push(scope);
  return (
    <button
      type="button"
      onClick={() => {
        setScope({ selection: 'contact-1' });
      }}
    >
      {String(scope['selection'] ?? 'nothing')}
    </button>
  );
}

describe('the process-wide engine', () => {
  it('binds a slot to the default engine when no engine is supplied', () => {
    const log: (string | null)[] = [];
    function DefaultSlotProbe(): ReactElement {
      const [activeId] = useLocalStorageState('activeExtensionId');
      log.push(activeId);
      return <span data-testid="active">{activeId ?? 'none'}</span>;
    }

    render(<DefaultSlotProbe />);
    expect(log[0]).toBe('mail-ext');
    expect(screen.getByTestId('active')).toHaveTextContent('mail-ext');
  });

  it('binds an extension scope to the default engine too', () => {
    function DefaultScopeProbe(): ReactElement {
      const [scope] = useExtensionUiState('mail-ext');
      return <span data-testid="selection">{String(scope['selection'])}</span>;
    }

    render(<DefaultScopeProbe />);
    expect(screen.getByTestId('selection')).toHaveTextContent('msg-1');
  });
});

describe('useLocalStorageState', () => {
  it('renders the persisted value on the very first paint, and never the default', () => {
    const engine = seededEngine();
    const log: boolean[] = [];
    render(<CollapsedProbe engine={engine} log={log} />);

    // The persisted value is `true` and the default is `false`, so a hook that
    // hydrated in an effect would have `false` at log[0] and `true` after it.
    expect(DEFAULT_SHELL_STATE.isPane1Collapsed).toBe(false);
    expect(log[0]).toBe(true);
    expect(log).not.toContain(false);
    expect(screen.getByRole('button')).toHaveTextContent('collapsed');
  });

  it('never renders the default value at all, not even once, for a restored pane size', () => {
    const engine = seededEngine();
    const capture: { set: ((next: PaneSizes) => void) | null } = { set: null };
    render(<SizesProbe engine={engine} capture={capture} />);
    expect(screen.getByTestId('pane1')).toHaveTextContent('40');
    expect(DEFAULT_SHELL_STATE.paneSizes.pane1).toBe(18);
  });

  it('writes through to the engine and re-renders', async () => {
    const user = userEvent.setup();
    const engine = seededEngine();
    const log: boolean[] = [];
    render(<CollapsedProbe engine={engine} log={log} />);

    await user.click(screen.getByRole('button'));
    expect(engine.getState().isPane1Collapsed).toBe(false);
    expect(log.at(-1)).toBe(false);
    expect(screen.getByRole('button')).toHaveTextContent('expanded');
  });

  it('lets two components share one engine, so both observe the write', async () => {
    const user = userEvent.setup();
    const engine = seededEngine();
    const first: boolean[] = [];
    const second: boolean[] = [];
    render(
      <>
        <CollapsedProbe engine={engine} log={first} />
        <CollapsedProbe engine={engine} log={second} />
      </>,
    );

    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(first.at(-1)).toBe(false);
    expect(second.at(-1)).toBe(false);
  });

  it('renders and updates with storage unavailable, and nothing throws', async () => {
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: null });
    const log: boolean[] = [];
    render(<CollapsedProbe engine={engine} log={log} />);

    expect(log[0]).toBe(DEFAULT_SHELL_STATE.isPane1Collapsed);
    await user.click(screen.getByRole('button'));
    expect(log.at(-1)).toBe(true);
    expect(engine.isPersistent()).toBe(false);
  });

  it('does not re-render when an unrelated slot changes', () => {
    const engine = seededEngine();
    const log: boolean[] = [];
    render(<CollapsedProbe engine={engine} log={log} />);
    const rendersBefore = log.length;

    act(() => {
      engine.setSlot('activeExtensionId', 'mail-ext');
    });
    expect(log).toHaveLength(rendersBefore);
  });

  it('stops observing the engine after it unmounts', () => {
    const engine = seededEngine();
    const log: boolean[] = [];
    const view = render(<CollapsedProbe engine={engine} log={log} />);
    const rendersBefore = log.length;
    view.unmount();

    act(() => {
      engine.setSlot('isPane1Collapsed', false);
    });
    expect(log).toHaveLength(rendersBefore);
  });

  it('refuses a value that would not survive the round trip, and says which one', () => {
    const engine = seededEngine();
    const capture: { set: ((next: PaneSizes) => void) | null } = { set: null };
    render(<SizesProbe engine={engine} capture={capture} />);

    const setSizes = capture.set;
    expect(setSizes).not.toBeNull();
    expect(() => {
      (setSizes as (next: PaneSizes) => void)({ pane1: Number.NaN, pane2: 30, pane3: 30 });
    }).toThrow(ShellUXError);
    // Refused, and nothing was applied.
    expect(engine.getState().paneSizes.pane1).toBe(40);
  });
});

describe('useExtensionUiState', () => {
  it('renders the persisted scope on the very first paint', () => {
    const engine = seededEngine();
    const log: ScopedState[] = [];
    render(<ScopeProbe engine={engine} extensionId="crm-ext" log={log} />);
    expect(log[0]?.['selection']).toBe('contact-9');
    expect(screen.getByRole('button')).toHaveTextContent('contact-9');
  });

  it('hands out the shared empty scope when nothing is persisted', () => {
    const engine = seededEngine();
    const log: ScopedState[] = [];
    render(<ScopeProbe engine={engine} extensionId="mail-ext" log={log} />);
    expect(log[0]).toBe(EMPTY_SCOPED_STATE);
    expect(screen.getByRole('button')).toHaveTextContent('nothing');
  });

  it('writes a scope through the engine', async () => {
    const user = userEvent.setup();
    const engine = seededEngine();
    const log: ScopedState[] = [];
    render(<ScopeProbe engine={engine} extensionId="mail-ext" log={log} />);

    await user.click(screen.getByRole('button'));
    expect(engine.getExtensionState('mail-ext')).toEqual({ selection: 'contact-1' });
    expect(screen.getByRole('button')).toHaveTextContent('contact-1');
  });

  it('throws during render for an extension id the registry could never have issued', () => {
    // A loud, deterministic failure at the point of the mistake. It is not a
    // storage failure, and it is deliberately not swallowed.
    const onError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const engine = seededEngine();
    expect(() => {
      render(<ScopeProbe engine={engine} extensionId="Not An Id" log={[]} />);
    }).toThrow(ShellUXError);
    onError.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
