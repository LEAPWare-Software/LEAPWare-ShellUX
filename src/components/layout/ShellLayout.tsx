import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ExtensionHostBoundary, useActivation } from '../../core/ActivationContext';
import type { ActiveExtension } from '../../core/ActivationContext';
import { useRegistry, useRegistryRevision } from '../../core/RegistryContext';
import { useBadgeCount, useNavMetric, useShellContext, useShellStore } from '../../core/ShellAPI';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { useHotkeyDispatch } from '../../core/hotkeyDispatch';
import {
  DEFAULT_SHELL_STATE,
  HYDRATION_LIMITS,
  getDefaultHydrationEngine,
  selectActiveExtensionId,
} from '../../core/services/HydrationEngine';
import type { HydrationEngine, PaneSizes } from '../../core/services/HydrationEngine';
import type { NavigationMetric, NavigationNode, PaneId, RibbonContext } from '../../core/types';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useHostUpdates } from '../../hooks/useHostUpdates';
import { hostUpdateCommands } from '../../core/updates/hostUpdates';
import { MetricGlyph } from '../ui/MetricGlyph';
import { createCommandRegistry, withRecent } from '../../core/commands/CommandRegistry';
import type { ExtensionCommands, HostCommand } from '../../core/commands/CommandRegistry';
import { CommandPalette } from '../command/CommandPalette';
import { ContextBar } from '../command/ContextBar';
import { FloatingToolbar } from '../command/FloatingToolbar';
import { OmniboxComposer } from '../command/OmniboxComposer';
import type { OmniboxSubmission } from '../command/OmniboxComposer';
import { echartsRenderer } from '../../core/chart/echartsRenderer';
import { BlockLedger } from '../ledger/BlockLedger';
import { FaultBoundary } from '../error/FaultBoundary';
import { FALLBACK_ICON, SHELL_ICONS } from '../ui/shellIcons';
import { PaneWrapper } from './PaneWrapper';

