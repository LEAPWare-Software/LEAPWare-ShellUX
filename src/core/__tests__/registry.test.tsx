import { StrictMode, useEffect } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionRegistryProvider, useRegistry, useRegistryRevision } from '../RegistryContext';
import type { ExtensionRegistry, RegistrationResult } from '../RegistryContext';
import { ShellUXError } from '../types';
import { makeBlueprint, makeExplodingPayload } from './fixtures';

interface Probe {
  readonly registry: ExtensionRegistry;
  readonly revision: number;
}

function Wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ExtensionRegistryProvider>{children}</ExtensionRegistryProvider>;
}

function setup(): { current: Probe } {
  return renderHook(
    (): Probe => ({ registry: useRegistry(), revision: useRegistryRevision() }),
    { wrapper: Wrapper },
  ).result;
}

/** `register` mutates provider state, so every call is wrapped in `act`. */
function callRegister(probe: { current: Probe }, payload: unknown): RegistrationResult {
  let out!: RegistrationResult;
  act(() => {
    out = probe.current.registry.register(payload);
  });
  return out;
}

function callUnregister(probe: { current: Probe }, id: string): boolean {
  let out!: boolean;
  act(() => {
    out = probe.current.registry.unregister(id);
  });
  return out;
}

function expectFailure(outcome: RegistrationResult): ShellUXError {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error('expected a failed registration');
  }
  expect(outcome.error).toBeInstanceOf(ShellUXError);
  return outcome.error;
}

describe('useRegistry', () => {
  it('throws a clear error when called outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useRegistry())).toThrow(/ExtensionRegistryProvider/);
    spy.mockRestore();
  });

  it('reports revision 0 outside the provider', () => {
    const { result } = renderHook(() => useRegistryRevision());
    expect(result.current).toBe(0);
  });

  it('exposes an empty registry initially', () => {
    const probe = setup();
    expect(probe.current.registry.listExtensions()).toEqual([]);
    expect(probe.current.revision).toBe(0);
    expect(probe.current.registry.getExtension('sample-ext')).toBeUndefined();
  });

  it('keeps the registry API identity stable across registrations', () => {
    const probe = setup();
    const before = probe.current.registry;
    callRegister(probe, makeBlueprint());
    expect(probe.current.registry).toBe(before);
    expect(probe.current.revision).toBe(1);
  });
});

describe('register — happy path', () => {
  it('registers a valid blueprint and exposes it', () => {
    const probe = setup();
    const blueprint = makeBlueprint();

    const outcome = callRegister(probe, blueprint);

    expect(outcome).toEqual({ ok: true, id: 'sample-ext', alreadyRegistered: false });
    // ---- DELIBERATE CONTRACT CHANGE ---------------------------------------
    // This previously asserted `.toBe(blueprint)`. The registry now stores a
    // normalised, host-owned, deeply frozen copy, so identity is asserted to
    // be DIFFERENT on purpose. `toEqual` below still pins that the copy is a
    // faithful one — same scalars, same function references.
    const stored = probe.current.registry.getExtension('sample-ext');
    expect(stored).not.toBe(blueprint);
    expect(stored?.id).toBe('sample-ext');
    expect(probe.current.registry.listExtensions()).toEqual([blueprint]);
    expect(probe.current.revision).toBe(1);
  });

  it('registers several extensions and preserves insertion order', () => {
    const probe = setup();
    const first = makeBlueprint({ id: 'ext-a' });
    const second = makeBlueprint({ id: 'ext-b' });

    callRegister(probe, first);
    callRegister(probe, second);

    expect(probe.current.registry.listExtensions()).toEqual([first, second]);
    expect(probe.current.revision).toBe(2);
  });

  it('returns a fresh array from listExtensions that cannot mutate the store', () => {
    const probe = setup();
    callRegister(probe, makeBlueprint());

    const a = probe.current.registry.listExtensions();
    const b = probe.current.registry.listExtensions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);

    (a as unknown[]).length = 0;
    expect(probe.current.registry.listExtensions()).toHaveLength(1);
  });
});

