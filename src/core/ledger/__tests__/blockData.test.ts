import { describe, expect, it } from 'vitest';
import { BLOCK_VIEW_LIMITS, readChart, readFields, readTable, readText } from '../blockData';

/**
 * ============================================================================
 * FIVE TOTAL READERS, AT THE SHAPES A PUBLISHER REALLY GETS WRONG
 * ============================================================================
 * `publishPayload` validates that a payload is WELL-FORMED — primitives at the
 * leaves, bounded, acyclic — and never that it is the table its `kind` claims.
 * These readers are what stands between that gap and pane 3's render, so every
 * case here is a payload the channel would happily have accepted.
 * ============================================================================
 */

describe('readTable', () => {
  it('reads a well-formed table and nothing else as one', () => {
    const view = readTable({
      columns: ['sku', 'stock'],
      rows: [
        ['FST-1', 12],
        ['FST-2', null],
      ],
    });

    expect(view.columns).toEqual(['sku', 'stock']);
    // A `null` cell reads as an em dash rather than as the word "null", which is
    // a value the publisher never wrote.
    expect(view.rows).toEqual([
      ['FST-1', '12'],
      ['FST-2', '—'],
    ]);
  });

  it('reads every shape that is not a table as the empty table', () => {
    for (const data of [null, 'table', 7, [], { columns: ['a'] }, { rows: [] }]) {
      expect(readTable(data)).toEqual({ columns: [], rows: [] });
    }
  });

  it('truncates rather than refusing, and the truncation is visible to its caller', () => {
    const rows = Array.from({ length: BLOCK_VIEW_LIMITS.MAX_ROWS + 10 }, (_unused, i) => [i]);
    const view = readTable({ columns: ['n'], rows });
    // The caller draws a note when the count equals the bound; the inspector
    // still holds the whole payload, so nothing is hidden, only deferred.
    expect(view.rows).toHaveLength(BLOCK_VIEW_LIMITS.MAX_ROWS);
  });

  it('reads a scalar row as a row of one, and drops columns past the bound', () => {
    expect(readTable({ columns: ['n'], rows: [5] }).rows).toEqual([['5']]);
    const wide = Array.from({ length: BLOCK_VIEW_LIMITS.MAX_COLUMNS + 4 }, (_unused, i) => `c${String(i)}`);
    expect(readTable({ columns: wide, rows: [wide] }).columns).toHaveLength(
      BLOCK_VIEW_LIMITS.MAX_COLUMNS,
    );
    // A nested container is not a cell; it reads as empty rather than as
    // "[object Object]".
    expect(readTable({ columns: ['n'], rows: [[{ a: 1 }]] }).rows).toEqual([['']]);
  });
});

describe('readText', () => {
  it('reads a text block and treats a missing string as empty', () => {
    expect(readText({ text: 'hello' })).toBe('hello');
    // A leaf at the root is legal `PayloadValue`, and refusing one would mean a
    // publisher had to wrap a sentence in an object to say a sentence.
    expect(readText('hello')).toBe('hello');
    for (const data of [null, 7, true, [], {}, { text: 7 }]) {
      expect(readText(data)).toBe('');
    }
  });
});

describe('readFields', () => {
  it('reads form fields, dropping any that are not fields', () => {
    const fields = readFields({
      fields: [
        { name: 'category', label: 'Category', value: 'valves' },
        // No name: there is nothing to key a submission by, so it is dropped.
        { label: 'Nameless' },
        // No label: the name is a worse label than the publisher's and is not
        // nothing, which is what an unlabelled control announces as.
        { name: 'minimum' },
        'not a field',
        { name: '' },
      ],
    });

    expect(fields).toEqual([
      { name: 'category', label: 'Category', value: 'valves' },
      { name: 'minimum', label: 'minimum', value: '' },
    ]);
  });

  it('reads every shape that is not a field list as no fields', () => {
    for (const data of [null, 'fields', { fields: 7 }, []]) {
      expect(readFields(data)).toEqual([]);
    }
  });

  it('stops at the field bound', () => {
    const many = Array.from({ length: BLOCK_VIEW_LIMITS.MAX_FIELDS + 6 }, (_unused, i) => ({
      name: `f${String(i)}`,
    }));
    expect(readFields({ fields: many })).toHaveLength(BLOCK_VIEW_LIMITS.MAX_FIELDS);
  });
});

describe('readChart', () => {
  it('reads a well-formed spec through the same normaliser the door uses', () => {
    const read = readChart({ kind: 'line', title: 'T', series: [{ name: 'a', values: [1, 2] }] });
    expect(read.ok).toBe(true);
    expect(read.ok && read.spec.series[0]?.colorIndex).toBe(1);
  });

  it('reports why a chart was refused rather than drawing something else', () => {
    // The publisher's own rejection message reaches the pane. A publisher who
    // supplied a colour reads "a series never does" on screen, not in a
    // debugger — and the ledger stays up.
    const read = readChart({
      kind: 'line',
      title: 'T',
      series: [{ name: 'a', values: [1], color: '#ff0000' }],
    });
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.reason).toContain('colour alone');

    const shapeless = readChart('not a chart');
    expect(shapeless.ok).toBe(false);
    expect(shapeless.ok ? '' : shapeless.reason).toContain('plain object');
  });
});
