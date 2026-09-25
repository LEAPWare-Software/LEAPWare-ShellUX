/**
 * Regression test for the CHANGELOG "Fixed: `npm run plugins:build` emitted a
 * `bundle.js` with NO export statement at all" entry (PR #221, review finding
 * 5) — that entry previously cited no test, only a manual repro transcript in
 * the PR body, which `check:citations` cannot verify.
 *
 * The defect: Rollup's default tree-shaking for a non-library client build
 * strips an entry module's own exports outright when nothing in the bundle
 * imports them — true of every one of this repo's plugins, since the entry
 * module IS the plugin's manifest and nothing else in the bundle references
 * it. `scripts/build-plugins.mjs`'s `rollupOptions` fixes this with
 * `preserveEntrySignatures: 'strict'`; this test runs the REAL CLI
 * (`npm run plugins:build`, exactly as `.github/workflows/ci.yml` and a
 * developer both invoke it) and asserts the built `hello-example.lwplugin`
 * bundle actually carries a default export, rather than trusting the option
 * is still in place.
 *
 * `node --test`, not Vitest, for the same reason `plugin-check.test.mjs`
 * gives: this is a build/CI script, outside `vitest.config.ts`'s `include`.
 *
 * WHY A REGEX OVER THE BUNDLE'S OWN TEXT, NOT A REAL MODULE LOAD. The built
 * bundle imports the bare specifiers `react`, `react/jsx-runtime` (rewritten
 * to `/shared/react.js` etc.) — Node's own module resolution cannot load it
 * without the same Vite SSR resolver `scripts/plugin-check.mjs` sets up for
 * exactly this reason. Standing up that resolver here to prove one export
 * statement's presence would be the wrong-sized tool for what this test
 * checks; `plugin-check.test.mjs`'s own CLI-level cases are what exercise a
 * REAL load of a built bundle end to end. This test's job is narrower and
 * cheaper: does Rollup's output still name `default` among its exports.
 *
 * VERIFIED TO FAIL PRE-FIX: run by hand with `preserveEntrySignatures:
 * 'strict'` temporarily removed from `scripts/build-plugins.mjs`'s
 * `rollupOptions` — the built `hello-example.lwplugin` bundle then ends
 * `//#endregion` with no `export` statement at all (matching the CHANGELOG
 * entry's own description of the pre-fix output), and this test's regex
 * assertion failed as expected. Restored before committing.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'build-plugins.mjs');
const OUT_DIR = join(REPO_ROOT, 'dist-plugins');

// The three files `npm run plugins:build` writes today, one per
// `plugins/*/plugin.json` — cleaned up after this test regardless of which
// assertion, if any, fails, so a run of this file leaves no untracked output
// behind for `check:portability`'s git-index read to trip over.
const BUILT_FILES = ['hello-example.lwplugin', 'mail.lwplugin', 'inventory-db.lwplugin'];
after(() => {
  for (const name of BUILT_FILES) {
    rmSync(join(OUT_DIR, name), { force: true });
  }
});

describe('build-plugins — the real CLI', () => {
  it('preserves the entry module default export in the built bundle via preserveEntrySignatures strict', () => {
    execFileSync(process.execPath, [CLI], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    const pkgText = readFileSync(join(OUT_DIR, 'hello-example.lwplugin'), 'utf8');
    const pkg = JSON.parse(pkgText);
    assert.equal(pkg.format, 'lwplugin/1');

    const bundleText = Buffer.from(pkg.bundle, 'base64').toString('utf8');
    // Pre-fix, this bundle ended with no `export` statement at all
    // (`Object.freeze({ ... });`, nothing after it) — `import()`ing it gave
    // `{}`, so `.default` read `undefined`. Post-fix it ends with an export
    // clause naming `default` explicitly.
    assert.match(
      bundleText,
      /export\s*\{[^}]*\bas default\b[^}]*\}\s*;?\s*$/,
      `expected the built bundle to end with an export statement naming a default export; got:\n${bundleText.slice(-400)}`,
    );
  });
});
