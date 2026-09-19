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
const generatedRaw = readFileSync('src/styles/tokens.generated.css', 'utf8');
const generated = generatedRaw.toLowerCase();
// Every colour-literal form the design system may write: 3/6/8-digit hex, and the
// functional notations. rgb()/rgba()/hsl()/oklch() are matched by their whole call so a
// value can be bound below, not merely detected.
const COLOR_LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\([^)]*\)/g;
const hexes = [...new Set((design.match(COLOR_LITERAL) ?? []).map((h) => h.toLowerCase()))];
const sections = [/^## \d+\. Typography/m, /^spacing:/m, /^## \d+\. Elevation/m, /^### States/m, /^### Motion/m];
console.log(`design_sections=${sections.filter((re) => re.test(design)).length}`);
console.log(`design_hex_values=${hexes.length}`);
// Weak, existence-only form kept for continuity — every literal appears SOMEWHERE in
// the generated file (as a value or a trailing hex comment).
console.log(`design_hex_not_generated=${hexes.filter((h) => !generated.includes(h.replace(/px/g, ''))).length}`);

// Stronger form: bind each frontmatter colour name to the CSS custom property named
// beside it in the body (section 2's parentheticals, e.g. "Instrument Petrol
// (accent-petrol, `--accent-solid`)"), and require the generated stylesheet's DEFAULT
// theme block (`:root, [data-theme='leapware-light'], [data-theme='light']`) records
// that exact hex as that property's trailing comment. This is the strongest binding the
// generated file supports: its live *value* is an oklch() the generator computed, and
// the hex survives only as a comment recording what it was generated from.
const rootBlockMatch = generatedRaw.match(/:root,\s*\n\[data-theme='leapware-light'\][^{]*\{([\s\S]*?)\n\}/);
const rootBlock = rootBlockMatch ? rootBlockMatch[1] : '';
const cssVarHex = new Map();
for (const m of rootBlock.matchAll(/(--[\w-]+):\s*[^;]+;\s*\/\*\s*(#[0-9a-fA-F]{3,8})\s*\*\//g)) {
  cssVarHex.set(m[1], m[2].toLowerCase());
}
// Also bind the two literal-value custom properties (shadows) directly: DESIGN.md
// writes their value inline, and the generated file writes the same property with a
// literal value (no comment indirection), so these compare value to value.
for (const m of rootBlock.matchAll(/(--shadow-[\w-]+):\s*([^;]+);/g)) {
  cssVarHex.set(m[1], m[2].trim().toLowerCase().replace(/px/g, ''));
}

const colorsBlockMatch = design.match(/\ncolors:\n([\s\S]*?)\n\w/);
const frontmatterColors = new Map();
if (colorsBlockMatch) {
  for (const m of colorsBlockMatch[1].matchAll(/^\s*([\w-]+):\s*"(#[0-9a-fA-F]{3,8})"/gm)) {
    frontmatterColors.set(m[1], m[2].toLowerCase());
  }
}
// name -> [cssVars] from the body's "(name, `--var`[, `--var2`...])" parentheticals.
const nameToVars = new Map();
for (const m of design.matchAll(/\(([\w-]+),\s*((?:`--[\w-]+`,?\s*)+)\)/g)) {
  const vars = [...m[2].matchAll(/`(--[\w-]+)`/g)].map((v) => v[1]);
  if (frontmatterColors.has(m[1])) nameToVars.set(m[1], vars);
}
// Also bind the two named shadow tokens directly: "(`--shadow-overlay`: `<value>`)".
const shadowBindings = [];
for (const m of design.matchAll(/`(--shadow-[\w-]+)`:\s*`([^`]+)`/g)) {
  shadowBindings.push([m[1], m[2].toLowerCase().replace(/px/g, '')]);
}

let boundChecked = 0;
let boundMismatched = 0;
for (const [name, hex] of frontmatterColors) {
  const vars = nameToVars.get(name) ?? [];
  const matchedVars = vars.filter((v) => cssVarHex.has(v));
  if (matchedVars.length === 0) continue; // no body binding found for this name; not counted either way
  boundChecked += 1;
  if (!matchedVars.some((v) => cssVarHex.get(v) === hex)) boundMismatched += 1;
}
for (const [varName, value] of shadowBindings) {
  if (!cssVarHex.has(varName)) continue;
  boundChecked += 1;
  if (cssVarHex.get(varName) !== value) boundMismatched += 1;
}
console.log(`design_hex_bound_checked=${boundChecked}`);
console.log(`design_hex_bound_mismatched=${boundMismatched}`);

const d45 = row('D-45');
console.log(`d45_owner=${cells(d45)[3] === 'Owner' ? 1 : 0}`);
console.log(`d45_screens_approved=${/gate-4 screens are approved/.test(d45) ? 1 : 0}`);
