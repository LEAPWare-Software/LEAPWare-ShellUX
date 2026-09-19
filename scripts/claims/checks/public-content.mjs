#!/usr/bin/env node
// Rows C-12 and C-14: the two repairs the public content review made hold. CODEOWNERS
// routes to the organisation, and the code of conduct names no personal address.
import { readFileSync } from 'node:fs';

const owners = readFileSync('.github/CODEOWNERS', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
// GitHub applies the LAST matching pattern line in CODEOWNERS, not the first — so the
// authoritative catch-all owner is the last `* ` line, not the first.
const catchAll = owners.filter((l) => l.startsWith('* ')).at(-1);
const coc = readFileSync('CODE_OF_CONDUCT.md', 'utf8');

console.log(`codeowners_default_owner=${catchAll ? catchAll.split(/\s+/).slice(1).join(' ') : 'none'}`);
console.log(`codeowners_hq_lines=${owners.filter((l) => l.includes('@LEAPWare-HQ')).length}`);
// C-12's claim is broader than "no email addresses": no personal contact info at all,
// and the only sanctioned reporting route is SECURITY.md — not a second, unmoderated
// route such as a public GitHub issue.
console.log(`coc_email_addresses=${(coc.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []).length}`);
console.log(`coc_phone_numbers=${(coc.match(/\b(?:\+?\d[\d .()-]{7,}\d)\b/g) ?? []).length}`);
console.log(`coc_social_handles=${(coc.match(/@[A-Za-z0-9_]{2,}(?!\.)/g) ?? []).length}`);
console.log(`coc_contact_via_security=${/contact\s+methods\s+listed\s+in\s+\[SECURITY\.md\]/.test(coc) ? 1 : 0}`);
const enforcementSection = (coc.split('## Enforcement\n')[1] ?? '').split('## Enforcement Guidelines')[0];
console.log(`coc_names_alternate_channel=${/GitHub\s+Issues/i.test(enforcementSection) ? 1 : 0}`);
console.log(`coc_stale_once_published=${/once published/i.test(coc) ? 1 : 0}`);
