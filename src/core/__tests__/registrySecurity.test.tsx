import type { ReactElement, ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ExtensionRegistryProvider,
  useRegistry,
  useRegistryRevision,
  validateBlueprint,
} from '../RegistryContext';
import type { ExtensionRegistry, RegistrationResult } from '../RegistryContext';
import type { Hotkey } from '../types';
import { ShellUXError } from '../types';
import type { CountingPayload } from './fixtures';
import {
  makeAction,
  makeBlueprint,
  makeDelayedExplodingPayload,
  makeExplodingPayload,
  makeShiftingIdPayload,
  makeShiftingLengthArray,
  makeUnclassifiableValue,
  makeUnstringifiableValue,
} from './fixtures';

/**
 * Time-of-check/time-of-use regression suite.
 *
 * Every test in this file fails against a registry that reads an untrusted
 * property more than once, or that lets an attacker-controlled value escape the
 * try/catch around registration. They are written against observable API
 * behaviour only — no registry internals — so they keep their meaning if the
 * implementation changes again.
 */

interface Probe {
  readonly registry: ExtensionRegistry;
  readonly revision: number;
}

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  return <ExtensionRegistryProvider>{children}</ExtensionRegistryProvider>;
}

function setup(): { current: Probe } {
  return renderHook(
    (): Probe => ({ registry: useRegistry(), revision: useRegistryRevision() }),
    { wrapper: Wrapper },
  ).result;
}

function callRegister(probe: { current: Probe }, payload: unknown): RegistrationResult {
  let out!: RegistrationResult;
  act(() => {
    out = probe.current.registry.register(payload);
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

describe('register — a shifting id cannot hijack another extension', () => {
  it('registers under the id that was validated, leaving the victim untouched', () => {
    const probe = setup();
    const victim = makeBlueprint({ id: 'victim-ext', name: 'Victim' });
    expect(callRegister(probe, victim).ok).toBe(true);

    // Benign for the first two reads, the victim's id from the third onward:
    // enough to survive validation and then claim someone else's slot.
    const attacker = makeShiftingIdPayload([
      'attacker-ext',
      'attacker-ext',
      'victim-ext',
      'victim-ext',
    ]);

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, attacker.payload);
    }).not.toThrow();

    expect(outcome).toEqual({ ok: true, id: 'attacker-ext', alreadyRegistered: false });
    // The victim's registration is intact and still points at the victim.
    // Asserted by a distinguishing field, not identity: the store holds a
    // normalised host-owned copy. Asserting identity here would also re-read
    // the attacker's `id` getter through `toEqual`, which is the very thing
    // `attacker.reads()` below is counting.
    expect(probe.current.registry.getExtension('victim-ext')?.name).toBe('Victim');
    expect(probe.current.registry.getExtension('victim-ext')).not.toBe(victim);
    // The attacker landed under the id it was actually validated with.
    expect(probe.current.registry.getExtension('attacker-ext')?.id).toBe('attacker-ext');
    expect(probe.current.registry.listExtensions()).toHaveLength(2);
    // The whole point: one read, so there is no second value to substitute.
    expect(attacker.reads()).toBe(1);
  });

  it('reads the id exactly once, so no later read can differ from the checked one', () => {
    const probe = setup();
    const shifting = makeShiftingIdPayload(['sample-ext', 'other-ext']);

    expect(callRegister(probe, shifting.payload).ok).toBe(true);

    expect(shifting.reads()).toBe(1);
    expect(probe.current.registry.getExtension('sample-ext')?.id).toBe('sample-ext');
    expect(probe.current.registry.getExtension('other-ext')).toBeUndefined();
  });

  it('reads the id exactly once on the duplicate-id rejection path too', () => {
    const probe = setup();
    expect(callRegister(probe, makeBlueprint({ name: 'Incumbent' })).ok).toBe(true);

    const shifting = makeShiftingIdPayload(['sample-ext', 'sample-ext', 'escape-ext']);
    const error = expectFailure(callRegister(probe, shifting.payload));

    expect(error.code).toBe('DUPLICATE_ID');
    expect(error.message).toContain('sample-ext');
    expect(error.message).not.toContain('escape-ext');
    expect(shifting.reads()).toBe(1);
  });

  it('reads the id exactly once on the StrictMode idempotent-re-register path', () => {
    const probe = setup();
    const shifting = makeShiftingIdPayload(['sample-ext', 'sample-ext', 'escape-ext']);

    expect(callRegister(probe, shifting.payload)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: false,
    });
    expect(callRegister(probe, shifting.payload)).toEqual({
      ok: true,
      id: 'sample-ext',
      alreadyRegistered: true,
    });

    // One read per call, two calls.
    expect(shifting.reads()).toBe(2);
    expect(probe.current.registry.listExtensions()).toHaveLength(1);
  });
});

