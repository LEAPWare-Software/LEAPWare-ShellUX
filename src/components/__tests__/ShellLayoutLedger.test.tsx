import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShellHostProvider } from '../../core/ActivationContext';
import { ExtensionRegistryProvider, useRegistry } from '../../core/RegistryContext';
import { createHydrationEngine } from '../../core/services/HydrationEngine';
import { LEDGER_CONTEXT_KEY } from '../../core/ledger/ledgerIndex';
import { makeBlueprint } from '../../core/__tests__/fixtures';
import type { ExtensionViewProps } from '../../core/types';
import { ShellLayout } from '../layout/ShellLayout';

/**
 * ============================================================================
 * THE LEDGER, AS `ShellLayout` REALLY WIRES IT
 * ============================================================================
 * The ledger has its own suite under `src/components/ledger/__tests__/`; what is
 * here is only the wiring `ShellLayout` owns and nothing else — that a plug-in's
 * published blocks reach pane 3 through the real activation lifecycle, and that
 * the host ECHOES a block submission rather than pretending to have consumed it.
 *
 * **The echo is the same decision the composer's submission gets.** Writing a
 * form's values back onto the publisher's channel would be host chrome
 * publishing under an extension's scope, which is the host impersonating the
 * extension; there is no door in this repository that grants that, and inventing
 * one for a demo would be the wrong place to invent it.
 *
 * No chart appears in this file. `echartsRenderer.isSupported()` is false in
 * jsdom — there is no canvas 2D context — so the shell's real renderer builds
 * nothing here, which is the behaviour "builds no instance where the engine says
 * the runtime cannot support it" in
 * `src/components/chart/__tests__/Chart.test.tsx` pins directly.
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
 * A pane-2 view that publishes one form block and the index that names it.
 *
 * Written the way a real extension has to write it — content on the payload
 * channel, index on a context key — because that split is the thing under test.
 */
function PublishingView({ shell }: ExtensionViewProps): null {
  useEffect(() => {
    shell.publishPayload('filter', 'form', {
      fields: [{ name: 'minimum', label: 'Minimum stock', value: '4' }],
    });
    shell.setContextKey(LEDGER_CONTEXT_KEY, 'filter');
  }, [shell]);
  return null;
}

describe('ShellLayout — the block ledger it wires', () => {
  it('renders a plug-in’s published block in pane 3, through the real lifecycle', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        blueprints={[makeBlueprint({ views: { pane2: PublishingView, pane3: (): null => null } })]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));

    expect(screen.getByRole('region', { name: 'Block filter' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Minimum stock' })).toBeInTheDocument();
  });

  it('echoes a block submission back rather than pretending to have consumed it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness
        blueprints={[makeBlueprint({ views: { pane2: PublishingView, pane3: (): null => null } })]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sample Extension' }));

    const input = screen.getByRole('textbox', { name: 'Minimum stock' });
    await user.clear(input);
    await user.type(input, '25');
    // "Submit filter", not "Submit": the composer's own submit button is a few
    // pixels below this one and would otherwise share its accessible name.
    await user.click(screen.getByRole('button', { name: 'Submit filter' }));

    // The host's own words, in the host's own region. It did not write the
    // values back onto the extension's channel, and it does not claim to have.
    const echo = container.querySelector('[data-shell-region="ledger-echo"]');
    expect(echo).toBeInTheDocument();
    expect(echo?.textContent).toBe('block: filter: minimum=25');
  });

  it('draws no ledger at all when no extension is in the foreground', () => {
    const { container } = render(<Harness blueprints={[makeBlueprint()]} />);

    // Not an empty ledger — no ledger. There is no foreground handle to read a
    // channel through, and the shell says the honest thing in the pane instead.
    expect(container.querySelector('[data-shell-region="ledger"]')).toBeNull();
    expect(container.querySelector('[data-shell-region="ledger-empty"]')).toBeNull();
  });
});
