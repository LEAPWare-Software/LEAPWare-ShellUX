#!/usr/bin/env node
/**
 * check-citations.mjs — the mechanical half of ADR-0001 Amendment G.
 *
 * Amendment G says that no sentence asserting a security property may stand in a
 * `.md` file or a docblock unless it names the test that exercises it. That rule
 * has two halves, and only one of them is machine-checkable today:
 *
 *   1. Every security claim carries a citation.        NOT CHECKED. See LIMITS.
 *   2. Every citation names a test that really exists. CHECKED, here.
 *
 * Half 2 is the half with teeth. A citation naming a test that has since been
 * renamed, split or deleted is indistinguishable from a false claim to a reader:
 * the prose still reads as evidenced, and the evidence is gone. Seven review
 * rounds produced Amendment G because prose kept drifting wider than the tests
 * licensing it; a stale citation is that same drift arriving by decay rather
 * than by authorship.
 *
 * What it enforces, and why each rule earns its place:
 *
 *   unresolved-test-title   A quoted title cited after a citation marker that
 *                           matches no `it`/`describe` title anywhere in the
 *                           suite. Either the test was renamed or removed, or the
 *                           citation never named a real test.
 *   unknown-test-file       A test-file path named after a citation marker that
 *                           exists nowhere in the working tree, by full path or
 *                           by basename. A citation pointing at a file that is
 *                           gone reads as evidence and is not.
 *
 * ---------------------------------------------------------------------------
 * LIMITS — what this checker does NOT catch. Stated here rather than glossed,
 * because a checker that is believed to do more than it does is worse than none.
 *
 *   - **It cannot tell that a security sentence has no citation at all.** That
 *     is the harder half of Amendment G and it is deliberately out of scope: it
 *     needs a definition of "security claim" precise enough to match on, and
 *     shipping a keyword grep for `cannot`/`impossible` would flag mostly prose
 *     about architecture and React semantics. A checker with a high false-
 *     positive rate trains reviewers to ignore it. See GitHub issue #5.
 *   - **It does not check that a cited title lives in the cited FILE.** A window
 *     of prose routinely names several test files and several titles, and the
 *     association between them is ambiguous to a parser in a way it is not to a
 *     reader. A title moved from one test file to another therefore still
 *     resolves. Both halves are checked, independently; the pairing is not.
 *   - **It does not check that the named test asserts what the sentence says.**
 *     Nothing mechanical can. That remains review's job, and it is the reason
 *     Amendment G asks for a *named* test rather than a link.
 *   - **It only sees quoted titles that follow a citation marker** (`*Tests:*`,
 *     `*Test:*`, `pinned by`). A citation written in some other shape is
 *     invisible to it, and so is unchecked rather than reported.
 *   - **It reads comments in `.ts`/`.tsx`, never code.** A citation inside a
 *     string literal is not seen.
 *
 * Under-reporting is the deliberate bias throughout. Every heuristic below that
 * could go either way is set to stay silent: a quoted fragment that does not
 * look like a test title is dropped rather than reported, and a title is
 * resolved against the whole suite rather than against one file. A false
 * positive here is a defect, because the first one teaches everybody that this
 * tool is noise.
 * ---------------------------------------------------------------------------
 *
 * Where the two corpora come from, and why they differ:
 *
 *   Prose  — the files `git` tracks. Untracked prose governs nobody; it is not
 *            in the clone the rule is about.
 *   Tests  — the test files on disk under the root. This is what `vitest` runs,
 *            so it is what "the test exists" has to mean. A test file staged for
 *            a commit that has not happened yet still exists for the developer
 *            reading the sentence beside it.
 *
 * Invocation:
 *
 *   node scripts/check-citations.mjs            the repository, prose from git
 *   node scripts/check-citations.mjs --scan DIR a directory tree, prose from disk
 *
 * `--scan` exists so this checker can be run against fixture trees by its own
 * tests without a git repository; `npm run check:citations` never passes it.
 *
 * No dependencies beyond Node built-ins and the `typescript` compiler already in
 * devDependencies. Titles are read out of the AST rather than grepped, for the
 * same reason `src/__tests__/noEventListener.test.ts` parses rather than greps:
 * several of the files being scanned discuss test titles in prose, and a text
 * match cannot tell a call from a sentence about a call.
 *
 * Exit status: 0 clean, 1 violations found, 2 the check could not be run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// The marker convention, and the shapes prose is allowed to write it in.
// ---------------------------------------------------------------------------

/**
 * What opens a citation. Two shapes are in use — `*Tests:*` in Markdown and
 * "pinned by" in docblocks — and this checker accepts both rather than
 * legislating one, because rewriting a hundred existing sites to suit the tool
 * would be the tool dictating the prose. Issue #5 asks for one shape eventually;
 * that is a prose decision, not this file's.
 */
