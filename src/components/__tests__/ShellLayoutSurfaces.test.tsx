import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelProps } from 'react-resizable-panels';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createShellStateStore, useShellStore } from '../../core/ShellAPI';
import type { ShellStateStore } from '../../core/ShellAPI';
import { SCHEMA_VERSION, STORAGE_KEY, createHydrationEngine } from '../../core/services/HydrationEngine';
import type { HydrationEngine, ShellStorage } from '../../core/services/HydrationEngine';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import { ShellLayout } from '../layout/ShellLayout';
import type { ShellSurface } from '../layout/ShellLayout';

/**
 * ============================================================================
 * ONE SHELL, TWO DOCUMENTS. WHAT EACH SURFACE DRAWS AND WHAT IT REFUSES TO.
 * ============================================================================
 * Phase 7 gave the desktop host two `WebContentsView`s. A document cannot draw a
 * pane that lives in the other one, and the first attempt at that split had BOTH
 * views load the whole shell — so the launched window showed two complete shells
 * side by side, each with its own registry, its own store and its own copy of
 * every pane. This file is the assertion that that cannot come back.
 *
 * The three surfaces are a PROP on one component rather than three components,
 * because the layout arithmetic, the persistence rule, the fault boundaries and
 * the density contract are one implementation with a great many tests against
 * them — see `ShellSurface` in `src/components/layout/ShellLayout.tsx`. What is
 * asserted here is therefore what the prop changes, in both directions: a
 * surface that draws something it must not is a defect, and so is a surface that
 * stops drawing something it owns.
 *
 * `'full'` is not re-asserted here. It is the default, every other file in this
 * directory renders it, and a fourth copy of "the full shell has three panes"
 * would be the duplication this file exists to argue against.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* A recorder for the props the panel group is actually handed                */
/* -------------------------------------------------------------------------- */

interface PanelRender {
  readonly id: string;
  readonly defaultSize: number | undefined;
}

const recorded = vi.hoisted(() => ({ renders: [] as PanelRender[] }));

vi.mock('react-resizable-panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-resizable-panels')>();
  const RecordingPanel = (props: PanelProps): ReactElement => {
    recorded.renders.push({ id: String(props.id), defaultSize: props.defaultSize });
    return <actual.Panel {...props} />;
  };
  return { ...actual, Panel: RecordingPanel };
});

/** The first `defaultSize` one pane was rendered with. */
function firstDefaultSize(paneId: string): number | undefined {
  return recorded.renders.find((entry) => entry.id === paneId)?.defaultSize;
}

/* -------------------------------------------------------------------------- */
/* Storage and measurement doubles                                            */
/* -------------------------------------------------------------------------- */

interface Recorder {
  readonly storage: ShellStorage;
  /** How many times a record actually reached storage. */
  writes(): number;
}

function memoryStorage(seeded?: string): Recorder {
  const entries = new Map<string, string>();
  if (seeded !== undefined) {
    entries.set(STORAGE_KEY, seeded);
  }
  let writes = 0;
  return {
    storage: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        entries.set(key, value);
        writes += 1;
      },
    },
    writes: (): number => writes,
  };
}

/** A well-formed record of the current schema, with `overrides` applied. */
function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes: { pane1: 25, pane2: 40, pane3: 35 },
    isPane1Collapsed: false,
    activeExtensionId: null,
    extensions: {},
    ...overrides,
  });
}

/**
 * A width the shell can measure.
 *
 * jsdom reports every element as 0x0, which is the fallback-percentage path.
 * Measuring is what makes the panel group render at all, and it is what makes a
 * restored layout distinguishable from a computed one.
 */
function measureAt(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width, 800),
  );
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

function Registrar({ blueprints }: { readonly blueprints: readonly unknown[] }): null {
  const registry = useRegistry();
  const registered = useRef(false);
  useEffect(() => {
    if (registered.current) {
      return;
    }
    registered.current = true;
    for (const blueprint of blueprints) {
      registry.register(blueprint);
    }
  }, [blueprints, registry]);
  return null;
}