/**
 * ============================================================================
 * THE THREE-PANE SHELL. SEVEN DECISIONS WORTH ARGUING WITH BEFORE CHANGING.
 * ============================================================================
 *
 * 1. SIZES ARE PERCENTAGES, MEASURED ONCE INTO PIXELS.
 *    `react-resizable-panels` v2 sizes panels in percent of the group and has no
 *    pixel unit, but "240px default" is a pixel statement. So the group element
 *    is measured once, on mount, through a callback ref, and the pixel constants
 *    in `PANE_PX` are converted against that width. Nothing is rendered until the
 *    measurement exists, because `defaultSize` is read only when a panel mounts;
 *    the ref runs during commit, so the second render lands before paint and
 *    there is no flash.
 *
 *    **WHY THE NARROW VIEWPORT CANNOT OVERFLOW, AND WHY IT IS NOT "THE SIZES SUM
 *    TO 100".** This paragraph used to read: percentages are the right primitive
 *    because "a layout that always sums to 100 cannot overflow the document and
 *    cannot produce a horizontal page scrollbar however narrow the window gets".
 *    The conclusion is true. The premise is false below roughly 700 CSS px, and
 *    the test that appeared to prove it ran at jsdom's unmeasurable 0 width,
 *    where `PANE_FALLBACK_PERCENT` sums to 100 by construction. Measured through
 *    a stubbed group width: 1000px gives 24/36/40 = 100, 800px gives
 *    25.6/41.9/32.5 = 100, and then 700px gives 99.9, 600px gives 112.6, 480px
 *    gives 140.9 and 360px gives 187.8 — because below about 700px the pixel
 *    minimums in `PANE_PX` cannot all be satisfied at once, and the library says
 *    so on every render with `WARNING: Invalid layout total size`.
 *
 *    There is still no document overflow at any of those widths, and the reason
 *    is the library's own panel style rather than the arithmetic: every panel is
 *    laid out `flex-basis: 0; flex-grow: <size>; flex-shrink: 1` inside a group
 *    that is `width: 100%; overflow: hidden`. With a zero basis the sizes are
 *    RATIOS of the group's width, not widths — 48.9 : 66.7 : 72.2 divides 360px
 *    exactly as 24 : 36 : 40 divides 1000px — so a sum of 187.8 has no pixels in
 *    it to spill. What the sizes summing to 100 buys, where it holds, is that the
 *    numbers reported to assistive technology on the separators are percentages
 *    of the whole; it was never what stopped the overflow. Both halves are pinned
 *    by "sizes every pane as a flex ratio of the measured group, so the group's
 *    width is divided and never exceeded" and "keeps the sizes summing to 100
 *    only while the pixel minimums fit, which is 800px and wider" in
 *    `src/components/__tests__/ShellLayout.test.tsx`.
 *
 *    **THE MEASUREMENT IS NOT REPEATED FOR `defaultSize`, AND IT IS REPEATED
 *    FOR THE BANDS. THIS PARAGRAPH USED TO SAY "THERE IS NO OBSERVER HERE" AND
 *    THAT IS NO LONGER TRUE.** `measureGroup` is unchanged and is still the only
 *    thing `defaultSize` is derived from, for the timing reason above: it runs
 *    during commit, so the first layout is the right one. What is added beside it
 *    is `useElementWidth` (`src/hooks/useElementWidth.ts`), which observes the
 *    same element and reports its live width.
 *
 *    The split is what makes both halves correct. `defaultSize` means "where this
 *    panel STARTS", so re-deriving it from a live width would feed the number
 *    being dragged back in as the starting point — the defect decision 6
 *    describes for the restored layout. `minSize` and `maxSize` mean "what
 *    `PANE_PX` is worth as a share of the group", which is a different number at
 *    every window width and was previously frozen at the width the shell happened
 *    to open on: a window dragged from 1400px to 700px kept a 176px minimum
 *    expressed as 12.6%, which is 88px. Only the BANDS move.
 *
 *    A runtime with no `ResizeObserver` — jsdom, and some older embedded
 *    WebViews — reports `null` and every band falls back to the mount-time
 *    measurement, which is exactly what this shell did before. That branch is not
 *    stubbed away in `src/test/setup.ts`; see the hook's banner. When the width is
 *    unmeasurable — 0, as it is in jsdom — `percentOf` falls back to
 *    `PANE_FALLBACK_PERCENT` rather than dividing by zero. *Tests:*
 *    `src/hooks/__tests__/useElementWidth.test.tsx` — "reports null and observes
 *    nothing when ResizeObserver is absent", "reports the observed width when
 *    ResizeObserver is present", "disconnects the observer when the element
 *    detaches" and "floors a sub-pixel width at one whole pixel";
 *    `src/components/__tests__/ShellLayout.test.tsx` — "recomputes the percentage
 *    bands from an observed width, and leaves defaultSize on the mount-time
 *    measurement".
 *
 *    A restored size is held to the SAME minimums, at the width measured on this
 *    load — see decision 6. That is the question this paragraph used to defer to
 *    ISSUE-003, and the answer is a clamp rather than a live re-derivation.
 *
 * 2. COLLAPSE IS A DIFFERENT COMPONENT TREE, NOT A SMALL WIDTH.
 *    ISSUE-002 requires pane 1 to collapse to a 48px icon track and says
 *    explicitly that this is "a distinct state, not merely a small width". A
 *    collapsed pane 1 is therefore rendered OUTSIDE the panel group as a fixed
 *    `w-12` track — 48px exactly, in CSS, on every viewport — and its `Panel`
 *    and the divider beside it leave the group. Panels carry `order`, which is
 *    what makes a conditionally rendered panel legal in this library.
 *
 *    This is also the answer to "collapse toggled while a drag is in flight":
 *    the drag is owned by the library's own handle, and collapsing unmounts that
 *    handle, which ends the drag. No half-applied layout survives, because the
 *    remaining panels are re-normalised to 100% by the library.
 *
 * 3. DIVIDER KEYBOARD OPERATION IS THE LIBRARY'S, NOT OURS — AND THE SHELL'S ONE
 *    KEYBOARD LISTENER IS CALLED FROM HERE.
 *    `PanelResizeHandle` renders `role="separator"` with `tabIndex={0}` and
 *    implements the window-splitter keyboard pattern itself. This file attaches
 *    no listener and handles no key event of its own; the two modules under
 *    `src/` that touch a key event at all are
 *    `src/components/shared/VirtualizedList.tsx`, whose `onKeyDown` drives list
 *    navigation and nothing else, and `src/core/hotkeyDispatch.ts`, which owns the
 *    only `addEventListener` in the repository. Both are named in allowlists that
 *    are checked in both directions, so a third module cannot join them quietly:
 *    pinned by "finds no listener registration in any module outside the
 *    hotkey-dispatch allowlist", "finds no key-event name in any module outside
 *    the key-event allowlist", "holds the key-event allowlist to the exact
 *    spellings each listed module contains" and "holds the hotkey-dispatch
 *    allowlist to the exact spellings the dispatcher contains" in
 *    `src/__tests__/noEventListener.test.ts`.
 *
 *    Hotkey DISPATCH is no longer Phase 2, and this file is where it is switched
 *    on: `useHotkeyDispatch()` below. It is called from `ShellLayout` rather than
 *    from `ShellHostProvider` because this component is host territory above every
 *    `ExtensionHostBoundary` and renders the ribbon, so the chord path and the
 *    button path resolve the same foreground extension and the same actions. The
 *    listener itself, its bubble-phase trade and its suppression rules are all in
 *    `hotkeyDispatch.ts`; nothing here routes a chord.
 *
 * 4. A PLUG-IN SUBTREE IS ALWAYS WRAPPED.
 *    `views.pane2` and `views.pane3` render inside `ExtensionHostBoundary`, which
 *    is what takes the host `ActivationController` out of context for plug-in
 *    code. The banner in `ActivationContext.tsx` names the limit of that in
 *    detail and it is not restated here: it is a guardrail, it closes the
 *    documented route, and it is not isolation. What this file adds is that the
 *    host no longer renders a plug-in component as its own sibling — the case
 *    that banner flagged as outstanding while pane rendering did not exist.
 *
 * 5. FAULT BOUNDARIES ARE COMPOSED HERE, AND THERE ARE TWO LAYERS OF THEM.
 *    Every set of children this file hands a `PaneWrapper` — pane 1's navigation
 *    included, because it renders plug-in labels and badge counts — goes inside a
 *    `FaultBoundary`, and so does the ribbon. The composition is in THIS file
 *    rather than inside `PaneWrapper` so that `PaneWrapper` stays presentational
 *    and its banner's "it is not a fault boundary" stays literally true.
 *
 *    **The pane boundary sits OUTSIDE `ExtensionHostBoundary`, and that order is
 *    load-bearing.** `ExtensionHostBoundary` itself throws a plain `Error` when
 *    `extensionId` is not a string — the guardrail it exists to be would
 *    otherwise be silently switchable off by a typo — and a boundary nested
 *    inside it could not catch a throw from its own parent. Beyond that, a host
 *    Retry button rendered inside the extension scope would sit under a context
 *    that declares "plug-in code lives below here", which is exactly backwards
 *    for a host control.
 *
 *    The ribbon has its own boundary for the same reason the panes do: "the
 *    ribbon and other panes stay interactive" is only guaranteed if the ribbon's
 *    own failure is contained too. Nothing an extension can register makes the
 *    context bar or pane 1 throw during render — both render validated primitive
 *    strings — so those two boundaries are defence-in-depth, and the context
 *    bar's is tested by substituting a throwing context bar rather than by
 *    pretending a plug-in could cause it. *Tests:*
 *    `src/components/__tests__/ShellLayout.test.tsx` — "contains a throwing
 *    pane-2 view to pane 2, leaving the context bar and pane 3 interactive",
 *    "contains a throwing context bar without taking the panes down" and "clears
 *    a pane error surface when the active extension changes".
 *
 * 6. PERSISTENCE IS READ ONCE PER MOUNT AND WRITTEN THROUGH THE ENGINE.
 *    ISSUE-003's `HydrationEngine` is consumed here, and this is the file that
 *    used to say it was not. THREE slots are persisted and no more: the pane
 *    sizes, the pane-1 collapsed flag, and the id of the foreground extension.
 *
 *    **What is deliberately NOT persisted, so the list above is not read as
 *    "the shell remembers everything":** the utility drawer flag, which is a
 *    transient inspection of pane 3 rather than a layout the user arranged; the
 *    selected navigation node and the selected item, which belong to the shell
 *    store and are cleared on every foreground handover by design (see
 *    `publishForeground` in `ActivationContext.tsx`); the measured group width,
 *    which is re-measured on every mount because it is a fact about this window
 *    and not about this user; and pane sizes changed *while pane 1 is
 *    collapsed*, because the two panes then in the group divide a width that
 *    excludes the 48px track, so their percentages are a ratio against a
 *    different denominator and writing them into a three-pane record would
 *    record a number that means something else. *Tests:*
 *    `src/components/__tests__/ShellLayoutPersistence.test.tsx` — "does not
 *    persist a pane size while pane 1 is collapsed, because the two panes divide
 *    a different width" and "persists no drawer state, so a reload opens with the
 *    drawer shut".
 *
 *    **NOR THE SIZES PANE 1 COMING BACK PRODUCES, AND THAT OMISSION USED TO BE
 *    MISSING.** Re-adding pane 1's `Panel` makes the library renormalise a
 *    two-panel group into a three-panel one and report the result on every
 *    panel. Panes 2 and 3 report a real previous size, so the collapsed refusal
 *    above did not cover them — and what they reported was their share of the
 *    width that excluded the 48px track, written into a three-pane record. The
 *    layout the user had chosen was discarded by a collapse and a re-expansion
 *    that changed nothing, and what replaced it did not divide the whole.
 *    `persistPaneSize` refuses it now, by the one rule stated on that function.
 *
 *    **A WRITE IS THE WHOLE LAYOUT, NOT ONE SLOT.** One divider moves exactly
 *    two panes, so patching only the panes that reported left the third holding
 *    whatever it held last — for a shell nobody had resized, the engine's
 *    1360px-reference default beside two percentages measured at this width, and
 *    three numbers that did not add up. *Tests:* same file — "records one
 *    three-pane layout, so the persisted percentages divide the whole", "leaves
 *    the persisted layout exactly as it was across a collapse and a
 *    re-expansion", "leaves it alone even when the collapsed group was resized
 *    before pane 1 came back" and "records a whole layout for the first resize
 *    after a shell that opened collapsed"; `e2e/shell-layout.spec.ts` — "leaves
 *    the stored layout alone, so a reload still opens on the dragged widths".
 *
 *    **"A RECORD EXISTS" IS NOT "THE USER CHOSE A LAYOUT", AND CONFUSING THE TWO
 *    THREW `PANE_PX` AWAY.** Any slot write produces a record, and a record that
 *    is read back is a parsed object whatever it holds. See
 *    `isEngineDefaultLayout` for the sentinel that used to infer the answer from
 *    that object's identity, what it cost at a 1920px viewport, and what
 *    comparing the three numbers instead trades away. *Tests:* same file —
 *    "keeps the pixel intent after a write nobody made about the panes, at a
 *    width where the two differ"; `e2e/shell-layout.spec.ts` — "survives a reload
 *    whose stored record was written for another slot entirely".
 *
 *    **THE READ IS A MOUNT-TIME SNAPSHOT, AND THAT IS WHAT MAKES `defaultSize`
 *    HONEST.** `restoredSizes` comes from a lazy `useState` initializer, so it is
 *    the engine's state as of this mount and never moves again. `defaultSize` is
 *    read by the library only when a panel mounts and MEANS "where this panel
 *    starts"; feeding it a live subscription would make the value the user is
 *    dragging also the value being fed back as the starting point. The collapsed
 *    flag is the opposite case and is bound live through
 *    `useLocalStorageState`, because it drives which component tree renders.
 *
 *    **There is no flash of the default layout, and the mechanism is the whole
 *    point.** The engine hydrates synchronously in its constructor and the hook
 *    reads through `useSyncExternalStore` during render, so the restored value is
 *    in the very first render this component performs — not applied by an effect
 *    one commit later. Pinned on the RENDER LOG rather than on the final DOM, in
 *    `src/components/__tests__/ShellLayoutPersistence.test.tsx`: "renders the
 *    restored pane sizes on the panel group first render, and the measured
 *    default never" and "renders the collapsed icon track on the first render,
 *    and the expanded navigation panel never".
 *
 *    **A restored size cannot be illegal by the time it reaches a `Panel`, and
 *    there are two independent gates.** The engine refuses a whole record holding
 *    a pane size outside `[MIN_PANE_PERCENT, MAX_PANE_PERCENT]` — nothing is
 *    half-applied, the defaults are served instead — and then this file clamps
 *    whatever survives into the pane's OWN minimum and maximum at the width
 *    measured on THIS load, which is where a layout saved on a wide monitor and
 *    reopened on a narrow one is corrected. *Tests:* same file — "discards a
 *    hand-edited record whose pane size is outside the engine band, and renders
 *    the measured defaults" and "clamps a restored pane size that no longer fits
 *    the pane minimums at this width".
 *
 *    **Writes are coalesced by the engine, not by this file.** Every layout
 *    change the library commits calls `onResize` on each panel — once per frame
 *    of a drag — and each of those is a `setSlot`; the engine holds them in one
 *    debounce window and performs a single `setItem`. The mount notification is
 *    skipped, because `onResize` reports `undefined` for the previous size when
 *    the group is announcing its own initial layout, and `undefined` is not a
 *    size this shell ever saw — the same one rule that refuses the re-expansion
 *    pass: a shell nobody has resized therefore writes nothing.
 *    *Tests:* same file — "coalesces a keyboard-driven resize into one storage
 *    write rather than one per frame" and "writes nothing at all for a mount
 *    nobody resized".
 *
 *    **Storage being unavailable is not an error condition here.** The engine
 *    degrades to memory and no member of it throws for it, so this file has no
 *    branch for it and needs none. *Test:* same file — "renders, resizes and
 *    collapses with a storage that throws on every access".
 *
 *    **The restore of the foreground extension is a ONE-SHOT that can wait.** A
 *    persisted id names an extension that may not have registered yet — a lazily
 *    loaded one is indistinguishable from an uninstalled one — so the restore is
 *    retried on every registry revision and consumed the moment it lands OR the
 *    moment the user activates anything at all. Until it is consumed, the
 *    foreground is NOT written back: an unconsumed restore that persisted the
 *    empty foreground of a shell whose extensions had not registered yet would
 *    erase the very id it was waiting for. `selectActiveExtensionId` is the
 *    engine's own door for "is this id still real?", and an id the registry does
 *    not know activates nothing. *Tests:* same file — "brings the persisted
 *    extension back to the foreground once it registers", "activates nothing and
 *    throws nothing for a persisted extension id the registry does not know" and
 *    "stops waiting for the persisted extension once the user activates a
 *    different one".
 *
 * 7. A NAVIGATION BADGE IS THE STORE'S FIRST, THE BLUEPRINT'S SECOND.
 *    `NavigationNode.badgeCount` is a value frozen into the registry's
 *    host-owned record at registration and it can never change again;
 *    `IShellAPI.setBadgeCount` writes into the shell store. Rendering the
 *    blueprint field alone — which this file used to do — made every runtime
 *    badge write invisible, which is the whole of the render half of issue #12.
 *
 *    So `NavNodeButton` subscribes through `useBadgeCount(extensionId, node.id)`
 *    and a store value OVERRIDES the blueprint's, with the blueprint as the
 *    fallback when the store holds nothing for that node. `??` rather than a
 *    truthiness test, deliberately: a badge deliberately written down to `0` is a
 *    value and must win over a blueprint's `3`. It works identically in the
 *    collapsed 48px icon track, where `ShellNavButton` positions the same badge
 *    absolutely instead of at the end of the row. *Tests:*
 *    `src/components/__tests__/ShellLayoutBadges.test.tsx` — "lets a
 *    setBadgeCount write through a live IShellAPI change what the sidebar
 *    renders", "overrides a blueprint badge with the
 *    store value, including down to zero" and "shows a runtime badge in the collapsed 48px
 *    icon track too".
 *
 *    **The hook's validation posture is not defeated here, and must not be.**
 *    `useBadgeCount` raises `INVALID_ID` DURING RENDER for a malformed scope or
 *    node id rather than reading `undefined`, and nothing in this file catches
 *    that. It is unreachable through the registry — a stored blueprint's node ids
 *    passed `EXTENSION_ID_PATTERN` at registration, which is the same rule the
 *    store's badge doors apply — so the posture costs the shell nothing and stays
 *    a loud failure for a caller who reaches it another way. Pinned by "raises
 *    INVALID_ID during render for a malformed scope, rather than reading
 *    undefined" and "raises INVALID_ID during render for a malformed node id" in
 *    `src/core/__tests__/badgeSelector.test.tsx`.
 *
 *    The extension rows above the tree take `badgeCount={undefined}` and are
 *    deliberately unsubscribed: an extension is not a navigation node, it has no
 *    node id, and there is no scope under which the store could hold a badge for
 *    one.
 *
 * 8. A NAVIGATION METRIC IS A DECLARATIVE FIELD, NOT A `views.pane1`.
 *    Decision 5 above says nothing an extension can register makes pane 1 throw
 *    during render. A `views.pane1` would make that FALSE — pane 1 renders every
 *    registered extension's rows in one tree, so one vendor's renderer throwing
 *    would take the whole navigation surface, and every route back to the other
 *    vendors, down to a fault surface. So a metric arrives as
 *    `NavigationNode.metric`: four registry-validated primitives and a bounded
 *    array of numbers, drawn by `src/components/ui/MetricGlyph.tsx`, which is
 *    host-authored geometry and no library. Nothing a plug-in supplies reaches an
 *    attribute; `description` is a text node in an `sr-only` span.
 *
 *    **The liveness rule is decision 7's, applied again rather than reinvented.**
 *    `NavNodeButton` subscribes through `useNavMetric(extensionId, node.id)` and
 *    a store value overrides the blueprint's `value` with `??` — never a
 *    truthiness test, because a metric written down to `0` is a value. The
 *    override is a FRESH frozen object over the registry's record, so the
 *    registry's own copy is never mutated and `MetricGlyph` may memoise on the
 *    metric's identity.
 *
 *    **It overrides `value` and NOTHING ELSE, and a runtime write to a node that
 *    declared no metric draws nothing.** That is deliberately not what a badge
 *    does, and the asymmetry follows from the shapes: a badge is one number and
 *    the store can supply the whole of it, while a metric also needs a `kind` and
 *    a `description`, and the host will not invent either. *Tests:*
 *    `src/components/__tests__/ShellLayoutMetrics.test.tsx` — "renders a declared
 *    navigation metric as a host-drawn glyph with its description", "lets a
 *    setNavMetric write through a live IShellAPI change the glyph the sidebar
 *    draws", "overrides a blueprint metric value with the store value, including
 *    down to zero", "draws nothing for a runtime metric on a node that declared
 *    none" and "keeps the metric description in the collapsed track and drops the
 *    glyph".
 *
 * NOT HERE, DELIBERATELY: `ShellLayout` does not itself window pane 2 —
 * `VirtualizedList` is a component an extension's own `views.pane2` renders, not
 * something the host wraps around it, because the host does not know what a row
 * is.
 * ============================================================================
 */

