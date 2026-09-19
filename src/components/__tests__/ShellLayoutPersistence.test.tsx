import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelProps } from 'react-resizable-panels';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { useShellStore } from '../../core/ShellAPI';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import {
  DEFAULT_SHELL_STATE,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createHydrationEngine,
} from '../../core/services/HydrationEngine';
import type { HydrationEngine, ShellStorage } from '../../core/services/HydrationEngine';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * ============================================================================
 * PERSISTENCE, AS THE ASSEMBLED SHELL ACTUALLY DOES IT
 * ============================================================================
 * ISSUE-003 shipped a hydration engine and a React binding for it, both fully
 * tested, and for a while nothing rendered a single value out of either. This
 * file is the other end of that: it drives `ShellLayout` through the real
 * providers, over a real `ShellStorage`, and asserts what the SHELL restores and
 * writes rather than what the engine can do in isolation.
 *
 * ---------------------------------------------------------------------------
 * THE NO-FLASH ASSERTIONS ARE ON A RENDER LOG, NOT ON THE FINAL DOM
 * ---------------------------------------------------------------------------
 * "Does it restore?" is the easy half and the final DOM answers it. A shell that
 * hydrated in a `useEffect` would pass every such assertion ever written and
 * still paint the default layout for one frame before correcting it — the user
 * sees the correction, and the test does not.
 *
 * So `Panel` is wrapped in a recorder that logs the props `ShellLayout` handed it
 * on EVERY render, and the assertions are that the restored number is in the
 * first entry and that the number the shell would have computed for itself is in
 * no entry at all. That is a log of what this component rendered, taken from
 * inside the render pass, not a reading of what survived to the end of it.
 *
 * The wrapper is the only mock in the file, it renders the real `Panel` beneath
 * itself, and `PanelGroup` and `PanelResizeHandle` are passed through untouched —
 * so every layout, constraint and keyboard behaviour asserted below is the
 * library's own.
 * ============================================================================
 */

interface PanelRender {
  readonly id: string;
  readonly defaultSize: number | undefined;
  readonly minSize: number | undefined;
  readonly maxSize: number | undefined;
}

const recorded = vi.hoisted(() => ({ renders: [] as PanelRender[] }));

vi.mock('react-resizable-panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-resizable-panels')>();
  const RecordingPanel = (props: PanelProps): ReactElement => {
    recorded.renders.push({
      id: String(props.id),
      defaultSize: props.defaultSize,
      minSize: props.minSize,
      maxSize: props.maxSize,
    });
    return <actual.Panel {...props} />;
  };
  return { ...actual, Panel: RecordingPanel };
});

/** Every `defaultSize` one pane was rendered with, oldest first. */
function defaultSizesFor(paneId: string): (number | undefined)[] {
  return recorded.renders.filter((entry) => entry.id === paneId).map((entry) => entry.defaultSize);
}

/** Whether a pane-1 `Panel` was rendered at all. */
function renderedPaneIds(): string[] {
  return [...new Set(recorded.renders.map((entry) => entry.id))].sort();
}

/* -------------------------------------------------------------------------- */
/* Storage doubles                                                            */
/* -------------------------------------------------------------------------- */

interface Recorder {
  readonly storage: ShellStorage;
  /** How many times a record actually reached storage. */
  writes(): number;
  /** The stored text, or `null`. */
  raw(): string | null;
}

/**
 * A `ShellStorage` over a `Map`, counting the writes that reach it.
 *
 * The count is the whole point of the debounce case: the engine coalesces, so a
 * drag that produces one `setSlot` per frame has to produce one `setItem`.
 */
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
    raw: (): string | null => entries.get(STORAGE_KEY) ?? null,
  };
}

/** A storage that refuses every operation, the way a locked-down browser does. */
const refusingStorage: ShellStorage = {
  getItem: (): never => {
    throw new Error('storage refused');
  },
  setItem: (): never => {
    throw new Error('storage refused');
  },
};

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
 * A window width the shell can measure.
 *
 * jsdom reports every element as 0x0, which is the case where `percentOf` falls
 * back to `PANE_FALLBACK_PERCENT` and every constant is a hand-written
 * percentage. At 1000px the pixel intent in `PANE_PX` converts to 24/36/40, so a
 * restored 25/40/35 is distinguishable from the layout the shell would have
 * computed for itself — which is exactly what the no-flash assertions need.
 */
