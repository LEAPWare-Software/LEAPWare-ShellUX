import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactElement } from 'react';
import type { CommandRegistry } from '../../core/commands/CommandRegistry';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { RibbonContext } from '../../core/types';
import { OVERFLOW_ICON } from '../ui/shellIcons';
import { CommandButton, CommandMenuItem } from './commandListItem';

/**
 * ============================================================================
 * THE 32px CONTEXT BAR. IT REPLACES THE RIBBON AND IT INHERITS THE RIBBON'S FIXES.
 * ============================================================================
 * The ribbon is deleted — plan §11 item 1, "not classic, not simplified, not our
 * own take" — and this is what stands where it stood, at roughly a third of the
 * vertical cost. What it must NOT do is re-lose what the ribbon had learned.
 *
 * ---------------------------------------------------------------------------
 * THE 2026-07-31 ACCESSIBILITY AUDIT FOUND EIGHT BLOCKERS. HERE IS WHERE EACH
 * ONE LIVES NOW, AND THE TEST THAT HOLDS IT.
 * ---------------------------------------------------------------------------
 * Enumerated from the list in `docs/accessibility.md` (in `README.md` until
 * 2026-09-18) rather than reconstructed from the old
 * component, because picking eight by inference is how one of them is lost.
 *
 *  1. **The overflow menu was clipped to zero height** by two `overflow-hidden`
 *     ancestors — invisible and unclickable, not merely awkward. It is portalled
 *     under `document.body`, outside every clipping ancestor by construction.
 *     *Test:* "renders the menu outside the context bar, which is what un-clips
 *     it".
 *  2. **Activating a menu item dropped focus onto `document.body`**, so the next
 *     Tab restarted from the top of the document (WCAG 2.4.3). Focus returns to
 *     the trigger however the menu closed. *Tests:* "returns focus to the trigger
 *     after an item is activated, not to document.body" and "closes on Escape and
 *     puts focus back on the trigger".
 *  3. **`role="menu"` promised an interaction model that did not exist** — arrows
 *     did nothing, Escape did not close, focus never entered, an outside click
 *     left it open. Screen readers switch to application mode inside a menu and
 *     hand the arrow keys to the page, so the role actively misled the user. The
 *     full menu-button pattern is Radix's and is real. *Tests:* the whole of
 *     "ContextBar — the overflow menu keyboard model".
 *  4. **The menu is deliberately not modal**, so opening it does not hide the
 *     rest of the shell from assistive technology. *Test:* "does not modally hide
 *     the rest of the shell while the menu is open".
 *  5. **`aria-controls` dangled at a non-existent id** while the menu was shut.
 *     *Test:* "advertises aria-controls only while the menu exists, so the id
 *     never dangles".
 *  6. **An unavailable command used the native `disabled` attribute**, which
 *     removes it from the tab order entirely. It is `aria-disabled` plus a guard,
 *     in `commandListItem.tsx` so all four surfaces inherit it. *Tests:* "marks an
 *     unavailable command aria-disabled rather than removing it from the tab
 *     order, on every surface" in `commandSurfaces.test.tsx`, and "leaves a
 *     disabled menu item focusable, announced, and inert" here.
 *  7. **Contrast and target size in the shell chrome.** The half this surface
 *     owns is the 24px minimum target — `min-h-6` in `COMMAND_ROW_CHROME`.
 *     *Test:* "gives every context-bar control a 24px minimum height". The other
 *     half of finding 7 is `ShellLayout`'s and stays there.
 *  8. **A badge count folded a bare digit into a button's accessible name**, and
 *     dividers were not reported as vertical separators. Both are `ShellLayout`'s
 *     and neither moved.
 *
 * Findings 7 and 8 are shell-wide rather than this surface's, which is why this
 * component's own list is six and the audit's is eight. Saying "all eight are
 * here" would be the wide claim ADR-0001 Amendment G exists to stop.
 *
 * ---------------------------------------------------------------------------
 * AND THE THREE PROPERTIES THAT WERE NOT AUDIT FINDINGS AND ARE JUST AS EASY TO LOSE
 * ---------------------------------------------------------------------------
 *  - **`INLINE_ACTION_LIMIT`.** A COUNT, not a measured width. Measuring means
 *    observing the element on every layout change, which is a live subscription
 *    this surface does not need: what is actually required is that the bar never
 *    grows a second row and never pushes the panes down, and a fixed inline count
 *    guarantees a single row on every viewport without measuring anything. The
 *    cost is that a wide monitor could have shown a fifth command inline.
 *  - **`overflow-x-auto` with `overflow-y-hidden`.** A count alone is not enough
 *    at a narrow viewport. Four inline commands plus three host commands do not
 *    fit in 320 CSS pixels however few of them there are, and while the row
 *    clipped rather than scrolled they were simply gone — unreachable by any
 *    input, with no scrollbar anywhere in the ancestor chain to say so. WCAG
 *    1.4.10 does not permit that. The y-axis stays clipped so the bar cannot grow
 *    downward into the panes; the x-axis is the only one that scrolls. Both sides
 *    are `flex-none`, because a shrinkable side absorbs the overflow by squashing
 *    its own buttons to nothing instead of letting the row scroll.
 *  - **`[contain:paint]` IS LOAD-BEARING AND IS NOT A TIDY-UP.** Without it, at
 *    320 CSS px the row's overflowing content leaks into the VIEWPORT's
 *    scrollable area: `window.scrollX` could be driven to 376 and
 *    `documentElement.scrollWidth` read 696 against a 320 client width. There is
 *    no visible page scrollbar, because `body { overflow: hidden }` in
 *    `src/index.css` propagates to the viewport and hides it — which makes the
 *    leak worse rather than better, since the page could be scrolled sideways by
 *    keyboard or by assistive technology with nothing on screen to say it had
 *    moved or how to get back. Measured in Chrome 150: `contain: paint` takes it
 *    to `scrollX = 0` and `documentElement.scrollWidth = 320` while the bar still
 *    scrolls its full width and every control stays reachable. `html { overflow:
 *    hidden }` was tried first and does NOT fix it — hence a measurement rather
 *    than a guess.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COMPONENT DOES NOT DO
 * ---------------------------------------------------------------------------
 *  - It is **not a sandbox**. ADR-0001 "No sandbox" and Amendment E still hold.
 *  - It **runs no predicate and calls no handler directly.** Both belong to
 *    `CommandRegistry`, which runs them through `src/core/command.ts`. This
 *    component receives entries and renders them.
 *  - It **dispatches no keyboard shortcut, and it does advertise one.** The
 *    attribute is emitted by `commandListItem.tsx`, on exactly the commands
 *    `useHotkeyDispatch` will really fire, and never on a host command. This
 *    module attaches nothing and names no key event; pinned by "finds no listener
 *    registration in any module outside the hotkey-dispatch allowlist" and "finds
 *    no key-event name in any module outside the key-event allowlist" in
 *    `src/__tests__/noEventListener.test.ts`, neither of whose allowlists names
 *    this file. Radix's key handling lives in `node_modules`, and that scan has
 *    never claimed to cover it: its own docblock states the limit, under the
 *    heading What is not asserted, as a handler installed by a third-party module
 *    `src/` merely imports.
 *  - It contains **no error boundary**. `ShellLayout` puts one around it.
 * ============================================================================
 */

