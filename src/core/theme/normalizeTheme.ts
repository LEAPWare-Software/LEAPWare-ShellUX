import { SEMANTIC_TOKEN_NAMES, SEMANTIC_TOKEN_NAME_LIST } from './tokens.generated';
import type { SemanticTokenName } from './tokens.generated';
import { ShellUXError } from '../types';

/**
 * ============================================================================
 * A THEME IS UNTRUSTED INPUT REACHING A STYLESHEET
 * ============================================================================
 * `normalizeTheme` is a trust boundary in the same shape as
 * `normalizeNavigationNode`, and the two rules that make it one are worth
 * separating because they defend different things.
 *
 * **1. THE KEYS ARE THE HOST'S, AND THE CANDIDATE'S KEYS ARE NEVER ITERATED.**
 * The loop below walks `SEMANTIC_TOKEN_NAME_LIST` — the host's own list, from
 * the generated contract — and asks the candidate for each name in turn. A theme
 * naming `--gray-7`, `--accent-9` or `__proto__` therefore does not get rejected
 * so much as go unread: there is no code path on which a key the host did not ask
 * for is looked at, which is what keeps the primitive tier — `--gray-1..12`,
 * `--accent-1..12` — out of a third-party theme's reach. Pinned by "reads only
 * the host's own token names, so a primitive-tier key is never looked at" in
 * `src/core/theme/__tests__/normalizeTheme.test.ts`, which installs getters on
 * four out-of-contract names and asserts that none of them runs.
 *
 * **That is an INTEGRITY CONTROL and NOT a "structural" one, and the word matters
 * here because this repository reserves it.** ADR-0001 Amendment F gives
 * *structural* to the `Map`-backed stores, where prototype pollution is
 * impossible by construction rather than by filtering, and `RegistryContext.tsx`
 * carries a correction removing the word from normalisation for exactly this
 * reason: a property bought by a loop that runs is real and unconditional, but it
 * is bought by code, not by a property of a data structure. The one half of this
 * function that IS structural is the container: the result is built on
 * `Object.create(null)`, so there is no prototype to pollute whatever the loop
 * does.
 *
 * **2. THE VALUES MATCH AN ALLOWLIST, THEY DO NOT SURVIVE A DENYLIST.** A
 * denylist over CSS is a losing game: `;`, `}`, `/*`, `url(`, `expression(`,
 * `\3b`, a full-width semicolon, a newline — the list is open-ended and the
 * attacker picks last. `THEME_VALUE_PATTERN` is closed instead. A value is a hex
 * colour, an `oklch()` with numeric arguments, or a non-negative length in `px`
 * or `rem`, and NOTHING else is a value. A statement terminator is not in the
 * grammar, so it cannot appear in an accepted value whatever it is spelled as.
 * Pinned by "refuses a value carrying a CSS statement terminator, in every
 * spelling tried" in the same file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO. STATED PLAINLY, BECAUSE §3.6 ASKS FOR MORE.
 * ---------------------------------------------------------------------------
 * `docs/plans/native-host-pivot.md` §3.6 says a theme is "rejected if it fails
 * the contrast manifest". **That is not implemented here and this module does not
 * claim it.** `design/check-contrast.mjs` measures `design/contrast-manifest.json`
 * against the GENERATED stylesheet, at build time, in Node, over the three
 * built-in themes; it is `npm run tokens:check`, it is a stage of `npm run
 * verify`, and it never sees a third-party theme. Wiring it would mean the
 * contrast maths crossing into the browser bundle, and `design/` is not on the
 * TypeScript project's include path.
 *
 * So the honest statement is: **a third-party theme is held to the key allowlist
 * and the value grammar, and its CONTRAST IS NOT MEASURED BY ANYTHING.** A theme
 * whose text and surface both resolve to near-black is accepted by this function
 * and is unreadable. That gap is recorded in ADR-0001 Amendment M as accepted and
 * outstanding rather than closed, and it is pinned in the direction that is true —
 * "accepts a legal theme whose contrast is terrible, because contrast is not
 * measured here" in `src/core/theme/__tests__/normalizeTheme.test.ts`.
 * ============================================================================
 */

/**
 * A resolved semantic token set: every name the host publishes, and a value for
 * each.
 *
 * `Record<SemanticTokenName, string>` rather than a partial, so a reader may
 * index it without a membership test and without a `??`. Filling every name is
 * `normalizeTheme`'s job.
 */
export type ResolvedTheme = Readonly<Record<SemanticTokenName, string>>;

/**
 * The closed grammar of a semantic token value.
 *
 * Three alternatives and no fourth:
 *
 *  - a hex colour of 3, 4, 6 or 8 digits — the four lengths CSS defines, and not
 *    the 5 and 7 an `{3,8}` quantifier would have admitted;
 *  - an `oklch()` with three numeric components and an optional alpha, which is
 *    what `design/generate.mjs` emits;
 *  - a non-negative length in `px` or `rem`, for `--focus-ring-width` and
 *    `--focus-ring-offset-width`, which are the two members of the contract that
 *    are not colours.
 *
 * Anchored at both ends, so nothing may precede or follow. There is no
 * alternative containing `;`, `}`, `(` outside `oklch(`, a quote, a backslash, a
 * newline or a non-ASCII character, which is what makes "a value cannot carry a
 * CSS statement" a property of the grammar rather than a claim about a filter.
 */
const THEME_VALUE_PATTERN =
  /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|oklch\(\d+(?:\.\d+)?%? \d+(?:\.\d+)? \d+(?:\.\d+)?(?: \/ \d+(?:\.\d+)?%?)?\)|\d+(?:\.\d+)?(?:px|rem))$/i;