const CITATION_MARKERS = [/\*{1,2}Tests?:\*{1,2}/g, /\bpinned by\b/gi];

/** Test-title-shaped call names. Anything else with a title argument is not a test. */
const TEST_FUNCTIONS = new Set(['it', 'test', 'describe', 'suite', 'fit', 'xit', 'fdescribe', 'xdescribe', 'bench']);

/** Names that group rather than assert, so their titles become path segments. */
const SUITE_FUNCTIONS = new Set(['describe', 'suite', 'fdescribe', 'xdescribe']);

/**
 * Modifiers a test call may carry. An unrecognised property means the call is
 * something else that merely starts with `it` or `test`, and it is skipped —
 * which keeps a helper named `test.helper(...)` out of the corpus.
 */
const TEST_MODIFIERS = new Set([
  'each',
  'extend',
  'fails',
  'failing',
  'for',
  'only',
  'runIf',
  'sequential',
  'concurrent',
  'skip',
  'skipIf',
  'todo',
]);

/** Directories a walk never descends into. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', 'build', '.vite', '.next']);

const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const PROSE_FILE = /\.(?:md|ts|tsx)$/;

/**
 * A test-file path as prose spells it: either repository-relative in backticks,
 * or a bare basename when the surrounding sentence has already named the
 * directory. Both are resolved, the second by basename only.
 */
const CITED_PATH = /`([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:test|spec)\.(?:tsx?|jsx?|mjs|cjs))`/g;

/**
 * Where a `%s`-style placeholder or a template-literal hole sits in a title.
 *
 * `it.each(...)('reads hotkey.%s exactly once', …)` emits one test per row with
 * the placeholder filled in, so prose quite reasonably cites the filled-in form.
 * Matching the citation against a pattern built from the template is the only
 * way both spellings resolve.
 *
 * U+FFFF stands for a `${…}` hole, substituted in by the title reader below. It
 * is a permanent Unicode noncharacter, so no real title can contain one and no
 * template can collide with a title that happens to spell the sentinel.
 */
