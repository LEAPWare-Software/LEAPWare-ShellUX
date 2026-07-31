import type { ReactElement, ReactNode } from 'react';
import type { PaneId } from '../../core/types';

/**
 * ============================================================================
 * THE SHARED PANE SHELL: BORDER, OVERFLOW DISCIPLINE, AND A SLOT CONTRACT
 * ============================================================================
 * Every pane in the shell is this component. It owns three things and nothing
 * else, so that a pane's own code never has to re-decide any of them:
 *
 * BORDER. One pixel, `border-neutral-200` in light and `border-neutral-800` in
 * dark, exactly as the density contract in `DEVELOPER.md` requires. A pane that
 * picked its own border colour would read as a rendering bug rather than as
 * branding.
 *
 * OVERFLOW DISCIPLINE. This is the part that is easy to get wrong and expensive
 * to debug. The outer element is `overflow-hidden` and carries `min-w-0` and
 * `min-h-0`; the body is the ONLY scroll container. Without the `min-*` pair a
 * flex child refuses to shrink below its content — the automatic minimum size
 * rule — and a long unbreakable string in one pane pushes the whole row wider
 * than the viewport, which is exactly the horizontal page scrollbar ISSUE-002
 * forbids. With it, the pane clips and its body scrolls.
 *
 * THE SLOT CONTRACT. `header`, the body (`children`) and `trailing` are three
 * independent slots. A pane declares a header without declaring a drawer, or a
 * drawer without a header, and the scroll container stays attached to the body
 * either way. That is what lets pane 3 own "its own header region, its own
 * scroll container, and a utility drawer slot on its trailing edge" without the
 * pane having to rebuild the box each time.
 *
 * It is deliberately presentational: no context, no store, no registry. It
 * renders what it is handed. Pane composition — which extension owns pane 2,
 * whether the drawer is open — is `ShellLayout`'s decision, and keeping that out
 * of here is what lets ISSUE-004 reuse this box for the virtualized list.
 *
 * **It is not a fault boundary and does not contain a throwing child.** A pane
 * whose subtree throws during render still unmounts the shell; `FaultBoundary`
 * is ISSUE-004. Stated here so that nobody reads "pane shell" as "pane
 * containment".
 * ============================================================================
 */

/** Shared chrome for every pane: 1px neutral border in both themes. */
const PANE_CHROME =
  'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border ' +
  'border-neutral-200 bg-white text-[12px] text-neutral-900 ' +
  'dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100';

/** Divider between a slot and the body. Same 1px tokens, one edge only. */
const SLOT_EDGE = 'border-neutral-200 dark:border-neutral-800';

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
        <div data-pane-slot="body" className="min-h-0 min-w-0 flex-1 overflow-auto p-1">
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
    </section>
  );
}
