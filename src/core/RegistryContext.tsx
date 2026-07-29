import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type {
  ExtensionView,
  LEAPExtensionBlueprint,
  NavigationNode,
  RibbonAction,
  ShellUXErrorCode,
} from './types';
import { SHELL_UX_ERROR_CODES, ShellUXError } from './types';

/**
 * Strict allowlist for every identifier the host uses as a lookup key:
 * extension ids, navigation node ids and ribbon action ids.
 *
 * Lowercase alphanumerics and internal hyphens, 1–64 characters, first
 * character alphanumeric. It is an allowlist rather than a denylist, so it
 * structurally excludes path separators (`/`, `\`, `..`), URL schemes (`:`),
 * markup (`<`, `>`, `"`), whitespace, and the leading underscores of
 * `__proto__` — without needing to enumerate what is dangerous.
 */
export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Identifiers rejected outright.
 *
 * `__proto__` already fails the pattern above, but `constructor` and
 * `prototype` are plain lowercase words that pass it. They are refused here so
 * that no registry key can ever collide with a well-known object-graph name —
 * belt and braces on top of the `Map`-backed store, which is what actually
 * makes prototype pollution impossible.
 */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Hard bounds on blueprint size. A plugin cannot make the host walk forever. */
export const REGISTRY_LIMITS = {
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
} as const;

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
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
  if (value.trim().length === 0) {
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
 * was validated is therefore, structurally, what is stored.
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
}

/** Builder shape for a normalised node; frozen into a `NavigationNode`. */
interface MutableNavigationNode {
  id: string;
  label: string;
  badgeCount?: number;
  children?: readonly NavigationNode[];
}

/** Builder shape for a normalised action; frozen into a `RibbonAction`. */
interface MutableRibbonAction {
  id: string;
  label: string;
  icon: string;
  isDisabled?: boolean;
  isVisible: RibbonAction['isVisible'];
  onExecute: RibbonAction['onExecute'];
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
      `Field "navigationTree" exceeds the maximum of ${REGISTRY_LIMITS.MAX_NAV_NODES} nodes.`,
      'navigationTree',
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

