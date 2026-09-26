#!/usr/bin/env node
// D-56, GitHub issue #172. Exhaustive proof that TEXT_FORBIDDEN_PATTERN and
// TEXT_INVISIBLE_PATTERN (src/core/RegistryContext.tsx) between them cover
// every Unicode Default_Ignorable_Code_Point, and a record of the two named
// exceptions (U+2800 included though not DI; nothing DI is deliberately
// excluded).
//
// Deliberately NOT part of `npm run verify`: its result depends on the Node
// build's own Unicode-data version (printed below), which can differ between
// machines and CI runners, so a change here would be a false positive/negative
// about this repository's code rather than about Unicode data drift. Run it
// by hand: `node scripts/scan-default-ignorable-coverage.mjs`.
//
// Reads the two patterns' regex literals out of RegistryContext.tsx's own
// source text (not hand-copied here) so this script cannot silently drift
// from what is actually exported.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', 'src', 'core', 'RegistryContext.tsx');
const source = readFileSync(sourcePath, 'utf8');

function extractPattern(name) {
  const marker = `export const ${name} = Object.freeze(`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`could not find ${name} in ${sourcePath}`);
  }
  const afterMarker = start + marker.length;
  const end = source.indexOf(');', afterMarker);
  const literal = source.slice(afterMarker, end).trim();
  const match = /^\/(.*)\/([a-z]*)$/.exec(literal);
  if (match === null) {
    throw new Error(`could not parse ${name}'s regex literal from ${sourcePath}: ${literal}`);
  }
  const [, regexSource, flags] = match;
  return new RegExp(regexSource, flags);
}

const forbidden = extractPattern('TEXT_FORBIDDEN_PATTERN');
const invisible = extractPattern('TEXT_INVISIBLE_PATTERN');
const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/u;

let totalDI = 0;
let diForbidden = 0;
let diInvisible = 0;
let rawForbidden = 0;
let rawInvisible = 0;
const uncovered = [];

for (let cp = 0; cp <= 0x10ffff; cp += 1) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogate range, no scalar value
  const ch = String.fromCodePoint(cp);
  const isDI = defaultIgnorable.test(ch);
  const isForbidden = forbidden.test(ch);
  const isInvisible = invisible.test(ch);
  if (isForbidden) rawForbidden += 1;
  if (isInvisible) rawInvisible += 1;
  if (isDI) {
    totalDI += 1;
    if (isForbidden) diForbidden += 1;
    else if (isInvisible) diInvisible += 1;
    else uncovered.push(cp);
  }
}

console.log(`Node ${process.version}, Unicode ${process.versions.unicode}`);
console.log(`Total default-ignorable codepoints scanned (U+0000-U+10FFFF): ${totalDI}`);
console.log(`DI codepoints covered by TEXT_FORBIDDEN_PATTERN: ${diForbidden}`);
console.log(`DI codepoints covered by TEXT_INVISIBLE_PATTERN: ${diInvisible}`);
console.log(
  `Uncovered default-ignorable codepoints: ${uncovered.length} (${diForbidden} + ${diInvisible} = ${diForbidden + diInvisible}, total scanned ${totalDI})`,
);
if (uncovered.length > 0) {
  console.log('Uncovered codepoints:', uncovered.map((cp) => `U+${cp.toString(16).toUpperCase()}`).join(', '));
}
console.log(`(Raw pattern-match totals over ALL codepoints, DI or not: TEXT_FORBIDDEN_PATTERN matches ${rawForbidden}; TEXT_INVISIBLE_PATTERN matches ${rawInvisible}.)`);
console.log(
  `Named-not-by-property inclusion: U+2800 (BRAILLE PATTERN BLANK) default_ignorable=${defaultIgnorable.test('⠀')}, included in TEXT_INVISIBLE_PATTERN anyway by name.`,
);

process.exit(uncovered.length === 0 ? 0 : 1);
