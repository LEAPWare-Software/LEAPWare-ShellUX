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

const readme = read('README.md');
const product = read('PRODUCT.md');
console.log(`readme_screen_reader_not_done=${/Screen-reader support is \*\*not done\*\*/.test(readme) ? 1 : 0}`);
console.log(`product_wcag_1_1=${/WCAG 2\.2 AA and an NVDA\s+pass \(GitHub #60\) are 1\.1 work/.test(product) ? 1 : 0}`);
console.log(`product_no_at_run=${/none has ever been run/.test(product) ? 1 : 0}`);

const install = read('docs/INSTALL.md');
const SECTIONS = ['## 2. Installing', '## 3. The unsigned-build warning (SmartScreen)', '## 4. Where the diagnostics log lives', '## 5. How updates arrive', '## 6. Uninstalling'];
console.log(`install_sections=${SECTIONS.filter((h) => install.includes(h)).length}`);
console.log(`install_linked_from_readme=${readme.includes('(docs/INSTALL.md)') ? 1 : 0}`);
