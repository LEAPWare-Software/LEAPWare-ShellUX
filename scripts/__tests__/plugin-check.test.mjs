/**
 * Tests for scripts/plugin-check.mjs — the conformance kit, ADR-0006 decision
 * 10 / step 8 (#57).
 *
 * WHY A SUBPROCESS FOR THE SIX CHECK ROWS. Per row, the fixture is spawned
 * through the real CLI exactly as `npm run plugin:check <path>` runs it,
 * asserting on the exit code and the printed `[check]` tag and reason — the
 * contract callers (a human, CI) depend on. `node --test` rather than Vitest,
 * for the same reason `check-portability.test.mjs` gives: `vitest.config.ts`
 * scopes `include` to `src/**`/`electron/**`/`plugins/**` with a written
 * reason, and this is a build/CI script, not any of those.
 *
 * A HANDFUL of finer-grained cases (dynamic-import detection, the fake clock,
 * argument resolution) are exercised by importing the module's own exported
 * pure functions directly — cheaper than a subprocess, and there is no
 * filesystem or git index for them to depend on, unlike `check-portability`'s
 * checker.
 *
 * ONE PLANTED-BAD FIXTURE PER CHECK ROW, each failing for its own reason (ADR
 * row 8's own words), plus one that passes every row. Every fixture is a
 * hand-assembled `.lwplugin` — a JSON document with a manifest and a base64
 * bundle — built at run time so the sha512 always matches; none is read off
 * disk.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkImports, createFakeClock, resolvePackagePath } from '../plugin-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI = resolve(HERE, '..', 'plugin-check.mjs');

/** `HOST_API_VERSION`, read the way `build-plugins.mjs` reads it — see its own banner. */
function readHostApiVersion() {
  const source = readFileSync(join(REPO_ROOT, 'src', 'sdk', 'index.ts'), 'utf8');
  const match = /export const HOST_API_VERSION = '([^']+)';/.exec(source);
  assert.ok(match !== null, 'src/sdk/index.ts must declare HOST_API_VERSION for this suite to mirror');
  return match[1];
}
const HOST_API_VERSION = readHostApiVersion();

const BASE = mkdtempSync(join(tmpdir(), 'shellux-plugin-check-'));
after(() => rmSync(BASE, { recursive: true, force: true, maxRetries: 5 }));

/** A well-formed bundle: no imports, a valid pane pair, one visible-always command. */
const GOOD_BUNDLE = [
  "import { jsx } from '/shared/react-jsx-runtime.js';",
  "function Pane2() { return jsx('div', { children: 'pane2' }); }",
  "function Pane3() { return jsx('div', { children: 'pane3' }); }",
  'export default Object.freeze({',
  "  id: 'ID_PLACEHOLDER',",
  "  name: 'Fixture Plugin',",
  "  version: '1.0.0',",
  '  navigationTree: [],',
  "  commands: [{ id: 'cmd', label: 'Cmd', icon: 'box', isVisible: () => true, onExecute: () => {} }],",
  '  views: { pane2: Pane2, pane3: Pane3 },',
  '});',
].join('\n');

/**
 * Build one `.lwplugin` file under a fresh subdirectory of `BASE`, and return
 * its path. `bundleText` and `manifestOverrides` let each fixture diverge from
 * the good shape at exactly the one point its row is meant to fail on.
 * `sha512Override`, when given, is used INSTEAD OF the bundle's real digest —
 * the one way to plant a manifest/bundle mismatch.
 */
function writeFixture(name, { id = name, bundleText = GOOD_BUNDLE.replace('ID_PLACEHOLDER', id), manifestOverrides = {}, sha512Override } = {}) {
  const dir = join(BASE, name);
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from(bundleText, 'utf8');
  const sha512 = sha512Override ?? createHash('sha512').update(bytes).digest('base64');
  const manifest = {
    id,
    version: '1.0.0',
    hostApiVersion: HOST_API_VERSION,
    title: 'Fixture Plugin',
    entry: 'bundle.js',
    sha512,
    ...manifestOverrides,
  };
  const pkg = { format: 'lwplugin/1', manifest, bundle: bytes.toString('base64') };
  const path = join(dir, `${id}.lwplugin`);
  writeFileSync(path, JSON.stringify(pkg));
  return path;
}

