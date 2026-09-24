#!/usr/bin/env node
// Row C-44: D-27 is struck through as superseded by D-34 now that a branch-protection
// ruleset (23685990, D-50) is actually applied, matching the D-09/D-11/D-12 strike
// pattern; D-09, D-11 and D-12 stay struck (regression guard); D-31 through D-35 exist.
import { readFileSync } from 'node:fs';

const decisions = readFileSync('docs/DECISIONS.md', 'utf8');

/** The Decision-column cell of a `| D-NN | <cell> | ...` row, or '' if the row is absent. */
function decisionCell(id, text) {
  const row = text.split('\n').find((line) => line.startsWith(`| ${id} |`));
  if (!row) return '';
  const cells = row.split('|');
  // cells[0] is '' (before the leading pipe), cells[1] is the id, cells[2] is the Decision cell.
  return (cells[2] ?? '').trim();
}

const d27 = decisionCell('D-27', decisions);
const d27Struck = /^~~.*~~/.test(d27) && /Superseded by D-34/.test(d27) ? 1 : 0;

const struckAndSuperseded = (id) => {
  const cell = decisionCell(id, decisions);
  return /^~~.*~~/.test(cell) && /Superseded/.test(cell) ? 1 : 0;
};

console.log(`d27_struck=${d27Struck}`);
console.log(`d09_still_struck=${struckAndSuperseded('D-09')}`);
console.log(`d11_still_struck=${struckAndSuperseded('D-11')}`);
console.log(`d12_still_struck=${struckAndSuperseded('D-12')}`);
console.log(`d31_through_d35_present=${['D-31', 'D-32', 'D-33', 'D-34', 'D-35'].filter((id) => decisionCell(id, decisions) !== '').length}`);
