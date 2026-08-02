import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEME_IDS,
  SEMANTIC_TOKEN_NAMES,
  SEMANTIC_TOKEN_NAME_LIST,
  THEME_SCHEMA_VERSION,
} from '../tokens.generated';
import { TOKEN_CLASS } from '../tokenClasses';

/**
 * ============================================================================
 * THE THEME CONTRACT, AND THE ONE PROPERTY OF IT A UNIT TEST CAN ACTUALLY PROVE.
 * ============================================================================
 * `tokens.generated.ts` is a generated file, so most of what could be asserted
 * about it is a restatement of the generator. Two things are not:
 *
 * 1. **`SEMANTIC_TOKEN_NAMES` is a `Set` that is actually immutable.**
 *    `Object.freeze` on a `Set` does NOT stop `.add()` — freezing seals the
 *    object's own properties and a `Set`'s contents live in an internal slot the
 *    freeze never touches. HANDOFF.md section 11 records this as a trap, because
 *    "freezing the wrong container reads as a control and is not one". The
 *    generator answers it by replacing the three mutators on the instance BEFORE
 *    the freeze, so the freeze is what stops them being replaced back. That is a
 *    real runtime behaviour with a real way to be wrong, and it is exercised
 *    here rather than trusted — a generator regression that dropped the
 *    `defineProperties` call would leave an ordinary mutable `Set` wearing a
 *    reassuring word, and every other assertion in this file would still pass.
 *
 * 2. **`TOKEN_CLASS` names tokens that exist.** Every value is a Tailwind class
 *    built from a semantic token name, and the contract is what says which names
 *    are real. A role pointed at `--surface-panel` — a typo for `--surface-pane`
 *    — compiles, renders, passes `toHaveClass`, and paints nothing. Nothing in
 *    the type system catches it, because both sides are strings.
 *
 * **What this file does NOT prove**, because no jsdom test can: that any of
 * these tokens has a value, or that a value reaches the DOM. jsdom applies no
 * stylesheet and resolves no custom property. `scripts/check-tokens.mjs`
 * measures the values and `e2e/theme.spec.ts` measures the compiled stylesheet.
 * ============================================================================
 */

/** Every `--token` referenced by a `TOKEN_CLASS` value, however it is spelled. */
function tokensReferencedBy(className: string): string[] {
  const found: string[] = [];
  // Two spellings reach a token from a class: the arbitrary-value form
  // `var(--border-selected)`, and the utility form `bg-surface-pane`, where the
  // token name is the class minus its variant prefixes and its utility prefix.
  for (const match of className.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
    found.push(match[1] as string);
  }
  for (const part of className.split(/\s+/)) {
    const base = part.slice(part.lastIndexOf(':') + 1);
    const utility = /^(?:bg|text|border|ring|outline|shadow|divide|fill|stroke)-(.+)$/.exec(base);
    if (utility === null) {
      continue;
    }
    const name = `--${utility[1] as string}`;
    if (SEMANTIC_TOKEN_NAMES.has(name as never)) {
      found.push(name);
    }
  }
  return found;
}

describe('the generated semantic token contract', () => {
  it('publishes the schema version, the name list and the built-in theme ids', () => {
    expect(THEME_SCHEMA_VERSION).toBe(1);
    expect(SEMANTIC_TOKEN_NAME_LIST).toHaveLength(67);
    expect(BUILT_IN_THEME_IDS).toEqual([
      'leapware-light',
      'leapware-dark',
      'leapware-high-contrast',
    ]);
    // The list and the set are the same names, so a consumer may use whichever
    // shape suits it without asking which is authoritative.
    expect(SEMANTIC_TOKEN_NAMES.size).toBe(SEMANTIC_TOKEN_NAME_LIST.length);
    for (const name of SEMANTIC_TOKEN_NAME_LIST) {
      expect(SEMANTIC_TOKEN_NAMES.has(name)).toBe(true);
    }
  });

  it('names every token with a leading double dash and no duplicates', () => {
    for (const name of SEMANTIC_TOKEN_NAME_LIST) {
      expect(name).toMatch(/^--[a-z][a-z0-9-]*$/);
    }
    expect(new Set(SEMANTIC_TOKEN_NAME_LIST).size).toBe(SEMANTIC_TOKEN_NAME_LIST.length);
  });

  it('refuses add, delete and clear on the name set, which Object.freeze alone would not', () => {
    // HANDOFF.md section 11's trap, exercised. Each mutator throws rather than
    // silently succeeding, and the thrown message names the member so a caller
    // learns which call it was.
    const mutable = SEMANTIC_TOKEN_NAMES as unknown as {
      add: (value: string) => unknown;
      delete: (value: string) => unknown;
      clear: () => unknown;
    };
    expect(() => mutable.add('--injected')).toThrow(/immutable; add is not available/);
    expect(() => mutable.delete('--surface-pane')).toThrow(/immutable; delete is not available/);
    expect(() => mutable.clear()).toThrow(/immutable; clear is not available/);

    // ...and the set is unchanged after all three, which is the property the
    // throwing is for. A mutator that threw AFTER mutating would pass the three
    // cases above.
    expect(SEMANTIC_TOKEN_NAMES.size).toBe(SEMANTIC_TOKEN_NAME_LIST.length);
    expect(SEMANTIC_TOKEN_NAMES.has('--surface-pane' as never)).toBe(true);

    // The freeze is the second half: without it, a caller could put the
    // ordinary mutators back and undo the refusal.
    expect(Object.isFrozen(SEMANTIC_TOKEN_NAMES)).toBe(true);
  });

  it('freezes the ordered list and the theme ids too', () => {
    expect(Object.isFrozen(SEMANTIC_TOKEN_NAME_LIST)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_THEME_IDS)).toBe(true);
  });
});