/**
 * The pixel intent behind every pane constraint, in one table.
 *
 * `navCollapsed` is the only one of these that is applied as pixels directly —
 * it is a CSS width on a track outside the panel group — and it is listed here
 * so that the 48px in the specification has exactly one home in the code.
 */
const PANE_PX = Object.freeze({
  navCollapsed: 48,
  navDefault: 240,
  navMin: 176,
  navMax: 400,
  listDefault: 360,
  listMin: 240,
  listMax: 640,
  detailMin: 260,
});

/**
 * Percentages used when the group width cannot be measured.
 *
 * These are the same constraints expressed against a 1360px content area, which
 * is the width `PANE_PX` was chosen for. They keep the layout legal and
 * proportionate rather than pretending to be the pixel values.
 */
const PANE_FALLBACK_PERCENT = Object.freeze({
  navDefault: 18,
  navMin: 13,
  navMax: 29,
  listDefault: 26,
  listMin: 18,
  listMax: 47,
  detailMin: 19,
});

/**
 * A pixel width as a percentage of `groupWidth`, clamped to a legal band.
 *
 * The lower clamp is what stops a divider dragged fully to one edge from leaving
 * a 0px pane behind: every panel's `minSize` comes through here, so the smallest
 * value any panel can be given is 2% of the group rather than nothing. The
 * library reports the same floor to assistive technology as `aria-valuemin` on
 * the separator, which is what the zero-width test asserts.
 */
function percentOf(px: number, groupWidth: number, fallbackPercent: number): number {
  if (groupWidth <= 0) {
    return fallbackPercent;
  }
  return Math.min(90, Math.max(2, (px / groupWidth) * 100));
}

/**
 * A restored percentage held to one pane's own live band.
 *
 * `low` and `high` are this pane's `minSize` and `maxSize` at the width measured
 * on THIS load, so a layout saved on a wide monitor and reopened on a narrow one
 * is corrected here rather than being handed to the library and re-clamped by it
 * with a console warning. `Math.min`/`Math.max` rather than an `if`, so the
 * function has one exit and no branch to leave untested.
 */
function clampToBand(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * A percentage held to the band the ENGINE will store, before it is written.
 *
 * This is not belt and braces. Pane 3 declares a `minSize` and deliberately no
 * `maxSize` — it is the remainder pane — so a layout with both dividers driven
 * fully leading gives it whatever is left, and the engine refuses a slot value
 * outside `[MIN_PANE_PERCENT, MAX_PANE_PERCENT]` by throwing. A throw from a
 * panel resize callback is a throw out of the library's own layout effect, so
 * the value is clamped to what is storable instead. The bounds are the engine's
 * own constants, imported rather than restated, for the reason
 * `HYDRATION_LIMITS` gives about the two ends of this band agreeing.
 */
function clampPanePercent(value: number): number {
  return clampToBand(
    value,
    HYDRATION_LIMITS.MIN_PANE_PERCENT,
    HYDRATION_LIMITS.MAX_PANE_PERCENT,
  );
}

/**
 * Whether a restored record's pane sizes are the engine's own untouched
 * defaults.
 *
 * BY VALUE, AND THE IDENTITY TEST THIS REPLACES WAS A FALSE SENTINEL. It read
 * `restoredSizes !== DEFAULT_SHELL_STATE.paneSizes` and called the answer
 * "somebody chose a layout". Identity only survives the paths that hand the one
 * shared frozen default straight back — an absent or discarded record. A record
 * that was PARSED gets a fresh `paneSizes` object whatever it holds, so a shell
 * whose record exists only because the user collapsed pane 1, or opened an
 * extension, answered "somebody chose a layout" for a record holding nothing but
 * defaults, and `PANE_PX` was never consulted again on that machine. Comparing
 * the three numbers is the fact the sentinel was reaching for.
 *
 * What that trades away, stated rather than glossed: a user who drags the panes
 * to exactly the engine's default percentages and reloads gets the pixel intent
 * for this width instead of those percentages back. The two are the same layout
 * at the 1360px reference width `PANE_FALLBACK_PERCENT` was written for and
 * differ elsewhere, so that user's reload can move the dividers. It is the
 * narrower error of the two, and it needs a coincidence to reach.
 *
 * The keys come from the defaults themselves rather than from a list written
 * here, so a fourth pane cannot be added to the record and quietly skipped, and
 * `every` rather than a chain of `||` so there is one exit.
 */
function isEngineDefaultLayout(sizes: PaneSizes): boolean {
  const defaults = DEFAULT_SHELL_STATE.paneSizes;
  return (Object.keys(defaults) as PaneId[]).every((pane) => sizes[pane] === defaults[pane]);
}

interface ShellNavButtonProps {
  /** UNTRUSTED plug-in text. Rendered as a text node in both pane-1 states. */
  readonly label: string;
  /**
   * UNTRUSTED icon key, or `undefined` for none. Resolved through the host's own
   * `SHELL_ICONS` table and never interpolated anywhere. See the collapsed-track
   * paragraph below.
   */
  readonly icon: string | undefined;
  /** Registry-validated non-negative integer, or `undefined` for no badge. */
  readonly badgeCount: number | undefined;
  /**
   * The host-owned metric to draw beside the row, or `undefined` for none.
   *
   * Already resolved against the store by `NavNodeButton` — see decision 8 in
   * the banner. Every field on it is registry-validated, and the only one this
   * component's caller can have moved is `value`.
   */
  readonly metric: NavigationMetric | undefined;
  readonly isCollapsed: boolean;
  readonly isCurrent: boolean;
  readonly onSelect: () => void;
}

/**
 * One selectable row in pane 1, in whichever of the two states pane 1 is in.
 *
 * Collapsed, the row becomes a 32px square — and the label itself stays in the
 * accessible tree as an `sr-only` text node rather than being dropped. That is
 * the "accessible names preserved" half of the 48px icon track: the same
 * `getByRole('button', { name })` query finds the same button in both states.
 *
 * WHAT THE SQUARE SHOWS, SINCE GITHUB ISSUE #19. A declared `NavigationNode.icon`
 * is resolved through `SHELL_ICONS` and drawn; a node that declares none keeps
 * the monogram — the first letter of its label — which is what every row used to
 * get. The monogram is not a fallback for a BAD key: an icon key the host does
 * not publish resolves to `FALLBACK_ICON`, the same host glyph the ribbon shows,
 * because a vendor who mistyped a key and a vendor who declared none are two
 * different situations and should not look identical. The monogram was the whole
 * of the problem this fixes: `DatabasePlugin`'s roots are Components,
 * Assemblies and Consumables, so the collapsed rail read "C A C" and two of the
 * three rows were indistinguishable.
 *
 * The extension rows above the tree take `icon={undefined}` and keep their
 * monograms deliberately — `LEAPExtensionBlueprint` has no `icon` field, an
 * extension is not a navigation node, and inventing one from the first nav node
 * would be the host guessing.
 *
 * *Tests:* `src/components/__tests__/ShellLayoutIcons.test.tsx` — "renders a
 * declared node icon in the collapsed track instead of the monogram", "falls back
 * to the host glyph for an icon key the host does not publish", "keeps the
 * monogram for a node that declares no icon" and "keeps the monogram on the
 * extension rows, which declare no icon at all".
 *
 * THE SELECTED STATE IS A RULE AND A WEIGHT, NOT ONLY A FILL. `aria-current` was
 * always set, so a screen-reader user was always told which extension was
 * active. A sighted user was not: the fill measured 1.09:1 against white and the
 * outline beside it 1.26:1, against the 3:1 that WCAG 1.4.11 asks of a non-text
 * state indicator. Both were far below it, and no fill reaches 3:1 against white
 * without going dark enough to read as a different control entirely. So the fill
 * stays — it is a pleasant hint for anyone who can see it — and the state is
 * actually CARRIED by two things that clear the bar on their own: a 2px leading
 * rule at `--border-selected`, and a semibold label.
 *
 * The rule and the fill are now `TOKEN_CLASS.navSelectedRule` and
 * `navSelectedSurface`, so there is one declaration per affordance instead of a
 * light one and a `dark:` twin. The ratios above are no longer restated per
 * theme here on purpose: they are measured for all three themes, against every
 * surface each token is drawn on, by `design/check-contrast.mjs` and by
 * `npm run check:tokens`. A number copied into a comment is a number that goes
 * stale silently, and this file had three such paragraphs before this change.
 *
 * The 1px outline is the decorative tier, `--border-subtle`, and that is a
 * decision `design/README.md` explicitly declined to make for us — see its "For
 * whoever wires this" section. `--border-default` would make a selected row's
 * edge as heavy as a pane's; the outline is not what carries the state, so it
 * gets the tier that keeps weight off decoration.
 *
 * The rule is an inset `box-shadow` rather than a left border. A border would
 * have to grow from 1px to 2px on selection and shift the label sideways by a
 * pixel each time the user moved between rows; an inset shadow paints inside the
 * padding box and moves nothing.
 *
 * `min-h-6` is the 24px WCAG 2.5.8 target-size floor. Measured before it was
 * added, these rows were 163.9 × 22 with 0px and 1px gaps between them, so the
 * spacing exception did not apply and they simply failed.
 */
function ShellNavButton({
  label,
  icon,
  badgeCount,
  metric,
  isCollapsed,
  isCurrent,
  onSelect,
}: ShellNavButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-current={isCurrent ? 'true' : undefined}
      title={label}
      onClick={onSelect}
      className={
        'flex min-h-6 items-center gap-1 rounded-sm border p-1 text-[12px] leading-none ' +
        'aria-[current]:font-semibold ' +
        `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.navSelectedBorder} ` +
        `${TOKEN_CLASS.navSelectedSurface} ${TOKEN_CLASS.navSelectedRule} ` +
        `${TOKEN_CLASS.controlHoverBorder} ` +
        (isCollapsed ? 'relative h-8 w-8 justify-center' : 'w-full min-w-0 justify-start')
      }
    >
      {isCollapsed ? (
        <span aria-hidden="true" className="flex font-semibold">
          {/*
            A lookup, never an interpolation. `icon` is untrusted and reaches
            nothing but `Map.prototype.get`; the element that comes back is
            host-authored SVG. An unpublished key gets the host fallback, and no
            icon at all gets the monogram.
          */}
          {icon === undefined ? (
            label.trim().slice(0, 1).toUpperCase()
          ) : (
            <>{SHELL_ICONS.get(icon) ?? FALLBACK_ICON}</>
          )}
        </span>
      ) : null}
      <span className={isCollapsed ? 'sr-only' : 'truncate'}>{label}</span>
      {/*
        Host-drawn geometry and an `sr-only` description; nothing a plug-in
        supplied reaches an attribute. `MetricGlyph` decides what a collapsed
        row keeps, which is the text channel — see its `isGlyphHidden`
        docblock — so there is no second copy of that rule here.
      */}
      {metric === undefined ? null : (
        <MetricGlyph metric={metric} isGlyphHidden={isCollapsed} />
      )}
      {badgeCount === undefined ? null : (
        <span
          className={
            `flex-none rounded-sm ${TOKEN_CLASS.badgeSurface} px-1 text-[11px] leading-4 ` +
            (isCollapsed ? 'absolute -right-1 -top-1' : 'ml-auto')
          }
        >
          {/*
            The digit alone folds into the button's accessible name as a bare
            number — "Root A 3" — which names no unit and reads as part of the
            label. `badgeCount` is documented in `core/types.ts` as a "badge" and
            nothing narrower, so the qualifier says "badge" and not "unread" or
            "items": inventing the unit would be a different lie from omitting
            it. The name becomes "Root A badge 3".
          */}
          <span className="sr-only">badge </span>
          {badgeCount}
        </span>
      )}
    </button>
  );
}

