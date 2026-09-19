import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RowStatus } from '../ui/RowStatus';
import {
  ROW_STATUS_MARK,
  ROW_STATUS_MARK_CLASS,
  ROW_STATUS_TEXT_CLASS,
} from '../ui/rowStatusVocabulary';
import type { RowStatusKind } from '../ui/rowStatusVocabulary';

/**
 * ============================================================================
 * THE ROW STATUS LINE'S DOM, AND ONLY ITS DOM.
 * ============================================================================
 * The status colour, the mark's shape and the word's contrast on the row are
 * painted facts jsdom cannot see, and are measured in `e2e/list-rows.spec.ts`
 * ("every status line renders its mark and its word and the word clears 4.5:1
 * on the row in all three themes"). What is asserted here is what the DOM alone
 * decides: which mark and which ink class a status gets, that the mark carries
 * `aria-hidden` and no text a screen reader would read twice, and that the word
 * — the one required prop — is what a reader actually sees.
 * ============================================================================
 */

const STATUSES: readonly RowStatusKind[] = ['danger', 'warning', 'success', 'info'];

describe('RowStatus — the mark and the word, and nothing colour alone says', () => {
  it.each(STATUSES)('pairs the %s mark with the word, in the status ink', (status) => {
    const { container } = render(<RowStatus status={status} word="Example status" />);
    const line = container.querySelector(`[data-row-status="${status}"]`);
    expect(line).not.toBeNull();
    expect(line).toHaveClass(ROW_STATUS_TEXT_CLASS[status]);

    const mark = container.querySelector('[data-row-status-mark]');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveClass(ROW_STATUS_MARK_CLASS[status]);
    expect(mark?.textContent).toBe(ROW_STATUS_MARK[status]);

    expect(screen.getByText('Example status')).toBeInTheDocument();
  });

  it('draws a mark with no text of its own, so a screen reader is not told about a decoration', () => {
    const { container } = render(<RowStatus status="warning" word="Below reorder point" />);
    const mark = container.querySelector('[data-row-status-mark]');
    // The mark IS text content (the glyph), but it is hidden from the
    // accessibility tree; the word beside it is what a screen reader reads.
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-row-status-word]')).toHaveTextContent(
      'Below reorder point',
    );
  });

  it('resolves every status kind to a non-empty mark, so a typo cannot leave one blank', () => {
    // Not a claim that all four glyphs differ from one another — `success` and
    // `info` share a dot, by the plan's own words ("success dot", "info dot"),
    // and the word beside each is what tells them apart. What this pins is that
    // every kind resolves to SOME glyph, so a typo in `ROW_STATUS_MARK` cannot
    // leave a status silently blank.
    for (const status of STATUSES) {
      expect(ROW_STATUS_MARK[status].length).toBeGreaterThan(0);
    }
  });
});
