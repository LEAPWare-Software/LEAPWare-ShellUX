import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type {
  Command,
  CommandCategory,
  CommandSurface,
  ExtensionLifecycle,
  ExtensionView,
  Hotkey,
  LEAPExtensionBlueprint,
  NavigationMetric,
  NavigationMetricKind,
  NavigationNode,
  ShellUXErrorCode,
} from './types';
import {
  COMMAND_CATEGORIES,
  COMMAND_SURFACES,
  NAVIGATION_METRIC_KINDS,
  SHELL_UX_ERROR_CODES,
  ShellUXError,
} from './types';
import type { WhenExpression } from './commands/when';
import { parseWhen } from './commands/when';
import { hotkeyToken } from './hotkeys';

/**
 * Strict allowlist for every identifier the host uses as a lookup key:
 * extension ids, navigation node ids and ribbon action ids.
 *
 * Lowercase alphanumerics and internal hyphens, 1–64 characters, first
 * character alphanumeric. It is an allowlist rather than a denylist, so it
 * excludes path separators (`/`, `\`, `..`), URL schemes (`:`), markup (`<`, `>`,
 * `"`), whitespace, and the leading underscores of `__proto__` — without needing to
 * enumerate what is dangerous. That is **entry-point validation**: real for every id
 * that arrives through the registry's doors, and pinned by "validateBlueprint —
 * identifier hardening" in `src/core/__tests__/validation.test.ts`.
 */
/**
 * ============================================================================
 * THE HOST CONSTANTS ARE FROZEN, AND EXACTLY WHAT THAT BUYS
 * ============================================================================
 * `EXTENSION_ID_PATTERN`, `RESERVED_IDS`, `REGISTRY_LIMITS`, `HOTKEY_KEYS` and
 * `HOTKEY_MODIFIER_REQUIRED_KEYS` are the rules every untrusted payload is
 * measured against, and they are exported from a module a plug-in can import.
 * Until GitHub issue #10 every one of them was runtime-mutable. `REGISTRY_LIMITS`
 * was `as const` — a COMPILE-TIME assertion that binds nobody who is not being
 * compiled — so `REGISTRY_LIMITS.MAX_NAV_NODES = 1e9` was an ordinary assignment,
 * and `EXTENSION_ID_PATTERN.test = () => true` shadowed the prototype method that
 * every id check calls.
 *
 * All five are now `Object.freeze`d, and the claim that buys is stated exactly:
 *
 *  - **What it buys, unconditionally:** no own property can be added, replaced or
 *    deleted on any of them. `REGISTRY_LIMITS` is a plain object, so freezing it
 *    makes it genuinely immutable. For the three `Set`s and the `RegExp` it means
 *    the interrogation methods — `has`, `test` — cannot be SHADOWED by an own
 *    property, which was the interesting attack: a plug-in that owned
 *    `HOTKEY_KEYS.has` owned the hotkey allowlist for the whole page.
 *  - **What it does NOT buy, and this is not a detail:** a frozen `Set` can still
 *    be mutated. `Set` state lives in internal slots rather than in properties, so
 *    `Object.freeze(set)` leaves `set.add(...)`, `set.delete(...)` and
 *    `set.clear()` working. `HOTKEY_KEYS.add('tab')` still widens the allowlist.
 *    Closing that would mean shipping a `Set` whose mutators throw, which is a
 *    different object from the one `ReadonlySet` describes; it was not done, and
 *    the honest statement is that these are hardened against replacement and not
 *    against a determined caller — which is the same register as ADR-0001's
 *    "No sandbox".
 *
 * Both halves are pinned by "freezes the host constants against replacement" and
 * "does not claim more than a frozen Set delivers" in
 * `src/core/__tests__/hostConstants.test.ts`.
 * ============================================================================
 */
