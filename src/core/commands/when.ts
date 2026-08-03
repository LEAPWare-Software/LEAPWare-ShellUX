import type { ContextKeyValue, RibbonContext } from '../types';
import { ShellUXError } from '../types';

/**
 * ============================================================================
 * `when` — A DECLARATIVE, SERIALIZABLE VISIBILITY EXPRESSION OVER `RibbonContext`
 * ============================================================================
 * `RibbonAction.isVisible` is a synchronous render-phase boolean, so it cannot
 * cross a process boundary — ADR-0001 and `docs/plans/native-host-pivot.md` §3.5
 * both say so. Three of the four command surfaces in the native host are host
 * chrome deciding visibility for commands whose code lives somewhere else. A
 * closure cannot be sent; a string can. This module is the string's parser and
 * its evaluator, and it is the same move VS Code made — `types.ts:180` already
 * names that prior art for context keys, and this is the other half of it.
 *
 * `ContextKeyValue = string | number | boolean | null` is what makes the whole
 * thing viable. ADR-0001 Amendment K Decision 2 chose primitives for
 * render-phase-getter reasons; the payoff collected here is that every value a
 * predicate can read is comparable with `===` and survives a structured clone.
 *
 * ---------------------------------------------------------------------------
 * THE GRAMMAR, IN FULL
 * ---------------------------------------------------------------------------
 *   when        := orExpr END
 *   orExpr      := andExpr ( '||' andExpr )*
 *   andExpr     := comparison ( '&&' comparison )*
 *   comparison  := unary [ compareOp unary
 *                        | 'in' collection
 *                        | 'startsWith' string ]
 *   unary       := '!' unary | operand
 *   operand     := '(' orExpr ')' | reference | literal
 *   compareOp   := '==' | '!=' | '<' | '<=' | '>' | '>='
 *   collection  := 'selectedItemIds' | '(' literal ( ',' literal )* ')'
 *   reference   := 'activeExtensionId' | 'activeNavNodeId' | 'selectedItemId'
 *                | 'contextKeys' '.' key
 *   literal     := string | number | 'true' | 'false' | 'null'
 *   string      := "'" <any char except "'", "\" and any control char> "'"
 *   number      := '-'? digit+ ( '.' digit+ )?
 *   key         := a name matching `WHEN_KEY_PATTERN` and not in
 *                  `RESERVED_WHEN_KEYS`
 *
 * `comparison` is NON-ASSOCIATIVE: `a == b == c` is a parse error rather than
 * the surprising left-fold JavaScript would give it. `!` binds tighter than any
 * comparison, so `!a == 'x'` is `(!a) == 'x'`; write `!(a == 'x')` for the
 * other reading. `&&` binds tighter than `||`, and both are left-associative.
 * *Tests:* "binds ! tighter than a comparison, which a boolean operand cannot
 * show", "binds && tighter than ||" and "refuses a chained comparison rather
 * than left-folding it" in `src/core/commands/__tests__/when.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT GUARANTEES
 * ---------------------------------------------------------------------------
 *  1. **No dynamic code construction, anywhere.** A hand-written tokenizer and a
 *     recursive-descent parser. The module contains no `eval`, no `Function`, no
 *     `RegExp` constructor, no `require`, no timer, and no `constructor` or
 *     `prototype` property access — asserted by parsing this file with the
 *     TypeScript compiler, in the same shape as
 *     `src/__tests__/noEventListener.test.ts`. Pinned by "names no dynamic-code
 *     sink in any code position", "spells the three prototype keys only as the
 *     reserved-name data they are" and "reports a planted sink, however it is
 *     spelled".
 *
 *     **What that scan cannot see, stated rather than glossed:** a sink reached
 *     through a name that is not text — `globalThis[a + b](…)`, a spelling built
 *     by concatenation, or a function this module merely imports. It is a
 *     guardrail against the ordinary way dynamic code gets constructed, not a
 *     proof that none can exist, which is the same limit
 *     `noEventListener.test.ts` records for itself. The stronger half of the
 *     claim is structural rather than scanned: the parser's only inputs are a
 *     `string` and a `field`, and its only output is frozen data.
 *  2. **Parsing is bounded in three independent dimensions** — source length,
 *     token count and nesting depth — and each is `PAYLOAD_TOO_LARGE`. The depth
 *     check runs BEFORE the recursive call, not after, because a recursive-
 *     descent parser that recurses first has already overflowed the stack by the
 *     time it looks. Pinned by "rejects a source longer than the length bound",
 *     "rejects a token stream longer than the token bound", "rejects nesting
 *     deeper than the depth bound" and "rejects a run of ! deeper than the depth
 *     bound".
 *  3. **Every reference is drawn from a host-owned allowlist.** An expression can
 *     name three `RibbonContext` fields, the selection collection, and a context
 *     key — nothing else. There is no general property path, so no expression can
 *     walk an object graph. Pinned by "refuses an identifier that is not a host
 *     field, a collection or a context key".
 *  4. **`__proto__`, `constructor` and `prototype` are refused as context-key
 *     names**, checked before the name pattern so the message names the reason.
 *     Pinned by "refuses the three prototype keys as context-key names, and says
 *     why" and, non-vacuously, by "accepts an ordinary context-key name in the
 *     same position".
 *  5. **Evaluation is total: it returns a boolean and cannot throw.** A missing
 *     context key is `undefined` — not an error — and a context that throws while
 *     it is read makes the expression `false`. Pinned by "treats a missing
 *     context key as undefined rather than as an error", "returns false rather
 *     than throwing when the context throws while it is read" and "returns a
 *     boolean for every parsed expression against a hostile context".
 *  6. **The parsed form is data.** Frozen plain objects of primitives, so it
 *     survives a structured clone and can be handed to another process. That is
 *     the entire reason `when` exists rather than a second closure. Pinned by
 *     "produces a deep-frozen parse tree that survives a JSON round trip".
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES **NOT** GUARANTEE
 * ---------------------------------------------------------------------------
 *  - **Nothing calls `parseWhen` yet.** Wiring it into `normalizeRibbonAction` is
 *    a separate, coordinated change to `RegistryContext.tsx`. This module is
 *    shaped as an entry-point validator — it takes the dotted `field` path its
 *    caller will report, and it throws `ShellUXError` rather than returning a
 *    result object — but the sentence "a malformed `when` is a registration
 *    failure" is a statement about that future caller and is NOT evidenced here.
 *    Per ADR-0001 Amendment G that limit is written down rather than glossed.
 *  - **Totality is "returns a boolean and throws nothing", not "terminates".** A
 *    hostile `Proxy` whose `get` trap loops forever hangs the render, and no
 *    guard in this module addresses that. The parse tree's own recursion IS
 *    bounded, by guarantee 2.
 *  - **A throwing context read that is REACHED collapses the whole expression to
 *    `false`**, even where the other operand of `||` would have made it true.
 *    That is the consequence of one outer guard rather than a guard per read,
 *    and it is the safe direction: an action that cannot be evaluated does not
 *    appear. `&&` and `||` do short-circuit, so a read the short-circuit skips
 *    never happens and never collapses anything. Both halves are pinned, by
 *    "returns false rather than throwing when the context throws while it is
 *    read" and "short-circuits && and ||, which a throwing context makes
 *    observable".
 *  - **String literals have no escape sequences.** A literal cannot contain an
 *    apostrophe or a backslash at all. There is no `\'`, because an escape
 *    grammar is a second parser and this one is refused input it cannot spell
 *    rather than given a way to spell it wrong.
 *  - **It does not check that a context key is one an extension ever sets.** A
 *    `when` naming a key nobody writes is a permanently-hidden action, exactly as
 *    an `isVisible` returning `false` is, and the registry has no way to know the
 *    difference.
 *
 * ---------------------------------------------------------------------------
 * DECISION — `=~` IS REFUSED, AND `startsWith` IS WHAT REPLACES IT
 * ---------------------------------------------------------------------------
 * A regex-match operator was considered and is rejected. The split is what makes
 * it worst: **the plug-in supplies the pattern and the host supplies the
 * subject.** V8 offers no timeout on `RegExp.prototype.test`, evaluation happens
 * during the host's render, and catastrophic backtracking is therefore an
 * unrecoverable hang rather than a slow frame. It cannot be bounded by input
 * size either — `(a+)+$` is nine characters and any of the length, token and
 * depth bounds above would wave it through. And building a `RegExp` from an
 * untrusted string is dynamic construction from plug-in text, which is the one
 * thing guarantee 1 says this module never does.
 *
 * The only thing a regex was actually wanted for here is a PREFIX test:
 * `MailPlugin.tsx:556-559` guards its selection with `startsWith('msg-')` and
 * `DatabasePlugin.tsx:517-520` does the same with `'rec-'`. So the operator
 * offered is `startsWith`, whose right-hand side must be a STRING LITERAL and
 * never a reference. That is a linear scan against a needle bounded by the
 * source length, with no backtracking and nothing to construct. `endsWith` and
 * `contains` are deliberately absent: no predicate in the repository wants one,
 * and speculative operators are surface with no argument behind it.
 *
 * ---------------------------------------------------------------------------
 * DECISION — `in`, ITS TWO RIGHT-HAND SIDES, AND WHAT EACH ONE COSTS
 * ---------------------------------------------------------------------------
 * `in` takes either a literal list or `selectedItemIds`, and the two are here
 * for different strengths of reason. **The list form has a call site**: both of
 * `DatabasePlugin`'s conditional predicates are set membership over its own
 * category ids, and nothing else in the language can express one. **The
 * selection form does not** — no mock predicate asks whether a particular id is
 * selected. It is here because multi-selection has no other expression at all:
 * `selectedItemIds` is refused in scalar position, so without `in` the field
 * that ADR-0001 Amendment K Decision 1 made the single source of truth for
 * selection would be unreachable from a `when`. That is a weaker argument than
 * the list form's, and it is written down as weaker rather than dressed up,
 * because the paragraph above refuses `endsWith` on exactly this test.
 *
 * **The list form's cost is real and belongs to its user, not to this module.**
 * Spelling `('fasteners', 'connectors', …)` into a manifest copies a plug-in's
 * own vocabulary into a string the plug-in's code does not read, so changing
 * `LEAF_CATEGORIES` leaves the `when` silently stale. The alternative is the one
 * Amendment K Decision 2 exists for — publish the fact and read it, as
 * `contextKeys.category-kind == 'leaf'` — and it is the right reach whenever the
 * vocabulary changes more often than the manifest. It cannot replace the list
 * form here, because `activeNavNodeId` is written by the HOST on a pane-1 click
 * and a plug-in only gets to publish a derived key on the render that follows.
 * Both shapes are exercised by "expresses every ribbon predicate in
 * DatabasePlugin" and "expresses the selection-shaped predicates a context key
 * would express better".
 *
 * ---------------------------------------------------------------------------
 * DECISION — THREE ERROR CODES, AND THE ONE THAT IS DELIBERATELY UNUSED
 * ---------------------------------------------------------------------------
 * `SHELL_UX_ERROR_CODE_MEMBERS` in `types.ts` is compiler-pinned, so no code is
 * added. Of the codes that exist, this module raises exactly two:
 *
 *  - `PAYLOAD_TOO_LARGE` for each of the three bounds.
 *  - `INVALID_FIELD` for everything else — a non-string, a blank string, a
 *    character the tokenizer does not know, a token in the wrong place, an
 *    unknown reference and a refused key name.
 *
 * `INVALID_PAYLOAD` is NOT used, and the omission is the decision. In this
 * repository that code means "the payload was not a plain object" —
 * `normalizeBlueprint`'s door — while a non-string *field* is `INVALID_FIELD`
 * everywhere `validateText` and `validateId` are called. A `when` is a field.
 * `RESERVED_ID` and `INVALID_ID` are not used either, for the same shape of
 * reason: this field is not an id, it CONTAINS one, and reporting the whole
 * expression as a malformed identifier would name the wrong thing to whoever has
 * to fix it. Pinned by "reports every rejection as one of exactly two codes".
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Host constants                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Hard bounds on one expression, in three independent dimensions.
 *
 * They are independent because each closes a different door, and any two of them
 * leave the third open: 512 characters of `!!!!…` is a deep parse from a short
 * string, and a 128-token stream of `true||true||…` is a wide parse from a
 * shallow one. Frozen for the reason `REGISTRY_LIMITS` is — a bound a plug-in
 * can reassign is not a bound.
 *
 * The numbers are chosen against the predicates this language exists to express.
 * The longest real one is `DatabasePlugin`'s category test, which spells ten
 * category ids inline: ~150 characters and ~23 tokens, comfortably inside both.
 */
