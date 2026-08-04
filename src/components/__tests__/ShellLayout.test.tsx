import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellHostProvider, useExtensionActivation } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import type { ExtensionViewProps } from '../../core/types';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * The ribbon, swapped for one that can be told to throw.
 *
 * `ContextBar` renders validated primitive strings and host-owned callbacks,
 * so **there is no input reachable through the public contract that makes it
 * throw during render** — which is exactly why its fault boundary needs a test
 * of its own rather than a hopeful sentence. The real component is used
 * everywhere in this file except the one case that flips this flag, so nothing
 * else here is testing a double.
 */
const contextBar = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('../command/ContextBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../command/ContextBar')>();
  return {
    ...actual,
    ContextBar: (props: Parameters<typeof actual.ContextBar>[0]): ReactElement => {
      if (contextBar.shouldThrow) {
        throw new Error('the context bar exploded');
      }
      return <actual.ContextBar {...props} />;
    },
  };
});

/**
 * ============================================================================
 * THE SHELL, DRIVEN THROUGH THE REAL REGISTRY.
 * ============================================================================
 * Nothing here mocks the host. Blueprints are registered through the real
 * `ExtensionRegistryProvider`, brought to the foreground by clicking the switch
 * button a user would click, and their views render through the real
 * `ExtensionHostBoundary`. That is deliberate: the ISSUE-002 edge cases are
 * about how the assembled shell behaves, and a test double of the host would
 * assert the double.
 *
 * **jsdom has no layout engine.** Every element measures 0x0, so a test cannot
 * observe a pixel width or a real horizontal scrollbar. Where an edge case is
 * about geometry, what is asserted instead is the structural property that makes
 * the geometry impossible — that every panel is a zero-basis flex RATIO of a
 * clipped group, that every divider reports a non-zero `aria-valuemin`, that the
 * collapsed track is a fixed 48px CSS width — and the test says which it is
 * doing.
 *
 * **A width can still be driven, and where geometry matters it now is.** jsdom
 * measures nothing on its own, but `getBoundingClientRect` can be stubbed, and
 * `ShellLayout` takes its one measurement through exactly that call. So the
 * narrow-viewport cases below render at 1000, 800, 700, 600, 480 and 360 CSS px
 * rather than at the unmeasurable 0 where every constant falls back to a
 * hand-written percentage band. That distinction was load-bearing: the previous
 * version of "a narrow viewport cannot overflow" asserted that the panel sizes
 * sum to 100, ran only at 0 width where `PANE_FALLBACK_PERCENT` sums to 100 by
 * construction, and was asserting a proposition that is FALSE from about 700px
 * down. See "keeps the sizes summing to 100 only while the pixel minimums fit,
 * which is 800px and wider" for where it does hold and where it stops.
 * ============================================================================
 */

/** A pane view that proves it is rendered inside an `ExtensionHostBoundary`. */
function makeProbe(pane: string) {
  return function Probe({ context }: ExtensionViewProps): ReactElement {
    // Throws outside an `ExtensionHostBoundary`, so reaching the assertion at
    // all is the proof that the host wrapped this subtree.
    const view = useExtensionActivation();
    return (
      <div data-testid={`probe-${pane}`}>
        {`${view.extensionId}|${String(view.isForeground)}|${String(context.activeNavNodeId)}`}
      </div>
    );
  };
}

function sampleBlueprint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeBlueprint({
    views: { pane2: makeProbe('pane2'), pane3: makeProbe('pane3') },
    ...overrides,
  });
}

/**
 * A pane-3 view that can put the shell into a selected state from the UI.
 *
 * The density scan has to REACH the floating toolbar, and the toolbar renders
 * only while something is selected. Selecting from the plug-in's own view — rather
 * than writing to the shell store from the test — keeps the scan walking the
 * states a user can actually be in, which is the property `STATE_MARKERS` exists
 * to protect.
 */
function SelectingPane3({ shell }: ExtensionViewProps): ReactElement {
  return (
    <div data-testid="probe-pane3">
      <button
        type="button"
        onClick={() => {
          shell.setSelectedItems(['row-1']);
        }}
      >
        Select a row
      </button>
    </div>
  );
}

/**
 * The sample blueprint with a selectable pane 3 and one selection-gated command.
 *
 * The command declares a `when` rather than an `isVisible` closure, so the state
 * the scan reaches is the one the floating toolbar is actually for.
 */
function selectingBlueprint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = sampleBlueprint(overrides);
  const actions = [
    ...((base['ribbonActions'] as Record<string, unknown>[] | undefined) ?? []),
    {
      id: 'act-selected',
      label: 'Act On Selection',
      icon: 'edit',
      when: 'selectedItemId != null',
      isVisible: () => true,
      onExecute: () => undefined,
    },
  ];
  return {
    ...base,
    ribbonActions: actions,
    views: { pane2: makeProbe('pane2'), pane3: SelectingPane3 },
  };
}

interface RegistrarProps {
  readonly blueprints: readonly unknown[];
}

/** Registers each blueprint once, from inside the provider, as a plug-in would. */
function Registrar({ blueprints }: RegistrarProps): null {
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

interface HarnessProps {
  readonly blueprints?: readonly unknown[];
}

/**
 * Every mount gets a hydration engine of its own, with **no storage at all**.
 *
 * ISSUE-003 wired persistence into `ShellLayout`, and its default engine is a
 * process-wide singleton over the real `localStorage`. Left on the default, the
 * collapse test below would write `isPane1Collapsed: true` and the next test in
 * this file would open collapsed — a suite that passes or fails on its own
 * ordering. A memory-only engine per mount is the isolation, and it also keeps
 * every assertion in this file about the layout the shell computes rather than
 * one it restored: with nothing persisted, `DEFAULT_SHELL_STATE` is what the
 * engine serves and the pixel-derived defaults are what `ShellLayout` uses. What
 * persistence itself does is asserted in
 * `src/components/__tests__/ShellLayoutPersistence.test.tsx`.
 *
 * Created in a lazy `useState` initializer so its identity is stable for the
 * mount, which is what `ShellLayout` requires of it.
 */
function Harness({ blueprints = [] }: HarnessProps): ReactElement {
  const [engine] = useState(() => createHydrationEngine({ storage: null }));
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <Registrar blueprints={blueprints} />
        <ShellLayout engine={engine} />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

/** Renders the shell with one sample extension registered and activated. */
async function renderActivated(): Promise<{
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly container: HTMLElement;
}> {
  const user = userEvent.setup();
  const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
  await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
  return { user, container };
}

/** The `data-panel-size` of every panel currently in the group, as numbers. */
function panelSizes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-panel-size]')).map((element) =>
    Number(element.getAttribute('data-panel-size')),
  );
}

/**
 * A class token with its variant prefixes cut, so `dark:hover:p-8` reads as
 * `p-8`.
 *
 * The colon has to be found at BRACKET DEPTH ZERO. Tailwind's arbitrary values
 * contain colons of their own — `[contain:paint]`, `text-[color:var(--x)]` — and
 * cutting at the last colon anywhere in the string turned `[contain:paint]` into
 * `paint]`, which is not a utility and is not what the author wrote. That was
 * harmless for the tokens this file happened to scan and would not have stayed
 * harmless: `p-[max(2rem,4vw)]` is exactly the shape a density violation would
 * arrive in.
 */
function baseUtility(token: string): string {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === '[' || character === '(') {
      depth += 1;
    } else if (character === ']' || character === ')') {
      depth -= 1;
    } else if (character === ':' && depth === 0) {
      cut = index;
    }
  }
  return token.slice(cut + 1);
}

/**
 * Every `class` token under `root`, with variant prefixes cut.
 *
 * `root` is a `ParentNode` rather than an `HTMLElement` so that `document.body`
 * can be handed in. That is not a widening for its own sake: the overflow menu
 * is portalled OUT of the render container by `DropdownMenu.Portal`, so a scan
 * rooted at the container cannot see a single one of its class tokens.
 */
