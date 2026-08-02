import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactElement } from 'react';
import { ariaKeyShortcuts } from '../../core/hotkeys';
import { execute, isVisible } from '../../core/ribbonAction';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { IShellAPI, RibbonAction, RibbonContext } from '../../core/types';
import { FALLBACK_ICON, OVERFLOW_ICON, SHELL_ICONS } from './shellIcons';

/**
 * ============================================================================
 * THE RENDER BOUNDARY. THIS IS WHERE UNTRUSTED PLUG-IN TEXT MEETS THE DOM.
 * ============================================================================
 * `src/core/types.ts` states the host's one obligation towards plug-in strings
 * and says, correctly, that ISSUE-001 could not meet it because nothing rendered
 * plug-in content. This component is that render site, so the obligation is now
 * a property of code rather than a note about a future one.
 *
 * THREE RULES, EACH WITH THE TEST THAT ASSERTS IT.
 *
 * 1. A plug-in `label` reaches the DOM only as `{label}` — a JSX text node.
 *    There is no `dangerouslySetInnerHTML`, no `innerHTML`, no `document.write`
 *    and no plug-in value interpolated into an `href`, `src` or `style` anywhere
 *    in this module. That absence is asserted against this file's own source
 *    text rather than trusted to review: *test:*
 *    `src/components/__tests__/RibbonToolbar.test.tsx` — "the module source
 *    contains no HTML-injection sink at all" and "renders a markup-shaped
 *    plug-in label as a text node, not as markup".
 *
 * 2. A plug-in `icon` is a LOOKUP KEY, never markup and never a URL. It is
 *    resolved through `SHELL_ICONS`, a host-owned `Map` of inline SVGs, and an
 *    unknown key falls back to a host glyph. A `Map` rather than an object
 *    literal, for the same reason `ExtensionRegistryProvider` uses one: the key
 *    comes from an untrusted manifest, and `Map` has no prototype chain, so
 *    `icon: "__proto__"` cannot resolve to `Object.prototype` and be handed to
 *    React as a child. *Test:* "resolves an unknown icon key through the host
 *    fallback rather than through the key" and "does not resolve a
 *    prototype-shaped icon key to anything inherited".
 *
 *    **The table itself is no longer in this file.** It lives in
 *    `src/components/ui/shellIcons.tsx`, because `NavigationNode.icon` (GitHub
 *    issue #19) gave the collapsed pane-1 track a second reason to resolve one
 *    and two copies of a lookup table drift. Both the `Map` semantics and the
 *    reason for them moved with it, unaltered.
 *
 * 3. A predicate or a handler that THROWS is contained, and so is a report about
 *    one. `isVisible` is called inside a guard: a throw means "not visible", is
 *    reported, and the remaining actions still render. `onExecute` is called
 *    inside the same kind of guard, so a handler that throws does not reach React
 *    and does not unmount the shell. Both reports name the offending action
 *    through `actionId`, which is guarded in its own right, so an `id` getter
 *    that detonates *while the first failure is being written down* cannot escape
 *    through the message — the report used to interpolate `action.id` raw, inside
 *    the `catch`, where nothing was left to catch it. This is the gate ISSUE-001
 *    explicitly carried forward because it had no call site. *Tests:* "hides an
 *    action whose isVisible predicate throws and still renders the rest",
 *    "survives an onExecute that throws, leaving the ribbon interactive",
 *    "contains an id getter that throws while a failing isVisible predicate is
 *    being reported", "contains an id getter that throws while a failing
 *    onExecute handler is being reported".
 *
 *    **The two guards no longer live here.** They are `isVisible` and `execute`
 *    in `src/core/ribbonAction.ts`, because since ISSUE-006 there are two routes
 *    to a plug-in action — this button and the keyboard chord in
 *    `src/core/hotkeyDispatch.ts` — and the hotkey's whole containment argument
 *    is that it is gated by *the same* predicate call and *the same* handler
 *    call. Two copies would drift silently. The tests named above still exercise
 *    them through this component, which is the point: extraction moved the code,
 *    not the obligation.
 *
 * 3a. WHAT RULE 3 DOES NOT COVER, AND THE WORD IT TURNS ON: **THROWS**.
 *    A predicate is contracted to be pure. Rule 3 contains the two ways a
 *    predicate can break that contract *by failing* — it throws, or it returns a
 *    non-boolean. It does NOT contain a predicate that breaks the contract by
 *    SUCCEEDING AT SOMETHING ELSE. A predicate that calls
 *    `shell.setSelectedItem(...)` from inside `isVisible` writes to the shell
 *    store during this component's render; `useShellContext` is a
 *    `useSyncExternalStore` subscription, so the write re-renders the shell,
 *    which re-evaluates the predicate, which writes again. The cycle never
 *    closes, and it takes the UI thread with it. Measured: 240 seconds without a
 *    single test completing.
 *
 *    **That is the plug-in author's obligation, not something this component
 *    takes off them, and it cannot be taken off them here.** A predicate is
 *    handed only the `RibbonContext`; whatever `IShellAPI` or `ShellStateStore`
 *    it writes through is a reference the plug-in captured at registration, in a
 *    closure this component never sees and has no way to interpose on. There is
 *    no argument to wrap and no handle to revoke — the host is not on the path
 *    between the predicate and the store at all. So the honest statement is the
 *    narrow one: a predicate that writes during render wedges the shell, this
 *    module does not prevent it, and `DEVELOPER.md`'s "a predicate must be pure"
 *    is load-bearing rather than advisory. It is at least diagnosable — React
 *    prints its "cannot update a component while rendering a different
 *    component" warning — which is what the test below pins, along with the
 *    re-entry itself. *Test:* "re-evaluates a predicate that writes to the shell
 *    during render, which is a wedge this module does not contain".
 *
 * WHAT THIS COMPONENT DOES NOT DO, stated so it is not read into the above:
 *
 *  - It is **not a sandbox**. ADR-0001 "No sandbox" and Amendment E still hold:
 *    a plug-in is same-origin script in the same page and can reach the DOM
 *    itself. This bullet used to say that what is contained here is "what arrives
 *    through `RibbonAction` — accident, collision and an ordinary hostile string
 *    — and nothing more", which reads as a property of the whole type and is
 *    wider than the rules above license. Contained, exhaustively: a predicate or
 *    handler that THROWS, a predicate that returns a NON-BOOLEAN, an untrusted
 *    `label`, an untrusted `icon` key, and a failure report that would itself
 *    throw. NOT contained, and named rather than left to inference: a predicate
 *    that WRITES to the shell during render — see rule 3a. (`onExecute` runs from
 *    a click, not from render, so a write there is ordinary and legal.)
 *  - It **dispatches no keyboard shortcut, and it does advertise one.** Those two
 *    halves used to be one bullet saying no chord was advertised at all, because
 *    advertising a shortcut that does not fire is a lie to assistive technology.
 *    Since ISSUE-006 a chord DOES fire — `useHotkeyDispatch` in
 *    `src/core/hotkeyDispatch.ts` owns the shell's one `keydown` listener — so the
 *    lie has gone the other way and the attribute is now emitted. It is emitted on
 *    exactly the actions the dispatcher will actually fire: a plug-in action that
 *    carries a `hotkey` and is not disabled, on the bar and in the overflow menu
 *    alike, and never on a host command. See `keyShortcutsOf`. The dispatch itself
 *    is still not here — this module attaches nothing and names no key event.
 *    *Tests:* "advertises a chord-bearing action with aria-keyshortcuts, in key
 *    values rather than display spelling", "omits aria-keyshortcuts from a
 *    disabled action, because the chord will not fire", "advertises a chord on an
 *    overflow menu item too" and "never advertises a chord on a host action"; that
 *    this module itself attaches nothing is pinned by "finds no listener
 *    registration in any module outside the hotkey-dispatch allowlist" and "finds
 *    no key-event name in any module outside the key-event allowlist" in
 *    `src/__tests__/noEventListener.test.ts`, neither of whose allowlists names
 *    this file.
 *  - It contains **no error boundary**. A guard around `isVisible` is not a
 *    guard around a plug-in component's render; `FaultBoundary` is ISSUE-004.
 *
 * ============================================================================
 * THE OVERFLOW MENU IS RADIX'S, NOT OURS. THREE PROBLEMS, ONE DEPENDENCY.
 * ============================================================================
 * The overflow menu was originally a hand-rolled `absolute … top-full` div with
 * `role="menu"` on it. Measured in a real browser against the compiled
 * stylesheet — not read off the JSX — it had three defects that no jsdom test
 * could see, because jsdom has no layout engine and no notion of a hit test:
 *
 *  1. IT NEVER PAINTED. Its containing block sat inside two `overflow-hidden`
 *     ancestors, the row and the trailing side, so CSS clipped every pixel of it
 *     to zero. `document.elementFromPoint` at the menu's own centre returned the
 *     pane BELOW the ribbon. `z-index` cannot lift a box out of an ancestor's
 *     clip; only a different containing block can.
 *  2. ACTIVATING AN ITEM DROPPED FOCUS ON THE FLOOR. Closing the menu unmounted
 *     the focused button, so `document.activeElement` fell back to `body` and the
 *     next Tab restarted from the top of the document — WCAG 2.4.3.
 *  3. `role="menu"` PROMISED AN INTERACTION MODEL THAT DID NOT EXIST. Arrows did
 *     nothing, Escape did not close, focus never entered the menu, and an outside
 *     click left it open. NVDA and JAWS switch to application mode inside a menu
 *     and hand the arrow keys to the page, so the role told the user they were in
 *     a menu and then none of a menu's keys worked.
 *
 * `@radix-ui/react-dropdown-menu` answers all three at once and was already a
 * dependency. `DropdownMenu.Portal` renders the content under `document.body`,
 * which is outside every clipping ancestor by construction; `DropdownMenu.Root`
 * implements the full APG menu-button pattern — typeahead, arrows, Home/End,
 * Escape, outside-click dismissal — and restores focus to the trigger when the
 * menu closes, whichever way it closed.
 *
 * **This does not add a listener to `src/`.** Radix's key handling lives in
 * `node_modules`, which `src/__tests__/noEventListener.test.ts` does not scan and
 * has never claimed to: that test's own docblock states the limit, under "What is
 * not asserted": "a handler installed by a third-party module `src/` merely
 * imports — would pass". Quoted with its em-dash and contiguously, because an
 * earlier version of this sentence dropped both and presented a paraphrase as a
 * quotation — the wide-claim failure mode in a different costume. That scan's
 * listener half is no longer absolute — ISSUE-006 added an allowlist holding
 * exactly `core/hotkeyDispatch.ts` — but this module is not on it and names no
 * listener, which is the fact this paragraph needs. `PanelResizeHandle` in
 * `ShellLayout.tsx` is the same arrangement, for the same reason.
 *
 * `aria-controls` is Radix's too, and it now appears only while the menu is open
 * rather than dangling at a non-existent id the whole time the menu is shut.
 * ============================================================================
 */

