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
  const [first] = screen.getAllByRole('separator');
  act(() => {
    (first as HTMLElement).focus();
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

describe('ShellLayout — re-fitting the panes when the group width changes', () => {
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

  it('fits the stored layout, not the renormalised one, once pane 1 has collapsed and come back', async () => {
    measureAt(1000);
    const user = userEvent.setup();
    const engine = createHydrationEngine({ storage: memoryStorage().storage });
    render(<Harness engine={engine} />);
    // Pane 1 to its minimum, which is persisted: 17.6 / 42.4 / 40.
    await nudgeFirstDivider(user, '{ArrowLeft}');
    const chosen = panelSizes();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    // Re-adding pane 1 renormalises the group from each panel's mount-time
    // `defaultSize`, which is not the layout the person chose. Every panel
    // reports that renormalisation with a previous size, exactly as a drag does.
    const renormalised = panelSizes();
    expect(renormalised).not.toEqual(chosen);

    // At 1200px the chosen shares all fit their bands, so a re-fit from the
    // stored record gives them back unchanged. A re-fit that took the
    // renormalisation for an arrangement would give back `renormalised`.
    resizeTo(1200);
    expect(panelSizes()).toEqual(chosen);
  });
});