function classTokens(root: ParentNode): string[] {
  const tokens: string[] = [];
  for (const element of root.querySelectorAll('*')) {
    const value = element.getAttribute('class');
    if (value === null) {
      continue;
    }
    for (const token of value.split(/\s+/)) {
      if (token !== '') {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

afterEach(() => {
  contextBar.shouldThrow = false;
  vi.restoreAllMocks();
});

describe('ShellLayout — structure and focus order', () => {
  it('renders the context bar and three panes in context bar → pane 1 → pane 2 → pane 3 order', () => {
    const { container } = render(<Harness />);
    const regions = Array.from(
      container.querySelectorAll('[data-shell-region="context-bar"], [data-pane]'),
    ).map(
      (element) => element.getAttribute('data-shell-region') ?? element.getAttribute('data-pane'),
    );
    expect(regions).toEqual(['context-bar', 'pane1', 'pane2', 'pane3']);
  });

  it('names all three panes as regions', () => {
    render(<Harness />);
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
  });

  it('gives pane 3 its own header, its own scroll container and a drawer slot', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const detail = screen.getByRole('region', { name: 'Detail' });
    expect(within(detail).getByText('No extension selected')).toBeInTheDocument();
    expect(detail.querySelector('[data-pane-slot="body"]')).toHaveClass('overflow-auto');

    expect(container.querySelector('[data-pane-slot="drawer"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show utility drawer' }));
    const drawer = detail.querySelector('[data-pane-slot="drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain('Utilities');

    await user.click(screen.getByRole('button', { name: 'Hide utility drawer' }));
    expect(container.querySelector('[data-pane-slot="drawer"]')).toBeNull();
  });
});

describe('ShellLayout — dividers', () => {
  it('renders one divider between each adjacent pair of panes', () => {
    render(<Harness />);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('makes every divider keyboard-reachable and actually resizes with the arrow keys', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const [first, second] = screen.getAllByRole('separator');
    // `tabIndex=0`, the `separator` role and the window-splitter key handling all
    // come from `PanelResizeHandle`. This file's own module attaches no listener
    // and names no key event: the only module allowlisted to register one is the
    // hotkey dispatcher, and the only other module allowlisted to handle a key
    // event is the list virtualizer. Pinned by "finds no listener registration in
    // any module outside the hotkey-dispatch allowlist" and "finds no key-event
    // name in any module outside the key-event allowlist" in
    // `src/__tests__/noEventListener.test.ts`.
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '0');

    act(() => {
      (first as HTMLElement).focus();
    });
    expect(first).toHaveFocus();

    const before = panelSizes(container);
    await user.keyboard('{ArrowLeft}');
    const narrower = panelSizes(container);
    expect(narrower[0]).toBeLessThan(before[0] as number);

    await user.keyboard('{ArrowRight}');
    expect(panelSizes(container)[0]).toBeGreaterThan(narrower[0] as number);
  });

  it('leaves no 0px void when a divider is driven fully to either edge', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const [first] = screen.getAllByRole('separator');
    act(() => {
      (first as HTMLElement).focus();
    });

    // Home drives the divider fully to its leading edge — the gesture that,
    // unconstrained, would leave pane 1 at zero width and unrecoverable.
    await user.keyboard('{Home}');
    const atStart = panelSizes(container);
    expect(atStart[0]).toBeGreaterThan(0);
    expect(first).toHaveAttribute('aria-valuemin', String(atStart[0]));

    // End drives it fully the other way, which is the same hazard for pane 2.
    await user.keyboard('{End}');
    const atEnd = panelSizes(container);
    for (const size of atEnd) {
      expect(size).toBeGreaterThan(0);
    }
    expect(atEnd.reduce((total, size) => total + size, 0)).toBeCloseTo(100, 1);
  });

  it('reports a non-zero minimum on every divider, which is the floor above', () => {
    render(<Harness />);
    for (const separator of screen.getAllByRole('separator')) {
      const min = Number(separator.getAttribute('aria-valuemin'));
      expect(Number.isFinite(min)).toBe(true);
      expect(min).toBeGreaterThan(0);
      expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(min);
    }
  });

  it('sizes every pane as a flex ratio of the measured group, so the group width is divided and never exceeded', () => {
    // The narrow-viewport requirement, asserted at REAL widths rather than at
    // jsdom's unmeasurable 0 — and asserted as the property that actually
    // delivers it. Every panel is `flex-basis: 0; flex-grow: <size>;
    // flex-shrink: 1` inside a group the library styles `width: 100%; overflow:
    // hidden`, so the sizes are ratios of the group's width and not widths. A
    // set of grow factors summing to 187.8 divides 360px exactly as one summing
    // to 100 divides 1000px; neither has a pixel in it to spill.
    //
    // This is the structural stand-in, and it is a stand-in for something jsdom
    // genuinely cannot do — it computes no used value, so it cannot be asked
    // whether the document scrolls. The real measurement is a headless-Chrome
    // pass, and it found no document overflow at any of these widths.
    for (const width of [1000, 800, 700, 600, 480, 360]) {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, width, 800),
      );
      const { container, unmount } = render(<Harness />);

      const panels = Array.from(
        container.querySelectorAll<HTMLElement>('[data-panel-size]'),
      );
      expect(panels, `three panes at ${width}px`).toHaveLength(3);
      for (const panel of panels) {
        // A zero basis is the whole argument: with any other basis the grow
        // factors would be added to a width instead of dividing one.
        expect(panel.style.flexBasis, `flex-basis at ${width}px`).toBe('0px');
        expect(panel.style.flexShrink, `flex-shrink at ${width}px`).toBe('1');
        expect(Number(panel.style.flexGrow), `flex-grow at ${width}px`).toBeGreaterThan(0);
      }
      // The group itself takes the width it is given and clips, so nothing a
      // panel does can reach the document.
      const group = container.querySelector<HTMLElement>('[data-panel-group]');
      expect(group?.style.width, `group width at ${width}px`).toBe('100%');
      expect(group?.style.overflow, `group overflow at ${width}px`).toBe('hidden');
      expect(container.querySelector('[data-shell-region="root"]')).toHaveClass('overflow-hidden');
      expect(container.querySelector('[data-shell-region="panes"]')).toHaveClass('overflow-hidden');

      unmount();
      vi.restoreAllMocks();
    }
  });

  it('keeps the sizes summing to 100 only while the pixel minimums fit, which is 800px and wider', () => {
    // The narrowed form of a claim this file used to make without qualification.
    // Sizes summing to 100 is what makes `aria-valuenow` on a separator a
    // percentage of the whole; it is NOT what prevents overflow, and it is not
    // true at every width. Both halves are pinned here so that neither can be
    // widened back by accident.
    const sumAt = (width: number): number => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, width, 800),
      );
      const { container, unmount } = render(<Harness />);
      const total = panelSizes(container).reduce((running, size) => running + size, 0);
      unmount();
      vi.restoreAllMocks();
      return total;
    };

    // Where it holds: the pixel minimums in `PANE_PX` all fit.
    expect(sumAt(1000)).toBeCloseTo(100, 1);
    expect(sumAt(800)).toBeCloseTo(100, 1);

    // Where it stops. 176 + 240 + 260 = 676px of minimums plus the dividers, so
    // from about 700px down the minimums are unsatisfiable, the library clamps
    // each panel to its own floor, logs `WARNING: Invalid layout total size`,
    // and the total runs away from 100. Asserted as a strict inequality rather
    // than as the exact figures so that a change in the library's rounding is
    // not a test failure — what matters is that the property is GONE.
    expect(sumAt(600)).toBeGreaterThan(105);
    expect(sumAt(480)).toBeGreaterThan(130);
    expect(sumAt(360)).toBeGreaterThan(170);
  });

  it('converts the pixel pane constants against a measured group width', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1000, 800),
    );
    const { container } = render(<Harness />);
    // 240px of 1000px is 24%, 360px is 36%, and pane 3 takes the remainder.
    expect(panelSizes(container)).toEqual([24, 36, 40]);
  });

  it('falls back to the declared percentage band when the group cannot be measured', () => {
    // jsdom reports every element as 0x0, which is the unmeasurable case.
    const { container } = render(<Harness />);
    expect(panelSizes(container)).toEqual([18, 26, 56]);
  });

  it('recomputes the percentage bands from an observed width, and leaves defaultSize on the mount-time measurement', () => {
    // The half of §4.3 that `useElementWidth` exists for, asserted THROUGH the
    // shell rather than only against the hook. `measureGroup` is untouched, so
    // `defaultSize` is still the commit-time snapshot; only `minSize` and
    // `maxSize` follow the observer.
    //
    // The fake is installed here rather than in `src/test/setup.ts`, on purpose:
    // that file stubs nothing, and a global stub would make the no-observer
    // branch — which is what jsdom and older embedded WebViews really take —
    // unreachable rather than tested. See `src/hooks/useElementWidth.ts`.
    const built: { fire: () => void }[] = [];
    class FakeResizeObserver {
      constructor(private readonly callback: () => void) {
        built.push({ fire: (): void => { this.callback(); } });
      }
      observe(): void {
        /* the element is not needed: the hook re-reads it */
      }
      disconnect(): void {
        /* nothing to tear down in a fake */
      }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    try {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 1000, 800),
      );
      const { container } = render(<Harness />);
      // 240/1000 = 24, 360/1000 = 36, remainder 40 — the same numbers the
      // mount-time measurement produces on its own.
      expect(panelSizes(container)).toEqual([24, 36, 40]);
      const separators = Array.from(
        container.querySelectorAll<HTMLElement>('[role="separator"]'),
      );
      // 176px of 1000px is 17.6%. The library rounds what it reports to
      // assistive technology, so the assertion is on the value and not on its
      // spelling.
      const minAt1000 = Number(separators[0]?.getAttribute('aria-valuemin'));
      expect(minAt1000).toBeCloseTo(17.6, 0);

      // The window narrows. `defaultSize` does NOT move — that would feed the
      // number being dragged back in as the starting point — but the band does,
      // because 176px is a different share of 500px than it is of 1000px.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 500, 800),
      );
      act(() => {
        for (const observer of built) {
          observer.fire();
        }
      });
      const after = Array.from(container.querySelectorAll<HTMLElement>('[role="separator"]'));
      const minAt500 = Number(after[0]?.getAttribute('aria-valuemin'));
      expect(minAt500).toBeCloseTo(35.2, 0);
      // Twice the share for half the width, which is the whole point: the pixel
      // intent in `PANE_PX` is what stayed constant.
      expect(minAt500).toBeGreaterThan(minAt1000 * 1.9);
    } finally {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });
});

