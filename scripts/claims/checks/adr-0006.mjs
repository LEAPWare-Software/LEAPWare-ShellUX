#!/usr/bin/env node
// Row C-18: ADR-0006 is Accepted, ADR-0001 carries Amendment P, and ADR-0006 states the
// Amendment E finding in its own words: no boundary between plugins.
import { readFileSync } from 'node:fs';

const adr6 = readFileSync('docs/adr/0006-runtime-plugin-host.md', 'utf8');
const adr1 = readFileSync('docs/adr/0001-ioc-registry-architecture.md', 'utf8');
const status = adr6.match(/^- \*\*Status:\*\* \*\*(\w+)\*\*/m);

console.log(`adr0006_status=${status ? status[1] : 'none'}`);
console.log(`adr0001_amendment_p=${/^## Amendment P\b/m.test(adr1) ? 1 : 0}`);
console.log(`adr0006_no_boundary_between_plugins=${/no boundary between plugins/i.test(adr6) ? 1 : 0}`);
