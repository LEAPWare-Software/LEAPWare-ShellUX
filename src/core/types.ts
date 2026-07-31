import type { ComponentType } from 'react';

/**
 * ============================================================================
 * TRUST BOUNDARY — READ BEFORE ADDING FIELDS
 * ============================================================================
 * Every string a plugin supplies through `LEAPExtensionBlueprint` — `name`,
 * `NavigationNode.label`, `RibbonAction.label`, `RibbonAction.icon` — is
 * UNTRUSTED INPUT. The registry stores it; it never renders it.
 *
 * Consequently the registry does NOT sanitize HTML, and must not start doing
 * so: escaping data at rest is the wrong layer and produces double-escaped
 * text the moment a correct renderer is placed in front of it. The real and
 * only obligation lives at the render boundary:
 *
 *   - Render plugin-supplied strings as TEXT NODES ONLY ({value} in JSX).
 *   - NEVER pass them to `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
 *     `document.write`, `new Function`, or a `javascript:`/`data:` URL.
 *   - If a future issue genuinely needs rich text from a plugin, sanitize at
 *     that render site with a real sanitizer, not here.
 *
 * What the registry DOES check, because ids are keys rather than display text, is
 * identifier hygiene: every `id` must match `EXTENSION_ID_PATTERN` (see
 * RegistryContext.tsx). No id that gets through can carry a path separator, a URL
 * scheme, angle brackets, or a prototype-pollution key such as `__proto__`. Ids
 * are the only plugin-supplied strings the host uses as lookup keys, so they are
 * the only ones that need to be constrained at rest.
 *
 * That is **entry-point validation** in the vocabulary this repository uses (see
 * ADR-0001 Amendment E): real for every value that arrives through the registry's
 * doors, and not a claim about a caller who reaches host internals another way.
 * Pinned by "validateBlueprint — identifier hardening" in
 * `src/core/__tests__/validation.test.ts`.
 * The `Map`-backed stores are the *integrity control* underneath it — a `Map` has
 * no prototype chain, so prototype pollution through a plugin key is impossible by
 * construction rather than by filtering, and that holds whatever the filter does.
 * Pinned by "register — a shifting id cannot smuggle a reserved key into the store"
 * in `src/core/__tests__/registrySecurity.test.tsx`.
 *
 * The render-boundary rule above now has a render site, and it is no longer stated
 * only as an obligation on future work. `src/components/ui/RibbonToolbar.tsx` is the
 * first place in `src/` where an untrusted plug-in string reaches the DOM, and it
 * renders `RibbonAction.label` as a JSX text node and resolves `RibbonAction.icon`
 * through a host-owned `Map` rather than into markup or a URL. Two tests hold the
 * rule, and they hold deliberately different things: *tests:*
 * `src/components/__tests__/RibbonToolbar.test.tsx` — "renders a markup-shaped
 * plug-in label as a text node, not as markup", which is a statement about one
 * hostile input, and "the module source contains no HTML-injection sink at all",
 * which parses the component with the TypeScript compiler and is a statement about
 * the module, so it still holds if someone adds a second render path tomorrow.
 *
 * **That is one render site, not a host-wide property, and this paragraph must not
 * be read as the wider claim.** The row virtualizer that will render plug-in row
 * content is ISSUE-004 and does not exist, so for that surface the rule remains an
 * untested obligation on future work — exactly what it was for the ribbon until
 * ISSUE-002. Per ADR-0001 Amendment G, the ribbon's tests license a sentence about
 * the ribbon and nothing beyond it.
 * ============================================================================
 */

/** Identifier of one of the three shell panes. */
export type PaneId = 'pane1' | 'pane2' | 'pane3';

/**
 * Exhaustiveness pin for `PANE_IDS`, in the same shape as
 * `SHELL_UX_ERROR_CODE_MEMBERS` below: `Record<PaneId, true>` makes the compiler
 * reject both a missing member and an invented one, so the runtime set cannot
 * drift away from the `PaneId` union.
 */
