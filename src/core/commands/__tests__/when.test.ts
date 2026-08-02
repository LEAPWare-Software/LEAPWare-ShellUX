import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ID_PATTERN, RESERVED_IDS } from '../../RegistryContext';
import { ShellUXError } from '../../types';
import type { ContextKeyValue, RibbonContext, ShellUXErrorCode } from '../../types';
import {
  RESERVED_WHEN_KEYS,
  WHEN_COLLECTION_FIELD,
  WHEN_HOST_FIELDS,
  WHEN_KEY_PATTERN,
  WHEN_LIMITS,
  evaluateWhen,
  parseWhen,
} from '../when';
import type { WhenNode } from '../when';

/**
 * ============================================================================
 * WHAT THIS SUITE IS FOR
 * ============================================================================
 * `src/core/commands/when.ts` parses UNTRUSTED plug-in text and evaluates it
 * during the host's render. Two failure modes matter more than correctness of
 * any single operator, and both are asserted here rather than argued in prose:
 * a parser that can be made to recurse without bound, and an evaluator that can
 * be made to throw out of a render.
 *
 * Three habits from `src/core/__tests__/validation.test.ts` are kept
 * deliberately:
 *
 *  - every rejection is asserted by CODE and by FIELD, not by message alone;
 *  - every scan has a CONTROL case proving it is not vacuous — a scan that finds
 *    nothing because it looked at nothing is the defect this repository has
 *    shipped twice;
 *  - a precedence case uses operands for which the two candidate parse trees
 *    actually DISAGREE. `(!a) == b` and `!(a == b)` are the same function of two
 *    booleans, so a boolean-only precedence test proves nothing and survives any
 *    mutation of the parser. The cases below use a string operand for exactly
 *    that reason, and say so.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** A `contextKeys` record shaped the way the store publishes one: null-prototype. */
function keys(entries: Record<string, ContextKeyValue>): Readonly<Record<string, ContextKeyValue>> {
  return Object.assign(Object.create(null) as Record<string, ContextKeyValue>, entries);
}

function makeContext(overrides: Partial<RibbonContext> = {}): RibbonContext {
  return {
    activeExtensionId: null,
    activeNavNodeId: null,
    selectedItemIds: [],
    selectedItemId: null,
    contextKeys: keys({}),
    ...overrides,
  };
}

/** Parse and evaluate in one step, which is what every semantic case below wants. */
function run(source: string, context: RibbonContext): boolean {
  return evaluateWhen(parseWhen(source, 'ribbonActions[0].when'), context);
}

/** Assert that `parseWhen` rejects `source` with a specific code and field. */
function expectRejection(source: unknown, code: ShellUXErrorCode): ShellUXError {
  let caught: unknown;
  try {
    parseWhen(source, 'ribbonActions[0].when');
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShellUXError);
  const error = caught as ShellUXError;
  expect(error.code).toBe(code);
  expect(error.field).toBe('ribbonActions[0].when');
  expect(error.name).toBe('ShellUXError');
  return error;
}

/* -------------------------------------------------------------------------- */
/* parseWhen — the door                                                        */
/* -------------------------------------------------------------------------- */

describe('parseWhen — the expression is a field, and it is validated at its own door', () => {
  it('accepts a well-formed expression and returns a host-owned frozen result', () => {
    const parsed = parseWhen('selectedItemId != null', 'ribbonActions[0].when');
    expect(parsed.source).toBe('selectedItemId != null');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.node)).toBe(true);
  });

  it('carries the caller’s dotted field path onto every rejection it raises', () => {
    for (const source of ['', 'nope', '(', 'a'.repeat(600), 'true =='] as const) {
      let caught: unknown;
      try {
        parseWhen(source, 'ribbonActions[7].when');
      } catch (error) {
        caught = error;
      }
      expect((caught as ShellUXError).field).toBe('ribbonActions[7].when');
    }
  });

  it('reports every rejection as one of exactly two codes', () => {
    // The set is asserted in BOTH directions: no rejection carries a third code,
    // and both codes are really reached — a one-sided assertion would pass if the
    // module had quietly stopped raising PAYLOAD_TOO_LARGE at all.
    const rejected: readonly unknown[] = [
      42,
      null,
      undefined,
      { toString: () => 'true' },
      '',
      '   ',
      '#',
      'unknownThing',
      'contextKeys.constructor',
      'contextKeys.NOPE',
      'true ==',
      'true == false == true',
      "activeNavNodeId < 'x'",
      'selectedItemIds',
      "'unterminated",
      '1.',
      "activeNavNodeId startsWith 5",
      'a'.repeat(WHEN_LIMITS.MAX_LENGTH + 1),
      `!!true${'||true'.repeat(63)}`,
      '('.repeat(WHEN_LIMITS.MAX_DEPTH) + 'true' + ')'.repeat(WHEN_LIMITS.MAX_DEPTH),
    ];

    const codes = new Set<string>();
    for (const source of rejected) {
      let caught: unknown;
      try {
        parseWhen(source, 'ribbonActions[0].when');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ShellUXError);
      codes.add((caught as ShellUXError).code);
    }
    expect([...codes].sort()).toEqual(['INVALID_FIELD', 'PAYLOAD_TOO_LARGE']);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an array', ['true']],
    ['an object with a toString', { toString: () => 'true' }],
  ])('rejects %s rather than stringifying it', (_label, source) => {
    expectRejection(source, 'INVALID_FIELD');
  });

  it('rejects a blank expression, and an expression that is only whitespace', () => {
    expect(expectRejection('', 'INVALID_FIELD').message).toContain('blank');
    expect(expectRejection('   \t\n', 'INVALID_FIELD').message).toContain('blank');
  });
});

/* -------------------------------------------------------------------------- */
/* parseWhen — grammar                                                         */
/* -------------------------------------------------------------------------- */

