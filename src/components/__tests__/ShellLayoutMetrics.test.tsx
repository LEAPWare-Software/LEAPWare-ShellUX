import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import type { ExtensionViewProps, IShellAPI } from '../../core/types';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * ============================================================================
 * THE PANE-1 METRIC RENDER PATH
 * ============================================================================
 * §4.1 of the native-host plan puts a quantitative glyph in pane 1 WITHOUT a
 * `views.pane1`, because pane 1 draws every registered extension's rows in one
 * tree and one vendor's throwing renderer would take all of them down. What this
 * file holds is the consequence of that choice at the render boundary:
 *
 *   1. A declared metric draws host-authored geometry and an `sr-only`
 *      description, and nothing a plug-in supplied reaches an attribute.
 *   2. The liveness rule is the badge rule again — `setNavMetric` moves the
 *      glyph, and a store value overrides the blueprint's `value` including
 *      down to `0`.
 *   3. The override reaches `value` and nothing else: a runtime write to a node
 *      that declared no metric draws nothing, because a metric also needs a
 *      `kind` and a `description` and the host will not invent either.
 *   4. The collapsed 48px track keeps the text channel and drops the glyph.
 *
 * Everything runs against the real registry, the real activation lifecycle and a
 * memory-only hydration engine.
 * ============================================================================
 */

function makeCapturingView(capture: { shell: IShellAPI | null }) {
  return function Capturing({ shell }: ExtensionViewProps): null {
    capture.shell = shell;
    return null;
  };
}

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
 * The fixture tree, with metrics on it.
 *
 * `Root A` carries a bar at `0.5`; `Root B` carries nothing, which is the case
 * the "a runtime write draws nothing" rule needs. `Child A` carries a sparkline,
 * so the recursion and the second shape are both exercised through the real
 * tree rather than through a unit call.
 */
const NAV_TREE_WITH_METRICS = [
  {
    id: 'root-a',
    label: 'Root A',
    badgeCount: 3,
    metric: { kind: 'bar', value: 0.5, description: 'Storage 50 percent used' },
    children: [
      {
        id: 'child-a',
        label: 'Child A',
        metric: { kind: 'sparkline', value: 0.4, series: [0, 0.5, 1], description: 'Trending up' },
      },
    ],
  },
  { id: 'root-b', label: 'Root B' },
];