function measureAt(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width, 800),
  );
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/** Registers each blueprint once, from inside the provider, as a plug-in would. */
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

/**
 * A shell store listener that throws once the named extension takes the
 * foreground.
 *
 * `useShellStore()` is public, so this is plug-in code doing something a plug-in
 * can do. It is the hazard the restore effect's guard exists for: the effect
 * publishes the foreground through the store, the store notifies synchronously,
 * and a throw from a passive effect reaches no error boundary.
 */
function ThrowingStoreListener({ onForeground }: { readonly onForeground: string }): null {
  const store = useShellStore();
  useEffect(
    () =>
      store.subscribe(() => {
        if (store.getContext().activeExtensionId === onForeground) {
          throw new Error('a plug-in listener exploded');
        }
      }),
    [store, onForeground],
  );
  return null;
}

interface HarnessProps {
  readonly engine: HydrationEngine;
  readonly blueprints?: readonly unknown[];
  /** Extension id whose activation a plug-in listener should detonate on. */
  readonly sabotageForeground?: string;
}

function Harness({ engine, blueprints = [], sabotageForeground }: HarnessProps): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        {sabotageForeground === undefined ? null : (
          <ThrowingStoreListener onForeground={sabotageForeground} />
        )}
        <Registrar blueprints={blueprints} />
        <ShellLayout engine={engine} />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

/** The `data-panel-size` of every panel currently in the group, as numbers. */
function panelSizes(): number[] {
  return Array.from(document.querySelectorAll('[data-panel-size]')).map((element) =>
    Number(element.getAttribute('data-panel-size')),
  );
}

/**
 * Focus the first divider and drive `keys` through the library's own
 * window-splitter keyboard behaviour.
 *
 * Repeated `{ArrowLeft}` is NOT the same as repeated layout changes: the first
 * press pins pane 1 at its own minimum and every press after it moves nothing,
 * so a case that needs several distinct layouts has to alternate directions.
 */
async function nudgeFirstDivider(
  user: ReturnType<typeof userEvent.setup>,
  keys: string,
): Promise<void> {
  const [first] = screen.getAllByRole('separator');
  act(() => {
    (first as HTMLElement).focus();
  });
  await user.keyboard(keys);
}

/** Drive the first divider fully toward pane 1, which is one layout change. */
async function narrowFirstPane(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await nudgeFirstDivider(user, '{ArrowLeft}');
}

