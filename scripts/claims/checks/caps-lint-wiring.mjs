#!/usr/bin/env node
// Row C-10: the caps lint is a test file, wired into `test:scripts`, which `verify`
// runs, AND the test file itself still asserts both caps (a file that exists and is
// wired in but has been gutted to an empty `it()` must not pass this row).
import { existsSync, readFileSync } from 'node:fs';

const TEST_FILE = 'scripts/__tests__/context-caps.test.mjs';
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
const testScripts = (scripts['test:scripts'] ?? '').split(/\s+/);
const gate = (scripts.verify ?? '').split('&&').map((s) => s.trim());
const testFileExists = existsSync(TEST_FILE);
const test = testFileExists ? readFileSync(TEST_FILE, 'utf8') : '';

console.log(`caps_test_file=${testFileExists ? 1 : 0}`);
console.log(`caps_test_in_test_scripts=${testScripts.includes(TEST_FILE) ? 1 : 0}`);
console.log(`test_scripts_in_gate=${gate.includes('npm run test:scripts') ? 1 : 0}`);
// The two caps this row names: HANDOFF.md's byte cap and CLAUDE.md's line cap. Each
// must be read from the real file and asserted with a comparison against the cap, not
// merely mentioned in a comment or an empty `it()`.
const handoffCapAsserted =
  /read\(['"]HANDOFF\.md['"]\)/.test(test) &&
  /assert\.ok\(\s*bytes\s*<=\s*HANDOFF_MAX_BYTES/.test(test);
const claudeCapAsserted =
  /read\(['"]CLAUDE\.md['"]\)/.test(test) &&
  /assert\.ok\(\s*lines\s*<=\s*CLAUDE_MAX_LINES/.test(test);
console.log(`caps_test_asserts_handoff_cap=${handoffCapAsserted ? 1 : 0}`);
console.log(`caps_test_asserts_claude_cap=${claudeCapAsserted ? 1 : 0}`);
