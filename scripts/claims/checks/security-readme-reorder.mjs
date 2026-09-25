#!/usr/bin/env node
// Rows C-47 (SECURITY.md section order) and C-48 (README.md top-matter order),
// plan v1-production.md lines 129 and 133. Reads the tree only; builtins only.
import { existsSync, readFileSync } from 'node:fs';
import { git } from '../lib.mjs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const security = read('SECURITY.md');
const secIdx = (heading) => security.indexOf(heading);
const secOrder = [
  secIdx('## Reporting a vulnerability'),
  secIdx('## Read this first: the trust model'),
  secIdx('## Supported versions'),
  secIdx('## Where the evidence lives'),
];
const secOrdered = secOrder.every((n) => n !== -1) && secOrder.every((n, i) => i === 0 || n > secOrder[i - 1]);
console.log(`security_order=${secOrdered ? 1 : 0}`);

const supportedStart = security.indexOf('## Supported versions');
const supportedEnd = supportedStart === -1 ? -1 : security.indexOf('\n## ', supportedStart + 1);
const supported = supportedStart === -1 ? '' : security.slice(supportedStart, supportedEnd === -1 ? undefined : supportedEnd);
// Narrow claim, on purpose: this only asserts the honest disclaimer is present, tied to
// the tree's actual tag state (there must be none for "no release yet" to be true). It
// does not detect every way this section could overclaim a release — a fixed-phrase
// negative check here would be vacuous, since no real edit would use that exact phrase.
const tags = git(['tag', '-l']).split('\n').filter(Boolean);
const noOverclaim = tags.length === 0 && /no release yet/i.test(supported);
console.log(`security_no_release_overclaim=${noOverclaim ? 1 : 0}`);

const readme = read('README.md');
const rIdx = (heading) => readme.indexOf(heading);
const readmeOrder = [
  rIdx('License:'),
  rIdx('## Installing'),
  rIdx('## Developing'),
  rIdx('## Documentation'),
  rIdx('## Contributing'),
  rIdx('## Security'),
];
const readmeOrdered = readmeOrder.every((n) => n !== -1) && readmeOrder.every((n, i) => i === 0 || n > readmeOrder[i - 1]);
console.log(`readme_order=${readmeOrdered ? 1 : 0}`);

const body = read('docs/readme-body.md');
const BODY_MARKERS = ['## Status', '## What it is', '## Getting started', '## Developing'];
console.log(`readme_body_sections=${BODY_MARKERS.filter((h) => body.includes(h)).length}`);