afterEach(() => {
  recorded.renders.length = 0;
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('ShellLayout — restoring a persisted layout', () => {
  it('renders the restored pane sizes on the panel group first render, and the measured default never', () => {
    measureAt(1000);
    const engine = createHydrationEngine({ storage: memoryStorage(record()).storage });
    expect(engine.getLastLoad()).toBe('restored');

    render(<Harness engine={engine} />);

    // THE ASSERTION THAT MATTERS, AND IT IS ON THE RENDER LOG. A hook that
    // hydrated in an effect would have 24 at index 0 and 25 after it; this has
    // 25 at index 0 and never has 24 at all.
    const pane1 = defaultSizesFor('pane1');
    expect(pane1.length).toBeGreaterThan(0);
    expect(pane1[0]).toBe(25);
    expect(pane1).not.toContain(24);
    // 240px of 1000px is 24% and 360px is 36% — the numbers this shell computes
    // for itself when nothing is stored, asserted as ABSENT from the log.
    expect(defaultSizesFor('pane2')[0]).toBe(40);
    expect(defaultSizesFor('pane2')).not.toContain(36);

    // ...and it survived to the DOM as well, so the log is not describing a
    // render that was then thrown away.
    expect(panelSizes()).toEqual([25, 40, 35]);
  });

  it('renders the collapsed icon track on the first render, and the expanded navigation panel never', () => {
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ isPane1Collapsed: true })).storage,
    });

    const { container } = render(<Harness engine={engine} />);

    // Collapse is a different component tree, not a small panel — so "the
    // expanded state never rendered" IS "no pane-1 Panel was ever rendered".
    // One render of the expanded tree would put `pane1` in this list.
    expect(renderedPaneIds()).toEqual(['pane2', 'pane3']);
    expect(DEFAULT_SHELL_STATE.isPane1Collapsed).toBe(false);
    // Wave 3, W3-3: `TOKEN_CLASS.railWidth` (`--rail-w`), not an inline style.
    expect(
      (container.querySelector('[data-shell-region="nav-track"]') as HTMLElement).className,
    ).toContain(TOKEN_CLASS.railWidth);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('derives the pane sizes from the measured width when nothing has been persisted', () => {
    // The control for the branch above: with an empty storage the engine serves
    // the one shared `DEFAULT_SHELL_STATE`, the shell recognises it by identity,
    // and the pixel intent in `PANE_PX` is what reaches the panels.
    measureAt(1000);
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    expect(engine.getLastLoad()).toBe('absent');

    render(<Harness engine={engine} />);
    expect(panelSizes()).toEqual([24, 36, 40]);
    expect(defaultSizesFor('pane1')).not.toContain(18);
  });

  it('clamps a restored pane size that no longer fits the pane minimums at this width', () => {
    // Both numbers are legal for the ENGINE — inside `[2, 90]` — and illegal for
    // this WIDTH: 88% of 1000px is 880px against pane 1's 400px maximum, and 5%
    // is 50px against pane 2's 240px minimum. A layout saved on one monitor and
    // reopened on another arrives exactly like this.
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ paneSizes: { pane1: 88, pane2: 5, pane3: 7 } })).storage,
    });

    render(<Harness engine={engine} />);

    // 400/1000 and 240/1000: the pane's own band at this width, not the record's.
    expect(defaultSizesFor('pane1')[0]).toBe(40);
    expect(defaultSizesFor('pane2')[0]).toBe(24);
    // The illegal values never reached a panel, rather than reaching one and
    // being corrected by the library afterwards.
    expect(defaultSizesFor('pane1')).not.toContain(88);
    expect(defaultSizesFor('pane2')).not.toContain(5);
    // Pane 3 absorbs the difference, so the three still divide the whole.
    expect(panelSizes()).toEqual([40, 24, 36]);
  });

  it('keeps the pixel intent after a write nobody made about the panes, at a width where the two differ', async () => {
    // 1920px, because that is where the engine's default record and the pixel
    // table disagree loudest: 240px of 1920px is 12.5%, and the record's own
    // default pane 1 is 18% — 345.6px, 105.6px wider than the intent.
    measureAt(1920);
    const user = userEvent.setup();
    const recorder = memoryStorage();
    const first = createHydrationEngine({ storage: recorder.storage });

    const view = render(<Harness engine={first} blueprints={[makeBlueprint()]} />);
    // Activating an extension writes the foreground slot and nothing else. The
    // panes are untouched, so the record it produces still holds the defaults.
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    act(() => {
      first.flush();
    });
    expect(first.getState().paneSizes).toBe(DEFAULT_SHELL_STATE.paneSizes);
    expect(recorder.raw()).not.toBeNull();
    view.unmount();
    recorded.renders.length = 0;

    // A fresh engine over the same entry: a reload. The record is restored, but
    // nobody ever chose a layout, so the pixel intent is still what should open.
    const second = createHydrationEngine({ storage: recorder.storage });
    expect(second.getLastLoad()).toBe('restored');
    render(<Harness engine={second} blueprints={[makeBlueprint()]} />);

    expect(defaultSizesFor('pane1')[0]).toBe(12.5);
    expect(defaultSizesFor('pane1')).not.toContain(DEFAULT_SHELL_STATE.paneSizes.pane1);
  });

  it('discards a hand-edited record whose pane size is outside the engine band, and renders the measured defaults', () => {
    measureAt(1000);
    // 95% is outside `[MIN_PANE_PERCENT, MAX_PANE_PERCENT]`. The collapsed flag
    // beside it is well-formed and is the control: an engine that spread the
    // good fields of a bad payload would open this shell collapsed.
    const engine = createHydrationEngine({
      storage: memoryStorage(
        record({ paneSizes: { pane1: 95, pane2: 3, pane3: 2 }, isPane1Collapsed: true }),
      ).storage,
    });
    expect(engine.getLastLoad()).toBe('malformed');

    const { container } = render(<Harness engine={engine} />);

    expect(container.querySelector('[data-shell-region="nav-track"]')).toBeNull();
    expect(panelSizes()).toEqual([24, 36, 40]);
    expect(defaultSizesFor('pane1')).not.toContain(95);
  });
});

