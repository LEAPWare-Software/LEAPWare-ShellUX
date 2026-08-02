import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { CommandEntry, CommandRegistry } from '../../core/commands/CommandRegistry';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { RibbonContext } from '../../core/types';
import { CommandButton } from './commandListItem';

/**
 * ============================================================================
 * THE Cmd-K PALETTE. BROWSABLE ON AN EMPTY QUERY, AND THAT IS THE WHOLE ARGUMENT.
 * ============================================================================
 * A ribbon's actual purpose is DISCOVERY: it shows a user commands they did not
 * know to look for. Deleting it and shipping a search box is a regression on the
 * one thing it was good at — you cannot search for a verb whose name you do not
 * know. So this palette opens BROWSABLE: recents first, then commands suggested
 * by the current selection, then every offered command grouped by category. The
 * query narrows that; it is not the only way in.
 *
 * Cmd-K is the palette and Cmd-P is object jump, separate, as VS Code does.
 * Merging them makes both worse — a fuzzy list of nouns and verbs where the top
 * hit changes meaning depending on what you typed.
 *
 * ---------------------------------------------------------------------------
 * PALETTE CONTAINMENT. A SECURITY DECISION, NOT A UX ONE.
 * ---------------------------------------------------------------------------
 * The palette lists **the foreground extension's commands, the host's own
 * commands, and a host-owned "switch extension" verb. Nothing else.** The full
 * argument is in `CommandRegistry`'s banner and it is not restated here in
 * shorter form, because the short form of it is the wide claim. What matters at
 * this render site is that the containment is not this component's to enforce and
 * not this component's to breach: it receives a `CommandRegistry` built over ONE
 * extension, and there is no parameter, prop or import here through which a
 * second one could arrive. *Test:* "offers no route by which a second extension
 * commands could enter a projection" in
 * `src/core/commands/__tests__/CommandRegistry.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE DIALOG IS MODAL, AND THE CONTEXT BAR'S MENU IS NOT. BOTH ARE DELIBERATE.
 * ---------------------------------------------------------------------------
 * `ContextBar` overrides Radix's `modal` default to `false`, because a toolbar
 * overflow menu that hides the navigation tree and both panes from assistive
 * technology is lying about what the user is doing. A command palette is the
 * opposite case: while it is open it IS the interaction, the rest of the shell is
 * not operable, and marking it `aria-hidden` is the accurate description rather
 * than an inconvenience. So this one keeps the modal default — focus trapped,
 * Escape dismissing, focus restored to whatever opened it — and the two surfaces
 * differ because the two situations differ.
 *
 * ---------------------------------------------------------------------------
 * ROWS ARE BUTTONS, TAB-NAVIGABLE. NO `listbox`, NO ARROW KEYS, NO PRETENCE.
 * ---------------------------------------------------------------------------
 * The obvious design is a `role="listbox"` with `aria-activedescendant` and arrow
 * keys, which is what `VirtualizedList` implements for pane 2. It is not what this
 * does, and the reason is audit finding 3 rather than laziness: `role="menu"` on
 * the old overflow menu promised arrows, Escape and focus entry, none of which
 * existed, and screen readers switched to application mode and handed the arrow
 * keys to a page that ignored them. **A role whose interaction model is not
 * implemented is worse than no role.**
 *
 * Implementing the model here means a `keydown` handler in `src/`, which means an
 * entry in `KEY_EVENT_ALLOWLIST` — an exemption whose whole value is that it is
 * hard to get. What this ships instead is plain buttons inside Radix's focus
 * trap: every row is reachable by Tab, Escape closes, focus returns to the
 * trigger, and no role claims anything that is not true. It is the same knowing
 * deviation the context bar's `role="toolbar"` makes, recorded rather than left
 * for an auditor to find, and upgrading it is a tracked follow-up rather than a
 * silent absence. *Tests:* "walks every palette row with Tab, because nothing
 * here claims an arrow-key model" and "claims no listbox, grid or menu role".
 * ============================================================================
 */

/** Host-owned section headings. Never a plug-in string. */
const RECENTS_LABEL = 'Recent';
const SUGGESTED_LABEL = 'For the current selection';
const RESULTS_LABEL = 'Results';
const EMPTY_LABEL = 'No command matches that.';

