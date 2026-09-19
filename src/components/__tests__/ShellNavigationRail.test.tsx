import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * ============================================================================
 * W3-3 — THE DOM FACTS A JSDOM SUITE CAN OBSERVE.
 * ============================================================================
 * `docs/design/WAVE3-PLAN.md`'s W3-3 row: the current-node fill and ink, the
 * child guide rule, the fallback identity tile's classes, and that the rail
 * tooltip's trigger and content exist and carry the row's label. What none of
 * these cases can see — a real 32px box, a painted background colour, whether
 * the tooltip's portal survives the two `overflow-hidden` ancestors between it
 * and the rail — is measured in `e2e/shell-layout.spec.ts` instead, in a real
 * browser, and mutation-probed there. A title in this file says only what a
 * class list or a text node can prove.
 * ============================================================================
 */

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

function Harness({ blueprints }: { readonly blueprints: readonly unknown[] }): ReactElement {
  // Memory-only, so nothing here reaches the process-wide engine.
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

describe('ShellNavigation — the current node (W3-3)', () => {
  it('fills the current node with the accent-subtle surface and names the ink explicitly', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Root B' }));

    const current = screen.getByRole('button', { name: 'Root B' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveClass(TOKEN_CLASS.navCurrentSurface);
    expect(current).toHaveClass(TOKEN_CLASS.navCurrentText);
    // The rule that was already clearing WCAG 1.4.11 on its own is unmoved.
    expect(current).toHaveClass(TOKEN_CLASS.navSelectedRule);
    // The full outline this fill replaces is gone — see
    // `src/components/__tests__/ShellLayout.test.tsx` for the fuller case;
    // this one is scoped to the fill and ink `ShellNavigation.tsx` itself owns.
    expect(current).not.toHaveClass(TOKEN_CLASS.navSelectedBorder);
  });

  it('does not fill a row that is not current', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Root B' }));

    // `Root A` carries a badge, so its accessible name is "Root A badge 3".
    const other = screen.getByRole('button', { name: /^Root A\b/ });
    expect(other).not.toHaveAttribute('aria-current', 'true');
  });
});

describe('ShellNavigation — the child guide rule (W3-3)', () => {
  it('hangs a child level off a 1px border-subtle rule at the indent', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));

    // `Root A` declares `children: [{ id: 'child-a', label: 'Child A' }]`; its
    // indent wrapper is the one element in the tree carrying both `border-l`
    // and the guide-rule token together.
    const child = screen.getByRole('button', { name: 'Child A' });
    const indent = child.closest(`.${TOKEN_CLASS.navGuideRule}`);
    expect(indent).not.toBeNull();
    expect(indent).toHaveClass('border-l');
    expect(indent).toHaveClass('pl-3');
    // The rule marks structure and carries no state — scoped to the
    // Navigation pane, because `sectionEdge` names the same token for pane 3's
    // section dividers and this case is not about those.
    const nav = screen.getByRole('region', { name: 'Navigation' });
    expect(nav.querySelectorAll(`.${TOKEN_CLASS.navGuideRule}`)).toHaveLength(1);
  });

  it('draws no guide rule for a root with no children', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));

    // `Root B` declares no `children` at all.
    const rootB = screen.getByRole('button', { name: 'Root B' });
    expect(rootB.parentElement?.querySelector(`.${TOKEN_CLASS.navGuideRule}`)).toBeNull();
  });

  it('renders no guide rule in the collapsed track, which shows only the top level', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    const nav = screen.getByRole('region', { name: 'Navigation' });
    expect(nav.querySelectorAll(`.${TOKEN_CLASS.navGuideRule}`)).toHaveLength(0);
  });
});

describe('ShellNavigation — the fallback identity tile (R4, D-40)', () => {
  it('paints the same fixed fill and ink on an icon-less collapsed row whether or not it is aria-current', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    // Selected BEFORE collapsing, so `Root B` carries `aria-current="true"`
    // once the rail renders — selection is a store write independent of the
    // collapsed flag, and clicking after collapse would exercise the same
    // handler with no more evidence for it.
    await user.click(screen.getByRole('button', { name: 'Root B' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    // `Root A` is current-eligible but is not the one selected; `Root B` IS
    // `aria-current="true"` here. Both are asserted, with the current one's
    // attribute checked directly, so the tile is shown to paint the same way
    // in both states rather than merely on two rows that both happen not to
    // be current.
    const current = screen.getByRole('button', { name: /^Root B\b/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    for (const row of [screen.getByRole('button', { name: /^Root A\b/ }), current]) {
      const tile = row.querySelector('[aria-hidden="true"]');
      expect(tile, 'renders no aria-hidden tile').not.toBeNull();
      expect(tile).toHaveClass(TOKEN_CLASS.identityTileSurface);
      expect(tile).toHaveClass(TOKEN_CLASS.identityTileText);
      // Each row's own initial — `makeBlueprint`'s two roots share a first
      // letter ("Root A", "Root B"), which is why this reads the row's own
      // `sr-only` label rather than asserting a hard-coded letter. The native
      // `title` attribute is unavailable here: it is dropped in the collapsed
      // state, which is the state under test.
      const label = row.querySelector('.sr-only')?.textContent ?? '';
      expect(tile?.textContent).toBe(label.charAt(0));
    }
  });

  it('draws no identity tile on a row that has a real icon', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[
          makeBlueprint({ navigationTree: [{ id: 'iconed', label: 'Iconed Node', icon: 'box' }] }),
        ]}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    const row = screen.getByRole('button', { name: 'Iconed Node' });
    const hidden = row.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toHaveClass(TOKEN_CLASS.identityTileSurface);
    expect(hidden?.querySelector('svg')).not.toBeNull();
  });

  it('draws no identity tile in the expanded pane, which renders no icon glyph at all', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint()]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));

    const row = screen.getByRole('button', { name: 'Root B' });
    expect(row.querySelector(`.${TOKEN_CLASS.identityTileSurface}`)).toBeNull();
  });
});

describe('ShellNavigation — the rail tooltip (W3-3)', () => {
  it('wires a collapsed row through a tooltip trigger that opens on focus, showing the title alone', async () => {
    render(<Harness blueprints={[makeBlueprint()]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    const rootB = screen.getByRole('button', { name: 'Root B' });
    // The native `title` attribute is dropped in the collapsed state — see the
    // docblock's argument for why a second, native tooltip would stack on top
    // of Radix's own.
    expect(rootB).not.toHaveAttribute('title');

    // Radix mounts `Tooltip.Content` only once open; jsdom performs no paint
    // and no real hover, but a focus event is a real DOM event this
    // environment can dispatch, and Radix opens on focus for keyboard users
    // exactly as it does on hover for pointer ones.
    fireEvent.focus(rootB);
    const tooltip = await screen.findByRole('tooltip');
    // The title alone — no shortcut column, because step 6c has not landed
    // and neither a `NavigationNode` nor a `LEAPExtensionBlueprint` carries a
    // hotkey field this row could read one from yet.
    expect(tooltip.textContent).toBe('Root B');
  });

  it('renders no tooltip trigger at all in the expanded pane, where the label is already visible text', async () => {
    render(<Harness blueprints={[makeBlueprint()]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));

    const rootB = screen.getByRole('button', { name: 'Root B' });
    expect(rootB).toHaveAttribute('title', 'Root B');
    fireEvent.focus(rootB);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
