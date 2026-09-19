#!/usr/bin/env node
// Row C-28: PR A of the proof-of-completion protocol is in the tree and wired: the
// register, the scripts, `npm run status`, both workflows (added not required; PR B made them required), the template
// headings and fields, the CLAUDE.md rule, the tests in test:scripts, and every ticked
// plan item migrated to a tag. Reads the tree only; builtins only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const scripts = ['lib', 'plan', 'lint-boxes', 'prove-claims', 'lint-prose', 'compare-ruleset', 'pr-evidence'];
const pkg = JSON.parse(read('package.json'));
const register = JSON.parse(read('docs/claims.json') || '{}');
const ruleset = read('.github/rulesets/main.json');
const template = read('.github/PULL_REQUEST_TEMPLATE.md');
const testScripts = (pkg.scripts?.['test:scripts'] ?? '').split(/\s+/);
const tests = readdirSync('scripts/__tests__').filter((f) => /^(claims-.*|status|required-checks)\.test\.mjs$/.test(f));
const plans = readdirSync('docs/plans').filter((f) => f.endsWith('.md')).map((f) => read(`docs/plans/${f}`));
const ticked = plans.flatMap((t) => t.split('\n').filter((l) => /^\s*[-*+] \[[xX]\]/.test(l)));

console.log(`claims_scripts_present=${scripts.filter((s) => existsSync(`scripts/claims/${s}.mjs`)).length}`);
console.log(`status_wired=${existsSync('scripts/status.mjs') && pkg.scripts?.status === 'node scripts/status.mjs' ? 1 : 0}`);
// The job is `Prove claims` on every event but a dispatch, which is `Prove claims (dispatch)`.
console.log(`claims_workflow=${/^ {4}name: (Prove claims|\$\{\{ github\.event_name == 'workflow_dispatch' && 'Prove claims \(dispatch\)' \|\| 'Prove claims' \}\})$/m.test(read('.github/workflows/claims.yml')) ? 1 : 0}`);
console.log(`evidence_workflow=${/^ {4}name: PR evidence$/m.test(read('.github/workflows/pr-evidence.yml')) ? 1 : 0}`);
console.log(`new_checks_required=${['Prove claims', 'PR evidence'].filter((c) => ruleset.includes(`"${c}"`)).length}`);
console.log(`register_schema_version=${register.schemaVersion}`);
console.log(`template_headings=${['## Evidence', '## Not done', '## Review'].filter((h) => new RegExp(`^${h}$`, 'm').test(template)).length}`);
console.log(`template_review_fields=${['Reviewer:', 'Reviewed SHA:', 'Verdict:', 'Rows reviewed:', 'Items removed or reworded:', 'Gate changes:'].filter((f) => new RegExp(`^${f}$`, 'm').test(template)).length}`);
console.log(`claude_prose_rule=${read('CLAUDE.md').includes('Prose point to plan item, never declare done') ? 1 : 0}`);
console.log(`claims_tests=${tests.length}`);
console.log(`claims_tests_unwired=${tests.filter((f) => !testScripts.includes(`scripts/__tests__/${f}`)).length}`);
console.log(`ticked_items_without_tag=${ticked.filter((l) => !/\[C-\d+\]/.test(l)).length}`);