export const WHEN_LIMITS = Object.freeze({
  /** Max characters in the source string. Checked before anything is scanned. */
  MAX_LENGTH: 512,
  /** Max tokens, excluding the end-of-input sentinel. */
  MAX_TOKENS: 128,
  /** Max nesting depth. A bare expression is depth 1; each `(` and each `!` adds one. */
  MAX_DEPTH: 16,
});

/** The `RibbonContext` fields an expression may name as scalars. */
export type WhenHostField = 'activeExtensionId' | 'activeNavNodeId' | 'selectedItemId';

/**
 * Exhaustiveness pin for `WHEN_HOST_FIELDS`, in the same shape as `PANE_IDS` in
 * `types.ts`: `Record<WhenHostField, true>` makes the compiler reject both a
 * missing member and an invented one, so the runtime allowlist cannot drift away
 * from the union the evaluator indexes `RibbonContext` with.
 *
 * `focusedPane` is absent because the field is gone — ADR-0001 Amendment K
 * Decision 6 removed it, and an expression language that could still name it
 * would be offering a predicate that can never fire.
 */
const WHEN_HOST_FIELD_MEMBERS: Readonly<Record<WhenHostField, true>> = Object.freeze({
  activeExtensionId: true,
  activeNavNodeId: true,
  selectedItemId: true,
});

