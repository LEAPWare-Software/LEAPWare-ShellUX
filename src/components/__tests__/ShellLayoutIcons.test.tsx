import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import { DatabasePlugin } from '../../mocks/DatabasePlugin';
import { ShellLayout } from '../layout/ShellLayout';
import { FALLBACK_ICON, SHELL_ICONS } from '../ui/shellIcons';

/**
 * ============================================================================
 * NAVIGATION ICONS, AND THE VOCABULARY THAT MAKES THEM USABLE
 * ============================================================================
 * The collapsed 48px pane-1 track drew a MONOGRAM — the first letter of each
 * label — and nothing else. Our own `DatabasePlugin` roots are Components,
 * Assemblies and Consumables, so the collapsed rail read "C A C" and two of the
 * three rows were the same glyph (GitHub issue #19).
 *
 * `NavigationNode.icon` fixes it, and it is held to exactly the rule
 * `RibbonAction.icon` is held to: an UNTRUSTED LOOKUP KEY, resolved through the
 * host-owned `SHELL_ICONS` map, never interpolated into markup or a URL. The
 * three outcomes are distinct on purpose and are asserted separately here:
 *
 *   declared and known   -> the host's glyph for that key
 *   declared and unknown -> the host's FALLBACK glyph, the same one the ribbon
 *                           shows, because a mistyped key and no key at all are
 *                           different situations and must not look identical
 *   not declared         -> the monogram, exactly as before
 *
 * The last case in this file is the other half of issue #18: a vocabulary a
 * vendor cannot read is a vocabulary a vendor guesses at, so the key list is
 * published in `DEVELOPER.md` and this file reads BOTH and fails if they
 * disagree in either direction.
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

/**
 * A tree whose four roots are the four cases: a known icon, an unknown icon, a
 * prototype-shaped icon, and no icon at all.
 */
const ICON_TREE = [
  { id: 'known', label: 'Known Icon', icon: 'box' },
  { id: 'unknown', label: 'Unknown Icon', icon: 'no-such-icon' },
  { id: 'proto', label: 'Proto Icon', icon: 'constructor' },
  { id: 'plain', label: 'Plain Node' },
];

/** Render the shell with the icon tree registered, activated and collapsed. */
async function renderCollapsed(): Promise<void> {
  const user = userEvent.setup();
  render(<Harness blueprints={[makeBlueprint({ navigationTree: ICON_TREE })]} />);
  await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
  await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
}

/** The `d` attributes of whatever the collapsed row for `name` is drawing. */
function glyphPathsOf(name: string): string[] {
  const button = screen.getByRole('button', { name });
  return Array.from(button.querySelectorAll('svg path')).map(
    (path) => path.getAttribute('d') ?? '',
  );
}

/** The `d` attributes a host `ReactElement` glyph carries, read off its props. */
function pathsOfGlyph(glyph: unknown): readonly string[] {
  const props = (glyph as { props: { children: { props: { d: string } }[] } }).props;
  return props.children.map((child) => child.props.d);
}

describe('ShellLayout — navigation icons in the collapsed track', () => {
  it('renders a declared node icon in the collapsed track instead of the monogram', async () => {
    await renderCollapsed();
    const drawn = glyphPathsOf('Known Icon');

    expect(drawn).toEqual(pathsOfGlyph(SHELL_ICONS.get('box')));
    // The monogram is gone for this row, and the label is still the accessible
    // name — the icon replaced the glyph, not the accessible tree.
    const button = screen.getByRole('button', { name: 'Known Icon' });
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('');
    expect(button.querySelector('.sr-only')?.textContent).toBe('Known Icon');
  });

  it('falls back to the host glyph for an icon key the host does not publish', async () => {
    await renderCollapsed();
    // NOT the monogram: a vendor who mistyped a key and a vendor who declared no
    // icon are different situations and must not render identically.
    expect(glyphPathsOf('Unknown Icon')).toEqual(pathsOfGlyph(FALLBACK_ICON));
    // The monogram span carries the glyph and no letter. `textContent` on the
    // button as a whole would be no evidence: the `sr-only` label spells the row
    // out in full and starts with a `U` of its own.
    const button = screen.getByRole('button', { name: 'Unknown Icon' });
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('');
  });

  it('does not resolve a prototype-shaped node icon key to anything inherited', async () => {
    await renderCollapsed();
    // `SHELL_ICONS` is a `Map`, so `constructor` reaches no own entry and there
    // is no prototype chain for it to inherit from. An object literal would have
    // answered with `Object` itself, which React refuses to render.
    expect(glyphPathsOf('Proto Icon')).toEqual(pathsOfGlyph(FALLBACK_ICON));
  });

  it('keeps the monogram for a node that declares no icon', async () => {
    await renderCollapsed();
    const button = screen.getByRole('button', { name: 'Plain Node' });
    expect(button.querySelector('svg')).toBeNull();
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('P');
  });

  it('keeps the monogram on the extension rows, which declare no icon at all', async () => {
    await renderCollapsed();
    // `LEAPExtensionBlueprint` has no `icon` field. The host does not invent one
    // from the first nav node, so these rows are unchanged by issue #19.
    const button = screen.getByRole('button', { name: 'Sample Extension' });
    expect(button.querySelector('svg')).toBeNull();
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('S');
  });

  it('draws no icon in the expanded pane, where the label is already legible', async () => {
    const user = userEvent.setup();
    render(<Harness blueprints={[makeBlueprint({ navigationTree: ICON_TREE })]} />);
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));

    // Expanded, every row shows its full label and there is no 32px square to
    // fill, so the icon is a collapsed-track affordance and nothing wider.
    expect(screen.getByRole('button', { name: 'Known Icon' }).querySelector('svg')).toBeNull();
  });
});

