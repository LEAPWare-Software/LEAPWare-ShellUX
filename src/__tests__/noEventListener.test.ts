import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * NO LISTENER, NOWHERE UNDER `src/`. THE CLAIM AND ITS EVIDENCE, IN ONE PLACE.
 * ============================================================================
 * Three places — the `Hotkey` docblock in `src/core/types.ts`, ADR-0001
 * Amendment H, and the `Hotkey` section of `DEVELOPER.md` — say that **there is
 * no `keydown` listener anywhere in `src/`**. Until this file existed, all three
 * cited "hotkeys module — does not attach anything" in
 * `src/core/__tests__/hotkeys.test.ts`, which asserts something much smaller:
 * that `src/core/hotkeys.ts` exports three names and that calling those three
 * touches no `addEventListener`. It says nothing about `RegistryContext.tsx`,
 * `ActivationContext.tsx`, `ShellAPI.ts`, `App.tsx` or `main.tsx`; a listener
 * added to any of them tomorrow leaves it green.
 *
 * That gap is the ninth instance of the pattern ADR-0001 Amendment G exists to
 * stop: a conclusion written one step wider than the premise licensing it.
 * Amendment G offers three ways out — name a test, narrow the claim, or delete
 * it. This file takes the first and widest: the repo-wide sentence stays, and
 * the evidence is widened to match it.
 *
 * **What is asserted, exactly.** Every `.ts`/`.tsx` file under `src/` that is
 * not itself a test is parsed with the TypeScript compiler, and the test fails
 * if any *code* position — identifier, property name, JSX attribute name, or
 * string/template literal — spells `addEventListener`, `removeEventListener`,
 * `keydown`, `keyup` or `keypress`. Not just the hotkey modules: all of them.
 * The scan is over the whole listener surface rather than the keyboard one
 * alone, because "no dispatcher and no evaluation site" is the claim, and the
 * shell registers no listener of any kind today.
 *
 * **Why the compiler and not a text search.** Three of the modules being
 * scanned discuss this very absence in prose, so a raw text match would fail on
 * the sentences that describe the property. The parser puts comments in trivia
 * rather than in the tree, so a docblock may say `keydown` and a line of code
 * may not — which is the distinction the claim actually needs, and it is pinned
 * by the "does not report a comment" case below.
 *
 * **What is not asserted.** A listener reached through a name this scan cannot
 * see as text — `el[fromSomeVariable](...)`, or a handler installed by a
 * third-party module `src/` merely imports — would pass. This is a guardrail
 * against the ordinary way a listener gets added, not a proof that no listener
 * can exist; per Amendment G that limit is stated here rather than glossed. The
 * planted-listener cases below fix what "the ordinary way" covers.
 *
 * `src/test/setup.ts` is scanned along with the shipped modules. It is test
 * infrastructure but it is not a test, and nothing in it should be attaching a
 * listener either.
 * ============================================================================
 */

/** `src/`, resolved from this file's own location rather than from the cwd. */
const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The spellings that would make the repo-wide claim false.
 *
 * `on…key…` handler names need no alternative of their own: `onKeyDown`
 * contains `KeyDown`, and the match is case-insensitive.
 */
const FORBIDDEN_IN_CODE = /(?:add|remove)EventListener|key(?:down|up|press)/i;

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly word: string;
}

/**
 * The text a node contributes to the scan, or `undefined` for a node that
 * carries none. Comments reach neither branch: the parser keeps them as trivia.
 */
function codeWordOf(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return undefined;
}

/** Every forbidden spelling in one module's code, as `file:line word`. */
function scanSource(file: string, text: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const word = codeWordOf(node);
    if (word !== undefined && FORBIDDEN_IN_CODE.test(word)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({ file, line: line + 1, word });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Formatted rather than structured, so a failure names the file and the line
  // to open instead of printing an object diff.
  return findings.map((finding) => `${finding.file}:${finding.line} ${finding.word}`);
}

/** Whether a repository-relative POSIX path is a test rather than a module. */
function isTestPath(path: string): boolean {
  return path.split('/').includes('__tests__') || /\.(?:test|spec)\.tsx?$/.test(path);
}

/** Every non-test `.ts`/`.tsx` file under `src/`, as paths relative to `src/`. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') {
          continue;
        }
        walk(full);
        continue;
      }
      const path = relative(SRC_ROOT, full).split(sep).join('/');
      if (!/\.tsx?$/.test(path) || isTestPath(path)) {
        continue;
      }
      found.push(path);
    }
  };
  walk(SRC_ROOT);
  return found.sort();
}

/**
 * The modules that exist today. Named so that a walk which silently found
 * nothing — a renamed directory, a throwing `readdirSync` swallowed somewhere —
 * cannot make the scan pass by scanning an empty list. Listed as a subset, so
 * adding a module does not fail this case; the scan itself picks it up.
 */
const KNOWN_MODULES = [
  'App.tsx',
  'core/ActivationContext.tsx',
  'core/RegistryContext.tsx',
  'core/ShellAPI.ts',
  'core/hotkeys.ts',
  'core/types.ts',
  'main.tsx',
  'test/setup.ts',
];

describe('src/ — no event listener is registered outside the tests', () => {
  it('visits every module under src/, so an empty scan cannot pass vacuously', () => {
    expect(sourceFiles()).toEqual(expect.arrayContaining(KNOWN_MODULES));
  });

  it('finds no listener registration and no key-event name in any module under src/', () => {
    const findings = sourceFiles().flatMap((file) =>
      scanSource(file, readFileSync(join(SRC_ROOT, file), 'utf8')),
    );
    expect(findings).toEqual([]);
  });

  it('reports a planted listener, however it is spelled', () => {
    const planted: [string, string][] = [
      [
        'App.tsx',
        'export function App() {\n  window.addEventListener("keydown", () => {});\n  return null;\n}\n',
      ],
      ['Pane.tsx', 'export const Pane = () => <div onKeyDown={() => {}} />;\n'],
      ['attach.ts', 'export function attach(el: HTMLElement) {\n  el.onkeydown = () => {};\n}\n'],
      [
        'indirect.ts',
        'export function attach(el: HTMLElement) {\n  el["addEventListener"]("keydown", () => {});\n}\n',
      ],
      [
        'react.tsx',
        'import { useEffect } from "react";\nexport function useChord() {\n' +
          '  useEffect(() => document.addEventListener("keyup", () => {}), []);\n}\n',
      ],
    ];

    for (const [file, source] of planted) {
      expect(scanSource(file, source).length).toBeGreaterThan(0);
    }
  });

  it('does not report a comment, which is why three docblocks may state the claim', () => {
    const prose =
      '/**\n' +
      ' * There is no `keydown` listener anywhere in `src/`: no addEventListener,\n' +
      ' * no onKeyDown, no keyup and no keypress.\n' +
      ' */\n' +
      '// Not here either: addEventListener("keydown").\n' +
      'export const dispatchesNothing = true;\n';
    expect(scanSource('prose.ts', prose)).toEqual([]);
  });
});