const HOLE = '\uFFFF';
const PLACEHOLDER = /%%|%[sdifjoOp#]|\$[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\uFFFF/g;

/**
 * The floor at which a quoted fragment is treated as a title rather than as an
 * ordinary quoted phrase.
 *
 * Prose after a marker contains quoted things that are not citations — a
 * reserved key, a term of art, a short phrase from a spec. Every real test title
 * in this repository is a sentence. Three words and eight characters is where
 * the two populations separate, and the cost of the gate is that a hypothetical
 * two-word test title would go unchecked. That is the right way round: an
 * unchecked citation is the status quo, a false positive is a regression.
 */
const MIN_TITLE_WORDS = 3;
const MIN_TITLE_LENGTH = 8;

/** How far past a marker a citation may run before the scan gives up on it. */
const MAX_WINDOW_LINES = 15;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** @typedef {{file: string, line: number, column: number, rule: string, what: string, text: string}} Violation */

/** @typedef {{file: string, line: number, column: number, title: string, soft: boolean}} Citation */

/**
 * Shapes a quoted span can take that read as prose rather than as a citation.
 *
 * Every one of these is consulted **only after the span has failed to resolve**,
 * so none of them can silence a citation that names a real test — they decide
 * what to do with the leftovers, and they decide it in favour of silence. Each
 * is a form found in this repository's prose, not a form imagined for it.
 *
 *   sentence      Quoted prose ends in sentence punctuation. No test title in
 *                 this suite does, and none should: a title completes the
 *                 sentence "it …". This is what tells a quoted claim being
 *                 withdrawn — `the sentence went on: "…through it."` — from a
 *                 title.
 *   cross-reference  A quoted section heading, which prose names the same way it
 *                 names a test and then follows with "above" or "below".
 *   emphasised    `*"…"*` is markdown emphasis around quoted prose. Citations in
 *                 this repository are written as bare quotes.
 */
const ENDS_A_SENTENCE = /[.?!]$/;
const POINTS_AT_A_SECTION = /^[*`_)\]]*\s+(?:\S+\s+){0,2}(?:above|below)\b/;
const EMPHASIS_OPEN = /[*_]$/;
const EMPHASIS_CLOSE = /^[*_]/;

/**
 * Whether a quoted span reads as prose rather than as a citation.
 *
 * @param {string} title    the quoted text, already normalised
 * @param {string} before   the window text preceding the opening quote
 * @param {string} after    the window text following the closing quote
 */
function looksLikeProse(title, before, after) {
  if (ENDS_A_SENTENCE.test(title)) return true;
  if (POINTS_AT_A_SECTION.test(after)) return true;
  if (EMPHASIS_OPEN.test(before) && EMPHASIS_CLOSE.test(after)) return true;
  return false;
}

function truncate(text) {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

// ---------------------------------------------------------------------------
// Reading titles out of the suite
// ---------------------------------------------------------------------------

/**
 * The callee of a test call, unwrapped through `.each(table)` and `` .each`t` ``.
 *
 * Returns the base identifier and whether the chain parameterises the title, or
 * `undefined` when the callee is not a test function at all.
 */
function calleeOf(expression) {
  const properties = [];
  let node = expression;
  for (;;) {
    if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
      node = ts.isCallExpression(node) ? node.expression : node.tag;
      continue;
    }
    if (ts.isPropertyAccessExpression(node)) {
      properties.unshift(node.name.text);
      node = node.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression;
      continue;
    }
    if (!ts.isIdentifier(node)) return undefined;
    if (!TEST_FUNCTIONS.has(node.text)) return undefined;
    if (properties.some((property) => !TEST_MODIFIERS.has(property))) return undefined;
    return {
      base: node.text,
      parameterised: properties.includes('each') || properties.includes('for'),
    };
  }
}

/** The literal title a call declares, with `${…}` holes reduced to NUL, or `undefined`. */
function titleOf(argument) {
  if (argument === undefined) return undefined;
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isTemplateExpression(argument)) {
    return argument.head.text + argument.templateSpans.map((span) => HOLE + span.literal.text).join('');
  }
  return undefined;
}

/**
 * Every title in one test file, as `describe > … > it` segment chains.
 *
 * A `describe` contributes a segment *and* is recorded in its own right, because
 * prose cites both — sometimes the group, sometimes the case inside it.
 *
 * @returns {{segments: string[], parameterised: boolean}[]}
 */
export function readTitles(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** @type {{segments: string[], parameterised: boolean}[]} */
  const found = [];
  /** @type {{title: string, parameterised: boolean}[]} */
  const stack = [];

  const record = (title, parameterised) => {
    found.push({
      segments: [...stack.map((entry) => entry.title), title],
      parameterised: parameterised || stack.some((entry) => entry.parameterised),
    });
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = calleeOf(node.expression);
      const title = callee === undefined ? undefined : titleOf(node.arguments[0]);
      if (callee !== undefined && title !== undefined) {
        record(title, callee.parameterised);
        if (SUITE_FUNCTIONS.has(callee.base)) {
          stack.push({ title, parameterised: callee.parameterised });
          ts.forEachChild(node, visit);
          stack.pop();
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/**
 * Whitespace and quote normalisation applied to both sides of every comparison.
 *
 * Prose is typeset and source is not: a title written with a typographic
 * apostrophe in a sentence and a straight one in the call is the same title, and
 * a citation broken across two lines is the same title as the one-line original.
 * Nothing here changes which titles are distinct from each other.
 */
export function normalise(text) {
  return text
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A title containing placeholders, as the regular expression its emitted titles match. */
function patternFor(title) {
  let source = '';
  let last = 0;
  PLACEHOLDER.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER.exec(title)) !== null) {
    source += escapeRegExp(title.slice(last, match.index));
    source += match[0] === '%%' ? '%' : '.+?';
    last = match.index + match[0].length;
  }
  source += escapeRegExp(title.slice(last));
  return new RegExp(`^${source}$`, 's');
}

/**
 * The suite as something a citation can be looked up in.
 *
 * Every contiguous *suffix* of each segment chain is indexed, not just the leaf,
 * so `"outer > inner"` and `"inner"` both resolve while `"outer"` alone resolves
 * only if `outer` is itself a recorded title. Indexing suffixes rather than
 * arbitrary subsequences is what keeps two unrelated describes from combining
 * into a title neither of them has.
 */
export function buildIndex(entries) {
  /** @type {Set<string>} */
  const exact = new Set();
  /** @type {RegExp[]} */
  const patterns = [];

  for (const entry of entries) {
    for (let start = entry.segments.length - 1; start >= 0; start -= 1) {
      const joined = normalise(entry.segments.slice(start).join(' > '));
      const holed = joined.includes(HOLE);
      if (!holed) exact.add(joined);
      // A placeholder is only a placeholder in a parameterised call. Elsewhere
      // `%s` is four literal characters and must stay four literal characters.
      if (holed || (entry.parameterised && /%[sdifjoOp#]|\$[A-Za-z_$]/.test(joined))) {
        patterns.push(patternFor(joined));
      }
    }
  }

  return {
    size: exact.size + patterns.length,
    /** @param {string} title */
    has(title) {
      const wanted = normalise(title);
      if (exact.has(wanted)) return true;
      return patterns.some((pattern) => pattern.test(wanted));
    },
  };
}

// ---------------------------------------------------------------------------
// Reading citations out of prose
//
// A citation is a marker plus the window of prose that follows it. The window is
// where all the conservatism lives: extend it too far and an unrelated quoted
// phrase three paragraphs down becomes a citation nobody wrote.
// ---------------------------------------------------------------------------

/** @typedef {{text: string, line: number, column: number}} Segment */

/**
 * Quoted spans inside a window, with `\"` honoured as an escaped quote.
 *
 * The escape matters twice over. Prose in this repository writes an embedded
 * quote as `\"` — `never stores \"__proto__\" as a live key` — and a reader that
 * stops at the first bare `"` splits that title in three, reports all three as
 * missing, and is wrong three times about a title that is present.
 *
 * @param {Segment[]} segments
 * @returns {Citation[]}
 */
function quotedSpans(segments, file) {
  let joined = '';
  /** @type {{at: number, segment: Segment}[]} */
  const offsets = [];
  for (const segment of segments) {
    if (joined !== '') joined += ' ';
    offsets.push({ at: joined.length, segment });
    joined += segment.text;
  }

  /** @type {Citation[]} */
  const citations = [];
  const pattern = /"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = pattern.exec(joined)) !== null) {
    const raw = match[1].replace(/\\(["\\])/g, '$1');
    const title = normalise(raw);
    if (title.length < MIN_TITLE_LENGTH) continue;
    if (title.split(' ').length < MIN_TITLE_WORDS) continue;

    const start = match.index + 1;
    let home = offsets[0];
    for (const offset of offsets) {
      if (offset.at <= start) home = offset;
    }
    citations.push({
      file,
      line: home.segment.line,
      column: home.segment.column + (start - home.at),
      title,
      soft: looksLikeProse(title, joined.slice(0, match.index), joined.slice(match.index + match[0].length)),
    });
  }
  return citations;
}

/** Test-file paths named inside a window. */
function citedPaths(segments) {
  /** @type {{path: string, line: number, column: number}[]} */
  const paths = [];
  for (const segment of segments) {
    CITED_PATH.lastIndex = 0;
    let match;
    while ((match = CITED_PATH.exec(segment.text)) !== null) {
      paths.push({ path: match[1], line: segment.line, column: segment.column + match.index + 1 });
    }
  }
  return paths;
}

const MD_FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;
const MD_HEADING = /^\s{0,3}#{1,6}\s/;
const MD_LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const MD_QUOTE = /^\s*>+\s?/;

function stripQuote(line) {
  return line.replace(MD_QUOTE, '');
}

/**
 * The windows a Markdown file offers, one per marker.
 *
 * A window runs from its marker to the end of the block that contains it: a
 * blank line, a new list item, a heading or a fence all end it, and a table row
 * is a window of exactly one line because a row is its own cell. Fenced code is
 * not scanned at all — a fence quoting the marker convention is documentation of
 * the convention, not a use of it.
 *
 * @returns {Segment[][]}
 */
export function markdownWindows(text) {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  /** @type {Segment[][]} */
  const windows = [];
  let fenced = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (MD_FENCE.test(stripQuote(line))) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const quoted = MD_QUOTE.test(line);
    const body = stripQuote(line);
    const tableRow = body.trimStart().startsWith('|');

    for (const marker of CITATION_MARKERS) {
      marker.lastIndex = 0;
      let hit;
      while ((hit = marker.exec(line)) !== null) {
        const from = hit.index + hit[0].length;
        /** @type {Segment[]} */
        const segments = [{ text: line.slice(from), line: index + 1, column: from + 1 }];

        for (let ahead = index + 1; !tableRow && ahead < lines.length && ahead - index < MAX_WINDOW_LINES; ahead += 1) {
          const next = lines[ahead];
          if (MD_FENCE.test(stripQuote(next))) break;
          if (stripQuote(next).trim() === '') break;
          if (MD_QUOTE.test(next) !== quoted) break;
          const nextBody = stripQuote(next);
          if (MD_HEADING.test(nextBody)) break;
          if (MD_LIST_ITEM.test(nextBody)) break;
          if (nextBody.trimStart().startsWith('|')) break;
          const offset = nextBody.length - nextBody.trimStart().length;
          segments.push({
            text: nextBody.trimStart(),
            line: ahead + 1,
            column: next.length - nextBody.length + offset + 1,
          });
        }
        windows.push(segments);
      }
    }
  }
  return windows;
}

/**
 * The windows a TypeScript file offers — from comments only, never from code.
 *
 * Reading code would make every `it('…')` in a test file its own citation of
 * itself, which is circular, and would make a marker inside a string literal a
 * citation too. The compiler puts comments in trivia rather than in the tree,
 * which is exactly the distinction needed; the same reasoning is written out at
 * length in `src/__tests__/noEventListener.test.ts`, which needs the opposite
 * half of it.
 *
 * @returns {Segment[][]}
 */
export function typeScriptWindows(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** @type {Set<number>} */
  const seen = new Set();
  /** @type {{pos: number, end: number}[]} */
  const comments = [];
  const collect = (ranges) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      comments.push({ pos: range.pos, end: range.end });
    }
  };

  const visit = (node) => {
    // JSX text is not trivia, so trivia scanning from inside it would read
    // ordinary prose in the markup as a comment. Skipped rather than trusted.
    if (!ts.isJsxText(node)) {
      collect(ts.getLeadingCommentRanges(text, node.pos));
      collect(ts.getTrailingCommentRanges(text, node.end));
    }
    ts.forEachChild(node, visit);
  };
  collect(ts.getLeadingCommentRanges(text, 0));
  visit(source);
  comments.sort((a, b) => a.pos - b.pos);

  /** @type {Segment[][]} */
  const windows = [];
  for (const comment of comments) {
    const startLine = source.getLineAndCharacterOfPosition(comment.pos).line;
    const raw = text.slice(comment.pos, comment.end).split('\n');
    // A docblock's leading `*` is decoration, so it is stripped rather than read
    // as part of the prose — a title broken across two lines would otherwise
    // arrive with an asterisk spliced into the middle of it. Stripping also makes
    // the bare `*` line legible as what it is: the blank line between two
    // paragraphs of a docblock, and so the end of a window.
    const lines = raw.map((line) => {
      const decoration = /^\s*(?:\/\*{1,2}|\/\/|\*)?[ \t]?/.exec(line)?.[0] ?? '';
      return { body: line.slice(decoration.length).replace(/[ \t]*\*\/[ \t]*$/, ''), offset: decoration.length };
    });

    for (let index = 0; index < lines.length; index += 1) {
      const current = lines[index];
      for (const marker of CITATION_MARKERS) {
        marker.lastIndex = 0;
        let hit;
        while ((hit = marker.exec(current.body)) !== null) {
          const from = hit.index + hit[0].length;
          /** @type {Segment[]} */
          const segments = [
            { text: current.body.slice(from), line: startLine + index + 1, column: current.offset + from + 1 },
          ];
          for (let ahead = index + 1; ahead < lines.length && ahead - index < MAX_WINDOW_LINES; ahead += 1) {
            const next = lines[ahead];
            if (next.body.trim() === '') break;
            const indent = next.body.length - next.body.trimStart().length;
            segments.push({
              text: next.body.trim(),
              line: startLine + ahead + 1,
              column: next.offset + indent + 1,
            });
          }
          windows.push(segments);
        }
      }
    }
  }
  return windows;
}

/** Every citation one prose file makes. @returns {{titles: Citation[], paths: {path: string, line: number, column: number}[]}} */
export function readCitations(file, text) {
  const windows = file.endsWith('.md') ? markdownWindows(text) : typeScriptWindows(file, text);
  /** @type {Citation[]} */
  const titles = [];
  /** @type {{path: string, line: number, column: number}[]} */
  const paths = [];
  for (const window of windows) {
    titles.push(...quotedSpans(window, file));
    paths.push(...citedPaths(window).map((entry) => ({ ...entry, file })));
  }
  return {
    titles: unique(titles, (entry) => entry.title),
    paths: unique(paths, (entry) => entry.path),
  };
}

/**
 * A citation written in the elided form, restored to its full title.
 *
 * Prose that cites several cases from one `describe` writes the shared prefix
 * once and elides it thereafter:
 *
 *   "validateBlueprint — identifier hardening", "— text fields", "— navigation tree"
 *
 * Read literally, the second and third name no test. Read the way the sentence
 * is written — and the way a reviewer reads it — they name
 * `validateBlueprint — text fields` and `validateBlueprint — navigation tree`,
 * both of which exist. Splicing the antecedent's prefix back on is what makes
 * the checker agree with the reader.
 *
 * Only the immediately preceding *resolved* citation can supply a prefix, and
 * only up to its own first separator, so this can extend a citation but never
 * invent one out of two unrelated titles.
 *
 * @returns {string | undefined} the restored title, or `undefined` if the
 *   citation is not elided or there is nothing to restore it from.
 */
export function restoreElision(title, antecedent) {
  if (antecedent === undefined) return undefined;
  const separator = ['—', '>'].find((mark) => title.startsWith(`${mark} `));
  if (separator === undefined) return undefined;
  const cut = antecedent.indexOf(` ${separator} `);
  if (cut <= 0) return undefined;
  return `${antecedent.slice(0, cut)} ${title}`;
}

// ---------------------------------------------------------------------------
// Gathering the two corpora
// ---------------------------------------------------------------------------

function walk(root) {
  /** @type {string[]} */
  const found = [];
  const descend = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        descend(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      found.push(relative(root, join(directory, entry.name)).split(sep).join('/'));
    }
  };
  descend(root);
  return found.sort();
}