/** `WhenHostField` as a runtime allowlist. */
export const WHEN_HOST_FIELDS: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(WHEN_HOST_FIELD_MEMBERS)),
);

/**
 * The one collection an expression may name, and only ever as the right-hand
 * side of `in`.
 *
 * It is refused in scalar position rather than given a truthiness — an array is
 * always truthy, so `selectedItemIds` on its own would read as "something is
 * selected" and mean "always". `selectedItemId != null` is how that question is
 * asked.
 */
export const WHEN_COLLECTION_FIELD = 'selectedItemIds';

/** The record on `RibbonContext` a dotted reference reads. */
const WHEN_CONTEXT_KEYS_FIELD = 'contextKeys';

/**
 * The rule a context-key name is held to.
 *
 * A deliberate COPY of `EXTENSION_ID_PATTERN` rather than an import of it. This
 * module has to be able to run in the host process of a multi-process shell, and
 * `RegistryContext.tsx` is a React context module; importing it here would drag
 * React into the one module whose whole purpose is to be evaluable away from the
 * renderer. The copy is held to the original in both directions by "uses exactly
 * the registry's identifier rule for a context-key name" — so a divergence is a
 * failing test rather than a silent second standard.
 *
 * **The pattern is identical and the REACHABLE SET is not, in one lexical case.**
 * `EXTENSION_ID_PATTERN` admits a leading digit, so `setContextKey('9lives', …)`
 * is a legal call — but the tokenizer's number branch runs before its word
 * branch, so a name starting with a digit lexes as a number literal and never
 * arrives here. Such a key is settable and unnameable. It is recorded rather than
 * fixed: reordering the two branches would make `-3` ambiguous, and the remedy
 * an author has is to start the key with a letter. Pinned by "is narrower than
 * the registry's rule in exactly one lexical case: a name that starts with a
 * digit", which is deliberately a second case — comparing the two patterns
 * cannot see this and would have let it pass unnoticed.
 */