async function renderActivated(
  navigationTree: readonly unknown[] = NAV_TREE_WITH_METRICS,
): Promise<{
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly shell: IShellAPI;
}> {
  const user = userEvent.setup();
  const capture: { shell: IShellAPI | null } = { shell: null };
  render(
    <Harness
      blueprints={[
        makeBlueprint({
          navigationTree,
          views: { pane2: makeCapturingView(capture), pane3: makeCapturingView(capture) },
        }),
      ]}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
  expect(capture.shell).not.toBeNull();
  return { user, shell: capture.shell as IShellAPI };
}

/** The one `path` inside a row's metric glyph, or `null` when it draws none. */
function metricPathOf(row: HTMLElement): SVGPathElement | null {
  return row.querySelector('svg path');
}

describe('ShellLayout — navigation metrics', () => {
  it('renders a declared navigation metric as a host-drawn glyph with its description', async () => {
    await renderActivated();

    // The description folds into the accessible name, which is the whole point
    // of requiring it: the metric has a channel that is neither colour nor
    // shape. WCAG 2.2 §1.4.1.
    const row = screen.getByRole('button', {
      name: 'Root A Storage 50 percent used badge 3',
    });
    const path = metricPathOf(row);
    expect(path).not.toBeNull();
    // A bar at 0.5 across a 32-unit box inset by 2: 2 → 16.
    expect(path?.getAttribute('d')).toBe('M2 6H16');
    expect(path?.closest('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(path?.closest('svg')?.getAttribute('stroke')).toBe('currentColor');

    // ...and a node that declares no metric draws no glyph at all.
    const plain = screen.getByRole('button', { name: 'Root B' });
    expect(metricPathOf(plain)).toBeNull();
  });

  it('draws each metric kind from host-authored geometry only', async () => {
    await renderActivated([
      { id: 'n-bar', label: 'Bar', metric: { kind: 'bar', value: 1, description: 'Full' } },
      { id: 'n-dot', label: 'Dot', metric: { kind: 'dot', value: 0.9, description: 'Present' } },
      {
        id: 'n-spark',
        label: 'Spark',
        metric: { kind: 'sparkline', value: 0.2, series: [0, 1], description: 'Rising' },
      },
      {
        id: 'n-flat',
        label: 'Flat',
        // A sparkline with no series at all: the shape degenerates to a rule at
        // the height `value` implies. It does NOT become another kind.
        metric: { kind: 'sparkline', value: 0.25, description: 'One reading' },
      },
    ]);

    const drawn = new Map<string, string>();
    for (const label of ['Bar', 'Dot', 'Spark', 'Flat']) {
      const row = screen.getByRole('button', { name: new RegExp(`^${label} `) });
      const d = metricPathOf(row)?.getAttribute('d');
      expect(d).toBeDefined();
      drawn.set(label, d as string);
    }

    expect(drawn.get('Bar')).toBe('M2 6H30');
    expect(drawn.get('Dot')).toBe('M16 6h.01');
    expect(drawn.get('Spark')).toBe('M2 10 L30 2');
    expect(drawn.get('Flat')).toBe('M2 8 L30 8');

    // Every kind draws a different shape, so the vocabulary is a vocabulary and
    // not three names for one glyph.
    expect(new Set(drawn.values()).size).toBe(4);

    // HOST-AUTHORED ONLY: the emitted geometry is digits, spaces and the four
    // path commands this module writes. Nothing a plug-in supplied — no
    // description text, no kind spelling — appears in it, and no element in a
    // metric carries an inline style through which a value could reach CSS.
    for (const d of drawn.values()) {
      expect(d).toMatch(/^[MLHhv0-9. -]+$/);
    }
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      expect(svg.getAttribute('style')).toBeNull();
    }
  });

  it('lets a setNavMetric write through a live IShellAPI change the glyph the sidebar draws', async () => {
    const { shell } = await renderActivated();
    const before = metricPathOf(
      screen.getByRole('button', { name: 'Root A Storage 50 percent used badge 3' }),
    )?.getAttribute('d');
    expect(before).toBe('M2 6H16');

    // THE DEFECT, INVERTED — the call an extension author writes, on the handle
    // activation minted for them, with their own node id.
    act(() => {
      shell.setNavMetric('root-a', 1);
    });
    expect(
      metricPathOf(
        screen.getByRole('button', { name: 'Root A Storage 50 percent used badge 3' }),
      )?.getAttribute('d'),
    ).toBe('M2 6H30');

    // ...and an out-of-range runtime write is clamped rather than refused, which
    // is the same asymmetry the registration door applies.
    act(() => {
      shell.setNavMetric('root-a', 9);
    });
    expect(
      metricPathOf(
        screen.getByRole('button', { name: 'Root A Storage 50 percent used badge 3' }),
      )?.getAttribute('d'),
    ).toBe('M2 6H30');
  });

  it('overrides a blueprint metric value with the store value, including down to zero', async () => {
    const { shell } = await renderActivated();

    // `0` is a value, not an absence. `||` here would fall back to the
    // blueprint's `0.5` and the bar would appear never to empty.
    act(() => {
      shell.setNavMetric('root-a', 0);
    });
    const row = screen.getByRole('button', { name: 'Root A Storage 50 percent used badge 3' });
    expect(metricPathOf(row)?.getAttribute('d')).toBe('M2 6H2');

    // The override reaches `value` and nothing else: the kind, the description
    // and the series are still the registry's frozen record.
    expect(row.textContent).toContain('Storage 50 percent used');
  });

  it('draws nothing for a runtime metric on a node that declared none', async () => {
    const { shell } = await renderActivated();
    act(() => {
      shell.setNavMetric('root-b', 0.8);
    });

    // Stored and readable — the write was accepted...
    expect(shell.getNavMetric('root-b')).toBe(0.8);
    // ...and drawn by nobody, because there is no `kind` and no `description`
    // for the host to invent. That is the deliberate asymmetry with a badge.
    const plain = screen.getByRole('button', { name: 'Root B' });
    expect(metricPathOf(plain)).toBeNull();
    expect(plain.querySelector('.sr-only')).toBeNull();
  });

  it('reaches a nested navigation node, so the metric subscription recurses with the tree', async () => {
    const { shell } = await renderActivated();
    const child = screen.getByRole('button', { name: 'Child A Trending up' });
    expect(metricPathOf(child)?.getAttribute('d')).toBe('M2 10 L16 6 L30 2');

    act(() => {
      shell.setNavMetric('child-a', 0.5);
    });
    // The series is the registry's and does not move; the scalar override is
    // invisible to a sparkline, which draws its points and not its scalar.
    expect(
      metricPathOf(screen.getByRole('button', { name: 'Child A Trending up' }))?.getAttribute('d'),
    ).toBe('M2 10 L16 6 L30 2');
  });

  it('keeps the metric description in the collapsed track and drops the glyph', async () => {
    const { user } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    // The same accessible name in both pane-1 states, which is the property the
    // 48px track was built for — the text channel survives being small, and a
    // 32-unit glyph beside an icon in a 32px square does not.
    const collapsed = screen.getByRole('button', {
      name: 'Root A Storage 50 percent used badge 3',
    });
    expect(metricPathOf(collapsed)).toBeNull();
    expect(collapsed.textContent).toContain('Storage 50 percent used');
  });

  it('leaves the extension rows above the tree without a metric, because an extension is not a node', async () => {
    const { shell } = await renderActivated();
    // A write under the extension's OWN id as a node id must not leak onto its
    // row: the row passes `undefined` and subscribes to nothing.
    act(() => {
      shell.setNavMetric('sample-ext', 0.9);
    });
    const row = screen.getByRole('button', { name: 'Sample Extension' });
    expect(metricPathOf(row)).toBeNull();
  });
});
