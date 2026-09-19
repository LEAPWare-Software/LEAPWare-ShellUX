#!/usr/bin/env node
// Rows C-32 and C-33 (plan step 5): the wave-3 plan exists with its increments and its
// file-ownership table, and the #23 re-fit is pinned by browser-lane and unit tests.
import { existsSync, readFileSync } from 'node:fs';

const plan = existsSync('docs/design/WAVE3-PLAN.md') ? readFileSync('docs/design/WAVE3-PLAN.md', 'utf8') : '';
const increments = new Set([...plan.matchAll(/^### (W3-\d)\b/gm)].map((m) => m[1]));
console.log(`wave3_plan_increments=${increments.size}`);
console.log(`wave3_plan_ownership_table=${/^## Rule 6: who owns which file$/m.test(plan) ? 1 : 0}`);

const e2e = existsSync('e2e/pane-refit.spec.ts') ? readFileSync('e2e/pane-refit.spec.ts', 'utf8') : '';
const E2E_TITLES = [
  'keeps every pane inside its pixel band when a restored layout is narrowed live',
  'returns to the dragged widths when a narrowed window is widened again, and never rewrites the stored layout',
  'narrow, drag the second divider, widen, reload: pane 1 keeps the width the user chose',
  'opened narrow on a stored layout, drag divider 2, widen and reload: pane 1 keeps the stored width',
];
console.log(`pane_refit_e2e_titles=${E2E_TITLES.filter((t) => e2e.includes(t)).length}`);
const unit = 'src/components/__tests__/ShellLayoutRefit.test.tsx';
console.log(`pane_refit_unit_file=${existsSync(unit) ? 1 : 0}`);
const layout = readFileSync('src/components/layout/ShellLayout.tsx', 'utf8');
console.log(`refit_uses_fit_pane_layout=${/fitPaneLayout\(/.test(layout) ? 1 : 0}`);
