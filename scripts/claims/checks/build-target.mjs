#!/usr/bin/env node
// Row C-26 (#85): the Vite build target is the Chromium that Electron 43 ships, and the
// packaged renderer is served over the private `shellux` scheme rather than file://.
import { readFileSync } from 'node:fs';

const vite = readFileSync('vite.config.ts', 'utf8');
const target = vite.match(/^\s*target:\s*'([^']+)'/m);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const electron = (pkg.devDependencies?.electron ?? '').replace(/^[^\d]*/, '').split('.')[0];
const main = readFileSync('electron/main/index.ts', 'utf8');
const scheme = main.match(/^const APP_SCHEME = '([^']+)';/m);

console.log(`vite_build_target=${target ? target[1] : 'none'}`);
console.log(`electron_major=${electron}`);
console.log(`app_scheme=${scheme ? scheme[1] : 'none'}`);
console.log(`scheme_privileged=${/registerSchemesAsPrivileged\(\[\s*\{\s*scheme: APP_SCHEME/.test(main) ? 1 : 0}`);