describe('parseWhen — grammar', () => {
  it.each([
    ['a bare host field', 'activeNavNodeId'],
    ['a bare context key', 'contextKeys.composing'],
    ['a boolean literal', 'true'],
    ['a null comparison', 'selectedItemId != null'],
    ['a string comparison', "activeExtensionId == 'mail'"],
    ['a number comparison', 'contextKeys.unread > 0'],
    ['a negation', '!contextKeys.busy'],
    ['a conjunction', "selectedItemId != null && activeExtensionId == 'mail'"],
    ['a disjunction', 'contextKeys.a || contextKeys.b'],
    ['parentheses', '(contextKeys.a || contextKeys.b) && !contextKeys.c'],
    ['a literal list membership', "activeNavNodeId in ('inbox', 'drafts')"],
    ['a selection membership', "'msg-1' in selectedItemIds"],
    ['a prefix test', "selectedItemId startsWith 'msg-'"],
    ['a negative number', 'contextKeys.delta < -3'],
    ['a decimal number', 'contextKeys.ratio >= 0.5'],
    ['whitespace of every kind', "\t activeNavNodeId \n == \r 'inbox' "],
    ['no whitespace at all', "activeNavNodeId=='inbox'&&!contextKeys.busy"],
  ])('parses %s', (_label, source) => {
    expect(() => parseWhen(source, 'ribbonActions[0].when')).not.toThrow();
  });

  it.each([
    ['a single ampersand', 'true & false'],
    ['a single pipe', 'true | false'],
    ['a single equals', "activeNavNodeId = 'inbox'"],
    ['an unknown character', 'true # false'],
    ['a dollar sign', 'true $ false'],
    ['an unterminated string', "activeNavNodeId == 'inbox"],
    ['a backslash inside a string', "activeNavNodeId == 'in\\box'"],
    ['a decimal point with no digits after it', 'contextKeys.n > 1.'],
    ['a lone minus sign', 'contextKeys.n > -'],
    ['an unclosed parenthesis', '(contextKeys.a'],
    ['an unopened parenthesis', 'contextKeys.a)'],
    ['a dangling operator', 'contextKeys.a &&'],
    ['a dangling comparison', 'contextKeys.a =='],
    ['a dangling negation', '!'],
    ['two operands in a row', "'a' 'b'"],
    ['an empty list', 'activeNavNodeId in ()'],
    ['a reference inside a list', 'activeNavNodeId in (activeExtensionId)'],
    ['a non-literal after startsWith', 'selectedItemId startsWith activeExtensionId'],
    ['a number after startsWith', 'selectedItemId startsWith 5'],
    ['a dot with no key after it', 'contextKeys.'],
    ['a dot onto a non-key', 'contextKeys.5'],
    ['a missing dot', 'contextKeys composing'],
    ['a dotted host field', 'activeNavNodeId.length'],
    ['a list with no closing parenthesis', "activeNavNodeId in ('a'"],
    ['a comma outside a list', "'a', 'b'"],
  ])('refuses %s', (_label, source) => {
    expectRejection(source, 'INVALID_FIELD');
  });

  it('refuses an ordering comparison against a literal that is not a number', () => {
    // Entry-point validation of the kind `EXTENSION_ID_PATTERN` is: a comparison
    // that can never be true is a manifest bug, and its author is better served
    // by a rejection at registration than by an action that silently never
    // appears. Both operand positions are checked.
    expect(expectRejection("activeNavNodeId < 'inbox'", 'INVALID_FIELD').message).toContain(
      'number literal',
    );
    expectRejection("'inbox' >= activeNavNodeId", 'INVALID_FIELD');
    expectRejection('contextKeys.n > null', 'INVALID_FIELD');
    expectRejection('contextKeys.n <= true', 'INVALID_FIELD');
    // The control: a reference operand is left alone, because its type is only
    // known at evaluation time, and two number literals are fine.
    expect(() => parseWhen('contextKeys.n > contextKeys.m', 'w')).not.toThrow();
    expect(() => parseWhen('3 < 4', 'w')).not.toThrow();
  });

  it('refuses a chained comparison rather than left-folding it', () => {
    // JavaScript would read `a == b == c` as `(a == b) == c`, which is almost
    // never what its author meant. The grammar makes `comparison`
    // non-associative so the mistake is a rejection instead of a silent answer.
    expect(expectRejection('1 == 1 == true', 'INVALID_FIELD').message).toContain('do not chain');
    expectRejection('contextKeys.a < 1 < 2', 'INVALID_FIELD');
    // The control: parenthesising one of them is accepted, so the refusal is
    // about chaining and not about the operator appearing twice.
    expect(() => parseWhen('(1 == 1) == true', 'w')).not.toThrow();
  });

  it('produces a deep-frozen parse tree that survives a JSON round trip', () => {
    // This is the property the whole design exists for: `isVisible` is a closure
    // and cannot cross a process boundary, and this tree is plain frozen data
    // that can. A structured clone is what the host will really use; JSON is the
    // stricter test, because it also proves there is nothing in the tree that is
    // not a string, a number, a boolean, a null, an array or a plain object.
    const parsed = parseWhen(
      "selectedItemId startsWith 'msg-' && (contextKeys.unread > 0 || activeNavNodeId in ('inbox', 'drafts')) && !('x' in selectedItemIds)",
      'ribbonActions[0].when',
    );

    const seen: WhenNode[] = [];
    const walk = (node: WhenNode): void => {
      seen.push(node);
      expect(Object.isFrozen(node)).toBe(true);
      if ('operand' in node) {
        walk(node.operand);
      }
      if ('left' in node) {
        walk(node.left);
        walk(node.right);
      }
      if ('values' in node) {
        expect(Object.isFrozen(node.values)).toBe(true);
      }
    };
    walk(parsed.node);

    expect(seen.length).toBeGreaterThan(8);
    expect(JSON.parse(JSON.stringify(parsed.node))).toEqual(parsed.node);
  });

  it('reads a list of one, and a list of several, the same way', () => {
    const context = makeContext({ activeNavNodeId: 'drafts' });
    expect(run("activeNavNodeId in ('drafts')", context)).toBe(true);
    expect(run("activeNavNodeId in ('inbox', 'drafts', 'sent')", context)).toBe(true);
    expect(run("activeNavNodeId in ('inbox', 'sent')", context)).toBe(false);
    expect(run('activeNavNodeId in (1, true, null)', context)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* parseWhen — precedence and associativity                                    */
/* -------------------------------------------------------------------------- */

describe('parseWhen — precedence and associativity', () => {
  it('binds ! tighter than a comparison, which a boolean operand cannot show', () => {
    // `(!a) == b` and `!(a == b)` are the SAME function of two booleans — both
    // are exclusive-or — so a boolean test of this precedence is vacuous and
    // survives any mutation. A string operand separates the two trees:
    //   correct   (!activeNavNodeId) == 'x'  ->  false == 'x'  ->  false
    //   incorrect !(activeNavNodeId == 'x')  ->  !(false)      ->  true
    const context = makeContext({ activeNavNodeId: 'inbox' });
    expect(run("!activeNavNodeId == 'x'", context)).toBe(false);
    expect(run("!(activeNavNodeId == 'x')", context)).toBe(true);
    // And with the key absent, so the negation is true rather than false:
    //   correct   (!absent) == true  ->  true == true  ->  true
    //   incorrect !(absent == true)  ->  !(false)      ->  true   (agrees; not used)
    //   correct   (!absent) == false ->  true == false ->  false
    //   incorrect !(absent == false) ->  !(false)      ->  true
    expect(run('!contextKeys.absent == false', makeContext())).toBe(false);
    expect(run('!(contextKeys.absent == false)', makeContext())).toBe(true);
  });

  it('binds && tighter than ||', () => {
    // The assignment is chosen so the two trees DISAGREE. With a=true, b=true,
    // c=false:  correct  a || (b && c)  -> true
    //           incorrect (a || b) && c -> false
    const first = makeContext({ contextKeys: keys({ a: true, b: true, c: false }) });
    expect(run('contextKeys.a || contextKeys.b && contextKeys.c', first)).toBe(true);
    expect(run('(contextKeys.a || contextKeys.b) && contextKeys.c', first)).toBe(false);

    // And the mirror shape. With a=false, b=true, c=true:
    //           correct  (a && b) || c -> true
    //           incorrect a && (b || c) -> false
    const second = makeContext({ contextKeys: keys({ a: false, b: true, c: true }) });
    expect(run('contextKeys.a && contextKeys.b || contextKeys.c', second)).toBe(true);
    expect(run('contextKeys.a && (contextKeys.b || contextKeys.c)', second)).toBe(false);
  });

  it('parses a repeated || and a repeated && left-associatively, which only the tree can show', () => {
    // Boolean `||` and `&&` are associative, so NO context can distinguish
    // `or(or(a,b),c)` from `or(a,or(b,c))` by its answer. Asserting the shape is
    // the only non-vacuous way to state the associativity, so that is what this
    // does — and it is the reason this case reads the tree where every other
    // case in this file reads a boolean.
    const disjunction = parseWhen('contextKeys.a || contextKeys.b || contextKeys.c', 'w').node;
    expect(disjunction.kind).toBe('or');
    expect('left' in disjunction && disjunction.left.kind).toBe('or');
    expect('right' in disjunction && disjunction.right.kind).toBe('contextKey');

    const conjunction = parseWhen('contextKeys.a && contextKeys.b && contextKeys.c', 'w').node;
    expect(conjunction.kind).toBe('and');
    expect('left' in conjunction && conjunction.left.kind).toBe('and');
    expect('right' in conjunction && conjunction.right.kind).toBe('contextKey');
  });

  it('lets parentheses override every precedence rule', () => {
    const context = makeContext({ contextKeys: keys({ a: false, b: false }) });
    expect(run('!contextKeys.a && contextKeys.b', context)).toBe(false);
    expect(run('!(contextKeys.a && contextKeys.b)', context)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* parseWhen — bounds                                                          */
/* -------------------------------------------------------------------------- */

describe('parseWhen — bounds', () => {
  it('rejects a source longer than the length bound', () => {
    // A long STRING LITERAL rather than a long expression, so that this case
    // tests the length bound alone: the same source is one token and nests one
    // level, so neither of the other two bounds can be what rejected it.
    const atBound = `'${'a'.repeat(WHEN_LIMITS.MAX_LENGTH - 2)}'`;
    expect(atBound).toHaveLength(WHEN_LIMITS.MAX_LENGTH);
    expect(() => parseWhen(atBound, 'w')).not.toThrow();

    const overBound = `'${'a'.repeat(WHEN_LIMITS.MAX_LENGTH - 1)}'`;
    expect(overBound).toHaveLength(WHEN_LIMITS.MAX_LENGTH + 1);
    expect(expectRejection(overBound, 'PAYLOAD_TOO_LARGE').message).toContain('maximum length');
  });

  it('checks the length bound before it scans a single character', () => {
    // 600 characters the tokenizer does not know. If the scan ran first this
    // would be INVALID_FIELD, and the host would have walked 600 characters of
    // hostile input to decide something it could have decided from `.length`.
    expectRejection('#'.repeat(600), 'PAYLOAD_TOO_LARGE');
    // The control: the same character, inside the bound, IS a scan failure — so
    // the case above is about ordering and not about `#` being special.
    expectRejection('#'.repeat(10), 'INVALID_FIELD');
  });

  it('rejects a token stream longer than the token bound', () => {
    // 2N+1 tokens for `true` followed by N repetitions of `||true`, plus one per
    // leading `!`. All three sources are well inside the length bound and nest
    // at most three deep, so the token bound is the only thing that can reject.
    const tail = '||true'.repeat(63);
    expect(() => parseWhen(`true${tail}`, 'w')).not.toThrow();
    expect(() => parseWhen(`!true${tail}`, 'w')).not.toThrow();
    expect(expectRejection(`!!true${tail}`, 'PAYLOAD_TOO_LARGE').message).toContain('tokens');
    expect(`!!true${tail}`.length).toBeLessThan(WHEN_LIMITS.MAX_LENGTH);
  });

  it('rejects nesting deeper than the depth bound', () => {
    // The depth guard runs BEFORE the recursive call. Drop it and this input is
    // not a rejection but a `RangeError` from a blown stack — which is why the
    // depth bound is far below the token bound rather than implied by it: this
    // source is 34 tokens.
    const atBound = `${'('.repeat(WHEN_LIMITS.MAX_DEPTH - 1)}true${')'.repeat(WHEN_LIMITS.MAX_DEPTH - 1)}`;
    expect(() => parseWhen(atBound, 'w')).not.toThrow();

    const overBound = `${'('.repeat(WHEN_LIMITS.MAX_DEPTH)}true${')'.repeat(WHEN_LIMITS.MAX_DEPTH)}`;
    expect(overBound.length).toBeLessThan(WHEN_LIMITS.MAX_LENGTH);
    expect(expectRejection(overBound, 'PAYLOAD_TOO_LARGE').message).toContain('nests deeper');
  });

  it('rejects a run of ! deeper than the depth bound', () => {
    // The second recursion site, and it is not the same one: `(` recurses
    // through `parseOr` and `!` recurses through `parseUnary`. A depth guard on
    // only one of them leaves the other unbounded.
    expect(() => parseWhen(`${'!'.repeat(WHEN_LIMITS.MAX_DEPTH - 1)}true`, 'w')).not.toThrow();
    expect(
      expectRejection(`${'!'.repeat(WHEN_LIMITS.MAX_DEPTH)}true`, 'PAYLOAD_TOO_LARGE').message,
    ).toContain('nests deeper');
  });

  it('does not leak parse depth across sibling subexpressions', () => {
    // Depth is a measure of NESTING, not of size: a long chain of shallow
    // parenthesised terms must not accumulate depth and be refused. If `ascend`
    // were dropped this would be rejected.
    const wide = Array.from({ length: 30 }, () => '(true)').join('||');
    expect(wide.length).toBeLessThan(WHEN_LIMITS.MAX_LENGTH);
    expect(() => parseWhen(wide, 'w')).not.toThrow();
  });

  it('freezes its limits against replacement', () => {
    expect(Object.isFrozen(WHEN_LIMITS)).toBe(true);
    expect(() => {
      (WHEN_LIMITS as unknown as Record<string, number>)['MAX_DEPTH'] = 1e9;
    }).toThrow(TypeError);
    expect(WHEN_LIMITS.MAX_DEPTH).toBe(16);
  });
});

/* -------------------------------------------------------------------------- */
/* parseWhen — identifier hardening                                            */
/* -------------------------------------------------------------------------- */

describe('parseWhen — identifier hardening', () => {
  it('refuses an identifier that is not a host field, a collection or a context key', () => {
    // The reference set is an ALLOWLIST, so there is no property path an
    // expression can walk. `focusedPane` is in the table on purpose: ADR-0001
    // Amendment K Decision 6 removed the field, and a language that still named
    // it would be offering a predicate that can never fire.
    for (const source of [
      'window',
      'globalThis',
      'process',
      'focusedPane',
      'contextkeys.a',
      'ContextKeys.a',
      'selectedItemID',
      'shell',
      '_private',
    ]) {
      expect(expectRejection(source, 'INVALID_FIELD').message).toContain('not a context reference');
    }
    // The control: every name the allowlist DOES publish parses, so the refusals
    // above are about the allowlist and not about the parser refusing words.
    for (const field of WHEN_HOST_FIELDS) {
      expect(() => parseWhen(field, 'w')).not.toThrow();
    }
  });

  it('refuses the three prototype keys as context-key names, and says why', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const error = expectRejection(`contextKeys.${name}`, 'INVALID_FIELD');
      expect(error.message).toContain('reserved');
      expect(error.message).toContain(name);
    }
    // The whole word reaches the reserved check rather than coming apart at the
    // first underscore, which is what makes the message name the real reason.
    expect(expectRejection('contextKeys.__proto__', 'INVALID_FIELD').message).not.toContain(
      'unexpected character',
    );
  });

  it('accepts an ordinary context-key name in the same position', () => {
    // The control for the case above. Without it, a parser that rejected EVERY
    // dotted name would pass the prototype-key test vacuously.
    for (const name of ['composing', 'message-loaded', 'a', 'k9', `a${'b'.repeat(63)}`]) {
      expect(() => parseWhen(`contextKeys.${name}`, 'w')).not.toThrow();
    }
    expect(run('contextKeys.composing', makeContext({ contextKeys: keys({ composing: true }) }))).toBe(
      true,
    );
  });

  it('refuses a context-key name that fails the identifier pattern', () => {
    for (const name of ['Composing', 'a'.repeat(65), '-leading', '_leading', 'k_9']) {
      const error = expectRejection(`contextKeys.${name}`, 'INVALID_FIELD');
      expect(error.message).toContain('not a valid context-key name');
    }
  });

  it("uses exactly the registry's identifier rule for a context-key name", () => {
    // A COPY of `EXTENSION_ID_PATTERN`, not an import of it: `when.ts` has to be
    // loadable in a host process and `RegistryContext.tsx` is a React module.
    // The copy is held to the original in both directions here, so a divergence
    // is a failing test rather than a silent second standard.
    expect(WHEN_KEY_PATTERN.source).toBe(EXTENSION_ID_PATTERN.source);
    expect(WHEN_KEY_PATTERN.flags).toBe(EXTENSION_ID_PATTERN.flags);
    expect([...RESERVED_WHEN_KEYS].sort()).toEqual([...RESERVED_IDS].sort());
    expect(Object.isFrozen(WHEN_KEY_PATTERN)).toBe(true);
    expect(Object.isFrozen(RESERVED_WHEN_KEYS)).toBe(true);
  });

  it("is narrower than the registry's rule in exactly one lexical case: a name that starts with a digit", () => {
    // The case above compares the PATTERNS and would let this pass unnoticed,
    // which is the whole reason it is written separately. `EXTENSION_ID_PATTERN`
    // admits a leading digit, so `shell.setContextKey('9lives', true)` is a legal
    // call — but the tokenizer's number branch runs before its word branch, so a
    // name starting with a digit lexes as a number literal and never reaches the
    // key check. Such a key is settable and unnameable. It is recorded rather
    // than fixed: reordering the branches would make `-3` ambiguous, and the
    // remedy an author has is to name the key so it starts with a letter.
    for (const name of ['9lives', '42', '0']) {
      expect(EXTENSION_ID_PATTERN.test(name)).toBe(true);
      expect(expectRejection(`contextKeys.${name}`, 'INVALID_FIELD').message).toContain(
        'context-key name after',
      );
    }
    // The control, in both directions: a digit anywhere but the first character
    // is fine, so this is a statement about the leading digit and not about
    // digits.
    for (const name of ['k9', 'a0b', 'x-9']) {
      expect(EXTENSION_ID_PATTERN.test(name)).toBe(true);
      expect(() => parseWhen(`contextKeys.${name}`, 'w')).not.toThrow();
    }
  });

  it('refuses selectedItemIds anywhere but after in', () => {
    // An array is always truthy, so a bare `selectedItemIds` would read as
    // "something is selected" and mean "always" — the exact shape of predicate
    // ADR-0001 Amendment K Decision 6 deleted `focusedPane` to avoid.
    for (const source of [
      WHEN_COLLECTION_FIELD,
      `!${WHEN_COLLECTION_FIELD}`,
      `${WHEN_COLLECTION_FIELD} == null`,
      `${WHEN_COLLECTION_FIELD} && true`,
    ]) {
      expect(expectRejection(source, 'INVALID_FIELD').message).toContain('may only follow');
    }
    // Parenthesised, it reaches the literal-list parser instead and is refused
    // there — a different message for a different route, and the same code.
    expect(
      expectRejection(`'x' in (${WHEN_COLLECTION_FIELD})`, 'INVALID_FIELD').message,
    ).toContain('expected a literal');
    // The control: it IS accepted in the one position it is for.
    expect(() => parseWhen(`'x' in ${WHEN_COLLECTION_FIELD}`, 'w')).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* evaluateWhen — semantics                                                    */
/* -------------------------------------------------------------------------- */

describe('evaluateWhen — truthiness, equality and ordering', () => {
  it.each([
    ['a true boolean', true, true],
    ['a false boolean', false, false],
    ['null', null, false],
    ['a non-empty string', 'x', true],
    ['an empty string', '', false],
    ['a non-zero number', 3, true],
    ['zero', 0, false],
    ['a negative number', -1, true],
  ])('reads %s as its truthiness when a key is named bare', (_label, value, expected) => {
    expect(run('contextKeys.k', makeContext({ contextKeys: keys({ k: value }) }))).toBe(expected);
  });

  it('treats a missing context key as undefined rather than as an error', () => {
    const context = makeContext({ contextKeys: keys({ present: 'yes' }) });
    expect(run('contextKeys.absent', context)).toBe(false);
    expect(run('!contextKeys.absent', context)).toBe(true);
    // A missing key is `undefined`, and `undefined` is NOT `null`. That is the
    // sharp edge of strict equality and is documented rather than smoothed over:
    // ask "unset or falsy" with `!key`, not with `== null`.
    expect(run('contextKeys.absent == null', context)).toBe(false);
    expect(run('contextKeys.absent != null', context)).toBe(true);
    // The control: a key that IS present and holds null compares equal to null.
    expect(run('contextKeys.k == null', makeContext({ contextKeys: keys({ k: null }) }))).toBe(true);
  });

  it('compares with no coercion in any direction', () => {
    const context = makeContext({
      contextKeys: keys({ n: 3, s: '3', t: true, blank: '', zero: 0 }),
    });
    expect(run('contextKeys.n == 3', context)).toBe(true);
    expect(run("contextKeys.n == '3'", context)).toBe(false);
    expect(run("contextKeys.s == '3'", context)).toBe(true);
    expect(run('contextKeys.t == true', context)).toBe(true);
    expect(run('contextKeys.t == 1', context)).toBe(false);
    expect(run('contextKeys.blank == null', context)).toBe(false);
    expect(run('contextKeys.zero == false', context)).toBe(false);
    expect(run('contextKeys.n != 4', context)).toBe(true);
    expect(run('contextKeys.n != 3', context)).toBe(false);
  });

  it.each([
    ['less than, below', 'contextKeys.n < 5', 3, true],
    ['less than, above', 'contextKeys.n < 5', 7, false],
    ['less than, equal', 'contextKeys.n < 5', 5, false],
    ['at most, equal', 'contextKeys.n <= 5', 5, true],
    ['at most, above', 'contextKeys.n <= 5', 6, false],
    ['greater than, above', 'contextKeys.n > 5', 6, true],
    ['greater than, equal', 'contextKeys.n > 5', 5, false],
    ['at least, equal', 'contextKeys.n >= 5', 5, true],
    ['at least, below', 'contextKeys.n >= 5', 4, false],
    ['a reversed operand order', '5 < contextKeys.n', 6, true],
    ['a negative bound', 'contextKeys.n > -2', -1, true],
    ['a decimal bound', 'contextKeys.n >= 0.5', 0.5, true],
  ])('orders %s', (_label, source, value, expected) => {
    expect(run(source, makeContext({ contextKeys: keys({ n: value }) }))).toBe(expected);
  });

  it.each([
    ['a string', 'x'],
    ['a boolean', true],
    ['null', null],
  ])('answers false for an ordering comparison against %s', (_label, value) => {
    const context = makeContext({ contextKeys: keys({ n: value }) });
    // Total, not throwing — and BOTH directions of the "either side is not a
    // number" guard are exercised, because the operand is on the left in one
    // and on the right in the other.
    expect(run('contextKeys.n < 5', context)).toBe(false);
    expect(run('5 < contextKeys.n', context)).toBe(false);
    // The consequence, stated rather than hidden: `!(a > b)` is NOT `a <= b`
    // when `a` is not a number, because both comparisons are false.
    expect(run('!(contextKeys.n > 5)', context)).toBe(true);
    expect(run('contextKeys.n <= 5', context)).toBe(false);
  });

  it('answers false for an ordering comparison against a missing key', () => {
    expect(run('contextKeys.absent > 0', makeContext())).toBe(false);
    expect(run('contextKeys.absent < 0', makeContext())).toBe(false);
  });
});

describe('evaluateWhen — membership and prefixes', () => {
  it('reads a literal list as a set membership over any primitive', () => {
    expect(run("activeNavNodeId in ('inbox')", makeContext({ activeNavNodeId: 'inbox' }))).toBe(true);
    expect(run("activeNavNodeId in ('inbox')", makeContext({ activeNavNodeId: 'sent' }))).toBe(false);
    expect(run("activeNavNodeId in ('inbox')", makeContext())).toBe(false);
    const numeric = makeContext({ contextKeys: keys({ n: 2 }) });
    expect(run('contextKeys.n in (1, 2, 3)', numeric)).toBe(true);
    expect(run('contextKeys.n in (4, 5)', numeric)).toBe(false);
    expect(run("contextKeys.n in ('2')", numeric)).toBe(false);
    expect(run('contextKeys.k in (null)', makeContext({ contextKeys: keys({ k: null }) }))).toBe(
      true,
    );
    expect(run('contextKeys.k in (true)', makeContext({ contextKeys: keys({ k: true }) }))).toBe(
      true,
    );
  });

  it('reads the selection collection as a membership over selectedItemIds', () => {
    const context = makeContext({
      selectedItemIds: ['msg-1', 'msg-2'],
      selectedItemId: 'msg-2',
    });
    expect(run("'msg-1' in selectedItemIds", context)).toBe(true);
    expect(run("'msg-9' in selectedItemIds", context)).toBe(false);
    expect(run('selectedItemId in selectedItemIds', context)).toBe(true);
    expect(run('1 in selectedItemIds', context)).toBe(false);
    expect(run("'msg-1' in selectedItemIds", makeContext())).toBe(false);
  });

  it('matches a prefix only against a string, and only from the start', () => {
    expect(run("selectedItemId startsWith 'msg-'", makeContext({ selectedItemId: 'msg-1' }))).toBe(
      true,
    );
    expect(run("selectedItemId startsWith 'msg-'", makeContext({ selectedItemId: 'rec-1' }))).toBe(
      false,
    );
    expect(run("selectedItemId startsWith 'msg-'", makeContext({ selectedItemId: 'x-msg-1' }))).toBe(
      false,
    );
    // Not a string, and missing entirely: false rather than a throw.
    expect(run("selectedItemId startsWith 'msg-'", makeContext())).toBe(false);
    expect(run("contextKeys.n startsWith 'm'", makeContext({ contextKeys: keys({ n: 7 }) }))).toBe(
      false,
    );
    // The empty prefix is the degenerate case and is answered, not special-cased.
    expect(run("selectedItemId startsWith ''", makeContext({ selectedItemId: 'x' }))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* evaluateWhen — totality                                                     */
/* -------------------------------------------------------------------------- */

/** Every node kind the parser can build, so a totality sweep covers the evaluator. */
const EVERY_NODE_KIND: readonly string[] = [
  'true',
  'false',
  'null',
  "'text'",
  '42',
  'activeExtensionId',
  'activeNavNodeId',
  'selectedItemId',
  'contextKeys.k',
  '!contextKeys.k',
  'contextKeys.k && activeNavNodeId',
  'contextKeys.k || activeNavNodeId',
  "activeNavNodeId == 'inbox'",
  'contextKeys.k != null',
  'contextKeys.k > 1',
  'contextKeys.k <= 1',
  "activeNavNodeId in ('inbox', 'drafts')",
  "'msg-1' in selectedItemIds",
  "selectedItemId startsWith 'msg-'",
  "(contextKeys.k || !activeNavNodeId) && selectedItemId startsWith 'msg-'",
];

/** Contexts a well-behaved host would never build, and a hostile page might. */
function hostileContexts(): readonly { readonly label: string; readonly context: RibbonContext }[] {
  const throwing = {
    get activeExtensionId(): string {
      throw new Error('activeExtensionId detonated');
    },
    get activeNavNodeId(): string {
      throw new Error('activeNavNodeId detonated');
    },
    get selectedItemId(): string {
      throw new Error('selectedItemId detonated');
    },
    get selectedItemIds(): readonly string[] {
      throw new Error('selectedItemIds detonated');
    },
    get contextKeys(): Readonly<Record<string, ContextKeyValue>> {
      throw new Error('contextKeys detonated');
    },
  };

  const trapping = makeContext({
    contextKeys: new Proxy(keys({}), {
      get(): never {
        throw new Error('the context-key trap detonated');
      },
    }),
  });

  return [
    { label: 'a context whose every field throws', context: throwing as RibbonContext },
    { label: 'a context-keys record whose get trap throws', context: trapping },
    { label: 'an empty object', context: {} as RibbonContext },
    { label: 'a frozen empty object', context: Object.freeze({}) as RibbonContext },
    {
      label: 'a context whose fields are the wrong types',
      context: {
        activeExtensionId: 7,
        activeNavNodeId: {},
        selectedItemIds: 'not-an-array',
        selectedItemId: [],
        contextKeys: 'also-not-a-record',
      } as unknown as RibbonContext,
    },
    {
      label: 'a context-keys record holding values the API would refuse',
      context: makeContext({
        contextKeys: keys({ k: Number.NaN, j: Number.POSITIVE_INFINITY }) as Readonly<
          Record<string, ContextKeyValue>
        >,
      }),
    },
    {
      label: 'a selection whose some() throws',
      context: makeContext({
        selectedItemIds: Object.assign([], {
          some: (): never => {
            throw new Error('the selection detonated');
          },
        }) as unknown as readonly string[],
      }),
    },
  ];
}

describe('evaluateWhen — totality against an adversarial context', () => {
  it('returns false rather than throwing when the context throws while it is read', () => {
    const expression = parseWhen('contextKeys.k', 'w');
    const context = {
      get contextKeys(): never {
        throw new Error('contextKeys detonated');
      },
    } as unknown as RibbonContext;
    expect(() => evaluateWhen(expression, context)).not.toThrow();
    expect(evaluateWhen(expression, context)).toBe(false);
    // The stated cost of ONE outer guard rather than a guard per read: a throw
    // that is actually reached collapses the whole expression, even where the
    // other operand of `||` would have made it true. The safe direction is the
    // one that hides the action.
    expect(evaluateWhen(parseWhen('contextKeys.k || true', 'w'), context)).toBe(false);
  });

  it('short-circuits && and ||, which a throwing context makes observable', () => {
    // Short-circuiting is invisible in a pure language — no side effect, no way
    // to tell. A context that detonates when it is read is the observation: if
    // the skipped operand were evaluated, the outer guard would swallow the
    // throw and the answer would flip to false.
    const context = {
      get contextKeys(): never {
        throw new Error('contextKeys detonated');
      },
    } as unknown as RibbonContext;
    expect(evaluateWhen(parseWhen('true || contextKeys.k', 'w'), context)).toBe(true);
    expect(evaluateWhen(parseWhen('false && contextKeys.k', 'w'), context)).toBe(false);
    // The control, proving the operand really is a detonator and not merely
    // absent: reached rather than skipped, it takes the whole expression down.
    expect(evaluateWhen(parseWhen('true && contextKeys.k', 'w'), context)).toBe(false);
    expect(evaluateWhen(parseWhen('false || contextKeys.k', 'w'), context)).toBe(false);
  });

  it('returns a boolean for every parsed expression against a hostile context', () => {
    for (const { context } of hostileContexts()) {
      for (const source of EVERY_NODE_KIND) {
        const expression = parseWhen(source, 'w');
        let result: unknown;
        expect(() => {
          result = evaluateWhen(expression, context);
        }).not.toThrow();
        expect(typeof result).toBe('boolean');
      }
    }
  });

  it('answers both true and false over an ordinary context, so the sweep is not vacuous', () => {
    // The control for the case above. A `evaluateWhen` that had been mutated to
    // `return false` would satisfy every assertion in the sweep; it fails here.
    const context = makeContext({
      activeExtensionId: 'mail',
      activeNavNodeId: 'inbox',
      selectedItemIds: ['msg-1'],
      selectedItemId: 'msg-1',
      contextKeys: keys({ k: 5 }),
    });
    const answers = EVERY_NODE_KIND.map((source) => evaluateWhen(parseWhen(source, 'w'), context));
    expect(answers).toContain(true);
    expect(answers).toContain(false);
  });

  it('is not fooled into reading a prototype value by a context-keys record that has one', () => {
    // `contextKeys` is built on `Object.create(null)` by the store, so this
    // cannot arise through the documented route. A caller is plain JavaScript,
    // so it is asserted anyway: the parser refuses the three names outright, and
    // an inherited ORDINARY name is read, because a record with a prototype is
    // the caller's problem and not a hole this module can close.
    expectRejection('contextKeys.constructor', 'INVALID_FIELD');
    const inherited = Object.create({ inherited: 'from-the-prototype' }) as Record<
      string,
      ContextKeyValue
    >;
    expect(run('contextKeys.inherited', makeContext({ contextKeys: inherited }))).toBe(true);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

/* -------------------------------------------------------------------------- */
/* The source scan                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Names that would mean this module builds or runs code it was handed.
 *
 * Exact spellings rather than substrings, so `startsWith` is not swept up by a
 * pattern looking for `require`. `constructor`, `prototype` and `__proto__` are
 * on the list because `({}).constructor.constructor('…')()` is `new Function`
 * reached by another road, and the module's own reserved-name data is the only
 * place they are allowed to appear — asserted separately and exactly.
 */
const DYNAMIC_CODE_SINK =
  /^(?:eval|Function|GeneratorFunction|AsyncFunction|RegExp|require|setTimeout|setInterval|setImmediate|execScript|constructor|prototype|__proto__)$/;

/** The three that ARE expected, as string data, exactly once each. */
const RESERVED_NAME_DATA = ['__proto__', 'constructor', 'prototype'];

interface Finding {
  readonly kind: 'identifier' | 'string' | 'dynamic-import';
  readonly word: string;
}

/**
 * Every code word in one module, by position.
 *
 * Identifiers and string literals are separated because the module legitimately
 * carries three of the forbidden spellings AS DATA and none of them as code — a
 * scan that could not tell the two apart would have to be weakened until it said
 * nothing. Comments reach neither bucket: the TypeScript parser keeps them as
 * trivia, which is what lets `when.ts`'s docblock state this property in words.
 */
function scan(file: string, text: string): Finding[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const findings: Finding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      findings.push({ kind: 'dynamic-import', word: 'import()' });
    }
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (DYNAMIC_CODE_SINK.test(node.text)) {
        findings.push({ kind: 'identifier', word: node.text });
      }
    } else if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (DYNAMIC_CODE_SINK.test(node.text)) {
        findings.push({ kind: 'string', word: node.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/** Every code word in one module, regardless of what it spells. */
function countCodeWords(file: string, text: string): number {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let total = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      total += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return total;
}

const WHEN_MODULE_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), 'when.ts');

describe('when.ts — the module contains no dynamic-code sink', () => {
  it('reads a module with code in it, so an empty scan cannot pass vacuously', () => {
    // The failure this guards against is the one that makes a source scan
    // worthless: a moved file, a swallowed read error, a parser handed the wrong
    // script kind — any of which reports zero findings and looks like a pass.
    const text = readFileSync(WHEN_MODULE_PATH, 'utf8');
    expect(text.length).toBeGreaterThan(5000);
    expect(countCodeWords('when.ts', text)).toBeGreaterThan(200);
  });

  it('names no dynamic-code sink in any code position', () => {
    const findings = scan('when.ts', readFileSync(WHEN_MODULE_PATH, 'utf8'));
    expect(findings.filter((finding) => finding.kind === 'identifier')).toEqual([]);
    expect(findings.filter((finding) => finding.kind === 'dynamic-import')).toEqual([]);
  });

  it('spells the three prototype keys only as the reserved-name data they are', () => {
    // Exact in BOTH directions. A spelling that appears twice is a second site
    // nobody reviewed, and a spelling that stops appearing means the reserved
    // list has lost a member — which is the failure the list exists to prevent.
    const findings = scan('when.ts', readFileSync(WHEN_MODULE_PATH, 'utf8'));
    expect(findings.map((finding) => finding.word).sort()).toEqual([...RESERVED_NAME_DATA].sort());
    expect(findings.every((finding) => finding.kind === 'string')).toBe(true);
  });

  it('reports a planted sink, however it is spelled', () => {
    const planted: readonly [string, string][] = [
      ['direct.ts', 'export const go = (s: string) => eval(s);\n'],
      ['constructed.ts', 'export const go = (s: string) => new Function(s)();\n'],
      ['indirect.ts', 'export const go = (s: string) => globalThis["eval"](s);\n'],
      ['viaConstructor.ts', 'export const go = (s: string) => ({}).constructor.constructor(s)();\n'],
      ['viaProto.ts', 'export const go = (o: object) => (o as never)["__proto__"];\n'],
      ['viaRegExp.ts', 'export const go = (p: string) => new RegExp(p).test("x");\n'],
      ['viaTimer.ts', 'export const go = (s: string) => setTimeout(s as never, 0);\n'],
      ['viaImport.ts', 'export const go = async (m: string) => await import(m);\n'],
      ['viaTemplate.ts', 'export const go = (s: string) => globalThis[`eval`](s);\n'],
    ];
    for (const [file, source] of planted) {
      expect(scan(file, source).length).toBeGreaterThan(0);
    }
  });

  it('does not report a sink named only in a comment, which is why the docblock may state the claim', () => {
    const prose =
      '/**\n' +
      ' * There is no eval here, no new Function, no RegExp built from plug-in text,\n' +
      ' * and no constructor or prototype access of any kind.\n' +
      ' */\n' +
      '// Not here either: setTimeout("code", 0).\n' +
      'export const buildsNothing = true;\n';
    expect(scan('prose.ts', prose)).toEqual([]);
  });

  it('does not report an ordinary identifier that merely contains a sink spelling', () => {
    // The pattern is anchored, so `startsWith` is not `require` and
    // `functionOfContext` is not `Function`. Without the anchors this scan would
    // report the module's own operator and have to be weakened.
    const ordinary =
      'export const startsWithPrefix = true;\n' +
      'export const functionOfContext = 1;\n' +
      'export const prototypical = "prototypical";\n' +
      'export const evaluate = () => 1;\n';
    expect(scan('ordinary.ts', ordinary)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The mocks' own predicates                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The category ids `DatabasePlugin.tsx` builds `CATEGORY_IDS` and
 * `LEAF_CATEGORIES` from, transcribed so the comparison below is against the
 * real vocabulary rather than an invented one.
 */
const TOP_LEVEL_CATEGORY_IDS = ['components', 'assemblies', 'consumables'];
const LEAF_CATEGORY_IDS = [
  'fasteners',
  'connectors',
  'sensors',
  'pumps',
  'valves',
  'lubricants',
  'abrasives',
];
const ALL_CATEGORY_IDS = [...TOP_LEVEL_CATEGORY_IDS, ...LEAF_CATEGORY_IDS];

/** The contexts the comparison is made over. Every field the mocks read varies. */
function predicateContexts(): readonly RibbonContext[] {
  const navNodes = [null, 'inbox', 'drafts', 'archive-2026', ...ALL_CATEGORY_IDS, 'not-ours'];
  const selections = [null, 'msg-1001', 'rec-fasteners-001', 'something-else', ''];
  const contexts: RibbonContext[] = [];
  for (const activeNavNodeId of navNodes) {
    for (const selectedItemId of selections) {
      contexts.push(
        makeContext({
          activeNavNodeId,
          selectedItemId,
          selectedItemIds: selectedItemId === null ? [] : [selectedItemId],
        }),
      );
    }
  }
  return contexts;
}

/** `ownSelection(ctx) !== null` as `MailPlugin.tsx:556-559` writes it. */
function mailOwnSelection(context: RibbonContext): boolean {
  const selected = context.selectedItemId;
  return selected !== null && selected.startsWith('msg-');
}

/** `ownCategory(ctx)` as `DatabasePlugin.tsx:530-533` writes it. */
function databaseOwnCategory(context: RibbonContext): string | null {
  const nodeId = context.activeNavNodeId;
  return nodeId !== null && ALL_CATEGORY_IDS.includes(nodeId) ? nodeId : null;
}

describe('when — the mock plug-ins’ predicates, expressed', () => {
  it('expresses every ribbon predicate in MailPlugin', () => {
    // Five actions. `compose` is unconditional; the other four share one
    // predicate — a selection that belongs to this extension.
    const cases: readonly [string, string, (context: RibbonContext) => boolean][] = [
      ['compose', 'true', () => true],
      ['reply', "selectedItemId startsWith 'msg-'", mailOwnSelection],
      ['forward', "selectedItemId startsWith 'msg-'", mailOwnSelection],
      ['mark-read', "selectedItemId startsWith 'msg-'", mailOwnSelection],
      ['delete-message', "selectedItemId startsWith 'msg-'", mailOwnSelection],
    ];
    for (const [, source, reference] of cases) {
      const expression = parseWhen(source, 'w');
      for (const context of predicateContexts()) {
        expect(evaluateWhen(expression, context)).toBe(reference(context));
      }
    }
    // The control: the reference closures really do disagree across the corpus,
    // so agreement above is evidence rather than two constants matching.
    const answers = predicateContexts().map(mailOwnSelection);
    expect(answers).toContain(true);
    expect(answers).toContain(false);
  });

  it('expresses every ribbon predicate in DatabasePlugin', () => {
    // Six actions. Four are unconditional. `add-record` asks for a LEAF category
    // and `audit-category` for any category — and `add-record`'s conjunction
    // collapses, because `LEAF_CATEGORIES` ids are a subset of `CATEGORY_IDS`,
    // so `ownCategory(ctx) !== null && isLeafCategory(...)` is just the leaf test.
    const leafList = LEAF_CATEGORY_IDS.map((id) => `'${id}'`).join(', ');
    const allList = ALL_CATEGORY_IDS.map((id) => `'${id}'`).join(', ');

    const addRecord = parseWhen(`activeNavNodeId in (${leafList})`, 'w');
    const auditCategory = parseWhen(`activeNavNodeId in (${allList})`, 'w');
    const unconditional = parseWhen('true', 'w');

    for (const context of predicateContexts()) {
      const category = databaseOwnCategory(context);
      expect(evaluateWhen(addRecord, context)).toBe(
        category !== null && LEAF_CATEGORY_IDS.includes(category),
      );
      expect(evaluateWhen(auditCategory, context)).toBe(category !== null);
      expect(evaluateWhen(unconditional, context)).toBe(true);
    }

    // Both real expressions fit inside every bound with room to spare, which is
    // the check that makes the bounds a design choice rather than a guess.
    for (const source of [addRecord.source, auditCategory.source]) {
      expect(source.length).toBeLessThan(WHEN_LIMITS.MAX_LENGTH);
      expect(() => parseWhen(source, 'w')).not.toThrow();
    }

    // The control, in both directions: the two expressions are not the same
    // predicate, and neither is constant.
    const differ = predicateContexts().some(
      (context) => evaluateWhen(addRecord, context) !== evaluateWhen(auditCategory, context),
    );
    expect(differ).toBe(true);
  });

  it('expresses the selection-shaped predicates a context key would express better', () => {
    // The honest alternative to spelling a plug-in's own id vocabulary into the
    // manifest: publish the fact and read it. `contextKeys.category-kind ==
    // 'leaf'` is what ADR-0001 Amendment K Decision 2 is for, and it is what a
    // plug-in should reach for when its vocabulary changes more often than its
    // manifest does.
    const expression = parseWhen("contextKeys.category-kind == 'leaf'", 'w');
    expect(
      evaluateWhen(expression, makeContext({ contextKeys: keys({ 'category-kind': 'leaf' }) })),
    ).toBe(true);
    expect(
      evaluateWhen(expression, makeContext({ contextKeys: keys({ 'category-kind': 'branch' }) })),
    ).toBe(false);
    expect(evaluateWhen(expression, makeContext())).toBe(false);
  });
});
