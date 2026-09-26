import type { ComponentType } from 'react';
import type { WhenExpression } from './commands/when';
import type { ResolvedTheme } from './theme/normalizeTheme';

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
 * The render-boundary rule above has a render site, and it is no longer stated
 * only as an obligation on future work. **The ribbon was that site and the ribbon
 * is deleted; there are four command surfaces where there was one, and there is
 * still exactly one place a plug-in string reaches the DOM.**
 * `src/components/command/commandListItem.tsx` is that place. The context bar, the
 * command palette, the floating toolbar and the omnibox composer lay rows out and
 * group them; not one of them touches `Command.label` or `Command.icon` itself.
 * The row renders the label as a JSX text node and resolves the icon through a
 * host-owned `Map` rather than into markup or a URL.
 *
 * Two kinds of test hold the rule, and they hold deliberately different things.
 * *Tests:* `src/components/command/__tests__/commandSurfaces.test.tsx` — "the
 * context bar renders a markup-shaped plug-in label as a text node, not as
 * markup", which is a statement about one hostile input on one surface and has
 * three siblings naming the other three; and "the shared command row module source
 * contains no HTML-injection sink at all", which parses the module with the
 * TypeScript compiler and is a statement about the MODULE, so it still holds if
 * somebody adds a second render path tomorrow. That second claim is asserted five
 * times over — once for the shared row and once for each surface — because a
 * surface that grew its own render path would be outside the row's guarantee and
 * inside its own.
 *
 * **That is five render sites, not a host-wide property, and this paragraph must
 * not be read as the wider claim.** `src/components/shared/VirtualizedList.tsx`
 * renders plug-in row content and is held by its own tests, not by these. Per
 * ADR-0001 Amendment G, the command surfaces' tests license a sentence about the
 * command surfaces and nothing beyond them.
 * ============================================================================
 */

/**
 * Identifier of one of the three shell panes.
 *
 * **A layout type, not a context field — since GitHub issue #13.** It names the
 * three panes for `PaneWrapper`, for `ShellLayout`'s resize bookkeeping and for
 * `HydrationEngine.PaneSizes`. It used to have a second life as the type of
 * `RibbonContext.focusedPane`, which is removed: nothing in the host ever wrote
 * that field, so it was permanently `null` and invited predicates that could
 * never fire. See ADR-0001 Amendment K Decision 6.
 */
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
 * **Its original caller is gone and it is not therefore dead.** It existed
 * because `RibbonContext.focusedPane` was written through `patchContext` — a
 * member reachable from plain JavaScript the compiler never saw — so validating
 * it needed the union as data. `focusedPane` was removed by GitHub issue #13 and
 * `assertValidPaneId` went with it.
 *
 * What is left is the other thing a runtime copy of a type union is good for:
 * asserting that a host-owned `Record<PaneId, …>` really has the union's keys and
 * no others. `HydrationEngine`'s `DEFAULT_PANE_SIZES` is exactly such a record,
 * and "covers exactly the pane ids the host declares" in
 * `src/core/services/__tests__/hydrationEngine.test.ts` compares the two.
 * Deleting this would have meant that test restating the union in its own words,
 * which is the drift the pin exists to prevent.
 */
export const PANE_IDS: ReadonlySet<string> = Object.freeze(new Set(Object.keys(PANE_ID_MEMBERS)));

/**
 * What a context key may hold: a primitive, and nothing else.
 *
 * **The narrowness IS the design** — see `IShellAPI.setContextKey` and ADR-0001
 * Amendment K Decision 2. An object would carry getters that re-enter host code
 * during a render-phase predicate, a prototype another extension could reach
 * through, and an identity no `Object.is` bail-out could compare; a primitive
 * carries none of those and costs one `typeof` to validate. This union is the
 * whole difference between a context key and the opaque `extensionState` blob
 * Amendment K records as rejected.
 */
export type ContextKeyValue = string | number | boolean | null;

/**
 * A LEAF of a structured payload: exactly what a context key may hold.
 *
 * **ADR-0001 Amendment K Decision 2 is PRESERVED AT THE LEAVES, not reversed.**
 * The three objections that decision raises against an object are objections to a
 * *live plug-in object reaching a render-phase predicate*, and every one of them
 * is answered by where a payload goes rather than by what it holds — see ADR-0001
 * Amendment L, which quotes all three and answers each. What survives here
 * unchanged is the leaf rule: the value at the bottom of a payload is a `string`,
 * `number`, `boolean` or `null` and nothing else, so what a renderer finally
 * reads costs one `typeof` to validate and invokes nothing when it is read.
 *
 * `PayloadLeaf = ContextKeyValue` is an ALIAS rather than a second spelling of
 * the union, for the reason `LEAPExtensionBlueprint.ribbonActions` is the
 * identical array object as `commands`: two spellings of one rule drift, and the
 * drift is silent. Widening one widens both, which is exactly the review that
 * should be forced.
 */
export type PayloadLeaf = ContextKeyValue;

/**
 * What a structured payload may hold: leaves, arrays of them, and records of
 * them, to a bounded depth.
 *
 * The recursion is what the primitive rule used to buy for free and it is now
 * paid for explicitly: `PAYLOAD_LIMITS` in `src/core/payload/PayloadChannel.ts`
 * bounds depth, node count, host-accounted size and channels per scope, and a
 * CYCLE IS REJECTED rather than truncated. A truncated cycle is a payload the
 * publisher did not write and the subscriber cannot tell from one that was.
 */
export type PayloadValue =
  | PayloadLeaf
  | readonly PayloadValue[]
  | { readonly [key: string]: PayloadValue };

/**
 * What KIND of block a payload describes.
 *
 * **A CLOSED HOST VOCABULARY WITH NO FALLBACK**, in the register `CommandCategory`
 * is closed and for the same reason: every candidate fallback is a statement
 * about how the payload should be rendered that the publisher never made. A
 * `chart` silently rendered as `text` is worse than a refused publish, because
 * the publisher has no way to find out.
 */
export type BlockKind = 'chart' | 'table' | 'form' | 'text' | 'agent';

/**
 * Exhaustiveness pin for `BLOCK_KINDS`, in the same shape as `PANE_ID_MEMBERS`:
 * the compiler rejects both a missing member and an invented one.
 */
const BLOCK_KIND_MEMBERS: Readonly<Record<BlockKind, true>> = Object.freeze({
  chart: true,
  table: true,
  form: true,
  text: true,
  agent: true,
});

/** `BlockKind` as a runtime allowlist. */
export const BLOCK_KINDS: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(BLOCK_KIND_MEMBERS)),
);

/**
 * One published block of structured data, as the HOST owns it.
 *
 * Every field is host-built. `data` is a deep copy into null-prototype records
 * and frozen arrays, so nothing of the publisher's object graph is retained, and
 * `revision` is assigned by the host.
 *
 * **`revision` bumps on EVERY accepted publish, including one whose content is
 * identical to the last, and that is stated here rather than left to be
 * discovered.** The host does not deep-compare payloads — a walk over 4096 nodes
 * on every publish would cost more than the re-render it saves — so republishing
 * the same table notifies every subscriber of that channel. It is the honest cost
 * of answering Amendment K Decision 2's third objection: `Object.is` cannot
 * compare two host-built copies, so the comparison a subscriber makes is against
 * this number and never against the object. Pinned by "bumps the revision and
 * notifies even when the republished content is identical" in
 * `src/core/__tests__/payloadChannel.test.tsx`.
 */
