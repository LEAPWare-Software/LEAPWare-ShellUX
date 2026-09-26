#!/usr/bin/env node
// Row C-52: `SECURITY.md` and `docs/RELEASE.md` both record that unsigned
// updates depend on `sha512` + HTTPS + control of the GitHub account, name it a
// guardrail rather than an integrity control, and Amendment G is satisfied by
// naming what actually verifies it (RELEASE.md §3's manual check) rather than a
// fabricated automated test title.
import { readFileSync } from 'node:fs';

const security = readFileSync('SECURITY.md', 'utf8');
const release = readFileSync('docs/RELEASE.md', 'utf8');

const namesSha512Https = (text) => /sha512/i.test(text) && /https/i.test(text);
const namesGuardrailNotControl = (text) => /guardrail/i.test(text) && /not an integrity control/i.test(text);
const namesAccountControl = (text) => /GitHub account/i.test(text) || /controls the .{0,40}GitHub account/i.test(text);

const securityOk = namesSha512Https(security) && namesGuardrailNotControl(security) && namesAccountControl(security);
const releaseOk = namesSha512Https(release) && /guardrail/i.test(release) && /integrity control/i.test(release);

// Amendment G: no bare `*Tests:*`/`*Test:*` marker for this specific claim in
// SECURITY.md's new section — it must instead point at RELEASE.md's manual step.
const normalized = security.replace(/\s+/g, ' ');
const pointsAtManualCheck = /RELEASE\.md.{0,80}manual checklist item about an old build updating itself/i.test(normalized);

console.log(`security_md_states_guardrail=${securityOk ? 1 : 0}`);
console.log(`release_md_states_guardrail=${releaseOk ? 1 : 0}`);
console.log(`amendment_g_points_at_manual_check=${pointsAtManualCheck ? 1 : 0}`);
