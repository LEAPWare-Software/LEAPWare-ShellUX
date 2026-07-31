import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ExtensionHostBoundary, useActivation } from '../../core/ActivationContext';
import type { ActiveExtension } from '../../core/ActivationContext';
import { useRegistry, useRegistryRevision } from '../../core/RegistryContext';
import { useShellContext, useShellStore } from '../../core/ShellAPI';
import type { NavigationNode, RibbonContext } from '../../core/types';
import { RibbonToolbar } from '../ui/RibbonToolbar';
import type { HostRibbonAction, RibbonExtensionActions } from '../ui/RibbonToolbar';
import { PaneWrapper } from './PaneWrapper';

/**
 * ============================================================================
 * THE THREE-PANE SHELL. FOUR DECISIONS WORTH ARGUING WITH BEFORE CHANGING.
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
 *    **The measurement is not repeated.** There is no observer here. A later
 *    viewport change rescales the panes proportionally and leaves the
 *    percentage minimums where they were, which is predictable and — by the
 *    flex-ratio argument above — still cannot overflow; re-deriving pixel
 *    minimums live belongs with the persistence work in ISSUE-003, which has to
 *    answer the same question for restored sizes. When the width is
 *    unmeasurable — 0, as it is in jsdom — `percentOf` falls back to
 *    `PANE_FALLBACK_PERCENT` rather than dividing by zero.
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
 * 3. DIVIDER KEYBOARD OPERATION IS THE LIBRARY'S, NOT OURS.
 *    `PanelResizeHandle` renders `role="separator"` with `tabIndex={0}` and
 *    implements the window-splitter keyboard pattern itself. The host attaches
 *    no listener of its own — there is none anywhere under `src/`, pinned by
 *    "finds no listener registration and no key-event name in any module under
 *    src/" in `src/__tests__/noEventListener.test.ts`. Hotkey DISPATCH remains
 *    Phase 2; nothing here routes a chord to an action.
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
 * NOT HERE, DELIBERATELY: persistence of sizes and collapse state (ISSUE-003),
 * row virtualization and per-pane fault boundaries (ISSUE-004). A plug-in view
 * that throws during render still takes the shell down; nothing in this file
 * catches it, and `FaultBoundary` is the component that will.
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

interface ShellNavButtonProps {
  /** UNTRUSTED plug-in text. Rendered as a text node in both pane-1 states. */
  readonly label: string;
  /** Registry-validated non-negative integer, or `undefined` for no badge. */
  readonly badgeCount: number | undefined;
  readonly isCollapsed: boolean;
  readonly isCurrent: boolean;
  readonly onSelect: () => void;
}

/**
 * One selectable row in pane 1, in whichever of the two states pane 1 is in.
 *
 * Collapsed, the row becomes a 32px square showing a monogram derived from the
 * label — and the label itself stays in the accessible tree as an `sr-only` text
 * node rather than being dropped. That is the "accessible names preserved" half
 * of the 48px icon track: the same `getByRole('button', { name })` query finds
 * the same button in both states.
 *
 * THE SELECTED STATE IS A RULE AND A WEIGHT, NOT ONLY A FILL. `aria-current` was
 * always set, so a screen-reader user was always told which extension was
 * active. A sighted user was not: `bg-neutral-100` on white is 1.09:1 and the
 * `border-neutral-200` beside it 1.26:1, against the 3:1 that WCAG 1.4.11 asks
 * of a non-text state indicator. Both are far below it, and no fill reaches 3:1
 * against white without going dark enough to read as a different control
 * entirely. So the fill stays — it is a pleasant hint for anyone who can see it —
 * and the state is actually CARRIED by two things that clear the bar on their
 * own: a 2px leading rule at `neutral-500` (4.74:1 on white, 4.35:1 on the fill)
 * or `neutral-400` in dark (7.85:1 on `neutral-950`), and a semibold label.
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
  badgeCount,
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
        'border-transparent aria-[current]:border-neutral-200 ' +
        'aria-[current]:bg-neutral-100 aria-[current]:font-semibold ' +
        'aria-[current]:shadow-[inset_2px_0_0_0_theme(colors.neutral.500)] ' +
        'hover:border-neutral-200 ' +
        'dark:aria-[current]:border-neutral-800 dark:aria-[current]:bg-neutral-900 ' +
        'dark:aria-[current]:shadow-[inset_2px_0_0_0_theme(colors.neutral.400)] ' +
        'dark:hover:border-neutral-800 ' +
        (isCollapsed ? 'relative h-8 w-8 justify-center' : 'w-full min-w-0 justify-start')
      }
    >
      {isCollapsed ? (
        <span aria-hidden="true" className="font-semibold">
          {label.trim().slice(0, 1).toUpperCase()}
        </span>
      ) : null}
      <span className={isCollapsed ? 'sr-only' : 'truncate'}>{label}</span>
      {badgeCount === undefined ? null : (
        <span
          className={
            'flex-none rounded-sm bg-neutral-200 px-1 text-[11px] leading-4 ' +
            'dark:bg-neutral-800 ' +
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

interface NavigationTreeProps {
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
  nodes,
  activeNodeId,
  isCollapsed,
  onSelect,
}: NavigationTreeProps): ReactElement {
  return (
    <ul className={isCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-px'}>
      {nodes.map((node) => (
        <li key={node.id} className="min-w-0">
          <ShellNavButton
            label={node.label}
            badgeCount={node.badgeCount}
            isCollapsed={isCollapsed}
            isCurrent={activeNodeId === node.id}
            onSelect={() => {
              onSelect(node.id);
            }}
          />
          {isCollapsed || node.children === undefined ? null : (
            <div className="pl-2">
              <NavigationTree
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
  readonly context: Readonly<RibbonContext>;
}

/** A plug-in view, inside the boundary the host is required to wrap it in. */
function ExtensionPane({ active, pane, context }: ExtensionPaneProps): ReactElement {
  const View = active.blueprint.views[pane];
  return (
    <ExtensionHostBoundary extensionId={active.id}>
      <View shell={active.shell} context={context} />
    </ExtensionHostBoundary>
  );
}