describe('register — duplicate ids', () => {
  it('rejects a different blueprint claiming an id that is already taken', () => {
    const probe = setup();
    const original = makeBlueprint({ name: 'Original' });
    const impostor = makeBlueprint({ name: 'Impostor' });

    expect(callRegister(probe, original).ok).toBe(true);
    const error = expectFailure(callRegister(probe, impostor));

    expect(error.code).toBe('DUPLICATE_ID');
    expect(error.field).toBe('id');
    expect(error.message).toContain('sample-ext');
    // The incumbent must survive; a duplicate must never overwrite. Checked by
    // a distinguishing field rather than by identity: the store holds a
    // normalised copy, not the caller's object.
    expect(probe.current.registry.getExtension('sample-ext')?.name).toBe('Original');
    expect(probe.current.registry.listExtensions()).toHaveLength(1);
    expect(probe.current.revision).toBe(1);
  });

  it('treats re-registering the identical blueprint object as an idempotent no-op', () => {
    const probe = setup();
    const blueprint = makeBlueprint();

    expect(callRegister(probe, blueprint)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: false,
    });
    expect(callRegister(probe, blueprint)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: true,
    });

    expect(probe.current.registry.listExtensions()).toHaveLength(1);
    // An idempotent no-op must not bump the revision counter.
    expect(probe.current.revision).toBe(1);
  });
});

describe('register — hostile payloads never crash the host', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'sample-ext'],
    ['a number', 0],
    ['a boolean', false],
  ])('rejects %s without throwing', (_label, payload) => {
    const probe = setup();
    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, payload);
    }).not.toThrow();
    expect(expectFailure(outcome).code).toBe('INVALID_PAYLOAD');
    expect(probe.current.registry.listExtensions()).toEqual([]);
    expect(probe.current.revision).toBe(0);
  });

  it('rejects a payload whose getter throws an Error, without propagating it', () => {
    const probe = setup();
    const outcome = callRegister(probe, makeExplodingPayload(new Error('detonated')));
    const error = expectFailure(outcome);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('detonated');
    expect(probe.current.registry.listExtensions()).toEqual([]);
  });

  it('rejects a payload whose getter throws a non-Error value', () => {
    const probe = setup();
    const outcome = callRegister(probe, makeExplodingPayload('bare string throw'));
    const error = expectFailure(outcome);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('bare string throw');
  });

  it('rejects a malformed id and names the field', () => {
    const probe = setup();
    const error = expectFailure(callRegister(probe, makeBlueprint({ id: '../../etc/passwd' })));
    expect(error.code).toBe('INVALID_ID');
    expect(error.field).toBe('id');
  });

  it('rejects a missing field and names it', () => {
    const probe = setup();
    const payload = makeBlueprint();
    delete payload['views'];
    const error = expectFailure(callRegister(probe, payload));
    expect(error.code).toBe('MISSING_FIELD');
    expect(error.field).toBe('views');
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the reserved id "%s" and leaves the object graph clean',
    (id) => {
      const probe = setup();
      const payload = makeBlueprint();
      Object.defineProperty(payload, 'id', { value: id, enumerable: true, writable: true });

      const error = expectFailure(callRegister(probe, payload));

      expect(error.code).toBe('RESERVED_ID');
      expect(probe.current.registry.getExtension(id)).toBeUndefined();
      expect(probe.current.registry.listExtensions()).toEqual([]);
      expect(Object.prototype).not.toHaveProperty('id');
    },
  );

  it('never resolves prototype keys out of the store, even for legal ids', () => {
    const probe = setup();
    callRegister(probe, makeBlueprint());
    // A Map-backed store has no prototype chain to fall through to.
    expect(probe.current.registry.getExtension('toString')).toBeUndefined();
    expect(probe.current.registry.getExtension('hasOwnProperty')).toBeUndefined();
    expect(probe.current.registry.getExtension('__proto__')).toBeUndefined();
  });

  it('rejects an oversized navigation tree without registering anything', () => {
    const probe = setup();
    const navigationTree = Array.from({ length: 600 }, (_unused, index) => ({
      id: `node-${index}`,
      label: `Node ${index}`,
    }));
    const error = expectFailure(callRegister(probe, makeBlueprint({ navigationTree })));
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(probe.current.registry.listExtensions()).toEqual([]);
  });
});

