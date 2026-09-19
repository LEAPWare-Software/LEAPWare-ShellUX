import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import type { ExtensionViewProps, IShellAPI } from '../../core/types';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * ============================================================================
 * THE BADGE RENDER PATH — the half of issue #12 that nothing exercised
 * ============================================================================
 * `IShellAPI.setBadgeCount` was implemented, validated and tested from the
 * moment ISSUE-001 landed, and the value it wrote was rendered by nobody:
 * `ShellLayout` drew `node.badgeCount` off the registry's frozen blueprint
 * record, which is fixed at registration and can never move again. A plug-in
 * could therefore push an unread count into pane 1 all day and pane 1 would go
 * on showing the number it was born with.
 *
 * **The assertion this file exists for is the round trip, through the real
 * `IShellAPI` a real activation minted.** Not through `useShellStore()`, and not
 * through `useBadgeCount` directly — `src/core/__tests__/badgeSelector.test.tsx`
 * already holds the selector in isolation. What is asserted here is that a
 * `shell.setBadgeCount(...)` call an extension author would write changes the
 * text in the sidebar.
 *
 * Every case runs against the real registry, the real activation lifecycle and
 * the real nav tree, with a memory-only hydration engine so that nothing here
 * touches the process-wide one.
 * ============================================================================
 */

/** A pane view that hands its own `IShellAPI` back to the test. */
function makeCapturingView(capture: { shell: IShellAPI | null }) {
  return function Capturing({ shell }: ExtensionViewProps): null {
    capture.shell = shell;
    return null;
  };
}

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