/**
 * Body text for a pane with nothing to show.
 *
 * `dark:text-neutral-400` is not decoration. `text-neutral-500` is `#737373`,
 * and every one of these sits inside a `PaneWrapper`, whose dark background is
 * `neutral-950` (`#0a0a0a`) — 4.18:1, under the 4.5:1 that WCAG 1.4.3 requires
 * of 12px body text. `neutral-400` on the same background is 7.85:1. The LIGHT
 * value is deliberately left alone: `neutral-400` on white is 2.52:1 and would
 * trade one failure for a worse one.
 */
function EmptyPane({ children }: { readonly children: string }): ReactElement {
  return (
    <p className="p-1 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">{children}</p>
  );
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
 * COLOUR. `bg-neutral-200` was the SAME token as the 1px border on the panes
 * either side of it, so the divider did not read as a control at all — it read
 * as one more pane border, at 1.26:1 against the panes it separates. WCAG 1.4.11
 * wants 3:1 for a control's visual boundary. `neutral-500` is 4.74:1 on white
 * and 4.54:1 on the `neutral-50` behind the group; `neutral-400` in dark is
 * 7.85:1 on `neutral-950`. The hover and drag states move AWAY from the page
 * background in each theme — darker in light, lighter in dark — which is why
 * they are not simply the old values.
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
        'w-1 flex-none cursor-col-resize bg-neutral-500 outline-none ' +
        'hover:bg-neutral-700 focus-visible:bg-neutral-700 ' +
        'data-[resize-handle-state=drag]:bg-neutral-700 ' +
        'dark:bg-neutral-400 dark:hover:bg-neutral-200 ' +
        'dark:focus-visible:bg-neutral-200 ' +
        'dark:data-[resize-handle-state=drag]:bg-neutral-200'
      }
    />
  );
}