/**
 * Whether `value` is something this host will let into a token record.
 *
 * TOTAL, and it reads nothing off the value beyond `typeof` and — once that has
 * proven it is a primitive string — the string itself. Exported because
 * `ThemeBridge` applies the same grammar to what a DOCUMENT reports, and one
 * grammar in two places would drift.
 */
export function isThemeValue(value: unknown): value is string {
  return typeof value === 'string' && THEME_VALUE_PATTERN.test(value);
}

/**
 * The seed theme: every name in the contract, and **no value for any of them**.
 *
 * ============================================================================
 * THE HOST DOES NOT INVENT A COLOUR, AND THAT IS THE WHOLE OF THIS CONSTANT
 * ============================================================================
 * `getTheme()` is declared to return a value for EVERY name in the contract, and
 * a document that defines none of them — jsdom, or a pane whose stylesheet has
 * not been injected yet — would otherwise make that declaration a runtime lie.
 * This record answers that, and only that: the KEYS are complete and the VALUES
 * are empty.
 *
 * **The first draft filled it with a placeholder colour, and that was wrong for a
 * reason the repository already enforces.** `src/__tests__/noRawColor.test.ts`
 * reports a CSS colour literal in any module outside its one-entry allowlist, and
 * the entry it does have — `RootBoundary` — earns it by being the last thing
 * between a throw and a blank window AND by having its contrast measured from
 * those very literals. A placeholder here would earn none of that: it would be an
 * untokenised colour in `src/`, invisible to `design/contrast-manifest.json` and
 * to `npm run tokens:check`, which is precisely the second, unreviewed design
 * system that rule exists to stop. The built-in themes' real values live in
 * `src/styles/tokens.generated.css`, are generated from `design/tokens/`, and
 * reach a reader through the document — which is what `ThemeBridge` resolves.
 *
 * So the empty string is the honest answer, and it means exactly one thing: **the
 * document this record was resolved from defines nothing for that name.** It is
 * deliberately NOT a legal value by the grammar above, so it can never be
 * something a third-party theme supplies — only something the host reports when
 * it has nothing to report. A reader that paints must decide what to do about it
 * rather than being handed a colour nobody chose.
 *
 * "Missing keys fill from the built-in theme" is delivered through
 * `normalizeTheme`'s `base` PARAMETER, which `ThemeBridge` passes the currently
 * resolved theme — the built-in one, live from the stylesheet. This constant is
 * only what a document that defines nothing at all yields.
 * ============================================================================
 */
export const EMPTY_THEME: ResolvedTheme = Object.freeze(
  Object.fromEntries(SEMANTIC_TOKEN_NAME_LIST.map((name) => [name, ''])) as Record<
    SemanticTokenName,
    string
  >,
);

/** What a read off an untrusted theme answers when the read itself THREW. */
const REFUSED: unique symbol = Symbol('refused');

/**
 * Read one property off an untrusted theme without letting the read escape.
 *
 * Reaching a property on a third party's object is a call into their code — a
 * `get` trap, an own getter, or a revoked `Proxy` whose every internal method
 * throws a raw `TypeError`. This function is contracted to throw `ShellUXError`.
 */
function readGuarded(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return REFUSED;
  }
}

/**
 * Build the HOST-OWNED token record for an untrusted theme.
 *
 * **A key the candidate omits fills from `base`; a key it supplies with an
 * illegal value is a REJECTION.** The asymmetry is deliberate and is the one
 * `normalizeNavigationNode` draws between an absent optional field and a present
 * bad one. Filling silently over a value the author actually wrote is the
 * "mysteriously never sticks" failure `assertValidSelectedItemId` refuses to
 * create by coercing: the author would see a theme that ignores half of what they
 * asked for and would have nothing to look at.
 *
 * @param candidate The untrusted theme. Read once per name, guarded.
 * @param base The theme to fill omitted names from — normally whatever
 *   `ThemeBridge` last resolved from the document, which IS the built-in theme.
 * @throws {ShellUXError} `INVALID_PAYLOAD` when `candidate` is not an object or
 *   refuses to be read; `INVALID_FIELD` when a supplied value is not a member of
 *   the value grammar.
 */
export function normalizeTheme(candidate: unknown, base: ResolvedTheme): ResolvedTheme {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `normalizeTheme: a theme must be an object; received ${candidate === null ? 'null' : `a value of type "${typeof candidate}"`}.`,
      null,
    );
  }
  const record = Object.create(null) as Record<string, string>;
  for (const name of SEMANTIC_TOKEN_NAME_LIST) {
    // The HOST'S name, asked of the candidate. The candidate's own key list is
    // never obtained, so a key outside the contract is not filtered out — it is
    // never looked at.
    const held = readGuarded(() => (candidate as Record<string, unknown>)[name]);
    if (held === REFUSED) {
      throw new ShellUXError(
        'INVALID_PAYLOAD',
        `normalizeTheme: reading "${name}" off the theme threw. Nothing was applied.`,
        name,
      );
    }
    if (held === undefined) {
      record[name] = base[name];
      continue;
    }
    if (!isThemeValue(held)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        // The value is NOT interpolated: it has just failed the grammar, which is
        // exactly the case in which putting it in a message is putting an
        // attacker's string somewhere a log or a console will render it.
        `normalizeTheme: "${name}" must be a hex colour, an OKLCH colour, or a non-negative px/rem length; received a value of type "${typeof held}" that is not in the token value grammar.`,
        name,
      );
    }
    record[name] = held;
  }
  return Object.freeze(record) as ResolvedTheme;
}

/**
 * `SEMANTIC_TOKEN_NAMES` re-exported, so a reader of this module does not have to
 * know that the allowlist is generated.
 */
export { SEMANTIC_TOKEN_NAMES };