const PANE_ID_MEMBERS: Readonly<Record<PaneId, true>> = Object.freeze({
  pane1: true,
  pane2: true,
  pane3: true,
});

/**
 * `PaneId` as a runtime membership test.
 *
 * A type union vanishes at runtime, and `RibbonContext.focusedPane` is written
 * through `ShellStateStore.patchContext` — a member reachable from plugin code,
 * which may be plain JavaScript that the compiler never saw. Validating that
 * field therefore needs the union as data; see `assertValidPaneId` in
 * `ShellAPI.ts`.
 */
export const PANE_IDS: ReadonlySet<string> = new Set(Object.keys(PANE_ID_MEMBERS));

/**
 * The ambient host state handed to a ribbon action so it can decide whether it
 * is visible and what to act upon.
 *
 * This is a real, closed interface on purpose. The original specification
 * typed it as `any`, which defeated every downstream type check and let a
 * plugin read fields the host never promised; that was a defect, and this
 * declaration is the fix.
 */
export interface RibbonContext {
  /** Extension that currently owns pane 2/3, or `null` when none is active. */
  readonly activeExtensionId: string | null;
  /** Selected node in the pane-1 navigation tree, or `null`. */
  readonly activeNavNodeId: string | null;
  /** Item selected inside the active extension's view, or `null`. */
  readonly selectedItemId: string | null;
  /** Pane that currently holds keyboard focus, or `null`. */
  readonly focusedPane: PaneId | null;
}

/** A node in an extension's pane-1 navigation tree. */
export interface NavigationNode {
  /** Must match `EXTENSION_ID_PATTERN`; unique within the owning tree. */
  readonly id: string;
  /** UNTRUSTED display text. Render as a text node only. */
  readonly label: string;
  /** Non-negative integer badge, or omitted when the node carries no badge. */
  readonly badgeCount?: number;
  /** Nested children; depth is bounded by the registry. */
  readonly children?: readonly NavigationNode[];
}

/**
 * A keyboard chord an extension asks the host to associate with one of its
 * ribbon actions.
 *
 * **Structured, not a string.** A string such as `"Ctrl+Shift+K"` would need a
 * parser at the trust boundary, and that parser would have to decide — for
 * untrusted input — what `Cmd` means, whether `Esc` and `Escape` are the same
 * token, how casing and interior whitespace are treated, and what a duplicated
 * or unknown modifier does. Separate fields need none of those decisions: `key`
 * is checked against a set and each modifier is checked with the same
 * boolean-when-present rule `RibbonAction.isDisabled` already uses.
 *
 * **This binds `event.key`, not `event.code`** — a layout-dependent character
 * rather than a physical switch. See ADR-0001 Amendment H for the decision and
 * its consequence: on a German layout the physical Z key produces `event.key`
 * `"y"`, so an extension declaring `key: 'z'` is bound to whichever physical key
 * the user's layout puts `z` on. That is the right default for a *mnemonic*
 * shortcut (`z` for undo reads as `z` to the user) and the wrong one for a
 * *positional* shortcut; only mnemonics are offered.
 *
 * Nothing dispatches a hotkey today. It is declared and validated at
 * registration — see `normalizeRibbonAction` in `RegistryContext.tsx` — and the
 * dispatcher is Phase 2. **That is a scope decision, not a blocked one**, and
 * this comment used to say otherwise: it justified the absence by the dispatcher
 * needing the foreground extension and a live `RibbonContext`, and since
 * ISSUE-002 the ribbon renderer is handed both — the foreground extension's
 * normalised actions with its live handle, and the context every predicate is
 * evaluated against. So the infrastructure is no longer what is missing; the
 * dispatcher has simply not been built, and nothing evaluates a chord.
 * Validation is pinned by "validateBlueprint — ribbon action hotkeys" in
 * `src/core/__tests__/validation.test.ts`.
 */
