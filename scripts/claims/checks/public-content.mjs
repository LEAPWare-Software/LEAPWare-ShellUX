#!/usr/bin/env node
// Rows C-12 and C-14: the two repairs the public content review made hold. CODEOWNERS
// routes to the organisation, and the code of conduct names no personal address.
import { readFileSync } from 'node:fs';

const owners = readFileSync('.github/CODEOWNERS', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const catchAll = owners.find((l) => l.startsWith('* '));
const coc = readFileSync('CODE_OF_CONDUCT.md', 'utf8');

console.log(`codeowners_default_owner=${catchAll ? catchAll.split(/\s+/).slice(1).join(' ') : 'none'}`);
console.log(`codeowners_hq_lines=${owners.filter((l) => l.includes('@LEAPWare-HQ')).length}`);
console.log(`coc_email_addresses=${(coc.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []).length}`);
console.log(`coc_contact_via_security=${/contact\s+methods\s+listed\s+in\s+\[SECURITY\.md\]/.test(coc) ? 1 : 0}`);
