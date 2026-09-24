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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** Run the real CLI against `path`, exactly as `npm run plugin:check` does. */
function runCli(path) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, path], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    const path = writeFixture('bad-package', { sha512Override: 'AA'.repeat(43) });
    const result = runCli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL \[package\]/);
    assert.match(result.stderr, /sha512/);
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
