import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';
import { Panel, PanelGroup } from 'react-resizable-panels';
import type { ImperativePanelGroupHandle } from 'react-resizable-panels';
import { useActivation } from '../../core/ActivationContext';
import { useRegistry, useRegistryRevision } from '../../core/RegistryContext';
import { useShellContext, useShellStore } from '../../core/ShellAPI';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { useHotkeyDispatch } from '../../core/hotkeyDispatch';
import {
  getDefaultHydrationEngine,
  selectActiveExtensionId,
} from '../../core/services/HydrationEngine';
import type { HydrationEngine, PaneSizes } from '../../core/services/HydrationEngine';
import type { PaneId } from '../../core/types';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useHostUpdates } from '../../hooks/useHostUpdates';
import { hostUpdateCommands } from '../../core/updates/hostUpdates';
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
import { EmptyPane, ExtensionPane } from './ExtensionPane';
import { PaneWrapper } from './PaneWrapper';
import {
  PANE_PX,
  clampPanePercent,
  fitPaneLayout,
  intentFromRecord,
  isEngineDefaultLayout,
  paneBandsAt,
} from './paneSizing';
import type { PaneIntent } from './paneSizing';
import { ExtensionNavigationTree, ShellNavButton } from './ShellNavigation';
import { ShellResizeHandle } from './ShellResizeHandle';
import { useHostPalette } from './useHostPalette';

