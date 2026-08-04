import type { ReactElement, ReactNode } from 'react';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { PaneId } from '../../core/types';

/**
 * ============================================================================
 * THE SHARED PANE SHELL: BORDER, OVERFLOW DISCIPLINE, AND A SLOT CONTRACT
 * ============================================================================
 * Every pane in the shell is this component. It owns three things and nothing
 * else, so that a pane's own code never has to re-decide any of them:
 *
 * BORDER. One pixel, `TOKEN_CLASS.paneBorder`, in every theme. A pane that
 * picked its own border colour would read as a rendering bug rather than as
 * branding.
 *
 * It used to be two declarations — `border-neutral-200` with a
 * `dark:border-neutral-800` beside it — and it is now one, because the token's
 * VALUE swaps on `[data-theme]` and there is nothing left for a variant to say.
 * That is also the change that makes it heavier: `border-neutral-200` measured
 * 1.26:1 against the pane it bounded and `--border-default` measures 3.95:1,
 * which is the 3:1 WCAG 1.4.11 asks of a control's visual boundary and roughly
 * three times the ink. Visible, intended, and recorded in `CHANGELOG.md`.
 *
 * OVERFLOW DISCIPLINE. This is the part that is easy to get wrong and expensive
 * to debug. The outer element is `overflow-hidden` and carries `min-w-0` and
 * `min-h-0`; the body is the ONLY scroll container. Without the `min-*` pair a
 * flex child refuses to shrink below its content — the automatic minimum size
 * rule — and a long unbreakable string in one pane pushes the whole row wider
 * than the viewport, which is exactly the horizontal page scrollbar ISSUE-002
 * forbids. With it, the pane clips and its body scrolls.
 *
 * THE SLOT CONTRACT. `header`, the body (`children`), `trailing` and `footer`
 * are four independent slots. A pane declares a header without declaring a
 * drawer, or a drawer without a header, and the scroll container stays attached
 * to the body either way. That is what lets pane 3 own "its own header region,
 * its own scroll container, and a utility drawer slot on its trailing edge"
 * without the pane having to rebuild the box each time.
 *
 * `footer` is the newest of the four and was three, not four, until GitHub
 * issue #110. It is the mirror of `header`: fixed, outside the scroll
 * container, below rather than above. It exists because pane 3's composer had
 * been the last CHILD of the scroll container, which meant it moved every time
 * the content it sat under changed length. A slot that owns chrome owns it for
 * its occupant too — this one draws the top border and the padding, so the
 * component handed to it must not draw them again.
 *
 * It is deliberately presentational: no context, no store, no registry. It
 * renders what it is handed. Pane composition — which extension owns pane 2,
 * whether the drawer is open — is `ShellLayout`'s decision, and keeping that out
 * of here is what lets ISSUE-004 reuse this box for the virtualized list.
 *
 * **It is not a fault boundary and does not contain a throwing child.** That
 * sentence is unchanged by ISSUE-004 and stays literally true: nothing in this
 * file catches anything, and a subtree handed to it as `children` that throws
 * during render throws straight through this component.
 *
 * What changed is WHO wraps it. `ShellLayout` now puts a
 * `src/components/error/FaultBoundary.tsx` around the children it hands every
 * `PaneWrapper` — pane 1 included — and a second one inside pane 2 and pane 3
 * around the extension subtree itself. The composition lives there rather than
 * here deliberately: a `PaneWrapper` that quietly contained its own children
 * would be a pane shell with a policy, and the border/overflow/slot contract
 * above is the whole of what this component is allowed to decide. See decision 5
 * in `ShellLayout.tsx`'s banner. *Test:*
 * `src/components/__tests__/ShellLayout.test.tsx` — "contains a throwing pane-2
 * view to pane 2, leaving the context bar and pane 3 interactive".
 * ============================================================================
 */

