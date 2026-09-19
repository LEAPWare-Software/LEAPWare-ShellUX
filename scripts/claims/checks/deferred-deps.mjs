#!/usr/bin/env node
// Row C-06: React 19 and eslint-plugin-react-refresh 0.5 stay deferred. A declared
// range in package.json (e.g. "^18.3.1") is satisfied by whatever npm actually
// resolved, so this reads the RESOLVED version from package-lock.json instead —
// tightened 2026-09-19 (proof audit item 18): the old check read package.json's
// range, which would still read react_major=18 even if the lockfile had resolved
// to a stray 19.x from a transitive bump.
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const resolved = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? '';
const major = (version) => version.split('.')[0];
const line = (version) => version.split('.').slice(0, 2).join('.');

console.log(`react_major=${major(resolved('react'))}`);
console.log(`react_version=${resolved('react')}`);
console.log(`react_dom_major=${major(resolved('react-dom'))}`);
console.log(`react_dom_version=${resolved('react-dom')}`);
console.log(`react_refresh_line=${line(resolved('eslint-plugin-react-refresh'))}`);
