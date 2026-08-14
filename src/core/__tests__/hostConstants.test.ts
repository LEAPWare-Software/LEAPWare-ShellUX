import { describe, expect, it } from 'vitest';
import * as hydrationModule from '../services/HydrationEngine';
import * as registryModule from '../RegistryContext';
import * as typesModule from '../types';
import {
  EXTENSION_ID_PATTERN,
  HOTKEY_KEYS,
  REGISTRY_LIMITS,
  RESERVED_IDS,
} from '../RegistryContext';

/**
 * ============================================================================
 * THE HOST CONSTANTS ARE FROZEN — AND EXACTLY WHAT THAT IS WORTH
 * ============================================================================
 * These are the rules every untrusted payload is measured against, and they are
 * exported from modules a plug-in can import. Until GitHub issue #10 every one
 * of them was runtime-mutable: `REGISTRY_LIMITS` was `as const`, which is a
 * COMPILE-TIME assertion binding nobody who is not being compiled, so
 * `REGISTRY_LIMITS.MAX_NAV_NODES = 1e9` was an ordinary assignment.
 *
 * **This gate enumerates the modules, not the constants.** The first version of
 * this file carried a hand-maintained list of six names. `HYDRATION_LIMITS`
 * shipped `as const` — issue #10's exact defect, reintroduced — and
 * `SHELL_UX_ERROR_CODES` shipped an unfrozen `Set` that the host interrogated to
 * decide whether a plug-in-supplied error code was trusted; neither was on the
 * list, so the gate was structurally incapable of seeing either. A list nobody
 * remembers to extend is how the second defect got in, so the list is gone: the
 * walk below reads each module's own export namespace and requires every
 * object-valued export to be frozen. A constant added tomorrow is covered by
 * default rather than by someone remembering. An export that must be exempt goes
 * in `FREEZE_EXEMPTIONS` with its reason, never by silent omission.
 *
 * **Freezing that `Set` was necessary and was not sufficient, and the error-code
 * trust decision no longer rests on it.** Point 2 below is the reason: the
 * freeze stopped an own `has` shadowing the prototype method and left the
 * membership editable, so a plug-in could still widen the very collection the
 * host was consulting. That decision now lives in `isShellUXErrorCode` in
 * `types.ts`, which reads a module-private null-prototype table no importer can
 * reach; `SHELL_UX_ERROR_CODES` is kept as an enumerable list that nothing
 * production-side interrogates. That is a different property from freezing and
 * it is pinned in a different file — by "isShellUXErrorCode — the trust decision
 * plugin code cannot reach" in `src/core/__tests__/errorCodeTrust.test.ts`. The
 * freeze gate below is unchanged and still worth having for every constant it
 * covers.
 *
 * This file asserts BOTH halves of the fix, because the second half is the one a
 * reader would otherwise assume away:
 *
 *   1. No own property can be added, replaced or deleted on any of them. For a
 *      plain-object table of primitives — `REGISTRY_LIMITS`, `HYDRATION_LIMITS`
 *      — that amounts to genuine immutability. **The gate is one level deep, so
 *      that reading does not generalise**, and one gated constant already goes
 *      deeper than one level: `DEFAULT_SHELL_STATE` holds a nested `paneSizes`
 *      object. It happens to be safe, because `DEFAULT_PANE_SIZES` in
 *      `HydrationEngine.ts` is frozen where it is declared — by its author, not
 *      by anything below. A nested table added tomorrow whose author did not do
 *      that would pass every assertion in this file with its inner object fully
 *      writable. Read the claim as "the top level cannot be replaced", and deep
 *      freezing as something still owned by each declaration site.
 *      For the `Set`s and the `RegExp` the freeze means the interrogation
 *      methods cannot be SHADOWED, which was the interesting attack — a plug-in
 *      owning `HOTKEY_KEYS.has` owns the hotkey allowlist for the whole page.
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

/**
 * The modules whose exported surface is subject to the freeze gate.
 *
 * This is the one list still maintained by hand, and it is a list of MODULES
 * rather than of constants: adding a constant to a module already here needs no
 * edit, which is the property the old per-constant list lacked. Adding a new
 * host module that exports bounds or allowlists does need a line here.
 */