export const EXTENSION_ID_PATTERN = Object.freeze(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * The text gate for every display string a blueprint hands the host: blueprint
 * `name`/`version`, command `label`/`icon`, nav node `label`/`icon`, nav metric
 * `description` — every call site is `validateText` below, so there is one rule
 * for all seven fields, not seven.
 *
 * `TEXT_FORBIDDEN_PATTERN` refuses the whole string outright: bidi control
 * characters (U+061C, U+200E-200F, the embeddings/overrides U+202A-202E, the
 * isolates U+2066-2069), the deprecated format controls U+206A-206F, the
 * interlinear-annotation controls U+FFF9-FFFB, the line/paragraph separators
 * U+2028-2029, and Unicode `Cc`. These are layout-changing or otherwise not
 * display text at all, so no position in the string is an acceptable place for
 * one — refusing the whole field is the only honest response.
 *
 * `TEXT_INVISIBLE_PATTERN` is different in kind: these characters draw nothing,
 * but are legitimate NEXT TO visible text (ZWJ/ZWNJ hold real scripts and emoji
 * together, a variation selector picks emoji-presentation, soft hyphen is a
 * real hyphenation hint) — GitHub issue #172. `validateText` strips a FRESH
 * copy of this pattern only to decide whether the string is blank; the
 * original, unstripped string is what is stored. See "the shared text patterns
 * carry no global flag" below for why every call site must build its own
 * `'gu'` copy rather than reusing this export directly.
 *
 * Both are **entry-point validation**: real at `validateText`'s door, and say
 * nothing about a string that reaches display some other way. Both are
 * `Object.freeze`d against replacement, same as `EXTENSION_ID_PATTERN` above —
 * and that claim is exactly as large as it is there and no larger: it stops an
 * own property being added, replaced or deleted, and nothing else. `lastIndex`
 * IS an own, writable data property, so freezing genuinely does make a direct
 * write to it throw a `TypeError` in this always-strict ES-module code —
 * measured: `Object.freeze(/a/u).lastIndex = 1` throws "Cannot assign to read
 * only property 'lastIndex'", with no partial effect either way.
 *
 * `.compile()` is a different and worse case, not covered by that claim: it
 * rewrites `source`/`flags`/`global` from internal slots freeze does not
 * protect (the same class of gap as a frozen `Set`'s `.add()` still
 * working), and only THEN throws, when it reaches the one step that touches
 * an own property (resetting `lastIndex` to 0). Measured: a frozen clone's
 * `.compile('b', 'g')` still throws that same `TypeError` — but by the time
 * it does, `.source` already reads `'b'` and `.flags` already reads `'g'`.
 * Calling `.compile()` on a frozen `RegExp` is not a safe no-op attempt; it
 * is a partial, irreversible mutation into a different pattern that happens
 * to also throw. Nothing in this codebase calls `.compile()` on either
 * export, so this is a documented latent hazard, not a live one.
 *
 * Both of the above cost nothing here regardless, because `.test()`/`.exec()`
 * only ever read or write `lastIndex` for a `g`- or `y`-flagged pattern, and
 * neither export carries one (see "the shared text patterns carry no global
 * flag" below) — the same register as `EXTENSION_ID_PATTERN`'s "hardened
 * against replacement, not against a determined caller" above. Neither
 * pattern is described as "fixed" or "immutable" for that reason: replacing
 * `.test` as an own property is
 * refused, but neither export claims more than that.
 *
 * `electron/main/plugins/hostContract.ts` carries mirrored copies for the
 * package validator, since main cannot import `src/` (ADR-0001 Amendment O
 * decision 6) — those copies are a **guardrail**, not entry-point validation:
 * real only if kept in step with these, which a baseline test enforces.
 *
 * A change to either pattern, including a widening, is a `major` bump in
 * `src/sdk/apiSurface.ts`'s `diffSurface` — see `ApiSurface.textForbiddenPattern`
 * / `.textInvisiblePattern` and `docs/adr/0006-runtime-plugin-host.md`.
 *
 * *Tests:* `src/core/__tests__/validation.test.ts` — "rejects a bidi control,
 * a C0/C1 control, a line/paragraph separator or an interlinear-annotation
 * control (D-56, #172)", "a string made only of two or more different
 * invisible characters is blank (D-56, #172)", "a Persian name held together
 * by ZWNJ is not blank (D-56, #172)", "an emoji with a variation selector is
 * not blank (D-56, #172)"; `src/core/__tests__/hostConstants.test.ts` —
 * "the shared text patterns carry no global flag, so repeated test calls
 * agree" and "freezing blocks a direct lastIndex write, but compile() is
 * worse than that".
 */
export const TEXT_FORBIDDEN_PATTERN = Object.freeze(/[\p{Cc}\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\uFFF9-\uFFFB\u206A-\u206F]/u);

/**
 * No `g` flag: a `g`-flagged `RegExp` is stateful across `.test()`/`.exec()`
 * calls on its OWN `lastIndex` — measured, `/a/g.test('a')` returns `true` then
 * `false` on the identical input the second time. A shared, module-level `g`
 * pattern reused across calls would silently skip characters depending on call
 * order. Every call site that strips these builds a fresh global copy inline:
 * `value.replace(new RegExp(TEXT_INVISIBLE_PATTERN.source, 'gu'), '')`. Calling
 * `.replace(TEXT_INVISIBLE_PATTERN, '')` directly removes only the FIRST match
 * (no `g`), which can leave a string of two-or-more different invisible
 * characters looking non-blank when it draws nothing at all.
 */
export const TEXT_INVISIBLE_PATTERN = Object.freeze(/[\u00AD\u115F\u1160\u180B-\u180F\u200B-\u200D\u2060-\u2065\u034F\u17B4\u17B5\u3164\uFEFF\uFFA0\uFFF0-\uFFF8\uFE00-\uFE0F\u2800\u{E0080}-\u{E0FFF}\u{E0000}-\u{E007F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}]/u);

/**
 * Identifiers rejected outright.
 *
 * `__proto__` already fails the pattern above, but `constructor` and
 * `prototype` are plain lowercase words that pass it. They are refused here so
 * that no registry key can ever collide with a well-known object-graph name —
 * belt and braces on top of the `Map`-backed store, which is what actually
 * makes prototype pollution impossible. Pinned by "register — a shifting id cannot
 * smuggle a reserved key into the store" in
 * `src/core/__tests__/registrySecurity.test.tsx`, which asserts both layers: the
 * rejection, and that no live key is ever `__proto__`.
 */
export const RESERVED_IDS: ReadonlySet<string> = Object.freeze(
  new Set(['__proto__', 'constructor', 'prototype']),
);

/**
 * Hard bounds on blueprint size. A plugin cannot make the host walk forever.
 *
 * **Entry-point validation**, and the bound applies to what is STORED rather than to
 * a number the payload can revise afterwards. Pinned by "validateBlueprint — text
 * fields", "— navigation tree" and "— ribbon actions" in
 * `src/core/__tests__/validation.test.ts`, and by "register — a lying `length` cannot
 * grow the payload after it is measured" in
 * `src/core/__tests__/registryNormalization.test.tsx`.
 */
export const REGISTRY_LIMITS = Object.freeze({
  /** Max length of any display string (`name`, `label`, `icon`). */
  MAX_TEXT_LENGTH: 256,
  /** Max length of `version`. */
  MAX_VERSION_LENGTH: 32,
  /** Max total navigation nodes across the whole tree. */
  MAX_NAV_NODES: 512,
  /** Max nesting depth of the navigation tree; roots are depth 1. */
  MAX_NAV_DEPTH: 8,
  /** Max ribbon actions contributed by a single extension. */
  MAX_RIBBON_ACTIONS: 128,
  /**
   * Max items in one `RibbonContext.selectedItemIds`.
   *
   * The odd one out in this table, and deliberately here rather than in
   * `ShellAPI.ts`: every other bound is on a REGISTERED payload and this one is
   * on a RUNTIME call, but it is the same kind of promise — a plug-in cannot
   * make the host allocate and walk forever — and splitting the bounds across
   * two modules would mean two places to look for "what is the limit on X".
   *
   * 4096 is chosen against what the field is for. A selection is something a
   * user made in a list; `MAX_NAV_NODES` is 512 and a Select-All over a
   * virtualized pane 2 is the realistic large case, so the bound sits well above
   * any plausible selection and well below a number that would make the
   * duplicate walk expensive. It bounds what is STORED, like every bound above
   * it: the count is captured once and the host-owned array is filled with
   * exactly that many entries.
   */
  MAX_SELECTED_ITEMS: 4096,
  /**
   * Max distinct context keys one extension may hold at once.
   *
   * A context key is a named fact an extension publishes so that its own ribbon
   * predicates can branch on it — `RibbonContext.contextKeys`, ADR-0001
   * Amendment K Decision 2. 64 is chosen against what the mechanism is FOR:
   * VS Code's `when` clauses, the prior art, are read by a human writing an
   * expression, and an extension needing more than a few dozen named states is
   * not describing states any more, it is using the shell as a database.
   *
   * There is deliberately no way to DELETE a key, so this bound is what stops an
   * extension growing the record without limit. Setting a key to `null` is how
   * "unset" is spelled, and a `null` key still occupies a slot — which is the
   * honest arrangement, because a key that vanished would make a predicate
   * reading it undistinguishable from one that was never set.
   */
  MAX_CONTEXT_KEYS: 64,
  /**
   * Max length of a `string` context-key value.
   *
   * Its own bound rather than `MAX_TEXT_LENGTH`, because it bounds a different
   * thing: `MAX_TEXT_LENGTH` is on a display string validated once at
   * registration, this is on a value written at runtime, as often as a plug-in
   * likes, into a record every predicate reads on every render.
   */
  MAX_CONTEXT_VALUE_LENGTH: 256,
  /**
   * Max points in one `NavigationMetric.series`.
   *
   * **Small on purpose, and the number is an argument rather than a round
   * figure.** A pane-1 metric is tier 0 of the native-host plan's three-tier
   * visualization model: a memoised path string with no chart instance behind it,
   * drawn once per navigation row, in a tree the shell re-renders on every
   * foreground change and on every badge write. Thirty-two points is a SHAPE —
   * enough to read a trend at 12px — and three thousand is a chart, which belongs
   * in a pane that has a canvas to spend on it.
   *
   * It bounds what is STORED, like every bound above it: the count is captured
   * once before the loop and the host-owned array is filled with exactly that
   * many entries, so a `Proxy` cannot grow the work after the bound was checked.
   */
  MAX_METRIC_POINTS: 32,
});

/**
 * The key names a `RibbonAction.hotkey` may bind, compared lowercased.
 *
 * An allowlist rather than "any string", for the same reason ids get one: this
 * value arrives from an untrusted manifest, and the set of keys a shell can
 * safely let a plugin claim is small, closed and worth writing down. It names
 * `event.key` values, not `event.code` values — ADR-0001 Amendment H.
 *
 * **Four groups are deliberately absent, and the absences are the interesting
 * part of the list:**
 *
 *  - **`tab`.** Tab is how a keyboard user moves between controls. An extension
 *    that owned it would break focus order for everyone, which is WCAG 2.1
 *    Success Criterion 2.1.1 Keyboard and 2.4.3 Focus Order. There is no chord
 *    involving Tab that is worth that, so Tab is not offered at all rather than
 *    offered with a warning.
 *  - **`space`.** Space activates the focused control — a button, a checkbox, a
 *    row. Claiming it globally means the focused control stops responding to the
 *    key that operates it.
 *  - **`escape`.** Escape is the shell's dismissal key: it closes the ribbon's
 *    overflow menu, cancels a drag, leaves fullscreen, and dismisses a
 *    `@radix-ui/react-dialog` dialog. An extension owning it globally would break
 *    dismissal for the whole shell at once. It is removed outright rather than
 *    made modifier-only, because a modifier-gated Escape is dead surface and not
 *    a compromise — `Ctrl+Escape` opens the Windows Start menu, and `Alt+Escape`
 *    and `Meta+Escape` are claimed by the window manager. Escape belongs to the
 *    focused component, exactly as `tab` and `space` do. ADR-0001 Amendment I.
 *  - **Every modifier as a key**: `control`, `alt`, `shift`, `meta`, `capslock`,
 *    `altgraph`. A modifier is a field on `Hotkey`; naming one as the `key` would
 *    describe a chord that fires on the modifier's own keydown, before the user
 *    has pressed anything.
 *
 * `enter` IS on the list, but may never be bound bare — see
 * `HOTKEY_MODIFIER_REQUIRED_KEYS` below for why that is a different rule from the
 * WCAG 2.1.4 one and carries a different citation.
 *
 * This module validates; it dispatches nothing. Since ISSUE-006 a chord DOES
 * fire, from `src/core/hotkeyDispatch.ts`, and the split is deliberate: one rule
 * at one door, with no second suppression at dispatch time — ADR-0001 Amendment I
 * Decision 3. Pinned by "validateBlueprint — ribbon action hotkeys" in
 * `src/core/__tests__/validation.test.ts`, whose rejection table walks all four
 * absent groups by name.
 */
export const HOTKEY_KEYS: ReadonlySet<string> = Object.freeze(
  new Set([
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'0123456789',
    'f1',
    'f2',
    'f3',
    'f4',
    'f5',
    'f6',
    'f7',
    'f8',
    'f9',
    'f10',
    'f11',
    'f12',
    'arrowup',
    'arrowdown',
    'arrowleft',
    'arrowright',
    'home',
    'end',
    'pageup',
    'pagedown',
    'enter',
    'delete',
    'insert',
    'backspace',
  ]),
);

/**
 * Keys that may never be bound bare, whatever their length.
 *
 * `enter` is on `HOTKEY_KEYS` above and is a good chord *with* a modifier —
 * `Ctrl+Enter` is the one genuinely wanted member of the family, and removing the
 * key outright would have taken it with the rest. What is refused is the BARE
 * declaration, on **activation** grounds: Enter activates the focused control —
 * the default button, a focused link, a table row — and submits a form, so a bare
 * Enter chord fires on top of the activation the user actually asked for. That is
 * the same failure mode `space` is excluded outright for, and it is why the two
 * keys no longer sit on opposite sides of the list explaining only one of them.
 *
 * **This is NOT the WCAG 2.2 §2.1.4 rule and deliberately does not cite it.**
 * 2.1.4 Character Key Shortcuts is about single printable *character* keys, and it
 * genuinely does not reach Enter; borrowing the citation would make the citation
 * inaccurate, which is exactly the drift ADR-0001 Amendment G exists to stop. The
 * two rules meet at one check in `normalizeHotkey` — one door — but they carry
 * separate messages, and the Enter message names neither the criterion nor its
 * level. ADR-0001 Amendment I.
 *
 * Pinned by "validateBlueprint — the activation rule for keys that must carry a
 * modifier" in `src/core/__tests__/validation.test.ts`, which asserts the bare
 * rejection, that the message does NOT cite 2.1.4, that `Ctrl+Enter` is accepted,
 * and that every member of this set is refused bare — so a key added here is
 * covered the moment it lands.
 */
export const HOTKEY_MODIFIER_REQUIRED_KEYS: ReadonlySet<string> = Object.freeze(new Set(['enter']));

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How a value answers the array question — three-state, because the question can
 * FAIL rather than answer.
 *
 * `Array.isArray` is the only type predicate in this file that can throw: handed
 * a revoked `Proxy` it raises a raw `TypeError`, because every internal method on
 * a revoked `Proxy` does. `typeof` is no defence against that — it answers
 * `"object"` without trapping, so a revoked `Proxy` walks straight through the
 * `typeof` checks in the validators below and reaches `describeType` on the
 * failure path with the throw still ahead of it.
 */
type ArrayCheck = 'array' | 'not-array' | 'revoked';

/**
 * Total replacement for `Array.isArray`. Never throws, so no caller needs a
 * guard of its own, and every rejection `normalizeBlueprint` can produce stays a
 * `ShellUXError`.
 *
 * `'revoked'` is deliberately a third answer rather than being folded into
 * `'not-array'`. Folding them would make `isRecord` return `true` for a revoked
 * `Proxy` — `typeof` is `"object"`, it is not `null`, and it is not an array —
 * which would send it on to `requireField`, whose property read throws the same
 * raw `TypeError` one step later. Refusing it here is what closes the leak
 * rather than moving it. Pinned by "validateBlueprint — a revoked Proxy" in
 * `src/core/__tests__/validation.test.ts`, which walks every field position that
 * can reach one of the five call sites.
 */
function checkArray(value: unknown): ArrayCheck {
  try {
    return Array.isArray(value) ? 'array' : 'not-array';
  } catch {
    return 'revoked';
  }
}

/** Non-throwing `Array.isArray`, narrowing for the bounded walks below. */
function isArrayValue(value: unknown): value is readonly unknown[] {
  return checkArray(value) === 'array';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && checkArray(value) === 'not-array';
}

function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const kind = checkArray(value);
  if (kind === 'array') {
    return 'an array';
  }
  if (kind === 'revoked') {
    // Named exactly rather than reported by `typeof`, which would call it `a
    // value of type "object"` and tell a plugin author nothing.
    return 'a revoked Proxy';
  }
  return `a value of type "${typeof value}"`;
}

function requireField(source: Record<string, unknown>, field: string, path: string): unknown {
  const value = source[field];
  if (value === undefined) {
    throw new ShellUXError('MISSING_FIELD', `Required field "${path}" is missing.`, path);
  }
  return value;
}

function validateId(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a string; received ${describeType(value)}.`,
      path,
    );
  }
  // Reserved check runs BEFORE the pattern check so that the three
  // prototype-pollution keys always report as RESERVED_ID, giving callers one
  // unambiguous code to match on instead of two depending on spelling.
  if (RESERVED_IDS.has(value)) {
    throw new ShellUXError(
      'RESERVED_ID',
      `Field "${path}" must not use the reserved identifier "${value}".`,
      path,
    );
  }
  if (!EXTENSION_ID_PATTERN.test(value)) {
    // `JSON.stringify` is safe HERE and only here: `value` has been proven to
    // be a primitive string three lines above, so stringifying it cannot
    // re-enter plugin code. Do not copy this line to a site where the value's
    // type is still unknown — see `describeUntrusted` in ShellAPI.ts.
    throw new ShellUXError(
      'INVALID_ID',
      `Field "${path}" must match ${String(EXTENSION_ID_PATTERN)}; received ${JSON.stringify(value)}.`,
      path,
    );
  }
  return value;
}

function validateText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a string; received ${describeType(value)}.`,
      path,
    );
  }
  if (TEXT_FORBIDDEN_PATTERN.test(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must not contain a bidi control, a C0/C1 control, a line or paragraph separator, an interlinear-annotation control, or a deprecated format control.`,
      path,
    );
  }
  // Fresh, locally-built `g` copy: `TEXT_INVISIBLE_PATTERN` itself carries no
  // `g` flag (see its docblock), and a stripped copy is used ONLY to decide
  // blankness — the original, unstripped `value` is what is returned below.
  const strippedForBlankCheck = value.replace(new RegExp(TEXT_INVISIBLE_PATTERN.source, 'gu'), '');
  if (strippedForBlankCheck.trim().length === 0) {
    throw new ShellUXError('INVALID_FIELD', `Field "${path}" must not be blank.`, path);
  }
  if (value.length > maxLength) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum length of ${maxLength} characters.`,
      path,
    );
  }
  return value;
}

function validateFunction(value: unknown, path: string): void {
  if (typeof value !== 'function') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a function; received ${describeType(value)}.`,
      path,
    );
  }
}

/**
 * A React component is a function, or an object for the `memo`/`forwardRef`
 * wrappers. Anything else cannot be rendered, so it is refused here rather
 * than at render time inside the pane.
 */
function validateViewComponent(value: unknown, path: string): void {
  if (typeof value === 'function') {
    return;
  }
  if (isRecord(value)) {
    return;
  }
  throw new ShellUXError(
    'INVALID_FIELD',
    `Field "${path}" must be a React component; received ${describeType(value)}.`,
    path,
  );
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * ============================================================================
 * WHY THE REGISTRY STORES A COPY AND NOT THE PLUGIN'S OBJECT
 * ============================================================================
 * Validating a payload and then storing the caller's live object is not a
 * defence. Every field except a captured primitive stays re-readable — a getter
 * runs again on the next read, a Proxy `length` reports one number while it is
 * measured and another afterwards — and every field stays MUTABLE, so a plugin
 * can simply edit its own blueprint after registration succeeds. A bounds check
 * against a number the plugin can change later checks nothing.
 *
 * So validation and storage are one pass. Each untrusted field is read EXACTLY
 * ONCE, checked as the resulting local, and that local — a fresh primitive, or
 * a fresh array of exactly the length that was bounds-checked — is written into
 * a host-owned record. The record is frozen at every host-owned level before it
 * is stored, and it is what `getExtension` and `listExtensions` hand out. What
 * was validated is therefore exactly what is stored.
 *
 * **The word "structurally" used to appear in that sentence and has been removed.**
 * ADR-0001 Amendment F reserved *structural* for the `Map`-backed stores, where
 * prototype pollution is impossible by construction rather than by filtering.
 * Normalisation is an **integrity control** — real and unconditional — but it is
 * bought by code that runs, not by a property of the data structure, and using the
 * reserved word for it was the drift Amendment F closed everywhere else. Pinned by
 * "register — the stored record is host-owned" and "register — a lying `length`
 * cannot grow the payload after it is measured" in
 * `src/core/__tests__/registryNormalization.test.tsx`, and by "register — a shifting
 * id cannot hijack another extension" in
 * `src/core/__tests__/registrySecurity.test.tsx`.
 *
 * TWO THINGS ARE DELIBERATELY *NOT* COPIED:
 *
 * 1. Functions and React components — `views.pane2`, `views.pane3`,
 *    `isVisible`, `onExecute`. They are carried across BY REFERENCE after being
 *    type-checked. A function cannot be cloned without breaking its closure,
 *    and a component reference must keep its identity or React remounts the
 *    pane on every render. They are also not frozen: they belong to the plugin,
 *    and freezing another party's component object is both outside this
 *    module's remit and a way to break `forwardRef`/`memo` internals.
 *
 * 2. The plugin's original object is retained privately, as
 *    `RegistryEntry.source`, for ONE purpose: the StrictMode idempotency check
 *    in `register` compares by reference identity. It is never read from, never
 *    exposed, and never returned.
 * ============================================================================
 */

/** Mutable accumulator threaded through the navigation-tree walk. */
interface NavWalkState {
  readonly seenIds: Set<string>;
  visited: number;
  /** The field the whole tree arrived under — `navigationTree` or `nodes`. */
  readonly root: string;
}

/** Builder shape for a normalised node; frozen into a `NavigationNode`. */
interface MutableNavigationNode {
  id: string;
  label: string;
  icon?: string;
  badgeCount?: number;
  metric?: NavigationMetric;
  children?: readonly NavigationNode[];
}

/** Builder shape for a normalised metric; frozen into a `NavigationMetric`. */
interface MutableNavigationMetric {
  kind: NavigationMetricKind;
  value: number;
  series?: readonly number[];
  description: string;
}

/** Builder shape for a normalised command; frozen into a `Command`. */
interface MutableCommand {
  id: string;
  label: string;
  icon: string;
  isDisabled?: boolean;
  hotkey?: Hotkey;
  when?: string;
  whenExpression?: WhenExpression;
  category?: CommandCategory;
  surfaces?: readonly CommandSurface[];
  priority?: number;
  isVisible: Command['isVisible'];
  onExecute: Command['onExecute'];
}

/**
 * One `Hotkey` modifier: a boolean when present, `false` when absent.
 *
 * An explicit `undefined` counts as absent, matching `badgeCount`, `children`
 * and `isDisabled` — a hand-written JS plugin is likely to spell "no value" that
 * way, and `exactOptionalPropertyTypes` means the compiler cannot have spelled
 * it that way on purpose.
 *
 * It returns `false` rather than `undefined` for an absent modifier because the
 * normalised `Hotkey` materialises all four. See `normalizeHotkey`.
 */
function validateOptionalModifier(
  source: Record<string, unknown>,
  field: string,
  path: string,
): boolean {
  const value = source[field];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a boolean when present; received ${describeType(value)}.`,
      path,
    );
  }
  return value;
}

/**
 * Why a bare chord was refused. Two grounds, two messages, one shared check.
 *
 * The grounds are genuinely different and the messages do not borrow each other's
 * citation:
 *
 *  - A **single-character** key with no modifier is refused for WCAG 2.2 Success
 *    Criterion 2.1.4 Character Key Shortcuts (Level A). That message names the
 *    criterion, because an author who hits it should be able to look it up.
 *  - A key on `HOTKEY_MODIFIER_REQUIRED_KEYS` is refused because it **activates
 *    the focused control**. 2.1.4 does not reach it — it is not a character key —
 *    so that message names no criterion at all. Citing 2.1.4 here would be an
 *    inaccurate citation, which ADR-0001 Amendment G treats as the defect it is.
 *
 * The two sets are disjoint today (`enter` is five characters long), so exactly
 * one branch answers for any given key.
 */
function bareChordMessage(key: string, path: string): string {
  if (HOTKEY_MODIFIER_REQUIRED_KEYS.has(key)) {
    return (
      `Field "${path}" binds "${key}" with no "ctrl", "alt" or "meta" modifier. "${key}" ` +
      `activates the focused control — the default button, a focused link, a table row — so a ` +
      `bare shortcut on it would fire on top of the activation the user asked for. It must ` +
      `carry "ctrl", "alt" or "meta"; "shift" does not satisfy this rule, because Shift does ` +
      `not stop the activation. ADR-0001 Amendment I.`
    );
  }
  return (
    `Field "${path}" binds the single-character key "${key}" with no "ctrl", "alt" or "meta" ` +
    `modifier. WCAG 2.2 Success Criterion 2.1.4 Character Key Shortcuts (Level A) forbids a ` +
    `character-key-only shortcut; "shift" does not satisfy it, because Shift produces a ` +
    `character too. Function keys and named navigation keys are exempt.`
  );
}

/**
 * Validate a `hotkey` payload and build the host-owned chord for it.
 *
 * **The stored object materialises all four modifiers as explicit booleans**,
 * even though `Hotkey` declares them optional. That is not tidiness: it makes
 * `hotkeyToken` a total function with no `??` and no `undefined` branch, so the
 * canonical token that deduplicates today and will look up a dispatch target
 * later cannot depend on how the plugin chose to spell an absent modifier. It is
 * frozen before it is assigned into the action, which is itself frozen — so the
 * chord the registry checked is the chord the registry hands out. Pinned by
 * "freezes the stored hotkey" and "is unaffected by the plugin mutating its own
 * hotkey afterwards" in `src/core/__tests__/registryNormalization.test.tsx`.
 *
 * `seenChords` is threaded alongside `seenIds` for the same reason and at the
 * same cost: the walk over `ribbonActions` already visits every action once, so
 * intra-extension chord uniqueness is decided in that walk rather than in a
 * second pass. Cross-extension conflicts are NOT rejected — see ADR-0001
 * Amendment H, and the `DUPLICATE_HOTKEY` docblock in `types.ts`.
 */
function normalizeHotkey(value: unknown, path: string, seenChords: Set<string>): Hotkey {
  if (!isRecord(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be an object; received ${describeType(value)}.`,
      path,
    );
  }

  const keyPath = `${path}.key`;
  const rawKey = requireField(value, 'key', keyPath);
  if (typeof rawKey !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${keyPath}" must be a string; received ${describeType(rawKey)}.`,
      keyPath,
    );
  }
  // Read once, lowercased once, and it is the lowercased local that is both
  // checked and stored — the same single-read discipline the ids get. Pinned by
  // "reads hotkey.key exactly once, so no later read can differ from the checked
  // one" and "cannot smuggle a key past the HOTKEY_KEYS allowlist on a later
  // read", both under "register — a shifting hotkey field cannot hijack the
  // stored chord" in `src/core/__tests__/registrySecurity.test.tsx`, which counts
  // the reads through a shifting getter on `key` and on each of the four
  // modifiers.
  const key = rawKey.toLowerCase();
  if (!HOTKEY_KEYS.has(key)) {
    // Safe to stringify: `rawKey` is a proven primitive string. See `validateId`.
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${keyPath}" must name a key from the host allowlist; received ${JSON.stringify(rawKey)}.`,
      keyPath,
    );
  }

  const ctrl = validateOptionalModifier(value, 'ctrl', `${path}.ctrl`);
  const alt = validateOptionalModifier(value, 'alt', `${path}.alt`);
  const shift = validateOptionalModifier(value, 'shift', `${path}.shift`);
  const meta = validateOptionalModifier(value, 'meta', `${path}.meta`);

  // ---- No bare chord: two rules, one door ----------------------------------
  // ONE check, deliberately, rather than a second suppression later at dispatch
  // time. Two copies of a rule drift, and the door a declaration must pass
  // through is here.
  //
  // 1. WCAG 2.2 §2.1.4 Character Key Shortcuts (Level A). A shortcut that is a
  //    single printable character and nothing else is unusable for speech-input
  //    users, whose dictation emits characters, and for anyone who types into a
  //    surface the shortcut is live over. The criterion is met by one of three
  //    routes — turn it off, remap it, or make it active only on focus — or by
  //    not creating one, which is the route taken here: the chord must carry
  //    Ctrl, Alt or Meta.
  //
  // 2. `HOTKEY_MODIFIER_REQUIRED_KEYS` — today, `enter`. Refused on ACTIVATION
  //    grounds, not on 2.1.4 grounds: Enter is not a character key, so the
  //    criterion does not reach it, and the message for it names no criterion.
  //    See `bareChordMessage`.
  //
  // Shift does NOT count for either. Shift+K is still a character key; it
  // produces "K". Shift+Enter still activates the focused control. Function keys
  // and the named navigation keys stay exempt: they are not characters, and
  // nothing about them activates what has focus.
  if ((key.length === 1 || HOTKEY_MODIFIER_REQUIRED_KEYS.has(key)) && !ctrl && !alt && !meta) {
    throw new ShellUXError('INVALID_FIELD', bareChordMessage(key, path), path);
  }

  const hotkey: Hotkey = Object.freeze({ key, ctrl, alt, shift, meta });

  const token = hotkeyToken(hotkey);
  if (seenChords.has(token)) {
    throw new ShellUXError(
      'DUPLICATE_HOTKEY',
      `Field "${path}" repeats the hotkey "${token}" within the same extension.`,
      path,
    );
  }
  seenChords.add(token);

  return hotkey;
}

