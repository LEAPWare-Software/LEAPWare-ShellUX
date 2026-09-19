#!/usr/bin/env node
// Rows C-22, C-23 and C-24: the design gates recorded in the tree. The owner's
// confirmation of the SHAPE-BRIEF gate points (D-40), gate 3's DESIGN.md with every
// colour a mirror of the generated stylesheet, and the owner's gate-4 approval (D-45).
import { existsSync, readFileSync } from 'node:fs';

const decisions = readFileSync('docs/DECISIONS.md', 'utf8');
const row = (id) => decisions.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
const cells = (line) => line.split('|').map((c) => c.trim());

const d40 = row('D-40');
// Each point as a whole section number: `§3` is not satisfied by `§30` or `§3.2`, and
// `§13.1` not by `§13.10`.
const point = (p) => new RegExp(`${p.replace('.', '\\.')}(?!\\d|\\.\\d)`);
const points = ['§3', '§4', '§9', '§13.1'].filter((p) => point(p).test(d40));
console.log(`d40_owner=${cells(d40)[3] === 'Owner' ? 1 : 0}`);
console.log(`d40_gate_points=${points.length}`);

const design = existsSync('DESIGN.md') ? readFileSync('DESIGN.md', 'utf8') : '';
const generated = readFileSync('src/styles/tokens.generated.css', 'utf8').toLowerCase();
const hexes = [...new Set((design.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase()))];
const sections = [/^## \d+\. Typography/m, /^spacing:/m, /^## \d+\. Elevation/m, /^### States/m, /^### Motion/m];
console.log(`design_sections=${sections.filter((re) => re.test(design)).length}`);
console.log(`design_hex_values=${hexes.length}`);
console.log(`design_hex_not_generated=${hexes.filter((h) => !generated.includes(h)).length}`);

const d45 = row('D-45');
console.log(`d45_owner=${cells(d45)[3] === 'Owner' ? 1 : 0}`);
console.log(`d45_screens_approved=${/gate-4 screens are approved/.test(d45) ? 1 : 0}`);
