import type { ReactElement } from 'react';
import type { CommandRegistry } from '../../core/commands/CommandRegistry';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { RibbonContext } from '../../core/types';
import { CommandButton } from './commandListItem';

/**
 * ============================================================================
 * THE FLOATING TOOLBAR. SELECTION-TRIGGERED, PANE 3 ONLY, AND IT SUPPLEMENTS.
 * ============================================================================
 * It appears when something is selected and it disappears when nothing is. It
 * never replaces the context bar: a command that is only reachable from a
 * transient surface is a command a user cannot find twice.
 *
 * **Pane 3 only, and that is a topology decision rather than a layout
 * preference.** A floating toolbar positions itself against a DOM selection, and
 * a DOM selection exists in ONE document. Under the plan's per-pane process
 * split, host chrome and pane 3 are different documents, so a host-owned floating
 * toolbar would be positioning against a selection it cannot see. It therefore
 * lives inside the pane-3 subtree, which is also why this is the one surface for
 * which `isVisible` — a closure that cannot cross a process boundary — remains
 * the appropriate tier rather than a legacy one. See `Command.when`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 *  - It **positions nothing yet**, and says so rather than pretending. jsdom has
 *    no layout engine, `getBoundingClientRect` answers 0×0, and there is no
 *    `Selection` to anchor to; a coordinate computed here would be untested
 *    arithmetic asserted by nothing. It docks to the top of its container, which
 *    is honest and correct at every width, and anchoring to a real range is
 *    tracked work for the phase that has a browser lane for pane 3.
 *  - It **runs no predicate and calls no handler directly** — `CommandRegistry`
 *    does both, through `src/core/command.ts`.
 *  - It **renders no plug-in string** — `commandListItem.tsx` does.
 *  - It attaches no listener and names no key event.
 * ============================================================================
 */

export interface FloatingToolbarProps {
  readonly registry: CommandRegistry;
  readonly context: Readonly<RibbonContext>;
}

/**
 * The selection-triggered command strip.
 *
 * Returns `null` — not an empty container — when there is no selection or no
 * command wants this surface. An empty box with a border is a control the user
 * has to learn to ignore, and an `aria-label`led region containing nothing is
 * noise a screen reader still announces.
 */
export function FloatingToolbar({ registry, context }: FloatingToolbarProps): ReactElement | null {
  if (context.selectedItemIds.length === 0) {
    return null;
  }
  const entries = registry
    .listForSurface('floating-toolbar', context)
    .filter((entry) => entry.source === 'extension');
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      role="toolbar"
      aria-label="Selection commands"
      data-shell-region="floating-toolbar"
      className={
        'flex w-full flex-none flex-nowrap items-center gap-1 overflow-x-auto ' +
        'overflow-y-hidden [contain:paint] rounded-sm border p-1 text-[12px] ' +
        `${TOKEN_CLASS.menuBorder} ${TOKEN_CLASS.menuSurface} ${TOKEN_CLASS.menuText} ` +
        TOKEN_CLASS.menuElevation
      }
    >
      {entries.map((entry) => (
        <CommandButton key={entry.key} entry={entry} className="max-w-[9rem] flex-none" />
      ))}
    </div>
  );
}