/**
 * How many contextual actions stay on the bar before the rest move into the
 * overflow menu.
 *
 * A COUNT, not a measured width, and that is the trade being made. Measuring
 * available width means observing the element on every layout change, which is
 * a live subscription this issue does not need: what the edge case actually
 * requires is that the ribbon never grows a second row and never pushes the
 * panes down, and a fixed inline count guarantees a single row on every viewport
 * without measuring anything. The cost is that a wide monitor could have shown a
 * fifth action inline.
 *
 * A count alone is NOT enough at a narrow viewport, and that is worth being
 * precise about, because it was wrong here for a while. Four inline actions plus
 * three host commands do not fit in 320 CSS pixels however few of them there
 * are, and while the row clipped rather than scrolled they were simply gone —
 * unreachable by any input, with no scrollbar anywhere in the ancestor chain to
 * say so. WCAG 1.4.10 does not permit that. The row therefore scrolls on its own
 * x-axis; see `overflow-x-auto` on the row below.
 */
const INLINE_ACTION_LIMIT = 4;

/** A command the HOST owns. Not registry data — no predicate, no plug-in. */
export interface HostRibbonAction {
  readonly id: string;
  readonly label: string;
  /** A key into the host icon table, same as a plug-in's. */
  readonly icon: string;
  readonly isDisabled?: boolean;
  /** Invoked on click. Host code, so it is not wrapped in a guard. */
  onSelect(): void;
}

