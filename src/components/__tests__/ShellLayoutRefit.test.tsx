import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider } from '../../core/RegistryContext';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  createHydrationEngine,
} from '../../core/services/HydrationEngine';
import type { HydrationEngine, ShellStorage } from '../../core/services/HydrationEngine';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * ============================================================================
 * THE RE-FIT ON A GROUP-WIDTH CHANGE (GitHub issue #23), AS ARITHMETIC.
 * ============================================================================
 * Every case here drives the real `ShellLayout` and the real
 * `react-resizable-panels` through a width change and reads the shares the
 * library committed from `data-panel-size`. **jsdom lays nothing out**, so the
 * widths are stubbed through `getBoundingClientRect` and delivered through a
 * fake `ResizeObserver`: these cases are arithmetic over invented widths and say
 * nothing about pixels. What a real window lays out after a real viewport resize
 * is `e2e/pane-refit.spec.ts`'s question.
 *
 * The fake is installed per test rather than in `src/test/setup.ts`, for the
 * reason `src/hooks/useElementWidth.ts` gives: a global stub would make the
 * no-observer branch every other shell test takes unreachable.
 * ============================================================================
 */

const observers: (() => void)[] = [];

class FakeResizeObserver {
  constructor(callback: () => void) {
    observers.push(callback);
  }
  observe(): void {
    /* the hook re-reads the element itself */
  }
  disconnect(): void {
    /* nothing to tear down in a fake */
  }
}

/** Every element measures `width` wide from now on. */
function measureAt(width: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width, 800),
  );
}

/** The group becomes `width` wide and the observer says so, as a window resize does. */
function resizeTo(width: number): void {
  measureAt(width);
  act(() => {
    for (const fire of observers) {
      fire();
    }
  });
}

