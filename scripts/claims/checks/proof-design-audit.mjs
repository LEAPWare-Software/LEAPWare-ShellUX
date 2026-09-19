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
// Not just that a row tagged D-50 exists: its content must actually be the proof-of-
// completion decision, and it must link to docs/proof-of-completion.md, the box's claim.
const d50Row = decisions.match(/^\| D-50 \|([\s\S]*?)\|(?=\n\|)/m);
const d50Body = d50Row ? d50Row[1] : '';
console.log(`d50_recorded=${d50Row ? 1 : 0}`);
console.log(`d50_about_proof_of_completion=${/[Pp]roof of completion/.test(d50Body) ? 1 : 0}`);
console.log(`d50_links_proof_doc=${/\(proof-of-completion\.md\)|\(docs\/proof-of-completion\.md\)/.test(d50Body) ? 1 : 0}`);
console.log(`d50_names_audit_rounds=${/twelve rounds/.test(d50Body) ? 1 : 0}`);