/** The active extension's contribution to the ribbon's trailing side. */
export interface RibbonExtensionActions {
  /** Host-owned normalised records, straight off the registry. */
  readonly actions: readonly RibbonAction[];
  /** The live, revocable handle `onExecute` is entitled to. */
  readonly shell: IShellAPI;
}

export interface RibbonToolbarProps {
  /** Global host commands. Left-aligned. */
  readonly hostActions: readonly HostRibbonAction[];
  /** The foreground extension's actions, or `null` when nothing is active. */
  readonly extension: RibbonExtensionActions | null;
  /** The context every predicate is evaluated against. */
  readonly context: Readonly<RibbonContext>;
}

/**
 * The chord an action advertises to assistive technology, or `undefined`.
 *
 * TWO REASONS TO OMIT IT, AND BOTH ARE THE SAME REASON: **do not advertise what
 * will not fire.** An action with no `hotkey` has nothing to advertise. An action
 * that is DISABLED is skipped by the dispatcher — `hotkeyDispatch.ts` checks
 * `isDisabled` exactly as the button's own `onClick` guard does — so announcing a
 * shortcut on it would tell a screen-reader user about a key that does nothing.
 *
 * `ariaKeyShortcuts` rather than `describeHotkey`: `aria-keyshortcuts` is defined
 * in terms of UI Events `KeyboardEvent.key` VALUES, where the control key is
 * `Control`. `Ctrl` is the display spelling and is not a valid key value, which is
 * why the two are different functions. The tooltip keeps `describeHotkey`.
 *
 * Host actions never reach here: `HostRibbonAction` has no `hotkey` field, because
 * the dispatcher walks the foreground extension's `ribbonActions` and nothing
 * else. *Tests:* `src/components/__tests__/RibbonToolbar.test.tsx` — "advertises a
 * chord-bearing action with aria-keyshortcuts, in key values rather than display
 * spelling", "omits aria-keyshortcuts from a disabled action, because the chord
 * will not fire", "advertises a chord on an overflow menu item too" and "never
 * advertises a chord on a host action".
 */