describe('ShellLayout — writing a persisted layout', () => {
  it('coalesces a keyboard-driven resize into one storage write rather than one per frame', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const recorder = memoryStorage();
    // A window long enough that it provably cannot close on its own during this
    // test, so the count below is the engine's coalescing and not a race.
    const engine = createHydrationEngine({ storage: recorder.storage, debounceMs: 100_000 });
    let commits = 0;
    engine.subscribe(() => {
      commits += 1;
    });

    render(<Harness engine={engine} />);
    // Alternating, so every press really is a new layout — the two panels either
    // side of the divider report a new size on each one.
    await nudgeFirstDivider(user, '{ArrowLeft}{ArrowRight}{ArrowLeft}{ArrowRight}{ArrowLeft}');

    // Five layout changes moving two panels each, so the engine took at least
    // ten separate slot writes...
    expect(commits).toBeGreaterThanOrEqual(10);
    // ...and not one of them reached storage. This is the whole requirement: a
    // drag must not be one synchronous `setItem` per frame.
    expect(recorder.writes()).toBe(0);

    act(() => {
      engine.flush();
    });
    expect(recorder.writes()).toBe(1);
    // And what was written is the FINAL layout, not the first frame of it.
    expect(engine.getState().paneSizes.pane1).toBeLessThan(24);
    expect(JSON.parse(recorder.raw() as string)).toMatchObject({
      paneSizes: engine.getState().paneSizes,
    });
  });

  it('writes nothing at all for a mount nobody resized', () => {
    measureAt(1000);
    const recorder = memoryStorage();
    const engine = createHydrationEngine({ storage: recorder.storage });

    render(<Harness engine={engine} blueprints={[makeBlueprint()]} />);
    act(() => {
      engine.flush();
    });

    // The group announces its own initial layout through the same callback a
    // drag uses, and that announcement reports no previous size. Persisting it
    // would mean every shell that ever opened had "chosen" a layout.
    expect(recorder.writes()).toBe(0);
    expect(recorder.raw()).toBeNull();
    expect(engine.getState().paneSizes).toBe(DEFAULT_SHELL_STATE.paneSizes);
  });

  it('persists a pane size the user changed, and a second shell over the same storage opens into it', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const recorder = memoryStorage();
    const first = createHydrationEngine({ storage: recorder.storage });

    const view = render(<Harness engine={first} />);
    await narrowFirstPane(user);
    act(() => {
      first.flush();
    });
    const chosen = panelSizes();
    expect(chosen[0]).toBeLessThan(24);
    view.unmount();
    recorded.renders.length = 0;

    // A fresh engine over the same entry: a reload, in every way that matters.
    const second = createHydrationEngine({ storage: recorder.storage });
    expect(second.getLastLoad()).toBe('restored');
    render(<Harness engine={second} />);

    expect(defaultSizesFor('pane1')[0]).toBeCloseTo(chosen[0] as number, 5);
    expect(panelSizes()).toEqual(chosen);
  });

  it('does not persist a pane size while pane 1 is collapsed, because the two panes divide a different width', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });

    render(<Harness engine={engine} />);
    // A real layout first, so the assertion is "frozen", not "still empty".
    await narrowFirstPane(user);
    const beforeCollapse = engine.getState().paneSizes;
    expect(beforeCollapse).not.toBe(DEFAULT_SHELL_STATE.paneSizes);

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    // The remaining divider still resizes; the two panes just divide a width
    // that excludes the 48px track, so their percentages mean something else.
    await narrowFirstPane(user);

    expect(engine.getState().paneSizes).toBe(beforeCollapse);
  });

  it('records one three-pane layout, so the persisted percentages divide the whole', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });

    render(<Harness engine={engine} />);
    // One divider moves TWO panes and leaves the third alone. A record patched
    // one reported slot at a time therefore keeps whatever the untouched slot
    // held — which, for a shell nobody had resized yet, is the engine's own
    // 1360px-reference default rather than anything this width produced.
    await narrowFirstPane(user);

    const stored = engine.getState().paneSizes;
    expect([stored.pane1, stored.pane2, stored.pane3]).toEqual(panelSizes());
    expect(stored.pane1 + stored.pane2 + stored.pane3).toBeCloseTo(100, 5);
  });

  it('leaves the persisted layout exactly as it was across a collapse and a re-expansion', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });

    render(<Harness engine={engine} />);
    await narrowFirstPane(user);
    const chosen = engine.getState().paneSizes;
    expect(chosen).not.toBe(DEFAULT_SHELL_STATE.paneSizes);

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));

    // Re-adding pane 1 makes the library re-normalise a group that had two
    // panels into one that has three, and every panel reports the result. None
    // of it is a size the user chose, so identity: not one slot moved.
    expect(engine.getState().paneSizes).toBe(chosen);
  });

  it('leaves it alone even when the collapsed group was resized before pane 1 came back', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });

    render(<Harness engine={engine} />);
    await narrowFirstPane(user);
    const chosen = engine.getState().paneSizes;

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    // Two more layouts while collapsed, which is what drives the LIBRARY's idea
    // of each pane's previous size further from the last one this shell saw.
    // The refusal is stated as "a previous size this shell never saw", so this
    // is the case that says the two do not have to be one step apart.
    await nudgeFirstDivider(user, '{ArrowLeft}{ArrowRight}');
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));

    expect(engine.getState().paneSizes).toBe(chosen);
  });

  it('records a whole layout for the first resize after a shell that opened collapsed', async () => {
    // The path where pane 1 has never once reported inside this mount: its
    // panel does not exist while the track is showing, so until the user
    // expands, the restored record is the only thing the shell knows about it.
    //
    // THE SEED HAS TO BE ONE THIS WIDTH CORRECTS, or this case cannot fail. A
    // shell that opens collapsed mounts panes 1 and 2 at their RESTORED sizes
    // when it expands, so for a restorable record the layout on screen and the
    // record agree by construction and any bookkeeping at all looks right.
    // 88/5/7 is legal for the engine and illegal at 1000px — clamped to 40/24
    // and a 36 remainder — so the two disagree and the bookkeeping shows.
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({
      storage: memoryStorage(
        record({ paneSizes: { pane1: 88, pane2: 5, pane3: 7 }, isPane1Collapsed: true }),
      ).storage,
    });

    render(<Harness engine={engine} />);
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    await narrowFirstPane(user);

    const stored = engine.getState().paneSizes;
    expect([stored.pane1, stored.pane2, stored.pane3]).toEqual(panelSizes());
    expect(stored.pane1 + stored.pane2 + stored.pane3).toBeCloseTo(100, 5);
  });

  it('persists the pane-1 collapsed flag, and a second shell over the same storage opens collapsed', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const recorder = memoryStorage();
    const first = createHydrationEngine({ storage: recorder.storage });

    const view = render(<Harness engine={first} />);
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(first.getState().isPane1Collapsed).toBe(true);
    act(() => {
      first.flush();
    });
    view.unmount();
    recorded.renders.length = 0;

    const second = createHydrationEngine({ storage: recorder.storage });
    const { container } = render(<Harness engine={second} />);
    expect(container.querySelector('[data-shell-region="nav-track"]')).not.toBeNull();
    expect(renderedPaneIds()).toEqual(['pane2', 'pane3']);

    // ...and it toggles back off through the same slot, so the flag is bound and
    // not merely read once.
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(second.getState().isPane1Collapsed).toBe(false);
  });

  it('persists no drawer state, so a reload opens with the drawer shut', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const recorder = memoryStorage();
    const first = createHydrationEngine({ storage: recorder.storage });

    const view = render(<Harness engine={first} />);
    await user.click(screen.getByRole('button', { name: 'Show utility drawer' }));
    expect(document.querySelector('[data-pane-slot="drawer"]')).not.toBeNull();
    act(() => {
      first.flush();
    });
    // The drawer is a transient inspection of pane 3, not a layout the user
    // arranged. Nothing about it is in the record — asserted on the record TEXT,
    // so a slot added later without a decision fails here.
    //
    // **This used to assert that the record was absent entirely, and that stopped
    // being the right assertion when the command registry landed.** Toggling the
    // drawer is now running a HOST COMMAND, and a command that runs is recorded
    // in the recents slot — so a record exists, and the case has to say what it
    // really means rather than relying on emptiness. `drawer` is asserted absent
    // by name in both directions: the field is not there, and the only thing that
    // moved is the recents entry naming the command the user invoked.
    const record = JSON.parse(recorder.raw() ?? '') as Record<string, unknown>;
    // The KEYS of the record, exhaustively, so a slot added later without a
    // decision fails here — which is what the old `toBeNull()` was buying.
    expect(Object.keys(record).sort()).toEqual([
      'activeExtensionId',
      'extensions',
      'isPane1Collapsed',
      'paneSizes',
      'recentCommandIds',
      'v',
    ]);
    // And the one thing that DID move is the recents entry naming the command the
    // user invoked — not the drawer's own state, which is nowhere in the record.
    expect(record['recentCommandIds']).toEqual(['host:host-toggle-drawer']);
    view.unmount();

    const second = createHydrationEngine({ storage: recorder.storage });
    render(<Harness engine={second} />);
    expect(document.querySelector('[data-pane-slot="drawer"]')).toBeNull();
  });
});

