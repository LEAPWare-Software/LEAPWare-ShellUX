#!/usr/bin/env node
// Row C-20: the licence is Apache-2.0 everywhere it is declared: LICENSE, NOTICE,
// package.json and the README line.
import { existsSync, readFileSync } from 'node:fs';

const licence = readFileSync('LICENSE', 'utf8');
const lines = licence.endsWith('\n') ? licence.split('\n').length - 1 : licence.split('\n').length;
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');

console.log(`licence_is_apache_2=${/Apache License\s+Version 2\.0, January 2004/.test(licence) ? 1 : 0}`);
console.log(`licence_lines=${lines}`);
console.log(`notice_present=${existsSync('NOTICE') ? 1 : 0}`);
console.log(`package_license=${pkg.license}`);
console.log(`readme_license_line=${/^License: \[Apache-2\.0\]\(LICENSE\)/m.test(readme) ? 1 : 0}`);