/** Publishes the store this provider actually owns, so a test can compare it. */
function StoreProbe({ onStore }: { readonly onStore: (store: ShellStateStore) => void }): null {
  const store = useShellStore();
  useEffect(() => {
    onStore(store);
  }, [onStore, store]);
  return null;
}

interface HarnessProps {
  readonly surface: ShellSurface;
  readonly engine?: HydrationEngine;
  readonly blueprints?: readonly unknown[];
  readonly store?: ShellStateStore;
  readonly onStore?: (store: ShellStateStore) => void;
}

function Harness({
  surface,
  engine,
  blueprints = [],
  store,
  onStore,
}: HarnessProps): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider store={store}>
        <Registrar blueprints={blueprints} />
        {onStore === undefined ? null : <StoreProbe onStore={onStore} />}
        {engine === undefined ? (
          <ShellLayout surface={surface} />
        ) : (
          <ShellLayout surface={surface} engine={engine} />
        )}
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

/** Every pane this render put on the page, by `data-pane`. */
function panesOnPage(): string[] {
  return Array.from(document.querySelectorAll('[data-pane]'))
    .map((element) => element.getAttribute('data-pane') ?? '')
    .sort();
}

beforeEach(() => {
  recorded.renders = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the host-chrome surface', () => {
  it('draws pane 1 and the two command surfaces that act on the whole shell', () => {
    measureAt(1000);
    render(<Harness surface="chrome" blueprints={[makeBlueprint()]} />);

    // The context bar is host chrome's, and so is the palette's mount point.
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample Extension' })).toBeInTheDocument();
  });

  it('draws no pane 2 and no pane 3, because they are in the other document', () => {
    measureAt(1000);
    render(<Harness surface="chrome" blueprints={[makeBlueprint()]} />);

    expect(panesOnPage()).toEqual(['pane1']);
    expect(screen.queryByRole('region', { name: 'List' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Detail' })).not.toBeInTheDocument();
  });

  it('puts pane 1 outside the panel group, because a native view edge is not a divider', () => {
    measureAt(1000);
    render(<Harness surface="chrome" blueprints={[makeBlueprint()]} />);

    // No `Panel` at all: a lone panel carrying pane 1's own `maxSize` inside a
    // group holding nothing else is a constraint the library renormalises away.
    expect(recorded.renders).toEqual([]);
    expect(document.querySelector('[data-shell-region="nav-pane"]')).not.toBeNull();
  });

  it('keeps pane 1 filling the view when navigation is collapsed, rather than leaving a 48px rail beside an empty rectangle', () => {
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ isPane1Collapsed: true })).storage,
    });
    render(<Harness surface="chrome" engine={engine} blueprints={[makeBlueprint()]} />);

    expect(panesOnPage()).toEqual(['pane1']);
    // The 48px track belongs to the full surface, where the group beside it is
    // what fills the rest of the row. There is no such group here.
    expect(document.querySelector('[data-shell-region="nav-track"]')).toBeNull();
    expect(document.querySelector('[data-shell-region="nav-pane"]')).not.toBeNull();
  });
});

