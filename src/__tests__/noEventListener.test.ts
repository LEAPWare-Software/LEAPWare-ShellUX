import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * NO LISTENER, NOWHERE UNDER `src/`. KEY HANDLING IN EXACTLY ONE MODULE.
 * ============================================================================
 * Several places — the `Hotkey` docblock in `src/core/types.ts`, ADR-0001
 * Amendment H, the `Hotkey` section of `DEVELOPER.md` and `README.md` — say that
 * the shell registers no event listener and dispatches no hotkey. Until this
 * file existed, all of them cited "hotkeys module — does not attach anything" in
 * `src/core/__tests__/hotkeys.test.ts`, which asserts something much smaller:
 * that `src/core/hotkeys.ts` exports three names and that calling those three
 * touches no `addEventListener`. It says nothing about `RegistryContext.tsx`,
 * `ActivationContext.tsx`, `ShellAPI.ts`, `App.tsx` or `main.tsx`; a listener
 * added to any of them tomorrow leaves it green.
 *
 * That gap is the ninth instance of the pattern ADR-0001 Amendment G exists to
 * stop: a conclusion written one step wider than the premise licensing it.
 *
 * ---------------------------------------------------------------------------
 * WHAT ISSUE-004 CHANGED, AND WHY THIS FILE WAS NARROWED RATHER THAN WEAKENED
 * ---------------------------------------------------------------------------
 * This file used to forbid `(?:add|remove)EventListener` AND
 * `key(?:down|up|press)` in every non-test module under `src/`, with no
 * exceptions. ISSUE-004's list virtualizer needs `onKeyDown` — arrow keys,
 * Home/End and Page Up/Down over a windowed list are the issue's own Definition
 * of Done, and there is no way to implement them without handling a key event.
 * So one of the two halves had to move, and the choice of WHICH is the point:
 *
 *   - **The listener half is unchanged and has no allowlist.** `addEventListener`
 *     and `removeEventListener` are still forbidden in every module under `src/`,
 *     with no exception mechanism at all. That half is what actually pins "no
 *     global listener, no hotkey dispatcher, no evaluation site", which is the
 *     property the prose sites are about. A `keydown` handler on one scroll
 *     container is not a dispatcher; a listener on `window` or `document` is.
 *   - **The key-event half is scoped to a named allowlist**, and the allowlist is
 *     exact in BOTH directions. A listed module that stops containing its
 *     spellings fails as a stale entry, and a listed module that grows a spelling
 *     its entry does not name fails too. An allowlist that only ever gets longer
 *     is not a guardrail; this one has to be maintained in step with the code.
 *
 * The alternative — deleting the file, or blanket-exempting `src/components/**` —
 * was rejected. Amendment G's three routes are name a test, narrow the claim, or
 * delete it, and narrowing is the one that keeps the evidence and the sentence
 * the same width. Every prose site that stated the wider claim was re-pointed at
 * the two titles below in the same change.
 *
 * **What is asserted, exactly.** Every `.ts`/`.tsx` file under `src/` that is not
 * itself a test is parsed with the TypeScript compiler, and the test fails if any
 * *code* position — identifier, property name, JSX attribute name, or
 * string/template literal — spells `addEventListener` or `removeEventListener`
 * anywhere at all, or spells `keydown`, `keyup` or `keypress` outside
 * `KEY_EVENT_ALLOWLIST`.
 *
 * **Why the compiler and not a text search.** Several of the modules being
 * scanned discuss this very absence in prose, so a raw text match would fail on
 * the sentences that describe the property. The parser puts comments in trivia
 * rather than in the tree, which is the distinction the claim actually needs, and
 * it is pinned by the "does not report a comment" case below.
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
 * listener either. A global `ResizeObserver` stub is deliberately NOT installed
 * there for the same family of reasons — see `VirtualizedList.tsx` decision 4.
 * ============================================================================
 */

/** `src/`, resolved from this file's own location rather than from the cwd. */
const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Listener registration. **Repo-wide, with no allowlist and no exceptions.**
 *
 * This is the half three prose sites are really about. Adding an exception
 * mechanism here would be the change that quietly ends the invariant, so there
 * is none: the only way to make this pass is not to register a listener.
 */
const LISTENER_REGISTRATION = /(?:add|remove)EventListener/i;

/**
 * Key-event spellings, allowlisted per module by `KEY_EVENT_ALLOWLIST`.
 *
 * `on…key…` handler names need no alternative of their own: `onKeyDown`
 * contains `KeyDown`, and the match is case-insensitive.
 */
