#!/usr/bin/env node
// Row C-13: the community files exist, the issue templates are forms, and
// .gitattributes enforces LF.
import { existsSync, readFileSync } from 'node:fs';

const files = [
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.editorconfig',
  '.gitattributes',
];
const forms = ['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature.yml'].filter(
  (f) => existsSync(f) && /^body:/m.test(readFileSync(f, 'utf8')),
);
const attributes = existsSync('.gitattributes') ? readFileSync('.gitattributes', 'utf8') : '';

console.log(`community_files_present=${files.filter((f) => existsSync(f)).length}`);
console.log(`issue_forms=${forms.length}`);
console.log(`gitattributes_eol_lf=${/^\*\s+text=auto\s+eol=lf\b/m.test(attributes) ? 1 : 0}`);
