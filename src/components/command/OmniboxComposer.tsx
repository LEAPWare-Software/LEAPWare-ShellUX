import { useState } from 'react';
import type { ReactElement } from 'react';
import type { CommandEntry, CommandRegistry } from '../../core/commands/CommandRegistry';
import { TOKEN_CLASS } from '../../core/theme/tokenClasses';
import type { RibbonContext } from '../../core/types';
import { SUBMIT_ICON } from '../ui/shellIcons';
import { INTENT_LABELS, commandQueryOf, detectIntent } from './omniboxIntent';
import type { OmniboxIntent } from './omniboxIntent';
import { CommandButton } from './commandListItem';

/**
 * ============================================================================
 * THE OMNIBOX COMPOSER. PANE 3 ACCEPTS INPUT, AND THE INTENT IS SHOWN FIRST.
 * ============================================================================
 * Plan requirement 4 is that pane 3 supports both visualization and user input,
 * and §11 item 6 refuses "a read-only detail pane... input as a first-class
 * capability, not via a modal". This is that capability. It is docked, it is
 * always there, and it is the only text-entry surface the host owns.
 *
 * ---------------------------------------------------------------------------
 * INTENT IS DETECTED AND THEN **LABELLED BEFORE SUBMIT**, WHICH IS THE POINT
 * ---------------------------------------------------------------------------
 * A box that guesses what you meant and acts on the guess is the Focused/Other
 * failure — §11 item 3, "hidden defaults that alter what data is visible". So the
 * guess is drawn, in words, next to the box, and it updates on every keystroke:
 * before you press Enter you can read what is about to happen. `detectIntent` is
 * a pure total function over the raw string, exported so the label and the submit
 * path cannot disagree about it — one rule, one implementation, two readers.
 *
 * The vocabulary is three verbs and the prefixes are sigils rather than words, so
 * they cannot collide with anything a user might legitimately type as the first
 * word of a filter:
 *
 *  - `>` or `/` — **command**. The composer becomes a command surface: matching
 *    commands are listed under the box and Enter runs the first one.
 *  - a leading or trailing `?` — **ask**. Handed to the host as a question.
 *  - anything else — **filter**, which is the common case and therefore the one
 *    that needs no sigil.
 *
 * ---------------------------------------------------------------------------
 * IT SUBMITS THROUGH A FORM, AND THAT IS NOT AN AESTHETIC CHOICE
 * ---------------------------------------------------------------------------
 * Enter reaches this component as a `submit` event on a `<form>`, never as a
 * `keydown` handler. A key handler here would need an entry in
 * `KEY_EVENT_ALLOWLIST` in `src/__tests__/noEventListener.test.ts` — an allowlist
 * whose entire value is that it is hard to get into, and which today names the
 * list virtualizer and the chord dispatcher and nothing else. A native form
 * submission gets Enter, the IME's own composition handling and the platform's
 * default-button semantics for free, and adds no ambient key handling to `src/`
 * at all. *Test:* "finds no key-event name in any module outside the key-event
 * allowlist", which does not name this file.
 *
 * The `<input>` also makes the chord dispatcher's editable-target suppression
 * fire, so an extension's `Ctrl+D` cannot run while the user is typing a message
 * into this box. That is `isEditableTarget` in `hotkeyDispatch.ts` doing its job,
 * not something this component arranges.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 *  - It **runs no predicate and calls no handler directly**; `CommandRegistry`
 *    does both, through `src/core/command.ts`.
 *  - It **renders no plug-in string**; `commandListItem.tsx` does.
 *  - It **interprets nothing** for the `filter` and `ask` intents. It hands the
 *    raw text to its caller and the caller decides. A composer that reached into
 *    an extension's view to apply a filter would be host chrome operating a
 *    plug-in's UI, which is a capability nothing in this repository grants.
 * ============================================================================
 */

/** What the caller is told when a non-command intent is submitted. */
export interface OmniboxSubmission {
  readonly intent: Exclude<OmniboxIntent, 'command'>;
  /** The raw text, trimmed. Host-owned; the caller decides what it means. */
  readonly text: string;
}