function keyShortcutsOf(action: RibbonAction): string | undefined {
  if (action.hotkey === undefined || action.isDisabled === true) {
    return undefined;
  }
  return ariaKeyShortcuts(action.hotkey);
}

interface ActionButtonProps {
  /** UNTRUSTED when it comes from a plug-in. Rendered as a text node only. */
  readonly label: string;
  /** UNTRUSTED lookup key. Resolved through `SHELL_ICONS`. */
  readonly icon: string;
  readonly isDisabled: boolean;
  /**
   * Host-computed `aria-keyshortcuts` value, or `undefined` for no announcement.
   *
   * Host-computed, and that word is doing work: the string is built by
   * `ariaKeyShortcuts` from a registry-validated chord whose `key` came off the
   * `HOTKEY_KEYS` allowlist and whose modifiers are booleans, so no plug-in text
   * reaches this attribute. It is not an exception to the untrusted-string rule
   * at the top of this file; it is a value the plug-in never authored.
   */
  readonly keyShortcuts: string | undefined;
  readonly onSelect: () => void;
}

/**
 * Chrome shared by a ribbon button and an overflow menu item.
 *
 * `min-h-6` is 24px, which is the WCAG 2.5.8 minimum target size. It is a
 * MINIMUM rather than a height so that a taller row — the collapsed nav track's
 * 32px square, for instance — is not shrunk by it.
 *
 * `aria-disabled:` rather than `disabled:` because these controls are no longer
 * natively disabled; see `ActionButton` below for why.
 */
const ACTION_CHROME =
  'flex min-h-6 min-w-0 items-center gap-1 rounded-sm border p-1 ' +
  'text-[12px] leading-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ' +
  `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.ribbonText} ${TOKEN_CLASS.controlHoverBorder}`;

