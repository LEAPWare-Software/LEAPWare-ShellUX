#!/usr/bin/env node
// Row C-07: the proof-of-completion design was audited until a round found no Blocker,
// and the decision is recorded as D-50.
import { readFileSync } from 'node:fs';

const design = readFileSync('docs/proof-of-completion.md', 'utf8');
const history = design.match(/Audit history: Blockers per round ([^.]*)\./);
const rounds = history ? history[1].split(',').map((s) => Number(s.replace(/\D/g, ''))) : [];
const decisions = readFileSync('docs/DECISIONS.md', 'utf8');

console.log(`audit_rounds=${rounds.length}`);
console.log(`last_round_blockers=${rounds.length ? rounds[rounds.length - 1] : 'none'}`);
console.log(`d50_recorded=${/^\| D-50 \|/m.test(decisions) ? 1 : 0}`);