function trackedFiles(root) {
  const raw = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return raw.split('\0').filter((entry) => entry !== '');
}

/**
 * @param {{root: string, prose: string[], tests: string[]}} corpus
 * @returns {{violations: Violation[], citations: number, resolved: number, ignored: number,
 *            titles: number, proseScanned: number}}
 */
export function check(corpus) {
  /** @type {Violation[]} */
  const violations = [];

  /** @type {{segments: string[], parameterised: boolean}[]} */
  const entries = [];
  for (const file of corpus.tests) {
    entries.push(...readTitles(file, readFileSync(resolve(corpus.root, file), 'utf8')));
  }
  const index = buildIndex(entries);

  const knownPaths = new Set(corpus.tests);
  const knownNames = new Set(corpus.tests.map((file) => file.slice(file.lastIndexOf('/') + 1)));

  let citations = 0;
  let resolved = 0;
  let ignored = 0;
  let proseScanned = 0;

  for (const file of corpus.prose) {
    let text;
    try {
      text = readFileSync(resolve(corpus.root, file), 'utf8');
    } catch {
      // A prose file the index lists and the tree does not have is
      // check-portability's finding to report, not this one's.
      continue;
    }
    proseScanned += 1;
    const { titles, paths } = readCitations(file, text);

    /** The most recent title that resolved, as the antecedent an elision refers back to. */
    let antecedent;

    for (const citation of titles) {
      citations += 1;
      if (index.has(citation.title)) {
        resolved += 1;
        antecedent = citation.title;
        continue;
      }
      const restored = restoreElision(citation.title, antecedent);
      if (restored !== undefined && index.has(restored)) {
        resolved += 1;
        antecedent = restored;
        continue;
      }
      // Unresolved and prose-shaped. Under-reporting is the deliberate bias: a
      // quoted sentence reported as a missing test is the false positive that
      // teaches everyone to stop reading this checker's output.
      if (citation.soft) {
        ignored += 1;
        continue;
      }
      violations.push({
        file,
        line: citation.line,
        column: citation.column,
        rule: 'unresolved-test-title',
        what: 'a cited test title that matches no it() or describe() title in the suite',
        text: truncate(`"${citation.title}"`),
      });
    }

    for (const cited of paths) {
      const name = cited.path.slice(cited.path.lastIndexOf('/') + 1);
      if (knownPaths.has(cited.path) || knownNames.has(name)) continue;
      violations.push({
        file,
        line: cited.line,
        column: cited.column,
        rule: 'unknown-test-file',
        what: 'a cited test file that exists nowhere in the working tree',
        text: truncate(cited.path),
      });
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { violations, citations, resolved, ignored, titles: entries.length, proseScanned };
}

/**
 * The same citation reached twice is one citation.
 *
 * Two markers can open windows that overlap — `*Tests:* … pinned by …` in one
 * paragraph is the ordinary case — and the span between them then belongs to
 * both. Keying on the position rather than on the text is what makes this a
 * deduplication and not a silent merge of two genuinely different sites that
 * happen to cite the same title.
 *
 * @template {{file?: string, line: number, column: number}} T
 * @param {T[]} entries
 * @param {(entry: T) => string} key  what distinguishes two entries at one position
 * @returns {T[]}
 */
function unique(entries, key) {
  const seen = new Set();
  const kept = [];
  for (const entry of entries) {
    const id = `${entry.file}:${entry.line}:${entry.column}:${key(entry)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(entry);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function main(argv) {
  const scanAt = argv.indexOf('--scan');
  const scanning = scanAt !== -1;
  const root = scanning ? resolve(argv[scanAt + 1] ?? '.') : REPO_ROOT;

  let all;
  if (scanning) {
    try {
      all = walk(root);
    } catch (error) {
      process.stderr.write(
        `check-citations: cannot read ${root}.\n  ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  } else {
    try {
      all = trackedFiles(root);
    } catch (error) {
      process.stderr.write(
        `check-citations: cannot list tracked files. Prose is read from what git tracks, so this\n` +
          `check needs to run inside a git working tree with git on PATH.\n  ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  }

  // Tests are read off disk in both modes. A test file written but not yet
  // committed is a test that exists, and a citation beside it is not stale.
  let tests;
  try {
    tests = walk(root).filter((file) => TEST_FILE.test(file));
  } catch (error) {
    process.stderr.write(
      `check-citations: cannot walk ${root} for test files.\n  ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  const prose = all.filter((file) => PROSE_FILE.test(file));

  if (tests.length === 0) {
    // Nothing would resolve against an empty suite, so every citation would be
    // reported. Refusing to run beats reporting the whole repository.
    process.stderr.write(
      `check-citations: found no test files under ${root}. Every citation would be reported as\n` +
        `unresolved, which would be an artefact of the scan rather than a finding.\n`,
    );
    return 2;
  }

  const result = check({ root, prose, tests });

  // Stated on every run rather than only on a failure. A quoted span that did
  // not resolve and was set aside as prose is exactly where a real stale citation
  // would hide, so the number it hides in is published rather than swallowed.
  const setAside =
    result.ignored === 0
      ? ''
      : `, ${result.ignored} quoted span${result.ignored === 1 ? '' : 's'} set aside as prose rather than citation`;

  if (result.violations.length === 0) {
    process.stdout.write(
      `check-citations: OK — ${result.resolved} citations in ${result.proseScanned} prose files all ` +
        `resolve against ${result.titles} titles in ${tests.length} test files${setAside}.\n` +
        `  This checks that a citation which IS present resolves, not that every security claim\n` +
        `  carries one. See the LIMITS block in scripts/check-citations.mjs.\n`,
    );
    return 0;
  }

  process.stderr.write(
    `check-citations: ${result.violations.length} unresolved citation` +
      `${result.violations.length === 1 ? '' : 's'} under ADR-0001 Amendment G ` +
      `(no security claim without a named test).\n\n`,
  );
  for (const violation of result.violations) {
    process.stderr.write(`  ${violation.file}:${violation.line}:${violation.column}  ${violation.rule}\n`);
    process.stderr.write(`    found ${violation.what}\n`);
    process.stderr.write(`    ${violation.text}\n\n`);
  }
  process.stderr.write(
    `${result.resolved} of ${result.citations} cited titles resolved against ${result.titles} titles in\n` +
      `${tests.length} test files${setAside}. A citation that names a test which no longer exists reads as\n` +
      `evidence and is not — per Amendment G, either restore the test, re-point the citation, or\n` +
      `narrow the sentence. Never widen this checker to make a stale citation pass.\n`,
  );
  return 1;
}

// Importable for its own tests; only the direct invocation runs the check.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { main, walk, TEST_FILE, PROSE_FILE };
