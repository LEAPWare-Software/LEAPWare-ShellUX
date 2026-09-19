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

// C-26 (proof audit item 25): the packaged-launch evidence at
// docs/measurements/csp-2026-09-18.json (scripts/csp-smoke.mjs) is read here, not just
// cited by number, so the row proves what the file actually shows rather than trusting
// #150's own summary of it. The final ("5-...-final-policy") run's `driven` fields
// show real renderer content extracted over the DevTools protocol (mail and database
// row text, a drawn canvas, a shown tooltip, a completed pointer drag, an opened
// command palette) with zero CSP violations on both surfaces — not merely the exe
// starting.
const measurement = JSON.parse(readFileSync('docs/measurements/csp-2026-09-18.json', 'utf8'));
const runKeys = Object.keys(measurement.runs);
const lastRun = measurement.runs[runKeys[runKeys.length - 1]].output;
const extension = lastRun.summary.find((s) => s.surface === 'extension');
const chrome = lastRun.summary.find((s) => s.surface === 'chrome');
console.log(`csp_smoke_ok=${lastRun.ok ? 1 : 0}`);
console.log(`csp_extension_violations=${extension?.violations ?? 'none'}`);
console.log(`csp_chrome_violations=${chrome?.violations ?? 'none'}`);
console.log(`csp_renderer_content_extracted=${extension?.driven?.mail?.found && extension?.driven?.database?.found && (extension?.driven?.mailText ?? '').length > 20 ? 1 : 0}`);
console.log(`csp_tooltip_and_drag=${extension?.driven?.tooltipShown && extension?.driven?.dragged ? 1 : 0}`);
console.log(`csp_palette_opened=${chrome?.driven?.paletteOpen ? 1 : 0}`);