/**
 * ============================================================================
 * THE SAME REGRESSION, ASSERTED AGAINST THE EXTENSION IT IS NAMED AFTER
 * ============================================================================
 * Everything above renders `ICON_TREE`, a fixture defined in this file. That is
 * the right way to assert the four host outcomes, and it is why this file's
 * docblock could narrate the `DatabasePlugin` collision as the motivation while
 * never importing `DatabasePlugin` — so the host proved it draws an icon when
 * one is supplied, and nothing anywhere proved the extension supplied one.
 *
 * It did not. `TOP_LEVEL_CATEGORIES` declared `box`, `layers` and `droplet`; the
 * builder that turns that table into `NavigationNode[]` copied `id`, `label`,
 * `badgeCount` and `children` and dropped `icon`. So the registered roots
 * carried `icon: undefined`, every one took the monogram, and the collapsed rail
 * read **C A C** — while #19 was closed, `CHANGELOG.md` recorded the fix, and
 * this file's own docblock described it in the past tense. See #81.
 *
 * The case below asserts against `DatabasePlugin.navigationTree` — the real
 * registered data, not a copy of it. It is the assertion that has been missing
 * since #19, and the property that stops it recurring: delete
 * `icon: category.icon` from `DatabasePlugin`'s tree builder and this goes red
 * while every fixture-based case above stays green.
 *
 * **It takes the real TREE and not the whole blueprint, and that is a measured
 * decision rather than a shortcut.** Registering `DatabasePlugin` entire mounts
 * its pane-2 and pane-3 views, which seed 280 inventory records and start a
 * 200ms interval; the case passed in isolation and **timed out at 5s inside the
 * full suite**, where it competes with 1,738 other tests on an 8GB machine.
 * Raising the timeout would have bought a slow test that still proves nothing
 * extra: every fact this case asserts lives in the navigation tree, which is
 * exactly the object #81 says was built wrong. The views are covered by
 * `IntegrationSuite.test.tsx`, which is where a 280-row mount belongs.
 * ============================================================================
 */
describe('the collapsed rail of the extension issue #19 was named after', () => {
  it('draws three distinguishable glyphs for Components, Assemblies and Consumables', async () => {
    const user = userEvent.setup();
    render(
      <Harness blueprints={[makeBlueprint({ navigationTree: DatabasePlugin.navigationTree })]} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    // Matched by prefix, not by equality: these three roots carry a badge, so
    // the accessible name is "Components badge 35" and will move with the
    // seeded stock. The fixture rows above have no badge, which is why they can
    // be named exactly and these cannot.
    const rootRow = (label: string): HTMLElement =>
      screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });

    // Each root resolves to the host glyph its own table declares - not to the
    // fallback, which is what a mistyped key would give, and not to nothing.
    const pathsOfRow = (label: string): string[] =>
      Array.from(rootRow(label).querySelectorAll('svg path')).map(
        (path) => path.getAttribute('d') ?? '',
      );

    expect(pathsOfRow('Components')).toEqual(pathsOfGlyph(SHELL_ICONS.get('box')));
    expect(pathsOfRow('Assemblies')).toEqual(pathsOfGlyph(SHELL_ICONS.get('layers')));
    expect(pathsOfRow('Consumables')).toEqual(pathsOfGlyph(SHELL_ICONS.get('droplet')));

    // The three are distinct from each other, which is the user-visible claim
    // #19 makes and the one "C A C" violated. Asserting the keys alone would
    // pass if the host published identical paths under all three.
    const drawn = ['Components', 'Assemblies', 'Consumables'].map((label) =>
      JSON.stringify(pathsOfRow(label)),
    );
    expect(new Set(drawn).size).toBe(3);

    // And no row fell back to a letter. Two of these would have been "C".
    // Every aria-hidden span in the row is checked rather than the first,
    // because the badge is one of them and the monogram is not always first.
    for (const label of ['Components', 'Assemblies', 'Consumables']) {
      const hidden = Array.from(rootRow(label).querySelectorAll('[aria-hidden="true"]')).map(
        (node) => node.textContent ?? '',
      );
      expect(hidden.some((text) => text.length === 1)).toBe(false);
    }
  });
});

describe('the icon vocabulary is published', () => {
  it('publishes every icon key in DEVELOPER.md, and no key it does not have', () => {
    // `import.meta.url` is not a file URL under Vitest's transform, so the repo
    // root is walked up from this file's own path rather than resolved as a URL.
    const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
    const guide = readFileSync(join(repoRoot, 'DEVELOPER.md'), 'utf8');
    // The published list is a fenced block with one key per line, opened by a
    // marker so this test reads the list rather than every backticked word in
    // the file. A vendor reading the guide and this assertion see one list.
    const block = /<!-- icon-vocabulary:start -->([\s\S]*?)<!-- icon-vocabulary:end -->/.exec(guide);
    expect(block).not.toBeNull();

    const documented = new Set(
      Array.from((block?.[1] ?? '').matchAll(/^\s*\|\s*`([a-z-]+)`\s*\|/gm), (match) => match[1]),
    );

    expect([...documented].sort()).toEqual([...SHELL_ICONS.keys()].sort());
  });
});