const KEY_EVENT_NAME = /key(?:down|up|press)/i;

/** The union, used only by the planted-listener control below. */
const FORBIDDEN_IN_CODE = /(?:add|remove)EventListener|key(?:down|up|press)/i;

/**
 * The modules permitted to handle a key event, and the EXACT spellings each is
 * permitted to contain.
 *
 * One entry, and it earns it: `VirtualizedList` owns the only keyboard-navigable
 * widget in the shell, and its handler is bound to one scroll container through
 * a React prop. It reaches no `window`, no `document` and no chord table — which
 * is asserted below rather than asserted here in a comment.
 *
 * Spellings are listed unique and sorted, exactly as the scan reports them.
 */
const KEY_EVENT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'components/shared/VirtualizedList.tsx': Object.freeze(['handleKeyDown', 'onKeyDown']),
});

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

/** Every code word in one module matching `pattern`, as `file:line word`. */
function scanSource(file: string, text: string, pattern: RegExp = FORBIDDEN_IN_CODE): string[] {
  return scanFindings(file, text, pattern).map(
    (finding) => `${finding.file}:${finding.line} ${finding.word}`,
  );
}

/** The structured form of the same scan, for the allowlist comparison. */
function scanFindings(file: string, text: string, pattern: RegExp): Finding[] {
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
    if (word !== undefined && pattern.test(word)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({ file, line: line + 1, word });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
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

/** One module's text, read relative to `src/`. */
function read(file: string): string {
  return readFileSync(join(SRC_ROOT, file), 'utf8');
}

/** The distinct words a scan reported, sorted, so two lists compare directly. */
function distinctWords(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((finding) => finding.word))].sort();
}

/**
 * The modules that exist today. Named so that a walk which silently found
 * nothing — a renamed directory, a throwing `readdirSync` swallowed somewhere —
 * cannot make the scan pass by scanning an empty list. Listed as a subset, so
 * adding a module does not fail this case; the scan itself picks it up.
 */
const KNOWN_MODULES = [
  'App.tsx',
  'components/error/FaultBoundary.tsx',
  'components/layout/ShellLayout.tsx',
  'components/shared/VirtualizedList.tsx',
  'components/shared/virtualWindow.ts',
  'core/ActivationContext.tsx',
  'core/RegistryContext.tsx',
  'core/ShellAPI.ts',
  'core/hotkeys.ts',
  'core/types.ts',
  'main.tsx',
  'test/setup.ts',
];

describe('src/ — no listener is registered anywhere, and key events are handled in one module', () => {
  it('visits every module under src/, so an empty scan cannot pass vacuously', () => {
    expect(sourceFiles()).toEqual(expect.arrayContaining(KNOWN_MODULES));
  });

  it('finds no listener registration in any module under src/, with no exceptions at all', () => {
    const findings = sourceFiles().flatMap((file) =>
      scanSource(file, read(file), LISTENER_REGISTRATION),
    );
    expect(findings).toEqual([]);
  });

  it('finds no key-event name in any module outside the keyboard-navigation allowlist', () => {
    const findings = sourceFiles()
      .filter((file) => !Object.hasOwn(KEY_EVENT_ALLOWLIST, file))
      .flatMap((file) => scanSource(file, read(file), KEY_EVENT_NAME));
    expect(findings).toEqual([]);
  });

  it('holds the key-event allowlist to the exact spellings each listed module contains', () => {
    // Exact in BOTH directions. A listed module that no longer spells what its
    // entry claims fails as a stale exemption — the way an allowlist normally
    // rots — and a listed module that grows a spelling its entry does not name
    // fails as an unreviewed widening of the exemption.
    const modules = new Set(sourceFiles());
    for (const [file, permitted] of Object.entries(KEY_EVENT_ALLOWLIST)) {
      expect(modules.has(file)).toBe(true);
      expect(distinctWords(scanFindings(file, read(file), KEY_EVENT_NAME))).toEqual([...permitted]);
    }
  });

  it('registers no listener and names no window or document target in the allowlisted module', () => {
    // The exemption is for HANDLING a key on one element, not for reaching the
    // globals a dispatcher would need. Both are checked at the code level: the
    // module may discuss `window` in prose, and comments are not scanned.
    for (const file of Object.keys(KEY_EVENT_ALLOWLIST)) {
      const text = read(file);
      expect(scanSource(file, text, LISTENER_REGISTRATION)).toEqual([]);
      expect(distinctWords(scanFindings(file, text, /^(?:window|document)$/))).toEqual([]);
    }
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

  it('does not report a comment, which is why the docblocks may state the claim', () => {
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
