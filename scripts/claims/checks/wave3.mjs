#!/usr/bin/env node
// Rows C-32 and C-33 (plan step 5): the wave-3 plan exists with its increments, its
// R1-R9 critique table and its file-ownership table, and the #23 re-fit is in
// `ShellLayout.tsx` and pinned by browser-lane and unit tests.
import { existsSync, readFileSync } from 'node:fs';

const plan = existsSync('docs/design/WAVE3-PLAN.md') ? readFileSync('docs/design/WAVE3-PLAN.md', 'utf8') : '';
const increments = new Set([...plan.matchAll(/^### (W3-\d)\b/gm)].map((m) => m[1]));
console.log(`wave3_plan_increments=${increments.size}`);
console.log(`wave3_plan_critique_rows=${new Set([...plan.matchAll(/^\| (R[1-9]) \|/gm)].map((m) => m[1])).size}`);
console.log(`wave3_plan_ownership_table=${/^## Rule 6: who owns which file$/m.test(plan) ? 1 : 0}`);

const e2e = existsSync('e2e/pane-refit.spec.ts') ? readFileSync('e2e/pane-refit.spec.ts', 'utf8') : '';
const E2E_TITLES = [
  'keeps every pane inside its pixel band when a restored layout is narrowed live',
  'returns to the dragged widths when a narrowed window is widened again, and never rewrites the stored layout',
  'keeps an untouched navigation pane on its 240px intent across a live resize, where a reload opens it',
  'narrow, drag the second divider, widen, reload: pane 1 keeps the width the user chose',
  'opened narrow on a stored layout, drag divider 2, widen and reload: pane 1 keeps the stored width',
];
// A skipped, fixme'd or .only-ed case still contains its title string, so counting
// titles alone can pass a suite that never actually runs one of them (or runs only
// one, leaving the rest silently unexecuted under .only). Zero the count outright if
// any such marker appears anywhere in the file.
const hasSkipLikeMarker = /\.(skip|fixme|only)\s*\(/.test(e2e);
console.log(`pane_refit_e2e_skip_fixme_only=${hasSkipLikeMarker ? 1 : 0}`);
console.log(`pane_refit_e2e_titles=${hasSkipLikeMarker ? 0 : E2E_TITLES.filter((t) => e2e.includes(`test('${t}'`)).length}`);
const unit = 'src/components/__tests__/ShellLayoutRefit.test.tsx';
console.log(`pane_refit_unit_file=${existsSync(unit) ? 1 : 0}`);

// The re-fit itself: a width change sets the group's layout, and a report arriving
// mid-width-change is passed to the store as a correction, which is not saved.
const layout = readFileSync('src/components/layout/ShellLayout.tsx', 'utf8');
console.log(`refit_sets_layout_on_width_change=${/previous !== bandWidth[\s\S]{0,600}group\.setLayout\(/.test(layout) ? 1 : 0}`);
console.log(`refit_marks_corrections=${/persistPaneSize\(pane, size, previousSize, isCorrection\)/.test(layout) ? 1 : 0}`);