describe('register — a shifting id cannot smuggle a reserved key into the store', () => {
  it('never stores "__proto__" as a live key', () => {
    const probe = setup();
    const attacker = makeShiftingIdPayload(['sample-ext', 'sample-ext', '__proto__', '__proto__']);

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, attacker.payload);
    }).not.toThrow();

    expect(outcome).toEqual({ ok: true, id: 'sample-ext', alreadyRegistered: false });
    expect(probe.current.registry.getExtension('__proto__')).toBeUndefined();
    const stored = probe.current.registry.listExtensions();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe('sample-ext');
    expect(attacker.reads()).toBe(1);
    // The Map store already made this structurally impossible; assert it still is.
    expect(Object.prototype).not.toHaveProperty('id');
    expect(({} as Record<string, unknown>)['sample-ext']).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'never stores the reserved id "%s" reached on a later read',
    (reserved) => {
      const probe = setup();
      const attacker = makeShiftingIdPayload(['sample-ext', reserved, reserved, reserved]);

      expect(callRegister(probe, attacker.payload).ok).toBe(true);

      expect(probe.current.registry.getExtension(reserved)).toBeUndefined();
      expect(attacker.reads()).toBe(1);
    },
  );
});

/**
 * A chord whose every field is honest and whose every field is load-bearing:
 * all four modifiers are declared, so substituting a shifting getter for any one
 * of them leaves the other four measuring nothing but themselves.
 */
const HONEST_CHORD: Readonly<Record<string, unknown>> = Object.freeze({
  key: 'k',
  ctrl: true,
  alt: true,
  shift: true,
  meta: true,
});

/**
 * `makeShiftingIdPayload` aimed at a chord: a structurally valid blueprint whose
 * single ribbon action carries a hotkey with ONE shifting field.
 *
 * `values` is consumed in order and the last entry repeats, exactly as the id
 * fixture does, so a validator that reads the field twice sees the second value
 * and one that reads it once cannot. `chord` supplies the other, honest fields.
 */
function makeShiftingHotkeyPayload(
  field: string,
  values: readonly unknown[],
  chord: Readonly<Record<string, unknown>> = HONEST_CHORD,
): CountingPayload {
  const hotkey: Record<string, unknown> = { ...chord };
  let reads = 0;
  Object.defineProperty(hotkey, field, {
    enumerable: true,
    configurable: true,
    get(): unknown {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      return value;
    },
  });
  return {
    payload: makeBlueprint({ ribbonActions: [makeAction({ hotkey })] }),
    reads: () => reads,
  };
}

/** The chord the registry actually stored — host-owned, so reading it counts nothing. */
function storedChord(probe: { current: Probe }): Hotkey | undefined {
  return probe.current.registry.getExtension('sample-ext')?.ribbonActions[0]?.hotkey;
}

describe('register — a shifting hotkey field cannot hijack the stored chord', () => {
  it.each<[string, unknown]>([
    ['key', 'j'],
    ['ctrl', false],
    ['alt', false],
    ['shift', false],
    ['meta', false],
  ])(
    'reads hotkey.%s exactly once, so no later read can differ from the checked one',
    (field, later) => {
      const probe = setup();
      const shifting = makeShiftingHotkeyPayload(field, [HONEST_CHORD[field], later, later]);

      expect(callRegister(probe, shifting.payload).ok).toBe(true);

      expect(shifting.reads()).toBe(1);
      // Asserted against the honest chord as a whole: a second read of ANY field
      // would show up here as a stored value the validator never saw.
      expect(storedChord(probe)).toEqual(HONEST_CHORD);
    },
  );

  it('cannot smuggle a key past the HOTKEY_KEYS allowlist on a later read', () => {
    const probe = setup();
    // `tab` is refused by name — it is the first of the three deliberate
    // absences from HOTKEY_KEYS — so storing it would be a visible breach of the
    // allowlist rather than a mere mismatch.
    const attacker = makeShiftingHotkeyPayload('key', ['k', 'tab', 'tab']);

    expect(callRegister(probe, attacker.payload).ok).toBe(true);

    expect(attacker.reads()).toBe(1);
    expect(storedChord(probe)?.key).toBe('k');
  });

  it('cannot rescue a disallowed key by turning honest on a later read', () => {
    const probe = setup();
    const attacker = makeShiftingHotkeyPayload('key', ['tab', 'k', 'k']);

    const error = expectFailure(callRegister(probe, attacker.payload));

    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('ribbonActions[0].hotkey.key');
    expect(error.message).toContain('tab');
    expect(attacker.reads()).toBe(1);
    expect(probe.current.registry.listExtensions()).toEqual([]);
  });

  /**
   * The WCAG 2.2 §2.1.4 refusal is decided from the four modifier locals. If any
   * of them were re-read, the chord that was judged and the chord that is stored
   * could disagree in either direction — a character-key-only shortcut smuggled
   * into the store, or a legal chord refused.
   */
  const BARE_K: Readonly<Record<string, unknown>> = Object.freeze({
    key: 'k',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });

  it('cannot defeat the WCAG 2.1.4 single-character refusal on a later read', () => {
    const probe = setup();
    // Modified while the refusal is decided, bare afterwards: a second read
    // would store `Ctrl+K` as the plain `K` the criterion forbids.
    const attacker = makeShiftingHotkeyPayload('ctrl', [true, false, false], BARE_K);

    expect(callRegister(probe, attacker.payload).ok).toBe(true);

    expect(attacker.reads()).toBe(1);
    expect(storedChord(probe)).toEqual({ ...BARE_K, ctrl: true });
  });

  it('cannot escape the WCAG 2.1.4 refusal by supplying the modifier on a later read', () => {
    const probe = setup();
    const attacker = makeShiftingHotkeyPayload('ctrl', [false, true, true], BARE_K);

    const error = expectFailure(callRegister(probe, attacker.payload));

    expect(error.code).toBe('INVALID_FIELD');
    expect(error.field).toBe('ribbonActions[0].hotkey');
    expect(error.message).toContain('2.1.4');
    expect(attacker.reads()).toBe(1);
    expect(probe.current.registry.listExtensions()).toEqual([]);
  });
});