describe('unregister', () => {
  it('returns false for an unknown id and does not bump the revision', () => {
    const probe = setup();
    callRegister(probe, makeBlueprint());
    const revisionBefore = probe.current.revision;

    expect(callUnregister(probe, 'never-registered')).toBe(false);
    expect(probe.current.revision).toBe(revisionBefore);
    expect(probe.current.registry.listExtensions()).toHaveLength(1);
  });

  it('returns false for an unknown id on an empty registry', () => {
    const probe = setup();
    expect(callUnregister(probe, 'nothing-here')).toBe(false);
    expect(probe.current.revision).toBe(0);
  });

  it('removes a registered extension', () => {
    const probe = setup();
    callRegister(probe, makeBlueprint());

    expect(callUnregister(probe, 'sample-ext')).toBe(true);
    expect(probe.current.registry.getExtension('sample-ext')).toBeUndefined();
    expect(probe.current.registry.listExtensions()).toEqual([]);
    expect(probe.current.revision).toBe(2);
  });

  it('allows re-registering a different blueprint after unregistering', () => {
    const probe = setup();
    const original = makeBlueprint({ name: 'Original' });
    const replacement = makeBlueprint({ name: 'Replacement' });

    callRegister(probe, original);
    expectFailure(callRegister(probe, replacement));

    expect(callUnregister(probe, 'sample-ext')).toBe(true);

    expect(callRegister(probe, replacement)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: false,
    });
    expect(probe.current.registry.getExtension('sample-ext')?.name).toBe('Replacement');
  });
});

describe('React StrictMode', () => {
  it('does not produce a spurious duplicate-id error on double-mount', () => {
    // A plugin registering from an effect WITHOUT a cleanup is the worst case:
    // StrictMode runs the effect, tears the subtree down, and runs it again
    // against the same registry instance.
    const blueprint = makeBlueprint({ id: 'strict-ext' });
    const outcomes: RegistrationResult[] = [];
    let extensionCount = -1;

    function Plugin(): null {
      const registry = useRegistry();
      useEffect(() => {
        outcomes.push(registry.register(blueprint));
        extensionCount = registry.listExtensions().length;
      }, [registry]);
      return null;
    }

    render(
      <StrictMode>
        <ExtensionRegistryProvider>
          <Plugin />
        </ExtensionRegistryProvider>
      </StrictMode>,
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.some((outcome) => outcome.ok && outcome.alreadyRegistered)).toBe(true);
    expect(extensionCount).toBe(1);
  });

  it('supports the register/unregister effect pair without leaking or looping', () => {
    const blueprint = makeBlueprint({ id: 'cleanup-ext' });
    const counts: number[] = [];

    function Plugin(): null {
      const registry = useRegistry();
      useEffect(() => {
        registry.register(blueprint);
        counts.push(registry.listExtensions().length);
        return () => {
          registry.unregister('cleanup-ext');
        };
      }, [registry]);
      return null;
    }

    const view = render(
      <StrictMode>
        <ExtensionRegistryProvider>
          <Plugin />
        </ExtensionRegistryProvider>
      </StrictMode>,
    );

    // Two mounts under StrictMode, each observing exactly one entry: the
    // cleanup between them removed the first registration.
    expect(counts).toEqual([1, 1]);
    view.unmount();
  });
});
