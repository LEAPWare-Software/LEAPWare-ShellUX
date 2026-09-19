#!/usr/bin/env node
// Rows C-34, C-35 and C-36 (plan step 7): the documented limits, the honest
// accessibility statements, and the operator install guide exist in the tree and say
// what the plan items say. Reads the tree only; builtins only.
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const dev = read('DEVELOPER.md');
const start = dev.indexOf('## Known limits at 1.0');
const end = start === -1 ? -1 : dev.indexOf('\n## ', start + 1);
const limits = start === -1 ? '' : dev.slice(start, end === -1 ? undefined : end);
const LIMIT_ISSUES = ['#91', '#65', '#55', '#61', '#66', '#60'];
console.log(`known_limits_section=${start === -1 ? 0 : 1}`);
console.log(`known_limits_issues=${LIMIT_ISSUES.filter((n) => limits.includes(`[${n}]`)).length}`);
console.log(`known_limits_names_d35_remainder=${limits.includes('[#91]') ? 1 : 0}`);
console.log(`known_limits_promises_nothing=${/None of these is committed to 1\.1/.test(limits) ? 1 : 0}`);

// C-34 (proof audit item 28): the box asserts a derivation — D-13's own issue list minus
// the ones D-36 narrowed it by leaves exactly {#91} — that was never actually computed.
// D-13's row in docs/DECISIONS.md is `| D-13 | ~~...~~ **Superseded for #16, ... by D-36...**
// | Owner | 2026-08-03 | #17, #16, #80, #91, #57, #28/#32/#68. ... |`: the "Superseded for"
// clause in its own second cell names the narrowed-out set, and its own last cell names
// the full original list (slash-joined numbers included).
const decisions = read('docs/DECISIONS.md');
const d13Line = decisions.split('\n').find((l) => l.startsWith('| D-13 |')) ?? '';
const issueNumbers = (text) => [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const supersededMatch = d13Line.match(/Superseded for ([^.]+) by D-36/);
const narrowedOut = new Set(supersededMatch ? issueNumbers(supersededMatch[1]) : []);
const cells = d13Line.split('|').map((c) => c.trim());
// Only the list clause itself (up to the first ". "), not the rest of the sentence,
// which mentions #65 in prose ("#65's author will hit") and is not part of the list.
const lastCell = cells[cells.length - 2] ?? '';
const listClause = lastCell.slice(0, lastCell.indexOf('. '));
const fullList = new Set(issueNumbers(listClause));
const remainder = [...fullList].filter((n) => !narrowedOut.has(n)).sort((a, b) => a - b);
console.log(`d13_full_list_size=${fullList.size}`);
console.log(`d13_narrowed_out_size=${narrowedOut.size}`);
console.log(`d13_minus_d36_remainder=${remainder.join(',')}`);

const readme = read('README.md');
const product = read('PRODUCT.md');
console.log(`readme_screen_reader_not_done=${/Screen-reader support is \*\*not done\*\*/.test(readme) ? 1 : 0}`);
console.log(`product_wcag_1_1=${/WCAG 2\.2 AA and an NVDA\s+pass \(GitHub #60\) are 1\.1 work/.test(product) ? 1 : 0}`);
console.log(`product_no_at_run=${/none has ever been run/.test(product) ? 1 : 0}`);

const install = read('docs/INSTALL.md');
const SECTIONS = ['## 2. Installing', '## 3. The unsigned-build warning (SmartScreen)', '## 4. Where the diagnostics log lives', '## 5. How updates arrive', '## 6. Uninstalling'];
console.log(`install_sections=${SECTIONS.filter((h) => install.includes(h)).length}`);
console.log(`install_linked_from_readme=${readme.includes('(docs/INSTALL.md)') ? 1 : 0}`);