/**
 * Run the real CLI against `path`, exactly as `npm run plugin:check` does.
 * `timeout`, when given, is `execFileSync`'s own subprocess timeout in
 * milliseconds — a fixed upper bound so a regression of the `advance()` hang
 * this file's fake-clock tests guard against kills the CLI subprocess and
 * fails this test loudly, rather than hanging `node --test` (and, unguarded,
 * the CI job the reviewer named).
 *
 * **`killSignal: 'SIGKILL'`, not the default `SIGTERM`, when a `timeout` is
 * given.** Measured, not assumed: the CLI's own Vite dev server registers
 * process-level signal listeners of its own, which makes Node route SIGTERM
 * through the (JS) event loop rather than take the default immediate-exit
 * action — and a process stuck in the exact synchronous `advance()` infinite
 * loop this option exists to guard against never yields the event loop to
 * receive it. Confirmed by hand: a hung `plugin-check.mjs` sent `SIGTERM`
 * directly was still alive two seconds later; `SIGKILL` is unconditional at
 * the OS level and does not depend on the stuck process ever running JS
 * again.
 */
function runCli(path, { timeout } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, path], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(timeout === undefined ? {} : { timeout, killSignal: 'SIGKILL' }),
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

describe('plugin-check — argument resolution (ADR-0002: argv, never an env var)', () => {
  it('resolves a file path as given', () => {
    const path = writeFixture('resolve-file');
    assert.equal(resolvePackagePath(path), path);
  });

  it('resolves a directory holding exactly one .lwplugin file', () => {
    const path = writeFixture('resolve-dir');
    assert.equal(resolvePackagePath(dirname(path)), path);
  });

  it('refuses a directory holding no .lwplugin file', () => {
    const dir = join(BASE, 'empty-dir');
    mkdirSync(dir, { recursive: true });
    assert.throws(() => resolvePackagePath(dir), /holds no \.lwplugin file/);
  });

  it('refuses a directory holding more than one .lwplugin file, rather than guessing', () => {
    const dir = join(BASE, 'ambiguous-dir');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.lwplugin'), '{}');
    writeFileSync(join(dir, 'b.lwplugin'), '{}');
    assert.throws(() => resolvePackagePath(dir), /holds 2 \.lwplugin files/);
  });

  it('refuses a path that does not exist', () => {
    assert.throws(() => resolvePackagePath(join(BASE, 'nowhere')), /does not exist/);
  });

  it('refuses an empty or missing argument, naming the usage rather than crashing on undefined', () => {
    assert.throws(() => resolvePackagePath(undefined), /usage: npm run plugin:check/);
    assert.throws(() => resolvePackagePath(''), /usage: npm run plugin:check/);
  });
});

describe('plugin-check — Check 3 (Imports), the pure parser', () => {
  it('accepts a bundle that imports only the three /shared/ modules', () => {
    assert.deepEqual(checkImports(GOOD_BUNDLE), { ok: true });
  });

  it('refuses a bundle with a dynamic import(), naming decision 5', () => {
    const result = checkImports("const m = await import('./evil.js');");
    assert.equal(result.ok, false);
    assert.equal(result.check, 'imports');
    assert.match(result.reason, /dynamic import\(\)/);
  });

  it('refuses a bundle whose static import names something other than /shared/*', () => {
    const result = checkImports("import x from 'left-pad';");
    assert.equal(result.ok, false);
    assert.equal(result.check, 'imports');
    assert.match(result.reason, /"left-pad"/);
  });

  it('refuses a bundle whose export-from names something other than /shared/*', () => {
    const result = checkImports("export { x } from './sibling.js';");
    assert.equal(result.ok, false);
    assert.match(result.reason, /"\.\/sibling\.js"/);
  });
});