interface NavNodeButtonProps {
  /** The scope the store keys this node's badge under. Registry-validated. */
  readonly extensionId: string;
  readonly node: NavigationNode;
  readonly isCollapsed: boolean;
  readonly isCurrent: boolean;
  readonly onSelect: (nodeId: string) => void;
}

/**
 * One navigation node, with its badge read from the store and not only from the
 * blueprint.
 *
 * A component of its own because `useBadgeCount` is a hook and there is one
 * subscription per node — which is also what makes a badge write re-render one
 * row rather than the whole tree, since the hook's snapshot is a primitive and
 * `useSyncExternalStore` bails out for every subscriber whose own number did not
 * move. See decision 7 in the banner for the override rule and for why the
 * hook's render-phase `INVALID_ID` is not caught here.
 */
function NavNodeButton({
  extensionId,
  node,
  isCollapsed,
  isCurrent,
  onSelect,
}: NavNodeButtonProps): ReactElement {
  const liveBadge = useBadgeCount(extensionId, node.id);
  const liveMetric = useNavMetric(extensionId, node.id);
  // The override reaches `value` and nothing else, and it produces a FRESH
  // frozen object rather than mutating the registry's record — which is what
  // makes `MetricGlyph`'s `useMemo` on the metric identity correct. When the
  // node declared no metric there is nothing to draw a store value ON: a metric
  // needs a `kind` and a `description` and the host will not invent either, so
  // the write is stored, readable through `getNavMetric`, and drawn by nobody.
  // See decision 8 in the banner.
  const metric = useMemo((): NavigationMetric | undefined => {
    const declared = node.metric;
    if (declared === undefined || liveMetric === undefined) {
      return declared;
    }
    return Object.freeze({ ...declared, value: liveMetric });
  }, [node.metric, liveMetric]);
  return (
    <ShellNavButton
      label={node.label}
      icon={node.icon}
      // `??`, not `||`: a badge written down to `0` is a value, and a truthiness
      // test would silently fall back to the blueprint's stale number for it.
      badgeCount={liveBadge ?? node.badgeCount}
      metric={metric}
      isCollapsed={isCollapsed}
      isCurrent={isCurrent}
      onSelect={() => {
        onSelect(node.id);
      }}
    />
  );
}

interface NavigationTreeProps {
  /** The foreground extension, which is the badge scope for every node below. */
  readonly extensionId: string;
  readonly nodes: readonly NavigationNode[];
  readonly activeNodeId: string | null;
  readonly isCollapsed: boolean;
  readonly onSelect: (nodeId: string) => void;
}

/**
 * The active extension's navigation tree.
 *
 * Collapsed, only the top level is shown: an icon track has no room for
 * indentation, and hiding depth is better than rendering it unreadably. Every
 * label still reaches the DOM as a text node either way.
 */
