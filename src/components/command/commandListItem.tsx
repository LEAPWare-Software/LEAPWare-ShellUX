import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactElement } from 'react';
import type { CommandEntry } from '../../core/commands/CommandRegistry';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import { FALLBACK_ICON, SHELL_ICONS } from '../ui/shellIcons';

/**
 * ============================================================================
 * THE RENDER BOUNDARY. ONE ROW, FOUR SURFACES, ONE PLACE UNTRUSTED TEXT MEETS THE DOM.
 * ============================================================================
 * `src/core/types.ts` states the host's one obligation towards plug-in strings.
 * `RibbonToolbar.tsx` was where that obligation first became code; this module is
 * where it stays code now that there are four surfaces instead of one.
 *
 * **The four surfaces contain no render of a plug-in string at all.** They lay
 * out rows, they group them, they open and close containers — and every one of
 * them reaches `entry.label` and `entry.icon` only by handing a `CommandEntry` to
 * this module. That is a stronger arrangement than four correct render sites: a
 * fifth surface added tomorrow either uses this row or has to write its own, and
 * writing its own is a visible diff rather than an omission.
 *
 * THREE RULES, EACH WITH THE TEST THAT ASSERTS IT.
 *
 * 1. A plug-in `label` reaches the DOM only as `{label}` — a JSX text node. There
 *    is no `dangerouslySetInnerHTML`, no `innerHTML`, no `document.write` and no
 *    plug-in value interpolated into an `href`, `src` or `style` anywhere in this
 *    module or in any of the four surfaces. That absence is asserted against each
 *    module's own source text rather than trusted to review. *Tests:*
 *    `src/components/command/__tests__/commandSurfaces.test.tsx` — "the context
 *    bar module source contains no HTML-injection sink at all", "the command
 *    palette module source contains no HTML-injection sink at all", "the floating
 *    toolbar module source contains no HTML-injection sink at all", "the omnibox
 *    composer module source contains no HTML-injection sink at all" and "the
 *    shared command row module source contains no HTML-injection sink at all";
 *    and the render half, once per surface, in "the context bar renders a
 *    markup-shaped plug-in label as a text node, not as markup" and its three
 *    siblings.
 *
 * 2. A plug-in `icon` is a LOOKUP KEY, never markup and never a URL. It is
 *    resolved through `SHELL_ICONS`, a host-owned `Map` of inline SVGs, and an
 *    unknown key falls back to a host glyph. A `Map` rather than an object
 *    literal, because the key comes from an untrusted manifest and `Map` has no
 *    prototype chain — so `icon: "__proto__"` cannot resolve to
 *    `Object.prototype` and be handed to React as a child. *Tests:* "the context
 *    bar resolves an unknown icon key through the host fallback rather than
 *    through the key" and "the context bar does not resolve a prototype-shaped
 *    icon key to anything inherited", and the three siblings of each, one per
 *    surface.
 *
 * 3. A predicate or a handler that THROWS is contained, and so is a report about
 *    one. Neither guard lives here: `isVisible` runs inside
 *    `CommandRegistry.offer` and `onExecute` runs inside `CommandEntry.run`, both
 *    through `isVisible` and `execute` in `src/core/command.ts`. This row calls
 *    `entry.run()`, which is already guarded — which is what makes "four surfaces,
 *    one implementation" true rather than intended. *Tests:* the whole of "every
 *    command surface — a throwing predicate" and "every command surface — a
 *    throwing handler" in `commandSurfaces.test.tsx`.
 *
 * 3a. WHAT RULE 3 DOES NOT COVER, AND THE WORD IT TURNS ON: **THROWS**. A
 *    predicate that breaks its contract by SUCCEEDING at something else — writing
 *    to the shell store during a surface's render — re-enters through React and
 *    wedges the shell. The host is not on the path between the predicate and the
 *    store: whatever handle it writes through is a reference the plug-in captured
 *    at registration, in a closure no host module sees. `DEVELOPER.md`'s "a
 *    predicate must be pure" is load-bearing rather than advisory. *Test:*
 *    "re-evaluates a predicate that writes to the shell during render, which is a
 *    wedge this module does not contain" in
 *    `src/components/command/__tests__/ContextBar.test.tsx`.
 *
 * ---------------------------------------------------------------------------
 * `aria-disabled`, NOT THE NATIVE `disabled` ATTRIBUTE. AUDIT FIX 6.
 * ---------------------------------------------------------------------------
 * A natively disabled button leaves the tab order entirely, so a keyboard user
 * never lands on it and never learns it exists. "Close extension" is disabled in
 * the shell's default state — nothing is active yet — which means the native
 * attribute hid a whole host command from every keyboard user until they had
 * discovered by some other route that there was something to close. The 2026-07-31
 * accessibility audit found that and it is fixed here, once, for all four
 * surfaces: `aria-disabled` keeps the control focusable and announced as
 * unavailable, and **the guard in the click handler is what actually stops it
 * firing**. The guard is the enforcement; the attribute is only the announcement.
 * ============================================================================
 */

