import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHELL_UX_ERROR_CODES, isShellUXErrorCode } from '../types';

/**
 * ============================================================================
 * THE ERROR-CODE TRUST DECISION IS UNREACHABLE FROM PLUGIN CODE
 * ============================================================================
 * `toShellUXError` in `RegistryContext.tsx` asks one question of a
 * `ShellUXError` that came back out of plugin code: is this `code` one of the
 * host's own? A `true` answer copies the plug-in's string into a
 * host-constructed error that the host then hands to its own callers, so
 * whoever can forge that answer can choose the code the host reports.
 *
 * That question used to be `SHELL_UX_ERROR_CODES.has(code)` — an interrogation
 * of an exported, frozen `Set`. Freezing closed exactly one route in: an own
 * `has` assigned onto the instance, shadowing the prototype method the host
 * called. It closed none of the three below. The first two are what an
 * adversarial review then walked straight through; the third is what would have
 * met anyone who fixed those two the obvious way.
 *
 *   1. `add` on the exported set. `Object.freeze` on a `Set` freezes its
 *      PROPERTIES; the membership lives in internal slots, so `add`, `delete`
 *      and `clear` are untouched by it. One `add` and the host trusts the
 *      attacker's code.
 *   2. `Set.prototype.has`. Assigning a function there forges membership in
 *      every `Set` in the realm at once — every frozen host allowlist included,
 *      since freezing an instance says nothing about its prototype.
 *   3. `Object.prototype`. A lookup table with an ordinary prototype answers
 *      for keys it never held, so replacing the `Set` with the nearest plain
 *      object would have swapped one forgery for another.
 *
 * The decision is now `isShellUXErrorCode`, which reads a module-private,
 * null-prototype, frozen table in `types.ts` that no importer can name. All
 * three attacks are RUN here against the shipped predicate rather than argued
 * about — and each is red against a real implementation, which is the only
 * reason to keep it. Attacks 1 and 2 succeed against the `Set` this replaced;
 * attack 3 cannot touch a `Set` at all and succeeds against the obvious
 * replacement instead, an ordinary plain-object table, which is what makes
 * `__proto__: null` in `types.ts` load-bearing rather than ornamental.
 *
 * Each attack is set up, its answer captured into a local, and the realm put
 * back in a `finally` before anything is asserted. A poisoned
 * `Set.prototype.has` or a polluted `Object.prototype` left standing across an
 * `expect` would be running the test framework, React and every later test in
 * this worker against a broken realm; the assertion is therefore made after the
 * repair, on a boolean captured while the attack was live.
 * ============================================================================
 */

/** Every `ShellUXErrorCode` the union declares, written out rather than derived. */
const DECLARED_CODES: readonly string[] = [
  'INVALID_PAYLOAD',
  'MISSING_FIELD',
  'INVALID_FIELD',
  'INVALID_ID',
  'RESERVED_ID',
  'DUPLICATE_ID',
  'DUPLICATE_HOTKEY',
  'PAYLOAD_TOO_LARGE',
  'REVOKED',
  'REENTRANT_NOTIFY',
];

/** A code no host will ever declare, used as the forgery target throughout. */
const FORGED = 'ATTACKER_CHOSEN';