describe('the extension surface', () => {
  it('draws panes 2 and 3 and neither pane 1 nor the context bar', () => {
    measureAt(1000);
    render(<Harness surface="extension" blueprints={[makeBlueprint()]} />);

    expect(panesOnPage()).toEqual(['pane2', 'pane3']);
    expect(screen.queryByRole('toolbar', { name: 'Shell commands' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
  });

  it('keeps the omnibox composer, which is pane 3 chrome rather than shell chrome', () => {
    measureAt(1000);
    render(<Harness surface="extension" blueprints={[makeBlueprint()]} />);

    // The surface that runs plug-in code is the surface the composer belongs to.
    // The first cut of this split left it in neither view.
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('re-bases a restored pane-2 share onto the pair that is actually laid out', () => {
    measureAt(1000);
    // 40 and 35 of a three-pane record. Panes 2 and 3 divide 75 between them, so
    // this group must be handed 40/75 and 35/75 — not 40 and 35, which would sum
    // to 75 and be renormalised into proportions nobody chose.
    const engine = createHydrationEngine({ storage: memoryStorage(record()).storage });
    render(<Harness surface="extension" engine={engine} blueprints={[makeBlueprint()]} />);

    const list = firstDefaultSize('pane2');
    const detail = firstDefaultSize('pane3');
    expect(list).toBeCloseTo((40 / 75) * 100, 5);
    expect(detail).toBeCloseTo(100 - ((40 / 75) * 100), 5);
    expect((list ?? 0) + (detail ?? 0)).toBeCloseTo(100, 5);
  });

  it('does not write pane sizes from the extension surface, whose group excludes pane 1', async () => {
    measureAt(1000);
    const storage = memoryStorage(record());
    const engine = createHydrationEngine({ storage: storage.storage });
    render(<Harness surface="extension" engine={engine} blueprints={[makeBlueprint()]} />);

    const before = storage.writes();
    const divider = screen.getByRole('separator', { name: 'Resize the list pane' });
    divider.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}{ArrowLeft}');

    // Every size this group announces is a share of a width that excludes pane 1.
    // Writing one into a three-pane record leaves percentages that do not divide
    // the whole, and the browser lane reads that same record.
    expect(storage.writes()).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* The host chord, and the document that has the palette in it                */
/* -------------------------------------------------------------------------- */

class FakePanes {
  readonly listeners = new Set<() => void>();
  readonly setSplit = vi.fn();
  readonly requestPalette = vi.fn();

  onPaletteRequest = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Deliver, the way `registerPaletteRouting` in main would. */
  publish(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function installHost(panes: FakePanes): () => void {
  const target = window as unknown as { shelluxHost?: unknown };
  Object.defineProperty(target, 'shelluxHost', {
    value: { panes },
    configurable: true,
    writable: true,
  });
  return () => {
    delete target.shelluxHost;
  };
}

describe('the host chord, when the palette is in the other document', () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it('hands the chord to the host from the extension surface, rather than opening nothing', async () => {
    measureAt(1000);
    const panes = new FakePanes();
    uninstall = installHost(panes);
    render(<Harness surface="extension" blueprints={[makeBlueprint()]} />);

    await userEvent.keyboard('{Control>}k{/Control}');

    // The chord was matched HERE — with this document's suppression rules, which
    // main has no way to apply — and only the surviving intent crossed.
    expect(panes.requestPalette).toHaveBeenCalledTimes(1);
  });

  it('opens the palette on the host-chrome surface without a round trip', async () => {
    measureAt(1000);
    const panes = new FakePanes();
    uninstall = installHost(panes);
    render(<Harness surface="chrome" blueprints={[makeBlueprint()]} />);

    await userEvent.keyboard('{Control>}k{/Control}');

    expect(panes.requestPalette).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the palette when the host routes a chord another surface matched', () => {
    measureAt(1000);
    const panes = new FakePanes();
    uninstall = installHost(panes);
    render(<Harness surface="chrome" blueprints={[makeBlueprint()]} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      panes.publish();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens its own palette in a browser document, where there is no other surface', async () => {
    measureAt(1000);
    render(<Harness surface="full" blueprints={[makeBlueprint()]} />);

    await userEvent.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks nobody from the extension surface when there is no host beside it', async () => {
    measureAt(1000);
    render(<Harness surface="extension" blueprints={[makeBlueprint()]} />);

    // No bridge, no other document, and no palette on this surface either. The
    // chord opens the local state and draws nothing, which is the honest answer
    // for a document nothing opens on purpose.
    await userEvent.keyboard('{Control>}k{/Control}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the store a surface is given', () => {
  it('uses the supplied store rather than creating one, which is how two documents share a context', () => {
    measureAt(1000);
    const supplied = createShellStateStore();
    let seen: ShellStateStore | null = null;
    render(
      <Harness
        surface="extension"
        store={supplied}
        onStore={(store) => {
          seen = store;
        }}
      />,
    );

    expect(seen).toBe(supplied);
  });

  it('creates its own when none is supplied, which is the browser lane', () => {
    measureAt(1000);
    let seen: ShellStateStore | null = null;
    render(
      <Harness
        surface="chrome"
        onStore={(store) => {
          seen = store;
        }}
      />,
    );

    expect(seen).not.toBeNull();
  });
});
