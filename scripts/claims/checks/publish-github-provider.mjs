#!/usr/bin/env node
// Row C-50: `publish: { provider: github, owner, repo }` landed in
// `electron-builder.yml`, `DOCUMENTED_ENDPOINTS` in `scripts/check-portability.mjs`
// stays empty with its comment naming why (D-34's github route introduces no
// hostname literal), the fixture in `scripts/__tests__/check-portability.test.mjs`
// pins that fact, and `check:portability` itself still passes on the real tree.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const builder = readFileSync('electron-builder.yml', 'utf8');
const portability = readFileSync('scripts/check-portability.mjs', 'utf8');
const fixture = readFileSync('scripts/__tests__/check-portability.test.mjs', 'utf8');

const publishBlock =
  /publish:\s*\n\s*provider:\s*github\s*\n\s*owner:\s*LEAPWare-Software\s*\n\s*repo:\s*LEAPWare-ShellUX/.test(builder);

const endpointsStillEmpty = /const DOCUMENTED_ENDPOINTS = new Map\(\);/.test(portability);
const commentCitesD34 = /D-34/.test(portability) && /no literal hostname/.test(portability);

const fixtureAdded =
  /the github publish provider, which introduces no hostname literal/.test(fixture) &&
  /reports nothing for an electron-builder\.yml publish block using the GitHub provider/.test(fixture);

let portabilityExitZero = 0;
try {
  execFileSync('node', ['scripts/check-portability.mjs'], { stdio: 'ignore' });
  portabilityExitZero = 1;
} catch {
  portabilityExitZero = 0;
}

console.log(`publish_block_present=${publishBlock ? 1 : 0}`);
console.log(`endpoints_still_empty=${endpointsStillEmpty ? 1 : 0}`);
console.log(`comment_cites_d34=${commentCitesD34 ? 1 : 0}`);
console.log(`fixture_added=${fixtureAdded ? 1 : 0}`);
console.log(`portability_exit_zero=${portabilityExitZero}`);