describe('isShellUXErrorCode — the trust decision plugin code cannot reach', () => {
  it('holds exactly the codes the union declares, and nothing else', () => {
    // The compiler rejects a member of `ShellUXErrorCode` that the private table
    // omits. It does NOT reject a stray key — the table literal is an argument
    // to `Object.freeze`, and excess-property checking needs a literal that has
    // not passed through a generic — and a stray key is the direction that
    // widens trust. So the stray-key half is checked here, at runtime, against a
    // list written out by hand. Deriving the list from the same export would
    // make this assertion agree with itself.
    expect([...SHELL_UX_ERROR_CODES].sort()).toEqual([...DECLARED_CODES].sort());
    for (const code of DECLARED_CODES) {
      expect(`${code}: ${String(isShellUXErrorCode(code))}`).toBe(`${code}: true`);
    }
  });

  it('rejects everything else, including values that are not strings at all', () => {
    expect(isShellUXErrorCode(FORGED)).toBe(false);
    expect(isShellUXErrorCode('')).toBe(false);
    // Keys that exist on an ordinary object's prototype chain without anybody
    // polluting it: `__proto__`, `constructor` and `toString` all answer on a
    // normal lookup table and must not answer here.
    expect(isShellUXErrorCode('__proto__')).toBe(false);
    expect(isShellUXErrorCode('constructor')).toBe(false);
    expect(isShellUXErrorCode('toString')).toBe(false);
    // Non-strings never reach the lookup at all.
    expect(isShellUXErrorCode(42)).toBe(false);
    expect(isShellUXErrorCode(null)).toBe(false);
    expect(isShellUXErrorCode(undefined)).toBe(false);
    expect(isShellUXErrorCode({ toString: (): string => 'REVOKED' })).toBe(false);
  });

  it('is unmoved by a code added to the exported SHELL_UX_ERROR_CODES set', () => {
    // Attack 1, exactly as the review reproduced it. The cast is the attack: the
    // `ReadonlySet` type is a compile-time binding on nobody who is not being
    // compiled, and `add` is right there on a frozen instance.
    const forgeable = SHELL_UX_ERROR_CODES as Set<string>;
    let smuggled = false;
    let answer = true;
    try {
      forgeable.add(FORGED);
      smuggled = SHELL_UX_ERROR_CODES.has(FORGED);
      answer = isShellUXErrorCode(FORGED);
    } finally {
      forgeable.delete(FORGED);
    }
    // The premise: the add really did widen the set. Without this the test could
    // pass because the attack silently failed.
    expect(smuggled).toBe(true);
    expect(answer).toBe(false);
    // And the set is back where it started, for every test after this one.
    expect(SHELL_UX_ERROR_CODES.has(FORGED)).toBe(false);
  });

  it('is unmoved by a poisoned Set.prototype.has', () => {
    // Attack 2. This forges membership in every `Set` in the realm at once, so
    // it is live for two statements and then undone.
    const original = Set.prototype.has;
    let forged = false;
    let answer = true;
    try {
      Set.prototype.has = function poisoned(): boolean {
        return true;
      };
      forged = SHELL_UX_ERROR_CODES.has(FORGED);
      answer = isShellUXErrorCode(FORGED);
    } finally {
      Set.prototype.has = original;
    }
    // The premise: the poisoning really did forge membership in the exported
    // set, which is what the trust decision used to consult.
    expect(forged).toBe(true);
    expect(answer).toBe(false);
    expect(SHELL_UX_ERROR_CODES.has(FORGED)).toBe(false);
  });

  it('is unmoved by Object.prototype pollution naming the forged code', () => {
    // Attack 3. The predicate would be defeated by this if its table had an
    // ordinary prototype, which is why the table is built with `__proto__: null`
    // and read with `=== true` rather than for truthiness.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    let ordinaryObjectAnswers: unknown;
    let answer = true;
    try {
      polluted[FORGED] = true;
      ordinaryObjectAnswers = ({ REVOKED: true } as Record<string, unknown>)[FORGED];
      answer = isShellUXErrorCode(FORGED);
    } finally {
      delete polluted[FORGED];
    }
    // The premise: an ordinary lookup table really does answer for a key it
    // never held.
    expect(ordinaryObjectAnswers).toBe(true);
    expect(answer).toBe(false);
    // The realm is repaired.
    expect(({} as Record<string, unknown>)[FORGED]).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The exported set is kept, and kept out of the decision                      */
/* -------------------------------------------------------------------------- */

/**
 * `src/`, resolved from this file's own location rather than from the cwd, so
 * the walk does not depend on where the runner was started. Spelled with
 * `dirname` rather than `new URL('…', import.meta.url)` because Vite rewrites
 * that second form as an asset reference and it stops being a `file:` URL —
 * the same idiom as `src/__tests__/noEventListener.test.ts`, for the same reason.
 */
const SRC_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * The NAME of the forgeable set, not one spelling of a call on it.
 *
 * This gate used to scan for the literal `SHELL_UX_ERROR_CODES` followed by
 * `.has`, which is the spelling the original review reproduced and only that
 * one. A later review demonstrated four more that pass a `.has` scan and are
 * exactly as forgeable, because every one of them still reads the exported set:
 *
 *   const codes = SHELL_UX_ERROR_CODES; codes.has(code);   // aliased to a local
 *   SHELL_UX_ERROR_CODES[method](code);                    // computed access
 *   [...SHELL_UX_ERROR_CODES].includes(code);              // spread, then Array
 *   Array.from(SHELL_UX_ERROR_CODES).includes(code);       // ditto, named
 *
 * A single `add` on the exported set widens all four — `Object.freeze` on a
 * `Set` reaches its properties and not the internal slots the membership lives
 * in — so a trust decision written in any of them reintroduces exactly the defect
 * the decision was moved out of the set to close. A gate that catches one
 * spelling of a decision and misses four is not a gate on the decision, and six
 * documents describe this one as a gate on the decision.
 *
 * So the scan is on the identifier: any mention of the name at all, in code or in
 * a comment, anywhere under `src/` outside a test. `\b` on both sides so that a
 * longer identifier which merely contains it is not caught by accident.
 */
const FORBIDDEN_IDENTIFIER = /\bSHELL_UX_ERROR_CODES\b/;

/** The module that declares the set, relative to `src/`. */
const DECLARING_MODULE = 'core/types.ts';

/**
 * The one line under `src/` the scan forgives: the declaration itself.
 *
 * The exemption is NOT the file. Exempting the whole of `types.ts` would leave a
 * trust decision written inside the declaring module invisible to the gate, and
 * that module is the single most likely place for one to be written. Matching the
 * declaration's exact text instead means the forgiven line has no room on it for
 * an interrogation — anything appended to it stops the line matching, and the
 * scan reports it.
 *
 * It is anchored to the current formatting on purpose. Reflow the declaration
 * onto one line and this stops matching, the declaration is reported as an
 * offender, and the suite goes red — which is the safe direction for an exemption
 * to fail in. It is never silently widened.
 */
const DECLARATION = /^export const SHELL_UX_ERROR_CODES: ReadonlySet<string> = Object\.freeze\($/;

/** Where the identifier was found: offending sites, and the one forgiven site. */
interface IdentifierScan {
  readonly offenders: readonly string[];
  readonly exempted: readonly string[];
}

function scanForTheIdentifier(root: string, modules: readonly string[]): IdentifierScan {
  const offenders: string[] = [];
  const exempted: string[] = [];
  for (const file of modules) {
    const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!FORBIDDEN_IDENTIFIER.test(line)) continue;
      const site = `${file}:${index + 1}`;
      if (file === DECLARING_MODULE && DECLARATION.test(line.trim())) {
        exempted.push(site);
        continue;
      }
      offenders.push(site);
    }
  }
  return { offenders, exempted };
}

function productionModules(root: string): string[] {
  const found: string[] = [];
  const descend = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        descend(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) continue;
      found.push(relative(root, full).split(sep).join('/'));
    }
  };
  descend(root);
  return found.sort();
}

describe('the exported SHELL_UX_ERROR_CODES set', () => {
  const modules = productionModules(SRC_ROOT);
  const scan = scanForTheIdentifier(SRC_ROOT, modules);

  it('is looked for in a walk that really found the production modules', () => {
    // The anti-vacuity check. The assertion below iterates this walk, so a walk
    // that collected nothing would report green while checking nothing at all.
    expect(modules.length).toBeGreaterThan(10);
    expect(modules).toContain('core/types.ts');
    expect(modules).toContain('core/RegistryContext.tsx');
  });

  it('is not interrogated by any module outside the tests', () => {
    // Keeping a forgeable-looking set of trusted codes exported is only safe
    // while nothing production-side asks it anything, and "nothing does" is a
    // claim that decays the moment somebody reaches for the obvious name.
    //
    // This is a text scan, so be exact about what it sees. It fails on the
    // IDENTIFIER — see FORBIDDEN_IDENTIFIER above for the four evasions that a
    // scan for `.has` alone let through, each as forgeable as the one it caught —
    // anywhere under `src/` outside a test, in code or in a comment. So a
    // production module cannot interrogate the set by ANY spelling without first
    // naming it, and naming it is what fails here. That is what makes the wider
    // claim the six documents cite this test for — nothing production-side
    // interrogates the set — true as written rather than true of one spelling.
    //
    // The price is on writers: prose *inside `src/`* that needs to discuss this
    // export refers to it without spelling it, as the docblock above the private
    // table in `types.ts` does. **The price is also on CALLERS, and that half
    // reads as available when it is not:** a production module cannot IMPORT the
    // export either, so listing or displaying the codes from one is closed by
    // this gate rather than merely unused, and no prose may offer that use as a
    // reason the export is kept.
    //
    // What the scan does NOT see, since a gate believed to be wider than it is is
    // worse than none: it reads text, so it cannot follow a re-export under a
    // different name, a dynamic `import()` of `types.ts` indexed by a computed
    // string, or the identifier assembled at runtime from fragments. Those are
    // review's job. What it does close is every spelling a developer would
    // plausibly reach for, which is the failure mode that actually happened here.
    expect(scan.offenders).toEqual([]);
  });

  it('is exempted at its own declaration line and at no other site', () => {
    // The gate has exactly one hole, and this measures it rather than trusting
    // it. "No holes" would be false — the declaration has to name what it
    // declares — so the claim is that the hole is one line wide, in one file, and
    // shaped so that nothing can be interrogated through it.
    //
    // Asserted in both directions. An exemption that stopped matching would show
    // up as an unreadable failure in the test above; one that started matching a
    // second line would be a new hole appearing in silence.
    expect(scan.exempted.map((site) => site.slice(0, site.lastIndexOf(':')))).toEqual([
      DECLARING_MODULE,
    ]);
  });
});