function NavigationTree({
  extensionId,
  nodes,
  activeNodeId,
  isCollapsed,
  onSelect,
}: NavigationTreeProps): ReactElement {
  return (
    <ul className={isCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-px'}>
      {nodes.map((node) => (
        <li key={node.id} className="min-w-0">
          <NavNodeButton
            extensionId={extensionId}
            node={node}
            isCollapsed={isCollapsed}
            isCurrent={activeNodeId === node.id}
            onSelect={onSelect}
          />
          {isCollapsed || node.children === undefined ? null : (
            <div className="pl-2">
              <NavigationTree
                extensionId={extensionId}
                nodes={node.children}
                activeNodeId={activeNodeId}
                isCollapsed={isCollapsed}
                onSelect={onSelect}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

interface ExtensionPaneProps {
  readonly active: ActiveExtension;
  readonly pane: 'pane2' | 'pane3';
  /** Host text naming the surface, for the fault surface. Never plug-in text. */
  readonly label: string;
  readonly context: Readonly<RibbonContext>;
}

/**
 * A plug-in view, inside both boundaries the host is required to wrap it in.
 *
 * ORDER: `FaultBoundary` OUTSIDE `ExtensionHostBoundary`. See decision 5 in the
 * banner — the inner one throws for a non-string `extensionId`, and a boundary
 * beneath it could not catch its own parent.
 */
function ExtensionPane({ active, pane, label, context }: ExtensionPaneProps): ReactElement {
  const View = active.blueprint.views[pane];
  return (
    <FaultBoundary boundaryLabel={label} extensionId={active.id} resetKey={active.id}>
      <ExtensionHostBoundary extensionId={active.id}>
        <View shell={active.shell} context={context} />
      </ExtensionHostBoundary>
    </FaultBoundary>
  );
}

/**
 * Body text for a pane with nothing to show.
 *
 * This used to be `text-neutral-500` with a `dark:text-neutral-400` beside it,
 * and that pair is the clearest single illustration of what the token set
 * replaces. `#737373` measured 4.18:1 on the dark pane — under the 4.5:1 WCAG
 * 1.4.3 requires of 12px body text — while measuring fine in light, so the fix
 * had to be a per-theme override written by hand at every muted string in the
 * shell. `--text-muted` is resolved per theme by the generator and validated
 * against all eight surfaces in all three themes, so the override has nothing
 * left to correct and one declaration replaces two.
 */
function EmptyPane({ children }: { readonly children: string }): ReactElement {
  return <p className={`p-1 text-[12px] leading-5 ${TOKEN_CLASS.mutedText}`}>{children}</p>;
}

interface ShellResizeHandleProps {
  readonly label: string;
}

/**
 * A divider. Mouse dragging and the window-splitter keyboard pattern both come
 * from the library; see decision 3 in the banner above.
 *
 * THREE THINGS HERE ARE ACCESSIBILITY FIXES, AND ALL THREE ARE EASY TO UNDO BY
 * ACCIDENT.
 *
 * COLOUR. The divider once used the SAME value as the 1px border on the panes
 * either side of it, so it did not read as a control at all — it read as one
 * more pane border, at 1.26:1 against the panes it separates. WCAG 1.4.11 wants
 * 3:1 for a control's visual boundary.
 *
 * It now uses `--control-divider` and `--control-divider-hover`, which are their
 * own token group rather than a shade of `--border-*`. `design/README.md`
 * "Honest limits" item 9 records why: this is a filled 4px bar with hover and
 * drag states, not a border, and folding it into `--border-strong` would have
 * made one token answer to two different measurements. `--control-divider`
 * measures 5.94:1 on `--surface-app` in light and 8.10:1 in dark.
 *
 * The hover and drag states still move AWAY from the page background in each
 * theme — darker in light, lighter in dark — but that direction now lives in the
 * token values rather than in a `dark:` variant here, which is why there are two
 * declarations where there were six.
 *
 * TARGET SIZE. The visual divider stays 4px, because a 24px bar between two
 * panes would look broken. `hitAreaMargins` widens the region the library's own
 * pointer tracking treats as this handle, without touching the painted width:
 * 4 + 12 + 12 = 28px of fine-pointer target, over the 24px WCAG 2.5.8 asks for.
 * The library's defaults are `coarse: 15, fine: 5`, which is 14px and not
 * enough; `coarse` is restated at its default so that the pair is read as one
 * decision rather than as a half-configured object.
 *
 * ORIENTATION. A `separator` reports `aria-orientation="horizontal"` by default,
 * and these are vertical splitters between side-by-side panes. The library
 * spreads unknown props onto the element before setting `role`, so the attribute
 * reaches the DOM and nothing of the library's own is displaced.
 */
function ShellResizeHandle({ label }: ShellResizeHandleProps): ReactElement {
  return (
    <PanelResizeHandle
      aria-label={label}
      aria-orientation="vertical"
      hitAreaMargins={{ coarse: 15, fine: 12 }}
      className={
        'w-1 flex-none cursor-col-resize outline-none ' +
        `${TOKEN_CLASS.dividerIdle} ${TOKEN_CLASS.dividerHover} ` +
        `${TOKEN_CLASS.dividerFocus} ${TOKEN_CLASS.dividerDrag}`
      }
    />
  );
}

/**
 * ============================================================================
 * ONE HOST CHORD, TWO DOCUMENTS, AND THE SURFACE THAT OWNS THE PALETTE.
 * ============================================================================
 * The command palette is host chrome's — `HOST_CHORDS` in
 * `src/core/hotkeyDispatch.ts` holds exactly one entry, and
 * `src/components/command/__tests__/hostChrome.test.tsx` pins three independent
 * spellings of "an extension cannot declare it". Phase 7 put panes 2 and 3 in a
 * different document, and that made a question out of something that had never
 * been one: **what happens when the chord is pressed in the surface that does
 * not have the palette in it?**
 *
 * Before this hook, nothing. The extension surface's dispatcher matched the
 * chord, called its handler, set a piece of state no rendered component reads,
 * and the user got silence from a keystroke they use constantly.
 *
 * ---------------------------------------------------------------------------
 * RENDERER-FIRST, AND MAIN ROUTES WHAT THE RENDERER COULD NOT ACT ON
 * ---------------------------------------------------------------------------
 * The obvious alternative is to match the chord in the main process, which
 * already watches `before-input-event` for the escape hatch. It is refused for
 * the reason `electron/main/paneKeyBridge.ts` sets out at length: that event
 * fires BEFORE the renderer's DOM handling and carries neither a target nor
 * `defaultPrevented`, so main cannot tell `Ctrl+K` aimed at the shell from
 * `Ctrl+K` aimed at the omnibox composer the user is typing in. Every
 * suppression rule that answers that question — `isEditableTarget`,
 * `isComposing`, the repeat guard — lives in the renderer and stays there.
 *
 * So the chord is recognised where it always was, and only the surviving INTENT
 * crosses. Main focuses host chrome and tells it to open; see
 * `registerPaletteRouting` in `electron/main/index.ts` for why focus moves as
 * well as the palette opening.
 *
 * ---------------------------------------------------------------------------
 * ONE HOOK FOR BOTH DIRECTIONS, AND IT LIVES HERE RATHER THAN IN `src/hooks/`
 * ---------------------------------------------------------------------------
 * A surface that can ASK is a surface that must also be able to HEAR: host
 * chrome and the extension view load the same preload and the same component,
 * and which of them is which is a prop rather than a build. Splitting this into
 * a sender hook and a receiver hook would have made "who subscribes" a second
 * decision that could disagree with the first one.
 *
 * It sits beside its one caller rather than in `src/hooks/` because it has
 * exactly one caller and no meaning away from it: `useHostUpdates` is a general
 * reading of host state that any surface could want, and this is the answer to
 * one question this component asks about itself.
 * ============================================================================
 */

/** The `panes` half of the preload bridge. Declared in `src/App.tsx`. */
type HostPanesBridge = NonNullable<NonNullable<Window['shelluxHost']>['panes']>;

/** The bridge, or `null` when this document is not running inside the host. */
function hostPanesBridge(): HostPanesBridge | null {
  return window.shelluxHost?.panes ?? null;
}

/**
 * Subscribe to the host's request to open the palette, and get the way to make
 * one.
 *
 * @param onRequested called when another surface's chord reached this one.
 *   **Its identity must be stable** — wrap it in `useCallback` — because it is
 *   the subscription's dependency, and a fresh function every render would
 *   detach and re-attach the listener on every render.
 * @returns the way to hand the chord to the host, or `null` in a browser
 *   document, where there is no other surface and the caller's own palette is
 *   the whole answer.
 */
function useHostPalette(onRequested: () => void): (() => void) | null {
  const panes = hostPanesBridge();

  useEffect(() => {
    if (panes === null) {
      return undefined;
    }
    // `onPaletteRequest` returns its own unsubscribe, so the cleanup is the
    // host's rather than a second bookkeeping scheme built on top of it — the
    // same shape `useHostUpdates` uses.
    return panes.onPaletteRequest(onRequested);
  }, [panes, onRequested]);

  return panes === null ? null : panes.requestPalette;
}

/**
 * ============================================================================
 * WHICH PART OF THE SHELL ONE DOCUMENT DRAWS.
 * ============================================================================
 * Phase 7 gave the desktop host two `WebContentsView`s and therefore two
 * documents — `electron/main/paneViews.ts`, `electron/main/surfaces.ts` — and a
 * document cannot draw a pane that lives in the other one. This union is how
 * that fact reaches the renderer, and it is a PROP rather than a fork of this
 * file, because the layout arithmetic, the persistence rule, the fault
 * boundaries and the density contract are one implementation with tests against
 * them and duplicating any of it would duplicate all of it.
 *
 *  - `'full'` — all three panes, every command surface, one document. **This is
 *    the default and it is byte-identical to what this file has always
 *    rendered.** It is what a browser tab gets, what `e2e/` drives, and what
 *    every existing test in `src/components/__tests__/` renders.
 *  - `'chrome'` — the host-chrome view: the context bar, the command palette and
 *    pane 1. Panes 2 and 3 are in the other document, so there is no panel group
 *    here at all: pane 1 fills the view, and the boundary at its trailing edge
 *    is the NATIVE view edge that `paneViews.ts` owns and `setBounds` is the
 *    only writer of.
 *  - `'extension'` — the extension view: panes 2 and 3, the divider between
 *    them, the floating toolbar, the block ledger and the omnibox composer. Pane
 *    1, the context bar and the palette are in the other document.
 *
 * **The surface is chosen at an ENTRY POINT and never inside a component.**
 * `src/main.tsx` and `src/dev/main.dev.tsx` pass `'chrome'` when a native host is
 * beside them and nothing otherwise; `src/paneview/main.paneview.tsx` passes
 * `'extension'`. That is what keeps every browser-lane test — 51 Playwright
 * specs and every unit test that renders this component — on `'full'` without
 * one of them naming a surface. Moving the decision into a hook here would break
 * that silently.
 * ============================================================================
 */
export type ShellSurface = 'full' | 'chrome' | 'extension';

export interface ShellLayoutProps {
  /**
   * Where this shell persists its layout. Defaults to the process-wide engine
   * over `localStorage`.
   *
   * It is a prop for the same two reasons `useLocalStorageState` takes one: a
   * test needs an engine of its own rather than the module singleton every other
   * test would then share, and two shells in one page must be able to keep two
   * layouts apart. **Its identity must be stable across renders** — the default
   * one is — because the restored snapshot below is taken once, at mount.
   */
  readonly engine?: HydrationEngine;
  /**
   * Which part of the shell this document draws. Defaults to `'full'`, which is
   * every part of it. See `ShellSurface`.
   */
  readonly surface?: ShellSurface | undefined;
}

/** The assembled shell: ribbon above three horizontally resizable panes. */
export function ShellLayout({
  engine: suppliedEngine,
  surface = 'full',
}: ShellLayoutProps = {}): ReactElement {
  const registry = useRegistry();
  // The revision is a CHANGE TRIGGER, not an input: its value carries no meaning
  // and is deliberately not read for one. What it announces is that the
  // registry's contents moved, which is exactly when the extension list below
  // has to be re-read and when a pending foreground restore gets another chance.
  // DO NOT drop it from the restore effect's dependencies because it looks
  // unused there — that turns the restore into a mount-only attempt, and an
  // extension that registers from its own mount effect would never be restored.
  // Same reasoning, and the same warning, as the sweep effect in
  // `ShellHostProvider`.
  const revision = useRegistryRevision();
  const activation = useActivation();
  const store = useShellStore();
  const context = useShellContext();

  const engine = suppliedEngine ?? getDefaultHydrationEngine();

  // The two questions every conditional below asks, derived once so that no site
  // spells the union out a second time. `'full'` answers yes to both, which is
  // why the default path is unchanged by construction rather than by inspection.
  const showChrome = surface !== 'extension';
  const showExtensionPanes = surface !== 'chrome';

  const [groupWidth, setGroupWidth] = useState<number | null>(null);
  // Bound LIVE, because this flag decides which component tree renders — see
  // decision 6. The hook reads through `useSyncExternalStore` during render off
  // an engine that hydrated in its constructor, which is the whole of the
  // no-flash property.
  const [isNavCollapsed, setNavCollapsed] = useLocalStorageState('isPane1Collapsed', { engine });
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  // The fourth persisted slot. Bound live for the same reason the collapse flag
  // is: a command run in one tab should be recent in the next render, not after
  // a reload.
  const [recentCommandIds, setRecentCommandIds] = useLocalStorageState('recentCommandIds', {
    engine,
  });
  // NOT persisted, deliberately. A palette that was open when the app closed and
  // is open again when it opens is a modal the user did not ask for.
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  // The last thing the composer submitted that was not a command. Held so the
  // surface is demonstrably wired end to end and its text is visible to the user
  // who typed it; there is nothing else the host can honestly do with a `filter`
  // or an `ask` until the structured payload channel exists. See the composer's
  // `onSubmit` below.
  const [lastSubmission, setLastSubmission] = useState<OmniboxSubmission | null>(null);
  /**
   * The last `form` block a user submitted, echoed rather than consumed.
   *
   * The same answer the composer's submission gets, for the same reason: writing
   * it back onto the publisher's channel would be host chrome publishing under
   * an extension's scope, which is the host impersonating the extension.
   */
  const [lastBlockSubmission, setLastBlockSubmission] = useState<string | null>(null);

  // The shell's one keyboard listener. Called HERE — see decision 3 in the banner
  // and decision 1 in `hotkeyDispatch.ts` — because this component is host
  // territory above every `ExtensionHostBoundary` and renders the context bar, so
  // the chord path and the button path read one source of truth.
  //
  // **The host chord table is the dispatcher's, not this caller's.** All that is
  // passed is what to DO about a host chord; there is no table to register into
  // here, which is what keeps "host chrome is not plug-in-declarable" a structure
  // rather than a lookup order. See `HOST_CHORDS` in `hotkeyDispatch.ts`.
  // No `if` on the id, and that is a coverage fact as much as a style one.
  // `HOST_CHORDS` holds exactly ONE entry, so an `if (id === 'open-command-palette')`
  // has an implicit `else` no input can reach — vitest 2 did not count that branch
  // and vitest 4 does, which is how it surfaced. Narrowing the parameter type is
  // the honest fix: the compiler rejects a second host chord here rather than the
  // test suite failing to reach it, so adding one is a type error at this call
  // site instead of an invisible uncovered branch.
  //
  // **WHERE THE PALETTE ACTUALLY IS, WHEN IT IS NOT HERE.** The dispatcher runs
  // in both documents and the palette is rendered in one of them. Left alone,
  // the chord pressed in the extension view set a piece of state nothing reads
  // and the user got silence from a keystroke they use constantly. So the
  // extension surface hands the surviving intent to the host, which focuses host
  // chrome and asks it to open — see `src/hooks/useHostPalette.ts` for why the
  // MATCHING stays in the renderer and only the intent crosses.
  //
  // `showChrome` first, so the surface that owns the palette never takes a round
  // trip to open its own; `requestPalette === null` second, so a browser
  // document — where there is no host and no second surface — still opens the
  // one it renders.
  const openPalette = useCallback((): void => {
    setPaletteOpen(true);
  }, []);
  const requestPalette = useHostPalette(openPalette);

  useHotkeyDispatch(() => {
    if (showChrome || requestPalette === null) {
      openPalette();
      return;
    }
    requestPalette();
  });

  // A mount-time SNAPSHOT, not a subscription. `defaultSize` means "where this
  // panel starts"; see decision 6 for why binding it live would feed the value
  // being dragged back in as the starting point.
  const [restoredSizes] = useState<PaneSizes>(() => engine.getState().paneSizes);
  const hasRestoredLayout = !isEngineDefaultLayout(restoredSizes);

  // The three-pane layout as the group last ANNOUNCED it, which is not the same
  // fact as the layout this shell has persisted. See `persistPaneSize`.
  const announcedLayout = useRef<Record<PaneId, number>>({ ...restoredSizes });

  // Whether a persisted foreground extension is still waiting to be restored.
  // Read once, at mount, and cleared by the effect below the moment the restore
  // lands or the user activates anything. See decision 6.
  const isRestorePending = useRef(engine.getState().activeExtensionId !== null);

  // A callback ref rather than an effect: it runs during commit, so the width is
  // known before the panel group first mounts and `defaultSize` is honoured on
  // the very first layout. React calls it with `null` on unmount, which is the
  // only reason for the guard.
  const measureGroup = useCallback((node: HTMLDivElement | null): void => {
    if (node === null) {
      return;
    }
    setGroupWidth(node.getBoundingClientRect().width);
  }, []);

  // The live half. `observeGroup.ref` has a stable identity for this component's
  // whole lifetime, so composing the two here does not detach and reattach — and
  // therefore does not disconnect and rebuild the observer — on every render.
  // `measureGroup` runs FIRST, so the commit-time snapshot `defaultSize` depends
  // on is taken before anything else touches the node.
  // DESTRUCTURED, and that is load-bearing rather than tidy: the hook returns a
  // fresh object every render, so depending on the object would rebuild
  // `attachGroup` on every render, which would detach and reattach the ref and so
  // disconnect and rebuild the observer. `ref` alone is stable for the lifetime.
  const { width: observedWidth, ref: observeGroupRef } = useElementWidth();

  // The native host's updater, or `null` in a browser document. Read here, with
  // the other hooks, and used exactly once — in `hostCommands` below.
  const hostUpdates = useHostUpdates();

  const attachGroup = useCallback(
    (node: HTMLDivElement | null): void => {
      measureGroup(node);
      observeGroupRef(node);
    },
    [measureGroup, observeGroupRef],
  );

  const selectNavNode = useCallback(
    (nodeId: string): void => {
      // Registry-validated ids only — every node in a stored blueprint passed
      // `EXTENSION_ID_PATTERN` — so this cannot be rejected for its argument.
      //
      // `setActiveNavNode`, not `patchContext({ activeNavNodeId })`, since GitHub
      // issue #15. There are two writers of this field now — this handler and
      // `IShellAPI.setActiveNavNode` — and they go through ONE store member, so
      // the rule deciding what the field may hold is applied once and reported
      // once. That is Amendment J Decision 1's argument about `isVisible`, in a
      // second place: two routes to one field must not be two copies of one rule.
      store.setActiveNavNode(nodeId);
    },
    [store],
  );

  const extensions = registry.listExtensions();
  const active = activation.getActive();
  // The one id every boundary on this render resets against. Switching
  // extension must not leave A's error surface standing over B's fresh view.
  const activeId = active === null ? null : active.id;

  /**
   * Learn one pane's new size, and decide separately whether it is a size worth
   * recording. See decision 6 in the banner for both halves.
   *
   * KNOWING THE LAYOUT AND RECORDING IT ARE TWO DIFFERENT THINGS, AND SPLITTING
   * THEM IS WHAT MAKES THE RECORD A LAYOUT RATHER THAN A PILE OF SLOTS. One
   * divider moves exactly two panes, so the third never reports and its slot
   * keeps whatever it held — which, for a shell nobody had resized, is the
   * engine's 1360px-reference default beside two percentages measured at THIS
   * width. `announcedLayout` therefore takes every report the group makes about
   * a three-pane group, including the announcements below that are refused, and
   * a write sends all three panes at once.
   *
   * THE REFUSAL IS ONE RULE: a report whose `previousSize` is not the size this
   * shell last saw for that pane did not come out of the layout this shell
   * knows about, so it is not a change the user made to it. That covers both
   * cases exactly, and the second is the one the identity test above used to
   * miss:
   *
   *   - The group announcing its own initial layout reports `undefined`, which
   *     is never a size — so a mount nobody resized writes nothing at all.
   *   - Re-adding pane 1 after a collapse makes the library renormalise a
   *     two-panel group into a three-panel one. Panes 2 and 3 report a real
   *     previous size, but it is their share of a width that EXCLUDED the 48px
   *     track — a ratio against a different denominator, and one this shell
   *     deliberately never learned. Writing it discarded the layout the user had
   *     actually chosen and left a record whose percentages did not divide the
   *     whole.
   *
   * The collapsed group is refused before either, and refused from LEARNING as
   * well: those two panes divide the different denominator, so the numbers are
   * not this layout's at all.
   *
   * **THE EXTENSION SURFACE IS REFUSED BY EXACTLY THAT RULE, ONE LAYER UP.** Its
   * group holds panes 2 and 3 and no pane 1, so every size it announces is a
   * share of a width that EXCLUDES pane 1 — the same "ratio against a different
   * denominator" the collapsed case is refused for, and one this shell has never
   * learned either. Writing those two numbers into a three-pane record would
   * leave percentages that do not divide the whole, and the browser lane reads
   * that same record. So the extension surface reads the record and never writes
   * it, and the pane-1 half of the layout is owned by main's window split
   * (`PaneWindow.setSplit`) rather than by this slot. The chrome surface has no
   * resizable pane at all, so it never reaches here.
   * *Tests:* `src/components/__tests__/ShellLayoutSurfaces.test.tsx` — "does not
   * write pane sizes from the extension surface, whose group excludes pane 1".
   */
  const persistPaneSize = useCallback(
    (pane: PaneId, size: number, previousSize: number | undefined): void => {
      if (isNavCollapsed || surface !== 'full') {
        return;
      }
      const known = announcedLayout.current;
      const isKnownChange = previousSize === known[pane];
      const next: Record<PaneId, number> = { ...known };
      next[pane] = size;
      announcedLayout.current = next;
      if (!isKnownChange) {
        return;
      }
      engine.setSlot('paneSizes', {
        pane1: clampPanePercent(next.pane1),
        pane2: clampPanePercent(next.pane2),
        pane3: clampPanePercent(next.pane3),
      });
    },
    [engine, isNavCollapsed, surface],
  );

  useEffect(() => {
    // ======================================================================
    // THE EXTENSION SURFACE NEITHER RESTORES THE FOREGROUND NOR RECORDS IT,
    // AND THIS GUARD IS THE FIX FOR A RACE THAT WAS OBSERVED RATHER THAN
    // ANTICIPATED.
    // ======================================================================
    // Both documents run in one origin and therefore over one `localStorage`.
    // With both of them restoring `activeExtensionId` from it, each published
    // the same foreground independently, and `publishForeground` publishes a
    // handover as TWO writes — `clearContextKeys`, then the patch. The
    // interleaving that produced was real and reproducible in the launched
    // window: host chrome's `clear` was ordered by the authority while its
    // carried context still said `null`, the extension's replica applied
    // another renderer's commit and rolled its optimistic `mail` back to
    // `null`, `ExtensionSurface` in `src/paneview/PaneViewShell.tsx` read that as
    // "the user closed the extension" and blurred — and the blur was ordered
    // AFTER host chrome's patch. Both documents then agreed on nothing being
    // in the foreground, having both restored the same extension.
    //
    // There is one navigation pane and it is host chrome's, so the persisted
    // foreground is host chrome's too. The extension surface learns which
    // extension it is showing from the replicated context, which is the same
    // route a user's click takes and has no second writer.
    if (!showChrome) {
      return;
    }
    // `revision` is in the dependency list and is deliberately not read here: it
    // is the change trigger that gives a pending restore another chance every
    // time the registry moves. See the comment on `useRegistryRevision` above.
    //
    // **Guarded, and this is a call site a host cannot guard for itself.**
    // `activate` publishes the new foreground through the shell store, the store
    // notifies synchronously, and `useShellStore().subscribe` is public — so
    // plug-in code runs inside this write. Every other `activate` in this file is
    // called from a click handler; this one is called by React's passive-effect
    // flush, where a throw reaches no error boundary and unmounts the whole root.
    // Exactly the position, and exactly the argument, of the sweep effect in
    // `ShellHostProvider`. The reporting call is guarded too, because `console`
    // is no more the host's object than a listener is.
    try {
      if (!isRestorePending.current) {
        engine.setSlot('activeExtensionId', activeId);
        return;
      }
      if (activeId !== null) {
        // Somebody activated something before the restore could land. The
        // restore is spent either way: the user's choice is now the foreground,
        // and re-imposing a remembered one over it would be the shell arguing.
        isRestorePending.current = false;
        engine.setSlot('activeExtensionId', activeId);
        return;
      }
      const registeredIds = new Set(registry.listExtensions().map((blueprint) => blueprint.id));
      // The engine's own door for "is this id still real?". An id the registry
      // does not know answers `null`, and `null` activates nothing — a lazily
      // loaded extension is indistinguishable from an uninstalled one, so the
      // record is left exactly as it is and this runs again on the next
      // revision.
      const restorable = selectActiveExtensionId(engine.getState(), registeredIds);
      if (restorable === null) {
        return;
      }
      isRestorePending.current = false;
      activation.activate(restorable);
    } catch (error) {
      try {
        console.error(
          'ShellLayout: restoring or recording the persisted foreground extension raised. The shell is still running; a shell store listener is a signal to re-read the context, not a place to work in.',
          error,
        );
      } catch {
        // Reporting is best-effort. Staying mounted is not.
      }
    }
  }, [activation, activeId, engine, registry, revision, showChrome]);

  // `?? 0` is the not-yet-measured render, which draws no panel group at all;
  // `percentOf` answers with the fallback band for it, and for any width a
  // browser reports as zero.
  const width = groupWidth ?? 0;
  // The BANDS, and only the bands, follow the observed width. `?? width` is the
  // no-observer answer — jsdom, an older WebView, or the render before the
  // observer has delivered anything — and it is the mount-time measurement, which
  // is what every band was derived from before this hook existed. `??` rather
  // than a truthiness test because the floor in `useElementWidth` is 1, so a
  // reported width is never falsy, but `null` genuinely means "nothing observed".
  const bandWidth = observedWidth ?? width;
  const navMinPercent = percentOf(PANE_PX.navMin, bandWidth, PANE_FALLBACK_PERCENT.navMin);
  const navMaxPercent = percentOf(PANE_PX.navMax, bandWidth, PANE_FALLBACK_PERCENT.navMax);
  const listMinPercent = percentOf(PANE_PX.listMin, bandWidth, PANE_FALLBACK_PERCENT.listMin);
  const listMaxPercent = percentOf(PANE_PX.listMax, bandWidth, PANE_FALLBACK_PERCENT.listMax);
  const detailMinPercent = percentOf(PANE_PX.detailMin, bandWidth, PANE_FALLBACK_PERCENT.detailMin);

  // A restored size wins over the pixel-derived default, and is held to the same
  // band that default would have been held to — see decision 6. With nothing
  // restored the arithmetic is exactly what it always was, so a shell nobody has
  // resized still opens on the pixel intent in `PANE_PX`.
  const navDefaultPercent = hasRestoredLayout
    ? clampToBand(restoredSizes.pane1, navMinPercent, navMaxPercent)
    : percentOf(PANE_PX.navDefault, width, PANE_FALLBACK_PERCENT.navDefault);
  // A RESTORED PANE-2 SHARE IS RE-BASED ONTO THE GROUP THAT IS ACTUALLY LIVE,
  // and this is arithmetic rather than taste. The record stores three
  // percentages of one width. The extension surface's group holds two of those
  // panes, so `restoredSizes.pane2` is a share of a denominator this group does
  // not have: handed over unchanged it would ask for roughly three quarters of
  // what the user chose, the two panels would sum to well under 100, and
  // `react-resizable-panels` would renormalise them into proportions nobody
  // picked. Dividing by the pair's own total is the same layout expressed
  // against the width it is being laid out in.
  //
  // The denominator cannot be zero: the engine clamps every stored slot into
  // `[MIN_PANE_PERCENT, MAX_PANE_PERCENT]`, whose floor is above zero, so the
  // division is safe on every record the engine can produce — including the
  // untouched defaults. It is evaluated unconditionally and `hasRestoredLayout`
  // decides only whether the RESULT is used; that is worth stating, because the
  // guard sits on the next expression and reads at a glance as if it guarded
  // this one.
  // WHETHER PANE 1 IS A MEMBER OF THE GROUP THESE PERCENTAGES ARE HANDED TO,
  // which is not the same question as whether the shell is drawing chrome.
  //
  // GitHub issue #114. This used to read `showChrome`, and that is right on the
  // extension surface and wrong when navigation is COLLAPSED on the chrome
  // surface: the rail is a fixed 48px `div` rendered outside `shell-panes`, so
  // the group holds pane 2 and pane 3 alone and its members must sum to 100. At
  // 1440px the old expression produced 25 and 58.333 — `react-resizable-panels`
  // renormalised them and warned `Invalid layout total size: 25%,
  // 58.33333333333334%` on every load, and pane 2 opened about a fifth wider
  // than the 360px `PANE_PX` asks for.
  //
  // Nothing here is new arithmetic. It is the same rebase the restored path
  // already documents three paragraphs down, applied to the predicate that
  // decides it rather than to only one of its two uses.
  const paneOneIsInGroup = showChrome && !isNavCollapsed;
  const restoredListPercent = paneOneIsInGroup
    ? restoredSizes.pane2
    : (restoredSizes.pane2 / (restoredSizes.pane2 + restoredSizes.pane3)) * 100;
  const listDefaultPercent = hasRestoredLayout
    ? clampToBand(restoredListPercent, listMinPercent, listMaxPercent)
    : percentOf(PANE_PX.listDefault, width, PANE_FALLBACK_PERCENT.listDefault);
  // Declared rather than left implicit: the library warns about a panel with no
  // `defaultSize`, and the remainder is what pane 3 would have been given anyway.
  // It is floored at the pane's own minimum so that two wide defaults cannot ask
  // for a negative share. The remainder is also what makes a CLAMPED restore add
  // up: when pane 1 or pane 2 was corrected above, pane 3 absorbs the difference
  // rather than the three of them summing to something the library has to
  // renormalise.
  //
  // **The pane-1 term is zero whenever pane 1 is not a member of this group**,
  // and leaving it in would be the same denominator error one paragraph up, in
  // the other direction: the remainder pane 3 gets is everything the list did
  // not take rather than everything the list and a pane that is not here did
  // not take. That is true on the extension surface, where pane 1 lives in
  // another document, AND when navigation is collapsed to its 48px rail, where
  // pane 1 is a fixed-width `div` outside the group. The second case is #114.
  const paneOneShare = paneOneIsInGroup ? navDefaultPercent : 0;
  const detailDefaultPercent = Math.max(
    detailMinPercent,
    100 - paneOneShare - listDefaultPercent,
  );

  const hostCommands: readonly HostCommand[] = [
    {
      id: 'host-toggle-navigation',
      category: 'view',
      label: isNavCollapsed ? 'Expand navigation' : 'Collapse navigation',
      icon: 'navigation',
      onSelect: () => {
        // A value, not an updater: `useLocalStorageState`'s setter writes one
        // slot of the engine's record and takes no function form. `hostActions`
        // is rebuilt on every render, so the flag closed over here is current.
        setNavCollapsed(!isNavCollapsed);
      },
    },
    {
      id: 'host-toggle-drawer',
      label: isDrawerOpen ? 'Hide utility drawer' : 'Show utility drawer',
      icon: 'drawer',
      category: 'view',
      onSelect: () => {
        setDrawerOpen((open) => !open);
      },
    },
    {
      id: 'host-close-extension',
      label: 'Close extension',
      icon: 'close',
      category: 'navigate',
      isDisabled: active === null,
      onSelect: () => {
        activation.blur();
      },
    },
    // THE "SWITCH EXTENSION" VERB. It is what makes cross-extension reach
    // activate-then-execute — two visible steps — rather than a palette that
    // lists a background extension's commands. See `CommandRegistry`'s
    // containment block for why the second shape is refused.
    //
    // It is a HOST command, so it carries no predicate and no chord, and it is
    // deliberately confined to the palette: a "switch extension" button on the
    // 32px context bar would spend a contextual slot on navigation.
    {
      id: 'host-switch-extension',
      label: 'Switch extension',
      icon: 'navigation',
      category: 'navigate',
      surfaces: ['palette'],
      isDisabled: extensions.length === 0,
      onSelect: () => {
        // Focus the navigation pane's own list rather than choosing for the
        // user. The host does not know which extension they meant, and picking
        // one would be the shell arguing.
        setNavCollapsed(false);
      },
    },
    // AUTO-UPDATE, AND NOTHING ELSE IN THIS FILE KNOWS ABOUT IT. The list is
    // empty in the browser lane and in a development run of the native host, so
    // this spread is the whole of the integration; the decisions about which
    // commands exist for which status live in `src/core/updates/hostUpdates.ts`,
    // where they can be unit-tested without a shell around them.
    ...hostUpdateCommands(hostUpdates),
  ];

  const commandExtension: ExtensionCommands | null =
    active === null
      ? null
      : { extensionId: active.id, commands: active.blueprint.commands, shell: active.shell };

  // ONE registry, four surfaces, and it is REBUILT ON EVERY RENDER RATHER THAN
  // MEMOISED. That is a decision and not an omission.
  //
  // `createCommandRegistry` holds no subscription, no listener and no mutable
  // state beyond the arrays it was handed; `hostCommands` and `commandExtension`
  // are already rebuilt every render, because they close over the current labels
  // and the live revocable handle; and none of the four surfaces is `React.memo`'d,
  // so a stable identity would be compared by nothing. A `useMemo` here would have
  // to list every value those two are built from — which is a dependency array
  // spelling "everything" — and its only real effect would be a stale
  // `recentCommandIds` inside `onExecuted` on the render where the list has moved
  // and the memo has not. Building it fresh makes the recents list
  // current-by-construction instead of current-by-dependency-list.
  const commandRegistry = createCommandRegistry({
    hostCommands,
    extension: commandExtension,
    recentKeys: recentCommandIds,
    onExecuted: (key) => {
      // Host state, bounded and persisted. `withRecent` is the one definition of
      // "recent", shared with the tests and with the hydration validator.
      setRecentCommandIds(withRecent(recentCommandIds, key));
    },
  });

  const navigation = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className={
            isNavCollapsed
              ? 'sr-only'
              : `px-1 text-[11px] font-semibold uppercase tracking-wide ${TOKEN_CLASS.mutedText}`
          }
        >
          Extensions
        </h2>
        <ul className={isNavCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-px'}>
          {extensions.map((extension) => (
            <li key={extension.id} className="min-w-0">
              <ShellNavButton
                label={extension.name}
                // A blueprint declares no icon; only its nav nodes do. See the
                // `ShellNavButton` docblock for why the host does not invent one.
                icon={undefined}
                badgeCount={undefined}
                // Nor a metric: a blueprint has no such field, and an extension
                // row is not a navigation node, so there is no scope under which
                // the store could hold one for it. Same reason as the badge.
                metric={undefined}
                isCollapsed={isNavCollapsed}
                isCurrent={active !== null && active.id === extension.id}
                onSelect={() => {
                  // The result is not branched on: this button exists only for
                  // an id the registry listed on this same render, and
                  // `activate` rejects nothing else it could be handed. A
                  // failure here would mean the registry changed between render
                  // and click, in which case the re-render that change caused is
                  // already the correct response.
                  activation.activate(extension.id);
                }}
              />
            </li>
          ))}
        </ul>
      </div>
      {active === null ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            className={
              isNavCollapsed
                ? 'sr-only'
                : `px-1 text-[11px] font-semibold uppercase tracking-wide ${TOKEN_CLASS.mutedText}`
            }
          >
            Navigation
          </h2>
          <NavigationTree
            extensionId={active.id}
            nodes={active.blueprint.navigationTree}
            activeNodeId={context.activeNavNodeId}
            isCollapsed={isNavCollapsed}
            onSelect={selectNavNode}
          />
        </div>
      )}
    </div>
  );

  // Pane 1 is inside a boundary too. Its rows render plug-in labels and badge
  // counts, so "the navigation pane cannot fail" was never true — it was only
  // untested. One element, used in whichever of the two pane-1 states is live.
  const navigationPane = (
    <FaultBoundary boundaryLabel="The Navigation pane" extensionId={activeId} resetKey={activeId}>
      {navigation}
    </FaultBoundary>
  );

  /**
   * PANES 2 AND 3, AND THE DIVIDER BETWEEN THEM.
   *
   * Hoisted out of the tree below so that the two surfaces which draw them —
   * `'full'` and `'extension'` — draw the SAME element rather than two copies
   * of it that can drift. They are always the same extension (plan §2:
   * `ExtensionViews` declares `pane2` and `pane3` on one blueprint), so they
   * travel together, which is also why the process split put them in one
   * document. See `electron/main/surfaces.ts`.
   */
  const extensionPanes = (
    <>
      <Panel
        id="pane2"
        order={2}
        className="min-h-0 min-w-0"
        defaultSize={listDefaultPercent}
        minSize={listMinPercent}
        maxSize={listMaxPercent}
        onResize={(size, previousSize) => {
          persistPaneSize('pane2', size, previousSize);
        }}
      >
        <PaneWrapper
          paneId="pane2"
          label="List"
          header={<span className="truncate font-semibold">List</span>}
        >
          <FaultBoundary
            boundaryLabel="The List pane"
            extensionId={activeId}
            resetKey={activeId}
          >
            {active === null ? (
              <EmptyPane>Select an extension to fill this pane.</EmptyPane>
            ) : (
              <ExtensionPane
                active={active}
                pane="pane2"
                label="The list view"
                context={context}
              />
            )}
          </FaultBoundary>
        </PaneWrapper>
      </Panel>
      <ShellResizeHandle label="Resize the list pane" />
      <Panel
        id="pane3"
        order={3}
        className="min-h-0 min-w-0"
        defaultSize={detailDefaultPercent}
        minSize={detailMinPercent}
        onResize={(size, previousSize) => {
          persistPaneSize('pane3', size, previousSize);
        }}
      >
        <PaneWrapper
          paneId="pane3"
          label="Detail"
          header={
            <span className="truncate font-semibold">
              {active === null ? 'No extension selected' : active.blueprint.name}
            </span>
          }
          trailing={
            isDrawerOpen ? (
              <div className="flex flex-col gap-1">
                <h2
                  className={`text-[11px] font-semibold uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}
                >
                  Utilities
                </h2>
                <p className={`text-[11px] leading-4 ${TOKEN_CLASS.mutedText}`}>
                  Reserved for extension-supplied utilities.
                </p>
              </div>
            ) : undefined
          }
          footer={
            /*
              THE COMPOSER IS A SLOT, NOT A CHILD, AND THAT IS GITHUB
              ISSUE #110.

              It used to be the last element of the scroll container, so
              it came to rest wherever the ledger content happened to
              stop — measured at y≈408 in an 860px pane, above roughly
              450px of dead space, and moving every time the ledger grew.
              `PaneWrapper`'s `footer` slot renders BELOW the scroll
              container, so it is docked to the pane's bottom edge and
              stays there.

              It is still host chrome around a plug-in view, and it is
              still OUTSIDE the fault boundary further down: a plug-in
              render that throws must not take the shell's own input
              surface down with it. The slot puts it further outside than
              it was, not less.

              The slot supplies the top border and the padding — see
              `PaneWrapper` — which is why `OmniboxComposer` no longer
              draws its own.
            */
            <OmniboxComposer
              registry={commandRegistry}
              context={context}
              onSubmit={(submission) => {
                // The host owns no filter and answers no question, and
                // says so rather than pretending. Reaching into the
                // active extension's view to apply a filter would be host
                // chrome operating a plug-in's UI, which nothing in this
                // repository grants; publishing the text as a context key
                // would write into a namespace that is the extension's.
                // The submission is recorded, and the surface that
                // would consume it — the block ledger in the body — is
                // fed by the structured payload channel, which only the
                // EXTENSION may publish on. The host has no door to it
                // that would not be the host impersonating the
                // extension.
                setLastSubmission(submission);
              }}
            />
          }
        >
          {/*
            WHAT IS LEFT IN THE BODY IS THE SCROLLING PART, AND THE ORDER
            IS THE DESIGN. The floating toolbar rides above the view
            because it is triggered by a selection made INSIDE the view;
            the ledger and the two echo lines follow the view because they
            are its output. The composer is no longer here — it is the
            pane's `footer`, docked below this scroll container, for the
            reason given at that prop.

            The toolbar and the ledger are host chrome around a plug-in
            view, so both sit OUTSIDE the fault boundary below: a plug-in
            render that throws must not take the shell's own surfaces down
            with it, which is the whole point of putting a boundary there
            at all.
          */}
          {/*
            `data-shell-region="detail-stack"` exists for one reason: this is
            the element whose `flex-1` had no column parent to fill against
            before GitHub issue #110, and a browser assertion needs a handle on
            it. `e2e/shell-layout.spec.ts` measures it against the body's own
            box — that is the guard for the `flex flex-col` half of the fix,
            and the docked-footer case does NOT cover it, measured by reverting
            the class and watching the footer case stay green.
          */}
          <div
            data-shell-region="detail-stack"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-1"
          >
            <FloatingToolbar registry={commandRegistry} context={context} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <FaultBoundary
                boundaryLabel="The Detail pane"
                extensionId={activeId}
                resetKey={activeId}
              >
                {active === null ? (
                  <EmptyPane>
                    No extension is active, so there is nothing to detail.
                  </EmptyPane>
                ) : (
                  <ExtensionPane
                    active={active}
                    pane="pane3"
                    label="The detail view"
                    context={context}
                  />
                )}
              </FaultBoundary>
            </div>
            {/*
              THE BLOCK LEDGER. HOST CHROME, AND THE FIRST SURFACE IN
              THIS SHELL THAT DRAWS A CHART LIBRARY.

              Outside the fault boundary above, for the reason the
              composer and the floating toolbar are: a plug-in render
              that throws must not take the shell's own surfaces with
              it. That is safe here rather than merely hoped for,
              because every reader under `src/core/ledger/` is TOTAL —
              a malformed payload draws a complaint, never a throw.

              `echartsRenderer` is injected at this one point. It is
              the only production import of a chart library in `src/`,
              which is what makes the renderer swappable and what makes
              the measured bundle delta attributable to one line.
            */}
            {active === null ? null : (
              <BlockLedger
                shell={active.shell}
                context={context}
                renderer={echartsRenderer}
                onSubmit={(blockId, values) => {
                  setLastBlockSubmission(
                    `${blockId}: ${Object.entries(values)
                      .map(([name, value]) => `${name}=${value}`)
                      .join(', ')}`,
                  );
                }}
              />
            )}
            {lastBlockSubmission === null ? null : (
              <p
                data-shell-region="ledger-echo"
                className={`px-1 text-[11px] leading-4 ${TOKEN_CLASS.mutedText}`}
              >
                <span className="font-semibold">block</span>
                {`: ${lastBlockSubmission}`}
              </p>
            )}
            {lastSubmission === null ? null : (
              /*
                The submission, echoed back in the host's own words. It is
                the honest thing to draw: the user typed something, the
                host detected an intent, and nothing has consumed it yet.
                `text` is the USER's string, not a plug-in's, and it is
                rendered as a text node regardless.
              */
              <p
                data-shell-region="omnibox-echo"
                className={`px-1 text-[11px] leading-4 ${TOKEN_CLASS.mutedText}`}
              >
                <span className="font-semibold">{lastSubmission.intent}</span>
                {`: ${lastSubmission.text}`}
              </p>
            )}
          </div>
        </PaneWrapper>
      </Panel>
    </>
  );

  return (
    <div
      data-shell-region="root"
      data-shell-surface={surface}
      className={
        'flex h-full min-h-0 w-full flex-col overflow-hidden text-[12px] ' +
        `${TOKEN_CLASS.appSurface} ${TOKEN_CLASS.appText}`
      }
    >
      {/*
        THE TWO COMMAND SURFACES THAT ARE HOST CHROME'S AND NOT A PANE'S.
        The 32px context bar and the palette both act on the whole shell and both
        outlive any one extension, so they belong to the surface that also owns
        navigation. The extension view draws neither; the two surfaces it does
        draw — the floating toolbar and the omnibox composer — are inside pane 3,
        because both are triggered by, and act on, what is selected in there.
      */}
      {showChrome ? (
        <>
          <FaultBoundary boundaryLabel="The context bar" extensionId={activeId} resetKey={activeId}>
            <ContextBar registry={commandRegistry} context={context} />
          </FaultBoundary>
          <FaultBoundary
            boundaryLabel="The command palette"
            extensionId={activeId}
            resetKey={activeId}
          >
            <CommandPalette
              registry={commandRegistry}
              context={context}
              open={isPaletteOpen}
              onOpenChange={setPaletteOpen}
            />
          </FaultBoundary>
        </>
      ) : null}
      <div
        data-shell-region="panes"
        className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
      >
        {showExtensionPanes ? (
          <>
            {showChrome && isNavCollapsed ? (
              <div
                data-shell-region="nav-track"
                className="flex-none"
                style={{ width: `${PANE_PX.navCollapsed}px` }}
              >
                <PaneWrapper paneId="pane1" label="Navigation">
                  {navigationPane}
                </PaneWrapper>
              </div>
            ) : null}
            <div ref={attachGroup} className="flex min-h-0 min-w-0 flex-1">
              {groupWidth === null ? null : (
                <PanelGroup id="shell-panes" direction="horizontal" className="flex min-w-0 flex-1">
                  {isNavCollapsed || !showChrome ? null : (
                    <>
                      <Panel
                        id="pane1"
                        order={1}
                        className="min-h-0 min-w-0"
                        defaultSize={navDefaultPercent}
                        minSize={navMinPercent}
                        maxSize={navMaxPercent}
                        onResize={(size, previousSize) => {
                          persistPaneSize('pane1', size, previousSize);
                        }}
                      >
                        <PaneWrapper
                          paneId="pane1"
                          label="Navigation"
                          header={<span className="truncate font-semibold">Navigation</span>}
                        >
                          {navigationPane}
                        </PaneWrapper>
                      </Panel>
                      <ShellResizeHandle label="Resize the navigation pane" />
                    </>
                  )}
                  {extensionPanes}
                </PanelGroup>
              )}
            </div>
          </>
        ) : (
          /*
            PANE 1 ALONE, AND DELIBERATELY NOT IN A `PanelGroup`.
            On the chrome surface the boundary at pane 1's trailing edge is the
            edge of a `WebContentsView`, and main is the only writer of it —
            `layout()` in `electron/main/paneViews.ts`. A single `Panel` carrying
            pane 1's own `maxSize` inside a group that holds nothing else is a
            contradiction the library resolves by renormalising to 100% and
            warning; expressing "this pane is the whole view" as ordinary flex is
            the honest spelling of a width this document does not decide.

            The collapsed flag still reaches the tree — `navigation` reads it, so
            the rows go icon-only — but there is no 48px track, because a 48px
            track inside a view that is not 48px wide is a rail beside an empty
            rectangle. Narrowing the VIEW when navigation collapses is main's
            half of that, and it is not built; see the report on this phase.
          */
          <div data-shell-region="nav-pane" className="flex min-h-0 min-w-0 flex-1">
            <PaneWrapper
              paneId="pane1"
              label="Navigation"
              // `PANE_CHROME` sets `h-full` and no width, because everywhere else
              // a `Panel` has already decided how wide the pane is. Nothing has
              // here, so the section is told to take the row.
              className="min-w-0 flex-1"
              header={<span className="truncate font-semibold">Navigation</span>}
            >
              {navigationPane}
            </PaneWrapper>
          </div>
        )}
      </div>
    </div>
  );
}