export interface StructuredPayload {
  /** The channel this was published on. A host-validated identifier. */
  readonly channel: string;
  /** The publisher's declared block kind, from the closed vocabulary above. */
  readonly kind: BlockKind;
  /**
   * A host-assigned, strictly increasing revision. It is a change token, not a
   * version the publisher chose, and it is the ONLY thing a subscriber should
   * compare.
   */
  readonly revision: number;
  /** The host-owned deep copy of what was published. */
  readonly data: PayloadValue;
}

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
  /**
   * Every item selected inside the active extension's view, in the order the
   * writer supplied them. Empty when nothing is selected.
   *
   * **This is the SINGLE SOURCE OF TRUTH for selection**, and `selectedItemId`
   * below is derived from it. It exists because `selectedItemId` alone cannot
   * express a multi-selection, and a list pane whose user has shift-clicked six
   * rows had no way to say so — the ribbon could only ever be told about one of
   * them (GitHub issue #14, ADR-0001 Amendment K Decision 1).
   *
   * The array is a HOST-OWNED FROZEN COPY, never the caller's object. It is
   * built element by element from a single read of the supplied value, exactly
   * as `normalizeNavigationNode` builds a navigation tree, so a Proxy that
   * reports one `length` while it is measured and another afterwards cannot grow
   * what the host stores. Every element is a string, there are no duplicates,
   * and the count is bounded by `REGISTRY_LIMITS.MAX_SELECTED_ITEMS`. Pinned by
   * the "setSelectedItems validates its argument" group in
   * `src/core/__tests__/shellApi.test.ts` and by "patchContext rejects what
   * setSelectedItems rejects" in `src/core/__tests__/contextPatch.test.ts`.
   */
  readonly selectedItemIds: readonly string[];
  /**
   * The LAST element of `selectedItemIds`, or `null` when nothing is selected.
   *
   * **Derived, not stored beside the array.** There is one writer — the store's
   * `applyPatch` — and it recomputes this field from `selectedItemIds` in the
   * same draft, so no subscriber can ever observe the two disagreeing. It is
   * kept on the interface because it is what a single-selection extension
   * actually wants, and because a great deal of code and documentation reads it.
   *
   * It stays WRITABLE through `patchContext` and `IShellAPI.setSelectedItem` as
   * a shorthand for a selection of one — those doors funnel into the same one
   * writer rather than setting this field beside the array. When a single patch
   * supplies both, `selectedItemIds` wins and this field is recomputed from it;
   * that keeps `patchContext(store.getContext())` an exact round trip. Pinned by
   * "derives selectedItemId from the last element of selectedItemIds" and
   * "lets selectedItemIds outrank selectedItemId in one patch" in
   * `src/core/__tests__/contextPatch.test.ts`.
   */
  readonly selectedItemId: string | null;
  /**
   * The FOREGROUND extension's own context keys — named primitive facts it has
   * published about itself, for its own predicates to branch on.
   *
   * **This is the general mechanism, and `selectedItemIds` above is not an
   * instance of it.** Selection is a host concept: the shell renders it, clears
   * it on handover and hands it to `onExecute`. A context key is plug-in-private
   * state the host stores and republishes without understanding — which is
   * exactly what VS Code's `when` clauses read, and the prior art is named
   * because the shape is deliberately the same one (ADR-0001 Amendment K
   * Decision 2). Without it, every plug-in state a ribbon needed to react to
   * would have to become a new `RibbonContext` field, and `selectedItemIds`
   * would have been the first of many.
   *
   * **It is what makes a predicate able to be pure AND reactive.** The rejected
   * alternative was an `invalidateRibbon()` signal letting a predicate read
   * mutable module state; that reintroduces the tearing `useSyncExternalStore`
   * exists to prevent, because the predicate runs during render. A context key
   * goes through the store, so the value a predicate reads is part of the same
   * snapshot every other subscriber has, and the predicate stays a pure function
   * of its argument.
   *
   * **Host-owned, frozen, and NULL-PROTOTYPE.** The keys originate in a plug-in
   * manifest-shaped string and are held to `EXTENSION_ID_PATTERN` and
   * `RESERVED_IDS`, so `__proto__` cannot get in — and the record is built on
   * `Object.create(null)` anyway, so there is nothing to pollute even if the
   * filter were wrong. That is the same belt-and-braces the registry's `Map`
   * stores are. Read it with `ctx.contextKeys['my-key']`; it has no
   * `hasOwnProperty` and needs none.
   *
   * **Scope, stated exactly.** The record published here belongs to whichever
   * extension is in the FOREGROUND. An extension writes only into its own
   * namespace and has no parameter with which to name another's, so it cannot
   * WRITE another extension's keys — but a backgrounded extension calling
   * `getContext()` gets this same snapshot and can therefore READ the foreground
   * extension's keys. That is collision-resistance, in exactly the register
   * `setBadgeCount` uses, and not confinement. Do not put anything in a context
   * key that would matter if another extension read it. Pinned by "keeps two
   * extensions' context keys apart, and publishes only the foreground's" in
   * `src/core/__tests__/contextKeys.test.tsx`.
   *
   * Cleared on every real foreground handover, in the same single patch that
   * clears the selection and the nav node, and for the same reason: one
   * extension's state must not be handed to the next one. Pinned by "clears
   * every extension's context keys on a foreground handover" in
   * `src/core/__tests__/contextKeys.test.tsx`.
   */
  readonly contextKeys: Readonly<Record<string, ContextKeyValue>>;
}

/**
 * The SHAPE a navigation metric is drawn as.
 *
 * **A CLOSED HOST VOCABULARY WITH NO FALLBACK, and the asymmetry with
 * `NavigationNode.icon` is the decision.** It is the same asymmetry
 * `CommandCategory` draws, reached from the other direction. An unknown `icon`
 * key has an honest fallback: `FALLBACK_ICON` is a wrong picture beside a label
 * that is still there, still readable, still correct. An unknown SHAPE has none.
 * A `value` of `0.9` drawn as a bar says "nearly full"; drawn as a dot it says
 * "present"; and there is no third rendering that means "the host did not
 * recognise what you asked for". So the registry refuses an unknown kind with
 * `INVALID_FIELD` at the door, in the register `HOTKEY_KEYS` refuses an unknown
 * key.
 *
 * It is a lookup key into host-authored geometry and is **never interpolated** —
 * not into a class name, not into a `d` attribute, not into a `style`. Every path
 * `src/components/ui/MetricGlyph.tsx` draws is written by the host, exactly as
 * every path in `SHELL_ICONS` is. Pinned by "draws each metric kind from
 * host-authored geometry only" in
 * `src/components/__tests__/ShellLayoutMetrics.test.tsx`.
 */
export type NavigationMetricKind = 'bar' | 'sparkline' | 'dot';

/**
 * Exhaustiveness pin for `NAVIGATION_METRIC_KINDS`, in the same shape as
 * `PANE_ID_MEMBERS` and `COMMAND_CATEGORY_MEMBERS`: `Record<…, true>` makes the
 * compiler reject both a missing member and an invented one, so the runtime
 * allowlist cannot drift away from the union.
 */
const NAVIGATION_METRIC_KIND_MEMBERS: Readonly<Record<NavigationMetricKind, true>> = Object.freeze({
  bar: true,
  sparkline: true,
  dot: true,
});

/** `NavigationMetricKind` as a runtime allowlist. */
export const NAVIGATION_METRIC_KINDS: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(NAVIGATION_METRIC_KIND_MEMBERS)),
);

/**
 * A small quantitative glyph drawn beside a pane-1 navigation row.
 *
 * ============================================================================
 * WHY THIS IS A FIELD ON `NavigationNode` AND NOT A `views.pane1`
 * ============================================================================
 * `ShellLayout.tsx` decision 5 states that "nothing an extension can register
 * makes the context bar or pane 1 throw during render — both render validated
 * primitive strings — so those two boundaries are defence-in-depth". A
 * `views.pane1` would make that sentence FALSE, and not narrowly: pane 1 renders
 * EVERY registered extension's rows in one tree, so one vendor's metric renderer
 * throwing during render would take the whole navigation surface down to a fault
 * surface — every other vendor's rows, and the only route back to them, with it.
 *
 * A declarative field cannot do that. What arrives here is four validated
 * primitives and a bounded array of numbers; what draws them is host-authored.
 * The sentence quoted above therefore stays true, and this interface is what
 * keeps it true.
 * ============================================================================
 *
 * **THERE IS NO COLOUR FIELD, AND THERE WILL NOT BE ONE.** A plug-in-supplied
 * colour is a colour outside `design/`, which is precisely what
 * `design/contrast-manifest.json` and `npm run tokens:check` cannot measure — so
 * a metric would be the one painted thing in the shell whose contrast nobody had
 * reviewed. A metric draws in `currentColor` and inherits the row's own text
 * colour, which is a token, which is measured. Nor does a metric value reach CSS
 * at all: `MetricGlyph` builds a host-authored `d` string from the clamped
 * number and sets no custom property, no length and no inline style, so there is
 * no declaration for a value to terminate even before it is clamped.
 */