/**
 * One metric scalar, held to the clamp/reject rule — the ONE implementation of
 * it, for both doors that reach the field.
 *
 * **The asymmetry is the decision and it is not an inconsistency.** An
 * out-of-range value is CLAMPED: `1.4` is a scaling mistake, there is an
 * obviously right answer, and refusing a whole blueprint — every navigation node,
 * every command, both views — over one badly scaled bar is out of proportion to
 * the error. A non-finite value is REFUSED: no clamp turns `NaN` into a fraction,
 * and every candidate answer invents a quantity the extension never published. It
 * is the rule `assertValidContextKeyValue` applies to a context-key number,
 * reached from a different door.
 *
 * It is EXPORTED so that `IShellAPI.setNavMetric` applies this function rather
 * than a second copy of the sentence — the same one-rule-one-door argument
 * `assertValidIdentifier` makes by importing `EXTENSION_ID_PATTERN` from here
 * instead of restating it. The dependency runs one way only: `ShellAPI.ts`
 * imports from this module and this module imports nothing back.
 *
 * `method` and `field` are parameters because both doors reach here — the
 * registration door and the runtime door — and a rejection has to name the one
 * the caller actually used.
 *
 * Pinned by "clamps an out-of-range metric value at both doors and refuses a
 * non-finite one" in `src/core/__tests__/navMetric.test.tsx`.
 *
 * @throws {ShellUXError} `INVALID_FIELD` when `value` is not a finite number.
 */