export interface CommandPaletteProps {
  readonly registry: CommandRegistry;
  readonly context: Readonly<RibbonContext>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** One labelled block of rows. */
function PaletteSection({
  label,
  entries,
}: {
  readonly label: string;
  readonly entries: readonly CommandEntry[];
}): ReactElement | null {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-col gap-px" data-palette-section={label}>
      <h3
        className={`px-1 text-[11px] font-semibold uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}
      >
        {label}
      </h3>
      {entries.map((entry) => (
        <CommandButton key={entry.key} entry={entry} className="w-full justify-start" />
      ))}
    </div>
  );
}

/**
 * The complete command surface.
 *
 * `query` is host state over a host `<input>`; it is compared against
 * `entry.label` and never interpolated anywhere. A plug-in label reaches the DOM
 * only through `commandListItem.tsx`, exactly as it does on the other three
 * surfaces.
 */
export function CommandPalette({
  registry,
  context,
  open,
  onOpenChange,
}: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState('');

  /**
   * Running a command closes the palette.
   *
   * The entry is re-wrapped rather than the row given a second callback, so that
   * `CommandButton` keeps one `onClick` with one disabled guard and the guarded
   * `entry.run` stays the only route to a plug-in handler. Closing happens AFTER
   * the handler, so a handler that throws — contained by `execute` — still leaves
   * the palette closed rather than open over a failed command.
   */
  const closing = (entry: CommandEntry): CommandEntry => ({
    ...entry,
    run: () => {
      entry.run();
      onOpenChange(false);
    },
  });

  const trimmed = query.trim().toLowerCase();
  const isBrowsing = trimmed === '';
  const offered = registry.listForSurface('palette', context);
  const results = isBrowsing
    ? []
    : offered.filter((entry) => entry.label.toLowerCase().includes(trimmed)).map(closing);
  const recents = isBrowsing ? registry.recents(context).map(closing) : [];
  const suggested = isBrowsing ? registry.suggestedFor(context).map(closing) : [];
  const groups = isBrowsing ? registry.listByCategory(context) : [];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // The query is state of one visit, not of the shell. Leaving it behind
        // would reopen the palette already filtered by whatever was typed
        // before, which reads as "the palette is broken, it shows nothing".
        //
        // Cleared unconditionally, and there used to be an `if (!next)` around
        // it. **There is no `Dialog.Trigger` in this component** — `open` is
        // controlled entirely by the host chord — so Radix only ever reports a
        // CLOSE here, and that guard was a branch no input could take the false
        // side of. Vitest 2 did not count it and vitest 4 does, which is how it
        // surfaced. Clearing on an open we never receive would be correct
        // anyway: a palette that opens should open empty.
        setQuery('');
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-40 ${TOKEN_CLASS.badgeSurface} opacity-60`} />
        <Dialog.Content
          data-shell-region="command-palette"
          className={
            'fixed left-1/2 top-16 z-50 flex max-h-[60vh] w-[32rem] max-w-[90vw] ' +
            '-translate-x-1/2 flex-col gap-1 overflow-y-auto rounded-sm border p-1 ' +
            `text-[12px] ${TOKEN_CLASS.menuBorder} ${TOKEN_CLASS.menuSurface} ` +
            `${TOKEN_CLASS.menuText} ${TOKEN_CLASS.menuElevation}`
          }
        >
          <Dialog.Title
            className={`px-1 text-[11px] font-semibold uppercase tracking-wide ${TOKEN_CLASS.mutedText}`}
          >
            Commands
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Search every command available right now, or browse them by category.
          </Dialog.Description>
          <input
            type="search"
            aria-label="Search commands"
            placeholder="Search commands"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className={
              `min-h-6 w-full rounded-sm border p-1 text-[12px] leading-none ` +
              `${TOKEN_CLASS.chipBorder} ${TOKEN_CLASS.menuSurface} ${TOKEN_CLASS.menuText}`
            }
          />
          {isBrowsing ? (
            <>
              <PaletteSection label={RECENTS_LABEL} entries={recents} />
              <PaletteSection label={SUGGESTED_LABEL} entries={suggested} />
              {groups.map((group) => (
                <PaletteSection
                  key={group.label}
                  label={group.label}
                  entries={group.commands.map(closing)}
                />
              ))}
            </>
          ) : (
            <PaletteSection label={RESULTS_LABEL} entries={results} />
          )}
          {!isBrowsing && results.length === 0 ? (
            <p className={`p-1 text-[12px] leading-5 ${TOKEN_CLASS.mutedText}`}>{EMPTY_LABEL}</p>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
