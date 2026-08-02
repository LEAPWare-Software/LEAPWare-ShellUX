/**
 * ============================================================================
 * WHAT THE COMPOSER BELIEVES YOU ARE DOING. ONE RULE, TWO READERS.
 * ============================================================================
 * `OmniboxComposer.tsx` draws the detected intent as a label BEFORE submit and
 * branches on it AT submit. Those are two readers of one rule, and a rule
 * evaluated twice is a rule that can disagree with itself — the same reasoning
 * ADR-0001 Amendment I Decision 3 gives for refusing a second bare-chord
 * suppression at dispatch time. So the rule is a pure total function here, and
 * both readers call it.
 *
 * **It is a plain `.ts` module and not a second export from the component**, for
 * a mechanical reason worth writing down rather than rediscovering:
 * `react-refresh/only-export-components` is a build gate in this repository
 * (`--max-warnings 0`), it classifies a `.tsx` export by its NAME, and
 * `detectIntent` is not PascalCase. `MailPlugin.tsx` records the same constraint
 * from the other side. The export is shaped to the rule rather than the rule to
 * the export.
 * ============================================================================
 */

/** What the composer believes the user is doing. Host vocabulary, closed. */
export type OmniboxIntent = 'filter' | 'command' | 'ask';

/** Exhaustiveness pin, in the shape `PANE_ID_MEMBERS` uses in `types.ts`. */
const OMNIBOX_INTENT_MEMBERS: Readonly<Record<OmniboxIntent, true>> = Object.freeze({
  filter: true,
  command: true,
  ask: true,
});

/** `OmniboxIntent` as a runtime list. */
export const OMNIBOX_INTENTS: readonly OmniboxIntent[] = Object.freeze(
  Object.keys(OMNIBOX_INTENT_MEMBERS) as OmniboxIntent[],
);

/**
 * Host display text for each intent. Never a plug-in string.
 *
 * `Record<OmniboxIntent, string>` so the compiler rejects a missing intent and an
 * invented one, exactly as `CATEGORY_LABELS` is pinned in `CommandRegistry`.
 */
export const INTENT_LABELS: Readonly<Record<OmniboxIntent, string>> = Object.freeze({
  filter: 'Filter',
  command: 'Command',
  ask: 'Ask',
});

/**
 * The sigils that select the command intent.
 *
 * Sigils rather than words, so they cannot collide with the first word of a
 * filter somebody legitimately wants to type.
 */
export const COMMAND_SIGILS: readonly string[] = Object.freeze(['>', '/']);

/**
 * Which intent a raw input string expresses. **Total, pure, and the only
 * definition of the rule.**
 *
 * Whitespace is trimmed first so that a leading space does not silently change
 * what a sigil means. An empty string is `filter`, because the default has to be
 * the harmless one: an empty `command` would mean "run something" with nothing
 * named.
 */
export function detectIntent(value: string): OmniboxIntent {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 'filter';
  }
  if (COMMAND_SIGILS.some((sigil) => trimmed.startsWith(sigil))) {
    return 'command';
  }
  if (trimmed.startsWith('?') || trimmed.endsWith('?')) {
    return 'ask';
  }
  return 'filter';
}

/** The text a `command` intent is searching for: the sigil removed, trimmed. */
export function commandQueryOf(value: string): string {
  const trimmed = value.trim();
  return COMMAND_SIGILS.some((sigil) => trimmed.startsWith(sigil))
    ? trimmed.slice(1).trim()
    : trimmed;
}
