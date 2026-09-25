/**
 * `scripts/packaged-e2e.mjs` and `playwright.packaged.config.ts`, as far as they
 * can be exercised without a packaged app: the refusals, and a `--list` pass
 * that loads the config and the spec — imports, fixtures and titles — and
 * launches nothing.
 *
 * What this does NOT show: that any case in `e2e-packaged/` passes, or runs at
 * all, against a packaged build. `--list` never starts a worker fixture, so
 * `_electron.launch()` is never called here. That is ADR-0006 step 10, and it
 * needs a desktop (`docs/runbooks/packaged-plugin-e2e.md`).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WRAPPER = fileURLToPath(new URL('../packaged-e2e.mjs', import.meta.url));
const CONFIG = fileURLToPath(new URL('../../playwright.packaged.config.ts', import.meta.url));
/** Any file that exists. `--list` never launches it. */
const STAND_IN = fileURLToPath(new URL('../../package.json', import.meta.url));

/** The environment minus the handover variable, so a developer's shell cannot make a case pass. */
function cleanEnv() {
  const env = { ...process.env };
  delete env.SHELLUX_PACKAGED_E2E_EXECUTABLE;
  return env;
}

function wrapper(args) {
  return spawnSync(process.execPath, [WRAPPER, ...args], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
}

test('refuses to start without a path to the packaged executable, and prints the usage', () => {
  const run = wrapper([]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /the path to a packaged executable is required/);
  assert.match(run.stderr, /usage: npm run test:packaged -- <path to the packaged executable>/);
});

test('refuses a Playwright option where the executable path belongs', () => {
  const run = wrapper(['--list']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /the path to a packaged executable is required, and comes first/);
});

test('refuses a path that names nothing, and a path that names a directory', () => {
  const missing = wrapper(['release/no-such-build/LEAPWare ShellUX.exe']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /nothing exists at /);

  const directory = wrapper(['scripts']);
  assert.equal(directory.status, 2);
  assert.match(directory.stderr, /is not a file/);
});

test('the config refuses to load when started without the wrapper, and names the command to run', () => {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const run = spawnSync(process.execPath, [cli, 'test', '--config', CONFIG, '--list'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}${run.stderr}`, /npm run test:packaged -- <path to packaged executable>/);
});

test('through the wrapper, --list loads the spec and names every checkpoint, launching nothing', () => {
  const run = wrapper([STAND_IN, '--list']);
  assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  for (const title of [
    '1 install: installs the built .lwplugin through main, from host chrome, and lists it enabled',
    '2 appears: the listing names it enabled, and /plugins/ serves the entry that was installed',
    '2 appears: the plugin manager shows the installed plugin',
    '3 disable, gone: the listing names it disabled, and /plugins/ stops serving its entry',
    '3 disable, gone: the plugin manager shows it disabled, and its nav and panes leave the shell',
    '4 crashed: a plugin that throws is shown as crashed, with its reason',
    '5 survives: host chrome outlives a killed extension renderer, and main reloads it (no plugin involved)',
  ]) {
    assert.ok(run.stdout.includes(title), `--list did not name: ${title}\n${run.stdout}`);
  }
  assert.match(run.stdout, /Total: 7 tests in 1 file/);
});