/**
 * ============================================================================
 * THE THREE-PANE SHELL. EIGHT DECISIONS WORTH ARGUING WITH BEFORE CHANGING.
 * ============================================================================
 *
 * WHERE THE PARTS LIVE, SINCE GITHUB ISSUE #95. This banner governs the whole
 * shell and stays with the composition; the pieces it names were split into
 * modules beside this one with no change to the DOM, the props or any value:
 * `paneSizing.ts` (`PANE_PX`, `PANE_FALLBACK_PERCENT`, `percentOf`,
 * `clampToBand`, `clampPanePercent`, `isEngineDefaultLayout`),
 * `ShellNavigation.tsx` (`ShellNavButton`, `NavNodeButton`, `NavigationTree`),
 * `ExtensionPane.tsx` (`ExtensionPane`, `EmptyPane`), `ShellResizeHandle.tsx`
 * and `useHostPalette.ts`. Where a decision below says "this file", read those
 * modules and this one together.
 *
 * 1. SIZES ARE PERCENTAGES, MEASURED INTO PIXELS AT MOUNT AND RE-FITTED ON EVERY
 *    WIDTH CHANGE.
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
 *    expressed as 12.6%, which is 88px. The bands move with the width; `defaultSize`
 *    does not, and the live layout is moved by the re-fit below instead.
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
 *    load — see decision 6.
 *
 *    **THE LIVE LAYOUT IS RE-FITTED ON EVERY WIDTH CHANGE, AND NONE OF IT IS
 *    WRITTEN (GitHub issue #23, 2026-09-19).** This paragraph used to end "the
 *    answer is a clamp rather than a live re-derivation", and the clamp was a
 *    one-shot at mount. What that left, measured: the library does re-evaluate a
 *    panel whose `minSize` or `maxSize` changed, so a narrowing window already
 *    lifted a pane to its new minimum — but each such correction reached
 *    `onResize` looking exactly like a drag, `persistPaneSize` wrote it, and a
 *    user who merely narrowed their window lost the layout they had chosen, for
 *    good. Widening again restored nothing, and a reload then opened on the
 *    correction. Issue #23 named both halves and asked whether a re-clamp is an
 *    intent worth storing. It is not, and that is the rule now.
 *
 *    So, when the band width changes, a layout effect fits the group again from
 *    what was ASKED for — the layout a person arranged this session in the
 *    current group membership, or else the persisted record read exactly as a
 *    reload reads it — through `intentFromRecord` and `fitPaneLayout` in
 *    `paneSizing.ts`, the same two functions the mount-time `defaultSize` comes
 *    from. That is the property the change exists for: **a live resize to width W
 *    lands on the layout a reload at W opens on**, and a window narrowed and
 *    widened again comes back to the layout the user chose. An untouched shell
 *    re-fits to `PANE_PX` at the new width rather than scaling the old shares.
 *    Every report the width change causes is classified by `reportPaneSize` and
 *    is neither written nor learned as the session layout.
 *
 *    Above that floor a fitted layout sums to 100: when pane 3's remainder would
 *    fall under its minimum, `fitPaneLayout` takes the deficit from pane 1 and
 *    then pane 2 (a restored 40/30/30 narrowed to 800px used to warn). A saved
 *    record is the intent and may hold a pane outside the bands of the width it
 *    was written at; it is fitted where it is read, never where it is written.
 *
 *    What it does NOT do: below roughly 700px the minimums still cannot all be
 *    met and the library still renormalises and warns, exactly as the paragraph
 *    on overflow above says; and a runtime with no `ResizeObserver` never
 *    re-fits, because its band width never moves. (A pane re-added after a
 *    collapse used to be listed here, shown at its mount-time `defaultSize`;
 *    `defaultSize` now reads the record as it stands, fitted at the live band
 *    width, so the rebuild the library performs on re-registration is the
 *    record itself — or, for an untouched shell, `PANE_PX` at the live width.
 *    *Test:* "re-expands an untouched shell on the pixel intent at the live
 *    width, not the mount width".)
 *
 *    **The record is the user's intent; bands are applied when it is read.** It
 *    is never clamped at the width it is written at, so it can hold a pane
 *    outside that width's bands, and it is never updated from a fit: not from a
 *    width change, not from the mount-time fit of a record that was corrected on
 *    open, and not from laying the record back out after a membership change.
 *    *Tests:* `src/components/__tests__/ShellLayoutRefit.test.tsx` — "fits an
 *    untouched layout to the pixel intent at the new width, rather than scaling
 *    the old shares", "fits a restored layout into the bands at the new width,
 *    and returns to it when the width comes back", "writes nothing to storage
 *    when only the width changed", "keeps the layout a person dragged, and
 *    records that one rather than the correction", "fits the two-pane group from
 *    the record when pane 1 is collapsed", "keeps a collapsed-group layout a
 *    person arranged, which is never persisted, across a width change" and
 *    "shows and fits the stored layout, not a rebuilt one, once pane 1 has
 *    collapsed and come back" and "records the width the user chose for pane 1, not its
 *    correction, when the second divider is dragged after a narrowing", "shows
 *    and saves the pane-1 width the user chose, not the rebuilt one, when divider
 *    2 is dragged after a collapse and a re-expansion", "opened at 800px on a
 *    record chosen at 1000px, drag divider 2, the stored pane 1 is still 17.6", "narrows a restored 40/30/30
 *    to 800px with every pane in its band, summing to 100, and no layout
 *    warning" and "reopens a record written after a widening on the layout that
 *    was live, with every pane in its band" — all
 *    arithmetic over stubbed widths; `e2e/pane-refit.spec.ts` — "opened narrow on a stored layout, drag
 *    divider 2, widen and reload: pane 1 keeps the stored width", "narrow, drag the
 *    second divider, widen, reload: pane 1 keeps the width the user chose",
 *    "keeps every pane inside its
 *    pixel band when a restored layout is narrowed live", "returns to the dragged
 *    widths when a narrowed window is widened again, and never rewrites the
 *    stored layout" and "keeps an untouched navigation pane on its 240px intent
 *    across a live resize, where a reload opens it".
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
 *    dragging also the value being fed back as the starting point.
 *
 *    **Amended 2026-09-19 (GitHub issue #23): `defaultSize` now reads the record
 *    as it stands at each render, not this snapshot.** The snapshot still seeds
 *    the session and announced layouts. The concern above does not arise for
 *    `defaultSize` itself: the library reads it only when a panel REGISTERS — at
 *    mount, and when pane 1 joins or leaves the group — and no drag registers a
 *    panel, so the value a drag writes never becomes that drag's starting point.
 *    What the snapshot did cause was a re-expansion rebuilding the mount-time
 *    layout instead of the one chosen since. See `registrationLayout`. The
 *    collapsed flag is the opposite case and is bound live through
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
  // chrome and asks it to open — see `useHostPalette.ts` beside this file for
  // why the MATCHING stays in the renderer and only the intent crosses. (This
  // pointer used to name `src/hooks/useHostPalette.ts`, a path that never
  // existed: the hook lived in this file until GitHub issue #95.)
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

  // A mount-time SNAPSHOT, not a subscription: what the session and announced
  // layouts start from. `defaultSize` no longer reads it — see decision 6's
  // amendment and `registrationLayout`.
  const [restoredSizes] = useState<PaneSizes>(() => engine.getState().paneSizes);

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

  // `?? 0` is the not-yet-measured render, which draws no panel group at all;
  // `percentOf` answers with the fallback band for it, and for any width a
  // browser reports as zero.
  const width = groupWidth ?? 0;
  // The BANDS follow the observed width. `?? width` is the no-observer answer —
  // jsdom, an older WebView, or the render before the observer has delivered
  // anything — and it is the mount-time measurement, which is what every band
  // was derived from before `useElementWidth` existed. `??` rather than a
  // truthiness test because the floor in `useElementWidth` is 1, so a reported
  // width is never falsy, but `null` genuinely means "nothing observed".
  const bandWidth = observedWidth ?? width;

  // ==========================================================================
  // THE RE-FIT ON A WIDTH CHANGE (GitHub issue #23). See decision 1.
  // ==========================================================================
  // The group's imperative handle, for the one `setLayout` below.
  const groupRef = useRef<ImperativePanelGroupHandle | null>(null);
  // The band width the group last COMMITTED at, or `null` before a group has
  // existed. A report that arrives while `bandWidth` differs from it was caused
  // by the width change being committed right now — the library's own
  // constraint re-evaluation, or the re-fit below — and not by a person.
  const committedBandWidth = useRef<number | null>(null);
  // The band width of the commit IN PROGRESS, published before any layout
  // effect runs. It cannot be read from a closure: the library re-evaluates
  // constraints from pane 1's layout effect and reports on every panel from
  // there, before panes 2 and 3 have installed this render's `onResize` — so
  // their reports arrive through the PREVIOUS render's callbacks, whose
  // `bandWidth` is the old one. Found by "writes nothing to storage when only the
  // width changed" failing against the closure version. An insertion effect runs
  // in the mutation phase, ahead of every layout effect in the tree, which is
  // the one ordering that holds here; it writes a ref and schedules nothing.
  const liveBandWidth = useRef(bandWidth);
  useInsertionEffect(() => {
    liveBandWidth.current = bandWidth;
  }, [bandWidth]);
  // The group's layout as it stood before any width change moved it, and
  // whether a person arranged it. Both describe the CURRENT group membership
  // only, which is why an effect below clears the flag whenever pane 1 joins or
  // leaves the group.
  const sessionLayout = useRef<Record<PaneId, number>>({ ...restoredSizes });
  const isUserArranged = useRef(false);

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
    (
      pane: PaneId,
      size: number,
      previousSize: number | undefined,
      isWidthDriven: boolean,
    ): void => {
      if (isNavCollapsed || surface !== 'full') {
        return;
      }
      const known = announcedLayout.current;
      const isKnownChange = previousSize === known[pane];
      const next: Record<PaneId, number> = { ...known };
      next[pane] = size;
      announcedLayout.current = next;
      // A width change is LEARNED above and never WRITTEN: a person who only
      // resized their window has not chosen a layout, and writing the corrected
      // one would overwrite the layout they did choose. GitHub issue #23.
      if (!isKnownChange || isWidthDriven) {
        return;
      }
      // WHAT IS WRITTEN IS THE INTENT, NOT THE LIVE LAYOUT. After a width change
      // the live layout holds corrections — pane 1 lifted to its minimum, say —
      // and one divider moves only two panes, so writing the live layout would
      // save the correction of a pane nobody moved. `sessionLayout` holds the
      // panes this drag moved at their new size and every other pane at the size
      // the person chose — including across a collapse and re-expansion, where
      // the membership effect below puts the chosen record back over the
      // library's rebuilt shares. Found in review of the first #23 change:
      // narrowed to 800px, dragged divider 2, and a reload at 1000px opened pane
      // 1 at the 800px minimum.
      //
      // The record is the INTENT and is deliberately not clamped to the bands at
      // the width it is written at: doing so would save the correction again,
      // which is the defect above. Bands are applied where the record is READ —
      // `fitPaneLayout`, at mount and on every re-fit — so a pane chosen wider
      // than this width allows reopens in band. If the correction means the
      // intent no longer divides the whole, pane 3 takes the difference, so the
      // record still sums to 100.
      const intent = sessionLayout.current;
      const isWhole = Math.abs(intent.pane1 + intent.pane2 + intent.pane3 - 100) < 0.01;
      engine.setSlot('paneSizes', {
        pane1: clampPanePercent(intent.pane1),
        pane2: clampPanePercent(intent.pane2),
        pane3: clampPanePercent(isWhole ? intent.pane3 : 100 - intent.pane1 - intent.pane2),
      });
    },
    [engine, isNavCollapsed, surface],
  );

  /**
   * Every panel's `onResize`, and the one place a report is classified.
   *
   * A report caused by a width change is neither learned as the session layout
   * nor written: it is the correction, not the intent. Any other report is the
   * group's layout as it now stands, and one carrying a previous size is a
   * person moving a divider — the mount announcement is the only report with
   * none, and a membership change is cleared by the effect that follows it. See
   * decision 1.
   */
  const reportPaneSize = useCallback(
    (pane: PaneId, size: number, previousSize: number | undefined): void => {
      const committed = committedBandWidth.current;
      const isCorrection =
        committed !== null && committed !== liveBandWidth.current;
      // A mount report — no previous size — is the fitted layout, and when the
      // record holds a real choice that fit may be a CORRECTION of it (a record
      // chosen at 1000px opened at 800px mounts pane 1 lifted to its minimum).
      // `sessionLayout` is seeded from that record, so the report is not taken
      // into it. When the record is the engine's untouched default, the mount
      // fit is `PANE_PX` at this width, which IS the intent, and is learned.
      const isFittedChoice =
        previousSize === undefined && !isEngineDefaultLayout(engine.getState().paneSizes);
      if (!isCorrection && !isFittedChoice) {
        const next: Record<PaneId, number> = { ...sessionLayout.current };
        next[pane] = size;
        sessionLayout.current = next;
        isUserArranged.current = isUserArranged.current || previousSize !== undefined;
      }
      persistPaneSize(pane, size, previousSize, isCorrection);
    },
    [engine, persistPaneSize],
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

  // WHETHER PANE 1 IS A MEMBER OF THE GROUP THESE PERCENTAGES ARE HANDED TO,
  // which is not the same question as whether the shell is drawing chrome: a
  // collapsed pane 1 is a fixed 48px track outside the group (GitHub issue
  // #114), and on the extension surface it is in another document.
  const paneOneIsInGroup = showChrome && !isNavCollapsed;
  const bands = paneBandsAt(bandWidth);
  // The layout a panel is REGISTERED at: the record, or `PANE_PX` at the live
  // band width when nothing was chosen, held to the live bands.
  // `intentFromRecord` and `fitPaneLayout` carry the arithmetic and the reasons
  // for it — the rebase of a stored pane-2 share, pane 3 as the remainder, and
  // the pane-1 term that is zero when pane 1 is not in the group — and the
  // re-fit below calls the same two functions, which is what makes a live
  // resize and a reload agree.
  //
  // **The record is read as it stands NOW, not as it stood at mount.** The
  // library reads `defaultSize` only when a panel registers — at mount, and
  // when pane 1 joins or leaves the group — and rebuilds the whole group from
  // it then. With the mount snapshot here, a re-expansion rebuilt the
  // mount-time layout rather than the one the person had since chosen, the
  // screen showed that, and a reload showed the choice. Laying the record out
  // with `setLayout` after the rebuild was tried and failed in the browser
  // lane: the library rebuilds a second time on the render its own registration
  // forces, and that second rebuild overwrote it and was saved. Since no drag
  // re-registers a panel, the live record reaching `defaultSize` is never fed
  // back as the starting point of the drag that wrote it — the concern decision
  // 6 raises about binding it live.
  const registrationLayout = fitPaneLayout(
    intentFromRecord(engine.getState().paneSizes, paneOneIsInGroup, bandWidth),
    bands,
    paneOneIsInGroup,
  );

  // Pane 1 joining or leaving the group makes the library renormalise and report
  // on every panel. That is a new membership, not an arrangement: what a person
  // did to the previous membership's shares does not describe this one. A
  // LAYOUT effect, so it runs after the panels' own — which is where the library
  // reports — and before the re-fit below, in the same commit.
  //
  // The shares the library rebuilds are LEARNED by `reportPaneSize` like any
  // other report, and they are built from mount-time `defaultSize`, not from
  // what the person chose. So the chosen record is put back over them here: a
  // divider-2 drag after a re-expansion then saves the pane-1 width the person
  // chose, not the rebuilt one. A record holding the engine's untouched defaults
  // is not a choice (see `isEngineDefaultLayout`) and is not put back; the
  // learned layout, which is the pixel intent, stands.
  useLayoutEffect(() => {
    isUserArranged.current = false;
    const record = engine.getState().paneSizes;
    if (!isEngineDefaultLayout(record)) {
      sessionLayout.current = { ...record };
    }
  }, [engine, paneOneIsInGroup]);

  // THE RE-FIT. When the width the bands are derived from changes, the layout is
  // fitted again from what was ASKED for — the session layout a person arranged,
  // or else the persisted record exactly as a reload would read it — rather than
  // left as whatever the library's own re-clamp made of the previous width's
  // numbers. Nothing it causes is written; see `reportPaneSize`.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }
    const previous = committedBandWidth.current;
    if (previous !== null && previous !== bandWidth) {
      const session = sessionLayout.current;
      const intent: PaneIntent = isUserArranged.current
        ? { nav: session.pane1, list: session.pane2 }
        : intentFromRecord(engine.getState().paneSizes, paneOneIsInGroup, bandWidth);
      const fitted = fitPaneLayout(intent, paneBandsAt(bandWidth), paneOneIsInGroup);
      group.setLayout(
        paneOneIsInGroup ? [fitted.nav, fitted.list, fitted.detail] : [fitted.list, fitted.detail],
      );
    }
    committedBandWidth.current = bandWidth;
  }, [bandWidth, engine, paneOneIsInGroup]);

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
          <ExtensionNavigationTree
            extensionId={active.id}
            declared={active.blueprint.navigationTree}
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
        defaultSize={registrationLayout.list}
        minSize={bands.list.min}
        maxSize={bands.list.max}
        onResize={(size, previousSize) => {
          reportPaneSize('pane2', size, previousSize);
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
        defaultSize={registrationLayout.detail}
        minSize={bands.detail.min}
        onResize={(size, previousSize) => {
          reportPaneSize('pane3', size, previousSize);
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
                <PanelGroup
                  ref={groupRef}
                  id="shell-panes"
                  direction="horizontal"
                  className="flex min-w-0 flex-1"
                >
                  {isNavCollapsed || !showChrome ? null : (
                    <>
                      <Panel
                        id="pane1"
                        order={1}
                        className="min-h-0 min-w-0"
                        defaultSize={registrationLayout.nav}
                        minSize={bands.nav.min}
                        maxSize={bands.nav.max}
                        onResize={(size, previousSize) => {
                          reportPaneSize('pane1', size, previousSize);
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
