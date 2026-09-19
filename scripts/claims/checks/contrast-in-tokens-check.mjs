#!/usr/bin/env node
// Row C-27: the chart contrast check is a stage of `tokens:check`, and `tokens:check` is
// a stage of the full gate. Also runs the contrast check itself and reports its exit.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
const tokens = (scripts['tokens:check'] ?? '').split('&&').map((s) => s.trim());
const gate = (scripts.verify ?? '').split('&&').map((s) => s.trim());
const stage = tokens.find((s) => /^node design\/check-contrast\.mjs\b/.test(s));
const run = stage ? spawnSync(process.execPath, stage.split(/\s+/).slice(1), { encoding: 'utf8' }) : null;

console.log(`contrast_stage_in_tokens_check=${stage ? 1 : 0}`);
console.log(`tokens_check_in_gate=${gate.includes('npm run tokens:check') ? 1 : 0}`);
console.log(`contrast_check_exit=${run ? (run.status ?? 1) : 'not-run'}`);