const GATED_MODULES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['RegistryContext', registryModule],
  ['types', typesModule],
  ['services/HydrationEngine', hydrationModule],
];

/**
 * Exports deliberately exempt from the freeze gate — `module#export` to reason.
 *
 * Empty, and expected to stay empty: as of the fix above every object-valued
 * export of every gated module is frozen. It exists so that an exemption has to
 * be WRITTEN DOWN with a justification a reviewer can refuse, instead of being
 * expressed as a name quietly missing from a list.
 */
const FREEZE_EXEMPTIONS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Every export of every gated module that is capable of being frozen.
 *
 * Objects, `Set`s, `Map`s and `RegExp`s all answer `typeof === 'object'`, so one
 * test covers the lot. Functions and classes are skipped — freezing a function
 * object protects nothing here, since what a plug-in would attack is the bound
 * or the allowlist a function READS. Primitives (`SCHEMA_VERSION`,
 * `STORAGE_KEY`, `DEFAULT_DEBOUNCE_MS`) have no properties to freeze, and an
 * importer cannot write through them either — NOT because an import copies the
 * value, which it does not: an ES module import is a live binding onto the
 * exporting module's variable, so an importer sees whatever that module last
 * assigned. What closes it is that all three are `export const`, so the only
 * module that could ever reassign them never does, and every importing binding
 * is read-only besides. Type-only exports are erased before this runs.
 */
const FREEZABLE_EXPORTS: readonly (readonly [string, object])[] = GATED_MODULES.flatMap(
  ([moduleName, namespace]) =>
    Object.keys(namespace)
      .sort()
      .flatMap((exportName) => {
        const value = namespace[exportName];
        if (typeof value !== 'object' || value === null) {
          return [];
        }
        const key = `${moduleName}#${exportName}`;
        if (key in FREEZE_EXEMPTIONS) {
          return [];
        }
        return [[key, value] as const];
      }),
);

describe('the host constants', () => {
  it('walks the gated modules and finds the constants it is meant to guard', () => {
    // The anti-vacuity check. Everything below iterates `FREEZABLE_EXPORTS`, so
    // an enumeration that silently collected nothing — a renamed module, a
    // namespace import that stopped resolving — would turn every assertion in
    // this file into a no-op that still reports green. These names are a FLOOR,
    // not the list: the gate covers whatever else the walk finds.
    const found = FREEZABLE_EXPORTS.map(([name]) => name);
    for (const required of [
      'RegistryContext#EXTENSION_ID_PATTERN',
      'RegistryContext#RESERVED_IDS',
      'RegistryContext#REGISTRY_LIMITS',
      'RegistryContext#HOTKEY_KEYS',
      'RegistryContext#HOTKEY_MODIFIER_REQUIRED_KEYS',
      'types#PANE_IDS',
      'types#SHELL_UX_ERROR_CODES',
      'services/HydrationEngine#HYDRATION_LIMITS',
      'services/HydrationEngine#DEFAULT_SHELL_STATE',
      'services/HydrationEngine#EMPTY_SCOPED_STATE',
    ]) {
      expect(found).toContain(required);
    }
  });

  // Title kept verbatim on purpose: it is cited by `README.md`, by
  // `src/core/RegistryContext.tsx` and by ADR-0001, and `npm run check:citations`
  // resolves every cited title repo-wide. Renaming it fails the build even though
  // the assertion is unchanged. The BODY is what grew — from a hand-listed six
  // constants to every object-valued export the gated modules declare.
  it('freezes the host constants against replacement', () => {
    for (const [name, constant] of FREEZABLE_EXPORTS) {
      expect(`${name}: ${String(Object.isFrozen(constant))}`).toBe(`${name}: true`);
      expect(`${name}: ${String(Object.isExtensible(constant))}`).toBe(`${name}: false`);
    }
  });

  it.each(FREEZABLE_EXPORTS.map(([name]) => name))(
    'refuses to let a caller shadow an interrogation method on %s',
    (name) => {
      const constant = FREEZABLE_EXPORTS.find(([candidate]) => candidate === name)?.[1];
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
