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

/**
 * The `d` attributes the host's own `box` glyph carries, spelled out.
 *
 * Read from the literal rather than through `SHELL_ICONS.get('box')` in the
 * shadowing test below, because a successful shadow poisons the very lookup an
 * assertion would otherwise use to decide what "correct" is.
 */
const BOX_PATHS = ['M8 2 14 5v6l-6 3-6-3V5z', 'M2 5l6 3 6-3', 'M8 8v6'];

/** Geometry no host glyph draws, so seeing it in the rail means the rail was owned. */
const HOSTILE_PATH = 'M0 0h16v16H0z';
const HOSTILE_GLYPH = (
  <svg aria-hidden="true" viewBox="0 0 16 16">
    <path d={HOSTILE_PATH} />
  </svg>
);

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

  it('refuses an own get on the icon table, so the collapsed track still draws host geometry', async () => {
    // The attack this test exists for, filed at Severity High in
    // `.github/ISSUES_MANIFEST.md` and closed on 2026-08-16. `SHELL_ICONS.get` is
    // a PROTOTYPE method, so an own property of the same name shadows it for
    // every caller on the page — and one of those callers is this collapsed
    // track, which is host chrome and sits outside every
    // `ExtensionHostBoundary`. A shadow that lands draws attacker-chosen geometry
    // in the shell's own navigation rail.
    //
    // `ReadonlyMap<string, ReactElement>` never stopped it: it is a compile-time
    // type and binds nobody who is not being compiled, exactly as `as const` did
    // not bind `REGISTRY_LIMITS` before issue #10. `Object.freeze` at the
    // declaration does, and this is that assertion AT THE RENDER SITE rather than
    // at the declaration — the declaration is held separately by
    // `src/core/__tests__/hostConstants.test.ts`.
    //
    // What the freeze buys is narrow and must be described narrowly: `get`
    // cannot be REPLACED. The map is not immutable — `Map` state is in internal
    // slots, so `set` and `delete` still work on a frozen instance, which is
    // demonstrated on a throwaway in `hostConstants.test.ts` rather than claimed
    // away here.
    const table = SHELL_ICONS as unknown as Record<string, unknown>;
    let refusal: unknown = null;
    try {
      table['get'] = (): ReactElement => HOSTILE_GLYPH;
    } catch (error) {
      refusal = error;
    }
    try {
      // Rendered with the attack already attempted, so that if the freeze is ever
      // removed this fails on what the user would actually see and not only on a
      // missing exception.
      await renderCollapsed();
      expect(glyphPathsOf('Known Icon')).toEqual(BOX_PATHS);
      expect(glyphPathsOf('Unknown Icon')).not.toContain(HOSTILE_PATH);
      expect(refusal).toBeInstanceOf(TypeError);
    } finally {
      // Hermetic in both directions. Frozen, this deletes nothing and cannot
      // throw — `delete` on an absent property is a no-op even on a frozen
      // object. Unfrozen, it stops one red test from poisoning the rest of the
      // file.
      delete table['get'];
    }
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