/** A `ShellStorage` over a `Map`, counting the writes that reach it. */
function memoryStorage(seeded?: string): { storage: ShellStorage; writes: () => number } {
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

/** A well-formed record holding `paneSizes`. */
function record(
  paneSizes: { pane1: number; pane2: number; pane3: number },
  isPane1Collapsed = false,
): string {
  return JSON.stringify({
    v: SCHEMA_VERSION,
    paneSizes,
    isPane1Collapsed,
    activeExtensionId: null,
    extensions: {},
  });
}

function Harness({ engine }: { readonly engine: HydrationEngine }): ReactElement {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <ShellLayout engine={engine} />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

/** The `data-panel-size` of every panel in the group, rounded to 0.1. */
function panelSizes(): number[] {
  return Array.from(document.querySelectorAll('[data-panel-size]')).map(
    (element) => Math.round(Number(element.getAttribute('data-panel-size')) * 10) / 10,
  );
}

/** Focus the first divider and drive `keys` through the library's keyboard behaviour. */
async function nudgeFirstDivider(
  user: ReturnType<typeof userEvent.setup>,
  keys: string,
): Promise<void> {
  await nudgeDivider(user, 0, keys);
}

/** Focus the divider at `index` and drive `keys` through it. */
async function nudgeDivider(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  keys: string,
): Promise<void> {
  const divider = screen.getAllByRole('separator')[index];
  act(() => {
    (divider as HTMLElement).focus();
  });
  await user.keyboard(keys);
}

beforeEach(() => {
  observers.length = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  vi.restoreAllMocks();
});

describe('ShellLayout — re-fitting the panes on a width change, as arithmetic over stubbed widths, not verified in a browser', () => {
  it('fits an untouched layout to the pixel intent at the new width, rather than scaling the old shares', () => {
    measureAt(1000);
    render(<Harness engine={createHydrationEngine({ storage: null })} />);
    // 240/1000, 360/1000, remainder.
    expect(panelSizes()).toEqual([24, 36, 40]);

    // Scaled, the 24% pane would be 288px of 1200. Fitted, it is 240px again:
    // 240/1200 = 20, 360/1200 = 30, remainder 50.
    resizeTo(1200);
    expect(panelSizes()).toEqual([20, 30, 50]);
  });

  it('fits a restored layout into the bands at the new width, and returns to it when the width comes back', () => {
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ pane1: 20, pane2: 30, pane3: 50 })).storage,
    });
    render(<Harness engine={engine} />);
    expect(panelSizes()).toEqual([20, 30, 50]);

    // At 800px the navigation minimum is 176/800 = 22%, so pane 1 is lifted to
    // it; pane 2's 30% is exactly its own 240px minimum and stays; pane 3 takes
    // the remainder.
    resizeTo(800);
    expect(panelSizes()).toEqual([22, 30, 48]);

    // The correction was not the intent: the chosen layout comes back.
    resizeTo(1000);
    expect(panelSizes()).toEqual([20, 30, 50]);
  });

  it('writes nothing to storage when only the width changed', () => {
    measureAt(1000);
    const recorder = memoryStorage(record({ pane1: 20, pane2: 30, pane3: 50 }));
    const engine = createHydrationEngine({ storage: recorder.storage });
    render(<Harness engine={engine} />);

    resizeTo(800);
    resizeTo(700);
    act(() => {
      engine.flush();
    });

    expect(recorder.writes()).toBe(0);
    expect(engine.getState().paneSizes).toEqual({ pane1: 20, pane2: 30, pane3: 50 });
  });

  it('keeps the layout a person dragged, and records that one rather than the correction', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    render(<Harness engine={engine} />);

    // Pane 1 driven to its own minimum: 176/1000.
    await nudgeFirstDivider(user, '{ArrowLeft}');
    const dragged = panelSizes();
    expect(dragged[0]).toBeCloseTo(17.6, 1);

    resizeTo(800);
    // 17.6% of 800 is 141px, under the 176px minimum, so pane 1 is lifted to 22%.
    expect(panelSizes()[0]).toBeCloseTo(22, 1);

    resizeTo(1000);
    expect(panelSizes()).toEqual(dragged);
    expect(engine.getState().paneSizes.pane1).toBeCloseTo(17.6, 1);
  });

  it('fits the two-pane group from the record when pane 1 is collapsed', () => {
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ pane1: 20, pane2: 30, pane3: 50 }, true)).storage,
    });
    render(<Harness engine={engine} />);
    // 30 of the 80 the pair holds is 37.5 of the group they divide.
    expect(panelSizes()).toEqual([37.5, 62.5]);

    // At 500px pane 2's minimum is 240/500 = 48%, and pane 3 takes the rest.
    resizeTo(500);
    expect(panelSizes()).toEqual([48, 52]);

    resizeTo(1000);
    expect(panelSizes()).toEqual([37.5, 62.5]);
  });

  it('keeps a collapsed-group layout a person arranged, which is never persisted, across a width change', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ pane1: 20, pane2: 30, pane3: 50 }, true)).storage,
    });
    render(<Harness engine={engine} />);
    expect(panelSizes()).toEqual([37.5, 62.5]);

    // One keyboard step widens pane 2. Nothing is written — the collapsed group
    // divides a different width — so only this session knows the layout.
    await nudgeFirstDivider(user, '{ArrowRight}');
    const arranged = panelSizes();
    expect(arranged[0]).toBeGreaterThan(37.5);

    resizeTo(900);
    resizeTo(1000);
    // Back to what the person arranged, not to the record's 37.5.
    expect(panelSizes()).toEqual(arranged);
    expect(engine.getState().paneSizes).toEqual({ pane1: 20, pane2: 30, pane3: 50 });
  });

  it('shows and fits the stored layout, not a rebuilt one, once pane 1 has collapsed and come back', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    render(<Harness engine={engine} />);
    // Pane 1 to its minimum, which is persisted: 17.6 / 42.4 / 40.
    await nudgeFirstDivider(user, '{ArrowLeft}');
    const chosen = panelSizes();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    // Re-adding pane 1 makes the library rebuild the group from each panel's
    // mount-time `defaultSize` — 24 / 36 / 40 here — which is not the layout
    // the person chose. The membership effect lays the record back out, so the
    // screen shows the choice, as a reload would.
    expect(panelSizes()).toEqual(chosen);

    // At 1200px the chosen shares all fit their bands, so a re-fit from the
    // stored record gives them back unchanged.
    resizeTo(1200);
    expect(panelSizes()).toEqual(chosen);
  });
  it('records the width the user chose for pane 1, not its correction, when the second divider is dragged after a narrowing', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    render(<Harness engine={engine} />);
    // Pane 1 chosen at its 1000px minimum, 17.6%.
    await nudgeFirstDivider(user, '{ArrowLeft}');
    expect(panelSizes()[0]).toBeCloseTo(17.6, 1);

    // At 800px that is lifted to 22% — a correction, not a choice.
    resizeTo(800);
    expect(panelSizes()[0]).toBeCloseTo(22, 1);

    // The person moves the SECOND divider only. Pane 1 was not touched. The
    // guard first: the nudge really moved pane 2 and really wrote, or the
    // assertion on pane 1 below would pass by writing nothing at all.
    const listBefore = panelSizes()[1] as number;
    const recordBefore = engine.getState().paneSizes;
    await nudgeDivider(user, 1, '{ArrowLeft}');
    expect(panelSizes()[1]).toBeLessThan(listBefore - 1);
    expect(engine.getState().paneSizes).not.toBe(recordBefore);
    const stored = engine.getState().paneSizes;
    expect(stored.pane1).toBeCloseTo(17.6, 1);
    expect(stored.pane1 + stored.pane2 + stored.pane3).toBeCloseTo(100, 5);

    resizeTo(1000);
    expect(panelSizes()[0]).toBeCloseTo(17.6, 1);
  });
  it('shows and saves the pane-1 width the user chose, not the rebuilt one, when divider 2 is dragged after a collapse and a re-expansion', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    render(<Harness engine={engine} />);
    await nudgeFirstDivider(user, '{ArrowLeft}');
    expect(engine.getState().paneSizes.pane1).toBeCloseTo(17.6, 1);

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    // The library rebuilds pane 1 from its mount-time `defaultSize`, 24%, and
    // the membership effect lays the chosen 17.6 back out over it.
    expect(panelSizes()[0]).toBeCloseTo(17.6, 1);

    const listBefore = panelSizes()[1] as number;
    await nudgeDivider(user, 1, '{ArrowLeft}');
    expect(panelSizes()[1]).toBeLessThan(listBefore - 1);
    // What was saved is the 17.6 the person chose, not the rebuilt 24.
    const stored = engine.getState().paneSizes;
    expect(stored.pane1).toBeCloseTo(17.6, 1);
    expect(stored.pane1 + stored.pane2 + stored.pane3).toBeCloseTo(100, 5);
  });

  it('narrows a restored 40/30/30 to 800px with every pane in its band, summing to 100, and no layout warning', () => {
    const warnings: string[] = [];
    const collect = (...args: unknown[]): void => {
      warnings.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'warn').mockImplementation(collect);
    vi.spyOn(console, 'error').mockImplementation(collect);
    measureAt(1000);
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ pane1: 40, pane2: 30, pane3: 30 })).storage,
    });
    render(<Harness engine={engine} />);
    expect(panelSizes()).toEqual([40, 30, 30]);

    // 800px: pane 3's minimum is 32.5, so 2.5 comes off pane 1 (min 22).
    resizeTo(800);
    const sizes = panelSizes();
    expect(sizes).toEqual([37.5, 30, 32.5]);
    expect(warnings.filter((line) => line.includes('Invalid layout'))).toEqual([]);
  });

  it('reopens a record written after a widening on the layout that was live, with every pane in its band', async () => {
    measureAt(900);
    const user = userEvent.setup();
    const storage = memoryStorage(record({ pane1: 44, pane2: 27, pane3: 29 }));
    const engine = createHydrationEngine({ storage: storage.storage });
    const view = render(<Harness engine={engine} />);
    expect(panelSizes()).toEqual([44, 27, 29]);

    // At 1000px pane 1's maximum is 40%, so it is lowered to it.
    resizeTo(1000);
    expect(panelSizes()).toEqual([40, 27, 33]);
    // Divider 2 to the right, stopped by pane 3's 26% minimum. (To the left,
    // the library cascades past pane 2's minimum into pane 1, which is a drag
    // of both and not the case here.)
    await nudgeDivider(user, 1, '{ArrowRight}');
    const live = panelSizes();
    expect(live).toEqual([40, 34, 26]);
    act(() => {
      engine.flush();
    });
    // The record keeps the 44 the person chose — it is intent, not a
    // correction — and still sums to 100 because pane 3 took the difference,
    // which leaves pane 3 at 22, under its 26% band at this width. That is the
    // review's case, and it is deliberate: the record is not what is laid out.
    const stored = engine.getState().paneSizes;
    expect(stored.pane1).toBe(44);
    expect(stored.pane3).toBeCloseTo(22, 5);
    expect(stored.pane1 + stored.pane2 + stored.pane3).toBeCloseTo(100, 5);
    view.unmount();

    // A reload at the same width reads it through the same fit: the layout that
    // was live, every pane in its band.
    observers.length = 0;
    render(<Harness engine={createHydrationEngine({ storage: storage.storage })} />);
    expect(panelSizes()).toEqual(live);
  });
  it('opened at 800px on a record chosen at 1000px, drag divider 2, the stored pane 1 is still 17.6', async () => {
    measureAt(800);
    const user = userEvent.setup();
    const engine = createHydrationEngine({
      storage: memoryStorage(record({ pane1: 17.6, pane2: 42.4, pane3: 40 })).storage,
    });
    render(<Harness engine={engine} />);
    // The mount fit lifts pane 1 to its 800px minimum: 176/800 = 22.
    expect(panelSizes()[0]).toBeCloseTo(22, 1);

    const listBefore = panelSizes()[1] as number;
    await nudgeDivider(user, 1, '{ArrowLeft}');
    expect(panelSizes()[1]).toBeLessThan(listBefore - 1);
    const stored = engine.getState().paneSizes;
    expect(stored.pane1).toBeCloseTo(17.6, 5);
    expect(stored.pane1 + stored.pane2 + stored.pane3).toBeCloseTo(100, 5);
  });
});
