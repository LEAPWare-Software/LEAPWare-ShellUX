import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * THE SAME INVARIANT, IN THE PROCESS THE OTHER SCAN CANNOT SEE.
 * ============================================================================
 * `src/__tests__/noEventListener.test.ts` is this repository's guarantee that
 * ambient key handling and ambient listeners exist only where somebody argued
 * for them. It resolves its root as `dirname(dirname(import.meta.url))` — that
 * is, `src/` — and walks from there. **So `electron/` is outside it by
 * construction, and always was.** Nothing in that file is wrong; what would be
 * wrong is reading its green result as covering a directory it has never
 * visited. A native host process that grew a keyboard layer, a second window
 * handler or a stray `addEventListener` would not have failed a single
 * assertion anywhere in this repository.
 *
 * This file is the replacement, and it is deliberately NOT the same scan pointed
 * at a different directory. **A copy of the `src/` patterns run over `electron/`
 * would pass vacuously and constrain nothing**, because Electron's API is
 * `EventEmitter`-shaped: `app.on`, `webContents.on`, `nativeTheme.on`,
 * `port.on`. `addEventListener` appears zero times in the main process today and
 * would go on appearing zero times through any amount of listener growth. A scan
 * that cannot fail is not a guardrail; it is a green tick that discharges an
 * invariant nobody is checking, which is the exact pattern ADR-0001 Amendment G
 * exists to stop.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED, EXACTLY
 * ---------------------------------------------------------------------------
 * Every `.ts`/`.cts` file under `electron/` that is not itself a test is parsed
 * with the TypeScript compiler, and three claims are made about it:
 *
 *  1. **`addEventListener` / `removeEventListener` appear nowhere.** Absolute,
 *     with no allowlist mechanism at all — the state `src/` was in before
 *     ISSUE-006. The main process has no DOM; the preload has one and does not
 *     touch it. If the bootstrap key listener the plan describes ever moves into
 *     the preload realm, this is where it is argued for, and narrowing this rule
 *     is a line in a diff a reviewer has to approve.
 *  2. **Every `EventEmitter` registration is counted, per module, exact in both
 *     directions.** A module that stops registering what its entry claims fails
 *     as a stale exemption; a module that grows a registration its entry does not
 *     name fails as an unreviewed widening. This is the claim that actually bites
 *     in a main process, and it is the reason this file exists rather than a
 *     copied one.
 *  3. **`before-input-event` appears in exactly one module, exactly once.** The
 *     plan is explicit that it is used for *exactly one thing* — an escape hatch
 *     for chords that must fire when a renderer is wedged — because it fires
 *     before DOM handling and carries no target and no `defaultPrevented`, so
 *     the suppression rules in `src/core/hotkeyDispatch.ts` cannot run there. A
 *     second `before-input-event` handler is how that becomes a keyboard layer
 *     by accident, and it fails here.
 *
 * **Why the compiler and not a text search.** Several of the modules being
 * scanned discuss these very absences in prose, so a raw text match would fail
 * on the sentences describing the property. The parser keeps comments in trivia
 * rather than in the tree, which is the distinction the claim needs, and it is
 * pinned by the "does not report a comment" case below.
 *
 * **What is not asserted.** A listener reached through a name this scan cannot
 * see as text — `emitter[fromSomeVariable](...)` — would pass, and so would one
 * installed by a dependency the main process merely imports. Per Amendment G
 * that limit is stated here rather than glossed.
 * ============================================================================
 */

/** `electron/`, resolved from this file's own location rather than from the cwd. */
const ELECTRON_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The DOM spelling. Absolute in this directory; see claim 1. */
const LISTENER_REGISTRATION = /(?:add|remove)EventListener/i;

/**
 * The `EventEmitter` spellings, which are what a main process actually uses.
 *
 * Anchored, so `onmessage`, `onViolation` and `once`-containing words are not
 * swept in: the claim is about a registration call, not about a name that
 * happens to start with `on`.
 */
const EMITTER_REGISTRATION = /^(?:on|once|off|addListener|prependListener|removeListener)$/;

/** The escape hatch's event name; see claim 3. */
const BEFORE_INPUT_EVENT = /^before-input-event$/;

/**
 * Every `EventEmitter` registration in the native host, per module and per
 * spelling.
 *
 * **This is a census, not a permission slip.** Each number is a fact about the
 * file it names, and every one of them is a listener somebody has to have
 * decided about. Adding an event to the host is a line here; so is deleting one.
 */
