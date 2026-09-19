#!/usr/bin/env node
// Row C-10: the caps lint is a test file, wired into `test:scripts`, which `verify`
// runs. Static wiring only; the test itself runs inside that gate.
import { existsSync, readFileSync } from 'node:fs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
const testScripts = (scripts['test:scripts'] ?? '').split(/\s+/);
const gate = (scripts.verify ?? '').split('&&').map((s) => s.trim());

console.log(`caps_test_file=${existsSync('scripts/__tests__/context-caps.test.mjs') ? 1 : 0}`);
console.log(`caps_test_in_test_scripts=${testScripts.includes('scripts/__tests__/context-caps.test.mjs') ? 1 : 0}`);
console.log(`test_scripts_in_gate=${gate.includes('npm run test:scripts') ? 1 : 0}`);
