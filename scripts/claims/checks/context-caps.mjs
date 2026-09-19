#!/usr/bin/env node
// Rows C-08 and C-09: the context files within their caps, and where their content went.
// Prints key=value lines for the register's `expect`; reads the tree it runs in.
import { existsSync, readFileSync } from 'node:fs';

const handoff = readFileSync('HANDOFF.md');
const claude = readFileSync('CLAUDE.md', 'utf8');
const claudeLines = claude.endsWith('\n') ? claude.split('\n').length - 1 : claude.split('\n').length;

console.log(`handoff_bytes=${handoff.length}`);
console.log(`handoff_archive=${existsSync('docs/history/handoff-archive-2026-08.md') ? 1 : 0}`);
console.log(`claude_lines=${claudeLines}`);
console.log(`traps_doc=${existsSync('docs/traps.md') ? 1 : 0}`);
