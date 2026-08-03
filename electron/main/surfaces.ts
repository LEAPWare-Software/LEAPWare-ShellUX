/**
 * ============================================================================
 * THE TWO SURFACES, NAMED ONCE.
 * ============================================================================
 * Phase 7 builds the **two-process** topology of docs/adr/0005-pane-topology.md
 * option B: one window, one main process, and two `WebContentsView`s — host
 * chrome, and one extension view holding panes 2 and 3 in a single document.
 *
 * **This file does not decide ADR-0005 and must not be read as deciding it.**
 * That ADR is `Proposed`, its deciding arm (arm B, NVDA) has not been run, and
 * the decision belongs to a human running it. What this file records is which
 * option was BUILT, and the reasoning is in the ADR-0001 amendment: two-process
 * is the option that is safe under either outcome. If arm B comes back clean,
 * three processes become *available* and adding a third surface here is an
 * additive change. If arm B comes back bad, two processes are already what
 * shipped. Building three first would have been the bet that cannot be unwound.
 *
 * The spike measured three things that make the extension view one document
 * rather than two, and each is a value rather than an inference —
 * `spike/topology/RESULTS.md`:
 *
 *  - `Tab` from pane A's last control **wraps inside pane A** in a two-view
 *    build and never reaches pane B. Host mediation is the only way across.
 *  - A cross-view `aria-labelledby` does not resolve, and the readings were
 *    byte-identical to two `<iframe>`s in ONE web contents — so the boundary
 *    that costs the reference is the **document**, not the view.
 *  - Both pane documents reported `document.hasFocus() === true`
 *    **simultaneously**, with no signal in either renderer distinguishing them.
 *
 * Panes 2 and 3 therefore stay in one document, where their ARIA relationships
 * and their focus order work for free — and they are always the same extension
 * anyway (plan §2: `ExtensionViews` declares `pane2` and `pane3` on one
 * blueprint).
 * ============================================================================
 */

/**
 * A surface that owns one `WebContentsView`.
 *
 * A union rather than a `string`, so that every table keyed on it — the focus
 * ring's order, the geometry map, the transport's origins — is checked by the
 * compiler for a missing member and for an invented one. Adding a third surface
 * is a compile error at every one of those sites, which is the property that
 * makes a later three-process change additive rather than archaeological.
 */
export type PaneSurfaceId = 'chrome' | 'extension';

/**
 * The surfaces, in the order the shell reads left to right.
 *
 * This is also the focus ring's cycle order and the order views are added to the
 * window, so there is one statement of "which surface comes first" rather than
 * three that can drift.
 */
export const PANE_SURFACE_IDS: readonly PaneSurfaceId[] = Object.freeze([
  'chrome',
  'extension',
] as const);

/**
 * The surface that holds keyboard focus when the window opens.
 *
 * **Host chrome, deliberately, and this constant is the whole of the answer to
 * the spike's worst finding.** Five identical launches of the two-view build put
 * startup focus on the last-added view four times and on the first view once —
 * so which pane the user is typing into after startup was *undefined*, from the
 * same binary and the same host code. The shell's first keystroke belongs to the
 * surface that owns navigation and the command palette, and the focus ring makes
 * that true on every launch rather than on four launches in five.
 */
export const INITIAL_FOCUS_SURFACE: PaneSurfaceId = 'chrome';

/**
 * What main knows each replica as, on the wire.
 *
 * `AuthoritativeStore.connect(port, origin)` rate-limits and severs per origin,
 * and `ReplicaStore` matches its own echo against the same string. They are
 * derived from the surface id rather than spelled independently so that a pane
 * cannot be severed under a name no replica answers to.
 *
 * The prefix is spelled the way `MAIN_ORIGIN` in `src/core/ipc/protocol.ts` is,
 * and for the same reason: `EXTENSION_ID_PATTERN` admits neither `_` nor `:`, so
 * no registry-valid extension id can collide with one of these.
 */
export function originOf(surface: PaneSurfaceId): string {
  return `__view:${surface}__`;
}
