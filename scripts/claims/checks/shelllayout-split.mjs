#!/usr/bin/env node
// Row C-29 (plan step 5, #95): wave 3 split `ShellLayout.tsx` before editing it. The
// pieces live in their own modules, `ShellLayout.tsx` imports them rather than
// defining them, and the pane-size helpers have direct unit tests.
import { existsSync, readFileSync } from 'node:fs';

const DIR = 'src/components/layout';
const MODULES = ['paneSizing.ts', 'ShellNavigation.tsx', 'ExtensionPane.tsx', 'ShellResizeHandle.tsx', 'useHostPalette.ts'];
const layoutRaw = readFileSync(`${DIR}/ShellLayout.tsx`, 'utf8');
// Strip comments before matching a "still defined here" name: a comment that merely
// mentions a moved piece's name (history, a TODO, a cross-reference) must not count as
// a redefinition. Block comments first, then line comments; a naive strip is safe here
// because the file has no string literal containing "/*", "*/" or "//" followed by code
// that a checker needs to see (checked by hand against this file).
const layout = layoutRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const present = MODULES.filter((m) => existsSync(`${DIR}/${m}`)).length;
const imported = MODULES.filter((m) => layoutRaw.includes(`from './${m.replace(/\.tsx?$/, '')}'`)).length;
// Every piece the box says moved: the components, the palette hook, and all six
// pane-size exports (review of C-29 found the first version checked one of six). Each
// name is checked against every definition form JS/TS offers it could be redefined as:
// a function declaration, a const/let (arrow function or otherwise), or a class.
const PIECE_NAMES = [
  'ShellNavButton', 'NavNodeButton', 'NavigationTree',
  'ExtensionPane', 'EmptyPane', 'ShellResizeHandle',
  'useHostPalette',
  'percentOf', 'clampToBand', 'clampPanePercent', 'isEngineDefaultLayout',
  'PANE_PX', 'PANE_FALLBACK_PERCENT',
];
const definitionForm = (name) => new RegExp(`\\b(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b|class\\s+${name}\\b)`);
const redefined = PIECE_NAMES.filter((name) => definitionForm(name).test(layout)).length;

console.log(`split_modules_present=${present}`);
console.log(`split_modules_imported=${imported}`);
console.log(`pieces_still_defined_in_shelllayout=${redefined}`);
console.log(`pane_sizing_tests=${existsSync('src/components/__tests__/paneSizing.test.ts') ? 1 : 0}`);