/**
 * One ribbon button. The only element in this module that renders plug-in text.
 *
 * `truncate` plus `max-w-*` is what keeps a 4000-character label from widening
 * the row: the label ellipsises inside its own box and the full string stays
 * reachable through `title`, which is an attribute value and therefore text.
 *
 * **`aria-disabled`, not the native `disabled` attribute.** A natively disabled
 * button leaves the tab order entirely, so a keyboard user never lands on it and
 * never learns it exists. "Close extension" is disabled in the shell's default
 * state — nothing is active yet — which means the native attribute hid a whole
 * host command from every keyboard user until they had already discovered, by
 * some other route, that there was something to close. `aria-disabled` keeps the
 * control focusable and announced as unavailable, and the guard in `onClick` is
 * what actually stops it firing. The guard is the enforcement; the attribute is
 * only the announcement.
 */
function ActionButton({
  label,
  icon,
  isDisabled,
  keyShortcuts,
  onSelect,
}: ActionButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-disabled={isDisabled ? true : undefined}
      aria-keyshortcuts={keyShortcuts}
      title={label}
      onClick={() => {
        if (isDisabled) {
          return;
        }
        onSelect();
      }}
      className={`${ACTION_CHROME} max-w-[9rem] flex-none`}
    >
      {SHELL_ICONS.get(icon) ?? FALLBACK_ICON}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * One entry inside the overflow menu.
 *
 * A `DropdownMenu.Item` rather than a `<button role="menuitem">`: the item has to
 * take part in Radix's roving focus and typeahead to be reachable by the arrow
 * keys the `menu` role advertises, and only Radix's own item is registered with
 * that collection.
 *
 * Disabled items use `aria-disabled` and a guard, not Radix's `disabled` prop,
 * for the same reason `ActionButton` does — Radix's prop would take the item out
 * of the roving order. `preventDefault` on the select event is what keeps the
 * menu open when a disabled item is chosen: closing would look like the action
 * had run.
 */
function OverflowMenuItem({
  label,
  icon,
  isDisabled,
  keyShortcuts,
  onSelect,
}: ActionButtonProps): ReactElement {
  return (
    <DropdownMenu.Item
      aria-disabled={isDisabled ? true : undefined}
      aria-keyshortcuts={keyShortcuts}
      title={label}
      onSelect={(event) => {
        if (isDisabled) {
          event.preventDefault();
          return;
        }
        onSelect();
      }}
      className={`${ACTION_CHROME} w-full justify-start outline-none ${TOKEN_CLASS.controlFocusBorder}`}
    >
      {SHELL_ICONS.get(icon) ?? FALLBACK_ICON}
      <span className="truncate">{label}</span>
    </DropdownMenu.Item>
  );
}

/**
 * The shell ribbon: host commands left, the foreground extension's contextual
 * commands right.
 *
 * `role="toolbar"` with each button individually tabbable, rather than the
 * roving-tabindex toolbar pattern. The roving pattern needs an arrow-key
 * handler, and keyboard dispatch is out of scope for ISSUE-002; Tab-through is
 * the honest description of what this does, and the buttons are the first stop
 * in the shell's focus order. WAI-ARIA words descendant focus management for
 * `toolbar` as a SHOULD, not a MUST, and every control here is individually
 * reachable by Tab — so the role names the grouping without withholding
 * anything the user needs. That is the one place this component keeps a role
 * whose optional half it does not implement, and it is kept knowingly.
 *
 * TWO ROWS ARE STILL FORBIDDEN, AND THE ROW STILL SCROLLS. `flex-nowrap` is what
 * forbids the second row; `overflow-x-auto` with `overflow-y-hidden` is what
 * keeps every control reachable when one row is not wide enough. The two are not
 * in tension: the y-axis is clipped exactly as before, so the ribbon cannot grow
 * downward into the panes, and the x-axis is the only one that scrolls. Both
 * sides are `flex-none` on purpose — a shrinkable side would absorb the overflow
 * by squashing its own buttons to nothing instead of letting the row scroll, and
 * a squashed button is the failure this is meant to prevent.
 *
 * `[contain:paint]` IS LOAD-BEARING AND IS NOT A TIDY-UP. Without it, at 320
 * CSS px the row's overflowing content leaks into the VIEWPORT's scrollable
 * area: `window.scrollX` could be driven to 376 and `documentElement.scrollWidth`
 * read 696 against a 320 client width. There is no visible page scrollbar,
 * because `body { overflow: hidden }` in `src/index.css` propagates to the
 * viewport and hides it — which makes the leak worse rather than better, since
 * the page could be scrolled sideways by keyboard or by assistive technology
 * with nothing on screen to say it had moved or how to get back. Measured in
 * Chrome 150: `contain: paint` takes it to `scrollX = 0` and
 * `documentElement.scrollWidth = 320` while the ribbon itself still scrolls its
 * full 719px and every control stays reachable. `html { overflow: hidden }` was
 * tried first and does NOT fix it — hence a measurement rather than a guess.
 */
export function RibbonToolbar({
  hostActions,
  extension,
  context,
}: RibbonToolbarProps): ReactElement {
  // Evaluated on every render, against the context as it is right now. Filtering
  // here rather than inside the map keeps the overflow split working on the
  // VISIBLE set: an action hidden by its predicate must not occupy an inline
  // slot and push a visible one into the menu.
  const visible =
    extension === null ? [] : extension.actions.filter((action) => isVisible(action, context));
  const inline = visible.slice(0, INLINE_ACTION_LIMIT);
  const overflow = visible.slice(INLINE_ACTION_LIMIT);

  return (
    <div
      role="toolbar"
      aria-label="Shell ribbon"
      data-shell-region="ribbon"
      className={
        'flex w-full flex-none flex-nowrap items-center justify-between gap-1 ' +
        'overflow-x-auto overflow-y-hidden [contain:paint] border-b p-1 text-[12px] ' +
        `${TOKEN_CLASS.ribbonBorder} ${TOKEN_CLASS.ribbonSurface} ${TOKEN_CLASS.ribbonText}`
      }
    >
      <div data-ribbon-side="host" className="flex flex-none flex-nowrap items-center gap-1">
        {hostActions.map((action) => (
          <ActionButton
            key={action.id}
            label={action.label}
            icon={action.icon}
            isDisabled={action.isDisabled === true}
            // Never on a host command. `HostRibbonAction` carries no chord, and
            // the dispatcher walks the foreground extension's actions only.
            keyShortcuts={undefined}
            onSelect={action.onSelect}
          />
        ))}
      </div>

      <div
        data-ribbon-side="extension"
        className="flex flex-none flex-nowrap items-center justify-end gap-1"
      >
        {extension === null
          ? null
          : inline.map((action) => (
              <ActionButton
                key={action.id}
                label={action.label}
                icon={action.icon}
                isDisabled={action.isDisabled === true}
                keyShortcuts={keyShortcutsOf(action)}
                onSelect={() => {
                  execute(action, context, extension.shell);
                }}
              />
            ))}
        {extension === null || overflow.length === 0 ? null : (
          /*
            `modal={false}` — the one Radix default this component overrides.
            A modal dropdown marks the rest of the document `aria-hidden` and
            sets `pointer-events: none` on the body while it is open, which is
            right for a dialog and wrong for a toolbar menu: the ribbon's other
            commands, the navigation tree and both plug-in panes would all vanish
            from the accessibility tree because four contextual actions did not
            fit on one row. Nothing here is modal in the user's mind, so nothing
            here is modal in the DOM. Escape, outside-click dismissal and
            focus-return to the trigger all still apply.
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
              Portalled to `document.body`, which is the whole point. The row
              clips on y, scrolls on x and carries `contain: paint`; the shell
              root and the pane container above it are both `overflow-hidden`.
              A menu rendered in place is inside all three and has nowhere to
              paint — it measured zero visible pixels. See the file banner.
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
                {overflow.map((action) => (
                  <OverflowMenuItem
                    key={action.id}
                    label={action.label}
                    icon={action.icon}
                    isDisabled={action.isDisabled === true}
                    keyShortcuts={keyShortcutsOf(action)}
                    onSelect={() => {
                      execute(action, context, extension.shell);
                    }}
                  />
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </div>
  );
}
