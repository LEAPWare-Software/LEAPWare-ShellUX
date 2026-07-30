import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistryProvider, useRegistry } from '../RegistryContext';
import { useShellContext, useShellStore } from '../ShellAPI';
import { ShellHostProvider, useActivation } from '../ActivationContext';
import { ShellUXError } from '../types';
import { makeBlueprint } from './fixtures';

/**
 * ============================================================================
 * HOST PROVIDER — the edges `dataflow.test.tsx` deliberately does not reach
 * ============================================================================
 * `dataflow.test.tsx` is the contract spec: it only ever exercises the shell
 * from inside a correctly assembled host. These are the cases that live outside
 * that frame — a hook used without its provider, and an argument no honest
 * caller passes — plus the one positive assertion the contract spec never
 * makes, that `getActive` reports the extension it just activated.
 * ============================================================================
 */

function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ExtensionRegistryProvider>
      <ShellHostProvider>{children}</ShellHostProvider>
    </ExtensionRegistryProvider>
  );
}

describe('hooks used outside ShellHostProvider', () => {
  /**
   * React logs the error it re-throws from a failed render. That is expected
   * here, so the console is silenced for the duration rather than left to imply
   * something went wrong.
   */
  function expectRenderToThrow(element: JSX.Element, message: string): void {
    const consoleError = console.error;
    console.error = (): void => undefined;
    try {
      expect(() => render(element)).toThrow(message);
    } finally {
      console.error = consoleError;
    }
  }

  it('useShellStore refuses to invent a second store', () => {
    function Consumer(): JSX.Element {
      useShellStore();
      return <span />;
    }
    expectRenderToThrow(<Consumer />, 'useShellStore must be called inside a <ShellHostProvider>.');
  });

  it('useShellContext refuses to read a store that is not there', () => {
    function Consumer(): JSX.Element {
      useShellContext();
      return <span />;
    }
    expectRenderToThrow(<Consumer />, 'useShellStore must be called inside a <ShellHostProvider>.');
  });

  it('useActivation refuses to hand out a controller that owns nothing', () => {
    function Consumer(): JSX.Element {
      useActivation();
      return <span />;
    }
    expectRenderToThrow(<Consumer />, 'useActivation must be called inside a <ShellHostProvider>.');
  });
});

describe('ActivationController', () => {
  it('reports the extension it just activated', () => {
    const blueprint = makeBlueprint({ id: 'mail-ext' });
    const { result } = renderHook(
      () => ({ registry: useRegistry(), activation: useActivation() }),
      { wrapper: Providers },
    );

    act(() => {
      expect(result.current.registry.register(blueprint).ok).toBe(true);
    });
    act(() => {
      expect(result.current.activation.activate('mail-ext').ok).toBe(true);
    });

    const active = result.current.activation.getActive();
    expect(active?.id).toBe('mail-ext');
    expect(active?.blueprint.name).toBe('Sample Extension');
  });

  it('never throws on an id that is not even a string', () => {
    const { result } = renderHook(() => useActivation(), { wrapper: Providers });

    let outcome!: ReturnType<typeof result.current.activate>;
    act(() => {
      // A caller — or a plugin reaching the controller through the host tree —
      // passing something that is not an id at all. The value must not be
      // stringified on the way into the error message, so a thrown `toString`
      // cannot escape a method contracted never to throw.
      outcome = (result.current.activate as (id: unknown) => typeof outcome)({
        toString(): never {
          throw new Error('stringification refused');
        },
      });
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error('expected an activation failure');
    }
    expect(outcome.error).toBeInstanceOf(ShellUXError);
    expect(outcome.error.code).toBe('INVALID_ID');
    expect(outcome.error.field).toBe('id');
  });
});