/**
 * Chrome shared by every command row on every surface.
 *
 * `min-h-6` is 24px, which is the WCAG 2.5.8 minimum target size and the second
 * half of the audit's contrast-and-target-size finding. It is a MINIMUM rather
 * than a height so that a taller row is not shrunk by it.
 *
 * `aria-disabled:` rather than `disabled:` because these controls are no longer
 * natively disabled; see the banner.
 */
export const COMMAND_ROW_CHROME =
  'flex min-h-6 min-w-0 items-center gap-1 rounded-sm border p-1 ' +
  'text-[12px] leading-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ' +
  `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.ribbonText} ${TOKEN_CLASS.controlHoverBorder}`;

export interface CommandRowProps {
  readonly entry: CommandEntry;
  /** Surface-specific layout. Never carries a plug-in value. */
  readonly className?: string;
}

/**
 * The glyph and the label. **The only element in the whole command subsystem that
 * renders plug-in text.**
 *
 * `truncate` plus the caller's `max-w-*` is what keeps a 4000-character label
 * from widening its surface: the label ellipsises inside its own box and the full
 * string stays reachable through the `title` attribute, which is an attribute
 * value and therefore text.
 */
export function CommandRowContent({ entry }: { readonly entry: CommandEntry }): ReactElement {
  return (
    <>
      {SHELL_ICONS.get(entry.icon) ?? FALLBACK_ICON}
      <span className="truncate">{entry.label}</span>
    </>
  );
}

/**
 * A command as a button. The context bar, the floating toolbar and the palette
 * all render this.
 *
 * `entry.run()` is already wrapped in `execute`; this component adds the disabled
 * guard and nothing else, so there is exactly one place where "a disabled command
 * does not fire" is decided for all four surfaces.
 */
export function CommandButton({ entry, className }: CommandRowProps): ReactElement {
  return (
    <button
      type="button"
      data-command-key={entry.key}
      aria-disabled={entry.isDisabled ? true : undefined}
      aria-keyshortcuts={entry.keyShortcuts}
      title={entry.label}
      onClick={() => {
        if (entry.isDisabled) {
          return;
        }
        entry.run();
      }}
      className={`${COMMAND_ROW_CHROME} ${className ?? ''}`}
    >
      <CommandRowContent entry={entry} />
    </button>
  );
}

/**
 * A command as an entry inside a portalled Radix menu. The context bar's overflow.
 *
 * A `DropdownMenu.Item` rather than a `<button role="menuitem">`: the item has to
 * take part in Radix's roving focus and typeahead to be reachable by the arrow
 * keys the `menu` role advertises, and only Radix's own item is registered with
 * that collection. **Audit fix 3** — a role that promises an interaction model
 * has to have one.
 *
 * Disabled items use `aria-disabled` and the same guard, not Radix's `disabled`
 * prop, which would take the item out of the roving order. `preventDefault` on
 * the select event is what keeps the menu open when a disabled item is chosen:
 * closing would look like the command had run.
 */
export function CommandMenuItem({ entry, className }: CommandRowProps): ReactElement {
  return (
    <DropdownMenu.Item
      data-command-key={entry.key}
      aria-disabled={entry.isDisabled ? true : undefined}
      aria-keyshortcuts={entry.keyShortcuts}
      title={entry.label}
      onSelect={(event) => {
        if (entry.isDisabled) {
          event.preventDefault();
          return;
        }
        entry.run();
      }}
      className={`${COMMAND_ROW_CHROME} w-full justify-start outline-none ${TOKEN_CLASS.controlFocusBorder} ${className ?? ''}`}
    >
      <CommandRowContent entry={entry} />
    </DropdownMenu.Item>
  );
}