describe('ShellLayout — the persisted active extension', () => {
  it('brings the persisted extension back to the foreground once it registers', async () => {
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ activeExtensionId: 'sample-ext' })).storage,
    });

    render(<Harness engine={engine} blueprints={[makeBlueprint()]} />);

    // The extension registers from its own mount effect, which is one commit
    // after the shell's first render — so the restore has to be retried on the
    // registry revision rather than attempted once at mount.
    expect(await screen.findByRole('button', { name: 'Sample Extension' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Root A badge 3' })).toBeInTheDocument();
  });

  it('activates nothing and throws nothing for a persisted extension id the registry does not know', async () => {
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ activeExtensionId: 'ghost-ext' })).storage,
    });

    render(<Harness engine={engine} blueprints={[makeBlueprint()]} />);
    const listed = await screen.findByRole('button', { name: 'Sample Extension' });

    expect(listed).not.toHaveAttribute('aria-current');
    expect(screen.getByText('No extension selected')).toBeInTheDocument();
    // The id is RETAINED, not erased. A lazily loaded extension is
    // indistinguishable from an uninstalled one, so forgetting it here would
    // lose the foreground of every extension the user has not opened yet.
    expect(engine.getState().activeExtensionId).toBe('ghost-ext');
  });

  it('records the foreground the user chose, and records null when the user closes it', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });

    render(<Harness engine={engine} blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    expect(engine.getState().activeExtensionId).toBe('sample-ext');

    await user.click(screen.getByRole('button', { name: 'Close extension' }));
    expect(engine.getState().activeExtensionId).toBeNull();
  });

  it('stops waiting for the persisted extension once the user activates a different one', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ activeExtensionId: 'ghost-ext' })).storage,
    });

    render(<Harness engine={engine} blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));

    // The pending restore is spent: the user's choice is the foreground, and
    // writing it back is what proves the shell stopped holding the record still.
    expect(engine.getState().activeExtensionId).toBe('sample-ext');
    await user.click(screen.getByRole('button', { name: 'Close extension' }));
    expect(engine.getState().activeExtensionId).toBeNull();
  });

  it('keeps the shell mounted when a shell store listener throws while the foreground is restored', async () => {
    measureAt(1000);
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ activeExtensionId: 'sample-ext' })).storage,
    });

    render(
      <Harness
        engine={engine}
        blueprints={[makeBlueprint()]}
        sabotageForeground="sample-ext"
      />,
    );
    await screen.findByRole('button', { name: 'Sample Extension' });

    // The restore runs from a passive effect, where an escaping throw reaches no
    // error boundary and unmounts the whole root. The shell is still here.
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(
      reported.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].startsWith('ShellLayout:'),
      ),
    ).toBe(true);
  });

  it('survives a console.error that throws while reporting a failed restore', async () => {
    measureAt(1000);
    // `console` is no more the host's object than a listener is. A plug-in that
    // replaces `console.error` with a throwing function would otherwise turn the
    // report into a SECOND escape from the same effect.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
      if (typeof args[0] === 'string' && args[0].startsWith('ShellLayout:')) {
        throw new Error('console refused');
      }
    });
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ activeExtensionId: 'sample-ext' })).storage,
    });

    render(
      <Harness
        engine={engine}
        blueprints={[makeBlueprint()]}
        sabotageForeground="sample-ext"
      />,
    );
    await screen.findByRole('button', { name: 'Sample Extension' });

    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });
});