export function clampMetricValue(value: unknown, method: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `${method}: "${field}" must be a finite number; received ${describeType(value)}. There is no clamp that makes a non-finite value a fraction, so it is refused rather than corrected.`,
      field,
    );
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Validate a `metric` payload and build the host-owned record for it.
 *
 * The same single-read discipline `normalizeNavigationNode` itself uses: every
 * field is read once into a local, the local is what is both checked AND stored,
 * and the series length is captured ONCE before the loop that fills a host-owned
 * array with exactly that many entries. A `Proxy` reporting one length while it
 * is measured and another afterwards therefore cannot grow what the host keeps.
 * Pinned by "captures the series length once, so a shifting length cannot grow
 * what is stored" and "stores a host-owned frozen metric that a plug-in cannot
 * mutate afterwards" in `src/core/__tests__/navMetric.test.tsx`.
 *
 * **`kind` has NO FALLBACK**, unlike `icon` — see `NavigationMetricKind` in
 * `types.ts` for the argument. An unknown glyph key is a wrong picture beside a
 * correct label; an unknown SHAPE has no rendering that means "the host did not
 * recognise this", so it is `INVALID_FIELD` at the door. Pinned by "refuses a
 * metric kind the host does not publish" in the same file.
 *
 * **`description` is REQUIRED**, for the reason `label` is: it is the
 * non-colour, non-shape channel WCAG 2.2 §1.4.1 asks for, and making it optional
 * would put the accessible case behind an opt-in. Pinned by "refuses a metric
 * with no description", same file.
 *
 * **There is no `colour` field to normalise, deliberately.** A plug-in-supplied
 * colour is a colour outside `design/`, unreachable by
 * `design/contrast-manifest.json` and by `npm run tokens:check`. A metric draws
 * in `currentColor`.
 */
function normalizeNavigationMetric(value: unknown, path: string): NavigationMetric {
  if (!isRecord(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be an object; received ${describeType(value)}.`,
      path,
    );
  }

  const kindPath = `${path}.kind`;
  const rawKind = requireField(value, 'kind', kindPath);
  if (typeof rawKind !== 'string' || !NAVIGATION_METRIC_KINDS.has(rawKind)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${kindPath}" must name one of ${[...NAVIGATION_METRIC_KINDS].join(', ')}; received ${describeType(rawKind)}. An unknown shape has no honest fallback, so it is refused rather than drawn as something else.`,
      kindPath,
    );
  }

  const valuePath = `${path}.value`;
  const scalar = clampMetricValue(requireField(value, 'value', valuePath), 'register', valuePath);

  const descriptionPath = `${path}.description`;
  const description = validateText(
    requireField(value, 'description', descriptionPath),
    descriptionPath,
    REGISTRY_LIMITS.MAX_TEXT_LENGTH,
  );

  const metric: MutableNavigationMetric = {
    kind: rawKind as NavigationMetricKind,
    value: scalar,
    description,
  };

  const series = value['series'];
  if (series !== undefined) {
    if (!isArrayValue(series)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${path}.series" must be an array; received ${describeType(series)}.`,
        `${path}.series`,
      );
    }
    // Captured ONCE, before the loop, exactly as `children.length` is below.
    const pointCount = series.length;
    if (pointCount > REGISTRY_LIMITS.MAX_METRIC_POINTS) {
      throw new ShellUXError(
        'PAYLOAD_TOO_LARGE',
        `Field "${path}.series" exceeds the maximum of ${REGISTRY_LIMITS.MAX_METRIC_POINTS} points.`,
        `${path}.series`,
      );
    }
    const points: number[] = [];
    for (let index = 0; index < pointCount; index += 1) {
      points.push(clampMetricValue(series[index], 'register', `${path}.series[${index}]`));
    }
    metric.series = Object.freeze(points);
  }

  return Object.freeze(metric);
}