describe('register — a getter that detonates late still cannot escape', () => {
  it.each([2, 3, 4, 5])('does not throw when the id getter explodes on read %i', (explodeOnRead) => {
    const probe = setup();
    const payload = makeDelayedExplodingPayload(explodeOnRead, new Error('late detonation'));

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, payload.payload);
    }).not.toThrow();

    // Only the first read ever happens, so the charge is never reached.
    expect(payload.reads()).toBe(1);
    expect(outcome).toEqual({ ok: true, id: 'sample-ext', alreadyRegistered: false });
  });

  it('still reports a first-read detonation as a failure', () => {
    const probe = setup();
    const payload = makeDelayedExplodingPayload(1, new Error('immediate detonation'));

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, payload.payload);
    }).not.toThrow();

    const error = expectFailure(outcome);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('immediate detonation');
    expect(probe.current.registry.listExtensions()).toEqual([]);
  });
});

describe('register — thrown values that resist inspection', () => {
  it('survives a thrown value whose toString and valueOf both throw', () => {
    const probe = setup();
    const hostile = makeUnstringifiableValue({ withToPrimitive: false });

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, makeExplodingPayload(hostile));
    }).not.toThrow();

    const error = expectFailure(outcome);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('non-inspectable');
    expect(error.message).toContain('object');
  });

  it('survives a thrown value whose Symbol.toPrimitive also throws', () => {
    const probe = setup();
    const hostile = makeUnstringifiableValue({ withToPrimitive: true });
    // Prove the fixture really is unstringifiable by every route.
    expect(() => String(hostile)).toThrow();

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, makeExplodingPayload(hostile));
    }).not.toThrow();

    expect(expectFailure(outcome).code).toBe('INVALID_PAYLOAD');
  });

  it('survives a thrown value whose instanceof check throws', () => {
    const probe = setup();
    const hostile = makeUnclassifiableValue();
    expect(() => hostile instanceof Error).toThrow();

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, makeExplodingPayload(hostile));
    }).not.toThrow();

    const error = expectFailure(outcome);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toContain('non-inspectable');
  });

  it('survives an Error whose message getter throws', () => {
    const probe = setup();
    const hostile = new Error('placeholder');
    Object.defineProperty(hostile, 'message', {
      get(): never {
        throw new Error('message refused');
      },
    });

    let outcome!: RegistrationResult;
    expect(() => {
      outcome = callRegister(probe, makeExplodingPayload(hostile));
    }).not.toThrow();

    expect(expectFailure(outcome).message).toContain('non-inspectable');
  });

  it('leaves the registry untouched after every uninspectable rejection', () => {
    const probe = setup();
    callRegister(probe, makeExplodingPayload(makeUnstringifiableValue({ withToPrimitive: true })));
    callRegister(probe, makeExplodingPayload(makeUnclassifiableValue()));
    expect(probe.current.registry.listExtensions()).toEqual([]);
    expect(probe.current.revision).toBe(0);
  });
});

describe('validateBlueprint — collection lengths are read once', () => {
  const action = {
    id: 'act-one',
    label: 'Act One',
    icon: 'save',
    isVisible: (): boolean => true,
    onExecute: (): void => undefined,
  };

  it('walks the ribbonActions count it bounds-checked, not a later one', () => {
    // `Array.isArray` accepts a Proxy wrapping an array, so `length` is
    // attacker-controlled: honest (1) while the bound is checked, larger (4)
    // once the walk begins. A second read would walk off the end of the real
    // backing array and reject a blueprint that actually passed.
    const ribbonActions = makeShiftingLengthArray([action], [1, 4]);
    expect(() => validateBlueprint(makeBlueprint({ ribbonActions }))).not.toThrow();
  });

  it('walks the navigationTree count it read, not a later one', () => {
    const navigationTree = makeShiftingLengthArray([{ id: 'root-a', label: 'A' }], [1, 4]);
    expect(() => validateBlueprint(makeBlueprint({ navigationTree }))).not.toThrow();
  });

  it('walks the children count it read, not a later one', () => {
    const children = makeShiftingLengthArray([{ id: 'child-a', label: 'C' }], [1, 4]);
    expect(() =>
      validateBlueprint(makeBlueprint({ navigationTree: [{ id: 'root-a', label: 'A', children }] })),
    ).not.toThrow();
  });
});
