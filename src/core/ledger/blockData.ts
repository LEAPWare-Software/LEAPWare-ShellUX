import { normalizeChartSpec } from '../chart/chartSpec';
import type { ChartSpec } from '../chart/chartSpec';
import type { PayloadValue } from '../types';

/**
 * ============================================================================
 * FIVE BLOCK KINDS, FIVE TOTAL READERS. NONE OF THEM THROWS.
 * ============================================================================
 * A block's `data` has been through the payload channel, so it is a host-owned
 * deep copy of primitives, frozen arrays and null-prototype records — it cannot
 * carry a getter, a prototype or a cycle. What it CAN be is the wrong SHAPE:
 * `publishPayload` validates that a payload is well-formed, never that it is the
 * table its `kind` claims.
 *
 * So every reader here is total, and returns an EMPTY view rather than throwing.
 * The caller is pane 3's render, and the two alternatives were both worse: a
 * throw takes the whole ledger to a fault surface over one malformed block, and
 * a guess draws something the publisher did not ask for. An empty view renders
 * as a visible "this block published nothing readable", which is a defect the
 * publisher can see.
 *
 * **The chart reader is the exception that proves it.** `normalizeChartSpec` is
 * a rejecting boundary — it has to be, because it is also the imperative door —
 * so `readChart` CATCHES its rejection and reports the reason as text. The
 * rejection is not swallowed: the message the publisher would have got at an
 * imperative door is what pane 3 draws.
 *
 * *Tests:* `src/core/ledger/__tests__/blockData.test.ts` — "reads a well-formed
 * table and nothing else as one", "reports why a chart was refused rather than
 * drawing something else", "reads a text block and treats a missing string as
 * empty" and "reads form fields, dropping any that are not fields".
 * ============================================================================
 */

/** How many rows, columns and fields a block will draw before it stops. */
export const BLOCK_VIEW_LIMITS = Object.freeze({
  MAX_ROWS: 500,
  MAX_COLUMNS: 24,
  MAX_FIELDS: 24,
});

/** A record, once it is known to be one. Payload records are null-prototype. */
function asRecord(value: PayloadValue): Record<string, PayloadValue> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, PayloadValue>)
    : null;
}

/** A leaf as display text. `null` reads as an em dash, not as the word "null". */
function asCell(value: PayloadValue): string {
  if (value === null) {
    return '—';
  }
  return typeof value === 'object' ? '' : String(value);
}

/** A table block, read. */
export interface TableView {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** The empty table, shared, so an unreadable block does not allocate. */
const EMPTY_TABLE: TableView = Object.freeze({
  columns: Object.freeze([]),
  rows: Object.freeze([]),
});

/**
 * `{ columns: string[], rows: leaf[][] }` as a table, or the empty table.
 *
 * Rows are truncated at `MAX_ROWS` rather than refused. That is the one place a
 * reader here does guess, and the guess is defensible: the publisher's data is
 * all present in the inspector, and a 4096-row table rendered into the DOM would
 * make pane 3 unusable while claiming to be helpful. The truncation is VISIBLE —
 * `LedgerBlock` draws the count — which is what stops it being a silent lie.
 */
export function readTable(data: PayloadValue): TableView {
  const record = asRecord(data);
  if (record === null || !Array.isArray(record['columns']) || !Array.isArray(record['rows'])) {
    return EMPTY_TABLE;
  }
  const columns = record['columns']
    .slice(0, BLOCK_VIEW_LIMITS.MAX_COLUMNS)
    .map((column) => asCell(column));
  const rows = record['rows'].slice(0, BLOCK_VIEW_LIMITS.MAX_ROWS).map((row) =>
    Object.freeze(
      (Array.isArray(row) ? row : [row])
        .slice(0, BLOCK_VIEW_LIMITS.MAX_COLUMNS)
        .map((cell) => asCell(cell)),
    ),
  );
  return Object.freeze({ columns: Object.freeze(columns), rows: Object.freeze(rows) });
}

/**
 * `{ text: string }` as a string, or the empty string.
 *
 * A bare string payload is also read, because `PayloadValue` admits a leaf at
 * the root and refusing one would mean a publisher had to wrap a sentence in an
 * object to say a sentence.
 */
export function readText(data: PayloadValue): string {
  if (typeof data === 'string') {
    return data;
  }
  const record = asRecord(data);
  const text = record === null ? undefined : record['text'];
  return typeof text === 'string' ? text : '';
}

/** One field of a form block. */
export interface FormField {
  readonly name: string;
  readonly label: string;
  readonly value: string;
}

/** The empty field list, shared. */
const NO_FIELDS: readonly FormField[] = Object.freeze([]);

/**
 * `{ fields: [{ name, label, value }] }` as fields, dropping what is not one.
 *
 * `name` is required and must be a non-empty string, because it is what the
 * submission is keyed by; `label` falls back to `name`, because a field with no
 * label is a control a screen reader announces as nothing, and the name is a
 * worse label than the publisher's but is not nothing.
 */
export function readFields(data: PayloadValue): readonly FormField[] {
  const record = asRecord(data);
  const raw = record === null ? undefined : record['fields'];
  if (!Array.isArray(raw)) {
    return NO_FIELDS;
  }
  const fields: FormField[] = [];
  for (const entry of raw.slice(0, BLOCK_VIEW_LIMITS.MAX_FIELDS)) {
    const field = asRecord(entry);
    const name = field === null ? undefined : field['name'];
    if (typeof name !== 'string' || name === '') {
      continue;
    }
    const label = field?.['label'];
    fields.push(
      Object.freeze({
        name,
        label: typeof label === 'string' && label !== '' ? label : name,
        value: asCell(field?.['value'] ?? ''),
      }),
    );
  }
  return Object.freeze(fields);
}

/** A chart block, read: either a spec or the reason there is not one. */
export type ChartRead =
  | { readonly ok: true; readonly spec: ChartSpec }
  | { readonly ok: false; readonly reason: string };

/**
 * A chart spec, or the rejection `normalizeChartSpec` decided on, as text.
 *
 * The catch is narrow on purpose: it converts a REJECTION into a rendering,
 * and it does not convert a programming error into one. Everything
 * `normalizeChartSpec` throws is a `ShellUXError` carrying a message written for
 * the publisher, and that message is what pane 3 shows — so a publisher who
 * supplied a colour reads "a series never does", in the shell, without a
 * debugger.
 */
export function readChart(data: PayloadValue): ChartRead {
  try {
    return { ok: true, spec: normalizeChartSpec(data) };
  } catch (error) {
    // No `instanceof Error` narrowing, deliberately. Everything
    // `normalizeChartSpec` throws is a `ShellUXError`, which IS an `Error`, so a
    // non-Error branch here would be one no test could reach — and an
    // unreachable branch is not a defended one, it is an unchecked one that the
    // coverage gate would report as covered because it is never evaluated.
    return { ok: false, reason: (error as Error).message };
  }
}