/** The assembled shell: ribbon above three horizontally resizable panes. */
export function ShellLayout(): ReactElement {
  const registry = useRegistry();
  // The revision is subscribed to, not read. Its value carries no meaning; what
  // it announces is that the registry's contents moved, which is exactly when
  // the extension list below has to be re-read. Same reasoning as the sweep
  // effect in `ShellHostProvider`.
  useRegistryRevision();
  const activation = useActivation();
  const store = useShellStore();
  const context = useShellContext();

  const [groupWidth, setGroupWidth] = useState<number | null>(null);
  const [isNavCollapsed, setNavCollapsed] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);

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

  const selectNavNode = useCallback(
    (nodeId: string): void => {
      // Registry-validated ids only — every node in a stored blueprint passed
      // `EXTENSION_ID_PATTERN` — so this cannot be rejected for its argument.
      store.patchContext({ activeNavNodeId: nodeId });
    },
    [store],
  );

  const extensions = registry.listExtensions();
  const active = activation.getActive();

  // `?? 0` is the not-yet-measured render, which draws no panel group at all;
  // `percentOf` answers with the fallback band for it, and for any width a
  // browser reports as zero.
  const width = groupWidth ?? 0;
  const navDefaultPercent = percentOf(
    PANE_PX.navDefault,
    width,
    PANE_FALLBACK_PERCENT.navDefault,
  );
  const listDefaultPercent = percentOf(
    PANE_PX.listDefault,
    width,
    PANE_FALLBACK_PERCENT.listDefault,
  );
  // Declared rather than left implicit: the library warns about a panel with no
  // `defaultSize`, and the remainder is what pane 3 would have been given anyway.
  // It is floored at the pane's own minimum so that two wide defaults cannot ask
  // for a negative share.
  const detailDefaultPercent = Math.max(
    percentOf(PANE_PX.detailMin, width, PANE_FALLBACK_PERCENT.detailMin),
    100 - navDefaultPercent - listDefaultPercent,
  );

  const hostActions: readonly HostRibbonAction[] = [
    {
      id: 'host-toggle-navigation',
      label: isNavCollapsed ? 'Expand navigation' : 'Collapse navigation',
      icon: 'navigation',
      onSelect: () => {
        setNavCollapsed((collapsed) => !collapsed);
      },
    },
    {
      id: 'host-toggle-drawer',
      label: isDrawerOpen ? 'Hide utility drawer' : 'Show utility drawer',
      icon: 'drawer',
      onSelect: () => {
        setDrawerOpen((open) => !open);
      },
    },
    {
      id: 'host-close-extension',
      label: 'Close extension',
      icon: 'close',
      isDisabled: active === null,
      onSelect: () => {
        activation.blur();
      },
    },
  ];

  const ribbonExtension: RibbonExtensionActions | null =
    active === null ? null : { actions: active.blueprint.ribbonActions, shell: active.shell };

  const navigation = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className={
            isNavCollapsed
              ? 'sr-only'
              : 'px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'
          }
        >
          Extensions
        </h2>
        <ul className={isNavCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-px'}>
          {extensions.map((extension) => (
            <li key={extension.id} className="min-w-0">
              <ShellNavButton
                label={extension.name}
                badgeCount={undefined}
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
                : 'px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'
            }
          >
            Navigation
          </h2>
          <NavigationTree
            nodes={active.blueprint.navigationTree}
            activeNodeId={context.activeNavNodeId}
            isCollapsed={isNavCollapsed}
            onSelect={selectNavNode}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      data-shell-region="root"
      className={
        'flex h-full min-h-0 w-full flex-col overflow-hidden bg-neutral-50 ' +
        'text-[12px] text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100'
      }
    >
      <RibbonToolbar hostActions={hostActions} extension={ribbonExtension} context={context} />
      <div
        data-shell-region="panes"
        className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
      >
        {isNavCollapsed ? (
          <div
            data-shell-region="nav-track"
            className="flex-none"
            style={{ width: `${PANE_PX.navCollapsed}px` }}
          >
            <PaneWrapper paneId="pane1" label="Navigation">
              {navigation}
            </PaneWrapper>
          </div>
        ) : null}
        <div ref={measureGroup} className="flex min-h-0 min-w-0 flex-1">
          {groupWidth === null ? null : (
            <PanelGroup id="shell-panes" direction="horizontal" className="flex min-w-0 flex-1">
              {isNavCollapsed ? null : (
                <>
                  <Panel
                    id="pane1"
                    order={1}
                    className="min-h-0 min-w-0"
                    defaultSize={navDefaultPercent}
                    minSize={percentOf(PANE_PX.navMin, width, PANE_FALLBACK_PERCENT.navMin)}
                    maxSize={percentOf(PANE_PX.navMax, width, PANE_FALLBACK_PERCENT.navMax)}
                  >
                    <PaneWrapper
                      paneId="pane1"
                      label="Navigation"
                      header={<span className="truncate font-semibold">Navigation</span>}
                    >
                      {navigation}
                    </PaneWrapper>
                  </Panel>
                  <ShellResizeHandle label="Resize the navigation pane" />
                </>
              )}
              <Panel
                id="pane2"
                order={2}
                className="min-h-0 min-w-0"
                defaultSize={listDefaultPercent}
                minSize={percentOf(PANE_PX.listMin, width, PANE_FALLBACK_PERCENT.listMin)}
                maxSize={percentOf(PANE_PX.listMax, width, PANE_FALLBACK_PERCENT.listMax)}
              >
                <PaneWrapper
                  paneId="pane2"
                  label="List"
                  header={<span className="truncate font-semibold">List</span>}
                >
                  {active === null ? (
                    <EmptyPane>Select an extension to fill this pane.</EmptyPane>
                  ) : (
                    <ExtensionPane active={active} pane="pane2" context={context} />
                  )}
                </PaneWrapper>
              </Panel>
              <ShellResizeHandle label="Resize the list pane" />
              <Panel
                id="pane3"
                order={3}
                className="min-h-0 min-w-0"
                defaultSize={detailDefaultPercent}
                minSize={percentOf(PANE_PX.detailMin, width, PANE_FALLBACK_PERCENT.detailMin)}
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
                        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                          Utilities
                        </h2>
                        <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
                          Reserved for extension-supplied utilities.
                        </p>
                      </div>
                    ) : undefined
                  }
                >
                  {active === null ? (
                    <EmptyPane>No extension is active, so there is nothing to detail.</EmptyPane>
                  ) : (
                    <ExtensionPane active={active} pane="pane3" context={context} />
                  )}
                </PaneWrapper>
              </Panel>
            </PanelGroup>
          )}
        </div>
      </div>
    </div>
  );
}