describe('ShellLayout — pane 1 collapse', () => {
  it('collapses to a 48px icon track and expands back', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
    expect(container.querySelector('[data-shell-region="nav-track"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    const track = container.querySelector('[data-shell-region="nav-track"]');
    expect(track).not.toBeNull();
    expect((track as HTMLElement).style.width).toBe('48px');
    // Collapse is a different tree, not a small panel: pane 1's panel and the
    // divider beside it have left the group.
    expect(container.querySelector('[data-panel-id="pane1"]')).toBeNull();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(container.querySelector('[data-shell-region="nav-track"]')).toBeNull();
    expect(container.querySelector('[data-panel-id="pane1"]')).not.toBeNull();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('keeps the accessible name of every pane-1 entry in both states', async () => {
    const { user } = await renderActivated();
    // Expanded: the labels are visible text.
    expect(screen.getByRole('button', { name: 'Sample Extension' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Root B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Root A badge 3' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    // Collapsed: the same queries still find the same buttons, because the label
    // stays in the accessible tree as `sr-only` text rather than being dropped.
    expect(screen.getByRole('button', { name: 'Sample Extension' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Root B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Root A badge 3' })).toBeInTheDocument();
    // Nested nodes are dropped from the icon track; the top level is not.
    expect(screen.queryByRole('button', { name: 'Child A' })).toBeNull();

    // THE MECHANISM, PINNED. The three queries above pass on the accessible NAME
    // alone, and a name survives being made `hidden` just as happily as being
    // made `sr-only` — jsdom computes it from the tree, not from the cascade.
    // Swapping `sr-only` for `hidden` would leave every assertion above green
    // and remove the label from the screen entirely. So the class that produces
    // the visually-hidden-but-announced behaviour is named explicitly, the same
    // way the monogram case below already does it.
    const collapsed = screen.getByRole('button', { name: 'Root B' });
    expect(collapsed.querySelector('.sr-only')?.textContent).toBe('Root B');
    expect(collapsed.querySelector('.hidden')).toBeNull();
  });

  it('shows a monogram in place of the label in the icon track', async () => {
    const { user } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    const button = screen.getByRole('button', { name: 'Root B' });
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('R');
    expect(button.querySelector('.sr-only')?.textContent).toBe('Root B');
  });

  /**
   * WHAT THIS CASE CAN REACH, MEASURED RATHER THAN ASSUMED.
   *
   * **No pointer drag is possible in this jsdom, and the sequence below is inert.**
   * `fireEvent.pointerDown` falls back to a plain `Event` when
   * `window.PointerEvent` is missing — it is missing here, and that is asserted
   * rather than believed — and a plain `Event` carries no `clientX`, so
   * `react-resizable-panels` is never handed a coordinate and never leaves the
   * handle's `inactive` state. `src/__tests__/IntegrationSuite.test.tsx` states
   * the same fact about the same mechanism in "cannot be driven by a POINTER
   * drag at all, because this jsdom implements no PointerEvent", and the two
   * files agree: neither claims a jsdom pointer moves a divider. A REAL pointer
   * drag interrupted by a collapse is driven in `e2e/pane-dividers.spec.ts`,
   * where `dragHorizontally`'s `sawDragState` proves the drag was in flight.
   *
   * So what this case pins is the half that needs no pointer, and it is the half
   * the edge case is really about: **unmounting the handle mid-gesture leaves no
   * half-applied layout**, because the panels that remain are handed a legal
   * pair. That is asserted as the exact resulting pair rather than as a sum to
   * 100, which is true of almost every layout including a wrong one.
   *
   * **THE EXPECTED PAIR CHANGED WITH GITHUB ISSUE #114, AND THE OLD PAIR WAS
   * THE DEFECT.** This used to expect 47.4 and 52.6, and described them as 36
   * and 40 "re-normalised" by the library. They were: pane 1's 24 was still
   * being subtracted from pane 3's remainder after pane 1 had left the group,
   * so the survivors asked for 36 and 40, summed to 76, and
   * `react-resizable-panels` scaled them back up to 100 — which is how a pane 2
   * asked to open at 360px of a measured 1000px group opened at 474px instead.
   * The pair is now 36 and 64: pane 2 gets exactly the share `PANE_PX` asks
   * for, and pane 3 gets the whole of what is left, because nothing outside the
   * group is being charged to it. Nothing re-normalises, because there is
   * nothing left to re-normalise.
   */
  it('survives a collapse toggled while a divider drag is in flight', async () => {
    // Real geometry, so the library's own arithmetic runs against a measurable
    // group rather than against the 0x0 fallback.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1000, 800),
    );
    const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
    const [handle] = screen.getAllByRole('separator');
    expect(handle).toBeDefined();
    expect((globalThis as { PointerEvent?: unknown }).PointerEvent).toBeUndefined();
    // 240px and 360px of a measured 1000px group, and pane 3 takes the remainder.
    const before = panelSizes(container);
    expect(before).toEqual([24, 36, 40]);

    // Begin the gesture, then collapse without ever releasing the pointer. The
    // handle being unmounted mid-gesture is the case the edge-case list names.
    fireEvent.pointerDown(handle as Element, { pointerId: 1, clientX: 300, clientY: 10 });
    // THE LIMIT, PINNED ON THE LIBRARY'S OWN STATE ATTRIBUTE. `pointerdown` did
    // not start a drag and did not move a pane, so nothing below may be read as
    // evidence that a drag was interrupted — only that the unmount is clean.
    expect((handle as HTMLElement).getAttribute('data-resize-handle-state')).toBe('inactive');
    expect(panelSizes(container)).toEqual(before);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 10 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 10 });

    // The layout is intact: a 48px track, pane 1's panel and its divider gone
    // from the group, and the two survivors holding exactly the share the
    // pixel intent asks for — not whatever an abandoned gesture last computed,
    // and not a pair the library had to scale back up to 100.
    expect(
      (container.querySelector('[data-shell-region="nav-track"]') as HTMLElement).style.width,
    ).toBe('48px');
    expect(container.querySelector('[data-panel-id="pane1"]')).toBeNull();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(panelSizes(container)).toEqual([36, 64]);
  });
});

describe('ShellLayout — extensions', () => {
  it('leaves the context bar contextual side empty when no extension is active', () => {
    const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
    const contextual = container.querySelector('[data-command-side="extension"]');
    expect(contextual?.querySelectorAll('button')).toHaveLength(0);
    // `aria-disabled`, not the native attribute: this is the shell's DEFAULT
    // state, so a natively disabled button would put "Close extension" outside
    // the tab order of every fresh session and a keyboard user would never learn
    // the command existed. See the `CommandButton` docblock in `commandListItem.tsx`.
    const close = screen.getByRole('button', { name: 'Close extension' });
    expect(close).toHaveAttribute('aria-disabled', 'true');
    expect(close).not.toBeDisabled();
    // The layout is still valid with nothing active.
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByText('Select an extension to fill this pane.')).toBeInTheDocument();
  });

  it('renders both plug-in views inside an ExtensionHostBoundary once activated', async () => {
    await renderActivated();
    expect(screen.getByTestId('probe-pane2')).toHaveTextContent('sample-ext|true|null');
    expect(screen.getByTestId('probe-pane3')).toHaveTextContent('sample-ext|true|null');
    expect(
      within(screen.getByRole('region', { name: 'Detail' })).getByText('Sample Extension'),
    ).toBeInTheDocument();
  });

  it('shows the active extension contextual actions, filtered by their predicates', async () => {
    const { container } = await renderActivated();
    const contextual = container.querySelector('[data-command-side="extension"]');
    // The fixture's first action is visible; its second returns false.
    expect(contextual?.textContent).toContain('Act One');
    expect(contextual?.textContent).not.toContain('Act Two');
  });

  it('records the selected navigation node in the shell context', async () => {
    const { user } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Root B' }));
    expect(screen.getByRole('button', { name: 'Root B' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('probe-pane2')).toHaveTextContent('sample-ext|true|root-b');
  });

  it('reaches a nested navigation node, so the tree really recurses', async () => {
    const { user } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Child A' }));
    expect(screen.getByTestId('probe-pane3')).toHaveTextContent('sample-ext|true|child-a');
  });

  it('closes the active extension from the host command', async () => {
    const { user, container } = await renderActivated();
    const close = screen.getByRole('button', { name: 'Close extension' });
    expect(close).not.toHaveAttribute('aria-disabled');

    await user.click(close);
    expect(screen.queryByTestId('probe-pane2')).toBeNull();
    expect(container.querySelector('[data-command-side="extension"]')?.querySelectorAll('button'))
      .toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Close extension' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Now unavailable but still focusable, and clicking it again does nothing.
    await user.click(screen.getByRole('button', { name: 'Close extension' }));
    expect(screen.queryByTestId('probe-pane2')).toBeNull();
  });

  it('switches the foreground between two registered extensions', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[
          sampleBlueprint(),
          sampleBlueprint({ id: 'other-ext', name: 'Other Extension' }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
    expect(screen.getByRole('button', { name: 'Sample Extension' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByTestId('probe-pane2')).toHaveTextContent('sample-ext|true|null');

    await user.click(screen.getByRole('button', { name: 'Other Extension' }));
    expect(screen.getByTestId('probe-pane2')).toHaveTextContent('other-ext|true|null');
    expect(screen.getByRole('button', { name: 'Sample Extension' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

/**
 * ============================================================================
 * THE DENSITY SCAN: WHAT IT LOOKS AT, AND WHAT IT LOOKS FOR.
 * ============================================================================
 * The previous version of this block had two independent holes, both confirmed
 * by planting a token and watching it pass.
 *
 *  1. IT SCANNED ONE STATE. It called `renderActivated()` and nothing else, so
 *     `p-8` planted on `EmptyPane` — the body of a pane with no extension — went
 *     through green, because a shell with an extension active never renders it.
 *     The 48px collapsed nav track and the open overflow menu were never scanned
 *     either, and the menu could not have been: it is portalled to
 *     `document.body`, outside the render container the scan was rooted at.
 *  2. ITS PATTERNS WERE EVADABLE. `/^p([trblxy]?)-(\d+…)$/` misses `p-[64px]`
 *     (an arbitrary value) and `ps-8` (a logical property, `padding-inline-start`);
 *     `/^text-\[(\d+)px\]$/` misses the whole of Tailwind's named type scale, so
 *     `text-lg` — 18px, five px outside the band — was invisible.
 *
 * Both are closed below. `shellStates` walks every state the shell can be in and
 * harvests `document.body` at each; `paddingOffenders` and `typeSizeOffenders`
 * read a token's MEASUREMENT rather than its spelling.
 *
 * **Unmeasurable is treated as a violation, for padding.** An arbitrary padding
 * this scan cannot convert to pixels — `p-[max(2rem,4vw)]`, `p-[calc(…)]` — is
 * reported rather than skipped, because "the scan could not tell" is exactly
 * where a violation would choose to sit.
 *
 * ---------------------------------------------------------------------------
 * THE TYPE-SIZE RULE HAD THE OPPOSITE POSTURE, AND THAT WAS A HOLE. (PLAN R8.)
 * ---------------------------------------------------------------------------
 * `typeSizeOffenders` used to return `false` for ANY arbitrary value it could
 * not read as a length, on the stated grounds that `text-` is also the prefix
 * for colour and alignment. The grounds are sound; the rule drawn from them was
 * one step too wide. It made `text-[var(--type-body)]` — a genuine type size,
 * simply one this scan cannot resolve — pass in silence.
 *
 * That is the reason `design/README.md` and the pivot plan both refuse to
 * tokenise font size: tokenising it BEFORE this hole was closed would have made
 * the density scan quietly stop measuring type while every run stayed green.
 * Padding fails loud, type size failed silent, and the plan calls it the most
 * fragile thing in the repository.
 *
 * The hole is closed by splitting the two cases the old rule conflated:
 *
 *  - `text-[color:var(--x)]` carries Tailwind's own explicit data-type hint. It
 *    is PROVABLY not a type size, so it is not this rule's business and it is
 *    still skipped. `ARBITRARY_TYPE_HINT` is what recognises it.
 *  - `text-[var(--x)]`, `text-[calc(…)]` and anything else length-shaped that
 *    this scan cannot convert are UNMEASURABLE rather than provably-not-a-length,
 *    and are now reported — the same posture `paddingOffenders` has always had,
 *    for the same reason.
 *
 * Blast radius, measured before the change: `text-[64px]`, `text-[0.625rem]` and
 * `text-[2vw]` still report; `text-[11px]`, `text-[12px]`, `text-center` and
 * every colour utility stay clean. Nothing the shell renders moved.
 * ============================================================================
 */

/** `p-3` is `0.75rem`. The contract is "no padding above p-3", so 12px. */
const PADDING_LIMIT_PX = 12;
/** The declared type band, inclusive at both ends. */
const TYPE_BAND_PX = Object.freeze({ min: 11, max: 13 });
/** Tailwind's spacing scale is 0.25rem per step. */
const SPACING_STEP_PX = 4;

/**
 * Tailwind's named type scale in pixels, at its default configuration.
 *
 * `text-xs` is 12px and sits INSIDE the band; `text-sm` is 14px and does not.
 * That is the boundary this map exists to make checkable — the two are one
 * character apart and the old regex could not see either.
 */
const NAMED_TEXT_PX: ReadonlyMap<string, number> = new Map([
  ['xs', 12],
  ['sm', 14],
  ['base', 16],
  ['lg', 18],
  ['xl', 20],
  ['2xl', 24],
  ['3xl', 30],
  ['4xl', 36],
  ['5xl', 48],
  ['6xl', 60],
  ['7xl', 72],
  ['8xl', 96],
  ['9xl', 128],
]);

/** Units with a fixed pixel equivalent at this shell's 16px root size. */
const PX_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['px', 1],
  ['', 1],
  ['rem', 16],
  ['em', 16],
  ['pt', 4 / 3],
]);

/** A number followed by an optional unit, and nothing else. */
const LENGTH_SHAPED = /^(-?\d*\.?\d+)([a-z%]*)$/;

/**
 * An arbitrary Tailwind value read as pixels.
 *
 * Three outcomes, and the callers need all three kept apart: a number, `null`
 * for "this is not a length at all", and `NaN` for "length-shaped in a unit with
 * no fixed pixel equivalent". Tailwind writes a space as `_`, so `[2rem_4rem]`
 * is two lengths and correctly fails `LENGTH_SHAPED`.
 */
function arbitraryPx(raw: string): number | null {
  const match = LENGTH_SHAPED.exec(raw.replace(/_/g, ''));
  if (match === null) {
    return null;
  }
  const factor = PX_PER_UNIT.get(match[2] as string);
  return factor === undefined ? Number.NaN : Number(match[1]) * factor;
}

/** `p`, `px`, `py`, `pt`/`pr`/`pb`/`pl` and the logical `ps`/`pe`. */
const PADDING_UTILITY = /^p([trblxyse]?)-(.+)$/;
/** A bare step on the spacing scale, whole or half. */
const SPACING_STEP = /^\d+(?:\.\d+)?$/;
/** An arbitrary value, `[…]`. */
const ARBITRARY_VALUE = /^\[(.+)\]$/;

/**
 * Tailwind's explicit data-type hint inside an arbitrary value.
 *
 * `text-[color:var(--x)]` and `text-[image:…]` say, in the class itself, that
 * the value is not a length. That is the ONLY evidence strong enough to skip a
 * `text-[…]` utility: everything else is a value the scan merely failed to read,
 * which is a violation and not an exemption. `length:` is deliberately absent
 * from the alternation — a hint that the value IS a length does not tell this
 * scan how many pixels it is, so it still has to be measured or reported.
 */
const ARBITRARY_TYPE_HINT = /^(?:color|image|url|position|family-name|generic-name):/;

/** Every token that declares padding this shell is not allowed to use. */
function paddingOffenders(tokens: readonly string[]): string[] {
  return tokens.filter((token) => {
    const match = PADDING_UTILITY.exec(baseUtility(token));
    if (match === null) {
      return false;
    }
    const value = match[2] as string;
    if (SPACING_STEP.test(value)) {
      return Number(value) * SPACING_STEP_PX > PADDING_LIMIT_PX;
    }
    if (value === 'px') {
      return false;
    }
    const arbitrary = ARBITRARY_VALUE.exec(value);
    if (arbitrary === null) {
      // Not a spelling of padding this scan understands. Reported, not skipped.
      return true;
    }
    const pixels = arbitrary[1] === undefined ? null : arbitraryPx(arbitrary[1]);
    return pixels === null || Number.isNaN(pixels) || pixels > PADDING_LIMIT_PX;
  });
}

/** Every token that declares a type size outside the 11px–13px band. */
function typeSizeOffenders(tokens: readonly string[]): string[] {
  return tokens.filter((token) => {
    const base = baseUtility(token);
    if (!base.startsWith('text-')) {
      return false;
    }
    const value = base.slice('text-'.length);
    const named = NAMED_TEXT_PX.get(value);
    if (named !== undefined) {
      return named < TYPE_BAND_PX.min || named > TYPE_BAND_PX.max;
    }
    const arbitrary = ARBITRARY_VALUE.exec(value);
    if (arbitrary === null) {
      // A named colour, an alignment, a weight. Not a type size, so not this
      // rule's business — and not an arbitrary value either, so nothing was
      // hidden from the scan here.
      return false;
    }
    const raw = arbitrary[1] ?? '';
    if (ARBITRARY_TYPE_HINT.test(raw)) {
      // `text-[color:var(--x)]`. Tailwind's own hint says this is not a length,
      // and that is proof rather than a guess. Skipped.
      return false;
    }
    const pixels = arbitraryPx(raw);
    // UNMEASURABLE IS A VIOLATION. `text-[var(--type-body)]` reaches here, and
    // it used to return `false` — a type size the scan could not read, passing
    // silently. It is reported now, matching `paddingOffenders`. See R8 in the
    // banner above for why this one branch was the most fragile line in the file.
    return pixels === null || Number.isNaN(pixels) || pixels < TYPE_BAND_PX.min || pixels > TYPE_BAND_PX.max;
  });
}

/** Both rules at once, for the control case. */
function densityOffenders(tokens: readonly string[]): string[] {
  return [...paddingOffenders(tokens), ...typeSizeOffenders(tokens)];
}

/** Seven visible commands, so the shell really grows an overflow menu. */
function manyRibbonActions(): Record<string, unknown>[] {
  return Array.from({ length: 7 }, (_unused, index) => ({
    id: `act-${index}`,
    label: `Action ${index}`,
    icon: 'save',
    isVisible: () => true,
    onExecute: () => undefined,
  }));
}

/**
 * A token rendered in exactly one of the shell's states, so that a scan which
 * silently failed to reach a state cannot pass by scanning nothing.
 *
 * Keyed by state name, in the order `shellStates` walks them.
 */
const STATE_MARKERS: ReadonlyMap<string, string> = new Map([
  // `EmptyPane`, which only a pane with no extension renders.
  ['no extension active', 'leading-5'],
  // The navigation tree's child indent, which needs an active extension.
  ['extension active', 'pl-2'],
  // `PaneWrapper`'s drawer slot.
  ['utility drawer open', 'w-40'],
  // The 32px collapsed navigation square.
  ['navigation collapsed', 'h-8'],
  // `DropdownMenu.Content`, which lives under `document.body`.
  ['overflow menu open', 'w-44'],
  // `Dialog.Content`, which also lives under `document.body`. The palette is a
  // separate state rather than a variant of the one above, because it is a
  // different Radix primitive in a different portal and its own tokens are
  // unreachable from every other state.
  ['command palette open', 'w-[32rem]'],
  // The selection-triggered floating toolbar inside pane 3. It needs a plug-in
  // to have selected something, which is why `selectingBlueprint` exists. Both
  // portalled surfaces are shut by this point, so `shadow-popover` in this state
  // can only have come from the toolbar.
  ['floating toolbar visible', 'shadow-popover'],
]);

/**
 * Every class token the shell renders, in every state it can be in.
 *
 * Harvested from `document.body` rather than from the render container, because
 * the overflow menu is portalled out of the container and its tokens are not
 * reachable from there at all.
 *
 * **The menu is opened from the keyboard, and that is not a stylistic choice.**
 * A pointer click on the overflow trigger does not open it inside the assembled
 * shell: `PanelResizeHandle` tracks pointer events on the document, every
 * element in jsdom reports a 0×0 rect at the origin, and the handle's 12px hit
 * area therefore claims the pointer-down at (0, 0) before Radix sees it. That is
 * a jsdom artefact with no counterpart in a browser — `src/components/command/__tests__/ContextBar.test.tsx`
 * opens the same menu by click, with no resize handles in the tree — and the
 * keyboard route exercises the same Radix trigger.
 */
async function shellStates(): Promise<Map<string, string[]>> {
  const user = userEvent.setup();
  render(<Harness blueprints={[selectingBlueprint({ ribbonActions: manyRibbonActions() })]} />);
  const states = new Map<string, string[]>();

  states.set('no extension active', classTokens(document.body));

  await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
  states.set('extension active', classTokens(document.body));

  await user.click(screen.getByRole('button', { name: 'Show utility drawer' }));
  states.set('utility drawer open', classTokens(document.body));

  await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
  states.set('navigation collapsed', classTokens(document.body));

  const trigger = screen.getByRole('button', { name: 'More actions' });
  act(() => {
    trigger.focus();
  });
  await user.keyboard('{Enter}');
  expect(screen.getByRole('menu', { name: 'More actions' })).toBeInTheDocument();
  states.set('overflow menu open', classTokens(document.body));
  await user.keyboard('{Escape}');

  // The palette is opened by the HOST's own chord, dispatched on `window`, which
  // is the only route a user has to it and therefore the only honest one here.
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();
  states.set('command palette open', classTokens(document.body));
  await user.keyboard('{Escape}');

  // The floating toolbar needs the plug-in to have selected something. The
  // pane-3 probe offers a button for it rather than the host reaching into the
  // shell store, so the state is reached the way a user reaches it.
  await user.click(screen.getByRole('button', { name: 'Select a row' }));
  expect(screen.getByRole('toolbar', { name: 'Selection commands' })).toBeInTheDocument();
  states.set('floating toolbar visible', classTokens(document.body));

  return states;
}

/**
 * ============================================================================
 * THE COMMAND SURFACES, AS `ShellLayout` WIRES THEM.
 * ============================================================================
 * The surfaces have their own suites under `src/components/command/__tests__/`.
 * What is here is the wiring `ShellLayout` owns and nothing else: the host chord
 * reaching the palette, the host-only "switch extension" verb, and what the shell
 * does with a composer submission it cannot consume yet.
 * ============================================================================
 */
describe('ShellLayout — the command surfaces it wires', () => {
  it('opens the command palette on the host chord and closes it on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[sampleBlueprint()]} />);
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();

    // Dispatched on `window`, which is where `useHotkeyDispatch` listens.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
  });

  it('offers the switch-extension verb in the palette only, and it expands the navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(container.querySelector('[data-shell-region="nav-track"]')).not.toBeNull();

    // Not on the 32px bar: a navigation verb must not spend a contextual slot.
    expect(screen.queryByRole('button', { name: 'Switch extension' })).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.click(screen.getByRole('button', { name: 'Switch extension' }));

    // It expands pane 1 rather than choosing an extension: the host does not know
    // which one the user meant, and picking one would be the shell arguing.
    expect(container.querySelector('[data-shell-region="nav-track"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
  });

  it('echoes a composer submission back rather than pretending to have consumed it', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[sampleBlueprint()]} />);
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));

    // Driven from the KEYBOARD, for the reason `shellStates` opens the overflow
    // menu that way: inside the assembled shell every element reports a 0x0 rect
    // at the origin, so `PanelResizeHandle`'s document pointer tracking claims a
    // pointer-down at (0, 0) before the target sees it. That is a jsdom artefact
    // with no counterpart in a browser, and Enter is the gesture this surface is
    // really built around.
    const input = screen.getByRole('textbox', { name: 'Composer input' });
    act(() => {
      input.focus();
    });
    await user.keyboard('unread{Enter}');

    // The host owns no filter and answers no question. Reaching into the active
    // extension's view to apply one would be host chrome operating a plug-in's
    // UI, which nothing in this repository grants — so the honest thing on screen
    // is the intent and the text the user typed.
    const echo = document.querySelector('[data-shell-region="omnibox-echo"]');
    expect(echo?.textContent).toBe('filter: unread');
    expect(input).toHaveValue('');
  });
});

describe('ShellLayout — density contract', () => {
  it('reaches every rendered state of the shell, proven by a token unique to each', async () => {
    // The scan's own control. Every case below is a filter over harvested
    // tokens, and a filter over an empty harvest is green — so what each state
    // contributed is asserted before anything is concluded from it.
    const states = await shellStates();
    expect([...states.keys()]).toEqual([...STATE_MARKERS.keys()]);
    for (const [state, marker] of STATE_MARKERS) {
      expect(states.get(state) ?? [], `${state} must contribute ${marker}`).toContain(marker);
    }
  });

  it('uses no padding above p-3 in any rendered state of the shell', async () => {
    for (const [state, tokens] of await shellStates()) {
      expect(paddingOffenders(tokens), `padding offenders while ${state}`).toEqual([]);
    }
  });

  it('keeps every declared type size inside the 11px–13px band in any rendered state', async () => {
    for (const [state, tokens] of await shellStates()) {
      expect(typeSizeOffenders(tokens), `type-size offenders while ${state}`).toEqual([]);
    }
    expect(document.querySelector('[data-shell-region="root"]')).toHaveClass('text-[12px]');
  });

  it('reports p-8, p-[64px], ps-8 and text-lg, so the density scan cannot pass vacuously', () => {
    // One control per spelling the widened scan now catches, including the three
    // that were reproduced walking straight through the old regexes.
    expect(densityOffenders(['p-8'])).toEqual(['p-8']);
    expect(densityOffenders(['p-[64px]'])).toEqual(['p-[64px]']);
    expect(densityOffenders(['ps-8'])).toEqual(['ps-8']);
    expect(densityOffenders(['text-lg'])).toEqual(['text-lg']);

    // ...and the near neighbours of each, so the rules are not passing by
    // accident of shape.
    expect(densityOffenders(['pe-[4rem]'])).toEqual(['pe-[4rem]']);
    expect(densityOffenders(['px-3.5'])).toEqual(['px-3.5']);
    expect(densityOffenders(['p-[max(2rem,4vw)]'])).toEqual(['p-[max(2rem,4vw)]']);
    expect(densityOffenders(['p-[2vw]'])).toEqual(['p-[2vw]']);
    expect(densityOffenders(['text-sm'])).toEqual(['text-sm']);
    expect(densityOffenders(['text-9xl'])).toEqual(['text-9xl']);
    expect(densityOffenders(['text-[64px]'])).toEqual(['text-[64px]']);
    expect(densityOffenders(['text-[0.625rem]'])).toEqual(['text-[0.625rem]']);
    expect(densityOffenders(['text-[2vw]'])).toEqual(['text-[2vw]']);

    // A variant prefix is not a hiding place, and neither is a bracket
    // containing a colon of its own.
    expect(densityOffenders(['dark:hover:p-8'])).toEqual(['dark:hover:p-8']);
    expect(densityOffenders(['aria-[current]:text-lg'])).toEqual(['aria-[current]:text-lg']);

    // R8. AN UNMEASURABLE TYPE SIZE IS REPORTED, NOT SKIPPED.
    //
    // Every one of these used to pass in silence, and `text-[var(--type-body)]`
    // is the exact spelling the plan names: tokenising font size before this
    // branch was fixed would have replaced a measured type scale with values
    // this scan waves through, so the whole density contract would have gone on
    // reporting nothing while looking green.
    expect(densityOffenders(['text-[var(--type-body)]'])).toEqual(['text-[var(--type-body)]']);
    expect(densityOffenders(['text-[calc(1rem_-_2px)]'])).toEqual(['text-[calc(1rem_-_2px)]']);
    expect(densityOffenders(['text-[clamp(11px,1vw,13px)]'])).toEqual([
      'text-[clamp(11px,1vw,13px)]',
    ]);
    expect(densityOffenders(['hover:text-[var(--x)]'])).toEqual(['hover:text-[var(--x)]']);

    // ...and the ONE case that stays exempt, which is what stops the widened
    // rule from swallowing colour. Tailwind's `color:` hint is proof that the
    // value is not a length; nothing else is.
    expect(densityOffenders(['text-[color:var(--text-muted)]'])).toEqual([]);
    expect(densityOffenders(['text-[color:#123456]'])).toEqual([]);

    // The tokens the shell actually uses stay clean, so the rules are not
    // simply reporting everything.
    expect(
      densityOffenders([
        'p-1',
        'px-1',
        'pl-2',
        'p-3',
        'p-px',
        'text-[11px]',
        'text-[12px]',
        'text-xs',
        TOKEN_CLASS.mutedText,
        TOKEN_CLASS.paneText,
        'text-center',
        '[contain:paint]',
        'max-w-[9rem]',
        'pointer-events-none',
        'place-items-center',
      ]),
    ).toEqual([]);
  });

  it('uses one 1px token border on every pane edge and on the context bar', () => {
    render(<Harness />);
    for (const label of ['Navigation', 'List', 'Detail']) {
      const pane = screen.getByRole('region', { name: label });
      expect(pane).toHaveClass('border');
      expect(pane).toHaveClass(TOKEN_CLASS.paneBorder);
    }
    const bar = screen.getByRole('toolbar', { name: 'Shell commands' });
    expect(bar).toHaveClass('border-b');
    expect(bar).toHaveClass(TOKEN_CLASS.ribbonBorder);
  });

  it('renders no dark: variant anywhere in the assembled shell, in any state', async () => {
    // ISSUE-67 IN ITS ENTIRETY, ANSWERED BY SUBTRACTION.
    //
    // The shell used to carry 51 `dark:` variants and the issue's own wording is
    // that they "are exercised by nothing whatsoever": jsdom implements no
    // `matchMedia`, applies no stylesheet and resolves no variant, so every one
    // of them was untested and untestable in this lane. The fix is not a test
    // for them. It is that a colour is now a token whose VALUE swaps on
    // `[data-theme]`, which leaves `dark:border-neutral-800` with nothing to say.
    //
    // This walks every state `shellStates` reaches — including the portalled
    // overflow menu, which is not in the render container — so it covers the
    // same surface the density scan does, and it is guarded by the same
    // did-we-reach-every-state control that scan already has.
    const states = await shellStates();
    expect([...states.keys()]).toEqual([...STATE_MARKERS.keys()]);
    for (const [state, tokens] of states) {
      expect(
        tokens.filter((token) => token.startsWith('dark:')),
        `dark: variants while ${state}`,
      ).toEqual([]);
    }
  });
});

/**
 * ============================================================================
 * CONTRAST AND TARGET SIZE, ASSERTED AS CLASS TOKENS — AND WHY THAT IS THE
 * HONEST FORM OF THE ASSERTION RATHER THAN A WEAKER ONE.
 * ============================================================================
 * These are colour and geometry properties, which is exactly what jsdom cannot
 * evaluate: it applies no stylesheet, resolves no `dark:` variant, computes no
 * used value, and reports every box as 0×0. `getComputedStyle` here would return
 * the initial value for every property and a test built on it would assert
 * nothing while looking rigorous.
 *
 * So each case below pins the CLASS TOKEN that carries the fix. A token can be
 * deleted and these fail; a token can be present while the compiled stylesheet
 * says something else, and these would not notice. That second gap is what the
 * headless-Chrome pass over the compiled CSS covers, and it is not runnable
 * from vitest.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TOKEN MIGRATION TOOK AWAY FROM THIS BLOCK. SAY IT, DO NOT BURY IT.
 * ---------------------------------------------------------------------------
 * These cases used to assert literal colours — `border-neutral-200`,
 * `dark:text-neutral-400` — and quote the ratio each was measured at, so the
 * number was recoverable from the test rather than only from a commit message.
 * That was two independent spellings of one intent, and it caught a component
 * repointed at the wrong colour.
 *
 * They now assert `TOKEN_CLASS.*`, which the component imports too. **A
 * component pointed at the wrong token can no longer be caught here**, because
 * both sides move together. `src/core/theme/tokenClasses.ts` carries the full
 * account and names the two things that are the compensation:
 * `scripts/check-tokens.mjs` re-measures every declared pair in all three
 * themes, and `e2e/theme.spec.ts` proves the compiled stylesheet applies them.
 *
 * The ratios are no longer quoted here either, and that is deliberate rather
 * than lazy. A token resolves to a different value per theme and is measured
 * against every surface it is drawn on; the honest place for those numbers is
 * `design/contrast-manifest.json`, where a checker reads them, and not a comment
 * where they rot. What survives in this block is the structural half — the right
 * ROLE is on the right element, and there is no appearance-conditional variant
 * beside it — which is the half jsdom can actually see.
 * ============================================================================
 */
describe('ShellLayout — contrast and target size', () => {
  it('routes every muted body string through one token instead of a per-theme patch', async () => {
    const { user, container } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Show utility drawer' }));

    const muted = Array.from(container.querySelectorAll(`[class*="${TOKEN_CLASS.mutedText}"]`));
    // The scan's own control: a filter over an empty harvest is green.
    expect(muted.length).toBeGreaterThan(0);
    for (const element of muted) {
      expect(element).toHaveClass(TOKEN_CLASS.mutedText);
      // AND NOTHING BESIDE IT. This is the case that used to require
      // `dark:text-neutral-400` on every muted string, because `#737373`
      // measured 4.18:1 on the dark pane — under the 4.5:1 WCAG 1.4.3 asks of
      // 12px body text — while measuring fine in light. Every one of those
      // overrides had to be written, and remembered, by hand. `--text-muted`
      // is resolved per theme and validated against all eight surfaces in all
      // three, so the override is not merely untested now: it is unnecessary,
      // and its absence is the assertion.
      for (const token of element.className.split(/\s+/)) {
        expect(token.startsWith('dark:'), `${token} is an untestable variant`).toBe(false);
      }
    }
  });

  it('carries the selected navigation state on a rule and a weight, not only a fill', async () => {
    const { user } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Root B' }));
    const selected = screen.getByRole('button', { name: 'Root B' });

    // `aria-current` was already correct, so this was never a screen-reader
    // defect — it was a sighted and low-vision one.
    expect(selected).toHaveAttribute('aria-current', 'true');

    // The fill stays but cannot be the indicator: no fill reaches the 3:1 WCAG
    // 1.4.11 asks of a non-text state indicator without going dark enough to
    // read as a different control entirely.
    expect(selected).toHaveClass(TOKEN_CLASS.navSelectedSurface);
    // What actually carries it: a 2px leading rule at `--border-selected`, plus
    // a semibold label. Two channels, neither of them the fill.
    expect(selected).toHaveClass(TOKEN_CLASS.navSelectedRule);
    expect(selected).toHaveClass('aria-[current]:font-semibold');

    // The rule and the outline are DIFFERENT tokens, which is the part a
    // constant-versus-constant assertion can still prove. Before this change
    // both were `neutral-200`-family values and the outline was as heavy as the
    // rule; `design/README.md` flags the split and declines to resolve it, and
    // it is resolved as decoration-versus-indicator here.
    expect(TOKEN_CLASS.navSelectedRule).not.toEqual(TOKEN_CLASS.navSelectedBorder);
    expect(selected).toHaveClass(TOKEN_CLASS.navSelectedBorder);
  });

  it('draws the dividers from the control tier rather than from the border tier', () => {
    render(<Harness />);
    const separators = screen.getAllByRole('separator');
    expect(separators.length).toBeGreaterThan(0);
    for (const separator of separators) {
      // The divider once used the same value as the pane borders it abuts, at
      // 1.26:1 against them, so it read as one more border rather than as a
      // control. It now has its own token group — see `design/README.md`
      // "Honest limits" item 9 for why a filled 4px bar with hover and drag
      // states could not share `--border-*` and stay measurable.
      expect(separator).toHaveClass(TOKEN_CLASS.dividerIdle);
      expect(separator).toHaveClass(TOKEN_CLASS.dividerHover);
      expect(separator).toHaveClass(TOKEN_CLASS.dividerDrag);
      // ...and it is NOT the pane border, which is the property that regressed
      // last time and the one worth restating structurally.
      expect(separator).not.toHaveClass(TOKEN_CLASS.paneBorder);
    }
  });

  it('gives every navigation row a 24px minimum height', async () => {
    const { user } = await renderActivated();
    // Measured at 163.9 × 22 before this, with 0px and 1px gaps between stacked
    // rows — so the WCAG 2.5.8 spacing exception did not apply either.
    expect(screen.getByRole('button', { name: 'Root B' })).toHaveClass('min-h-6');
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    // The collapsed square is 32px, and `min-h-6` does not shrink it.
    const collapsed = screen.getByRole('button', { name: 'Root B' });
    expect(collapsed).toHaveClass('min-h-6');
    expect(collapsed).toHaveClass('h-8');
  });

  it('gives every context-bar control a 24px minimum height', async () => {
    const { container } = await renderActivated();
    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>('[data-shell-region="context-bar"] button'),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-6');
    }
  });

  it('names the badge count instead of folding a bare digit into the button name', async () => {
    await renderActivated();
    // "Root A 3" named no unit and read as part of the label. `badgeCount` is
    // documented only as a "badge", so the qualifier claims nothing more.
    const badged = screen.getByRole('button', { name: 'Root A badge 3' });
    expect(badged.querySelector('.sr-only')?.textContent).toBe('badge ');
    expect(badged.textContent).toContain('3');
    expect(screen.queryByRole('button', { name: 'Root A 3' })).toBeNull();
  });

  it('reports every divider as a vertical separator', () => {
    render(<Harness />);
    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      // `separator` defaults to `horizontal`. These split side-by-side panes, so
      // the default announced the wrong axis on every one of them.
      expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    }
  });
});

/**
 * A pane view that throws during render, which is the one thing a plug-in can
 * really do to the host through the documented contract.
 */
function makeExplodingView(pane: string) {
  return function Exploding(_props: ExtensionViewProps): ReactElement {
    throw new Error(`${pane} exploded`);
  };
}

describe('ShellLayout — fault containment', () => {
  beforeEach(() => {
    // React writes its own "The above error occurred in…" line for every caught
    // error. Silenced so a contained failure does not look like a test failure.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('contains a throwing pane-2 view to pane 2, leaving the context bar and pane 3 interactive', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[
          sampleBlueprint({
            views: { pane2: makeExplodingView('pane 2'), pane3: makeProbe('pane3') },
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));

    // The pane keeps its border, its accessible name and its header. Only the
    // BODY is replaced, and what replaces it is host-authored.
    const list = screen.getByRole('region', { name: 'List' });
    expect(list.querySelector('[data-pane-slot="header"]')).toHaveTextContent('List');
    const surface = within(list).getByRole('alert');
    expect(surface).toHaveTextContent('The list view could not be displayed.');
    expect(surface.querySelector('[data-fault-extension]')).toHaveTextContent('sample-ext');
    expect(surface).toHaveTextContent('pane 2 exploded');
    expect(within(list).getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // Pane 3 rendered its plug-in view, which means the sibling subtree was
    // never unmounted...
    expect(screen.getByTestId('probe-pane3')).toBeInTheDocument();
    // ...and the context bar is not merely present, it still works.
    await user.click(screen.getByRole('button', { name: 'Show utility drawer' }));
    expect(screen.getByRole('button', { name: 'Hide utility drawer' })).toBeInTheDocument();
  });

  it('contains a throwing pane-3 view to pane 3, leaving pane 2 interactive', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[
          sampleBlueprint({
            views: { pane2: makeProbe('pane2'), pane3: makeExplodingView('pane 3') },
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));

    expect(screen.getByTestId('probe-pane2')).toBeInTheDocument();
    const detail = screen.getByRole('region', { name: 'Detail' });
    expect(within(detail).getByRole('alert')).toHaveTextContent(
      'The detail view could not be displayed.',
    );
  });

  it('contains a throwing context bar without taking the panes down', () => {
    contextBar.shouldThrow = true;
    render(<Harness blueprints={[sampleBlueprint()]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The context bar could not be displayed.');
    // The DoD asks for the ribbon and the other panes to stay interactive when
    // something fails. That is only guaranteed if the ribbon's own failure is
    // contained too, which is why it has a boundary of its own.
    expect(screen.getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detail' })).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('clears a pane error surface when the active extension changes', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[
          sampleBlueprint({
            id: 'ext-broken',
            name: 'Broken Extension',
            views: { pane2: makeExplodingView('pane 2'), pane3: makeProbe('pane3') },
          }),
          sampleBlueprint({ id: 'ext-healthy', name: 'Healthy Extension' }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Broken Extension' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Rapid extension switching: without `resetKey`, the broken extension's
    // error surface would still be latched over the healthy one's fresh view.
    await user.click(screen.getByRole('button', { name: 'Healthy Extension' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('probe-pane2')).toBeInTheDocument();
  });

  it('keeps offering a retry that re-runs the failing view', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[
          sampleBlueprint({
            views: { pane2: makeExplodingView('pane 2'), pane3: makeProbe('pane3') },
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
    const list = screen.getByRole('region', { name: 'List' });
    await user.click(within(list).getByRole('button', { name: 'Retry' }));
    // It throws again, and the failure is contained again rather than escaping
    // on the second attempt.
    expect(within(list).getByRole('alert')).toHaveTextContent('pane 2 exploded');
    expect(screen.getByTestId('probe-pane3')).toBeInTheDocument();
  });
});

/**
 * GitHub issue #114, and it is the narrowest of the five UI defects.
 *
 * `react-resizable-panels` requires the panels in ONE group to sum to 100. The
 * three shell panes are siblings in `shell-panes` when the chrome surface is
 * expanded, and that case always summed correctly. When navigation COLLAPSES,
 * pane 1 becomes a fixed 48px `div` rendered outside the group, so the group
 * holds pane 2 and pane 3 alone — and the pane-1 share was still being
 * subtracted from pane 3's remainder.
 *
 * **TWO DIFFERENT TOTALS APPEAR IN THIS REPOSITORY AND BOTH ARE RIGHT.** The
 * issue title says 83: that is the measured 1440px case, 25 and
 * 58.33333333333334, which is what the reported warning named. This suite runs
 * at the unmeasurable-width fallback, where `PANE_FALLBACK_PERCENT` gives 26
 * and 56, summing to 82. The number depends on the group width; the defect does
 * not. Both were observed — the 82 by reverting this fix and reading the
 * warning this case captures.
 *
 * **This is observable in jsdom, and that is worth stating because most of this
 * redesign's defects are not.** `measureGroup` reads
 * `getBoundingClientRect().width`, which jsdom reports as 0 — not `null` — so
 * the group still renders, `percentOf` falls through to
 * `PANE_FALLBACK_PERCENT`, and the library still does the arithmetic and still
 * warns. No geometry is required to see it. The browser lane still owns the
 * question of what the panes actually MEASURE; this owns the question of
 * whether the numbers handed to the library are legal.
 */
describe('default pane sizes are shares of the group that actually holds the panes', () => {
  it('hands the two content panes sizes summing to 100 once navigation collapses, and the library reports no invalid total', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(<Harness blueprints={[selectingBlueprint()]} />);
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    const complaints = [...warn.mock.calls, ...error.mock.calls]
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .filter((text) => text.includes('Invalid layout total size'));

    warn.mockRestore();
    error.mockRestore();
    expect(complaints).toEqual([]);
  });
});