describe('ShellLayout — persistence with no usable storage', () => {
  it('renders, resizes and collapses with a storage that throws on every access', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: refusingStorage });
    expect(engine.getLastLoad()).toBe('unreadable');

    const { container } = render(<Harness engine={engine} blueprints={[makeBlueprint()]} />);

    // Rendering at all is the first half.
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
    expect(panelSizes()).toEqual([24, 36, 40]);

    // Still resizes — the engine serves the layout from memory, and no member of
    // it throws because the mirroring failed.
    await narrowFirstPane(user);
    expect(panelSizes()[0]).toBeLessThan(24);
    expect(engine.getState().paneSizes.pane1).toBeLessThan(24);

    // Still collapses, and the flag is held in memory across the toggle.
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(container.querySelector('[data-shell-region="nav-track"]')).not.toBeNull();
    expect(engine.getState().isPane1Collapsed).toBe(true);

    // Degraded, and honest about it. `flush` retries the write, which throws
    // again inside the engine and is swallowed there rather than here.
    act(() => {
      engine.flush();
    });
    expect(engine.isPersistent()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('ShellLayout — the process-wide engine', () => {
  it('falls back to the shared localStorage engine when no engine prop is supplied', () => {
    // Every other case in this file injects an engine, which would leave the
    // default path — the one `App.tsx` actually uses — untested. This is the
    // only case that reaches it, so it is deliberately read-only: it asserts
    // that the shell mounts against the ambient `localStorage` and finds the
    // entry `STORAGE_KEY` names.
    measureAt(1000);
    globalThis.localStorage.removeItem(STORAGE_KEY);
    render(
      <ExtensionRegistryProvider>
        <ShellHostProvider>
          <ShellLayout />
        </ShellHostProvider>
      </ExtensionRegistryProvider>,
    );
    expect(screen.getByRole('toolbar', { name: 'Shell commands' })).toBeInTheDocument();
    expect(panelSizes()).toHaveLength(3);
  });
});

/* Guard against the recorder silently recording nothing, which would make every
 * "never contains" assertion above pass vacuously. */
describe('the Panel recorder', () => {
  it('records a defaultSize for all three panes, so the render log is not empty', () => {
    measureAt(1000);
    render(<Harness engine={createHydrationEngine({ storage: null })} />);
    expect(renderedPaneIds()).toEqual(['pane1', 'pane2', 'pane3']);
    for (const pane of ['pane1', 'pane2', 'pane3']) {
      expect(defaultSizesFor(pane).length, `${pane} render log`).toBeGreaterThan(0);
      expect(defaultSizesFor(pane)[0], `${pane} defaultSize`).toEqual(expect.any(Number));
    }
  });
});
