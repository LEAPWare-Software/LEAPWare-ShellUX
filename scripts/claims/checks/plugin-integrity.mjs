#!/usr/bin/env node
// Row C-42 (plan step 6b): the manifest carries a sha512 of the bundle, install refuses
// a mismatch, and serving refuses a bundle that has been rewritten on disk since install
// (rehash-on-serve). Each is pinned by a named test. Reads the tree only; builtins only,
// except for actually RUNNING the two named tests below (spawnSync to a pinned local
// binary) — the argv allowlist governs the row's own registered command
// (`node scripts/claims/checks/plugin-integrity.mjs`), not what that script does once
// it is running; see lib.mjs's file-level comment. Matching comparison-operator text in
// the source proves the code exists, not that it works, so the two refusals are
// exercised for real instead.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const pkg = read('electron/main/plugins/pluginPackage.ts');
const store = read('electron/main/plugins/pluginStore.ts');

console.log(`manifest_declares_sha512=${/readonly sha512: string/.test(pkg) ? 1 : 0}`);
console.log(`install_refuses_mismatch=${/sha512Base64\(bundle\) !== manifest\.sha512/.test(pkg) ? 1 : 0}`);
console.log(`serve_rehashes_bundle=${/sha512Base64\(read\.bytes\) !== record\.sha512/.test(store) ? 1 : 0}`);
console.log(`entry_point_validation_named=${/ENTRY-POINT VALIDATION/.test(pkg) ? 1 : 0}`);

// Run the two named tests for real: a passing Vitest run for each, checked by title, not
// by grepping the test source for the comparison it makes.
//
// A failed run says why, on stderr. The key on stdout stays 0/1, because that is what the
// register's `expect` compares, but a bare 0 cannot distinguish "the test ran and failed",
// which is the answer the row wants, from "vitest never started", which is an environment
// fact about the tree it ran in. Both of those printed 0, and the row went red on
// windows-latest only — at `083609a` and again at `29dbb52` — with nothing in the log but
// `install_mismatch_test=0 == 1`. stderr is used rather than stdout so the key=value lines
// the register parses are untouched, and `node --test` surfaces it in the job log.
const vitestJs = path.join('node_modules', 'vitest', 'vitest.mjs');
function runNamedTest(file, title) {
  const result = spawnSync(process.execPath, [vitestJs, 'run', file, '-t', title], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status === 0) return true;
  const tail = (text) => (text ?? '').split(/\r?\n/).filter((l) => l.trim()).slice(-12).join('\n  ');
  console.error(
    [
      `plugin-integrity: ${file} -t ${JSON.stringify(title)} did not pass.`,
      `  cwd=${process.cwd()}`,
      `  vitest entry ${vitestJs} exists=${existsSync(vitestJs)}`,
      `  status=${result.status} signal=${result.signal} error=${result.error ? result.error.message : 'none'}`,
      `  stderr tail:\n  ${tail(result.stderr)}`,
      `  stdout tail:\n  ${tail(result.stdout)}`,
    ].join('\n'),
  );
  return false;
}
console.log(`install_mismatch_test=${runNamedTest('electron/__tests__/pluginPackage.test.ts', 'refuses a package whose bundle does not match its manifest sha512') ? 1 : 0}`);
console.log(`serve_mismatch_test=${runNamedTest('electron/__tests__/pluginScheme.test.ts', 'refuses to serve an entry changed on disk after install') ? 1 : 0}`);