function normalizeNavigationNode(
  value: unknown,
  path: string,
  depth: number,
  state: NavWalkState,
): NavigationNode {
  if (depth > REGISTRY_LIMITS.MAX_NAV_DEPTH) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum navigation depth of ${REGISTRY_LIMITS.MAX_NAV_DEPTH}.`,
      path,
    );
  }
  if (!isRecord(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be an object; received ${describeType(value)}.`,
      path,
    );
  }

  state.visited += 1;
  if (state.visited > REGISTRY_LIMITS.MAX_NAV_NODES) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${state.root}" exceeds the maximum of ${REGISTRY_LIMITS.MAX_NAV_NODES} nodes.`,
      state.root,
    );
  }

  const idPath = `${path}.id`;
  const id = validateId(requireField(value, 'id', idPath), idPath);
  if (state.seenIds.has(id)) {
    throw new ShellUXError(
      'DUPLICATE_ID',
      `Field "${idPath}" repeats navigation node id "${id}" within the same tree.`,
      idPath,
    );
  }
  state.seenIds.add(id);

  const labelPath = `${path}.label`;
  const label = validateText(
    requireField(value, 'label', labelPath),
    labelPath,
    REGISTRY_LIMITS.MAX_TEXT_LENGTH,
  );

  const node: MutableNavigationNode = { id, label };

  // Optional fields treat an explicit `undefined` as absent, matching how a
  // hand-written JS plugin is likely to spell "no value".
  //
  // `icon` is held to exactly what `RibbonAction.icon` is held to — a non-blank
  // string within `MAX_TEXT_LENGTH` — because it is the same kind of value: an
  // UNTRUSTED lookup key into the host's own icon table, read once here and
  // stored as the resulting primitive. The registry does not know which keys the
  // table publishes and deliberately does not check: the vocabulary is a
  // rendering concern that can grow without a registry change, and an unknown
  // key resolves to the host's fallback glyph rather than to nothing. See
  // `NavigationNode.icon` in `types.ts` and the icon table in
  // `src/components/ui/shellIcons.tsx`.
  const icon = value['icon'];
  if (icon !== undefined) {
    node.icon = validateText(icon, `${path}.icon`, REGISTRY_LIMITS.MAX_TEXT_LENGTH);
  }

  const badgeCount = value['badgeCount'];
  if (badgeCount !== undefined) {
    if (typeof badgeCount !== 'number' || !Number.isSafeInteger(badgeCount) || badgeCount < 0) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${path}.badgeCount" must be a non-negative safe integer.`,
        `${path}.badgeCount`,
      );
    }
    node.badgeCount = badgeCount;
  }

  // Read once into a local, exactly as `icon` and `badgeCount` are, and the
  // record built from it is host-owned and frozen — so a plug-in mutating its
  // own metric object after registration changes nothing the shell draws.
  const metric = value['metric'];
  if (metric !== undefined) {
    node.metric = normalizeNavigationMetric(metric, `${path}.metric`);
  }

  const children = value['children'];
  if (children !== undefined) {
    if (!isArrayValue(children)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${path}.children" must be an array; received ${describeType(children)}.`,
        `${path}.children`,
      );
    }
    // `length` is captured once. The array check is true for a Proxy wrapping
    // an array, and a Proxy `get` trap may return a different length on every
    // read; re-reading it in the loop condition would let a payload grow the
    // work the host does after the bounds were checked. The host-owned array
    // below is filled with exactly `childCount` normalised entries, so the
    // count that was checked is also the count that is stored.
    const childCount = children.length;
    const normalizedChildren: NavigationNode[] = [];
    for (let index = 0; index < childCount; index += 1) {
      normalizedChildren.push(
        normalizeNavigationNode(children[index], `${path}.children[${index}]`, depth + 1, state),
      );
    }
    node.children = Object.freeze(normalizedChildren);
  }

  return Object.freeze(node);
}

/**
 * Normalise a WHOLE navigation tree into a fresh, deep-frozen host-owned array.
 *
 * **The one validator for a tree, at both doors.** `register` runs it over a
 * blueprint's `navigationTree`, and `IShellAPI.setNavigationTree` runs it over
 * every replacement (ADR-0006 decision 8, GitHub issue #16), so a tree cannot be
 * held to a weaker rule after registration than at it. `root` is the field name
 * the caller's rejection messages are rooted at — `navigationTree` at
 * registration, `nodes` at the runtime door.
 *
 * The array is read once: its length captured, each element read exactly once.
 * The node-count bound applies to what is normalised rather than to a `length`
 * the payload can revise afterwards, and the depth bound to every path. Nothing
 * of the caller's is retained. *Tests:*
 * `src/core/__tests__/navigationTree.test.tsx` — "setNavigationTree re-normalises
 * the whole tree at the door".
 *
 * @throws {ShellUXError} `INVALID_FIELD`, `MISSING_FIELD`, `INVALID_ID`,
 *   `RESERVED_ID`, `DUPLICATE_ID` or `PAYLOAD_TOO_LARGE`, exactly as `register`
 *   raises them for a bad tree.
 */
export function normalizeNavigationTree(candidate: unknown, root: string): readonly NavigationNode[] {
  if (!isArrayValue(candidate)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${root}" must be an array; received ${describeType(candidate)}.`,
      root,
    );
  }
  const count = candidate.length;
  const state: NavWalkState = { seenIds: new Set<string>(), visited: 0, root };
  const nodes: NavigationNode[] = [];
  for (let index = 0; index < count; index += 1) {
    nodes.push(normalizeNavigationNode(candidate[index], `${root}[${index}]`, 1, state));
  }
  return Object.freeze(nodes);
}

/** The three hook names `ExtensionLifecycle` declares, in the order they are read. */
const LIFECYCLE_HOOKS = ['onActivate', 'onDeactivate', 'onRelease'] as const;

/**
 * Normalise a blueprint's optional `lifecycle` into a frozen host-owned object.
 *
 * Each hook is read ONCE and must be a function or absent; the host calls the
 * function it copied here, so replacing a hook on the plug-in's own object
 * afterwards changes nothing. The functions themselves are the plug-in's and are
 * not frozen, for the reason `views` are not. Unknown keys are ignored, as they
 * are everywhere else in a blueprint. ADR-0006 decision 8, GitHub issue #17.
 */
function normalizeLifecycle(value: unknown): ExtensionLifecycle {
  if (!isRecord(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "lifecycle" must be an object; received ${describeType(value)}.`,
      'lifecycle',
    );
  }
  const lifecycle: { -readonly [K in keyof ExtensionLifecycle]: ExtensionLifecycle[K] } = {};
  for (const hook of LIFECYCLE_HOOKS) {
    const declared = value[hook];
    if (declared === undefined) {
      continue;
    }
    validateFunction(declared, `lifecycle.${hook}`);
    lifecycle[hook] = declared as never;
  }
  return Object.freeze(lifecycle);
}

/**
 * Validate an optional `category` against the closed host vocabulary.
 *
 * **No fallback, deliberately, and the asymmetry with `icon` is the point.** An
 * unknown icon key resolves to a host glyph because a wrong picture still leaves
 * the command labelled and reachable. An unknown category has no fallback that is
 * not a lie about where the command lives: filing it under the first bucket, or
 * under an invented "Other", tells the user something the manifest never said and
 * they have no way to correct. See the `CommandCategory` docblock in `types.ts`.
 */
function normalizeCategory(value: unknown, path: string): CommandCategory {
  if (typeof value !== 'string') {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a string; received ${describeType(value)}.`,
      path,
    );
  }
  const match = COMMAND_CATEGORIES.find((candidate) => candidate === value);
  if (match === undefined) {
    // `value` is a proven primitive string, so stringifying it invokes nothing.
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be one of ${COMMAND_CATEGORIES.join(', ')}; received ` +
        `${JSON.stringify(value)}. There is deliberately no fallback category: an unknown ` +
        `bucket would file the command somewhere its author never asked for.`,
      path,
    );
  }
  return match;
}

/**
 * Validate an optional `surfaces` array into a host-owned frozen copy.
 *
 * Read once into a host array before anything is checked, exactly as
 * `setSelectedItems` does, so a `length` that shifts between the measurement and
 * the walk cannot grow what is stored. A repeated surface is rejected rather than
 * collapsed, for the same reason a repeated selected id is: a list naming the same
 * entry twice is the caller's bug and quietly fixing it returns a different list
 * from the one that was declared.
 */
function normalizeSurfaces(value: unknown, path: string): readonly CommandSurface[] {
  if (!isArrayValue(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be an array; received ${describeType(value)}.`,
      path,
    );
  }
  const count = value.length;
  if (count > COMMAND_SURFACES.size) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${path}" exceeds the maximum of ${COMMAND_SURFACES.size} surfaces.`,
      path,
    );
  }
  const seen = new Set<string>();
  const surfaces: CommandSurface[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryPath = `${path}[${index}]`;
    const entry: unknown = value[index];
    if (typeof entry !== 'string' || !COMMAND_SURFACES.has(entry)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${entryPath}" must be one of ${[...COMMAND_SURFACES].join(', ')}; received ` +
          `${describeType(entry)}.`,
        entryPath,
      );
    }
    if (seen.has(entry)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${entryPath}" repeats surface "${entry}".`,
        entryPath,
      );
    }
    seen.add(entry);
    surfaces.push(entry as CommandSurface);
  }
  return Object.freeze(surfaces);
}