/**
 * How many contextual commands stay on the bar before the rest move into the
 * overflow menu. See the banner for why this is a count and not a measurement.
 */
export const INLINE_ACTION_LIMIT = 4;

/** The bar's height, as the plan specifies it: 32 CSS pixels. */
export const CONTEXT_BAR_HEIGHT_PX = 32;

export interface ContextBarProps {
  /** The one registry. Both sides of the bar are projections of it. */
  readonly registry: CommandRegistry;
  /** The context every predicate and every expression is evaluated against. */
  readonly context: Readonly<RibbonContext>;
}

/**
 * The shell's context bar: host commands left, the foreground extension's
 * contextual commands right.
 *
 * `role="toolbar"` with each button individually tabbable, rather than the
 * roving-tabindex toolbar pattern. The roving pattern needs an arrow-key handler;
 * Tab-through is the honest description of what this does, and WAI-ARIA words
 * descendant focus management for `toolbar` as a SHOULD rather than a MUST. That
 * is the one place this component keeps a role whose optional half it does not
 * implement, and it is kept knowingly — see audit finding 3 for what happens when
 * a role's promises are not kept.
 */
export function ContextBar({ registry, context }: ContextBarProps): ReactElement {
  // Projected on every render, against the context as it is right now. The
  // registry has already run `isVisible` and `when`, so the overflow split works
  // on the VISIBLE set: a command hidden by its predicate must not occupy an
  // inline slot and push a visible one into the menu.
  const offered = registry.listForSurface('context-bar', context);
  const hostEntries = offered.filter((entry) => entry.source === 'host');
  const extensionEntries = offered.filter((entry) => entry.source === 'extension');
  const inline = extensionEntries.slice(0, INLINE_ACTION_LIMIT);
  const overflow = extensionEntries.slice(INLINE_ACTION_LIMIT);

  return (
    <div
      role="toolbar"
      aria-label="Shell commands"
      data-shell-region="context-bar"
      style={{ minHeight: `${String(CONTEXT_BAR_HEIGHT_PX)}px` }}
      className={
        'flex w-full flex-none flex-nowrap items-center justify-between gap-1 ' +
        'overflow-x-auto overflow-y-hidden [contain:paint] border-b p-1 text-[12px] ' +
        `${TOKEN_CLASS.ribbonBorder} ${TOKEN_CLASS.ribbonSurface} ${TOKEN_CLASS.ribbonText}`
      }
    >
      <div data-command-side="host" className="flex flex-none flex-nowrap items-center gap-1">
        {hostEntries.map((entry) => (
          <CommandButton key={entry.key} entry={entry} className="max-w-[9rem] flex-none" />
        ))}
      </div>

      <div
        data-command-side="extension"
        className="flex flex-none flex-nowrap items-center justify-end gap-1"
      >
        {inline.map((entry) => (
          <CommandButton key={entry.key} entry={entry} className="max-w-[9rem] flex-none" />
        ))}
        {overflow.length === 0 ? null : (
          /*
            `modal={false}` — the one Radix default this component overrides, and
            audit finding 4. A modal dropdown marks the rest of the document
            `aria-hidden` and sets `pointer-events: none` on the body while it is
            open, which is right for a dialog and wrong for a toolbar menu: the
            bar's other commands, the navigation tree and both plug-in panes would
            all vanish from the accessibility tree because four contextual
            commands did not fit on one row. Nothing here is modal in the user's
            mind, so nothing here is modal in the DOM. Escape, outside-click
            dismissal and focus-return to the trigger all still apply.
          */
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                title="More actions"
                className={
                  'flex min-h-6 flex-none items-center gap-1 rounded-sm border p-1 ' +
                  'text-[12px] leading-none ' +
                  `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.ribbonText} ` +
                  TOKEN_CLASS.controlHoverBorder
                }
              >
                {OVERFLOW_ICON}
                <span className="sr-only">More actions</span>
              </button>
            </DropdownMenu.Trigger>
            {/*
              Portalled to `document.body`, which is audit finding 1. The row
              clips on y, scrolls on x and carries `contain: paint`; the shell
              root and the pane container above it are both `overflow-hidden`. A
              menu rendered in place is inside all three and has nowhere to paint
              — it measured zero visible pixels.
            */}
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                aria-label="More actions"
                align="end"
                sideOffset={4}
                collisionPadding={4}
                className={
                  'z-50 flex max-h-[var(--radix-dropdown-menu-content-available-height)] ' +
                  'w-44 flex-col gap-1 overflow-y-auto rounded-sm border p-1 text-[12px] ' +
                  `${TOKEN_CLASS.menuBorder} ${TOKEN_CLASS.menuSurface} ` +
                  `${TOKEN_CLASS.menuText} ${TOKEN_CLASS.menuElevation}`
                }
              >
                {overflow.map((entry) => (
                  <CommandMenuItem key={entry.key} entry={entry} />
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </div>
  );
}
