import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactElement } from 'react';
import type { IShellAPI, RibbonAction, RibbonContext } from '../../core/types';

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
 *    resolved through `RIBBON_ICONS`, a host-owned `Map` of inline SVGs, and an
 *    unknown key falls back to a host glyph. A `Map` rather than an object
 *    literal, for the same reason `ExtensionRegistryProvider` uses one: the key
 *    comes from an untrusted manifest, and `Map` has no prototype chain, so
 *    `icon: "__proto__"` cannot resolve to `Object.prototype` and be handed to
 *    React as a child. *Test:* "resolves an unknown icon key through the host
 *    fallback rather than through the key" and "does not resolve a
 *    prototype-shaped icon key to anything inherited".
 *
 * 3. A predicate or a handler that THROWS is contained here, and so is a report
 *    about one. `isVisible` is called inside a guard: a throw means "not
 *    visible", is reported, and the remaining actions still render. `onExecute`
 *    is called inside the same kind of guard, so a handler that throws does not
 *    reach React and does not unmount the shell. Both reports name the offending
 *    action through `actionId`, which is guarded in its own right, so an `id`
 *    getter that detonates *while the first failure is being written down*
 *    cannot escape through the message — the report used to interpolate
 *    `action.id` raw, inside the `catch`, where nothing was left to catch it.
 *    This is the gate ISSUE-001 explicitly carried forward because it had no
 *    call site. *Tests:* "hides an action whose isVisible predicate throws and
 *    still renders the rest", "survives an onExecute that throws, leaving the
 *    ribbon interactive", "contains an id getter that throws while a failing
 *    isVisible predicate is being reported", "contains an id getter that throws
 *    while a failing onExecute handler is being reported".
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
 *  - It **dispatches no keyboard shortcut**. `RibbonAction.hotkey` is validated
 *    at registration and nothing evaluates it; no chord is advertised on these
 *    buttons either, because advertising a shortcut that does not fire is a lie
 *    to assistive technology. Dispatch is Phase 2.
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
 * quotation — the wide-claim failure mode in a different costume. The repo-wide
 * claim is about the host's own modules, and it is still true here.
 * `PanelResizeHandle` in `ShellLayout.tsx` is the same arrangement, for the same
 * reason.
 *
 * `aria-controls` is Radix's too, and it now appears only while the menu is open
 * rather than dangling at a non-existent id the whole time the menu is shut.
 * ============================================================================
 */

/**
 * Inline SVG built from one or more path commands.
 *
 * Host-authored geometry only. Nothing a plug-in supplies ever reaches `d`; the
 * plug-in's contribution is a key into the map below and nothing else.
 */
function glyph(paths: readonly string[]): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The host's icon vocabulary. An extension names one of these keys; anything
 * else gets `FALLBACK_ICON`.
 *
 * A `Map`, not a `Record`, and not because the lookup is faster. The key is
 * untrusted, and an object literal answers `icons['__proto__']` with
 * `Object.prototype` — an object React refuses to render, from a key that
 * reaches no own property. A `Map` has no prototype chain to inherit from.
 */
const RIBBON_ICONS: ReadonlyMap<string, ReactElement> = new Map<string, ReactElement>([
  ['save', glyph(['M3 3h7l3 3v7H3z', 'M6 3v3h3', 'M5.5 13V9.5h5V13'])],
  ['open', glyph(['M2 4.5h4L7.5 6.5H14V13H2z'])],
  ['edit', glyph(['M11 2.5 13.5 5l-7.5 7.5H3.5V10z'])],
  ['delete', glyph(['M3 4.5h10', 'M6.5 4.5V2.5h3v2', 'M4.5 4.5 5.5 13.5h5l1-9'])],
  ['refresh', glyph(['M13 8a5 5 0 1 1-1.6-3.7', 'M13 2v3h-3'])],
  ['search', glyph(['M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M10.5 10.5 14 14'])],
  ['add', glyph(['M8 3v10', 'M3 8h10'])],
  ['settings', glyph(['M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 1.5v2', 'M8 12.5v2', 'M1.5 8h2', 'M12.5 8h2'])],
  ['navigation', glyph(['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11'])],
  ['drawer', glyph(['M2.5 3h11v10h-11z', 'M10 3v10'])],
  ['close', glyph(['M4 4l8 8', 'M12 4l-8 8'])],
]);

/** Shown for any icon key the host does not publish. */
const FALLBACK_ICON: ReactElement = glyph(['M3.5 3.5h9v9h-9z']);

/**
 * The overflow-menu glyph. Deliberately NOT an entry in `RIBBON_ICONS`: that map
 * is the vocabulary offered to extensions, this button is host chrome, and
 * looking it up through the map would add a fallback branch that no input can
 * ever reach.
 */
const OVERFLOW_ICON: ReactElement = glyph(['M4 8h.01', 'M8 8h.01', 'M12 8h.01']);

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
 * Report a plug-in failure without letting the report become a second failure.
 *
 * `console` is no more the host's object than the predicate that just threw is;
 * a plug-in that replaces `console.error` with a throwing function would
 * otherwise turn containment into an escape. Same guard, and same reasoning, as
 * the one in `ShellHostProvider`'s registry sweep.
 */
function report(message: string, error: unknown): void {
  try {
    console.error(message, error);
  } catch {
    // Reporting is best-effort. Rendering the rest of the ribbon is not.
  }
}

/** Stands in for an `id` that could not be read, so the report still names a slot. */
const UNREADABLE_ID = '<an id that could not be read>';