/** Validate an optional `priority`. A safe integer; higher sorts first. */
function normalizePriority(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be a safe integer; received ${describeType(value)}.`,
      path,
    );
  }
  // `-0` compares equal to `0` but stringifies differently, and a sort key that
  // is not the one that was written is a small lie the host does not need to tell.
  return Object.is(value, -0) ? 0 : value;
}

function normalizeCommand(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  seenChords: Set<string>,
): Command {
  if (!isRecord(value)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${path}" must be an object; received ${describeType(value)}.`,
      path,
    );
  }

  const idPath = `${path}.id`;
  const id = validateId(requireField(value, 'id', idPath), idPath);
  if (seenIds.has(id)) {
    throw new ShellUXError(
      'DUPLICATE_ID',
      `Field "${idPath}" repeats ribbon action id "${id}" within the same extension.`,
      idPath,
    );
  }
  seenIds.add(id);

  const labelPath = `${path}.label`;
  const label = validateText(
    requireField(value, 'label', labelPath),
    labelPath,
    REGISTRY_LIMITS.MAX_TEXT_LENGTH,
  );

  const iconPath = `${path}.icon`;
  const icon = validateText(
    requireField(value, 'icon', iconPath),
    iconPath,
    REGISTRY_LIMITS.MAX_TEXT_LENGTH,
  );

  const isVisiblePath = `${path}.isVisible`;
  const isVisible = requireField(value, 'isVisible', isVisiblePath);
  validateFunction(isVisible, isVisiblePath);

  const onExecutePath = `${path}.onExecute`;
  const onExecute = requireField(value, 'onExecute', onExecutePath);
  validateFunction(onExecute, onExecutePath);

  const command: MutableCommand = {
    id,
    label,
    icon,
    // Carried by reference, never cloned: these must stay callable and keep
    // their identity. They are the plugin's objects and are left unfrozen.
    isVisible: isVisible as Command['isVisible'],
    onExecute: onExecute as Command['onExecute'],
  };

  const isDisabled = value['isDisabled'];
  if (isDisabled !== undefined) {
    if (typeof isDisabled !== 'boolean') {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${path}.isDisabled" must be a boolean when present.`,
        `${path}.isDisabled`,
      );
    }
    command.isDisabled = isDisabled;
  }

  const hotkey = value['hotkey'];
  if (hotkey !== undefined) {
    command.hotkey = normalizeHotkey(hotkey, `${path}.hotkey`, seenChords);
  }

  // Parsed HERE, once, at the door — not on every render of every surface. A
  // malformed expression is therefore a registration rejection naming the field,
  // in the two codes `parseWhen` raises, rather than a command that silently
  // never appears. `whenExpression` is host-derived: whatever a plug-in put in
  // that field is not read, so declaring it is not a way to smuggle a tree past
  // the parser.
  const when = value['when'];
  if (when !== undefined) {
    const expression = parseWhen(when, `${path}.when`);
    command.when = expression.source;
    command.whenExpression = expression;
  }

  const category = value['category'];
  if (category !== undefined) {
    command.category = normalizeCategory(category, `${path}.category`);
  }

  const surfaces = value['surfaces'];
  if (surfaces !== undefined) {
    command.surfaces = normalizeSurfaces(surfaces, `${path}.surfaces`);
  }

  const priority = value['priority'];
  if (priority !== undefined) {
    command.priority = normalizePriority(priority, `${path}.priority`);
  }

  return Object.freeze(command);
}

/**
 * A payload that has passed validation, normalised into host-owned form.
 *
 * `id` travels as a captured `string` rather than being left to be re-read off
 * the record. On a hostile payload `blueprint.id` is a getter, and a getter is
 * free to return a benign id while it is being inspected and a victim's id
 * immediately afterwards. Reading it exactly once and passing the resulting
 * primitive forward is what makes that substitution impossible.
 */
interface NormalizedRegistration {
  /** Host-owned, deep-frozen. Safe to store, expose and re-read. */
  readonly record: LEAPExtensionBlueprint;
  /** The one id that was actually validated. */
  readonly id: string;
  /** The caller's original object. Identity comparison ONLY — never read. */
  readonly source: object;
}

/**
 * Validate an untrusted payload and build the host-owned record for it.
 *
 * Every rejection this function DECIDES ON is a `ShellUXError` — a missing
 * field, a field of the wrong runtime type, a bound exceeded, a duplicate action
 * id, and now a value that refuses to be classified at all.
 *
 * **The revoked-`Proxy` leak is closed.** `Array.isArray` raises a raw
 * `TypeError` when handed a revoked `Proxy`, and five call sites reached it with
 * an unvalidated value: `isRecord`, `describeType`, the `children` check in
 * `normalizeNavigationNode`, and the `navigationTree` and `ribbonActions` checks
 * below. All five now go through `checkArray`, which cannot throw, so a revoked
 * `Proxy` in any field position is an ordinary typed rejection naming the field.
 * The path that used to bite was not the obvious one: `validateId`,
 * `validateText`, `validateFunction` and `validateViewComponent` each
 * `typeof`-check first — and `typeof` does not trap, so a revoked `Proxy` simply
 * failed the check — then called `describeType` to build the message, never
 * consulting `isRecord` at all. Pinned by "validateBlueprint — a revoked Proxy"
 * in `src/core/__tests__/validation.test.ts`, which walks every field position
 * that can reach one of the five sites and asserts `ShellUXError` at each.
 *
 * **One untyped escape remains, and is not claimed away.** Reading a property
 * off an attacker-shaped object invokes a getter, and a getter is free to throw
 * anything at all; that value propagates out of here unchanged. It is not a
 * rejection this function decided on — it is plugin code throwing through it —
 * but a caller of the exported `validateBlueprint` still sees it, so callers that
 * accept untrusted payloads must guard the call or use `register` instead.
 * Pinned by "validateBlueprint — a revoked Proxy > still propagates whatever a
 * throwing property getter threw", same file.
 *
 * `register` is unaffected by either. Its `try`/`catch` spans the whole
 * operation and funnels anything thrown here through `toShellUXError`, so the
 * "never throws" contract holds and callers of `register` only ever see a
 * `ShellUXError`.
 *
 * See the normalisation banner above for why the result is a copy, which parts
 * are deliberately carried by reference, and what `source` is for.
 */
