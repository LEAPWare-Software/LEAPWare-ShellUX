import { describe, expect, it } from 'vitest';
import {
  EXTENSION_ID_PATTERN,
  HOTKEY_KEYS,
  HOTKEY_MODIFIER_REQUIRED_KEYS,
  REGISTRY_LIMITS,
  RESERVED_IDS,
} from '../RegistryContext';
import { PANE_IDS } from '../types';

/**
 * ============================================================================
 * THE HOST CONSTANTS ARE FROZEN — AND EXACTLY WHAT THAT IS WORTH
 * ============================================================================
 * These five values are the rules every untrusted payload is measured against,
 * and they are exported from modules a plug-in can import. Until GitHub issue
 * #10 every one of them was runtime-mutable: `REGISTRY_LIMITS` was `as const`,
 * which is a COMPILE-TIME assertion binding nobody who is not being compiled, so
 * `REGISTRY_LIMITS.MAX_NAV_NODES = 1e9` was an ordinary assignment.
 *
 * This file asserts BOTH halves of the fix, because the second half is the one a
 * reader would otherwise assume away:
 *
 *   1. No own property can be added, replaced or deleted on any of them. For
 *      `REGISTRY_LIMITS` that is genuine immutability. For the `Set`s and the
 *      `RegExp` it means the interrogation methods cannot be SHADOWED, which was
 *      the interesting attack — a plug-in owning `HOTKEY_KEYS.has` owns the
 *      hotkey allowlist for the whole page.
 *   2. **A frozen `Set` is still mutable through its own methods.** `Set` state
 *      lives in internal slots, not properties, so `Object.freeze` leaves `add`,
 *      `delete` and `clear` working. That is asserted here on a throwaway `Set`
 *      rather than on a real constant — mutating `HOTKEY_KEYS` to prove a point
 *      would leave the allowlist widened for every test that ran afterwards —
 *      and it is asserted at all so that nothing downstream can cite this file
 *      for a claim it does not make.
 *
 * ADR-0001 Amendment K Decision 5.
 * ============================================================================
 */

/** Every host constant that is expected to be frozen, by name. */
const HOST_CONSTANTS: readonly (readonly [string, object])[] = [
  ['EXTENSION_ID_PATTERN', EXTENSION_ID_PATTERN],
  ['RESERVED_IDS', RESERVED_IDS],
  ['REGISTRY_LIMITS', REGISTRY_LIMITS],
  ['HOTKEY_KEYS', HOTKEY_KEYS],
  ['HOTKEY_MODIFIER_REQUIRED_KEYS', HOTKEY_MODIFIER_REQUIRED_KEYS],
  ['PANE_IDS', PANE_IDS],
];

describe('the host constants', () => {
  it('freezes the host constants against replacement', () => {
    for (const [name, constant] of HOST_CONSTANTS) {
      expect(`${name}: ${String(Object.isFrozen(constant))}`).toBe(`${name}: true`);
      expect(Object.isExtensible(constant)).toBe(false);
    }
  });

  it.each(HOST_CONSTANTS.map(([name]) => name))(
    'refuses to let a caller shadow an interrogation method on %s',
    (name) => {
      const constant = HOST_CONSTANTS.find(([candidate]) => candidate === name)?.[1];
      const target = constant as unknown as Record<string, unknown>;
      // `has` for the sets, `test` for the pattern; assigning either as an OWN
      // property would shadow the prototype method every check calls.
      for (const member of ['has', 'test']) {
        expect(() => {
          target[member] = (): boolean => true;
        }).toThrow(TypeError);
      }
      // And nothing new can be attached either.
      expect(() => {
        target['smuggled'] = true;
      }).toThrow(TypeError);
    },
  );

  it('refuses to let a caller raise a registry bound', () => {
    const before = REGISTRY_LIMITS.MAX_NAV_NODES;
    expect(() => {
      (REGISTRY_LIMITS as unknown as Record<string, number>)['MAX_NAV_NODES'] = 1_000_000_000;
    }).toThrow(TypeError);
    expect(REGISTRY_LIMITS.MAX_NAV_NODES).toBe(before);

    expect(() => {
      delete (REGISTRY_LIMITS as unknown as Record<string, number>)['MAX_RIBBON_ACTIONS'];
    }).toThrow(TypeError);
    expect(REGISTRY_LIMITS.MAX_RIBBON_ACTIONS).toBe(128);
  });

  it('does not claim more than a frozen Set delivers', () => {
    // The honest half. A frozen `Set` keeps its properties, not its contents:
    // `Set` state is in internal slots and `add` is a prototype method operating
    // on them, so freezing the instance does not close it. Demonstrated on a
    // throwaway so that no real allowlist is left widened behind this test.
    const sample = Object.freeze(new Set(['a']));
    expect(Object.isFrozen(sample)).toBe(true);
    expect(() => sample.add('b')).not.toThrow();
    expect(sample.has('b')).toBe(true);
    expect(() => sample.delete('a')).not.toThrow();
    expect(sample.has('a')).toBe(false);

    // So the claim these constants carry is "cannot be replaced", never "cannot
    // be changed", and no prose about them may say otherwise. The real
    // allowlists are untouched by any of the above.
    expect(HOTKEY_KEYS.has('tab')).toBe(false);
    expect(RESERVED_IDS.has('__proto__')).toBe(true);
  });

  it('leaves the pattern usable, so the freeze cost nothing it was protecting', () => {
    expect(EXTENSION_ID_PATTERN.test('mail-ext')).toBe(true);
    expect(EXTENSION_ID_PATTERN.test('Mail Ext')).toBe(false);
    // A non-global RegExp does not write `lastIndex` from `test`, which is why
    // freezing the instance does not break repeated use.
    expect(EXTENSION_ID_PATTERN.global).toBe(false);
    expect(EXTENSION_ID_PATTERN.test('mail-ext')).toBe(true);
  });
});
