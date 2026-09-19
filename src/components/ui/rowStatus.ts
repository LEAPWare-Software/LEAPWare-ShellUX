import { TOKEN_CLASS } from '../../core/theme/tokenClasses';

/**
 * ============================================================================
 * THE ROW STATUS VOCABULARY, AS PURE DATA.
 * ============================================================================
 * Separated from `RowStatus.tsx` for the reason `rowDelta.ts` is separated from
 * `RowMetric.tsx`: a module that exports a component and a frozen data record
 * both is the shape `eslint-plugin-react-refresh` flags at `--max-warnings 0`
 * once a second consumer needs the record on its own, and the split is
 * load-bearing beyond the lint rule — this is the part a test can exercise at
 * its edges without rendering anything.
 *
 * **WCAG 1.4.1 is the whole design, exactly as `rowDelta.ts` states it for a
 * delta's direction.** A status is said two ways: a shape (the mark, `aria-hidden`
 * so a screen reader is not told about a decoration) and a word (the row's own
 * text, in status ink). Colour is the ink the word is set in, never the only
 * channel — remove it and the mark and the word still say what happened.
 *
 * The word itself is NOT in this file. `Record<RowStatusKind, string>` would
 * fix one sentence per status for every caller, and the v4 canvas' four words
 * ("Below reorder point", "Delivered", "Delivery overdue", "Awaiting supplier")
 * are a fact about the inventory list, not about the status vocabulary itself —
 * a future caller with its own honest status says its own sentence. So `word` is
 * a required prop on `RowStatus`, not a lookup here: there is no way to render
 * the mark without one, which is what makes "never colour alone" true by
 * construction rather than by convention.
 *
 * *Tests:* `src/components/__tests__/RowStatus.test.tsx`.
 * ============================================================================
 */

/** The four statuses a row's status line can carry. A closed vocabulary. */
export type RowStatusKind = 'danger' | 'warning' | 'success' | 'info';

/** The mark, per status. `aria-hidden` at the call site: decoration only. */
export const ROW_STATUS_MARK: Readonly<Record<RowStatusKind, string>> = Object.freeze({
  danger: '✕',
  warning: '▲',
  success: '●',
  info: '●',
});

/** The mark's ink. 3:1 non-text colour, same tier `Banner` draws its icon in. */
export const ROW_STATUS_MARK_CLASS: Readonly<Record<RowStatusKind, string>> = Object.freeze({
  danger: TOKEN_CLASS.statusDangerMark,
  warning: TOKEN_CLASS.statusWarningMark,
  success: TOKEN_CLASS.statusSuccessMark,
  info: TOKEN_CLASS.statusInfoMark,
});

/** The word's ink. 4.5:1 on the row, same tier `Banner` draws its title in. */
export const ROW_STATUS_TEXT_CLASS: Readonly<Record<RowStatusKind, string>> = Object.freeze({
  danger: TOKEN_CLASS.statusDangerText,
  warning: TOKEN_CLASS.statusWarningText,
  success: TOKEN_CLASS.statusSuccessText,
  info: TOKEN_CLASS.statusInfoText,
});
