#!/usr/bin/env node
// Rows C-08 and C-09: the context files within their caps, and where their content went.
// Prints key=value lines for the register's `expect`; reads the tree it runs in.
import { existsSync, readFileSync } from 'node:fs';

const handoff = readFileSync('HANDOFF.md');
const claude = readFileSync('CLAUDE.md', 'utf8');
const claudeLines = claude.endsWith('\n') ? claude.split('\n').length - 1 : claude.split('\n').length;
const trapsExists = existsSync('docs/traps.md');
const traps = trapsExists ? readFileSync('docs/traps.md', 'utf8') : '';

console.log(`handoff_bytes=${handoff.length}`);
console.log(`handoff_archive=${existsSync('docs/history/handoff-archive-2026-08.md') ? 1 : 0}`);
console.log(`claude_lines=${claudeLines}`);
console.log(`traps_doc=${trapsExists ? 1 : 0}`);
// C-09: the "Traps this repository has already paid for" body must actually be in
// docs/traps.md (not just the file existing), and CLAUDE.md must carry a pointer to it
// rather than the body itself.
console.log(`traps_section_in_traps_doc=${/## Traps this repository has already paid for/.test(traps) ? 1 : 0}`);
console.log(`claude_points_to_traps_doc=${/docs\/traps\.md/.test(claude) ? 1 : 0}`);
// A duplicated trap body in CLAUDE.md (not just its heading + one-line pointer
// bullets) would re-inflate the file; look for a trap's distinctive explanatory
// prose, which only the full body carries — the one-line bullet does not.
console.log(`claude_has_traps_body=${/internal slots/.test(claude) ? 1 : 0}`);
// C-09 split: the "jsdom is blind" body is a separate clause, not yet true — left
// unchecked in the box on purpose (still in CLAUDE.md as of this audit, see below).
console.log(`jsdom_section_in_traps_doc=${/## jsdom is blind/.test(traps) ? 1 : 0}`);
console.log(`claude_has_jsdom_body=${/\|\s*Layout\s*\|/.test(claude) ? 1 : 0}`);
