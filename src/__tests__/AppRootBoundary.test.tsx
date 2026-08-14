import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

/**
 * ============================================================================
 * THE ROOT BOUNDARY IN `src/App.tsx`, PINNED AT THE TWO PLACES NOTHING USED TO
 * CATCH.
 * ============================================================================
 * `src/__tests__/App.test.tsx` asserts the composition when everything works.
 * This file asserts what happens when it does not, at the two positions that
 * `ShellLayout`'s own per-surface boundaries cannot reach because they are BELOW
 * them: a throw in `ShellLayout`'s render body, and a throw in
 * `ShellHostProvider`'s render. Both were a white screen before the root
 * `FaultBoundary` existed, and both fail this file if the wrap is removed —
 * without a boundary above them the throw escapes React entirely and `render`
 * itself rejects, which is the point of asserting a rendered fallback rather
 * than asserting an absence.
 *
 * Two mocking shapes, for two different reasons:
 *
 *  - `ShellLayout` is replaced OUTRIGHT. Nothing else imports from that module
 *    here, and a real `ShellLayout` would contain its own boundaries, which is
 *    exactly the containment this case must not be able to borrow.
 *  - `core/ActivationContext` is mocked PARTIALLY, spreading the real namespace
 *    and replacing only `ShellHostProvider`. `ShellLayout` reaches into that
 *    module for `ExtensionHostBoundary` and `useActivation`, so a wholesale
 *    replacement would break resolution that has nothing to do with this test.
 *
 * The throwing is switched per case through a `vi.hoisted` box, because a
 * `vi.mock` factory is hoisted above every import in this file and cannot close
 * over an ordinary module-scope binding.
 */

/** Per-case switches, hoisted so the `vi.mock` factories below may close over them. */
const faults = vi.hoisted(() => ({
  /** Non-`null` makes the stand-in `ShellLayout` throw this message. */
  shellLayout: null as string | null,
  /** Non-`null` makes the stand-in `ShellHostProvider` throw this message. */
  hostProvider: null as string | null,
}));

vi.mock('../components/layout/ShellLayout', () => ({
  ShellLayout: (): ReactElement | null => {
    if (faults.shellLayout !== null) {
      throw new Error(faults.shellLayout);
    }
    return null;
  },
}));

vi.mock('../core/ActivationContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/ActivationContext')>();
  const RealShellHostProvider = original.ShellHostProvider;
  return {
    ...original,
    ShellHostProvider: ({ children }: { children: ReactNode }): ReactElement => {
      if (faults.hostProvider !== null) {
        throw new Error(faults.hostProvider);
      }
      return <RealShellHostProvider>{children}</RealShellHostProvider>;
    },
  };
});

// Imported after the factories, which Vitest hoists above it either way.
import App from '../App';

/** The message text the pane fallback renders for the thrown error. */
function faultMessage(alert: HTMLElement): string | null {
  return alert.querySelector('[data-fault-message]')?.textContent ?? null;
}

describe('App — the root fault boundary', () => {
  beforeEach(() => {
    faults.shellLayout = null;
    faults.hostProvider = null;
    // React logs every caught error through `console.error`, and `FaultBoundary`
    // reports through it as well, so a run of this file would otherwise bury its
    // own result in two component stacks per case. Silenced for legibility only:
    // `src/test/setup.ts` registers jest-dom's matchers and an `afterEach`
    // cleanup and nothing else, and `vitest.config.ts` sets no console rule
    // either, so no assertion anywhere depends on this spy.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catches a throw from the shell render body that used to leave a blank page', () => {
    faults.shellLayout = 'ShellLayout threw while rendering.';

    render(<App />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('The shell could not be displayed.')).toBeInTheDocument();
    expect(faultMessage(alert)).toBe('ShellLayout threw while rendering.');
    // Bounded, but present: the first failure still offers a way back.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // `extensionId` is `null` here, so the fallback names no extension. Asserted
    // as absent rather than left unstated: this surface sits above the registry
    // and there is no validated id it could honestly print.
    expect(alert.querySelector('[data-fault-extension]')).toBeNull();
  });

  it('catches a throw from inside the host provider, which only a boundary above it can see', () => {
    faults.hostProvider = 'ShellHostProvider threw while rendering.';

    render(<App />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('The shell could not be displayed.')).toBeInTheDocument();
    expect(faultMessage(alert)).toBe('ShellHostProvider threw while rendering.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Nothing of the shell rendered at all — the provider never produced
    // children — so the boundary is standing in for the entire application, not
    // for one surface inside it.
    expect(screen.queryByRole('toolbar', { name: 'Shell ribbon' })).not.toBeInTheDocument();
  });
});
