import * as Tooltip from '@radix-ui/react-tooltip';
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { useBadgeCount, useNavMetric, useNavigationTree } from '../../core/ShellAPI';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { NavigationMetric, NavigationNode } from '../../core/types';
import { MetricGlyph } from '../ui/MetricGlyph';
import { resolveShellIcon } from '../ui/resolveShellIcon';

/**
 * PANE 1'S ROWS: ONE BUTTON, ONE STORE-BOUND NODE, AND THE TREE OF THEM.
 *
 * Split out of `ShellLayout.tsx` by GitHub issue #95 with no change to the DOM
 * any of them renders. Decisions 7 (badges) and 8 (metrics) of the banner in
 * `ShellLayout.tsx` govern this module and are not restated here.
 *
 * **Wave 3, W3-3 — the current-node treatment, the fallback identity tile
 * (R4/D-40) and the rail tooltip, `docs/design/WAVE3-PLAN.md`.** The three are
 * documented at their render sites below rather than here, so a reader sees
 * the rule beside the class it produces.
 *
 * `@radix-ui/react-tooltip` was a dependency with zero consumers before this
 * change — `grep -rn "react-tooltip" src/` found nothing outside
 * `package.json` on 2026-09-19. It is the same escape this file's sibling
 * `ContextBar.tsx` already uses for its overflow menu
 * (`@radix-ui/react-dropdown-menu`'s own `Portal`): the shell root and the
 * pane container above pane 1 are both `overflow-hidden`, so anything
 * positioned in place — `position: absolute`, inside that ancestor — has
 * nowhere to paint once it would cross the edge. This is the ribbon-overflow
 * class of defect `CLAUDE.md` names, and the fix is the same one: the content
 * is portalled to `document.body` and positioned by Radix's own Popper, which
 * defaults to `position: fixed` and therefore escapes every ancestor's
 * `overflow-hidden` rather than being clipped by it.
 */

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
   * `ShellLayout.tsx`'s banner. Every field on it is registry-validated, and
   * the only one this component's caller can have moved is `value`.
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
 * **Wave 3, W3-3: the fill is now `--accent-subtle`, not `--surface-selected`,
 * and the outline is gone.** `docs/design/WAVE3-PLAN.md`'s W3-3 row reads "Current
 * node: `--text-primary` on `--accent-subtle`", and `docs/design/REDESIGN-SPEC.md`
 * names both halves explicitly: the fill moves to the accent identity colour
 * (`TOKEN_CLASS.navCurrentSurface`, with `navCurrentText` naming the ink
 * explicitly rather than leaving it to inherit) and `navSelectedBorder` — the
 * full 1px outline that made a selected row read as an input field, finding #10
 * of the audit — is **deleted**, carrying the W3-2 reading of R7 ("no side
 * stripe, no outline") from rows to this tree. The rule and the weight are the
 * two channels that were already clearing WCAG 1.4.11 on their own and neither
 * moved: `TOKEN_CLASS.navSelectedRule` still names `--border-selected` through
 * the same inset `box-shadow`, and `aria-[current]:font-semibold` is unchanged.
 * The fill is still a hint only, never the indicator — the paragraph above's
 * argument for that did not depend on which colour the fill was.
 *
 * The rule and the fill are `TOKEN_CLASS.navSelectedRule` and
 * `navCurrentSurface`/`navCurrentText`, so there is one declaration per
 * affordance instead of a light one and a `dark:` twin. The ratios above are no
 * longer restated per theme here on purpose: they are measured for all three
 * themes, against every surface each token is drawn on, by
 * `design/check-contrast.mjs` and by `npm run check:tokens`. A number copied
 * into a comment is a number that goes stale silently, and this file had three
 * such paragraphs before the change that introduced tokens at all.
 *
 * The rule is an inset `box-shadow` rather than a left border. A border would
 * have to grow from 1px to 2px on selection and shift the label sideways by a
 * pixel each time the user moved between rows; an inset shadow paints inside the
 * padding box and moves nothing.
 *
 * `min-h-6` is the 24px WCAG 2.5.8 target-size floor. Measured before it was
 * added, these rows were 163.9 × 22 with 0px and 1px gaps between them, so the
 * spacing exception did not apply and they simply failed. Collapsed, the row is
 * `h-8 w-8` — the 32px square W3-3's rail asks for, inside the 48px track (see
 * `railWidth` at its one call site in `ShellLayout.tsx`) — which clears the same
 * floor with margin either side rather than sitting on it exactly.
 *
 * **THE FALLBACK IDENTITY TILE (R4, D-40).** A row with no declared icon used to
 * fall back to a bare monogram character sitting on whatever the button's own
 * background happened to be — the rest fill, the hover fill, or the current
 * fill, so the same letter read differently row to row for no reason connected
 * to its content. `docs/design/WAVE3-PLAN.md`: "a plugin with no manifest icon
 * gets a filled tile with its initial, drawn deliberately rather than as a
 * broken icon." The monogram branch below now paints its own fixed tile —
 * `identityTileSurface` (`--accent-subtle`) under `identityTileText`
 * (`--accent-text`) — independent of the button's own state, so a plain node's
 * glyph looks the same whether the row is at rest, hovered or current. It is
 * the one deliberate reuse of the accent pair for something that is not the
 * current-node state: both read as "this row's own identity", not as
 * selection, and nothing here conflates the two — the tile paints on EVERY
 * icon-less row, current or not, while `navCurrentSurface` paints only on the
 * `aria-current` row.
 *
 * **THE RAIL TOOLTIP (`docs/design/WAVE3-PLAN.md`, W3-3's e2e row).** Collapsed,
 * the label is not on the page as visible text — only as the `sr-only` span
 * below — so the row's own accessible name is its only clue for a sighted user
 * who does not zoom the accessibility tree. `Tooltip.Root` wraps the button
 * (via `Tooltip.Trigger asChild`, the same `asChild` composition
 * `ContextBar.tsx`'s overflow trigger already uses) and shows the row's label
 * on hover and on focus. **It shows the title alone, and says nothing false**:
 * the plan's own words are "the tooltip's shortcut text comes from
 * `describeHotkey`, which is step 6c's first item. Until 6c lands the tooltip
 * shows the title alone" — `describeHotkey` exists in `src/core/hotkeys.ts`
 * already, for `RibbonAction.hotkey`, but neither a `NavigationNode` nor a
 * `LEAPExtensionBlueprint` carries a hotkey field a rail tooltip could read one
 * from, so there is no shortcut this component could honestly print. The
 * native `title` attribute is dropped in the collapsed state specifically so
 * the two tooltips do not stack — a browser's own title tooltip after roughly a
 * second, Radix's after `delayDuration` — and kept in the expanded state, where
 * there is no rail tooltip to collide with it.
 */
export function ShellNavButton({
  label,
  icon,
  badgeCount,
  metric,
  isCollapsed,
  isCurrent,
  onSelect,
}: ShellNavButtonProps): ReactElement {
  const button = (
    <button
      type="button"
      aria-current={isCurrent ? 'true' : undefined}
      // Dropped in the collapsed state — see the rail-tooltip paragraph above
      // for why a second, native tooltip would stack on top of Radix's.
      title={isCollapsed ? undefined : label}
      onClick={onSelect}
      className={
        'flex min-h-6 items-center gap-1 rounded-sm border p-1 text-[12px] leading-none ' +
        'aria-[current]:font-semibold ' +
        `${TOKEN_CLASS.controlRestBorder} ` +
        `${TOKEN_CLASS.navCurrentSurface} ${TOKEN_CLASS.navCurrentText} ${TOKEN_CLASS.navSelectedRule} ` +
        `${TOKEN_CLASS.controlHoverBorder} ` +
        (isCollapsed ? 'relative h-8 w-8 justify-center' : 'w-full min-w-0 justify-start')
      }
    >
      {isCollapsed ? (
        icon === undefined ? (
          // THE FALLBACK IDENTITY TILE (R4, D-40). Its own fixed fill and ink,
          // independent of `aria-current` and of hover — see the docblock
          // above for why that independence is the point.
          <span
            aria-hidden="true"
            className={
              'flex h-full w-full items-center justify-center rounded-sm font-semibold ' +
              `${TOKEN_CLASS.identityTileSurface} ${TOKEN_CLASS.identityTileText}`
            }
          >
            {label.trim().slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <span aria-hidden="true" className="flex font-semibold">
            {/*
              A lookup, never an interpolation. `icon` is untrusted and reaches
              nothing but `Map.prototype.get`; the element that comes back is
              host-authored SVG. An unpublished key gets the host fallback.
            */}
            {resolveShellIcon(icon)}
          </span>
        )
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

  if (!isCollapsed) {
    return button;
  }

  // Collapsed only. `Tooltip.Provider` is required by Radix — `Tooltip.Root`
  // throws without one, `must be used within \`TooltipProvider\`` — and is
  // scoped to this one row rather than shared, so one row's hover timing
  // cannot be coupled to another's. `delayDuration` is left at Radix's own
  // 700ms default, since neither the plan nor `DESIGN.md` states an opinion
  // of its own to override it with.
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
        {/*
          Portalled to `document.body` — see the module docblock for why:
          the rail track and the shell root above it are both
          `overflow-hidden`, and content positioned in place there has
          nowhere to paint past their edges.
        */}
        <Tooltip.Portal>
          {/* `role="tooltip"` is Radix's own default here — no `aria-label`
              prop is passed, which is the one thing that would swap it out
              for a visually hidden label node instead. */}
          <Tooltip.Content
            side="right"
            sideOffset={8}
            collisionPadding={4}
            className={
              'z-50 rounded-sm px-2 py-1 text-[11px] leading-4 ' +
              `${TOKEN_CLASS.tooltipSurface} ${TOKEN_CLASS.tooltipElevation} ${TOKEN_CLASS.secondaryText}`
            }
          >
            {/*
              Title alone. See the docblock above: `describeHotkey` exists but
              nothing a rail row wraps carries a hotkey field it could read
              one from yet, so a shortcut column is step 6c's, not this one's.
            */}
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
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
 * move. See decision 7 in `ShellLayout.tsx`'s banner for the override rule and
 * for why the hook's render-phase `INVALID_ID` is not caught here.
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
  // See decision 8 in `ShellLayout.tsx`'s banner.
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
 *
 * **Wave 3, W3-3: a child level hangs off a 1px guide rule, not bare
 * indentation.** `docs/design/WAVE3-PLAN.md`: "children indent with a 1px guide
 * rule." Before this, `pl-2` alone moved a child right with nothing marking
 * that it belonged to the row above it — indentation read as accidental
 * whitespace at a glance, which is the same "is this deliberate" question
 * `REDESIGN-SPEC.md` finding #10 raises about the tree generally. The indent
 * itself widens to `pl-3` so the rule has room to read as a line and not as a
 * shadow of the text beside it, and the rule is `TOKEN_CLASS.navGuideRule`
 * (`--border-subtle`) — the decorative tier, since it marks structure and
 * carries no state of its own.
 */
export function NavigationTree({
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
            <div className={`border-l pl-3 ${TOKEN_CLASS.navGuideRule}`}>
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

interface ExtensionNavigationTreeProps extends Omit<NavigationTreeProps, 'nodes'> {
  /** The tree the extension's registered blueprint declared. */
  readonly declared: readonly NavigationNode[];
}

/**
 * The foreground extension's tree as it stands now: the replacement it last set
 * through `IShellAPI.setNavigationTree`, or — when it has set none — the tree
 * its blueprint declared. ADR-0006 decision 8, GitHub issue #16.
 *
 * Subscribes, so a replacement re-renders pane 1 without a registry change.
 * *Tests:* `src/components/__tests__/ShellLayoutBadges.test.tsx` — "renders the
 * tree an extension set at runtime, and a cleared badge falls back to the
 * declared count". That is DOM text in jsdom, not a claim about layout.
 */
export function ExtensionNavigationTree({
  declared,
  ...tree
}: ExtensionNavigationTreeProps): ReactElement {
  const replaced = useNavigationTree(tree.extensionId);
  return <NavigationTree {...tree} nodes={replaced ?? declared} />;
}
