#!/usr/bin/env node
/**
 * ============================================================================
 * THE PACKAGED LANE'S ENTRY POINT. ADR-0006 IMPLEMENTATION STEP 10, PREPARED.
 * ============================================================================
 *
 *     npm run verify:desktop
 *     npm run plugins:build
 *     npm run test:packaged -- "release/win-unpacked/LEAPWare ShellUX.exe"
 *
 * Takes the path to a packaged LEAPWare ShellUX executable as its one required
 * argument, refuses loudly when it is missing or names no file, and runs
 * Playwright Test with `playwright.packaged.config.ts`. Any further arguments
 * go to `playwright test` unchanged (`--list`, `--headed`, a test filter).
 *
 * **Why an argument, and why this script exists at all.** The path differs per
 * platform and per machine and there is no default worth guessing, so it is
 * required. ADR-0006 decision 10 takes a directory "from argv, never an
 * environment variable (ADR-0002)", and `scripts/csp-smoke.mjs` takes its
 * executable the same way. Playwright Test accepts no user arguments — an
 * extra positional is read as a test filter — so this script is the argument
 * parser, and it hands the checked path to the config in one variable it sets
 * on the child it spawns. Nobody is asked to set that variable, and it has no
 * default. It is also the one command that reads the same on Windows, macOS
 * and Linux, where an inline environment assignment would not.
 *
 * **Not part of `npm run verify`, and not run in CI.** It needs a packaged
 * build and a desktop session. What `test:scripts` does run is this script's
 * refusals and a `--list` pass that launches nothing:
 * `scripts/__tests__/packaged-e2e.test.mjs`. Runbook:
 * `docs/runbooks/packaged-plugin-e2e.md`.
 * ============================================================================
 */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read by `playwright.packaged.config.ts`, and by nothing else. */
const EXECUTABLE_VARIABLE = 'SHELLUX_PACKAGED_E2E_EXECUTABLE';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = fileURLToPath(new URL('../playwright.packaged.config.ts', import.meta.url));

const USAGE =
  'usage: npm run test:packaged -- <path to the packaged executable> [playwright test options]\n' +
  '  Windows: "release/win-unpacked/LEAPWare ShellUX.exe"\n' +
  '  macOS:   the binary inside the bundle, "<name>.app/Contents/MacOS/LEAPWare ShellUX"\n' +
  'Build it first with `npm run verify:desktop`, and the plugin with `npm run plugins:build`.\n';

function refuse(message) {
  process.stderr.write(`packaged-e2e: ${message}\n${USAGE}`);
  process.exit(2);
}

const [argument, ...forwarded] = process.argv.slice(2);
if (argument === undefined || argument === '' || argument.startsWith('-')) {
  refuse('the path to a packaged executable is required, and comes first.');
}

const executable = resolve(argument);
let stats;
try {
  stats = statSync(executable);
} catch {
  refuse(`nothing exists at ${executable}.`);
}
if (!stats.isFile()) {
  refuse(`${executable} is not a file. On macOS, pass the binary inside the .app bundle, not the bundle.`);
}

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const run = spawnSync(process.execPath, [cli, 'test', '--config', CONFIG, ...forwarded], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: { ...process.env, [EXECUTABLE_VARIABLE]: executable },
});
if (run.error !== undefined) {
  process.stderr.write(`packaged-e2e: could not start Playwright: ${run.error.message}\n`);
  process.exit(1);
}
process.exit(run.status ?? 1);