export interface Hotkey {
  /**
   * A key name drawn from the host allowlist (`HOTKEY_KEYS` in
   * `RegistryContext.tsx`), compared lowercased. The registry stores the
   * lowercased form.
   */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

/** A single command contributed to the shell ribbon by an extension. */
export interface RibbonAction {
  /** Must match `EXTENSION_ID_PATTERN`; unique within the owning extension. */
  readonly id: string;
  /** UNTRUSTED display text. Render as a text node only. */
  readonly label: string;
  /** UNTRUSTED icon key. Resolve through a host-owned lookup table, never by
   *  interpolating it into a URL or markup. */
  readonly icon: string;
  /** When `true` the action renders greyed out but still visible. */
  readonly isDisabled?: boolean;
  /**
   * Optional keyboard chord for this action.
   *
   * **It lives here rather than in a blueprint-level collection**, and that
   * placement is the decision — see ADR-0001 Amendment H. Hanging the chord off
   * the action means it inherits `MAX_RIBBON_ACTIONS`, inherits the duplicate
   * walk that already visits every action, and inherits the containment story:
   * a hotkey is a second way to fire *this* `onExecute`, gated by the same
   * `isVisible` and the same `isDisabled`, so it adds no capability the ribbon
   * did not already grant. It also gives a ribbon renderer something to emit as
   * `aria-keyshortcuts`. The accepted cost is that a shortcut with no ribbon
   * action cannot be declared; that is additively fixable later, and the reverse
   * is not.
   *
   * **Declared and validated now; nothing dispatches it.** The registry checks
   * the shape, the allowlist, the modifier rule and intra-extension uniqueness,
   * then stores a frozen host-owned copy. There is no `keydown` listener
   * anywhere in `src/` — pinned by "finds no listener registration and no
   * key-event name in any module under src/" in
   * `src/__tests__/noEventListener.test.ts`, which parses **every** non-test
   * module under `src/` with the TypeScript compiler and fails on
   * `addEventListener`, `removeEventListener` or a `keydown`/`keyup`/`keypress`
   * name in any code position. Comments are trivia to the parser and are not
   * scanned, which is what lets this sentence state the property; a listener
   * reached through a name that is not text — `el[fromAVariable](...)` — is
   * outside what it can see, and that limit is stated in the test. The narrower
   * fact that `src/core/hotkeys.ts` exports only its three pure helpers is
   * "hotkeys module — does not attach anything" in
   * `src/core/__tests__/hotkeys.test.ts`.
   */
  readonly hotkey?: Hotkey;
  /**
   * Pure predicate deciding whether the action appears at all.
   *
   * It is handed the context and NOTHING ELSE — deliberately no `IShellAPI`.
   * This runs during render, and a capability to mutate shell state during
   * render is a hazard, not a convenience: a predicate that writes would notify
   * the store mid-render, re-enter the component that is rendering, and either
   * loop or tear. An action that needs to change something has `onExecute` for it.
   *
   * **That makes "predicates must be pure" a guardrail, not a structural fact, and
   * this comment used to claim the stronger of the two.** A signature constrains
   * ARGUMENTS; it says nothing about closures. A predicate defined inside a view
   * that called `useShellStore()` — public by design — captures a store and writes
   * on invocation, which was reproduced. What the read-only argument list really
   * delivers is that the direct route is closed and the honest mistake is hard to
   * make by accident. Purity stays the author's obligation.
   *
   * As a guardrail it still has **no test**, and per ADR-0001 Amendment G that is
   * stated rather than glossed. The reason is no longer "no call site": since
   * ISSUE-002, `src/components/ui/RibbonToolbar.tsx` calls `isVisible` on every
   * render, inside a guard. What that guard contains is MISBEHAVIOUR, not impurity.
   * A predicate that throws is treated as not visible and reported, and the
   * remaining actions still render; the report itself is wrapped, so a plug-in that
   * replaced `console.error` with a throwing function cannot turn containment into
   * an escape. A non-boolean return is treated as not visible too, because the call
   * site compares `=== true` rather than testing truthiness. *Tests:*
   * `src/components/__tests__/RibbonToolbar.test.tsx` — "hides an action whose
   * isVisible predicate throws and still renders the rest", "treats a non-boolean
   * isVisible result as not visible" and "survives a console.error that itself
   * throws while reporting a bad predicate".
   *
   * **None of that is a purity test.** A predicate that writes through a captured
   * store rather than throwing returns cleanly, so the guard never sees it and no
   * test asserts against it. Purity stays the author's obligation. The registry
   * checks only that it is a function — "validateBlueprint — ribbon actions" in
   * `src/core/__tests__/validation.test.ts`.
   */
  isVisible(ctx: RibbonContext): boolean;
  /**
   * Invoked on activation, with the context AND the extension's own shell
   * handle.
   *
   * `shell` is the same deep-frozen, per-extension `IShellAPI` the host holds
   * for this extension, so a ribbon action can actually change shell state.
   * Without it the handler received four nullable strings and no capability, and
   * therefore provably could not do anything at all.
   *
   * `shell` is revocable: after the extension is released or unregistered every
   * member of it throws `ShellUXError` with code `REVOKED`. Do not stash it
   * beyond the life of the call — use the one you are handed. Pinned by "mints a live
   * IShellAPI on activation and revokes it on release" and "revokes when the extension
   * is unregistered" in `src/core/__tests__/dataflow.test.tsx`.
   */
  onExecute(ctx: RibbonContext, shell: IShellAPI): void;
}

/** Props the host passes into an extension-supplied pane view. */
export interface ExtensionViewProps {
  /** Deep-frozen host API. */
  readonly shell: IShellAPI;
  /** Immutable snapshot of the host context at render time. */
  readonly context: Readonly<RibbonContext>;
}

/** A React component an extension contributes for one of the content panes. */
export type ExtensionView = ComponentType<ExtensionViewProps>;

/** The pane views an extension must supply. */
export interface ExtensionViews {
  readonly pane2: ExtensionView;
  readonly pane3: ExtensionView;
}

/**
 * The manifest object a plugin module exports. This is the entire contract a
 * plugin has with the host; nothing outside this shape is read.
 */
export interface LEAPExtensionBlueprint {
  /** Must match `EXTENSION_ID_PATTERN`. Unique across the whole registry. */
  readonly id: string;
  /** UNTRUSTED display name. Render as a text node only. */
  readonly name: string;
  /** UNTRUSTED version string, e.g. `"1.0.0"`. Opaque to the host. */
  readonly version: string;
  readonly navigationTree: readonly NavigationNode[];
  readonly ribbonActions: readonly RibbonAction[];
  readonly views: ExtensionViews;
}

/**
 * The contract the host passes DOWN to a plugin.
 *
 * Instances handed to plugin code are deep-frozen (see `createShellAPI`). That is
 * an **integrity control** in the sense this repository uses the word — real and
 * unconditional, holding against any caller however hostile: an instance's methods
 * cannot be swapped out. Pinned by "is deep-frozen: strict-mode reassignment throws",
 * "is deep-frozen: sloppy-mode reassignment is a silent no-op" and "cannot have its
 * prototype swapped" in `src/core/__tests__/shellApi.test.ts`.
 *
 * **That is a claim about replacement, and the sentence used to go one step further:
 * "so one plugin cannot intercept or suppress the calls another makes through the
 * same instance." That does not follow and is false.** Every call through this
 * interface reaches the one host store, the store notifies synchronously, and
 * `ShellStateStore.subscribe` is public — so a listener registered by any code in the
 * page observes the write before this method returns, can overwrite it by re-entering
 * the store, and can throw into this frame. Reproduced in
 * `src/core/__tests__/subscribe.test.tsx`. The freeze is not what is bypassed:
 * nothing is replaced.
 *
 * It says nothing either about what a plugin can reach by other means. Reaching the
 * unscoped store, or another extension's handle, is not prevented — see
 * ADR-0001 "No sandbox" and Amendment E, and "reaches the host ActivationController
 * by reflection anyway, and steals a sibling handle" in
 * `src/core/__tests__/reflection.test.tsx`. Freezing narrows what this object is; it
 * is not a boundary around the plugin.
 */
export interface IShellAPI {
  /**
   * Set — or clear, with `null` — the currently selected item.
   *
   * The value is opaque to the host: it is the extension's own item
   * identifier, not a registry key, so it is checked for TYPE only and not
   * against `EXTENSION_ID_PATTERN`. It is checked, though, because this value
   * lands in `RibbonContext.selectedItemId` — a snapshot the host hands to
   * OTHER extensions' `isVisible` and `onExecute`. An unchecked argument would
   * make the declared `string | null` a runtime lie and turn the context into
   * a cross-plugin object-injection channel. Pinned at both doors that reach the
   * field: "setSelectedItem validates its argument" in
   * `src/core/__tests__/shellApi.test.ts` and "patchContext rejects what
   * setSelectedItem rejects" in `src/core/__tests__/contextPatch.test.ts`.
   *
   * **A store listener runs inside this call**, for the same reason as
   * `setBadgeCount` below: `useShellStore().subscribe` is public and the store
   * notifies synchronously, so a listener you did not write runs before this
   * method returns and may throw something that is not a `ShellUXError` into your
   * frame. Pinned by "delivers a raw TypeError out of patchContext" in
   * `src/core/__tests__/subscribe.test.tsx`, which is the same notification pass.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is written;
   *   `INVALID_FIELD` when `id` is neither a string nor `null`;
   *   `REENTRANT_NOTIFY` when a listener writes back to the store hard enough to
   *   run the notification cascade into its limit — raised after the field is
   *   committed, which is pinned by "raises REENTRANT_NOTIFY from
   *   setSelectedItem, with the field already committed" in
   *   `src/core/__tests__/contextPatch.test.ts`.
   */
  setSelectedItem(id: string | null): void;
  /**
   * Set the badge count for one of YOUR navigation nodes.
   *
   * The write is scoped to the extension the instance was minted for. That scope
   * is not a parameter and cannot be supplied: the facade closes over the id the
   * registry validated, so two extensions that both name a node `inbox` write to
   * two different entries and cannot collide.
   *
   * **That is collision-resistance, not confinement.** An earlier version of this
   * comment ended "and neither can read or overwrite the other's", which was
   * false. The unscoped store behind this facade is reachable through the public
   * `useShellStore()`, and `store.getBadgeCount('other-ext', 'inbox')` reads
   * another extension's badge while `store.setBadgeCount('other-ext', ...)` writes
   * one. What is real here is that two vendors picking the same node id do not
   * overwrite each other by accident, and that this method offers no parameter
   * through which to aim elsewhere. Both pinned under "badge collision-resistance"
   * in `src/core/__tests__/dataflow.test.tsx`.
   *
   * **A store listener runs inside this call.** The write reaches the one host
   * store and the store notifies synchronously, and `useShellStore().subscribe`
   * is public — so code you did not write runs before this method returns and may
   * throw into your frame. What comes back then is whatever that listener chose
   * and is not necessarily a `ShellUXError`, so the list below is what this method
   * DECIDES rather than everything that can come out of it. Pinned by "delivers a
   * raw TypeError out of setBadgeCount" in
   * `src/core/__tests__/subscribe.test.tsx`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is written; `INVALID_ID`
   *   when `nodeId` is not a registry-valid identifier; `INVALID_FIELD` when
   *   `count` is not a non-negative safe integer; `REENTRANT_NOTIFY` when a
   *   listener writes back to the store hard enough to run the notification
   *   cascade into its limit — raised AFTER the badge is committed, so this one
   *   rejection does not mean nothing happened. Pinned by "raises
   *   REENTRANT_NOTIFY from setBadgeCount, with the badge already committed" in
   *   `src/core/__tests__/shellApi.test.ts`.
   */
  setBadgeCount(nodeId: string, count: number): void;
  /**
   * Immutable snapshot of the current host context.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered. This member reads and writes nothing else, so
   *   `REVOKED` is the only outcome it decides on.
   */
  getContext(): Readonly<RibbonContext>;
}

/** Machine-readable reason a registry or shell-API call was rejected. */
export type ShellUXErrorCode =
  /** Payload was not a plain object (null, undefined, array, string, ...). */
  | 'INVALID_PAYLOAD'
  /** A required field was absent. */
  | 'MISSING_FIELD'
  /** A field was present but of the wrong type, shape or value. */
  | 'INVALID_FIELD'
  /** An id failed the `EXTENSION_ID_PATTERN` allowlist. */
  | 'INVALID_ID'
  /** An id collided with a prototype-pollution key. */
  | 'RESERVED_ID'
  /** An id is already registered under a different blueprint. */
  | 'DUPLICATE_ID'
  /**
   * Two ribbon actions in one blueprint declared the same chord. Scoped to the
   * blueprint on purpose: hotkeys are live only for the foreground extension, so
   * two *different* extensions claiming the same chord is not a conflict and is
   * not rejected. See ADR-0001 Amendment H.
   */
  | 'DUPLICATE_HOTKEY'
  /** A collection or string exceeded its declared bound. */
  | 'PAYLOAD_TOO_LARGE'
  /**
   * The `IShellAPI` used has been revoked — its extension was released or
   * unregistered — so the call reached nothing and changed nothing.
   */
  | 'REVOKED'
  /**
   * A store listener wrote back to the store, and the resulting notification
   * cascade exceeded the depth the store will follow. Listeners are a signal to
   * re-read, not a place to write; see `createShellStateStore`.
   */
  | 'REENTRANT_NOTIFY';

/**
 * Exhaustiveness pin for `SHELL_UX_ERROR_CODES`.
 *
 * `Record<ShellUXErrorCode, true>` makes the compiler reject both a missing
 * member and an invented one, so the runtime set below cannot drift away from
 * the union above.
 */
const SHELL_UX_ERROR_CODE_MEMBERS: Readonly<Record<ShellUXErrorCode, true>> = Object.freeze({
  INVALID_PAYLOAD: true,
  MISSING_FIELD: true,
  INVALID_FIELD: true,
  INVALID_ID: true,
  RESERVED_ID: true,
  DUPLICATE_ID: true,
  DUPLICATE_HOTKEY: true,
  PAYLOAD_TOO_LARGE: true,
  REVOKED: true,
  REENTRANT_NOTIFY: true,
});

/**
 * `ShellUXErrorCode` as a runtime membership test.
 *
 * A type union vanishes at runtime, but the host has to be able to ask "is this
 * `code` one of mine?" of an error it did not construct — see `toShellUXError`
 * in `RegistryContext.tsx`. A `ShellUXError` that crosses back from plugin code
 * may carry any `code` at all; only a value in this set is trusted, and
 * anything else is downgraded to a host-chosen default.
 */
export const SHELL_UX_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.keys(SHELL_UX_ERROR_CODE_MEMBERS),
);

/**
 * The single typed error used across the core. Carries a stable `code` for
 * programmatic handling and, where applicable, the dotted path of the field
 * that caused the rejection so the message can name it.
 */
export class ShellUXError extends Error {
  override readonly name = 'ShellUXError';
  readonly code: ShellUXErrorCode;
  /** Dotted path of the offending field, or `null` when not field-specific. */
  readonly field: string | null;

  constructor(code: ShellUXErrorCode, message: string, field: string | null) {
    super(message);
    this.code = code;
    this.field = field;
  }
}