export interface NavigationMetric {
  /**
   * Which shape to draw. Held to `NAVIGATION_METRIC_KINDS` with no fallback —
   * see `NavigationMetricKind` above.
   */
  readonly kind: NavigationMetricKind;
  /**
   * The scalar, as a fraction of the glyph's full extent.
   *
   * **Host-CLAMPED to `[0, 1]`; a non-finite value is REJECTED. The asymmetry is
   * the decision and it is not an inconsistency.** A `1.4` is a scaling mistake —
   * somebody divided by the wrong denominator — and refusing an entire blueprint,
   * with all its navigation, all its commands and both its views, over one badly
   * scaled bar is out of proportion to the error. There is an obviously right
   * answer, `1`, and taking it costs the author nothing they meant to say. `NaN`
   * has no such answer: no clamp turns "not a number" into a fraction, and every
   * candidate — `0`, `1`, "draw nothing" — invents a quantity the extension never
   * published. So it is `INVALID_FIELD` at the door, exactly as `setContextKey`
   * refuses a non-finite number and for the same reason. Pinned by "clamps an
   * out-of-range metric value at both doors and refuses a non-finite one" in
   * `src/core/__tests__/navMetric.test.tsx`.
   */
  readonly value: number;
  /**
   * Optional series for `kind: 'sparkline'`. Each point is clamped exactly as
   * `value` is, and the count is bounded by `REGISTRY_LIMITS.MAX_METRIC_POINTS`.
   *
   * The bound is small on purpose. This is tier 0 of the plan's three-tier
   * visualization model: a memoised path string with no chart instance behind it,
   * drawn once per navigation row, in a tree the shell re-renders on every
   * foreground change and on every badge write. Thirty-two points is a SHAPE;
   * three thousand is a chart, and a chart belongs in a pane that has a canvas to
   * spend on it. Pinned by "bounds the series at MAX_METRIC_POINTS" and "captures
   * the series length once, so a shifting length cannot grow what is stored" in
   * `src/core/__tests__/navMetric.test.tsx`.
   */
  readonly series?: readonly number[];
  /**
   * REQUIRED. What the metric says, in words.
   *
   * **This is the non-colour, non-shape channel WCAG 2.2 Success Criterion 1.4.1
   * Use of Color (Level A) asks for**, and it is required rather than optional
   * for the reason `NavigationNode.label` is required: a glyph whose only
   * channels are a shape and a length communicates nothing to a screen-reader
   * user and nothing to a user who cannot resolve a 3px bar. Making it optional
   * would put the accessible case behind an opt-in.
   *
   * It is UNTRUSTED display text and is rendered as an `sr-only` TEXT NODE beside
   * the glyph, never as markup — the same rule `label` is held to. Pinned by
   * "renders a declared navigation metric as a host-drawn glyph with its
   * description" in `src/components/__tests__/ShellLayoutMetrics.test.tsx`.
   */
  readonly description: string;
}

/** A node in an extension's pane-1 navigation tree. */
export interface NavigationNode {
  /** Must match `EXTENSION_ID_PATTERN`; unique within the owning tree. */
  readonly id: string;
  /** UNTRUSTED display text. Render as a text node only. */
  readonly label: string;
  /**
   * UNTRUSTED icon key, or omitted for no icon. Same rule as
   * `RibbonAction.icon`: resolve through the host-owned lookup table, never by
   * interpolating it into a URL or markup.
   *
   * The vocabulary is `SHELL_ICONS` in `src/components/ui/shellIcons.tsx` and is
   * published for extension authors in `DEVELOPER.md`. A key the host does not
   * publish resolves to the host's fallback glyph rather than to nothing, and a
   * node that declares no icon at all keeps the monogram the collapsed pane-1
   * track has always drawn. Pinned by "renders a declared node icon in the
   * collapsed track instead of the monogram", "falls back to the host glyph for
   * an icon key the host does not publish" and "keeps the monogram for a node
   * that declares no icon" in
   * `src/components/__tests__/ShellLayoutIcons.test.tsx`.
   */
  readonly icon?: string;
  /** Non-negative integer badge, or omitted when the node carries no badge. */
  readonly badgeCount?: number;
  /**
   * A small quantitative glyph beside the row, or omitted for none.
   *
   * **Declarative, and the `value` here is a STARTING value rather than a live
   * one** — the same relationship `badgeCount` has to `IShellAPI.setBadgeCount`.
   * It is spelled out here because `badgeCount` made the opposite mistake once
   * and it cost a whole issue (#12): a metric written into a blueprint is frozen
   * into the registry's host-owned record at registration and can never change
   * again. `IShellAPI.setNavMetric` writes into the shell store and
   * `useNavMetric` is what a renderer reads, so a runtime write is visible. The
   * store value overrides the declared one with `??`, never with a truthiness
   * test: a metric written down to `0` is a value, and `||` would fall back to a
   * stale blueprint number for exactly the reading that matters most. Pinned by
   * "overrides a blueprint metric value with the store value, including down to
   * zero" in `src/components/__tests__/ShellLayoutMetrics.test.tsx`.
   *
   * **The override reaches `value` and nothing else, and a runtime write to a
   * node that declared NO metric draws nothing.** That is deliberately not what
   * `badgeCount` does, and the asymmetry follows from the shapes rather than from
   * taste: a badge is one number and the store can supply the whole of it, while
   * a metric also needs a `kind` and a `description`, and the host will not
   * invent either. A `setNavMetric` on an undeclared node is therefore stored,
   * readable through `getNavMetric`, and drawn by nobody. Pinned by "draws
   * nothing for a runtime metric on a node that declared none" in the same file.
   */
  readonly metric?: NavigationMetric;
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
 * **Dispatched since ISSUE-006.** `useHotkeyDispatch` in
 * `src/core/hotkeyDispatch.ts` owns the shell's one `keydown` listener, called
 * once by `ShellLayout`; a chord is live only for the FOREGROUND extension, and
 * only for an action that is visible and not disabled. This comment used to say
 * that nothing dispatched a chord and that the dispatcher was Phase 2, which was
 * true when it was written and is not now. Declaration and validation are still
 * where they were — `normalizeRibbonAction` in `RegistryContext.tsx` — and
 * pinned by "validateBlueprint — ribbon action hotkeys" in
 * `src/core/__tests__/validation.test.ts`. Dispatch is pinned by "fires a
 * visible, enabled chord on the foreground extension" and "does not fire a
 * background extension chord while another extension is in the foreground" in
 * `src/core/__tests__/hotkeyDispatch.test.tsx`.
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

/**
 * The bucket a command is filed under when a surface groups commands.
 *
 * **A CLOSED HOST VOCABULARY WITH NO FALLBACK, and the asymmetry with `icon` is
 * the decision.** An unknown `icon` key resolves to `FALLBACK_ICON`, because a
 * wrong glyph is a cosmetic disappointment and the command is still there, still
 * labelled, still reachable. An unknown `category` has no honest fallback: every
 * candidate — a "Other" bucket, the first category, no bucket at all — is a
 * statement about *where the command lives* that the extension did not make and
 * the user cannot correct. A palette that files "Delete mailbox" under "View"
 * because the host guessed is worse than one that refused the manifest. So the
 * registry rejects an unknown category with `INVALID_FIELD` at the door, in the
 * same register `HOTKEY_KEYS` refuses an unknown key.
 *
 * Named for what a command DOES rather than for any vendor's domain, for the
 * reason `SHELL_ICONS` names its glyphs for shapes: a vocabulary named after one
 * vendor's nouns is a vocabulary the next vendor cannot use.
 */
export type CommandCategory =
  | 'file'
  | 'edit'
  | 'view'
  | 'navigate'
  | 'select'
  | 'insert'
  | 'tools'
  | 'help';

/**
 * Exhaustiveness pin for `COMMAND_CATEGORIES`, in the same shape as
 * `PANE_ID_MEMBERS` above: `Record<CommandCategory, true>` makes the compiler
 * reject both a missing member and an invented one, so the runtime allowlist
 * cannot drift away from the union.
 */
const COMMAND_CATEGORY_MEMBERS: Readonly<Record<CommandCategory, true>> = Object.freeze({
  file: true,
  edit: true,
  view: true,
  navigate: true,
  select: true,
  insert: true,
  tools: true,
  help: true,
});

/**
 * `CommandCategory` as a runtime allowlist, and as the ORDER categories are
 * presented in.
 *
 * An array rather than a `Set`, unlike `PANE_IDS` and `HOTKEY_KEYS`, because this
 * one has a second job: `CommandRegistry.listByCategory` walks it to build its
 * groups, and a `Set`'s iteration order would be an accident of declaration
 * rather than a decision. Membership is `COMMAND_CATEGORIES.includes(...)`, which
 * is a linear scan over eight entries.
 */
export const COMMAND_CATEGORIES: readonly CommandCategory[] = Object.freeze(
  Object.keys(COMMAND_CATEGORY_MEMBERS) as CommandCategory[],
);

/**
 * A surface a command asks to appear on.
 *
 * **A REQUEST, NOT A GRANT.** `surfaces` narrows where a command may be offered;
 * it can never widen what a surface shows past what that surface decides. The
 * palette lists foreground commands, host commands and the switch-extension verb
 * and nothing else, whatever a background extension declares here — see
 * `CommandRegistry`. Omitting the field means "every surface", which is what a
 * `RibbonAction` written before this field existed meant and still means.
 */
export type CommandSurface = 'context-bar' | 'palette' | 'floating-toolbar' | 'omnibox';

/** Exhaustiveness pin for `COMMAND_SURFACES`. Same shape, same reason. */
const COMMAND_SURFACE_MEMBERS: Readonly<Record<CommandSurface, true>> = Object.freeze({
  'context-bar': true,
  palette: true,
  'floating-toolbar': true,
  omnibox: true,
});

/** `CommandSurface` as a runtime allowlist. */
export const COMMAND_SURFACES: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(COMMAND_SURFACE_MEMBERS)),
);