describe('plugin-check — the home-grown fake clock', () => {
  it('fires a setTimeout scheduled before install() only once advance() reaches its delay', () => {
    const clock = createFakeClock();
    clock.install();
    try {
      let fired = 0;
      setTimeout(() => {
        fired += 1;
      }, 100);
      clock.advance(50);
      assert.equal(fired, 0);
      clock.advance(50);
      assert.equal(fired, 1);
    } finally {
      clock.restore();
    }
  });

  it('re-fires setInterval on every due multiple, and clearInterval stops it', () => {
    const clock = createFakeClock();
    clock.install();
    try {
      let fired = 0;
      const id = setInterval(() => {
        fired += 1;
      }, 100);
      clock.advance(350);
      assert.equal(fired, 3);
      clearInterval(id);
      clock.advance(1000);
      assert.equal(fired, 3);
    } finally {
      clock.restore();
    }
  });

  it('clearTimeout cancels a timeout that has not yet fired', () => {
    const clock = createFakeClock();
    clock.install();
    try {
      let fired = false;
      const id = setTimeout(() => {
        fired = true;
      }, 100);
      clearTimeout(id);
      clock.advance(1000);
      assert.equal(fired, false);
    } finally {
      clock.restore();
    }
  });

  it('restore() puts the real timer functions back', () => {
    const realSetTimeout = globalThis.setTimeout;
    const clock = createFakeClock();
    clock.install();
    assert.notEqual(globalThis.setTimeout, realSetTimeout);
    clock.restore();
    assert.equal(globalThis.setTimeout, realSetTimeout);
  });

  // Regression for the review finding on scripts/plugin-check.mjs line 288
  // (PR #221): a zero-delay setInterval used to re-arm at `dueAt === now`,
  // which is still `<= deadline`, so `advance()`'s `for (;;)` picked the same
  // timer again with `now` unmoved and never returned — a synchronous,
  // single-threaded infinite loop. Deliberately NOT exercised here as a
  // direct, in-process `clock.advance()` call: `node --test`'s own per-test
  // `timeout` cannot preempt a synchronous loop that never yields the one JS
  // thread it shares with the test runner itself, so a regression would hang
  // this whole file, not merely fail one case. The CLI-level cases below
  // exercise this exact scenario safely, through `execFileSync`'s subprocess
  // `timeout`, which kills the child from OUTSIDE that blocked thread.
});

