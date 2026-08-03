import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { ShellLayout } from '../../components/layout/ShellLayout';
import { HelloExtension } from '../HelloExtension';

/**
 * ============================================================================
 * THE EXAMPLE IS RUN, NOT PROMISED
 * ============================================================================
 * `src/examples/HelloExtension.tsx` exists to be copied by someone writing their
 * first extension. An example that has drifted out of the contract is worse than
 * no example at all: it costs the reader the time to find out, and it does so
 * with the repository's authority behind it.
 *
 * So this file registers the example into a real host and drives it. It is
 * deliberately thin — the contract itself is exhaustively tested elsewhere, and
 * duplicating that here would make the example expensive to change. What it pins
 * is only this: **the example registers, mounts in both panes, and its one
 * command does what its label says.**
 *
 * If this fails, fix the example. Do not relax the test — the whole value of the
 * file it guards is that a reader can trust it without reading the host.
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

function Harness(): ReactElement {
  // Memory-only, so nothing here reaches the process-wide engine.
  const [engine] = useState(() => createHydrationEngine({ storage: null }));
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>
        <Registrar blueprints={[HelloExtension]} />
        <ShellLayout engine={engine} />
      </ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

describe('the copyable example in src/examples', () => {
  it('is accepted by the registry the host actually uses', async () => {
    render(<Harness />);
    // Registration is the first thing a wrong manifest fails, and the extension
    // row in pane 1 is the host's own evidence that it succeeded.
    expect(await screen.findByRole('button', { name: 'Hello Extension' })).toBeInTheDocument();
  });

  it('renders both of its panes and moves the selection between them', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Hello Extension' }));

    // Pane 3 before anything is selected. This is the example's own copy,
    // asserted so that changing the prose without changing the test is caught.
    expect(screen.getByText('Nothing selected.')).toBeInTheDocument();

    // Pane 2's list published a selection into HOST context, and pane 3 read it
    // back without the two components sharing anything of their own. That is
    // the property the example exists to demonstrate.
    await user.click(screen.getByRole('button', { name: 'Item the first' }));
    expect(screen.getByText('You selected the first item.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Item the first' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers its command only when its predicate says so, and the command clears the selection', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Hello Extension' }));

    // Queried as a LIST, not as one element, and that is the lesson rather than
    // a testing detail: a command declaring no `surfaces` is offered at every
    // surface that will take it, so one declaration in the example's manifest
    // becomes several buttons on screen. An author who writes
    // getByRole(...single...) here will see "found multiple elements" and should
    // read that as the contract working.
    const clearButtons = (): HTMLElement[] =>
      screen.queryAllByRole('button', { name: 'Clear selection' });

    // isVisible is false with no selection, so no surface offers it.
    expect(clearButtons()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Item the second' }));
    const offered = clearButtons();
    expect(offered.length).toBeGreaterThan(0);

    const [first] = offered;
    expect(first).toBeDefined();
    await user.click(first as HTMLElement);
    expect(screen.getByText('Nothing selected.')).toBeInTheDocument();
    // And it withdrew from EVERY surface at once, because they all evaluate the
    // one predicate rather than caching a decision each.
    expect(clearButtons()).toHaveLength(0);
  });
});
