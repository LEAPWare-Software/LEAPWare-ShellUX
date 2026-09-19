/**
 * Reading task items out of a plan file: docs/proof-of-completion.md §3.2.
 *
 * Two independent readers, and a disagreement between them is an error rather than a
 * tie to break. The first is remark with GFM, which is how a CommonMark parser sees the
 * file. The second is a raw line scan, which is how a person skimming the source sees
 * it. When the two disagree about whether a line is a task item, the file is ambiguous:
 * a reader and the gate would be looking at different lists, which is the failure this
 * protocol exists to prevent. So the item is reported as "ambiguous task item" and the
 * run fails, instead of the gate silently picking one reading.
 *
 * GitHub's own renderer is a third reader, and it disagrees with remark in one case
 * found while building this: when the file defines a link reference labelled `x`, GitHub
 * renders `- [x] item` as a link and no checkbox, while remark still reports a checked
 * task item. That case is therefore also reported as ambiguous. The GitHub renderings
 * that establish both readings are committed as a fixture.
 * *Tests:* scripts/__tests__/claims-plan.test.mjs — "reports a [x] item as ambiguous when the file defines a link reference labelled x".
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

/** The raw scan: optional blockquote markers, a list marker, Unicode whitespace, a box. */
export const RAW_TASK = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/u;

/** One `[C-nn]` register tag. */
export const TAG = /\[(C-\d+)\]/g;

/** A heading's `(x/y)` count; the last one on the line is the count. */
const HEADING_COUNT = /\((\d+)\/(\d+)\)/g;

const parser = unified().use(remarkParse).use(remarkGfm);

function walk(node, visit, parents = []) {
  visit(node, parents);
  for (const child of node.children ?? []) walk(child, visit, [...parents, node]);
}

/** Offsets at which each line starts, so a (line) can be turned into a source offset. */
function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Remove every `[C-nn]` tag, collapse whitespace, trim: the §3.2 item-text rule. */
export function normaliseItemText(raw) {
  return raw.replace(TAG, ' ').replace(/\s+/gu, ' ').trim();
}

/**
 * Parse a plan file.
 *
 * Returns `{ items, headings, errors }`. Each item is
 * `{ line, checked, text, rawText, tags }`: `line` is 1-based, `rawText` the source slice
 * from after the box to the end of the item's first paragraph, `text` that slice
 * normalised, `tags` the register ids it cites. Each heading with an `(x/y)` count is
 * `{ line, depth, stated: {checked, total}, actual: {checked, total} }`. `errors` lists
 * ambiguity findings as `{ line, message }`.
 */
export function parsePlan(source) {
  const tree = parser.parse(source);
  const starts = lineStarts(source);
  const lines = source.split('\n');

  const items = [];
  const excludedLines = new Set();
  const headingNodes = [];
  const xDefinitions = [];

  walk(tree, (node) => {
    const start = node.position?.start.line;
    const end = node.position?.end.line;
    if (node.type === 'code' || node.type === 'html' || node.type === 'definition') {
      for (let l = start; l <= end; l += 1) excludedLines.add(l);
    }
    if (node.type === 'definition' && /^[xX]$/.test(node.label ?? '')) xDefinitions.push(start);
    if (node.type === 'heading') headingNodes.push(node);
    if (node.type === 'listItem' && typeof node.checked === 'boolean') {
      const line = start;
      const lineText = lines[line - 1];
      const box = lineText.match(/\[[ xX]\]\s*/u);
      const from = starts[line - 1] + (box ? box.index + box[0].length : lineText.length);
      const first = node.children[0];
      const to = first && first.type === 'paragraph' ? first.position.end.offset : from;
      const rawText = to > from ? source.slice(from, to) : '';
      const tags = [...rawText.matchAll(TAG)].map((m) => m[1]);
      items.push({ line, checked: node.checked, text: normaliseItemText(rawText), rawText, tags });
    }
  });

  const errors = [];
  const itemLines = new Set(items.map((item) => item.line));
  const rawLines = new Set();
  lines.forEach((text, index) => {
    const line = index + 1;
    if (RAW_TASK.test(text) && !excludedLines.has(line)) rawLines.add(line);
  });
  for (const line of rawLines) {
    if (!itemLines.has(line)) {
      errors.push({ line, message: 'ambiguous task item: the source reads as a task item and the parser does not' });
    }
  }
  for (const line of itemLines) {
    if (!rawLines.has(line)) {
      errors.push({ line, message: 'ambiguous task item: the parser reads a task item the source scan does not' });
    }
  }
  if (xDefinitions.length > 0) {
    for (const item of items) {
      if (item.checked) {
        errors.push({
          line: item.line,
          message: `ambiguous task item: a link reference labelled x is defined on line ${xDefinitions[0]}, so GitHub renders this box as a link`,
        });
      }
    }
  }

  const headings = [];
  headingNodes.forEach((node, index) => {
    const line = node.position.start.line;
    const counts = [...lines[line - 1].matchAll(HEADING_COUNT)];
    if (counts.length === 0) return;
    const last = counts[counts.length - 1];
    let endLine = Infinity;
    for (const next of headingNodes.slice(index + 1)) {
      if (next.depth <= node.depth) {
        endLine = next.position.start.line;
        break;
      }
    }
    const inside = items.filter((item) => item.line > line && item.line < endLine);
    headings.push({
      line,
      depth: node.depth,
      stated: { checked: Number(last[1]), total: Number(last[2]) },
      actual: { checked: inside.filter((item) => item.checked).length, total: inside.length },
    });
  });

  errors.sort((a, b) => a.line - b.line);
  return { items, headings, errors };
}

/** Heading counts that disagree with their items, as `{ line, message }`. */
export function headingErrors(headings) {
  return headings
    .filter((h) => h.stated.checked !== h.actual.checked || h.stated.total !== h.actual.total)
    .map((h) => ({
      line: h.line,
      message: `heading says (${h.stated.checked}/${h.stated.total}) but its items count (${h.actual.checked}/${h.actual.total})`,
    }));
}