/**
 * Shared chrome for every pane: one 1px token border, in every theme.
 *
 * `text-[12px]` stays a literal on purpose. Padding and font size are the two
 * things this token set deliberately does not cover — the density scan in
 * `ShellLayout.test.tsx` parses them out of the class list, and
 * `typeSizeOffenders` cannot measure a `var()`. Tokenising type here would
 * silently stop that scan measuring anything.
 */
const PANE_CHROME =
  'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border ' +
  `${TOKEN_CLASS.paneBorder} ${TOKEN_CLASS.paneSurface} text-[12px] ${TOKEN_CLASS.paneText}`;

/** Divider between a slot and the body. Same token, one edge only. */
const SLOT_EDGE = TOKEN_CLASS.paneSlotEdge;

export interface PaneWrapperProps {
  /** Which shell pane this is. Published as `data-pane` for tests and CSS. */
  readonly paneId: PaneId;
  /**
   * Accessible name for the pane region.
   *
   * Required, and required in BOTH the expanded and the collapsed state of pane
   * 1: a 48px icon track with no accessible name is an unlabelled region to a
   * screen reader.
   */
  readonly label: string;
  /** Optional fixed header region, above the scroll container. */
  readonly header?: ReactNode;
  /** Optional utility slot on the pane's trailing edge, beside the body. */
  readonly trailing?: ReactNode;
  /**
   * Optional fixed footer region, BELOW the scroll container rather than inside
   * it. Symmetric with `header`, and it exists because the omnibox composer had
   * nowhere to dock: it scrolled with the ledger and came to rest wherever the
   * content happened to stop. GitHub issue #110.
   *
   * A caller that wants the thing to scroll with the content should keep
   * passing it as `children`. This slot is for a surface that must stay put.
   */
  readonly footer?: ReactNode;
  /** Extra classes for the pane box. Layout only — do not re-declare chrome. */
  readonly className?: string;
  /** The pane body. This — and only this — is the scroll container. */
  readonly children: ReactNode;
}

export function PaneWrapper({
  paneId,
  label,
  header,
  trailing,
  footer,
  className,
  children,
}: PaneWrapperProps): ReactElement {
  return (
    <section
      aria-label={label}
      data-pane={paneId}
      className={className === undefined ? PANE_CHROME : `${PANE_CHROME} ${className}`}
    >
      {header === undefined ? null : (
        <div
          data-pane-slot="header"
          className={`flex min-w-0 flex-none items-center gap-1 border-b p-1 ${SLOT_EDGE}`}
        >
          {header}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        {/*
          `flex flex-col` is load-bearing and is HALF of GitHub issue #110 — the
          `footer` slot below is the other half, and neither substitutes for the
          other. The row above is `flex-row`, so a child of the body using
          `flex-1` to fill VERTICALLY had no column flex parent to fill against
          and sized to its content instead. jsdom cannot see this: it does not
          lay out, and `getBoundingClientRect` returns 0x0, so 1,739 green tests
          said nothing about it.

          The guard is ONE named case, not the file: *Test:*
          `e2e/shell-layout.spec.ts` — "gives pane 3 a detail stack that reaches
          the bottom of the scroll container rather than stopping at its
          content". That precision was bought by a mutation probe. Reverting
          this class left the docked-footer case in the same file green, because
          the footer docks off the section's column and never asked anything of
          the body's. Citing the file would have claimed a guard this class does
          not have.
        */}
        <div
          data-pane-slot="body"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-1"
        >
          {children}
        </div>
        {trailing === undefined ? null : (
          <div
            data-pane-slot="drawer"
            className={`min-h-0 w-40 flex-none overflow-auto border-l p-1 ${SLOT_EDGE}`}
          >
            {trailing}
          </div>
        )}
      </div>
      {footer === undefined ? null : (
        <div
          data-pane-slot="footer"
          className={`flex min-w-0 flex-none items-center gap-1 border-t p-1 ${SLOT_EDGE}`}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
