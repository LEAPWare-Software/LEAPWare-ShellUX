#!/usr/bin/env node
// Row C-45: docs/maintainers/repository-settings.md names D-27 by id, quotes its
// original line, and says the ruleset it documents is the reversal of D-27, per plan
// v1-production.md step 3's "Write the D-27 reversal honestly" box.
import { readFileSync } from 'node:fs';

const settings = readFileSync('docs/maintainers/repository-settings.md', 'utf8');

const namesD27 = /\bD-27\b/.test(settings) ? 1 : 0;
const quotesOriginalLine = settings.includes('No branch protection, and no spend to get it') ? 1 : 0;
const callsItReversal = /reversal of.{0,20}D-27|D-27.{0,20}reversal of/is.test(settings) ? 1 : 0;
const citesD34 = /\bD-34\b/.test(settings) ? 1 : 0;
const linksDecisions = settings.includes('../DECISIONS.md') ? 1 : 0;

console.log(`names_d27=${namesD27}`);
console.log(`quotes_original_line=${quotesOriginalLine}`);
console.log(`calls_it_reversal=${callsItReversal}`);
console.log(`cites_d34=${citesD34}`);
console.log(`links_decisions=${linksDecisions}`);
