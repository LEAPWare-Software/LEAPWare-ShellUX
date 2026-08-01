import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellHostProvider, useExtensionActivation } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import type { ExtensionViewProps } from '../../core/types';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * The ribbon, swapped for one that can be told to throw.
 *
 * `RibbonToolbar` renders validated primitive strings and host-owned callbacks,
 * so **there is no input reachable through the public contract that makes it
 * throw during render** — which is exactly why its fault boundary needs a test
 * of its own rather than a hopeful sentence. The real component is used
 * everywhere in this file except the one case that flips this flag, so nothing
 * else here is testing a double.
 */
const ribbon = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('../ui/RibbonToolbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/RibbonToolbar')>();
  return {
    ...actual,
    RibbonToolbar: (props: Parameters<typeof actual.RibbonToolbar>[0]): ReactElement => {
      if (ribbon.shouldThrow) {
        throw new Error('the ribbon exploded');
      }
      return <actual.RibbonToolbar {...props} />;
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
  ribbon.shouldThrow = false;
  vi.restoreAllMocks();
});

describe('ShellLayout — structure and focus order', () => {
  it('renders the ribbon and three panes in ribbon → pane 1 → pane 2 → pane 3 order', () => {
    const { container } = render(<Harness />);
    const regions = Array.from(
      container.querySelectorAll('[data-shell-region="ribbon"], [data-pane]'),
    ).map(
      (element) => element.getAttribute('data-shell-region') ?? element.getAttribute('data-pane'),
    );
    expect(regions).toEqual(['ribbon', 'pane1', 'pane2', 'pane3']);
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

  it('survives a collapse toggled while a divider drag is in flight', async () => {
    const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
    const [handle] = screen.getAllByRole('separator');
    expect(handle).toBeDefined();

    // Begin a drag, then collapse without ever releasing the pointer. The handle
    // being dragged is unmounted mid-gesture, which is the case the edge-case
    // list names.
    fireEvent.pointerDown(handle as Element, { pointerId: 1, clientX: 300, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 10 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 10 });

    // The layout is intact: a 48px track, one divider, and panes that still sum
    // to the whole rather than to whatever the abandoned drag last computed.
    expect(
      (container.querySelector('[data-shell-region="nav-track"]') as HTMLElement).style.width,
    ).toBe('48px');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const sizes = panelSizes(container);
    expect(sizes).toHaveLength(2);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeCloseTo(100, 1);
  });
});

describe('ShellLayout — extensions', () => {
  it('leaves the ribbon contextual side empty when no extension is active', () => {
    const { container } = render(<Harness blueprints={[sampleBlueprint()]} />);
    const contextual = container.querySelector('[data-ribbon-side="extension"]');
    expect(contextual?.querySelectorAll('button')).toHaveLength(0);
    // `aria-disabled`, not the native attribute: this is the shell's DEFAULT
    // state, so a natively disabled button would put "Close extension" outside
    // the tab order of every fresh session and a keyboard user would never learn
    // the command existed. See the `ActionButton` docblock in `RibbonToolbar`.
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
    const contextual = container.querySelector('[data-ribbon-side="extension"]');
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

  it('closes the active extension from the host ribbon', async () => {
    const { user, container } = await renderActivated();
    const close = screen.getByRole('button', { name: 'Close extension' });
    expect(close).not.toHaveAttribute('aria-disabled');

    await user.click(close);
    expect(screen.queryByTestId('probe-pane2')).toBeNull();
    expect(container.querySelector('[data-ribbon-side="extension"]')?.querySelectorAll('button'))
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
 * where a violation would choose to sit. Type sizes are the other way round, and
 * have to be: `text-` is also the prefix for colour and alignment, so an
 * arbitrary value that is not a length at all (`text-[color:var(--x)]`) is not a
 * type size and is not this rule's business. An arbitrary value that IS
 * length-shaped in a unit with no fixed pixel equivalent is still reported.
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
      // A colour or an alignment. Not a type size, so not this rule's business.
      return false;
    }
    const pixels = arbitrary[1] === undefined ? null : arbitraryPx(arbitrary[1]);
    if (pixels === null) {
      return false;
    }
    return Number.isNaN(pixels) || pixels < TYPE_BAND_PX.min || pixels > TYPE_BAND_PX.max;
  });
}

/** Both rules at once, for the control case. */
function densityOffenders(tokens: readonly string[]): string[] {
  return [...paddingOffenders(tokens), ...typeSizeOffenders(tokens)];
}

/** Seven visible ribbon actions, so the shell really grows an overflow menu. */
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
 * a jsdom artefact with no counterpart in a browser — `RibbonToolbar.test.tsx`
 * opens the same menu by click, with no resize handles in the tree — and the
 * keyboard route exercises the same Radix trigger.
 */
async function shellStates(): Promise<Map<string, string[]>> {
  const user = userEvent.setup();
  render(<Harness blueprints={[sampleBlueprint({ ribbonActions: manyRibbonActions() })]} />);
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

  return states;
}

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
        'text-neutral-500',
        'dark:text-neutral-400',
        'text-center',
        '[contain:paint]',
        'max-w-[9rem]',
        'pointer-events-none',
        'place-items-center',
      ]),
    ).toEqual([]);
  });

  it('uses the specified 1px neutral border tokens in both themes', () => {
    render(<Harness />);
    for (const label of ['Navigation', 'List', 'Detail']) {
      const pane = screen.getByRole('region', { name: label });
      expect(pane).toHaveClass('border');
      expect(pane).toHaveClass('border-neutral-200');
      expect(pane).toHaveClass('dark:border-neutral-800');
    }
    const ribbon = screen.getByRole('toolbar', { name: 'Shell ribbon' });
    expect(ribbon).toHaveClass('border-b');
    expect(ribbon).toHaveClass('border-neutral-200');
    expect(ribbon).toHaveClass('dark:border-neutral-800');
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
 * So each case below pins the CLASS TOKEN that carries the fix, and states the
 * ratio that token was measured at in a real engine so the number is recoverable
 * from the test rather than only from a commit message. A token can be deleted
 * and these fail; a token can be present while the compiled stylesheet says
 * something else, and these would not notice. That second gap is what the
 * headless-Chrome pass over the compiled CSS covers, and it is not runnable
 * from vitest.
 *
 * The failing values are named alongside the fixed ones on purpose: `neutral-400`
 * is the FIX in dark and would be a REGRESSION in light — 7.85:1 on
 * `neutral-950` against 2.52:1 on white — so "did the light value change" is a
 * thing worth asserting in its own right.
 * ============================================================================
 */
describe('ShellLayout — contrast and target size', () => {
  it('gives every muted body string a dark-mode value that clears 4.5:1', async () => {
    const { user, container } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Show utility drawer' }));

    const muted = Array.from(container.querySelectorAll('[class*="text-neutral-500"]'));
    expect(muted.length).toBeGreaterThan(0);
    for (const element of muted) {
      // `#737373` on the pane's `dark:bg-neutral-950` (`#0a0a0a`) is 4.18:1 —
      // under 4.5:1, with no large-text allowance at 11px and 12px.
      // `#a3a3a3` on the same background is 7.85:1.
      expect(element).toHaveClass('dark:text-neutral-400');
      // ...and the light value is untouched, because `neutral-400` on white is
      // 2.52:1 and would be a worse failure than the one being fixed.
      expect(element).toHaveClass('text-neutral-500');
    }
  });

  it('carries the selected navigation state on a rule and a weight, not only a fill', async () => {
    const { user } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Root B' }));
    const selected = screen.getByRole('button', { name: 'Root B' });

    // `aria-current` was already correct, so this was never a screen-reader
    // defect — it was a sighted and low-vision one.
    expect(selected).toHaveAttribute('aria-current', 'true');

    // The fill stays but cannot be the indicator: `#f5f5f5` on `#ffffff` is
    // 1.09:1 and the border beside it 1.26:1, against the 3:1 WCAG 1.4.11 asks
    // of a non-text state indicator.
    expect(selected).toHaveClass('aria-[current]:bg-neutral-100');
    // What actually carries it: a 2px leading rule at `neutral-500` (4.74:1 on
    // white, 4.35:1 on the fill) / `neutral-400` in dark (7.85:1 on
    // `neutral-950`), plus a semibold label.
    expect(selected).toHaveClass('aria-[current]:shadow-[inset_2px_0_0_0_theme(colors.neutral.500)]');
    expect(selected).toHaveClass(
      'dark:aria-[current]:shadow-[inset_2px_0_0_0_theme(colors.neutral.400)]',
    );
    expect(selected).toHaveClass('aria-[current]:font-semibold');
  });

  it('draws the dividers dark enough to read as controls rather than as pane borders', () => {
    render(<Harness />);
    for (const separator of screen.getAllByRole('separator')) {
      // `bg-neutral-200` was the SAME token as the pane borders it abuts —
      // 1.26:1 against them. `neutral-500` is 4.74:1 on white and 4.54:1 on the
      // `neutral-50` behind the group; `neutral-400` is 7.85:1 on `neutral-950`.
      expect(separator).toHaveClass('bg-neutral-500');
      expect(separator).toHaveClass('dark:bg-neutral-400');
      expect(separator).not.toHaveClass('bg-neutral-200');
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

  it('gives every ribbon control a 24px minimum height', async () => {
    const { container } = await renderActivated();
    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>('[data-shell-region="ribbon"] button'),
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

  it('contains a throwing pane-2 view to pane 2, leaving the ribbon and pane 3 interactive', async () => {
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
    // ...and the ribbon is not merely present, it still works.
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

  it('contains a throwing ribbon without taking the panes down', () => {
    ribbon.shouldThrow = true;
    render(<Harness blueprints={[sampleBlueprint()]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The ribbon could not be displayed.');
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