  const children = value['children'];
  if (children !== undefined) {
    if (!Array.isArray(children)) {
      throw new ShellUXError(
        'INVALID_FIELD',
        `Field "${path}.children" must be an array; received ${describeType(children)}.`,
        `${path}.children`,
      );
    }
    // `length` is captured once. `Array.isArray` is true for a Proxy wrapping
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

function normalizeRibbonAction(value: unknown, path: string, seenIds: Set<string>): RibbonAction {
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

  const action: MutableRibbonAction = {
    id,
    label,
    icon,
    // Carried by reference, never cloned: these must stay callable and keep
    // their identity. They are the plugin's objects and are left unfrozen.
    isVisible: isVisible as RibbonAction['isVisible'],
    onExecute: onExecute as RibbonAction['onExecute'],
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
    action.isDisabled = isDisabled;
  }

  return Object.freeze(action);
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
 * Throws `ShellUXError` for every rejection it anticipates — a missing field, a
 * field of the wrong runtime type, a bound exceeded, a duplicate action id. It
 * is **not** true that `ShellUXError` is the only thing it can throw, and this
 * comment previously claimed that it was. Two things escape untyped:
 *
 * 1. Reading a property off an attacker-shaped object can invoke a getter, and
 *    a getter is free to throw anything at all.
 * 2. `Array.isArray` throws a raw `TypeError` when handed a revoked `Proxy`,
 *    and five call sites reach it with an unvalidated value: `isRecord`,
 *    `describeType`, the `children` check in `normalizeNavigationNode`, and the
 *    `navigationTree` and `ribbonActions` checks below. Thirteen distinct field
 *    positions can steer a revoked `Proxy` into one of them; the shortest
 *    reproduction is `validateBlueprint({ id: <revoked Proxy>, ...validRest })`,
 *    which lands in `describeType`, not in `isRecord`: `validateId`,
 *    `validateText`, `validateFunction` and `validateViewComponent` each
 *    `typeof`-check first — and `typeof` does not trap, so a revoked `Proxy`
 *    simply fails the check — then call `describeType` to build the message.
 *    `isRecord` is never consulted for those fields at all.
 *
 * `register` is unaffected by either. Its `try`/`catch` spans the whole
 * operation and funnels anything thrown here through `toShellUXError`, so the
 * "never throws" contract holds and callers of `register` still only ever see a
 * `ShellUXError`. It is the exported `validateBlueprint`, which has no such
 * catch, that can surface the raw `TypeError` to its caller.
 *
 * Guarding all five `Array.isArray` sites — not just `describeType` — is filed
 * as follow-up work in `.github/ISSUES_MANIFEST.md`. It is deliberately not
 * done in this change: this file is held to a 100% branch gate, so each new
 * guard needs its own test, and that is a separate piece of work.
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

  const navigationTree = requireField(candidate, 'navigationTree', 'navigationTree');
  if (!Array.isArray(navigationTree)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "navigationTree" must be an array; received ${describeType(navigationTree)}.`,
      'navigationTree',
    );
  }
  // Captured once. The total node count is bounded by `navState.visited`, which
  // counts the nodes actually normalised — so the bound applies to what is
  // stored, not to a `length` the payload can revise afterwards.
  const navCount = navigationTree.length;
  const navState: NavWalkState = { seenIds: new Set<string>(), visited: 0 };
  const nodes: NavigationNode[] = [];
  for (let index = 0; index < navCount; index += 1) {
    nodes.push(
      normalizeNavigationNode(navigationTree[index], `navigationTree[${index}]`, 1, navState),
    );
  }

  const ribbonActions = requireField(candidate, 'ribbonActions', 'ribbonActions');
  if (!Array.isArray(ribbonActions)) {
    throw new ShellUXError(
      'INVALID_FIELD',
      `Field "ribbonActions" must be an array; received ${describeType(ribbonActions)}.`,
      'ribbonActions',
    );
  }
  // Captured once, then used for the bound check, the walk AND the size of the
  // host-owned array, so all three agree on one number.
  const actionCount = ribbonActions.length;
  if (actionCount > REGISTRY_LIMITS.MAX_RIBBON_ACTIONS) {
    throw new ShellUXError(
      'PAYLOAD_TOO_LARGE',
      `Field "ribbonActions" exceeds the maximum of ${REGISTRY_LIMITS.MAX_RIBBON_ACTIONS} actions.`,
      'ribbonActions',
    );
  }
  const actionIds = new Set<string>();
  const actions: RibbonAction[] = [];
  for (let index = 0; index < actionCount; index += 1) {
    actions.push(normalizeRibbonAction(ribbonActions[index], `ribbonActions[${index}]`, actionIds));
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

  const record: LEAPExtensionBlueprint = Object.freeze({
    id,
    name,
    version,
    navigationTree: Object.freeze(nodes),
    ribbonActions: Object.freeze(actions),
    views: Object.freeze({ pane2: pane2 as ExtensionView, pane3: pane3 as ExtensionView }),
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
 * Anticipated rejections arrive as `ShellUXError`. Exotic inputs can produce
 * something else: a throwing property getter propagates whatever it threw, and
 * a revoked `Proxy` reaching one of `normalizeBlueprint`'s five unguarded
 * `Array.isArray` sites produces a raw `TypeError`. Callers must therefore
 * treat this as capable of throwing arbitrarily, not merely `ShellUXError`.
 * See `normalizeBlueprint` above for the full account and for the follow-up
 * work recorded in `.github/ISSUES_MANIFEST.md`.
 *
 * `register` does not share this exposure — it catches. Prefer `register` for
 * untrusted input; this export is for callers that want to validate a payload
 * without registering it, and that are prepared to guard the call.
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
 * through an error boundary. `register` therefore never throws.
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
   */
  unregister(id: string): boolean;
  /**
   * The host-owned, deeply frozen record for `id`, or `undefined`.
   *
   * **This is NOT the object the plugin passed to `register`.** It is a
   * normalised copy: validated scalars copied into fresh primitives, arrays
   * rebuilt at exactly the length that was bounds-checked, and the plugin's
   * function and component references carried across unchanged. Mutating the
   * original blueprint after registration cannot change what is returned here.
   */
  getExtension(id: string): LEAPExtensionBlueprint | undefined;
  /** Every registered record, in insertion order. Same guarantees as above. */
  listExtensions(): readonly LEAPExtensionBlueprint[];
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
}: ExtensionRegistryProviderProps): JSX.Element {
  // A Map, deliberately, not an object literal. Keys come from untrusted
  // plugin manifests; a Map has no prototype chain, so writing a key named
  // `__proto__` or `constructor` stores a plain entry and can never reach
  // Object.prototype. This makes prototype pollution structurally impossible
  // rather than merely filtered — the RESERVED_IDS check is a second layer.
  const store = useRef<Map<string, RegistryEntry>>(new Map());
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

      const existing = store.current.get(id);
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

      store.current.set(id, Object.freeze({ record, source }));
      bumpRevision();
      return { ok: true, id, alreadyRegistered: false };
    } catch (error) {
      return { ok: false, error: toShellUXError(error) };
    }
  }, []);

  const unregister = useCallback((id: string): boolean => {
    const removed = store.current.delete(id);
    if (removed) {
      bumpRevision();
    }
    return removed;
  }, []);

  const getExtension = useCallback(
    (id: string): LEAPExtensionBlueprint | undefined => store.current.get(id)?.record,
    [],
  );

  const listExtensions = useCallback(
    (): readonly LEAPExtensionBlueprint[] =>
      Array.from(store.current.values(), (entry) => entry.record),
    [],
  );

  const api = useMemo<ExtensionRegistry>(
    () => ({ register, unregister, getExtension, listExtensions }),
    [register, unregister, getExtension, listExtensions],
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
