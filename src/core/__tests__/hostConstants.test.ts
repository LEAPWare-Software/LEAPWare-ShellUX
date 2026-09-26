import { describe, expect, it } from 'vitest';
import * as registryModule from '../RegistryContext';
import * as typesModule from '../types';
import * as hydrationModule from '../services/HydrationEngine';
// Named alongside the namespace import above, because these four are asserted
// BY NAME in the cases below — the discovery scan proves they are found, and
// these prove the found values still answer correctly.
import {
  EXTENSION_ID_PATTERN,
  HOTKEY_KEYS,
  REGISTRY_LIMITS,
  RESERVED_IDS,
  TEXT_FORBIDDEN_PATTERN,
  TEXT_INVISIBLE_PATTERN,
} from '../RegistryContext';
import { SHELL_UX_ERROR_CODES } from '../types';
import { HYDRATION_LIMITS } from '../services/HydrationEngine';

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
 *
 * ----------------------------------------------------------------------------
 * THE HAND-MAINTAINED LIST WAS THE DEFECT, SO IT IS GONE.
 * ----------------------------------------------------------------------------
 * Issue #10 closed exactly this defect for `REGISTRY_LIMITS`, and it came back
 * twice: `SHELL_UX_ERROR_CODES` in `types.ts` was a bare `new Set(...)`, and
 * `HYDRATION_LIMITS` in `HydrationEngine.ts` was `as const`. Neither was caught,
 * because the list below used to be written out by hand and a constant nobody
 * added to it was a constant nobody checked. The list was the mechanism of the
 * regression, not merely a place it was missed.
 *
 * So the constants are now DISCOVERED by walking the modules' own exports.
 * Anything exported that looks like a host constant — a frozen-by-intent
 * container: a `Set`, `Map`, `RegExp`, or a plain object of primitives, in
 * SCREAMING_SNAKE_CASE — is required to be frozen, whether or not anybody
 * remembered it. A third regression of this shape now fails on the commit that
 * introduces it.
 *
 * `SHELL_UX_ERROR_CODES` matters more than the others: `toShellUXError` in
 * `RegistryContext.tsx` calls `.has` on it to decide whether an error crossing
 * back from plug-in code carries a code the host trusts. An unfrozen set let a
 * plug-in shadow `.has` and choose the code `register()` returns — including
 * masquerading as `REVOKED`. `SECURITY.md` labels that an *unconditional*
 * integrity control, so the defect made a live security claim false.
 * ----------------------------------------------------------------------------
 */

/** Modules whose exports are searched for host constants, by name. */
const SCANNED_MODULES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['core/RegistryContext.tsx', registryModule as unknown as Record<string, unknown>],
  ['core/types.ts', typesModule as unknown as Record<string, unknown>],
  ['core/services/HydrationEngine.ts', hydrationModule as unknown as Record<string, unknown>],
];

/**
 * Whether an exported value is the KIND of thing this file is about.
 *
 * Deliberately structural rather than a name list — a name list is the thing
 * that failed. A host constant is a container of rules measured against
 * untrusted input, so: a `Set`, `Map` or `RegExp`, or a plain object whose own
 * values are all primitives. A function, a class, a React component or a
 * value-carrying object is none of those and is not in scope here.
 */