export const WHEN_KEY_PATTERN = Object.freeze(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * Names refused as context keys before the pattern is consulted, so the message
 * can say *reserved* rather than *malformed*.
 *
 * `__proto__` already fails the pattern; `constructor` and `prototype` are plain
 * lowercase words that pass it. All three are refused for the reason
 * `RESERVED_IDS` refuses them in `RegistryContext.tsx` — belt and braces on top
 * of the fact that `contextKeys` is built on `Object.create(null)` and has no
 * prototype chain to reach.
 *
 * Held to `RESERVED_IDS` as a set, in both directions, by "uses exactly the
 * registry's identifier rule for a context-key name"; the refusal itself is
 * "refuses the three prototype keys as context-key names, and says why", and its
 * control — without which a parser that rejected every dotted name would pass
 * vacuously — is "accepts an ordinary context-key name in the same position".
 */
export const RESERVED_WHEN_KEYS: ReadonlySet<string> = Object.freeze(
  new Set(['__proto__', 'constructor', 'prototype']),
);

/** Comparison operators. */
const COMPARE_OPERATORS: ReadonlySet<string> = Object.freeze(
  new Set(['==', '!=', '<', '<=', '>', '>=']),
);

/**
 * The subset of `COMPARE_OPERATORS` that only means anything over numbers.
 *
 * A literal operand of one of these must be a number literal, checked at parse
 * time: `activeNavNodeId < 'x'` is a manifest that can never be true, and
 * catching it at the door is worth more to its author than a silent `false` at
 * every render.
 */
const ORDER_OPERATORS: ReadonlySet<string> = Object.freeze(new Set(['<', '<=', '>', '>=']));

/** Word tokens that are literals rather than references. */
const LITERAL_WORDS: Readonly<Record<string, ContextKeyValue>> = Object.freeze({
  true: true,
  false: false,
  null: null,
});

/* -------------------------------------------------------------------------- */
/* The parsed form — plain frozen data, because it has to cross a process       */
/* -------------------------------------------------------------------------- */

/** A comparison operator, as the parse tree spells it. */
export type WhenCompareOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';

/** One node of a parsed `when` expression. */
export type WhenNode =
  | { readonly kind: 'literal'; readonly value: ContextKeyValue }
  | { readonly kind: 'field'; readonly field: WhenHostField }
  | { readonly kind: 'contextKey'; readonly key: string }
  | { readonly kind: 'not'; readonly operand: WhenNode }
  | { readonly kind: 'and'; readonly left: WhenNode; readonly right: WhenNode }
  | { readonly kind: 'or'; readonly left: WhenNode; readonly right: WhenNode }
  | {
      readonly kind: 'compare';
      readonly operator: WhenCompareOperator;
      readonly left: WhenNode;
      readonly right: WhenNode;
    }
  | { readonly kind: 'inList'; readonly operand: WhenNode; readonly values: readonly ContextKeyValue[] }
  | { readonly kind: 'inSelection'; readonly operand: WhenNode }
  | { readonly kind: 'startsWith'; readonly operand: WhenNode; readonly prefix: string };

/**
 * A parsed expression: the source it came from, and the tree to evaluate.
 *
 * The source is kept because every useful diagnostic downstream — a devtools
 * panel, a command-palette inspector, an error naming which clause hid an action
 * — wants the author's own spelling and not a pretty-printed reconstruction of
 * it.
 */
export interface WhenExpression {
  readonly source: string;
  readonly node: WhenNode;
}

/* -------------------------------------------------------------------------- */
/* Tokenizer                                                                   */
/* -------------------------------------------------------------------------- */

type TokenKind = 'word' | 'string' | 'number' | 'punct' | 'end';

interface Token {
  readonly kind: TokenKind;
  /** For `string`, the contents WITHOUT the quotes. For `end`, the empty string. */
  readonly text: string;
  /** Zero-based character offset, so a rejection can name where it happened. */
  readonly at: number;
}

function invalid(field: string, detail: string): ShellUXError {
  return new ShellUXError(
    'INVALID_FIELD',
    `Field "${field}" is not a valid when-expression: ${detail}.`,
    field,
  );
}

function tooLarge(field: string, detail: string): ShellUXError {
  return new ShellUXError('PAYLOAD_TOO_LARGE', `Field "${field}" ${detail}.`, field);
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

/**
 * Whether `character` may appear in a word.
 *
 * Underscore is included even though no legal name contains one, and that is
 * deliberate: without it `__proto__` would come apart at the first underscore
 * and be reported as an unknown CHARACTER, which tells its author nothing. With
 * it, the whole word reaches the reserved-name check and is refused by name.
 */
function isWordCharacter(character: string): boolean {
  return (
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    isDigit(character) ||
    character === '-' ||
    character === '_'
  );
}

function isSpace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

/**
 * Whether a character may appear inside a quoted string.
 *
 * The closing quote is the scanning loop's own business, so it is not tested
 * here. A backslash is refused because there are no escape sequences: an escape
 * grammar is a second parser, and this one refuses input it cannot spell rather
 * than offering a way to spell it wrong.
 */
function isLegalStringCharacter(character: string): boolean {
  return character !== '\\' && character >= ' ';
}

/**
 * Source text to tokens, with an `end` sentinel appended.
 *
 * The sentinel is not a convenience: it is what lets every parse function read
 * the current token without a bounds check, so there is no unreachable
 * `undefined` branch for the coverage gate to fail on and no `!` assertion for
 * the linter to reject.
 */
function tokenize(source: string, field: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source.charAt(index);

    if (isSpace(character)) {
      index += 1;
      continue;
    }

    if (character === '&' || character === '|') {
      if (source.charAt(index + 1) !== character) {
        throw invalid(field, `expected "${character}${character}" at character ${index}`);
      }
      tokens.push({ kind: 'punct', text: `${character}${character}`, at: index });
      index += 2;
      continue;
    }

    if (character === '=') {
      if (source.charAt(index + 1) !== '=') {
        throw invalid(field, `expected "==" at character ${index}; a single "=" assigns nothing here`);
      }
      tokens.push({ kind: 'punct', text: '==', at: index });
      index += 2;
      continue;
    }

    if (character === '!' || character === '<' || character === '>') {
      const twoCharacter = source.charAt(index + 1) === '=';
      tokens.push({
        kind: 'punct',
        text: twoCharacter ? `${character}=` : character,
        at: index,
      });
      index += twoCharacter ? 2 : 1;
      continue;
    }

    if (character === '(' || character === ')' || character === ',' || character === '.') {
      tokens.push({ kind: 'punct', text: character, at: index });
      index += 1;
      continue;
    }

    if (character === "'") {
      const start = index;
      index += 1;
      let text = '';
      while (index < source.length && source.charAt(index) !== "'") {
        const inner = source.charAt(index);
        if (!isLegalStringCharacter(inner)) {
          throw invalid(
            field,
            `a string literal may not contain a backslash or a control character (character ${index})`,
          );
        }
        text += inner;
        index += 1;
      }
      if (index >= source.length) {
        throw invalid(field, `an unterminated string literal opens at character ${start}`);
      }
      index += 1;
      tokens.push({ kind: 'string', text, at: start });
      continue;
    }

    if (isDigit(character) || (character === '-' && isDigit(source.charAt(index + 1)))) {
      const start = index;
      if (character === '-') {
        index += 1;
      }
      while (index < source.length && isDigit(source.charAt(index))) {
        index += 1;
      }
      if (source.charAt(index) === '.') {
        index += 1;
        if (!isDigit(source.charAt(index))) {
          throw invalid(field, `a number needs a digit after its decimal point (character ${index})`);
        }
        while (index < source.length && isDigit(source.charAt(index))) {
          index += 1;
        }
      }
      tokens.push({ kind: 'number', text: source.slice(start, index), at: start });
      continue;
    }

    if (isWordCharacter(character)) {
      const start = index;
      while (index < source.length && isWordCharacter(source.charAt(index))) {
        index += 1;
      }
      tokens.push({ kind: 'word', text: source.slice(start, index), at: start });
      continue;
    }

    throw invalid(field, `unexpected character ${JSON.stringify(character)} at character ${index}`);
  }

  tokens.push({ kind: 'end', text: '', at: source.length });
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* Parser                                                                      */
/* -------------------------------------------------------------------------- */

interface ParseState {
  readonly tokens: readonly Token[];
  readonly field: string;
  index: number;
  depth: number;
}

function current(state: ParseState): Token {
  return state.tokens[state.index] as Token;
}

function advance(state: ParseState): void {
  state.index += 1;
}

function isPunct(state: ParseState, text: string): boolean {
  const token = current(state);
  return token.kind === 'punct' && token.text === text;
}

/** How a token reads in a rejection message. */
function describeToken(token: Token): string {
  if (token.kind === 'end') {
    return 'the end of the expression';
  }
  if (token.kind === 'string') {
    return `the string literal ${JSON.stringify(token.text)}`;
  }
  return `${JSON.stringify(token.text)}`;
}

function unexpected(state: ParseState, expectation: string): ShellUXError {
  const token = current(state);
  return invalid(
    state.field,
    `expected ${expectation} but found ${describeToken(token)} at character ${token.at}`,
  );
}

function expectPunct(state: ParseState, text: string): void {
  if (!isPunct(state, text)) {
    throw unexpected(state, `"${text}"`);
  }
  advance(state);
}

/**
 * Take one step down, and refuse the step if it is too deep.
 *
 * **Before the recursive call, never after.** A recursive-descent parser that
 * recurses first and checks afterwards has already blown the stack by the time
 * it looks, which turns a bounded rejection into an uncatchable
 * `RangeError` — and on a deep enough input, into a host process that stops.
 */
function descend(state: ParseState): void {
  state.depth += 1;
  if (state.depth > WHEN_LIMITS.MAX_DEPTH) {
    throw tooLarge(state.field, `nests deeper than the maximum of ${WHEN_LIMITS.MAX_DEPTH}`);
  }
}

function ascend(state: ParseState): void {
  state.depth -= 1;
}

function parseOr(state: ParseState): WhenNode {
  descend(state);
  let node = parseAnd(state);
  while (isPunct(state, '||')) {
    advance(state);
    node = Object.freeze({ kind: 'or' as const, left: node, right: parseAnd(state) });
  }
  ascend(state);
  return node;
}

function parseAnd(state: ParseState): WhenNode {
  let node = parseComparison(state);
  while (isPunct(state, '&&')) {
    advance(state);
    node = Object.freeze({ kind: 'and' as const, left: node, right: parseComparison(state) });
  }
  return node;
}

/**
 * Reject a literal operand of an ordering comparison that is not a number.
 *
 * A reference is left alone — its type is only known at evaluation time, and the
 * evaluator answers `false` for a non-numeric one.
 */
function requireNumericLiteral(state: ParseState, node: WhenNode, operator: string): void {
  if (node.kind === 'literal' && typeof node.value !== 'number') {
    throw invalid(
      state.field,
      `"${operator}" compares numbers, so a literal operand must be a number literal`,
    );
  }
}

function parseComparison(state: ParseState): WhenNode {
  const left = parseUnary(state);
  const token = current(state);

  if (token.kind === 'punct' && COMPARE_OPERATORS.has(token.text)) {
    advance(state);
    const right = parseUnary(state);
    if (ORDER_OPERATORS.has(token.text)) {
      requireNumericLiteral(state, left, token.text);
      requireNumericLiteral(state, right, token.text);
    }
    const after = current(state);
    if (after.kind === 'punct' && COMPARE_OPERATORS.has(after.text)) {
      throw invalid(
        state.field,
        `comparisons do not chain; parenthesise one of them (character ${after.at})`,
      );
    }
    return Object.freeze({
      kind: 'compare' as const,
      operator: token.text as WhenCompareOperator,
      left,
      right,
    });
  }

  if (token.kind === 'word' && token.text === 'in') {
    advance(state);
    return parseIn(state, left);
  }

  if (token.kind === 'word' && token.text === 'startsWith') {
    advance(state);
    const needle = current(state);
    if (needle.kind !== 'string') {
      throw unexpected(state, 'a string literal after "startsWith"');
    }
    advance(state);
    return Object.freeze({ kind: 'startsWith' as const, operand: left, prefix: needle.text });
  }

  return left;
}

/** The right-hand side of `in`: the selection collection, or a literal list. */
function parseIn(state: ParseState, operand: WhenNode): WhenNode {
  const token = current(state);
  if (token.kind === 'word' && token.text === WHEN_COLLECTION_FIELD) {
    advance(state);
    return Object.freeze({ kind: 'inSelection' as const, operand });
  }
  expectPunct(state, '(');
  const values: ContextKeyValue[] = [parseLiteralValue(state)];
  while (isPunct(state, ',')) {
    advance(state);
    values.push(parseLiteralValue(state));
  }
  expectPunct(state, ')');
  return Object.freeze({
    kind: 'inList' as const,
    operand,
    values: Object.freeze(values),
  });
}

/** One literal, as a bare value. Used only inside an `in` list. */
function parseLiteralValue(state: ParseState): ContextKeyValue {
  const token = current(state);
  if (token.kind === 'string') {
    advance(state);
    return token.text;
  }
  if (token.kind === 'number') {
    advance(state);
    return Number(token.text);
  }
  if (token.kind === 'word' && Object.hasOwn(LITERAL_WORDS, token.text)) {
    advance(state);
    return LITERAL_WORDS[token.text] as ContextKeyValue;
  }
  throw unexpected(state, 'a literal');
}

function parseUnary(state: ParseState): WhenNode {
  if (isPunct(state, '!')) {
    advance(state);
    descend(state);
    const operand = parseUnary(state);
    ascend(state);
    return Object.freeze({ kind: 'not' as const, operand });
  }
  return parseOperand(state);
}

function parseOperand(state: ParseState): WhenNode {
  const token = current(state);

  if (token.kind === 'punct' && token.text === '(') {
    advance(state);
    const node = parseOr(state);
    expectPunct(state, ')');
    return node;
  }

  if (token.kind === 'string' || token.kind === 'number') {
    return Object.freeze({ kind: 'literal' as const, value: parseLiteralValue(state) });
  }

  if (token.kind === 'word') {
    return parseWord(state, token);
  }

  throw unexpected(state, 'a reference, a literal or "("');
}

function parseWord(state: ParseState, token: Token): WhenNode {
  if (Object.hasOwn(LITERAL_WORDS, token.text)) {
    return Object.freeze({ kind: 'literal' as const, value: parseLiteralValue(state) });
  }

  if (WHEN_HOST_FIELDS.has(token.text)) {
    advance(state);
    return Object.freeze({ kind: 'field' as const, field: token.text as WhenHostField });
  }

  if (token.text === WHEN_CONTEXT_KEYS_FIELD) {
    advance(state);
    expectPunct(state, '.');
    const name = current(state);
    if (name.kind !== 'word') {
      throw unexpected(state, 'a context-key name after "contextKeys."');
    }
    advance(state);
    return Object.freeze({ kind: 'contextKey' as const, key: validateKeyName(state, name) });
  }

  if (token.text === WHEN_COLLECTION_FIELD) {
    throw invalid(
      state.field,
      `"${WHEN_COLLECTION_FIELD}" is a collection and may only follow "in"; ask whether anything is selected with "selectedItemId != null" (character ${token.at})`,
    );
  }

  throw invalid(
    state.field,
    `"${token.text}" is not a context reference; the expression may name ${[...WHEN_HOST_FIELDS].join(', ')}, ${WHEN_COLLECTION_FIELD} or contextKeys.<name> (character ${token.at})`,
  );
}

/**
 * A context-key name, held to the registry's identifier rule with the reserved
 * words checked first — the same order `validateId` uses in
 * `RegistryContext.tsx`, and for the same reason: the three prototype names get
 * one unambiguous message instead of two depending on spelling.
 */
function validateKeyName(state: ParseState, token: Token): string {
  if (RESERVED_WHEN_KEYS.has(token.text)) {
    throw invalid(
      state.field,
      `"${token.text}" is a reserved name and may not be used as a context key (character ${token.at})`,
    );
  }
  if (!WHEN_KEY_PATTERN.test(token.text)) {
    throw invalid(
      state.field,
      `${JSON.stringify(token.text)} is not a valid context-key name (character ${token.at})`,
    );
  }
  return token.text;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse an untrusted `when` expression, or reject it.
 *
 * `field` is the dotted path the caller will report — `ribbonActions[3].when` —
 * and is carried onto every `ShellUXError` this function raises, exactly as the
 * registry's own validators carry theirs.
 *
 * @throws {ShellUXError} `INVALID_FIELD` when `source` is not a string, is
 *   blank, or does not parse; `PAYLOAD_TOO_LARGE` when it is longer, has more
 *   tokens, or nests deeper than `WHEN_LIMITS` allows.
 */
export function parseWhen(source: unknown, field: string): WhenExpression {
  if (typeof source !== 'string') {
    throw invalid(field, 'it must be a string');
  }
  if (source.length > WHEN_LIMITS.MAX_LENGTH) {
    throw tooLarge(field, `exceeds the maximum length of ${WHEN_LIMITS.MAX_LENGTH} characters`);
  }

  const tokens = tokenize(source, field);
  if (tokens.length - 1 > WHEN_LIMITS.MAX_TOKENS) {
    throw tooLarge(field, `exceeds the maximum of ${WHEN_LIMITS.MAX_TOKENS} tokens`);
  }
  if (tokens.length === 1) {
    throw invalid(field, 'it must not be blank');
  }

  const state: ParseState = { tokens, field, index: 0, depth: 0 };
  const node = parseOr(state);
  if (current(state).kind !== 'end') {
    throw unexpected(state, 'the end of the expression');
  }

  return Object.freeze({ source, node });
}

/* -------------------------------------------------------------------------- */
/* Evaluator                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Truthiness, stated rather than inherited.
 *
 * It is JavaScript's, on purpose — an author writing `contextKeys.count` means
 * "non-zero" and would be surprised by anything else — but it is written down
 * because the language's whole value is that its semantics are legible from one
 * page. `null`, `undefined`, `false`, `0`, `NaN` and `''` are false; every other
 * primitive is true.
 */
function truthy(value: ContextKeyValue | undefined): boolean {
  return Boolean(value);
}

/**
 * `==` is `===`, with no coercion in any direction.
 *
 * The consequences worth knowing: a value of one type never equals a value of
 * another, so `contextKeys.count == '3'` is false when the key holds the number
 * 3; and a MISSING key is `undefined`, which is not `null`, so
 * `contextKeys.absent == null` is false. Ask whether a key is unset-or-falsy with
 * `!contextKeys.absent`.
 */
function equals(left: ContextKeyValue | undefined, right: ContextKeyValue | undefined): boolean {
  return left === right;
}

function compare(
  operator: WhenCompareOperator,
  left: ContextKeyValue | undefined,
  right: ContextKeyValue | undefined,
): boolean {
  if (operator === '==') {
    return equals(left, right);
  }
  if (operator === '!=') {
    return !equals(left, right);
  }
  // Ordering over anything but two numbers is false rather than an error, which
  // is what keeps evaluation total. It also means `!(a > b)` is NOT `a <= b`
  // when `a` is missing: both comparisons are false, so the negation is true.
  if (typeof left !== 'number' || typeof right !== 'number') {
    return false;
  }
  if (operator === '<') {
    return left < right;
  }
  if (operator === '<=') {
    return left <= right;
  }
  if (operator === '>') {
    return left > right;
  }
  return left >= right;
}

/**
 * One node against one context.
 *
 * Returns a `ContextKeyValue` because a reference node yields whatever the
 * context holds; every operator node yields a boolean, which is a member of that
 * union. Missing keys come back as `undefined` and are not an error.
 */
function evaluateNode(node: WhenNode, context: Readonly<RibbonContext>): ContextKeyValue | undefined {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'field':
      return context[node.field];
    case 'contextKey':
      return context.contextKeys[node.key];
    case 'not':
      return !truthy(evaluateNode(node.operand, context));
    case 'and':
      return truthy(evaluateNode(node.left, context)) && truthy(evaluateNode(node.right, context));
    case 'or':
      return truthy(evaluateNode(node.left, context)) || truthy(evaluateNode(node.right, context));
    case 'compare':
      return compare(
        node.operator,
        evaluateNode(node.left, context),
        evaluateNode(node.right, context),
      );
    case 'inList': {
      const value = evaluateNode(node.operand, context);
      return node.values.some((candidate) => candidate === value);
    }
    case 'inSelection': {
      const value = evaluateNode(node.operand, context);
      return context.selectedItemIds.some((id) => id === value);
    }
    case 'startsWith': {
      const value = evaluateNode(node.operand, context);
      return typeof value === 'string' && value.startsWith(node.prefix);
    }
  }
}

/**
 * Evaluate a parsed expression against a context. **Total: it returns a boolean
 * and cannot throw.**
 *
 * The one guard is here rather than at every read, and the trade is stated in
 * the banner: a throwing read that is REACHED makes the whole expression
 * `false`, including where the other operand of `||` would have made it true.
 * The safe direction is the one that hides the action. `&&` and `||` still
 * short-circuit, so a read they skip cannot collapse anything.
 *
 * What this does NOT promise is termination — a `Proxy` whose `get` trap loops
 * forever is outside any guard a caller of it can write. The tree's own
 * recursion is bounded by `WHEN_LIMITS.MAX_DEPTH` at parse time.
 */
export function evaluateWhen(
  expression: WhenExpression,
  context: Readonly<RibbonContext>,
): boolean {
  try {
    return truthy(evaluateNode(expression.node, context));
  } catch {
    return false;
  }
}