function Harness({ blueprints }: { readonly blueprints: readonly unknown[] }): ReactElement {
  // Memory-only, so this file never reaches the process-wide engine over
  // `localStorage` and never leaves a layout behind for another file to find.
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
 * Render the shell with one extension registered and brought to the foreground,
 * and hand back the `IShellAPI` its own pane view was given.
 *
 * The fixture's tree is `Root A` (blueprint badge 3, one child `Child A`) and
 * `Root B` (no blueprint badge), which is exactly the two cases the override
 * rule has to distinguish.
 */
async function renderActivated(): Promise<{
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly shell: IShellAPI;
}> {
  const user = userEvent.setup();
  const capture: { shell: IShellAPI | null } = { shell: null };
  render(
    <Harness
      blueprints={[
        makeBlueprint({
          views: { pane2: makeCapturingView(capture), pane3: makeCapturingView(capture) },
        }),
      ]}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
  // A revoked or absent handle would make every assertion below vacuous.
  expect(capture.shell).not.toBeNull();
  return { user, shell: capture.shell as IShellAPI };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShellLayout — navigation badges', () => {
  it('renders the tree an extension set at runtime, and a cleared badge falls back to the declared count', async () => {
    const { shell } = await renderActivated();
    expect(screen.getByRole('button', { name: 'Root A badge 3' })).toBeInTheDocument();

    // ADR-0006 decision 8, #16: a folder added and one renamed, with no
    // unregister and no re-activation — the same handle keeps working.
    act(() => {
      shell.setNavigationTree([
        { id: 'root-a', label: 'Renamed A', badgeCount: 3 },
        { id: 'root-c', label: 'Added C' },
      ]);
    });
    expect(screen.getByRole('button', { name: 'Renamed A badge 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Added C' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root B' })).toBeNull();

    // #80: a store badge overrides the declared 3; clearing it deletes the
    // entry, so the declared count shows again rather than a zero.
    act(() => {
      shell.setBadgeCount('root-a', 9);
    });
    expect(screen.getByRole('button', { name: 'Renamed A badge 9' })).toBeInTheDocument();
    act(() => {
      shell.clearBadge('root-a');
    });
    expect(screen.getByRole('button', { name: 'Renamed A badge 3' })).toBeInTheDocument();
  });

  it('renders the blueprint badge for a node the store has never been written for', async () => {
    await renderActivated();
    // The fallback half of the override rule, and the behaviour that existed
    // before the store was consulted at all.
    expect(screen.getByRole('button', { name: 'Root A badge 3' })).toBeInTheDocument();
    // ...and a node with no blueprint badge and no store badge renders none.
    const plain = screen.getByRole('button', { name: 'Root B' });
    expect(plain.querySelector('.sr-only')).toBeNull();
  });

  it('lets a setBadgeCount write through a live IShellAPI change what the sidebar renders', async () => {
    const { shell } = await renderActivated();
    expect(screen.getByRole('button', { name: 'Root B' })).toBeInTheDocument();

    // THE DEFECT, INVERTED. This is the call an extension author writes, on the
    // handle activation minted for them, with their own node id.
    act(() => {
      shell.setBadgeCount('root-b', 5);
    });
    expect(screen.getByRole('button', { name: 'Root B badge 5' })).toBeInTheDocument();

    // ...and it keeps moving, rather than latching on the first write.
    act(() => {
      shell.setBadgeCount('root-b', 12);
    });
    expect(screen.getByRole('button', { name: 'Root B badge 12' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root B badge 5' })).toBeNull();
  });

  it('overrides a blueprint badge with the store value, including down to zero', async () => {
    const { shell } = await renderActivated();
    expect(screen.getByRole('button', { name: 'Root A badge 3' })).toBeInTheDocument();

    act(() => {
      shell.setBadgeCount('root-a', 7);
    });
    expect(screen.getByRole('button', { name: 'Root A badge 7' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root A badge 3' })).toBeNull();

    // `0` is a value, not an absence. `||` here would fall back to the
    // blueprint's stale `3` and the badge would appear never to clear.
    act(() => {
      shell.setBadgeCount('root-a', 0);
    });
    expect(screen.getByRole('button', { name: 'Root A badge 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root A badge 3' })).toBeNull();
  });

  it('reaches a nested navigation node, so the badge subscription recurses with the tree', async () => {
    const { shell } = await renderActivated();
    expect(screen.getByRole('button', { name: 'Child A' })).toBeInTheDocument();

    act(() => {
      shell.setBadgeCount('child-a', 2);
    });
    expect(screen.getByRole('button', { name: 'Child A badge 2' })).toBeInTheDocument();
  });

  it('keeps the badge qualifier in the accessible name when the count comes from the store', async () => {
    const { shell } = await renderActivated();
    act(() => {
      shell.setBadgeCount('root-b', 4);
    });

    // The shape the accessibility work settled on: "Root B badge 4", never the
    // bare "Root B 4" that names no unit and reads as part of the label.
    const badged = screen.getByRole('button', { name: 'Root B badge 4' });
    expect(badged.querySelector('.sr-only')?.textContent).toBe('badge ');
    expect(badged.textContent).toContain('4');
    expect(screen.queryByRole('button', { name: 'Root B 4' })).toBeNull();
  });

  it('shows a runtime badge in the collapsed 48px icon track too', async () => {
    const { user, shell } = await renderActivated();
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    act(() => {
      shell.setBadgeCount('root-b', 9);
    });

    const collapsed = screen.getByRole('button', { name: 'Root B badge 9' });
    // The icon track shows a monogram and keeps the label as `sr-only` text, so
    // the badge is positioned over the corner of the square rather than at the
    // end of a row. Both spellings of the badge live in one component, and this
    // is the branch the expanded cases above do not reach.
    expect(collapsed.querySelector('[aria-hidden="true"]')?.textContent).toBe('R');
    const badge = Array.from(collapsed.querySelectorAll('span')).find((span) =>
      span.className.includes('absolute'),
    );
    expect(badge).toBeDefined();
    expect(badge?.className).toContain('-right-1');
    expect(badge?.className).toContain('-top-1');
    expect(badge?.textContent).toContain('9');
  });

  it('leaves the extension rows above the tree unbadged, because an extension is not a node', async () => {
    const { shell } = await renderActivated();
    // There is no node id under which the store could hold a badge for an
    // extension row, so it takes `undefined` and subscribes to nothing. A write
    // under the extension's OWN id as a node id must not leak onto its row.
    act(() => {
      shell.setBadgeCount('sample-ext', 6);
    });
    expect(screen.getByRole('button', { name: 'Sample Extension' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sample Extension badge 6' })).toBeNull();
  });

  it('scopes the badge to the extension that wrote it, so a second extension is unaffected', async () => {
    const user = userEvent.setup();
    const first: { shell: IShellAPI | null } = { shell: null };
    const second: { shell: IShellAPI | null } = { shell: null };
    render(
      <Harness
        blueprints={[
          makeBlueprint({
            views: { pane2: makeCapturingView(first), pane3: makeCapturingView(first) },
          }),
          makeBlueprint({
            id: 'other-ext',
            name: 'Other Extension',
            views: { pane2: makeCapturingView(second), pane3: makeCapturingView(second) },
          }),
        ]}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Sample Extension' }));
    const sample = first.shell as IShellAPI;
    act(() => {
      sample.setBadgeCount('root-b', 5);
    });
    expect(screen.getByRole('button', { name: 'Root B badge 5' })).toBeInTheDocument();

    // The same node id, in the other extension's scope. The nav tree is drawn
    // for whichever extension is in the foreground, and it reads that
    // extension's scope — so `Root B` here is the OTHER extension's node and
    // carries no badge.
    await user.click(screen.getByRole('button', { name: 'Other Extension' }));
    expect(screen.getByRole('button', { name: 'Root B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Root B badge 5' })).toBeNull();

    // ...and switching back finds the first extension's badge exactly where it
    // was left.
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));
    expect(screen.getByRole('button', { name: 'Root B badge 5' })).toBeInTheDocument();
  });
});
