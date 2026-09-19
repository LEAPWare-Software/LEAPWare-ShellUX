#!/usr/bin/env node
// Row C-41 (plan step 3): the audit gap (HANDOFF §6.2) is closed by a dev-tree-included
// job in audit-dependencies.yml running the same --audit-level=high threshold as the
// production audit. Reads the tree only; builtins only.
import { existsSync, readFileSync } from 'node:fs';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const workflow = read('.github/workflows/audit-dependencies.yml');
const pkg = JSON.parse(read('package.json') || '{}');
const auditAll = pkg.scripts?.['audit:all'] ?? '';

console.log(`audit_all_job=${/^\s*audit-all:/m.test(workflow) ? 1 : 0}`);
console.log(`audit_all_step_runs_script=${/run: npm run audit:all/.test(workflow) ? 1 : 0}`);
console.log(`audit_all_full_tree=${/^npm audit --audit-level=high$/.test(auditAll.trim()) ? 1 : 0}`);