/**
 * `action.id` as text, for a failure report, without the report becoming the
 * second failure.
 *
 * Reading `.id` is a property access on plug-in-shaped data and `String()`
 * consults `Symbol.toPrimitive`, `toString` and `valueOf`, so both halves are
 * calls into code the plug-in may have written. Every use of this function is
 * inside a `catch` — the one place where an unguarded throw is worst, because it
 * replaces a contained failure with an uncontained one and loses the original
 * error on the way out.
 *
 * **Not reachable through the registry today, and guarded anyway.**
 * `normalizeRibbonAction` stores a frozen record whose `id` is a captured
 * primitive string, so nothing arriving by the documented route can detonate
 * here. This component's props are `readonly RibbonAction[]` and a caller is
 * plain JavaScript, which is exactly the standard `ShellAPI.ts` holds its own
 * doors to: the declared type proves nothing at runtime.
 *
 * It DOES interpolate the value, where `describeUntrusted` in `ShellAPI.ts`
 * deliberately refuses to. The two are answering different questions. That one
 * builds the message of a thrown `ShellUXError`, where a `toString` running
 * inside the host is a real escalation; this one builds a `console` line whose
 * entire usefulness is naming *which* action misbehaved, and the stringification
 * is already inside a guard whose failure mode is a placeholder.
 *
 * *Test:* `src/components/__tests__/RibbonToolbar.test.tsx` — "contains an id
 * getter that throws while a failing isVisible predicate is being reported" and
 * "contains an id getter that throws while a failing onExecute handler is being
 * reported".
 */
function actionId(action: RibbonAction): string {
  try {
    return String(action.id);
  } catch {
    return UNREADABLE_ID;
  }
}

/**
 * Whether `action` should appear, with a throwing predicate treated as "no".
 *
 * `=== true` rather than a truthiness test: `isVisible` is declared to return a
 * boolean and a plug-in is plain JavaScript, so a predicate returning a truthy
 * non-boolean is a contract violation and is resolved the safe way — hidden.
 *
 * **A throw is contained. A WRITE is not.** See rule 3a in the file banner: a
 * predicate that calls back into the shell store from here re-enters this
 * function through React and never stops, and nothing in this guard addresses
 * that.
 */
function isVisible(action: RibbonAction, context: Readonly<RibbonContext>): boolean {
  try {
    return action.isVisible(context) === true;
  } catch (error) {
    report(
      `RibbonToolbar: the isVisible predicate of ribbon action "${actionId(action)}" threw. The action is hidden and the rest of the ribbon still renders. A predicate must be pure and must return false rather than throw; see DEVELOPER.md, "Rules for writing predicates".`,
      error,
    );
    return false;
  }
}

/** Invoke `onExecute` without letting a throwing handler reach React. */
function execute(
  action: RibbonAction,
  context: Readonly<RibbonContext>,
  shell: IShellAPI,
): void {
  try {
    action.onExecute(context, shell);
  } catch (error) {
    report(
      `RibbonToolbar: the onExecute handler of ribbon action "${actionId(action)}" threw. The shell is still running; fix the handler.`,
      error,
    );
  }
}

interface ActionButtonProps {
  /** UNTRUSTED when it comes from a plug-in. Rendered as a text node only. */
  readonly label: string;
  /** UNTRUSTED lookup key. Resolved through `RIBBON_ICONS`. */
  readonly icon: string;
  readonly isDisabled: boolean;
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
  'flex min-h-6 min-w-0 items-center gap-1 rounded-sm border border-transparent p-1 ' +
  'text-[12px] leading-none text-neutral-900 hover:border-neutral-200 ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-40 dark:text-neutral-100 ' +
  'dark:hover:border-neutral-800';

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
function ActionButton({ label, icon, isDisabled, onSelect }: ActionButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-disabled={isDisabled ? true : undefined}
      title={label}
      onClick={() => {
        if (isDisabled) {
          return;
        }
        onSelect();
      }}
      className={`${ACTION_CHROME} max-w-[9rem] flex-none`}
    >
      {RIBBON_ICONS.get(icon) ?? FALLBACK_ICON}
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
function OverflowMenuItem({ label, icon, isDisabled, onSelect }: ActionButtonProps): ReactElement {
  return (
    <DropdownMenu.Item
      aria-disabled={isDisabled ? true : undefined}
      title={label}
      onSelect={(event) => {
        if (isDisabled) {
          event.preventDefault();
          return;
        }
        onSelect();
      }}
      className={`${ACTION_CHROME} w-full justify-start outline-none focus:border-neutral-200 dark:focus:border-neutral-800`}
    >
      {RIBBON_ICONS.get(icon) ?? FALLBACK_ICON}
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
        'overflow-x-auto overflow-y-hidden [contain:paint] ' +
        'border-b border-neutral-200 bg-neutral-50 p-1 ' +
        'text-[12px] text-neutral-900 dark:border-neutral-800 ' +
        'dark:bg-neutral-900 dark:text-neutral-100'
      }
    >
      <div data-ribbon-side="host" className="flex flex-none flex-nowrap items-center gap-1">
        {hostActions.map((action) => (
          <ActionButton
            key={action.id}
            label={action.label}
            icon={action.icon}
            isDisabled={action.isDisabled === true}
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
                  'flex min-h-6 flex-none items-center gap-1 rounded-sm border ' +
                  'border-transparent p-1 text-[12px] leading-none text-neutral-900 ' +
                  'hover:border-neutral-200 dark:text-neutral-100 ' +
                  'dark:hover:border-neutral-800'
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
                  'w-44 flex-col gap-1 overflow-y-auto rounded-sm border ' +
                  'border-neutral-200 bg-white p-1 text-[12px] text-neutral-900 shadow-md ' +
                  'dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
                }
              >
                {overflow.map((action) => (
                  <OverflowMenuItem
                    key={action.id}
                    label={action.label}
                    icon={action.icon}
                    isDisabled={action.isDisabled === true}
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
