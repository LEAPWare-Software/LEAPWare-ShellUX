import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { useBadgeCount, useNavMetric } from '../../core/ShellAPI';
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
export function ShellNavButton({
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
            <>{resolveShellIcon(icon)}</>
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
