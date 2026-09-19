#!/usr/bin/env node
// Row C-06: React 19 and eslint-plugin-react-refresh 0.5 stay deferred. Reads the
// declared ranges in package.json.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const all = { ...pkg.dependencies, ...pkg.devDependencies };
const major = (range) => (range ?? '').replace(/^[^\d]*/, '').split('.')[0];
const line = (range) => (range ?? '').replace(/^[^\d]*/, '').split('.').slice(0, 2).join('.');

console.log(`react_major=${major(all.react)}`);
console.log(`react_dom_major=${major(all['react-dom'])}`);
console.log(`react_refresh_line=${line(all['eslint-plugin-react-refresh'])}`);
