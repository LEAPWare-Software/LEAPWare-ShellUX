import { defineConfig } from '@playwright/test';
import type { PackagedWorkerOptions } from './e2e-packaged/packaged';

/**
 * The packaged lane: `e2e-packaged/`, against a PACKAGED LEAPWare ShellUX.
 *
 * A sibling of `playwright.config.ts`, not a project inside it. That config
 * drives the dev server and a `vite preview` build in plain Chromium and says
 * of itself that it cannot see the packaged app; putting this lane in it would
 * make its banner false. This one launches no browser and no web server: its
 * only spec launches an Electron executable through `_electron.launch()`.
 *
 * **Not part of `npm run verify`, and not run in CI.** It needs a packaged
 * build (`npm run verify:desktop`), which neither `npm ci` nor `verify`
 * produces, and a machine that can open a window. Runbook:
 * `docs/runbooks/packaged-plugin-e2e.md`.
 *
 * **Start it with `npm run test:packaged -- <path to packaged executable>`,
 * never `playwright test -c` directly.** The executable path is an ARGUMENT,
 * as it is for `scripts/csp-smoke.mjs` and `npm run plugin:check <dir>`
 * (ADR-0006 decision 10: "takes its directory from argv, never an environment
 * variable"), because it differs per platform and per machine and has no
 * default worth guessing. Playwright Test takes no user arguments of its own,
 * so `scripts/packaged-e2e.mjs` takes the argument, checks it names a file,
 * and hands it to this file — and to the worker processes, which load this
 * file again — in the one variable read below. That variable is how the
 * wrapper talks to this file, not a setting anyone is asked to put in their
 * environment: it has no default, and without it this file throws naming the
 * command to run instead.
 */

const EXECUTABLE_VARIABLE = 'SHELLUX_PACKAGED_E2E_EXECUTABLE';

const packagedExecutable = process.env[EXECUTABLE_VARIABLE] ?? '';
if (packagedExecutable === '') {
  throw new Error(
    'playwright.packaged.config.ts needs the path to a packaged executable, and has no default.\n' +
      'Run:  npm run test:packaged -- <path to packaged executable>\n' +
      `(scripts/packaged-e2e.mjs checks that path and hands it over in ${EXECUTABLE_VARIABLE}.)`,
  );
}

export default defineConfig<Record<never, never>, PackagedWorkerOptions>({
  testDir: './e2e-packaged',
  // Its own, so a run of this lane and a run of `e2e/` never empty each other's.
  outputDir: './test-results-packaged',
  // One app, one user-data directory, one sequence of states.
  workers: 1,
  fullyParallel: false,
  // A failure here is rare to reproduce and expensive to re-run; a retry that
  // passed would hide the one observation that mattered.
  retries: 0,
  forbidOnly: true,
  // A cold packaged launch plus a reload of a killed renderer, generously.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { packagedExecutable },
});
