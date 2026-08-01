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
 * So one of the two halves had to move, and the choice of WHICH was the point:
 * the listener half stayed absolute with no allowlist mechanism at all, and the
 * key-event half was scoped to a named allowlist, exact in BOTH directions.
 *
 * ---------------------------------------------------------------------------
 * WHAT ISSUE-006 CHANGED, AND WHY THE LISTENER HALF WAS NARROWED TOO
 * ---------------------------------------------------------------------------
 * **The half ISSUE-004 deliberately kept absolute is now allowlisted, and this is
 * the honest record of that.** ISSUE-006 builds the hotkey dispatcher ADR-0001
 * Amendment H deferred. A dispatcher is a global `keydown` listener; there is no
 * version of it that does not register one. So the sentence "no module under
 * `src/` registers a listener at all" stopped being true, and Amendment G's three
 * routes are name a test, narrow the claim, or delete it.
 *
 * **Narrowing beat deleting, for the same reason it did in ISSUE-004 and one
 * more.** Deleting the file would destroy the evidence for a claim made in eight
 * places — that the host installs no ambient key handling it has not argued for —
 * at exactly the moment the first such handler lands, which is when the evidence
 * is worth most. What survives narrowing is the property that actually matters
 * going forward: there is exactly ONE listener in the repository, it is in a named
 * file, and a second one cannot appear without editing this test.
 *
 * **And a source scan is the weaker half of the new claim, so it is not the whole
 * of it.** A text scan can see that `addEventListener` appears once and
 * `removeEventListener` once; it cannot see that they name the same event, or that
 * the cleanup removes the SAME function reference — and an `addEventListener`
 * whose cleanup passes a freshly-built closure leaks a listener per mount while
 * satisfying every count this file can take. That pairing is therefore pinned at
 * RUNTIME instead, by spying on `window` across a mount and an unmount: *tests:*
 * "adds exactly one keydown listener and removes the identical handler on
 * unmount" and "registers once under StrictMode, whose simulated remount is
 * symmetric" in `src/core/__tests__/hotkeyDispatch.test.tsx`. This file keeps the
 * cheaper half — the counts, and the fact that nothing ELSE registers anything —
 * and the two together are the replacement for what the absolute scan gave for
 * free.
 *
 * Both allowlists are exact in BOTH directions. A listed module that stops
 * containing its spellings fails as a stale entry, and a listed module that grows
 * a spelling its entry does not name fails as an unreviewed widening. An
 * allowlist that only ever gets longer is not a guardrail. Every prose site that
 * stated the wider claim was re-pointed at the titles below in the same change.
 *
 * **What is asserted, exactly.** Every `.ts`/`.tsx` file under `src/` that is not
 * itself a test is parsed with the TypeScript compiler, and the test fails if any
 * *code* position — identifier, property name, JSX attribute name, or
 * string/template literal — spells `addEventListener` or `removeEventListener`
 * outside `HOTKEY_DISPATCH_ALLOWLIST`, or spells `keydown`, `keyup` or `keypress`
 * outside `KEY_EVENT_ALLOWLIST`.
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
 * Listener registration, allowlisted per module by `HOTKEY_DISPATCH_ALLOWLIST`.
 *
 * Absolute until ISSUE-006. It is now scoped to one named module for one named
 * reason — see the second block of the banner — and the counts below are what
 * stops that exemption growing an extra listener nobody argued for.
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
 * Two entries, for two different reasons, and neither is a general licence:
 *
 *  - `VirtualizedList` owns the only keyboard-navigable widget in the shell, and
 *    its handler is bound to one scroll container through a React prop. It reaches
 *    no `window`, no `document` and no chord table — asserted below rather than
 *    asserted here in a comment.
 *  - `hotkeyDispatch` is the shell's one global dispatcher. Its single spelling is
 *    the event name it registers for; it declares no `onKeyDown` prop and handles
 *    no other key event.
 *
 * Spellings are listed unique and sorted, exactly as the scan reports them.
 */
const KEY_EVENT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'components/shared/VirtualizedList.tsx': Object.freeze(['handleKeyDown', 'onKeyDown']),
  'core/hotkeyDispatch.ts': Object.freeze(['keydown']),
});

/**
 * The modules permitted to REGISTER a listener, and the exact spellings each is
 * permitted to contain.
 *
 * **One entry, and it is meant to stay one entry.** The whole value of narrowing
 * rather than deleting is that a second global listener cannot appear without an
 * edit to this object, which is a line in a diff a reviewer has to approve.
 */