describe('plugin-check — the CLI, end to end, one planted-bad fixture per check row', () => {
  it('passes every check for a well-formed plugin (package, contract-version, imports, registration, lifecycle, render)', () => {
    const path = writeFixture('good-plugin');
    const result = runCli(path);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /plugin-check: PASS good-plugin@1\.0\.0/);
    assert.match(result.stdout, /package, contract-version, imports, registration, lifecycle, render/);
  });

  it('Check 1 (Package) — refuses a bundle whose sha512 does not match its manifest', () => {
    // A validly-SHAPED but wrong digest, not a malformed one: `pluginPackage.ts`'s
    // SHA512_BASE64_PATTERN (86 base64 characters + literal `==`) refuses a
    // wrong-length string before `validate()` ever reaches the actual digest
    // comparison this test means to exercise, so the override must be a real,
    // 88-character base64 SHA-512 digest of different bytes to land past format
    // validation and into the mismatch branch.
    const wrongDigest = createHash('sha512').update('not the bundle').digest('base64');
    const path = writeFixture('bad-package', { sha512Override: wrongDigest });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[package\]/);
    assert.match(result.stderr, /the bundle does not match the manifest sha512/);
  });

  it('Check 2 (Contract version) — refuses a plugin built for a newer major than this checkout offers', () => {
    const [hostMajor] = HOST_API_VERSION.split('.');
    const path = writeFixture('bad-contract-version', {
      manifestOverrides: { hostApiVersion: `${String(Number(hostMajor) + 1)}.0` },
    });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[contract-version\]/);
  });

  it('Check 3 (Imports) — refuses a bundle that statically imports something other than a /shared/ module', () => {
    const bundleText = [
      "import leftPad from 'left-pad';",
      "export default Object.freeze({ id: 'bad-imports', name: 'x', version: '1.0.0', navigationTree: [], commands: [], views: { pane2: () => null, pane3: () => null } });",
    ].join('\n');
    const path = writeFixture('bad-imports', { bundleText });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[imports\]/);
    assert.match(result.stderr, /"left-pad"/);
  });

  it('Check 4 (Registration) — refuses a default export whose id differs from the manifest', () => {
    const bundleText = GOOD_BUNDLE.replace('ID_PLACEHOLDER', 'a-different-id');
    const path = writeFixture('bad-registration', { bundleText, id: 'bad-registration' });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[registration\]/);
    assert.match(result.stderr, /differs from the manifest/);
  });

  it('Check 4 (Registration) — names validateBlueprint, not register, when the default export fails validation', () => {
    // `register` is bound to the live React registry and cannot be called
    // standalone from this CLI; the check calls `validateBlueprint`, its pure
    // validation core, instead. A prior round of this bundle's default export
    // had that check's failure message read "failed the real register" —
    // stale wording the PR's own docs (the ADR-0006 §10 as-built callout and
    // the decision-10 table) were already corrected to stop claiming
    // elsewhere, but which survived verbatim in this runtime string. Missing
    // `navigationTree` is the fixture: `normalizeBlueprint`'s `requireField`
    // throws before any pane or command is ever inspected.
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'no-navigation-tree',",
      "  name: 'Fixture Plugin',",
      "  version: '1.0.0',",
      "  commands: [{ id: 'cmd', label: 'Cmd', icon: 'box', isVisible: () => true, onExecute: () => {} }],",
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '});',
    ].join('\n');
    const path = writeFixture('no-navigation-tree', { bundleText, id: 'no-navigation-tree' });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[registration\]/);
    assert.match(result.stderr, /failed validateBlueprint/);
    assert.doesNotMatch(result.stderr, /the real register/, 'must not claim register was called, when the check calls validateBlueprint');
  });

  it('Check 5 (Lifecycle) — refuses a plugin whose onRelease does not clear a running interval', () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'leaky-lifecycle',",
      "  name: 'Leaky',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate(shell) {',
      // Deliberately never cleared: the leak this check exists to catch.
      '      setInterval(() => { shell.setBadgeCount("leak", 1); }, 1000);',
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('leaky-lifecycle', { bundleText, id: 'leaky-lifecycle' });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /reached the handle after release/);
  });

  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate throws', () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'throwing-lifecycle',",
      "  name: 'Throws',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      "  lifecycle: { onActivate() { throw new Error('boom from onActivate'); } },",
      '});',
    ].join('\n');
    const path = writeFixture('throwing-lifecycle', { bundleText, id: 'throwing-lifecycle' });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /onActivate threw: boom from onActivate/);
  });

  // Regression for the review finding on scripts/plugin-check.mjs line 288
  // (PR #221): the plugin here does exactly what the finding named — an
  // onActivate that schedules a zero-delay setInterval (`setInterval(fn, 0)`)
  // and never clears it — which used to make `advance()` loop forever inside
  // `checkLifecycle`, turning a bad plugin into a hung CI job with no
  // `timeout-minutes` to save it. `timeout` on `runCli` bounds the subprocess
  // so an unfixed regression fails this test fast instead of hanging the
  // suite. Fixed, `advance()` terminates and this is an ordinary leaked-timer
  // FAIL, same reason as "Check 5 (Lifecycle) — refuses a plugin whose
  // onRelease does not clear a running interval" above.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate never clears a zero-delay interval', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'zero-delay-lifecycle',",
      "  name: 'ZeroDelay',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate(shell) {',
      // Deliberately never cleared, and deliberately delay 0 — the exact
      // scenario the review finding named.
      '      setInterval(() => { shell.setBadgeCount("leak", 1); }, 0);',
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('zero-delay-lifecycle', { bundleText, id: 'zero-delay-lifecycle' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /reached the handle after release/);
  });

  // Same scenario again, but via an OMITTED delay argument
  // (`setInterval(fn)`, `delay === undefined`) rather than a literal `0` —
  // `schedule()`'s `safeDelay` clamps both to the same zero delay, so this is
  // the same code path, not a second bug, and is asserted here because the
  // review finding is about `safeDelay`'s clamp in general, not only a
  // literal `0` in plugin source. The negative-delay case below covers the
  // clamp's other side.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate never clears an omitted-delay interval', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'omitted-delay-lifecycle',",
      "  name: 'OmittedDelay',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate(shell) {',
      '      setInterval(() => { shell.setBadgeCount("leak", 1); });',
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('omitted-delay-lifecycle', { bundleText, id: 'omitted-delay-lifecycle' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /reached the handle after release/);
  });

  // The clamp's other side: a NEGATIVE delay (`setInterval(fn, -100)`).
  // `schedule()`'s `safeDelay` treats `delay >= 0` as the only valid case and
  // clamps anything else — negative or non-numeric — to `0`, so this reaches
  // the identical zero-delay `advance()` path as the two cases above through
  // a third, distinct plugin-source shape.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate never clears a negative-delay interval', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'negative-delay-lifecycle',",
      "  name: 'NegativeDelay',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate(shell) {',
      '      setInterval(() => { shell.setBadgeCount("leak", 1); }, -100);',
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('negative-delay-lifecycle', { bundleText, id: 'negative-delay-lifecycle' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /reached the handle after release/);
  });

  // Regression for the independent review finding on PR #221 (a High-severity
  // "MERGE WITH FIXES" verdict, not the line-288 finding above): an
  // `onActivate` that defers STARTING its leak by one microtask
  // (`somePromise.then(() => setInterval(...))`, an ordinary pattern) used to
  // still be mid-flight when `checkLifecycle`'s `finally` ran `clock
  // .restore()` — `lifecycle.onActivate?.(shell)` returning does not itself
  // drain the microtask queue. The `setInterval` call then landed on the REAL
  // timers, invisible to every check here, and this plugin printed a false
  // PASS followed by an uncaught `REVOKED` crash roughly a second later, once
  // the real interval fired against the already-revoked handle — exactly the
  // defect class ADR-0006 decision 10 names this kit to catch. `timeout`
  // bounds `runCli` in case a future regression brings back the real-timer
  // delay this fixture's `setInterval(..., 1000)` would otherwise wait out.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate starts an uncleared interval from a microtask', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'async-leak-lifecycle',",
      "  name: 'AsyncLeak',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate(shell) {',
      '      Promise.resolve().then(() => {',
      '        setInterval(() => { shell.setBadgeCount("leak", 1); }, 1000);',
      '      });',
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('async-leak-lifecycle', { bundleText, id: 'async-leak-lifecycle' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /reached the handle after release/);
  });

  // Regression for a fifth review finding on PR #221, same function again:
  // the post-`revoke()` leak scan used to advance a FIXED 120_000ms of
  // virtual time. A leaked interval or timeout with a longer delay
  // (200_000ms here) never had its `dueAt` fall inside that fixed window, so
  // its callback never fired and the scan saw nothing — a false PASS for a
  // genuinely leaking plugin. `checkLifecycle` now sizes that advance to
  // `Math.max(120_000, clock.longestPendingDelay() + 1)`, which is virtual
  // time (no real waiting) and so costs nothing regardless of how long the
  // plugin's own delay is.
  it('Check 5 (Lifecycle) — refuses a plugin whose leaked interval outlives the old fixed 120s scan window', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'slow-leak-lifecycle',",
      "  name: 'SlowLeak',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate(shell) {',
      '      setInterval(() => { shell.setBadgeCount("leak", 1); }, 200000);',
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('slow-leak-lifecycle', { bundleText, id: 'slow-leak-lifecycle' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /reached the handle after release/);
  });

  // Regression for the independent `shellux-cloud-reviewer` routine's Medium
  // finding on PR #221 (reviewed at head 345283f): a hook can reject
  // INTERNALLY, never returning the rejection at all —
  // `onActivate(shell) { Promise.reject(new Error('boom')); }`, fired and
  // forgotten, no `return`, no `await`. Awaiting `Promise.resolve(hookCall)`
  // (the fix for the async-rejection cases below) only ever sees what the
  // hook's own RETURN VALUE carries; this rejection settles on its own,
  // asynchronously, as an unhandled rejection Node detects on no stack this
  // check is on. Left unhandled, this crashed the whole CLI process the same
  // way the RETURNED-rejection case did, except OUTSIDE `checkLifecycle`'s
  // own `finally`, which skipped `runChecks`' temp-directory cleanup too — a
  // real, measured leak: a `dist-plugins/plugin-check-*` scratch directory
  // was still on disk after a crashed run. Fixed by a
  // `process.on('unhandledRejection', ...)` installed for `checkLifecycle`'s
  // own duration, checked after every `flushMicrotasks()`. This test asserts
  // both halves of the finding: a clean FAIL (not a crash), and that the
  // scratch directory it ran in does not outlive the run.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate rejects internally without returning the rejection, and leaves no scratch directory behind', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'internal-unattached-reject',",
      "  name: 'InternalUnattachedReject',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      "  lifecycle: { onActivate() { Promise.reject(new Error('boom internal')); } },",
      '});',
    ].join('\n');
    const path = writeFixture('internal-unattached-reject', { bundleText, id: 'internal-unattached-reject' });
    const scratchRoot = join(REPO_ROOT, 'dist-plugins');
    const before = new Set(readdirSync(scratchRoot).filter((name) => name.startsWith('plugin-check-')));
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /an internal, unattached promise rejection reached the process during a lifecycle hook: boom internal/);
    const after = readdirSync(scratchRoot).filter((name) => name.startsWith('plugin-check-') && !before.has(name));
    assert.deepEqual(after, [], 'the CLI must clean up its own dist-plugins/plugin-check-* scratch directory even when a hook rejects internally');
  });

  // Regression for a review finding on PR #221, same tracking as the test
  // just above: `undefined` is a legal promise-rejection reason
  // (`Promise.reject()`/`Promise.reject(undefined)`), but the tracking used
  // `internalRejection === undefined` as its own "nothing has surfaced yet"
  // sentinel, and a `??=` assignment "writing" `undefined` over `undefined`
  // is a no-op — so a plugin that fire-and-forgets exactly this rejection
  // value was silently swallowed into a false PASS. Fixed by tracking
  // presence with a separate boolean (`hasInternalRejection`) rather than
  // comparing the captured value itself to the sentinel.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate rejects internally with undefined', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'internal-undefined-reject',",
      "  name: 'InternalUndefinedReject',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: { onActivate() { Promise.reject(); } },',
      '});',
    ].join('\n');
    const path = writeFixture('internal-undefined-reject', { bundleText, id: 'internal-undefined-reject' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /plugin-check: PASS/, 'must not print PASS for a plugin that rejects internally with undefined');
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /an internal, unattached promise rejection reached the process during a lifecycle hook: undefined/);
  });

  // Regression for a third review finding on PR #221, same function as the
  // two above: the lifecycle hooks are typed `=> void`, which an `async`
  // function satisfies (`ActivationContext.tsx`'s `callHook` docblock says so
  // explicitly). A bare `lifecycle.onActivate?.(shell)` does not throw for an
  // `async` hook that rejects — it returns an already-rejected promise,
  // unattached — which used to be an unhandled rejection under this CLI's
  // default `--unhandled-rejections=throw`, crashing the whole process with a
  // raw stack instead of a clean FAIL. `timeout` bounds `runCli` in case a
  // future regression brings back a crash this reporter cannot parse as the
  // planted `[lifecycle]` failure.
  it('Check 5 (Lifecycle) — refuses a plugin whose onActivate rejects asynchronously', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'async-reject-activate',",
      "  name: 'AsyncRejectActivate',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      "  lifecycle: { onActivate: async () => { throw new Error('boom async activate'); } },",
      '});',
    ].join('\n');
    const path = writeFixture('async-reject-activate', { bundleText, id: 'async-reject-activate' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /onActivate threw: boom async activate/);
  });

  // Same bug, the other two lifecycle hooks — checked rather than assumed
  // symmetric, since each has its own call site in `checkLifecycle`.
  it('Check 5 (Lifecycle) — refuses a plugin whose onDeactivate rejects asynchronously', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'async-reject-deactivate',",
      "  name: 'AsyncRejectDeactivate',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      "  lifecycle: { onDeactivate: async () => { throw new Error('boom async deactivate'); } },",
      '});',
    ].join('\n');
    const path = writeFixture('async-reject-deactivate', { bundleText, id: 'async-reject-deactivate' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /onDeactivate threw: boom async deactivate/);
  });

  it('Check 5 (Lifecycle) — refuses a plugin whose onRelease rejects asynchronously', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'async-reject-release',",
      "  name: 'AsyncRejectRelease',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      "  lifecycle: { onRelease: async () => { throw new Error('boom async release'); } },",
      '});',
    ].join('\n');
    const path = writeFixture('async-reject-release', { bundleText, id: 'async-reject-release' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /onRelease threw: boom async release/);
  });

  // Regression for the `claude[bot]` review finding on PR #221 (comment
  // 4100011392, `scripts/plugin-check.mjs` line 609): every other phase in
  // `checkLifecycle` follows its hook call with `await flushMicrotasks();`
  // before checking `internalRejectionFail()`, but the post-`revoke()` leak
  // scan — the one phase that exists specifically to catch a leak surviving
  // release — did not. A plugin that leaks a `setInterval` whose callback
  // rejects internally, and never touches `shell`, defeats BOTH of this
  // check's leak defences at once: the `calls.find((call) => call.phase ===
  // 'released')` scan finds nothing (nothing ever called `shell`), and the
  // internal rejection — created synchronously inside the `clock.advance(...)`
  // call right above — settles as a genuinely unhandled rejection only once
  // Node's own microtask checkpoint runs, which the missing `await
  // flushMicrotasks()` gave no chance to happen before `process.off(
  // 'unhandledRejection', ...)` ran in this function's `finally`. Net effect,
  // confirmed by hand before this fix: `checkLifecycle` returned `{ ok: true
  // }` — `plugin-check: PASS` printed to stdout — and the rejection then
  // reached the process for real, with no listener attached, crashing the CLI
  // after it had already reported success. The fixture's timer delay
  // (100_000ms) is deliberately sized to fire ONLY during the post-revoke
  // scan's own `advance()`, not the earlier `onDeactivate`/`onRelease`
  // advances (30_000ms each, which already `await flushMicrotasks()`
  // correctly) — otherwise this test would pass for the wrong reason.
  it('Check 5 (Lifecycle) — refuses a plugin whose post-release leak rejects internally without touching shell', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'post-release-internal-reject',",
      "  name: 'PostReleaseInternalReject',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      '    onActivate() {',
      "      setInterval(() => { Promise.reject(new Error('post release leak')); }, 100000);",
      '    },',
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('post-release-internal-reject', { bundleText, id: 'post-release-internal-reject' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /plugin-check: PASS/, 'must not print PASS for a plugin that leaks an internally-rejecting timer');
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /an internal, unattached promise rejection reached the process during a lifecycle hook: post release leak/);
  });

  // Regression for the `claude[bot]` review finding on PR #221 (comment
  // 4100128282, `scripts/plugin-check.mjs` line 543): the pre-release
  // `clock.advance(30_000)` calls (post-`onActivate`, post-`onDeactivate`)
  // were bare, unlike the post-`revoke()` advance further down, which is
  // deliberately wrapped. A plugin that leaks a timer whose callback throws a
  // plain, synchronous error unrelated to touching a revoked `shell` — fired
  // while the extension is still legitimately active, before either
  // `onDeactivate` or `onRelease` ever runs — propagated straight out of
  // `checkLifecycle`, out of `runChecks`, out of `main`'s bare `await
  // runChecks(...)`, and crashed the whole CLI with a raw, unhandled stack
  // instead of printing `plugin-check: FAIL [lifecycle] ...`. Confirmed by
  // hand before this fix: the CLI subprocess exited non-zero with a raw
  // `Error: sync leak throw` stack on `stderr`, not the `FAIL [lifecycle]`
  // tag this test asserts on.
  it('Check 5 (Lifecycle) — refuses a plugin whose leaked timer throws a plain error while still active, before onDeactivate runs', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'sync-throw-before-deactivate',",
      "  name: 'SyncThrowBeforeDeactivate',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      "    onActivate(shell) { setInterval(() => { throw new Error('sync leak throw'); }, 100); },",
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('sync-throw-before-deactivate', { bundleText, id: 'sync-throw-before-deactivate' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '', 'must not print anything to stdout, let alone a raw uncaught stack');
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /a leaked timer's callback threw while the extension was still active, before lifecycle\.onDeactivate ran: sync leak throw/);
  });

  // Same bug, the other pre-release window — checked rather than assumed
  // symmetric, since each `advance()` is its own call site.
  it('Check 5 (Lifecycle) — refuses a plugin whose leaked timer throws a plain error while still active, before onRelease runs', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'sync-throw-before-release',",
      "  name: 'SyncThrowBeforeRelease',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      // Delay 31_000ms: due only during the SECOND `advance(30_000)` (after
      // `onDeactivate`), not the first (after `onActivate`) — otherwise this
      // test would pass for the wrong reason (the already-covered window).
      "    onActivate(shell) { setInterval(() => { throw new Error('sync leak throw before release'); }, 31000); },",
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('sync-throw-before-release', { bundleText, id: 'sync-throw-before-release' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '', 'must not print anything to stdout, let alone a raw uncaught stack');
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /a leaked timer's callback threw while the extension was still active, before lifecycle\.onRelease ran: sync leak throw before release/);
  });

  // Regression for the `claude[bot]` review finding on PR #221 (comment
  // 4100128896, `scripts/plugin-check.mjs` line 594): the post-`revoke()`
  // `catch {}` guarding the leak-scan `advance()` used to be unconditional —
  // it swallowed ANY synchronous throw, not just the expected `REVOKED`
  // `ShellUXError` from a leaked call reaching the wrapped, revoked `shell`.
  // A leaked timer that throws some OTHER, unrelated error after release, and
  // never itself calls `shell` (so the `calls.find((call) => call.phase ===
  // 'released')` scan just below finds nothing either), was discarded there
  // just the same, and `checkLifecycle` fell through to a false `{ ok: true
  // }` PASS — confirmed by hand before this fix: `plugin-check: PASS
  // unrelated-post-release-throw@1.0.0 ...` printed for a plugin that is
  // still misbehaving after release. The fixture's timer delay (150_000ms) is
  // deliberately sized to fire ONLY during the post-revoke scan's own
  // `advance()` (`Math.max(120_000, clock.longestPendingDelay() + 1)`), not
  // the earlier 30_000ms pre-release advances — otherwise this test would
  // pass for the wrong reason.
  it('Check 5 (Lifecycle) — refuses a plugin whose leaked timer throws an error unrelated to REVOKED after release', { timeout: 5000 }, () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'unrelated-post-release-throw',",
      "  name: 'UnrelatedPostReleaseThrow',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '  lifecycle: {',
      "    onActivate() { setInterval(() => { throw new Error('unrelated post-release error'); }, 150000); },",
      '  },',
      '});',
    ].join('\n');
    const path = writeFixture('unrelated-post-release-throw', { bundleText, id: 'unrelated-post-release-throw' });
    const result = runCli(path, { timeout: 4000 });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /plugin-check: PASS/, 'must not print PASS for a plugin that leaks a timer throwing an unrelated error after release');
    assert.match(result.stderr, /FAIL \[lifecycle\]/);
    assert.match(result.stderr, /a leaked timer's callback threw an unexpected error after release \(not the expected REVOKED from touching the revoked shell\): unrelated post-release error/);
  });

  it('Check 6 (Render) — refuses a plugin whose pane view throws on first render with an empty context', () => {
    const bundleText = [
      "function Pane2() { throw new Error('render boom'); }",
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'throwing-render',",
      "  name: 'Throws',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      '  commands: [],',
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '});',
    ].join('\n');
    const path = writeFixture('throwing-render', { bundleText, id: 'throwing-render' });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[render\]/);
    assert.match(result.stderr, /views\.pane2 threw on first render/);
  });

  it('Check 6 (Render) — refuses a plugin whose command isVisible throws on an empty context', () => {
    const bundleText = [
      "import { jsx } from '/shared/react-jsx-runtime.js';",
      "function Pane2() { return jsx('div', { children: 'pane2' }); }",
      "function Pane3() { return jsx('div', { children: 'pane3' }); }",
      'export default Object.freeze({',
      "  id: 'throwing-isvisible',",
      "  name: 'Throws',",
      "  version: '1.0.0',",
      '  navigationTree: [],',
      "  commands: [{ id: 'cmd', label: 'Cmd', icon: 'box', isVisible: () => { throw new Error('isVisible boom'); }, onExecute: () => {} }],",
      '  views: { pane2: Pane2, pane3: Pane3 },',
      '});',
    ].join('\n');
    const path = writeFixture('throwing-isvisible', { bundleText, id: 'throwing-isvisible' });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[render\]/);
    assert.match(result.stderr, /isVisible threw on an empty context/);
  });
});