/**
 * A single command contributed by an extension.
 *
 * **This is `RibbonAction`, generalised rather than replaced.** `isVisible`,
 * `onExecute`, the structured `Hotkey` and the 60-key `HOTKEY_KEYS` allowlist all
 * survive unaltered; `when`, `category`, `surfaces` and `priority` are added. The
 * ribbon is gone and the guards that stood in front of it are not: `isVisible`
 * and `execute` in `src/core/command.ts` are still the only route to a plug-in
 * predicate or handler, now for four surfaces instead of two.
 *
 * `export type RibbonAction = Command` below is a DEPRECATED ALIAS, kept so that
 * mocks, fixtures and tests migrate a file at a time rather than in one diff.
 */
export interface Command {
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
   * **Declared, validated, and — since ISSUE-006 — dispatched.** The registry
   * checks the shape, the allowlist, the modifier rule and intra-extension
   * uniqueness, then stores a frozen host-owned copy; `useHotkeyDispatch` routes
   * a matching keystroke to `onExecute` through the SAME `isVisible` and
   * `isDisabled` guards the ribbon button uses, which is what keeps a chord from
   * being a wider route to a plug-in handler than the button is.
   *
   * **Exactly two modules under `src/` touch a key event, and both are named in
   * allowlists checked in both directions.** `src/core/hotkeyDispatch.ts` holds
   * the repository's only `addEventListener`; since ISSUE-004,
   * `src/components/shared/VirtualizedList.tsx` carries an `onKeyDown` on its
   * scroll container which moves the list selection — arrow keys, Home/End, Page
   * Up/Down — and consults no chord, no `hotkey` field and no registry. Every
   * other module is held to registering nothing and naming no
   * `keydown`/`keyup`/`keypress` at all. Pinned by "finds no listener
   * registration in any module outside the hotkey-dispatch allowlist", "finds no
   * key-event name in any module outside the key-event allowlist", "holds the
   * key-event allowlist to the exact spellings each listed module contains" and
   * "holds the hotkey-dispatch allowlist to the exact spellings the dispatcher
   * contains" in `src/__tests__/noEventListener.test.ts`, which parses every
   * non-test module under `src/` with the TypeScript compiler.
   *
   * Comments are trivia to the parser and are not scanned, which is what lets
   * this docblock state the property; a listener reached through a name that is
   * not text — `el[fromAVariable](...)` — is outside what it can see, and that
   * limit is stated in the test. What a source scan cannot see at all is that the
   * dispatcher's one listener is really removed on unmount, so that is pinned at
   * runtime instead, by "adds exactly one keydown listener and removes the
   * identical handler on unmount" in
   * `src/core/__tests__/hotkeyDispatch.test.tsx`. The narrower fact that
   * `src/core/hotkeys.ts` remains four pure helpers that attach nothing is
   * "hotkeys module — does not attach anything" in
   * `src/core/__tests__/hotkeys.test.ts`.
   */
  readonly hotkey?: Hotkey;
  /**
   * A DECLARATIVE sibling of `isVisible`, as an expression over `RibbonContext`.
   *
   * **The two are tiers, not alternatives, and both are consulted.** A command is
   * offered only when `isVisible(ctx) === true` AND — if a `when` was declared —
   * the expression is also true. That AND is what makes adding `when` to an
   * existing command incapable of WIDENING where it appears: the predicate that
   * already hid it still hides it.
   *
   * The reason the field exists is `src/core/commands/when.ts`'s banner and
   * §3.5 of the native-host plan: `isVisible` is a synchronous render-phase
   * boolean and cannot cross a process boundary, while three of the four command
   * surfaces are host chrome evaluating predicates for commands whose code lives
   * in a pane process. An expression over primitives can be evaluated by the host
   * against its own replica; a closure cannot. `ContextKeyValue`'s primitives-only
   * union — written for render-phase-getter reasons — is what makes that
   * transport free.
   *
   * **Optional today, and the succession is written down rather than assumed.**
   * There is one process, so `isVisible` still reaches every surface and a
   * command declaring no `when` is not thereby invisible anywhere. When the panes
   * become separate processes, `when` becomes REQUIRED for a command that appears
   * in host chrome and `isVisible` narrows to a pane-local fast path for the
   * floating toolbar. Requiring it now would empty the context bar for every
   * extension written against the old contract, including both verification
   * remotes.
   *
   * Parsed ONCE, at registration, by `parseWhen`, which is why a malformed
   * expression is a registration rejection rather than a per-render surprise. The
   * parsed tree is carried on `whenExpression` below.
   */
  readonly when?: string;
  /**
   * The parsed form of `when`. **HOST-DERIVED. An extension never declares it.**
   *
   * The registry parses `when` and assigns this field on the frozen host-owned
   * record; a `whenExpression` supplied by a plug-in is not read, not copied and
   * not validated — it simply does not survive normalisation, exactly as an
   * undeclared field on any other normalised record does not.
   *
   * It lives on the record rather than in a side table because the record is
   * already a host-owned copy, and because four surfaces evaluate it on every
   * render: re-parsing 512 characters per command per surface per keystroke is
   * not a cost worth paying to keep a field off an interface. Same posture as
   * `normalizeHotkey` materialising all four modifiers.
   */
  readonly whenExpression?: WhenExpression;
  /**
   * Which bucket this command is filed under when a surface groups commands.
   *
   * Held to `COMMAND_CATEGORIES` with **no fallback** — see the docblock there.
   * A command with no category is not an error: it is uncategorised, and
   * `listByCategory` reports it in its own trailing group rather than guessing.
   */
  readonly category?: CommandCategory;
  /**
   * The surfaces this command asks to appear on. Omitted means all of them.
   *
   * A REQUEST, not a grant — see `CommandSurface`. Members are held to
   * `COMMAND_SURFACES`, an empty array is legal and means "no surface at all"
   * (a command reachable only by its chord), and a repeated member is rejected
   * rather than collapsed, for the reason `setSelectedItems` rejects a repeated
   * id: a list containing the same entry twice is the caller's bug.
   */
  readonly surfaces?: readonly CommandSurface[];
  /**
   * Ordering hint within a surface and within a category. Higher comes first.
   *
   * A safe integer, and `undefined` sorts as 0. Ties keep declaration order,
   * because every projection sorts with a STABLE comparator over an array built
   * in declaration order — so a manifest that declares no priorities at all gets
   * exactly the order it wrote, which is what `INLINE_ACTION_LIMIT` used to
   * depend on and still does.
   */
  readonly priority?: number;
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
   * ISSUE-002 there has been one, and since the ribbon's deletion it is
   * `CommandRegistry` in `src/core/commands/CommandRegistry.ts`, which calls
   * `isVisible` through the guard in `src/core/command.ts` on every projection. What that guard contains is MISBEHAVIOUR, not impurity.
   * A predicate that throws is treated as not visible and reported, and the
   * remaining actions still render; the report itself is wrapped, so a plug-in that
   * replaced `console.error` with a throwing function cannot turn containment into
   * an escape. A non-boolean return is treated as not visible too, because the call
   * site compares `=== true` rather than testing truthiness. *Tests:*
   * `src/components/command/__tests__/commandSurfaces.test.tsx` — "the context bar
   * hides a command whose isVisible predicate throws and still renders the rest",
   * "treats a non-boolean isVisible result as not visible, on every surface" and
   * "the context bar survives a console.error that itself throws while reporting a
   * bad predicate", each of the first and last with three siblings naming the
   * other three surfaces.
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
   * Without it the handler received a `RibbonContext` and no capability, and
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

/**
 * The old name for `Command`. **Deprecated; it is the same type.**
 *
 * Kept as an alias rather than removed so that the migration is incremental: a
 * mock, a fixture or a test that still says `RibbonAction` compiles unchanged and
 * means exactly what it meant before. A rename that touched every declaration
 * site in one diff would have buried the contract change — the four new optional
 * fields and the two-source rule on the blueprint — inside five hundred lines of
 * mechanical churn.
 *
 * @deprecated Use `Command`.
 */
export type RibbonAction = Command;

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
 * The optional lifecycle hooks a blueprint may declare. ADR-0006 decision 8,
 * GitHub issue #17.
 *
 * Every hook is plug-in code the host calls, so each is held to the registry's
 * posture towards untrusted fields: the `lifecycle` object is read ONCE at
 * `register`, each member must be a function or absent, and the host calls the
 * function it copied then — replacing a hook on your own blueprint afterwards
 * changes nothing. Each is called with no `this`.
 *
 * **What a throw does is contained to your own registration.** That is error
 * containment, not isolation: every plug-in runs in one realm and there is no
 * boundary between them (ADR-0001 Amendment E).
 *
 * **Hooks are synchronous calls.** A hook that returns a promise (an `async`
 * function) is not awaited; a rejection is reported to the host like a throw,
 * after the fact. A hook that reaches the host's activation controller and calls
 * `activate`, `blur` or `release` is refused with `LIFECYCLE_REENTRY`. *Tests:*
 * `src/core/__tests__/lifecycle.test.tsx` — "reports an async hook's rejection
 * through the fault path, without awaiting it" and "refuses an activate made
 * from inside onDeactivate, and the outer handover completes".
 *
 * There is deliberately **no `onRegister`**: activation mints the handle
 * (ADR-0001 Amendment C), so a hook at registration would have nothing to act
 * through. A never-activated extension still cannot publish an opening badge —
 * a named 1.0 limit.
 */
export interface ExtensionLifecycle {
  /**
   * Called when the extension TAKES the foreground — `activate` moving the
   * foreground to it, not re-activating an extension that already holds it —
   * after the foreground is published, with the extension's live scoped handle.
   * The context it reads is already its own, so context keys and badges written
   * here stay written.
   *
   * **A throw fails the activation for this extension only.** `activate`
   * returns `ok: false` with `LIFECYCLE_HOOK_THREW` and the thrown message in
   * words, the extension's handle is released (`onRelease` runs, then the handle
   * is revoked) and the foreground is dropped. Its registration and every other
   * extension's handle are untouched. *Tests:*
   * `src/core/__tests__/lifecycle.test.tsx` — "a throwing onActivate leaves a
   * healthy sibling fully usable".
   */
  readonly onActivate?: (shell: IShellAPI) => void;
  /**
   * Called when the extension LOSES the foreground to another extension or to
   * `blur`, before the new foreground is published. The handle stays live:
   * foreground loss is not revocation. Not called when the extension is
   * released or unregistered — `onRelease` is.
   *
   * A throw is reported to the host (`ShellHostProvider`'s `onLifecycleFault`,
   * or `console.error`) and the handover continues: one extension's hook cannot
   * stop another from taking the foreground.
   */
  readonly onDeactivate?: () => void;
  /**
   * Called immediately BEFORE the extension's handle is revoked — on `release`,
   * on `unregister` (so on disable and remove), and when `onActivate` threw.
   * Synchronous: the handle is still live inside it, so this is where to flush,
   * cancel timers and persist. Not called for an extension that was never
   * activated, because it holds no handle to revoke.
   *
   * **Revocation happens whatever it does.** A throw is reported to the host
   * and the handle is revoked anyway. *Tests:*
   * `src/core/__tests__/lifecycle.test.tsx` — "calls onRelease before
   * revocation, and revokes even when it throws".
   */
  readonly onRelease?: () => void;
}

/**
 * The manifest object a plugin module exports. This is the entire contract a
 * plugin has with the host; nothing outside this shape is read.
 *
 * **This shape describes a HOST-OWNED, NORMALISED record**, which is why both
 * `commands` and `ribbonActions` are required on it: the registry always
 * populates both, with **the same frozen array**, so no reader has to know which
 * name the manifest used. What a plug-in DECLARES is
 * `LEAPExtensionBlueprintInput` below, where exactly one of the two is supplied.
 */
export interface LEAPExtensionBlueprint {
  /** Must match `EXTENSION_ID_PATTERN`. Unique across the whole registry. */
  readonly id: string;
  /** UNTRUSTED display name. Render as a text node only. */
  readonly name: string;
  /** UNTRUSTED version string, e.g. `"1.0.0"`. Opaque to the host. */
  readonly version: string;
  readonly navigationTree: readonly NavigationNode[];
  /**
   * The extension's commands, under the old name.
   *
   * **The identical array object as `commands`**, not a copy of it — reference
   * equality holds, so `blueprint.ribbonActions === blueprint.commands`. One
   * collection with two names cannot drift; two collections with two names is the
   * drift `src/core/command.ts` exists to prevent, one level up.
   *
   * @deprecated Read `commands`.
   */
  readonly ribbonActions: readonly Command[];
  /** The extension's commands. The identical array object as `ribbonActions`. */
  readonly commands: readonly Command[];
  readonly views: ExtensionViews;
  /**
   * Optional lifecycle hooks. Present on the normalised record only when the
   * blueprint declared them, as a frozen host-owned copy of the object the
   * plug-in wrote; the functions inside are the plug-in's own and are not
   * frozen, exactly as `views` and each command's callbacks are not.
   */
  readonly lifecycle?: ExtensionLifecycle;
}

/**
 * What a plug-in module actually WRITES.
 *
 * **Exactly one of `commands` and `ribbonActions`, and the compiler says so.** A
 * manifest declaring both is refused at registration with `INVALID_FIELD` rather
 * than merged or preferred, for the reason `src/core/command.ts` exists: two
 * sources for one collection drift, and the drift is silent. Which one wins would
 * be a rule nobody could see from the manifest, and "they must agree" is a rule
 * nothing enforces.
 *
 * `register` takes `unknown`, so this type is a courtesy to an author writing in
 * TypeScript and never the thing the host trusts. Every rule it expresses is
 * enforced again at the door, over plain JavaScript.
 */
export type LEAPExtensionBlueprintInput = Omit<
  LEAPExtensionBlueprint,
  'ribbonActions' | 'commands'
> &
  (
    | { readonly commands: readonly Command[]; readonly ribbonActions?: never }
    | { readonly ribbonActions: readonly Command[]; readonly commands?: never }
  );

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
   * **A selection of one.** Since GitHub issue #14 this is exactly
   * `setSelectedItems(id === null ? [] : [id])`: `selectedItemIds` is the field
   * that is written and `selectedItemId` is recomputed from it, so the two
   * cannot drift. Nothing about the single-selection case changed — an extension
   * that only ever selects one row can go on calling this and reading
   * `ctx.selectedItemId`.
   *
   * The value is opaque to the host: it is the extension's own item
   * identifier, not a registry key, so it is checked for TYPE only and not
   * against `EXTENSION_ID_PATTERN`. It is checked, though, because this value
   * lands in `RibbonContext` — a snapshot the host hands to OTHER extensions'
   * `isVisible` and `onExecute`. An unchecked argument would
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
   * Replace the whole selection. Pass an empty array to clear it.
   *
   * This is the multi-selection door, and `RibbonContext.selectedItemIds` is
   * what it writes; `selectedItemId` is recomputed from the last element in the
   * same patch, so a subscriber never sees the two disagree.
   *
   * **`ids` is untrusted input and is neither trusted nor retained.** The array
   * is read once — its length captured, then each element read exactly once into
   * a host-owned array — and it is that host-owned array which is validated,
   * frozen and stored. Mutating the array you passed afterwards changes nothing.
   * Each element is held to the same rule `setSelectedItem` applies to `id`
   * (a string, opaque, not `EXTENSION_ID_PATTERN`), the count is bounded by
   * `REGISTRY_LIMITS.MAX_SELECTED_ITEMS`, and **a repeated id is rejected**
   * rather than silently collapsed: a selection containing the same row twice is
   * the caller's bug, and quietly deduplicating it would return a different
   * selection from the one that was asked for. Pinned by the "setSelectedItems
   * validates its argument" group in `src/core/__tests__/shellApi.test.ts`.
   *
   * A store listener runs inside this call, exactly as it does for
   * `setSelectedItem`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is written;
   *   `INVALID_FIELD` when `ids` is not an array, when it or one of its elements
   *   refuses to be read, when an element is not a string, or when an id
   *   repeats; `PAYLOAD_TOO_LARGE` when the count exceeds
   *   `REGISTRY_LIMITS.MAX_SELECTED_ITEMS`; `REENTRANT_NOTIFY` from the
   *   notification cascade, after the fields are committed.
   */
  setSelectedItems(ids: readonly string[]): void;
  /**
   * Set — or clear, with `null` — the selected pane-1 navigation node.
   *
   * **The host's pane-1 click handler and this method are one path, not two.**
   * `ShellLayout` calls `ShellStateStore.setActiveNavNode` and so does this
   * facade, so the rule that decides what `activeNavNodeId` may hold is written
   * once. Before GitHub issue #15 an extension could not navigate at all: the
   * field was writable only by the host's own click handler, so a plug-in that
   * wanted "open the Invoices node" from a ribbon action had nothing to call.
   *
   * `nodeId` IS a host lookup key — unlike `setSelectedItem`'s `id` — so it is
   * held to the registry's own allowlist and reserved words, the same rule
   * `setBadgeCount` applies to its `nodeId`. Pinned by "setActiveNavNode
   * validates its argument" in `src/core/__tests__/shellApi.test.ts`.
   *
   * **It is not checked against YOUR navigation tree**, and that is deliberate
   * rather than an omission: `activeNavNodeId` is one host-wide field, the host
   * clears it on every foreground handover, and an extension that names a node
   * it does not own gets a field no renderer of its own will match. That is the
   * same posture `setSelectedItem` takes towards an item id the extension made
   * up. It is scoping by convention, not confinement — see `setBadgeCount`.
   *
   * A store listener runs inside this call, exactly as it does for
   * `setSelectedItem`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is written;
   *   `INVALID_ID` when `nodeId` is neither a registry-valid identifier nor
   *   `null`; `REENTRANT_NOTIFY` from the notification cascade, after the field
   *   is committed.
   */
  setActiveNavNode(nodeId: string | null): void;
  /**
   * Publish one named primitive fact about YOUR extension, for your own ribbon
   * predicates to branch on. It surfaces as `RibbonContext.contextKeys[key]`.
   *
   * **Why this exists, and what it replaces.** A predicate is a pure function of
   * the context and is handed no capability, which is what stops it writing
   * during render. That left a plug-in with no way to make the ribbon
   * re-evaluate from state the host does not model: a mail module that wants
   * "Reply" hidden until a message is loaded had nothing to say so with, because
   * `selectedItemId` says a row is selected and not that its body arrived. The
   * two alternatives were both rejected in ADR-0001 Amendment K Decision 1 — an
   * `invalidateRibbon()` signal, which would have licensed predicates to read
   * mutable module state and brought the tearing back, and an opaque
   * `extensionState` blob, which is a dumping ground with no validation story.
   * This is the third answer, and it is VS Code's: named keys, host-owned,
   * read by visibility expressions.
   *
   * **`value` is primitives only, and that is the load-bearing constraint.** A
   * `string`, `number`, `boolean` or `null` — nothing else, ever. An object would
   * put a getter the plug-in wrote inside a render-phase predicate read, hand one
   * extension a live prototype chain into another's code, and defeat the
   * `Object.is` comparison that keeps an unchanged write from waking every
   * subscriber in the shell. Anything else is `INVALID_FIELD`. A `number` must be
   * finite: `NaN` and `Infinity` are values a predicate cannot usefully branch on
   * and are refused at the door rather than left to surprise one.
   *
   * **`key` is a host lookup key** and is held to the registry's own allowlist
   * and reserved words, exactly as `setBadgeCount`'s `nodeId` is. An extension
   * may hold at most `REGISTRY_LIMITS.MAX_CONTEXT_KEYS` distinct keys, and a
   * `string` value at most `REGISTRY_LIMITS.MAX_CONTEXT_VALUE_LENGTH`
   * characters. There is no delete: spell "unset" `null`, which still occupies a
   * slot.
   *
   * **Scoped by the closure, like `setBadgeCount`.** The extension id is captured
   * at mint time and is not a parameter, so this method offers no way to write
   * another extension's keys. It is collision-resistance and not confinement —
   * the published record is readable by anything holding a context, and the
   * unscoped store behind this facade is public. See `RibbonContext.contextKeys`.
   *
   * **Writing the value a key already holds changes nothing and notifies
   * nobody**, the same bail-out `patchContext` applies field by field. A key
   * written from a background extension does not move the published record
   * either, because only the foreground's namespace is published — so it does
   * not notify. Both pinned by "does not notify when a context key is rewritten
   * with the value it already holds" and "does not notify for a background
   * extension's own context key" in `src/core/__tests__/contextKeys.test.tsx`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is written;
   *   `INVALID_ID` when `key` is not a registry-valid identifier;
   *   `INVALID_FIELD` when `value` is not a finite `number`, `string`, `boolean`
   *   or `null`; `PAYLOAD_TOO_LARGE` when a `string` value is too long or the key
   *   would be one too many, and `PAYLOAD_TOO_LARGE`, since host contract 1.1, when this is the first write
   *   under your scope and the shell store already holds state for
   *   `STORE_LIMITS.MAX_SCOPES` (1024) scopes — reachable through your own handle
   *   only when that many other scopes are held, e.g. as one of more than 1023
   *   extensions registered and writing, and pinned by "refuses a new scope
   *   through an extension's own handle once 1024 are held" in
   *   `src/core/__tests__/navigationTree.test.tsx`; nothing is written then;
   *   `REENTRANT_NOTIFY` from the notification cascade, after the key is
   *   committed.
   */
  setContextKey(key: string, value: ContextKeyValue): void;
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
   *   `count` is not a non-negative safe integer; `PAYLOAD_TOO_LARGE`, since host contract 1.1, when this is the first write
   *   under your scope and the shell store already holds state for
   *   `STORE_LIMITS.MAX_SCOPES` (1024) scopes — reachable through your own handle
   *   only when that many other scopes are held, e.g. as one of more than 1023
   *   extensions registered and writing, and pinned by "refuses a new scope
   *   through an extension's own handle once 1024 are held" in
   *   `src/core/__tests__/navigationTree.test.tsx`; nothing is written then;
   *   `REENTRANT_NOTIFY` when a listener writes back to the store hard enough to run the notification
   *   cascade into its limit — raised AFTER the badge is committed, so this one
   *   rejection does not mean nothing happened. Pinned by "raises
   *   REENTRANT_NOTIFY from setBadgeCount, with the badge already committed" in
   *   `src/core/__tests__/shellApi.test.ts`.
   */
  setBadgeCount(nodeId: string, count: number): void;
  /**
   * Read back the badge count for one of YOUR navigation nodes, or `undefined`
   * when none was ever set.
   *
   * **Scoped by the same closure `setBadgeCount` is scoped by.** The extension
   * id is captured at mint time in `createRevocableShellAPI` and is not a
   * parameter, so this method offers no way to name another extension's scope
   * and read their badges — it reads back exactly what this handle can write.
   * Before GitHub issue #12 an extension could write a badge and had no way to
   * read one, so a module that wanted to increment its own count had to keep a
   * shadow copy and hope nothing else had written since.
   *
   * **That is collision-resistance and symmetry, not confinement**, in exactly
   * the terms `setBadgeCount` sets out: the unscoped store behind this facade is
   * reachable through the public `useShellStore()`, and
   * `store.getBadgeCount('other-ext', 'inbox')` reads another extension's badge.
   * What this member guarantees is that IT is not a route to one. Pinned by
   * "reads back only its own scope, and offers no parameter to name another"
   * under "badge collision-resistance" in `src/core/__tests__/dataflow.test.tsx`.
   *
   * A one-shot read that subscribes to nothing. A renderer wanting to re-render
   * when a badge moves uses `useBadgeCount` in `ShellAPI.ts` instead.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is read; `INVALID_ID`
   *   when `nodeId` is not a registry-valid identifier. It writes nothing, so it
   *   never notifies and `REENTRANT_NOTIFY` cannot come out of it.
   */
  getBadgeCount(nodeId: string): number | undefined;
  /**
   * Remove the badge for one of YOUR navigation nodes. ADR-0006 decision 8,
   * GitHub issue #80.
   *
   * **It deletes the entry rather than writing zero**, so `getBadgeCount`
   * answers `undefined` afterwards and pane 1 falls back to the `badgeCount`
   * the blueprint declared for the node, if any. Writing `0` is still the way to
   * show "none" over a declared count. Clearing a badge that was never set
   * changes nothing and notifies nobody.
   *
   * Scoped by the same closure as `setBadgeCount`: collision-resistance, not
   * confinement. *Tests:* `src/core/__tests__/navigationTree.test.tsx` —
   * "clearBadge deletes the entry rather than writing zero".
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is removed;
   *   `INVALID_ID` when `nodeId` is not a registry-valid identifier;
   *   `REENTRANT_NOTIFY` from the notification cascade, after the entry is
   *   removed.
   */
  clearBadge(nodeId: string): void;
  /**
   * Replace YOUR whole navigation tree. ADR-0006 decision 8, GitHub issue #16.
   *
   * **The whole tree, through the validator `register` uses.** `nodes` is read
   * once and re-normalised exactly as a blueprint's `navigationTree` is — every
   * id against `EXTENSION_ID_PATTERN`, every label, icon, badge and metric, the
   * depth bound and the node-count bound — into a fresh, deep-frozen host-owned
   * tree. A tree the registry would refuse is refused here with the same code,
   * and nothing is stored. The array you passed is never retained: mutating it
   * afterwards changes nothing. Since D-56 (#172), that includes refusing a
   * `label`/`icon`/metric `description` carrying a bidi control, a C0/C1
   * control, a line/paragraph separator or nothing but invisible characters —
   * the same `validateText` gate `register` applies, at this door too, not a
   * new one. *Tests:*
   * `src/core/__tests__/navigationTree.test.tsx` — "setNavigationTree
   * re-normalises the whole tree at the door" and "setNavigationTree refuses
   * a label carrying a bidi control or a line separator".
   *
   * **The registered blueprint record does not change**; the replacement is
   * held by the shell store under your scope, and pane 1 renders it in place of
   * the declared tree until you are unregistered. `activeNavNodeId`, badges and
   * metrics keyed on a node you removed are left as they are.
   *
   * Scoped by the closure, like `setBadgeCount`: collision-resistance, not
   * confinement.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is stored; every code
   *   `register` raises for a bad `navigationTree` (`INVALID_FIELD`,
   *   `MISSING_FIELD`, `INVALID_ID`, `RESERVED_ID`, `DUPLICATE_ID`,
   *   `PAYLOAD_TOO_LARGE`), with the field path rooted at `nodes`;
   *   `PAYLOAD_TOO_LARGE` when the store's scope bound refuses a new scope, as
   *   for `setBadgeCount`;
   *   `REENTRANT_NOTIFY` from the notification cascade, after the tree is
   *   stored.
   */
  setNavigationTree(nodes: readonly NavigationNode[]): void;
  /**
   * Set the live metric value for one of YOUR navigation nodes.
   *
   * **This member exists because `badgeCount` already made the opposite mistake
   * and it cost issue #12.** A `NavigationMetric` declared in a blueprint is
   * frozen into the registry's host-owned record at registration, so without a
   * runtime door the only bar pane 1 could ever draw would be the one the
   * manifest was written with and every later change would be invisible. That is
   * the identical defect `setBadgeCount` was added to fix, which is why this
   * member is deliberately its exact shape rather than a new one.
   *
   * **Scoped by the closure, exactly as `setBadgeCount` is.** The extension id is
   * captured at mint time and is not a parameter, so this method offers no way to
   * write another extension's metrics. It is collision-resistance and not
   * confinement, in the same register `setBadgeCount` sets out: the unscoped
   * store behind this facade is reachable through the public `useShellStore()`.
   * Pinned by "scopes setNavMetric by the closure and offers no parameter to name
   * another" in `src/core/__tests__/navMetric.test.tsx`.
   *
   * **`value` is CLAMPED to `[0, 1]` and REJECTED when non-finite** — the
   * asymmetry `NavigationMetric.value` argues for, applied at this runtime door
   * through the same host function the registration door uses, so the two cannot
   * drift apart.
   *
   * A store listener runs inside this call, exactly as it does for
   * `setBadgeCount`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is written;
   *   `INVALID_ID` when `nodeId` is not a registry-valid identifier;
   *   `INVALID_FIELD` when `value` is not a finite number; `PAYLOAD_TOO_LARGE`, since host contract 1.1, when this is the first write
   *   under your scope and the shell store already holds state for
   *   `STORE_LIMITS.MAX_SCOPES` (1024) scopes — reachable through your own handle
   *   only when that many other scopes are held, e.g. as one of more than 1023
   *   extensions registered and writing, and pinned by "refuses a new scope
   *   through an extension's own handle once 1024 are held" in
   *   `src/core/__tests__/navigationTree.test.tsx`; nothing is written then;
   *   `REENTRANT_NOTIFY` when a listener drives the notification cascade into its
   *   limit — raised AFTER the value is committed, the same asymmetry
   *   `setBadgeCount` has.
   *   Pinned by "raises REENTRANT_NOTIFY from setNavMetric, with the value
   *   already committed" in `src/core/__tests__/navMetric.test.tsx`.
   */
  setNavMetric(nodeId: string, value: number): void;
  /**
   * Read back the live metric value for one of YOUR navigation nodes, or
   * `undefined` when none was ever set.
   *
   * **Scoped by the same closure the write half is**, and it exists for the
   * reason ADR-0001 Amendment K Decision 4 gives about `getBadgeCount`: a scoped
   * write with an unscoped read is not a scope, and a write with no read at all
   * is the shadow-copy problem issue #12 filed against badges. It reads back
   * exactly what this handle can write and offers no parameter through which to
   * aim elsewhere. Pinned by "reads back only its own scope through getNavMetric"
   * in `src/core/__tests__/navMetric.test.tsx`.
   *
   * A one-shot read that subscribes to nothing. A renderer wanting to re-render
   * when a metric moves uses `useNavMetric` in `ShellAPI.ts` instead.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is read; `INVALID_ID`
   *   when `nodeId` is not a registry-valid identifier. It writes nothing, so it
   *   never notifies and `REENTRANT_NOTIFY` cannot come out of it.
   */
  getNavMetric(nodeId: string): number | undefined;
  /**
   * Publish one block of STRUCTURED data on one of YOUR channels.
   *
   * ==========================================================================
   * **THIS IS NOT A CONTEXT KEY, AND THE SEPARATION IS THE WHOLE DESIGN.**
   * `ContextKeyValue` is primitives-only because an object in `RibbonContext`
   * would carry "getters that re-enter host code during a render-phase
   * predicate, a prototype another extension could reach through, and an
   * identity no `Object.is` bail-out could compare". **That rationale is
   * ANSWERED here, not reversed** — ADR-0001 Amendment L quotes all three and
   * answers each:
   *
   *  - *Render-phase getters.* A payload NEVER enters `RibbonContext`. It lives
   *    in a separate store that `getContext()` does not read and that
   *    `isVisible(ctx)` has no argument through which to reach. Your getters run
   *    exactly ONCE, here, at an imperative door that is never on a render path.
   *    Pinned by "a published payload never enters the context, and publishing
   *    does not move the snapshot" in
   *    `src/core/__tests__/payloadChannel.test.tsx`.
   *  - *Prototype.* The host takes a DEEP COPY into `Object.create(null)`
   *    records and frozen arrays. Nothing of your object graph is retained, so
   *    there is no prototype for a reader to walk back through. Pinned by "takes
   *    a null-prototype deep copy, so a __proto__ key pollutes nothing" in the
   *    same file.
   *  - *Identity.* Subscribers compare `StructuredPayload.revision`, a
   *    host-assigned monotonic number, and never the object.
   * ==========================================================================
   *
   * **The bounds the primitive rule used to buy for free are now paid for
   * explicitly** — depth, node count, host-accounted bytes and channels per
   * scope, all in `PAYLOAD_LIMITS`. A CYCLE IS REJECTED, never truncated.
   *
   * `channel` is a host lookup key and is held to the registry's own allowlist
   * and reserved words, exactly as `setContextKey`'s `key` is. `data` is
   * `unknown` because the declared type binds nobody: every rule is enforced
   * again at this door, over plain JavaScript.
   *
   * **Scoped by the closure, and that is COLLISION-RESISTANCE, NOT CONFINEMENT.**
   * The extension id is captured at mint time and is not a parameter, so this
   * method offers no way to publish into another extension's channels and two
   * vendors that both name a channel `rows` do not overwrite each other. It is
   * the same register `setBadgeCount` and `setContextKey` set out, and the same
   * limit applies for the same reason: the payload store behind this facade is a
   * `useRef` on `ShellHostProvider`'s fiber, which is reachable by reflection from
   * any script on the page — see ADR-0001 Amendment E and "reaches the host
   * ActivationController by reflection anyway, and steals a sibling handle" in
   * `src/core/__tests__/reflection.test.tsx`. **Do not publish anything on a
   * channel that would matter if another extension read it.** What this member
   * guarantees is that IT is not the route to one. Pinned by "scopes the channel
   * by the closure, so two extensions cannot collide" in
   * `src/core/__tests__/payloadChannel.test.tsx`.
   *
   * **No new `ShellUXErrorCode` was added for any of this.** The existing ten
   * cover every rejection this door decides on, and `SHELL_UX_ERROR_CODE_MEMBERS`
   * below is compiler-pinned, so widening it would be a change every reader of
   * that union had to be told about for no gain.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered — checked first, so nothing is published;
   *   `INVALID_ID` when `channel` is not a registry-valid identifier;
   *   `INVALID_FIELD` when `kind` is not a member of `BLOCK_KINDS`, when a leaf
   *   is not a `PayloadLeaf`, when the graph contains a cycle, or when any part
   *   of it refuses to be read; `PAYLOAD_TOO_LARGE` when the payload exceeds a
   *   `PAYLOAD_LIMITS` bound or the scope already holds the maximum number of
   *   channels. A rejected publish leaves the channel exactly as it was and
   *   notifies nobody.
   */
  publishPayload(channel: string, kind: BlockKind, data: unknown): void;
  /**
   * Read the current payload on one of YOUR channels, or `null` when nothing has
   * been published on it.
   *
   * The returned object is the host's own frozen copy and its IDENTITY is stable
   * until the channel is republished — which is what makes it safe as a
   * `useSyncExternalStore` snapshot, and is why `useChannelPayload` exists in
   * `src/core/payload/PayloadChannel.ts` rather than in each plug-in.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered; `INVALID_ID` when `channel` is not a
   *   registry-valid identifier. It writes nothing and never notifies.
   */
  readPayload(channel: string): StructuredPayload | null;
  /**
   * Subscribe to one of YOUR channels. Returns the unsubscribe function.
   *
   * `listener` is called after every accepted publish on that channel, with the
   * host-owned payload. **Compare `revision`, never the object.**
   *
   * A listener here is a synchronous call into code the publisher did not write,
   * inside the publisher's own `publishPayload` frame — the same limit
   * `ShellStateStore.subscribe` documents at length, reached by another door. It
   * can observe, it can re-enter, and it can throw into the publisher's frame.
   *
   * **The returned disposer is TOTAL: it throws nothing, ever, including after
   * this handle is revoked.** That is deliberate and not an oversight. A pane-3
   * view unmounts *after* its extension is unregistered in the ordinary teardown
   * order, and React calls an effect cleanup with nowhere to raise to — a
   * throwing disposer would take the tree down during unmount. Liveness is
   * checked when the subscription is TAKEN, which is a call the extension makes
   * and can be reported to. Pinned by "returns a disposer that is total, so
   * unsubscribing after revocation throws nothing" in
   * `src/core/__tests__/payloadChannel.test.tsx`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered; `INVALID_ID` when `channel` is not a
   *   registry-valid identifier; `INVALID_FIELD` when `listener` is not a
   *   function.
   */
  subscribePayload(channel: string, listener: (payload: StructuredPayload) => void): () => void;
  /**
   * The resolved semantic token set for the current theme.
   *
   * **One `getComputedStyle(documentElement)` per THEME CHANGE, never one per
   * reader and never one per chart.** A canvas cannot read a CSS custom property,
   * so anything painting on one has to be handed resolved values; resolving them
   * at each chart would be one forced style recalculation per chart per frame.
   * `ThemeBridge` resolves the whole set once and every reader gets the same
   * frozen record, whose identity is stable until the theme changes — which is
   * what makes it safe to memoise a chart theme on. Pinned by "resolves the whole
   * semantic set with exactly one getComputedStyle call" in
   * `src/core/theme/__tests__/themeBridge.test.ts`.
   *
   * The record's keys are exactly `SEMANTIC_TOKEN_NAMES`, the host-owned set, so
   * a reader may index it without a membership test and a third-party theme
   * cannot introduce a name the host does not publish — `normalizeTheme` walks
   * the host's list and never the candidate's keys.
   *
   * **An EMPTY STRING is a legal answer and means "the document this was resolved
   * from defines nothing for that name".** It is not a colour and it is not a
   * default: the host deliberately does not invent one, because an untokenised
   * colour literal in `src/` is invisible to `design/contrast-manifest.json` and
   * is what `src/__tests__/noRawColor.test.ts` exists to stop. A reader that
   * paints has to decide what to do about it. See `EMPTY_THEME` in
   * `src/core/theme/normalizeTheme.ts` and ADR-0001 Amendment M Decision 6.
   *
   * **What is NOT true, and is said here rather than left to be assumed: nothing
   * measures a third-party theme's contrast.** See
   * `src/core/theme/normalizeTheme.ts` and ADR-0001 Amendment M Decision 5.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered. It reads and writes nothing else.
   */
  getTheme(): ResolvedTheme;
  /**
   * Subscribe to theme changes. Returns the unsubscribe function.
   *
   * `listener` is called with the new record after the bridge has re-resolved. It
   * is NOT called on subscribe; call `getTheme()` for the current value, which
   * keeps "when do I get the first one?" a question with one answer.
   *
   * **The returned disposer is TOTAL**, for the reason `subscribePayload`'s is: a
   * view unmounts after its extension is unregistered and React calls an effect
   * cleanup with nowhere to raise to. Liveness is checked when the subscription is
   * taken. Pinned by "returns a total theme disposer, so unsubscribing after
   * revocation throws nothing" in `src/core/__tests__/themeApi.test.ts`.
   *
   * @throws {ShellUXError} `REVOKED` when this handle's extension has been
   *   released or unregistered; `INVALID_FIELD` when `listener` is not a
   *   function.
   */
  onThemeChange(listener: (theme: ResolvedTheme) => void): () => void;
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
  | 'REENTRANT_NOTIFY'
  /**
   * An extension's `lifecycle.onActivate` threw, so its activation failed. The
   * message carries what was thrown, in words. See `ExtensionLifecycle`.
   */
  | 'LIFECYCLE_HOOK_THREW'
  /**
   * `activate`, `blur` or `release` was called from inside a running lifecycle
   * hook, and was refused. See `ShellHostProvider`'s `callHook`.
   */
  | 'LIFECYCLE_REENTRY';

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
  LIFECYCLE_HOOK_THREW: true,
  LIFECYCLE_REENTRY: true,
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
export const SHELL_UX_ERROR_CODES: ReadonlySet<string> = Object.freeze(
  new Set(Object.keys(SHELL_UX_ERROR_CODE_MEMBERS)),
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