function isHostConstant(value: unknown): value is object {
  if (value instanceof Set || value instanceof Map || value instanceof RegExp) {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const values = Object.values(value as Record<string, unknown>);
  return values.length > 0 && values.every((member) => member === null || typeof member !== 'object');
}

/** SCREAMING_SNAKE_CASE, which is how this repository spells a host constant. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Every host constant these modules export, discovered rather than listed. */
const HOST_CONSTANTS: readonly (readonly [string, object])[] = SCANNED_MODULES.flatMap(
  ([moduleName, module]) =>
    Object.entries(module).flatMap(([name, value]): (readonly [string, object])[] =>
      CONSTANT_NAME.test(name) && isHostConstant(value) ? [[`${moduleName} ${name}`, value]] : [],
    ),
);

describe('the host constants — the discovery scan itself', () => {
  // A scan that finds nothing passes every assertion below it. These four cases
  // are what stop that: they pin the mechanism rather than the result, in the
  // same register `src/__tests__/noEventListener.test.ts` uses for its
  // allowlists. Without them, a broken `isHostConstant` would present as a
  // green suite and an unguarded host.
  it('discovers every constant the hand-maintained list used to name, and more', () => {
    const found = HOST_CONSTANTS.map(([name]) => name);
    for (const expected of [
      'core/RegistryContext.tsx EXTENSION_ID_PATTERN',
      'core/RegistryContext.tsx RESERVED_IDS',
      'core/RegistryContext.tsx REGISTRY_LIMITS',
      'core/RegistryContext.tsx HOTKEY_KEYS',
      'core/RegistryContext.tsx HOTKEY_MODIFIER_REQUIRED_KEYS',
      'core/types.ts PANE_IDS',
      // The two the hand-maintained list did NOT name, which is the whole point.
      'core/types.ts SHELL_UX_ERROR_CODES',
      'core/services/HydrationEngine.ts HYDRATION_LIMITS',
    ]) {
      expect(found).toContain(expected);
    }
  });

  it('finds constants in all three scanned modules, so no module is silently empty', () => {
    for (const [moduleName] of SCANNED_MODULES) {
      expect(
        `${moduleName}: ${String(HOST_CONSTANTS.some(([name]) => name.startsWith(moduleName)))}`,
      ).toBe(`${moduleName}: true`);
    }
  });

  it.each([
    ['a Set', new Set(['a']), true],
    ['a Map', new Map([['a', 1]]), true],
    ['a RegExp', /a/, true],
    ['a plain record of primitives', { MAX: 1, NAME: 'a', FLAG: true, NOTHING: null }, true],
    ['an empty record, which constrains nothing', {}, false],
    ['an array', ['a'], false],
    ['a function', (): boolean => true, false],
    ['a record holding an object, which is a value not a rule', { nested: { a: 1 } }, false],
    ['a null-prototype record, which is a payload not a constant', Object.create(null), false],
    ['a string', 'MAX', false],
    ['null', null, false],
  ])('classifies %s correctly, so the filter is not vacuous', (_label, value, expected) => {
    expect(isHostConstant(value)).toBe(expected);
  });

  it('would reject an unfrozen constant, demonstrated on a throwaway', () => {
    // The control for the freeze assertion below. If `Object.isFrozen` were
    // somehow always true, every case in this file would pass while guarding
    // nothing, so the negative is asserted explicitly.
    const unfrozen = { MAX_THINGS: 1 };
    expect(isHostConstant(unfrozen)).toBe(true);
    expect(Object.isFrozen(unfrozen)).toBe(false);
  });
});

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

  it('refuses to let a plug-in shadow SHELL_UX_ERROR_CODES.has and choose its own error code', () => {
    // The specific regression, named. `toShellUXError` in `RegistryContext.tsx`
    // asks this set whether an error crossing back from plug-in code carries a
    // code the host trusts. While it was a bare `new Set(...)`, a plug-in could
    // assign its own `has` and have every foreign code accepted — including
    // `REVOKED`, so a live handle could report itself dead. `SECURITY.md` calls
    // that an unconditional integrity control, so the gap made the claim false.
    expect(Object.isFrozen(SHELL_UX_ERROR_CODES)).toBe(true);
    expect(() => {
      (SHELL_UX_ERROR_CODES as unknown as Record<string, unknown>)['has'] = (): boolean => true;
    }).toThrow(TypeError);
    // Unchanged and still answering for itself.
    expect(SHELL_UX_ERROR_CODES.has('REVOKED')).toBe(true);
    expect(SHELL_UX_ERROR_CODES.has('NOT_A_HOST_CODE')).toBe(false);
  });

  it('refuses to let a caller raise a hydration bound, which `as const` never stopped', () => {
    // The second regression. `as const` is a COMPILE-TIME assertion and binds
    // nobody who is not being compiled, so this was an ordinary assignment —
    // and `MAX_RAW_LENGTH` is the bound that decides whether a stored record is
    // parsed at all.
    const before = HYDRATION_LIMITS.MAX_RAW_LENGTH;
    expect(() => {
      (HYDRATION_LIMITS as unknown as Record<string, number>)['MAX_RAW_LENGTH'] = 1_000_000_000;
    }).toThrow(TypeError);
    expect(HYDRATION_LIMITS.MAX_RAW_LENGTH).toBe(before);
    expect(() => {
      delete (HYDRATION_LIMITS as unknown as Record<string, number>)['MAX_DEPTH'];
    }).toThrow(TypeError);
    expect(HYDRATION_LIMITS.MAX_DEPTH).toBe(8);
  });

  it('leaves the pattern usable, so the freeze cost nothing it was protecting', () => {
    expect(EXTENSION_ID_PATTERN.test('mail-ext')).toBe(true);
    expect(EXTENSION_ID_PATTERN.test('Mail Ext')).toBe(false);
    // A non-global RegExp does not write `lastIndex` from `test`, which is why
    // freezing the instance does not break repeated use.
    expect(EXTENSION_ID_PATTERN.global).toBe(false);
    expect(EXTENSION_ID_PATTERN.test('mail-ext')).toBe(true);
  });

  it('the shared text patterns carry no global flag, so repeated test calls agree', () => {
    // D-56, GitHub issue #172. Measured: a `g`-flagged `RegExp` is stateful
    // across calls on its own `lastIndex` — `/a/g.test('a')` answers `true`
    // then `false` on the identical input the second time. A shared,
    // module-level `g` pattern reused across call sites would silently skip
    // characters depending on call order, which is why neither export carries
    // one; every call site builds its own fresh `'gu'` copy instead.
    expect(TEXT_FORBIDDEN_PATTERN.flags).toBe('u');
    expect(TEXT_INVISIBLE_PATTERN.flags).toBe('u');

    const forbiddenInput = '؜';
    expect(TEXT_FORBIDDEN_PATTERN.test(forbiddenInput)).toBe(true);
    expect(TEXT_FORBIDDEN_PATTERN.test(forbiddenInput)).toBe(true);

    const invisibleInput = '​';
    expect(TEXT_INVISIBLE_PATTERN.test(invisibleInput)).toBe(true);
    expect(TEXT_INVISIBLE_PATTERN.test(invisibleInput)).toBe(true);

    // The measurement the docblock cites, reproduced here: a `g`-flagged
    // sibling of the same pattern DOES disagree with itself across calls,
    // which is exactly the bug the exported, `g`-less pattern avoids.
    const statefulSibling = new RegExp(TEXT_FORBIDDEN_PATTERN.source, 'gu');
    expect(statefulSibling.test(forbiddenInput)).toBe(true);
    expect(statefulSibling.test(forbiddenInput)).toBe(false);
  });
});
