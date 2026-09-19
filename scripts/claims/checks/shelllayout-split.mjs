#!/usr/bin/env node
// Row C-29 (plan step 5, #95): wave 3 split `ShellLayout.tsx` before editing it. The
// pieces live in their own modules, `ShellLayout.tsx` imports them rather than
// defining them, and the pane-size helpers have direct unit tests.
import { existsSync, readFileSync } from 'node:fs';

const DIR = 'src/components/layout';
const MODULES = ['paneSizing.ts', 'ShellNavigation.tsx', 'ExtensionPane.tsx', 'ShellResizeHandle.tsx', 'useHostPalette.ts'];
const layout = readFileSync(`${DIR}/ShellLayout.tsx`, 'utf8');

const present = MODULES.filter((m) => existsSync(`${DIR}/${m}`)).length;
const imported = MODULES.filter((m) => layout.includes(`from './${m.replace(/\.tsx?$/, '')}'`)).length;
// Every piece the box says moved: the components, the palette hook, and all six
// pane-size exports (review of C-29 found the first version checked one of six).
const PIECES = [
  /function ShellNavButton\b/, /function NavNodeButton\b/, /function NavigationTree\b/,
  /function ExtensionPane\b/, /function EmptyPane\b/, /function ShellResizeHandle\b/,
  /function useHostPalette\b/,
  /function percentOf\b/, /function clampToBand\b/, /function clampPanePercent\b/, /function isEngineDefaultLayout\b/,
  /const PANE_PX\b/, /const PANE_FALLBACK_PERCENT\b/,
];
const redefined = PIECES.filter((re) => re.test(layout)).length;

console.log(`split_modules_present=${present}`);
console.log(`split_modules_imported=${imported}`);
console.log(`pieces_still_defined_in_shelllayout=${redefined}`);
console.log(`pane_sizing_tests=${existsSync('src/components/__tests__/paneSizing.test.ts') ? 1 : 0}`);
