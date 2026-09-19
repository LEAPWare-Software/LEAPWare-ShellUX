#!/usr/bin/env node
// Row C-41 (plan step 3): the audit gap (HANDOFF §6.2) is closed by a dev-tree-included
// job in audit-dependencies.yml running the same --audit-level=high threshold as the
// production audit. Reads the tree only; builtins only.
import { existsSync, readFileSync } from 'node:fs';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const workflow = read('.github/workflows/audit-dependencies.yml');
const pkg = JSON.parse(read('package.json') || '{}');
const auditAll = pkg.scripts?.['audit:all'] ?? '';

// Scope to the `audit-all` job block specifically (not the workflow as a whole,
// and not the separate `audit` job), so a step under a different job cannot
// satisfy this. A job block runs from its `<name>:` line to the next line at the
// same (two-space) indentation, or end of file.
function jobBlock(text, jobName) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => new RegExp(`^\\s{2}${jobName}:\\s*$`).test(l));
  if (startIdx === -1) return '';
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^\s{2}\S/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

const auditAllBlock = jobBlock(workflow, 'audit-all');
console.log(`audit_all_job=${auditAllBlock ? 1 : 0}`);
// Anchored to the start of a line: a commented-out `# run: npm run audit:all`
// begins with `#`, not `run:`, so it cannot satisfy this.
console.log(`audit_all_step_runs_script=${/^\s*run:\s*npm run audit:all\s*$/m.test(auditAllBlock) ? 1 : 0}`);
console.log(`audit_all_full_tree=${/^npm audit --audit-level=high$/.test(auditAll.trim()) ? 1 : 0}`);