const EMITTER_OCCURRENCES: Readonly<Record<string, Readonly<Record<string, number>>>> =
  Object.freeze({
    // The lifecycle: the split channel, the store relay, the palette routing,
    // the diagnostics-report channel, the window closing, macOS `activate`, and
    // `window-all-closed` — plus the two process-level fault handlers GitHub
    // issue #86 added: `process.on('uncaughtException', ...)` and
    // `process.on('unhandledRejection', ...)`.
    'main/index.ts': Object.freeze({ on: 9 }),
    // The escape hatch, and nothing else. Claim 3 pins it to this file.
    'main/paneKeyBridge.ts': Object.freeze({ on: 1 }),
    // The window and both views: two navigation rules, three diagnostics, the
    // load/focus/destroy signals the focus ring reads, the geometry signals, and
    // the system-appearance pair.
    'main/paneViews.ts': Object.freeze({ on: 11, off: 1 }),
    // Two, and the second one is a DECLARATION rather than a call: the adapter
    // restates the three members of `MessagePortMain` it touches, and `on` is
    // one of them. The scan cannot tell a method signature from an invocation
    // and is not asked to — what it is asked is whether this file's count moved,
    // and adding a real second registration here would move it either way.
    'main/portAdapter.ts': Object.freeze({ on: 2 }),
    // The updater's own events, plus the two renderer channels and the
    // per-contents first-state delivery.
    'main/updater.ts': Object.freeze({ on: 10 }),
    // The preload's four inbound channels: the updater's state, one replicated-
    // store message from the other surface, the peer-ready signal that tells host
    // chrome to re-attach its port after the extension view reloads, and the
    // routed host chord that another surface matched.
    'preload/index.cts': Object.freeze({ on: 4 }),
  });

/**
 * The one module permitted to spell `before-input-event`, and how often.
 *
 * Separate from the census above rather than folded into it, because it is a
 * different claim: the census says how many listeners exist, and this says that
 * the one main-process door which BYPASSES the renderer's suppression logic is
 * singular. Merging them would let a second `before-input-event` handler hide
 * inside an incremented count.
 */
const BEFORE_INPUT_OCCURRENCES: Readonly<Record<string, number>> = Object.freeze({
  'main/paneKeyBridge.ts': 1,
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

function scanFindings(file: string, text: string, pattern: RegExp): Finding[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
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

/** Every code word in one module matching `pattern`, as `file:line word`. */
function scanSource(file: string, text: string, pattern: RegExp): string[] {
  return scanFindings(file, text, pattern).map(
    (finding) => `${finding.file}:${finding.line} ${finding.word}`,
  );
}

/** Every occurrence of `pattern` in one module's code, counted by spelling. */
function countWords(file: string, text: string, pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const finding of scanFindings(file, text, pattern)) {
    counts[finding.word] = (counts[finding.word] ?? 0) + 1;
  }
  return counts;
}

/** Whether a repository-relative POSIX path is a test rather than a module. */
function isTestPath(path: string): boolean {
  return path.split('/').includes('__tests__') || /\.(?:test|spec)\.[cm]?tsx?$/.test(path);
}

/** Every non-test `.ts`/`.cts` file under `electron/`, relative to `electron/`. */
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
      const path = relative(ELECTRON_ROOT, full).split(sep).join('/');
      if (!/\.c?tsx?$/.test(path) || isTestPath(path)) {
        continue;
      }
      found.push(path);
    }
  };
  walk(ELECTRON_ROOT);
  return found.sort();
}

function read(file: string): string {
  return readFileSync(join(ELECTRON_ROOT, file), 'utf8');
}

/**
 * The modules that exist today.
 *
 * Named so that a walk which silently found nothing — a renamed directory, a
 * throwing `readdirSync` swallowed somewhere — cannot make the scan pass by
 * scanning an empty list. This is the vacuity guard, and in a file whose whole
 * argument is that a copied scan would pass vacuously it is not optional.
 */
const KNOWN_MODULES = [
  'main/focusRing.ts',
  'main/index.ts',
  'main/paneKeyBridge.ts',
  'main/paneViews.ts',
  'main/portAdapter.ts',
  'main/surfaces.ts',
  'main/updater.ts',
  'preload/index.cts',
];

