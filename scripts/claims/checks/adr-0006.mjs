#!/usr/bin/env node
// Row C-18: ADR-0006 is Accepted, ADR-0001 carries Amendment P, and ADR-0006 states the
// Amendment E finding in its own words: no boundary between plugins. The box states
// nine clauses about what the ADR covers; each gets its own key below rather than
// standing on the three structural ones alone.
import { readFileSync } from 'node:fs';

const adr6 = readFileSync('docs/adr/0006-runtime-plugin-host.md', 'utf8');
const adr1 = readFileSync('docs/adr/0001-ioc-registry-architecture.md', 'utf8');
const decisions = readFileSync('docs/DECISIONS.md', 'utf8');
const status = adr6.match(/^- \*\*Status:\*\* \*\*(\w+)\*\*/m);

console.log(`adr0006_status=${status ? status[1] : 'none'}`);
console.log(`adr0001_amendment_p=${/^## Amendment P\b/m.test(adr1) ? 1 : 0}`);
console.log(`adr0006_no_boundary_between_plugins=${/no boundary between plugins/i.test(adr6) ? 1 : 0}`);
// The manifest format (decision 1).
console.log(`adr0006_manifest_format=${/one `?\.lwplugin`? file, holding a manifest and ONE bundle/i.test(adr6) ? 1 : 0}`);
// Where plugins live: per-user app.getPath('userData')/plugins (decision 2).
console.log(`adr0006_userdata_path=${/app\.getPath\('userData'\)>?\/plugins\//.test(adr6) ? 1 : 0}`);
// How they load: a custom protocol serving the bundle into the extension WebContentsView.
console.log(`adr0006_custom_protocol_serve=${/shellux:\/\/renderer\/plugins\//.test(adr6) ? 1 : 0}`);
console.log(`adr0006_webcontentsview=${/WebContentsView/.test(adr6) ? 1 : 0}`);
// No nodeIntegration, context-isolated preload.
console.log(`adr0006_no_node_integration=${/nodeIntegration:\s*false/.test(adr6) ? 1 : 0}`);
console.log(`adr0006_context_isolation=${/contextIsolation:\s*true/.test(adr6) ? 1 : 0}`);
console.log(`adr0006_preload_mentioned=${/preload/i.test(adr6) ? 1 : 0}`);
// Install sources: a local .lwplugin package, plus a GitHub Release URL.
console.log(`adr0006_local_lwplugin_source=${/A local `?\.lwplugin`? file/i.test(adr6) ? 1 : 0}`);
console.log(`adr0006_github_release_source=${/github\.com\/LEAPWare-Software\/<repo>\/releases\/download/.test(adr6) ? 1 : 0}`);
// D-23 stays: first-party plugins only — named in the ADR, and D-23 itself exists and
// is about first parties / third parties not being customers.
console.log(`adr0006_d23_first_party=${/D-23 \(first-party\s+plugins\s+only\)|D-23 stays: first-party plugins only/.test(adr6) ? 1 : 0}`);
const d23Row = decisions.match(/\|\s*D-23\s*\|([\s\S]*?)\|(?=\n\|)/);
console.log(`decisions_d23_present=${d23Row ? 1 : 0}`);
console.log(`decisions_d23_first_party_topic=${d23Row && /third part/i.test(d23Row[1]) ? 1 : 0}`);