const HOTKEY_DISPATCH_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'core/hotkeyDispatch.ts': Object.freeze(['addEventListener', 'removeEventListener']),
});

/**
 * How many times each listed module may spell each listener name.
 *
 * A count rather than a presence check, because "one `addEventListener` and one
 * `removeEventListener`" is a materially stronger statement than "some": a second
 * `addEventListener` slipped into the same module is exactly the change this
 * allowlist would otherwise wave through.
 */
const LISTENER_OCCURRENCES: Readonly<Record<string, Readonly<Record<string, number>>>> =
  Object.freeze({
    'core/hotkeyDispatch.ts': Object.freeze({ addEventListener: 1, removeEventListener: 1 }),
  });

/**
 * Key-event modules that are NOT permitted a listener.
 *
 * Derived rather than transcribed, so that adding a module to either allowlist
 * cannot leave this set stale. Its one member is the list widget: an exemption to
 * HANDLE a key on one element is not an exemption to reach the globals a
 * dispatcher needs, and that distinction is asserted below.
 */
const HANDLER_ONLY_MODULES: readonly string[] = Object.keys(KEY_EVENT_ALLOWLIST).filter(
  (file) => !Object.hasOwn(HOTKEY_DISPATCH_ALLOWLIST, file),
);

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
  'core/hotkeyDispatch.ts',
  'core/hotkeys.ts',
  'core/ribbonAction.ts',
  'core/types.ts',
  'main.tsx',
  'test/setup.ts',
];

/** Every occurrence of `pattern` in one module's code, counted by spelling. */
function countWords(file: string, text: string, pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const finding of scanFindings(file, text, pattern)) {
    counts[finding.word] = (counts[finding.word] ?? 0) + 1;
  }
  return counts;
}

describe('src/ — no listener is registered anywhere, and key events are handled in one module', () => {
  it('visits every module under src/, so an empty scan cannot pass vacuously', () => {
    expect(sourceFiles()).toEqual(expect.arrayContaining(KNOWN_MODULES));
  });

  it('finds no listener registration in any module outside the hotkey-dispatch allowlist', () => {
    const findings = sourceFiles()
      .filter((file) => !Object.hasOwn(HOTKEY_DISPATCH_ALLOWLIST, file))
      .flatMap((file) => scanSource(file, read(file), LISTENER_REGISTRATION));
    expect(findings).toEqual([]);
  });

  it('finds no key-event name in any module outside the key-event allowlist', () => {
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

  it('holds the hotkey-dispatch allowlist to the exact spellings the dispatcher contains', () => {
    // Same rule, same both directions, applied to the half that used to have no
    // allowlist at all. The entry has to name a module that exists and has to
    // name every listener spelling that module contains.
    const modules = new Set(sourceFiles());
    for (const [file, permitted] of Object.entries(HOTKEY_DISPATCH_ALLOWLIST)) {
      expect(modules.has(file)).toBe(true);
      expect(distinctWords(scanFindings(file, read(file), LISTENER_REGISTRATION))).toEqual([
        ...permitted,
      ]);
    }
  });

  it('holds the dispatcher to exactly one addEventListener and one removeEventListener', () => {
    // A COUNT, not a presence check. "Some addEventListener" would wave through a
    // second global listener added to the same file, which is precisely the
    // change the allowlist must not make invisible. What a count still cannot see
    // is whether the two name the same event and the same function reference —
    // that is pinned at runtime in `src/core/__tests__/hotkeyDispatch.test.tsx`.
    for (const [file, expected] of Object.entries(LISTENER_OCCURRENCES)) {
      expect(countWords(file, read(file), LISTENER_REGISTRATION)).toEqual({ ...expected });
    }
  });

  it('registers no listener and names no window or document target in the allowlisted module', () => {
    // The exemption is for HANDLING a key on one element, not for reaching the
    // globals a dispatcher would need. The dispatcher is excluded by
    // construction, which is what `HANDLER_ONLY_MODULES` derives — and it is
    // pinned to its one member here so that "the allowlisted module" stays
    // singular and stays the list widget. Both checks are at the code level: a
    // module may discuss `window` in prose, and comments are not scanned.
    expect(HANDLER_ONLY_MODULES).toEqual(['components/shared/VirtualizedList.tsx']);
    for (const file of HANDLER_ONLY_MODULES) {
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