describe('electron/ — the native host registers no DOM listener, and every emitter registration is counted', () => {
  it('visits every module under electron/, so an empty scan cannot pass vacuously', () => {
    expect(sourceFiles()).toEqual(expect.arrayContaining(KNOWN_MODULES));
  });

  it('finds no addEventListener or removeEventListener anywhere in the native host', () => {
    const findings = sourceFiles().flatMap((file) =>
      scanSource(file, read(file), LISTENER_REGISTRATION),
    );
    expect(findings).toEqual([]);
  });

  it('counts every EventEmitter registration, exact in both directions', () => {
    // Both directions: a module in the census that no longer registers what it
    // claims fails as stale, and a module that grows a registration fails as
    // unreviewed. The comparison is over the FULL set of modules, so a new file
    // with a listener in it fails as an absent census entry rather than being
    // skipped.
    const census: Record<string, Record<string, number>> = {};
    for (const file of sourceFiles()) {
      const counts = countWords(file, read(file), EMITTER_REGISTRATION);
      if (Object.keys(counts).length > 0) {
        census[file] = counts;
      }
    }
    expect(census).toEqual(
      Object.fromEntries(
        Object.entries(EMITTER_OCCURRENCES).map(([file, counts]) => [file, { ...counts }]),
      ),
    );
  });

  it('holds before-input-event to exactly one module and exactly one registration', () => {
    // The plan's sentence, as a value: `before-input-event` is used for exactly
    // one thing. It fires before DOM handling and carries no target and no
    // `defaultPrevented`, so `isSuppressed` and `isEditableTarget` in
    // `src/core/hotkeyDispatch.ts` cannot run there — which makes a second
    // handler here a chord that fires into a text field the user is typing in.
    const found: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const hits = scanFindings(file, read(file), BEFORE_INPUT_EVENT).length;
      if (hits > 0) {
        found[file] = hits;
      }
    }
    expect(found).toEqual({ ...BEFORE_INPUT_OCCURRENCES });
  });

  it('reports a planted listener, however it is spelled', () => {
    const planted: [string, RegExp, string][] = [
      [
        'main/rogue.ts',
        LISTENER_REGISTRATION,
        'export function attach(target: EventTarget) {\n  target.addEventListener("keydown", () => {});\n}\n',
      ],
      [
        'main/rogue.ts',
        LISTENER_REGISTRATION,
        'export function attach(target: Record<string, unknown>) {\n  (target["addEventListener"] as () => void)();\n}\n',
      ],
      [
        'main/rogue.ts',
        EMITTER_REGISTRATION,
        'import { app } from "electron";\napp.on("browser-window-created", () => {});\n',
      ],
      [
        'main/rogue.ts',
        EMITTER_REGISTRATION,
        'import { app } from "electron";\napp.once("ready", () => {});\n',
      ],
      [
        'main/rogue.ts',
        BEFORE_INPUT_EVENT,
        'export function attach(c: { on: (e: string, f: () => void) => void }) {\n  c.on("before-input-event", () => {});\n}\n',
      ],
    ];

    for (const [file, pattern, source] of planted) {
      expect(scanSource(file, source, pattern).length).toBeGreaterThan(0);
    }
  });

  it('does not sweep in a name that merely begins with "on"', () => {
    // `onmessage` is `PortLike`'s handler property and `onViolation` is
    // `AuthoritativeStore`'s report door. Neither is a registration, and a
    // pattern that could not tell them apart would make the census meaningless
    // the first time the transport lands in this process.
    const source =
      'export interface Seam { onmessage: ((m: unknown) => void) | null }\n' +
      'export const options = { onViolation: () => {}, once: false };\n';
    expect(scanSource('main/probe.ts', source, EMITTER_REGISTRATION)).toEqual([
      'main/probe.ts:2 once',
    ]);
  });

  it('does not report a comment, which is why the docblocks may state the claim', () => {
    const prose =
      '/**\n' +
      ' * There is no addEventListener here, and no before-input-event handler:\n' +
      ' * nothing in this file calls .on(), .once() or .off().\n' +
      ' */\n' +
      '// Not here either: contents.on("before-input-event").\n' +
      'export const registersNothing = true;\n';
    expect(scanSource('prose.ts', prose, LISTENER_REGISTRATION)).toEqual([]);
    expect(scanSource('prose.ts', prose, EMITTER_REGISTRATION)).toEqual([]);
    expect(scanSource('prose.ts', prose, BEFORE_INPUT_EVENT)).toEqual([]);
  });
});
