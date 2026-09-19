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
const redefined = ['function ShellNavButton', 'function NavNodeButton', 'function NavigationTree', 'function ExtensionPane', 'function EmptyPane', 'function ShellResizeHandle', 'function clampPanePercent'].filter((d) => layout.includes(d)).length;

console.log(`split_modules_present=${present}`);
console.log(`split_modules_imported=${imported}`);
console.log(`pieces_still_defined_in_shelllayout=${redefined}`);
console.log(`pane_sizing_tests=${existsSync('src/components/__tests__/paneSizing.test.ts') ? 1 : 0}`);
