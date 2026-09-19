import type { ReactElement } from 'react';
import { ROW_STATUS_MARK, ROW_STATUS_MARK_CLASS, ROW_STATUS_TEXT_CLASS } from './rowStatusVocabulary';
import type { RowStatusKind } from './rowStatusVocabulary';

/**
 * ============================================================================
 * A ROW'S STATUS LINE. ONE HOST PRIMITIVE, SO "NEVER COLOUR ALONE" IS BY
 * CONSTRUCTION RATHER THAN BY CONVENTION.
 * ============================================================================
 * `docs/design/WAVE3-PLAN.md` W3-2, the v4 row status vocabulary: a status line
 * under a row's title pairs a mark with a word in status ink — warning triangle
 * "Below reorder point", success dot "Delivered", danger mark "Delivery
 * overdue", info dot "Awaiting supplier" — never colour alone (`DESIGN.md`:
 * every status colour has a word or a mark).
 *
 * This component draws exactly two channels, in the shape `RowMetric` draws
 * `DELTA_MARK` + `DELTA_WORD`: a mark, `aria-hidden` because it is a picture,
 * and a word, which is what a screen reader — and a monochrome print — actually
 * reads. `word` is REQUIRED. There is no default and no fallback to the status
 * name, so a caller cannot render the mark without also saying, in the
 * operator's own words, what it means; a future status kind with no honest
 * sentence yet has nothing to render rather than a placeholder that looks
 * finished. See `rowStatusVocabulary.ts` for the WCAG 1.4.1 argument in full and for why
 * the frozen records live there rather than here.
 *
 * The word here is VISIBLE, not `sr-only` — unlike `RowMetric`'s delta, where
 * the mark and a printed magnitude already carry the reader and the word is the
 * accessibility-tree channel alone. A row's status line has no other visible
 * text to carry it, so the word is the row's own printed sentence and the mark
 * is what "survives a monochrome print" beside it.
 *
 * *Tests:* `src/components/__tests__/RowStatus.test.tsx` — "pairs the %s mark
 * with the word, in the status ink" and "draws a mark with no text of its own,
 * so a screen reader is not told about a decoration".
 * ============================================================================
 */

export interface RowStatusProps {
  readonly status: RowStatusKind;
  /** The operator's own sentence, e.g. "Below reorder point". Always visible. */
  readonly word: string;
}

export function RowStatus({ status, word }: RowStatusProps): ReactElement {
  return (
    <span
      data-row-status={status}
      className={`flex min-w-0 items-center gap-1 ${ROW_STATUS_TEXT_CLASS[status]}`}
    >
      <span aria-hidden="true" data-row-status-mark="" className={`flex-none ${ROW_STATUS_MARK_CLASS[status]}`}>
        {ROW_STATUS_MARK[status]}
      </span>
      <span data-row-status-word="" className="truncate">
        {word}
      </span>
    </span>
  );
}
