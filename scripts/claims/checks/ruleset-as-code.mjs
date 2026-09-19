#!/usr/bin/env node
// Row C-38 (plan step 3): the ruleset lives as code, matching sessionkeeper's shape,
// with its applier script and its maintainer doc. Reads the tree only; builtins only.
import { existsSync, readFileSync } from 'node:fs';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const ruleset = JSON.parse(read('.github/rulesets/main.json') || '{}');
const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
const byType = (t) => rules.find((r) => r.type === t) ?? {};

console.log(`ruleset_bypass_actors_empty=${Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0 ? 1 : 0}`);
console.log(`ruleset_deletion=${rules.some((r) => r.type === 'deletion') ? 1 : 0}`);
console.log(`ruleset_non_fast_forward=${rules.some((r) => r.type === 'non_fast_forward') ? 1 : 0}`);

const pr = byType('pull_request').parameters ?? {};
console.log(`ruleset_pr_zero_approvals=${pr.required_approving_review_count === 0 ? 1 : 0}`);
console.log(`ruleset_squash_only=${Array.isArray(pr.allowed_merge_methods) && pr.allowed_merge_methods.length === 1 && pr.allowed_merge_methods[0] === 'squash' ? 1 : 0}`);

const checks = byType('required_status_checks').parameters ?? {};
const contexts = (checks.required_status_checks ?? []).map((c) => c.context);
const NAMED = ['Verify (ubuntu-latest)', 'Verify (macos-latest)', 'Verify (windows-latest)', 'Browser tests (chromium)', 'Declared Node floor (22.13.0)'];
console.log(`ruleset_strict=${checks.strict_required_status_checks_policy === true ? 1 : 0}`);
console.log(`ruleset_named_checks=${NAMED.filter((c) => contexts.includes(c)).length}`);

const mergeQueue = byType('merge_queue').parameters ?? {};
console.log(`ruleset_merge_queue_allgreen=${mergeQueue.grouping_strategy === 'ALLGREEN' ? 1 : 0}`);

const applier = read('scripts/apply-rulesets.mjs');
console.log(`applier_exists=${existsSync('scripts/apply-rulesets.mjs') ? 1 : 0}`);
console.log(`applier_dry_run=${/--dry-run/.test(applier) ? 1 : 0}`);
console.log(`applier_test_exists=${existsSync('scripts/__tests__/apply-rulesets.test.mjs') ? 1 : 0}`);
console.log(`applier_test_node_test=${/from ['"]node:test['"]/.test(read('scripts/__tests__/apply-rulesets.test.mjs')) ? 1 : 0}`);

const settingsDoc = read('docs/maintainers/repository-settings.md');
console.log(`settings_doc_exists=${existsSync('docs/maintainers/repository-settings.md') ? 1 : 0}`);
console.log(`settings_doc_dry_run=${/--dry-run/.test(settingsDoc) ? 1 : 0}`);
console.log(`settings_doc_squash_patch=${/allow_squash_merge/.test(settingsDoc) ? 1 : 0}`);
console.log(`settings_doc_bootstrap_owner_only=${/[Bb]ootstrap is owner-only/.test(settingsDoc) ? 1 : 0}`);

console.log(`ci_merge_group=${/^\s*merge_group:/m.test(read('.github/workflows/ci.yml')) ? 1 : 0}`);
console.log(`browser_merge_group=${/^\s*merge_group:/m.test(read('.github/workflows/browser.yml')) ? 1 : 0}`);
