#!/usr/bin/env node
// Row C-11: text moved into docs/traps.md kept its citation markers, and every citation
// in the tree still resolves (the citation checker exits 0).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const traps = readFileSync('docs/traps.md', 'utf8');
const markers = (traps.match(/\*Tests?:\*/g) ?? []).length;
const result = spawnSync(process.execPath, ['scripts/check-citations.mjs'], { encoding: 'utf8' });

console.log(`traps_tests_markers=${markers}`);
console.log(`citations_exit=${result.status ?? 1}`);