function normalizeBlueprint(candidate: unknown): NormalizedRegistration {
  if (!isRecord(candidate)) {
    throw new ShellUXError(
      'INVALID_PAYLOAD',
      `A blueprint must be a plain object; received ${describeType(candidate)}.`,
      null,
    );
  }

  const id = validateId(requireField(candidate, 'id', 'id'), 'id');
  const name = validateText(
    requireField(candidate, 'name', 'name'),
    'name',
    REGISTRY_LIMITS.MAX_TEXT_LENGTH,
  );
  const version = validateText(
    requireField(candidate, 'version', 'version'),
    'version',
    REGISTRY_LIMITS.MAX_VERSION_LENGTH,
  );

  const nodes = normalizeNavigationTree(
    requireField(candidate, 'navigationTree', 'navigationTree'),
    'navigationTree',
  );

  // ONE COLLECTION, TWO POSSIBLE NAMES, AND BOTH TOGETHER IS A REJECTION.
  //
  // Read raw rather than through `requireField`, because "absent" is not an error
  // for either field on its own — it is an error only for both at once, and
  // `requireField` would have thrown on a legal `commands`-only manifest before
  // this rule could run.
  //
  // Merging them, or preferring one, would make two sources of truth for one
  // collection. That is exactly the drift `src/core/command.ts` exists to prevent
  // one level down, and the failure mode is identical: the two disagree, nothing
  // says which won, and the answer is invisible from the manifest.
  const declaredCommands: unknown = candidate['commands'];
  const declaredActions: unknown = candidate['ribbonActions'];
  if (declaredCommands !== undefined && declaredActions !== undefined) {
    throw new ShellUXError(
      'INVALID_FIELD',
      'A blueprint declares its commands as EITHER "commands" or the deprecated ' +
        '"ribbonActions", never both. Two sources for one collection drift, and nothing ' +
        'in the manifest would say which one the host used.',
      'commands',
    );
  }
  if (declaredCommands === undefined && declaredActions === undefined) {
    // The legacy field name is what a missing collection is reported as, because
    // that is the name every existing manifest and every existing rejection
    // message uses.
    throw new ShellUXError(
      'MISSING_FIELD',
      'Required field "ribbonActions" is missing.',
      'ribbonActions',
    );
  }
  // The path every rejection below names is the field the CALLER actually wrote,
  // so an author reading `commands[3].isVisible` can find line 3 of the array
  // they declared rather than one they did not.
  const commandsField = declaredCommands === undefined ? 'ribbonActions' : 'commands';
  const declaredCollection: unknown =
    declaredCommands === undefined ? declaredActions : declaredCommands;
  if (!isArrayValue(declaredCollection)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "${commandsField}" must be an array; received ${describeType(declaredCollection)}.`,
      commandsField,
    );
  }
  // Captured once, then used for the bound check, the walk AND the size of the
  // host-owned array, so all three agree on one number.
  const actionCount = declaredCollection.length;
  if (actionCount > REGISTRY_LIMITS.MAX_RIBBON_ACTIONS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "${commandsField}" exceeds the maximum of ${REGISTRY_LIMITS.MAX_RIBBON_ACTIONS} actions.`,
      commandsField,
    );
  }
  const actionIds = new Set<string>();
  // Chord uniqueness is decided in the SAME walk as id uniqueness, and is scoped
  // to this blueprint. Cross-extension conflicts are deliberately not rejected:
  // only the foreground extension's chords are live, and rejecting at
  // registration would make load order semantically load-bearing in a lazily
  // loaded shell. ADR-0001 Amendment H.
  const actionChords = new Set<string>();
  const actions: Command[] = [];
  for (let index = 0; index < actionCount; index += 1) {
    actions.push(
      normalizeCommand(
        declaredCollection[index],
        `${commandsField}[${index}]`,
        actionIds,
        actionChords,
      ),
    );
  }

  const views = requireField(candidate, 'views', 'views');
  if (!isRecord(views)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "views" must be an object; received ${describeType(views)}.`,
      'views',
    );
  }
  const pane2 = requireField(views, 'pane2', 'views.pane2');
  validateViewComponent(pane2, 'views.pane2');
  const pane3 = requireField(views, 'pane3', 'views.pane3');
  validateViewComponent(pane3, 'views.pane3');

  // Optional, and read exactly once like every other untrusted field.
  const declaredLifecycle: unknown = candidate['lifecycle'];
  const lifecycle =
    declaredLifecycle === undefined ? undefined : normalizeLifecycle(declaredLifecycle);

  // ONE frozen array, referenced twice. `record.commands === record.ribbonActions`
  // is a property callers may rely on, and it is what makes "two names, one
  // collection" true of the stored record rather than merely intended.
  const commands: readonly Command[] = Object.freeze(actions);
  const record: LEAPExtensionBlueprint = Object.freeze({
    id,
    name,
    version,
    navigationTree: nodes,
    ribbonActions: commands,
    commands,
    views: Object.freeze({ pane2: pane2 as ExtensionView, pane3: pane3 as ExtensionView }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  });

  return { record, id, source: candidate };
}

/**
 * Validate an untrusted payload and return the host-owned blueprint built from
 * it.
 *
 * **The returned value is NOT the caller's object.** It is a fresh, deeply
 * frozen record holding copies of every validated scalar and the caller's
 * function/component references. Mutating the payload afterwards does not
 * affect it. Callers that need the validated id may read `.id` off the returned
 * record, or take it from `register`'s result.
 *
 * **This function throws on rejection — it has no result type and no catch.**
 * Every rejection it decides on is a `ShellUXError`, including the values that
 * refuse to be classified: a revoked `Proxy` in any field position is a typed
 * rejection naming that field, because all five `Array.isArray` sites now go
 * through the total `checkArray`. Pinned by "validateBlueprint — a revoked Proxy"
 * in `src/core/__tests__/validation.test.ts`.
 *
 * **`ShellUXError` is still not the only thing that can come out of it.** A
 * property getter on the payload is plugin code, it is free to throw anything,
 * and that value propagates through unchanged — pinned by "still propagates
 * whatever a throwing property getter threw", same file. A caller handling
 * untrusted payloads must therefore guard the call, or use `register`, which
 * catches and only ever returns a `ShellUXError`. See `normalizeBlueprint` above
 * for the full account.
 *
 * This export is for callers that want to validate a payload without registering
 * it. Prefer `register` for input you did not author.
 */
export function validateBlueprint(candidate: unknown): LEAPExtensionBlueprint {
  return normalizeBlueprint(candidate).record;
}

/**
 * Normalise anything thrown during validation into the one typed error.
 *
 * Total by construction: it must not be possible for the error path itself to
 * throw, because that throw would escape `register` and break its "never
 * throws" contract. Every step that can re-enter attacker code sits inside the
 * `try` — `instanceof` (a Proxy can trap `getPrototypeOf`), the `message`
 * getter, and the `toString` / `valueOf` / `Symbol.toPrimitive` that `String`
 * consults. The fallback uses only `typeof`, which is defined for every
 * JavaScript value and invokes nothing.
 *
 * A caught `ShellUXError` is NEVER returned as-is. `ShellUXError` is exported,
 * its own properties are writable, and a plugin can obtain a real instance
 * (register something invalid, keep `result.error`), rewrite its `code`, arm
 * its `message` getter, and throw it from a getter of its next payload.
 * Returning that object would hand the host an attacker-chosen `code` and an
 * attacker-controlled `message` getter that detonates inside host code the
 * moment anything reads it. So the fields are read once each, checked — `code`
 * against this module's own enum, `message` and `field` for being primitive
 * strings — and copied into a FRESH, host-constructed error. Anything that
 * fails a check downgrades the whole error to the generic rejection.
 */
function toShellUXError(error: unknown): ShellUXError {
  const preamble = 'Blueprint rejected while being inspected';
  try {
    if (error instanceof ShellUXError) {
      const code: unknown = error.code;
      const message: unknown = error.message;
      const field: unknown = error.field;
      if (
        typeof code === 'string' &&
        SHELL_UX_ERROR_CODES.has(code) &&
        typeof message === 'string'
      ) {
        return new ShellUXError(
          code as ShellUXErrorCode,
          message,
          typeof field === 'string' ? field : null,
        );
      }
      return new ShellUXError(
        'INVALID_PAYLOAD',
        `${preamble}: a ShellUXError that failed inspection.`,
        null,
      );
    }
    const detail = error instanceof Error ? String(error.message) : String(error);
    return new ShellUXError('INVALID_PAYLOAD', `${preamble}: ${detail}`, null);
  } catch {
    return new ShellUXError(
      'INVALID_PAYLOAD',
      `${preamble}: a non-inspectable value of type "${typeof error}".`,
      null,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export interface RegistrationSuccess {
  readonly ok: true;
  readonly id: string;
  /**
   * `true` when this exact blueprint was already registered and the call was a
   * no-op. Distinguishes benign re-registration from a first registration.
   */
  readonly alreadyRegistered: boolean;
}

export interface RegistrationFailure {
  readonly ok: false;
  readonly error: ShellUXError;
}

/**
 * Result of `register`. A discriminated union rather than an exception,
 * because a malformed plugin manifest is an expected condition for a host that
 * loads third-party code: throwing would let one bad plugin unmount the shell
 * through an error boundary. `register` therefore never throws. Pinned by "register
 * — hostile payloads never crash the host" in `src/core/__tests__/registry.test.tsx`,
 * "register — a getter that detonates late still cannot escape" and "register —
 * thrown values that resist inspection" in
 * `src/core/__tests__/registrySecurity.test.tsx`, and "register — a weaponised
 * ShellUXError cannot be relocated into the host" in
 * `src/core/__tests__/registryNormalization.test.tsx`.
 *
 * The `never throws` contract is `register`'s, not `validateBlueprint`'s. The
 * exported validator has no `catch`: its own rejections are all `ShellUXError`,
 * including a revoked `Proxy` in any field position — the raw `TypeError` that
 * `Array.isArray` used to leak from five sites is closed, pinned by
 * "validateBlueprint — a revoked Proxy" in
 * `src/core/__tests__/validation.test.ts` — but a throwing property getter on the
 * payload still propagates out of it untyped, and that is deliberately not
 * claimed away.
 */
export type RegistrationResult = RegistrationSuccess | RegistrationFailure;

/** One row of the store: what is handed out, plus what identity is judged by. */
interface RegistryEntry {
  /** Host-owned, deep-frozen. The only thing consumers ever see. */
  readonly record: LEAPExtensionBlueprint;
  /**
   * The plugin's original object, kept for reference-identity comparison in
   * `register` and nothing else. Never read from, never exposed.
   */
  readonly source: object;
}

export interface ExtensionRegistry {
  /** Validate and register a blueprint. Never throws. */
  register(blueprint: unknown): RegistrationResult;
  /**
   * Remove an extension. Returns `false` when the id was not registered.
   *
   * ---- Authorisation: deliberately none -----------------------------------
   * Any holder of the registry can remove any extension, including one it did
   * not register. That is an accepted property of this shell, not an oversight:
   *
   *  - ISSUE-001 specifies no ownership or capability model, and inventing one
   *    here would be scope this issue never agreed.
   *  - The shell is local-first and single-origin. Extensions are same-origin
   *    JavaScript in the same page; one that wanted to remove another's UI
   *    could equally reach into the DOM. An unregister token would move the
   *    lock while leaving the door open, and would read as a guarantee the
   *    architecture cannot make (see ADR-0001, "No sandbox").
   *  - The registry is only reachable inside `ExtensionRegistryProvider`, and
   *    nothing is handed to a plugin that carries it — `IShellAPI` has no
   *    registry member.
   *
   * If an ownership model is ever wanted it belongs in its own issue, with the
   * threat model written down first. Do not add one here by accident.
   *
   * The absent authorisation is pinned rather than merely stated: "does NOT sever
   * useRegistry, so unregister stays a route to ending a sibling" in
   * `src/core/__tests__/capability.test.tsx` performs it from inside a plug-in
   * subtree.
   */
  unregister(id: string): boolean;
  /**
   * The host-owned, deeply frozen record for `id`, or `undefined`.
   *
   * **This is NOT the object the plugin passed to `register`.** It is a
   * normalised copy: validated scalars copied into fresh primitives, arrays
   * rebuilt at exactly the length that was bounds-checked, and the plugin's
   * function and component references carried across unchanged. Mutating the
   * original blueprint after registration cannot change what is returned here —
   * pinned by "is unaffected by the plugin mutating its own blueprint afterwards" in
   * `src/core/__tests__/registryNormalization.test.tsx`.
   *
   * **The record is host-owned; the plug-in functions inside it are not.** This hands
   * ANY caller a sibling's unfrozen view components and callbacks, which is an
   * accepted limit and not a defect — see the `views` note in the normalisation
   * banner above, and "an ActiveExtension does not freeze the plug-in functions it
   * carries" in `src/core/__tests__/capability.test.tsx`.
   */
  getExtension(id: string): LEAPExtensionBlueprint | undefined;
  /** Every registered record, in insertion order. Same guarantees as above. */
  listExtensions(): readonly LEAPExtensionBlueprint[];
  /**
   * Run `listener` inside every later `unregister` of a registered id, BEFORE the
   * record is removed, with the id and the record being removed. Returns the
   * disposer. ADR-0006 decision 8.
   *
   * **Why before, and why here.** A handle minted for an extension is revoked
   * the moment the registry stops holding its record — the facade re-asks the
   * registry on every call. So "immediately before revocation" on the unregister
   * path can only mean inside `unregister`, before the delete. `ShellHostProvider`
   * subscribes here to call the extension's `lifecycle.onRelease` while its
   * handle still works, revoke it, and purge its store scope.
   *
   * **Host-internal by convention, not by enforcement.** `useRegistry` is not
   * severed at `ExtensionHostBoundary`, so plug-in code can subscribe too, which
   * gives it nothing it lacked: it can already call `unregister` itself. A
   * listener's throw is caught and reported to `console.error`, and the
   * unregister completes anyway — one listener cannot keep a record registered.
   * *Tests:* `src/core/__tests__/lifecycle.test.tsx` — "unregister completes
   * when a before-unregister listener throws".
   */
  onBeforeUnregister(listener: (id: string, record: LEAPExtensionBlueprint) => void): () => void;
}

/**
 * The registry API and the registry's revision counter live in SEPARATE
 * contexts on purpose.
 *
 * The API object's identity is stable for the provider's whole lifetime, so a
 * plugin can safely write `useEffect(() => { registry.register(bp); },
 * [registry])`. Had the counter been folded into the same object, every
 * registration would change that identity, re-fire the effect, and — for the
 * register/unregister effect pair that StrictMode encourages — spin into an
 * infinite render loop. Consumers that genuinely need to recompute when the
 * contents change subscribe to `useRegistryRevision` instead.
 */
const RegistryApiContext = createContext<ExtensionRegistry | null>(null);
const RegistryRevisionContext = createContext<number>(0);

function revisionReducer(current: number): number {
  return current + 1;
}

export interface ExtensionRegistryProviderProps {
  readonly children: ReactNode;
}

export function ExtensionRegistryProvider({
  children,
}: ExtensionRegistryProviderProps): ReactElement {
  // A Map, deliberately, not an object literal. Keys come from untrusted
  // plugin manifests; a Map has no prototype chain, so writing a key named
  // `__proto__` or `constructor` stores a plain entry and can never reach
  // Object.prototype. This makes prototype pollution structurally impossible
  // rather than merely filtered — the RESERVED_IDS check is a second layer. This is
  // the ONE place ADR-0001 Amendment F leaves the word `structural` earned; pinned by
  // "never stores \"__proto__\" as a live key" in `registrySecurity.test.tsx`.
  //
  // Guarded rather than passed straight to `useRef`, exactly as the host guards
  // its store and its `live` map in `ActivationContext.tsx` and for the same
  // reason: `useRef(new Map())` evaluates its argument on every render and uses
  // it only on the first, so the unguarded form builds and discards a Map per
  // render. Never reassigned after this, so `store` is ONE Map for the
  // provider's whole lifetime — which is load-bearing, because every callback
  // below closes over it and lists it as a stable dependency.
  const storeRef = useRef<Map<string, RegistryEntry> | null>(null);
  storeRef.current ??= new Map<string, RegistryEntry>();
  const store: Map<string, RegistryEntry> = storeRef.current;
  const [revision, bumpRevision] = useReducer(revisionReducer, 0);

  const register = useCallback((blueprint: unknown): RegistrationResult => {
    // The guard spans the WHOLE operation, not just the validation call. A
    // hostile payload can throw from a property getter, and an uncaught throw
    // anywhere in here would take down the host and break the "never throws"
    // contract. Nothing below the normalisation call touches plugin data —
    // `id` is a captured string, `record` is host-owned and frozen, and
    // `source` is only ever compared by reference — but the guard covers it
    // regardless, so that a future edit cannot reintroduce an unguarded read.
    try {
      // `id` is the identifier `normalizeBlueprint` actually checked, captured
      // as a primitive. It is NEVER re-read off the payload: on a hostile
      // payload that property is a getter, and re-reading it would let the
      // value used for the existence check, the store key and the returned id
      // differ from the value that was validated — which is exactly how a
      // registration is hijacked and how a reserved id such as `__proto__`
      // reaches the store.
      const { record, id, source } = normalizeBlueprint(blueprint);

      const existing = store.get(id);
      if (existing !== undefined) {
        // ---- React StrictMode double-invocation --------------------------
        // In development StrictMode mounts, unmounts and remounts every
        // subtree, so a plugin that registers from `useEffect` without a
        // cleanup runs `register` twice with the SAME blueprint object — its
        // module-level export, whose identity is stable across the remount.
        // Reference identity is therefore the discriminator: re-registering
        // the exact same object is an idempotent no-op success, while a
        // DIFFERENT object claiming an id that is already taken is a genuine
        // collision between two plugins and is rejected. No time windows, no
        // mount counters, and no weakening of the duplicate-id guarantee.
        //
        // The comparison is against the retained `source`, not against the
        // stored record, precisely because the record is a copy. `===` between
        // two object references invokes no plugin code.
        if (existing.source === source) {
          return { ok: true, id, alreadyRegistered: true };
        }
        return {
          ok: false,
          error: new ShellUXError(
            'DUPLICATE_ID',
            `Extension id "${id}" is already registered by a different blueprint.`,
            'id',
          ),
        };
      }

      store.set(id, Object.freeze({ record, source }));
      bumpRevision();
      return { ok: true, id, alreadyRegistered: false };
    } catch (error) {
      return { ok: false, error: toShellUXError(error) };
    }
  }, [store]);

  // A `Set` of listeners, held in a ref for the provider's lifetime. See
  // `onBeforeUnregister`.
  const unregisterListenersRef = useRef<Set<(id: string, record: LEAPExtensionBlueprint) => void> | null>(
    null,
  );
  unregisterListenersRef.current ??= new Set();
  const unregisterListeners = unregisterListenersRef.current;

  const unregister = useCallback(
    (id: string): boolean => {
      const entry = store.get(id);
      if (entry === undefined) {
        return false;
      }
      // Before the delete, so a handle minted against this record is still live
      // inside each listener — which is what lets `onRelease` run before
      // revocation. A snapshot, so a listener that subscribes or unsubscribes
      // mid-pass changes the next unregister and not this one.
      for (const listener of Array.from(unregisterListeners)) {
        try {
          listener(id, entry.record);
        } catch (error) {
          try {
            console.error(
              `ExtensionRegistry: a before-unregister listener threw while "${id}" was being unregistered. The unregister completed anyway.`,
              error,
            );
          } catch {
            // Reporting is best-effort. Completing the unregister is not.
          }
        }
      }
      // Compared by identity, because a listener is plug-in-reachable code and
      // may itself have unregistered — or unregistered and re-registered — this
      // id. Only the record this call was asked to remove is removed.
      if (store.get(id) === entry) {
        store.delete(id);
        bumpRevision();
      }
      return true;
    },
    [store, unregisterListeners],
  );

  const onBeforeUnregister = useCallback(
    (listener: (id: string, record: LEAPExtensionBlueprint) => void): (() => void) => {
      if (typeof listener !== 'function') {
        throw new ShellUXError(
          'INVALID_FIELD',
          `onBeforeUnregister: "listener" must be a function; received ${describeType(listener)}.`,
          'listener',
        );
      }
      // Wrapped, so the same function subscribed twice is two subscriptions
      // and each disposer removes exactly its own.
      const entry = (id: string, record: LEAPExtensionBlueprint): void => listener(id, record);
      unregisterListeners.add(entry);
      return (): void => {
        unregisterListeners.delete(entry);
      };
    },
    [unregisterListeners],
  );

  const getExtension = useCallback(
    (id: string): LEAPExtensionBlueprint | undefined => store.get(id)?.record,
    [store],
  );

  const listExtensions = useCallback(
    (): readonly LEAPExtensionBlueprint[] => Array.from(store.values(), (entry) => entry.record),
    [store],
  );

  const api = useMemo<ExtensionRegistry>(
    () => ({ register, unregister, getExtension, listExtensions, onBeforeUnregister }),
    [register, unregister, getExtension, listExtensions, onBeforeUnregister],
  );

  return (
    <RegistryApiContext.Provider value={api}>
      <RegistryRevisionContext.Provider value={revision}>
        {children}
      </RegistryRevisionContext.Provider>
    </RegistryApiContext.Provider>
  );
}

/**
 * Access the registry API. The returned object keeps a stable identity, so it
 * is safe to list in a dependency array.
 *
 * @throws when called outside `ExtensionRegistryProvider`.
 */
export function useRegistry(): ExtensionRegistry {
  const registry = useContext(RegistryApiContext);
  if (registry === null) {
    throw new Error('useRegistry must be called inside an <ExtensionRegistryProvider>.');
  }
  return registry;
}

/**
 * Subscribe to registry content changes. The number increases by one on every
 * successful registration or removal; its value carries no other meaning.
 * Outside a provider it is `0` and never changes.
 */
export function useRegistryRevision(): number {
  return useContext(RegistryRevisionContext);
}
