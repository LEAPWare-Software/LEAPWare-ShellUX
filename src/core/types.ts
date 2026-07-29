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
 * What the registry DOES enforce, because it is structural rather than
 * presentational, is identifier hygiene: every `id` must match
 * `EXTENSION_ID_PATTERN` (see RegistryContext.tsx). That allowlist makes it
 * impossible for an id to carry a path separator, a URL scheme, angle
 * brackets, or a prototype-pollution key such as `__proto__`. Ids are the only
 * plugin-supplied strings the host uses as lookup keys, so they are the only
 * ones that need to be constrained at rest.
 * ============================================================================
 */

/** Identifier of one of the three shell panes. */
export type PaneId = 'pane1' | 'pane2' | 'pane3';

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
  /** Pure predicate deciding whether the action appears at all. */
  isVisible(ctx: RibbonContext): boolean;
  /** Invoked on activation. May mutate host state through `IShellAPI`. */
  onExecute(ctx: RibbonContext): void;
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
 * Instances handed to plugin code are deep-frozen (see `createShellAPI`), so a
 * plugin cannot swap out a method to intercept another plugin's calls or to
 * escalate its own reach into the host.
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
   * a cross-plugin object-injection channel.
   *
   * @throws {ShellUXError} `INVALID_FIELD` when `id` is neither a string nor
   *   `null`.
   */
  setSelectedItem(id: string | null): void;
  /**
   * Set the badge count for a navigation node.
   * @throws {ShellUXError} when `nodeId` is malformed or `count` is not a
   *   non-negative safe integer.
   */
  setBadgeCount(nodeId: string, count: number): void;
  /** Immutable snapshot of the current host context. */
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
  /** A collection or string exceeded its declared bound. */
  | 'PAYLOAD_TOO_LARGE';

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
  PAYLOAD_TOO_LARGE: true,
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