export interface OmniboxComposerProps {
  readonly registry: CommandRegistry;
  readonly context: Readonly<RibbonContext>;
  /**
   * Told about a submitted `filter` or `ask`. A `command` never reaches here —
   * it runs through the registry, which is what keeps every route to a plug-in
   * handler on the guarded path.
   */
  readonly onSubmit: (submission: OmniboxSubmission) => void;
}

/** How many command matches the composer lists under the box. */
export const OMNIBOX_MATCH_LIMIT = 5;

/**
 * The docked composer.
 *
 * `matches` is recomputed on every render from the registry, so a command whose
 * predicate goes false while the box is open stops being offered on the next
 * render rather than staying listed until the user retypes.
 */
export function OmniboxComposer({
  registry,
  context,
  onSubmit,
}: OmniboxComposerProps): ReactElement {
  const [value, setValue] = useState('');
  const intent = detectIntent(value);

  const query = commandQueryOf(value).toLowerCase();
  const matches: readonly CommandEntry[] =
    intent === 'command'
      ? registry
          .listForSurface('omnibox', context)
          .filter((entry) => query === '' || entry.label.toLowerCase().includes(query))
          .slice(0, OMNIBOX_MATCH_LIMIT)
      : [];

  /** Running a match clears the box, exactly as submitting one does. */
  const clearing = (entry: CommandEntry): CommandEntry => ({
    ...entry,
    run: () => {
      entry.run();
      setValue('');
    },
  });

  return (
    <form
      data-shell-region="omnibox"
      aria-label="Composer"
      /*
        THE CONTAINER SUPPLIES THE EDGE AND THE PADDING, NOT THIS FORM.
        This used to carry `border-t p-1` and `TOKEN_CLASS.paneSlotEdge`
        because it was the last child of pane 3's scroll container and had to
        draw its own separation from the ledger above it. It is now handed to
        `PaneWrapper`'s `footer` slot (GitHub issue #110), and that slot already
        draws exactly those three — keeping them here would render two border
        lines a padding step apart.
      */
      className={`flex w-full flex-none flex-col gap-1 text-[12px] ${TOKEN_CLASS.paneSurface} ${TOKEN_CLASS.paneText}`}
      onSubmit={(event) => {
        // The page must not navigate. This is the whole of the key handling in
        // this module, and it is not key handling.
        event.preventDefault();
        const text = value.trim();
        if (text === '') {
          return;
        }
        if (intent === 'command') {
          const first = matches[0];
          if (first !== undefined && !first.isDisabled) {
            first.run();
            setValue('');
          }
          return;
        }
        onSubmit({ intent, text });
        setValue('');
      }}
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-1">
        {/*
          The intent, in words, BEFORE submit. `aria-live="polite"` because it
          changes under the user's own typing without focus moving to it, and a
          screen-reader user who cannot see the chip has the same right to know
          what Enter is about to do.
        */}
        <span
          data-omnibox-intent={intent}
          aria-live="polite"
          className={
            'flex min-h-6 flex-none items-center rounded-sm border p-1 leading-none ' +
            `${TOKEN_CLASS.chipBorder} ${TOKEN_CLASS.secondaryText}`
          }
        >
          {INTENT_LABELS[intent]}
        </span>
        <input
          type="text"
          aria-label="Composer input"
          placeholder="Filter, > command, or ask a question"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className={
            'min-h-6 min-w-0 flex-1 rounded-sm border p-1 leading-none ' +
            `${TOKEN_CLASS.chipBorder} ${TOKEN_CLASS.paneSurface} ${TOKEN_CLASS.paneText}`
          }
        />
        <button
          type="submit"
          title="Submit"
          className={
            'flex min-h-6 flex-none items-center gap-1 rounded-sm border p-1 leading-none ' +
            `${TOKEN_CLASS.controlRestBorder} ${TOKEN_CLASS.paneText} ` +
            TOKEN_CLASS.controlHoverBorder
          }
        >
          {SUBMIT_ICON}
          <span className="sr-only">Submit</span>
        </button>
      </div>
      {matches.length === 0 ? null : (
        <div data-omnibox-matches="" className="flex min-w-0 flex-col gap-px">
          {matches.map((entry) => (
            <CommandButton
              key={entry.key}
              entry={clearing(entry)}
              className="w-full justify-start"
            />
          ))}
        </div>
      )}
    </form>
  );
}