describe('TOKEN_CLASS', () => {
  it('references only tokens the generated contract declares', () => {
    // The typo case. `bg-surface-panel` is a valid class, renders, satisfies
    // `toHaveClass`, and paints nothing at all — and because the tests assert
    // against this same record, nothing else in the vitest lane would notice.
    const roles = Object.entries(TOKEN_CLASS);
    expect(roles.length).toBeGreaterThan(0);
    for (const [role, className] of roles) {
      for (const token of tokensReferencedBy(className)) {
        expect(SEMANTIC_TOKEN_NAMES.has(token as never), `${role} names ${token}`).toBe(true);
      }
    }
  });

  it('resolves at least one token per role, so a role cannot be a colourless string', () => {
    // Without this, a role rewritten to `'font-semibold'` would pass the case
    // above by referencing no token at all. Four roles are structural rather
    // than colour — the transparent rest border, the shadow elevation, the ring
    // and the composed focus ring — and they are named, not skipped.
    const structural = new Set([
      'controlRestBorder',
      'menuElevation',
      'navSelectedRule',
      'rowSelectedRule',
      'listFocusRing',
    ]);
    for (const [role, className] of Object.entries(TOKEN_CLASS)) {
      if (structural.has(role)) {
        continue;
      }
      expect(tokensReferencedBy(className).length, `${role} names no token`).toBeGreaterThan(0);
    }
    // ...and the structural exemptions are held to being structural: each still
    // has to be a real class, and the two selection rules still have to name
    // `--border-selected` through the arbitrary-value form.
    expect(TOKEN_CLASS.controlRestBorder).toBe('border-transparent');
    expect(TOKEN_CLASS.navSelectedRule).toContain('var(--border-selected)');
    expect(TOKEN_CLASS.rowSelectedRule).toContain('var(--border-selected)');
  });

  it('spells every value as a complete class, variant prefix included', () => {
    // Tailwind's content scanner is a regular expression over raw file text. A
    // value assembled as `hover:${TOKEN_CLASS.x}` at a call site would never
    // appear literally in any scanned file, so the class would not be generated
    // and the utility would silently not exist. Baking the variant into the
    // value is what makes that impossible, and this is what stops somebody
    // "tidying" the variants back out to the call sites.
    for (const [role, className] of Object.entries(TOKEN_CLASS)) {
      for (const part of className.split(/\s+/)) {
        expect(part, `${role} has an empty class fragment`).not.toBe('');
        expect(part, `${role} ends in a dangling variant`).not.toMatch(/:$/);
      }
    }
  });

  it('carries no raw palette colour and no dark: variant of its own', () => {
    // This module is the single place a colour class is written in the shell,
    // which makes it the single place a raw one could hide.
    // `src/__tests__/noRawColor.test.ts` scans it along with everything else;
    // this is the local restatement, so a failure points here directly.
    for (const className of Object.values(TOKEN_CLASS)) {
      expect(className).not.toMatch(/\bdark:/);
      expect(className).not.toMatch(/-(?:neutral|gray|slate|zinc|stone)-\d{2,3}\b/);
      expect(className).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
