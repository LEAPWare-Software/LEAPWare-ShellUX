#!/usr/bin/env node
/**
 * The advisory prose lint: docs/proof-of-completion.md §3.8.
 *
 * Ported from the r6 prototype the design was audited against. It scans the blocks a
 * change adds to the state-bearing files (HANDOFF.md, CLAUDE.md, README.md,
 * docs/traps.md, docs/DECISIONS.md, docs/plans/**) for completion and state wording and
 * emits GitHub warning annotations. **It never fails a check**: prose is not recorded as
 * done by this protocol, and a reviewer answers each annotation in the review record.
 * The rule it nudges toward: prose may point to a plan item, not declare one done.
 *
 * Blocks are maximal runs of non-blank lines; each list item, heading and table row is
 * its own block. Fenced code, HTML comments and a
 * `<!-- claim:none: ... --> ... <!-- /claim -->` region are skipped. A block carrying a
 * `[C-nn]` tag points at a register row and is not annotated.
 *
 * Usage:
 *   node scripts/claims/lint-prose.mjs [--base <ref>]   # default: merge base with origin/main
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, annotation, defaultRunner, git } from './lib.mjs';

export const STATE_FILES = /^(HANDOFF\.md|CLAUDE\.md|README\.md|docs\/traps\.md|docs\/DECISIONS\.md|docs\/plans\/.*\.md)$/;
export const COMPLETION_FILES = /^(HANDOFF\.md|docs\/plans\/.*\.md)$/;
export const CRASH_FILES = /^(HANDOFF\.md|CLAUDE\.md|README\.md|docs\/traps\.md)$/;
export const CHECKBOX = /^\s*(?:[-*+]|\d+\.)\s+\[[xX]\]/;
export const UNTICKED = /^\s*(?:[-*+]|\d+\.)\s+\[ \]/;
export const COMPLETION = /\b(done|complete(?:d)?|fixed|merged|landed|proven|passes|passing|green|closed|resolved|shipped)\b/gi;
export const ZERO = /(?<![\w.])(?:0|zero)\s+(?:[\w.`-]+\s+){0,3}[\w.`-]+s\b/gi;
export const NONE = /(?<![\w.])(?:no|none)\s+(?:[\w.`-]+\s+){0,3}[\w.`-]+s\b/gi;
export const CRASH = /\bcrash(?:es|ed|ing)?\b/gi;
export const RATIO = /\b[1-9]\d*\s*\/\s*\d+\b/g;
export const EXIT0 = /\bexit(?:s|ed)?\s+(?:code\s+)?0\b/gi;
export const TAG = /\[C-\d+\]|\[claim:none:\s*\S+\s+\S+\s+\S+[^\]]*\]/;
const CLAUSE_END = /[.,;:!?—]|\*\*/g;

/**
 * A negation governs a match only inside the same clause: "not"/"never" within the two
 * words before it, or "unproven"/"pending" immediately before it.
 */
export function governed(text, idx) {
  let seg = text.slice(0, idx);
  let cut = 0;
  for (const m of seg.matchAll(CLAUSE_END)) cut = m.index + m[0].length;
  seg = seg.slice(cut);
  const w = seg
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x.toLowerCase().replace(/[^a-z]/g, ''));
  const last2 = w.slice(-2);
  if (last2.includes('not') || last2.includes('never')) return true;
  const last = w[w.length - 1];
  return last === 'unproven' || last === 'pending';
}

/** The kinds of wording a block carries, by the file's role. */
export function flagText(text, file) {
  const out = [];
  const add = (kind, re) => {
    for (const m of text.matchAll(re)) if (!governed(text, m.index)) out.push(`${kind}:${m[0]}`);
  };
  if (/^docs\/plans\//.test(file) && CHECKBOX.test(text)) out.push('checkbox');
  if (STATE_FILES.test(file)) {
    add('zero', ZERO);
    add('ratio', RATIO);
    add('exit0', EXIT0);
  }
  if (CRASH_FILES.test(file)) add('crash', CRASH);
  if (COMPLETION_FILES.test(file)) {
    add('none', NONE);
    if (!UNTICKED.test(text)) add('completion', COMPLETION);
  }
  return out;
}

/** Split a file into blocks: `{ start, end, text }`, 0-based lines. */
export function blocks(text) {
  const lines = text.split(/\r?\n/);
  const res = [];
  let fence = null;
  let cmt = false;
  let none = false;
  let cur = null;
  const flush = () => {
    if (cur) res.push(cur);
    cur = null;
  };
  lines.forEach((l, i) => {
    const fm = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
      flush();
      return;
    }
    if (fm) {
      fence = fm[1];
      flush();
      return;
    }
    if (/<!--\s*claim:none:/.test(l)) {
      none = true;
      flush();
      return;
    }
    if (/<!--\s*\/claim\s*-->/.test(l)) {
      none = false;
      flush();
      return;
    }
    if (none) {
      flush();
      return;
    }
    if (cmt) {
      if (l.includes('-->')) cmt = false;
      flush();
      return;
    }
    if (/^\s*<!--/.test(l)) {
      if (!l.includes('-->')) cmt = true;
      flush();
      return;
    }
    if (!l.trim()) {
      flush();
      return;
    }
    const single = /^#{1,6}\s/.test(l) || /^\s*\|/.test(l);
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(l) || single) flush();
    if (!cur) cur = { start: i, end: i, text: '' };
    cur.end = i;
    cur.text += (cur.text ? ' ' : '') + l.trim();
    if (single) flush();
  });
  flush();
  return res;
}

/**
 * Findings for one file: blocks touched by an added line (0-based line numbers in
 * `addedLines`) that carry flagged wording and no tag.
 * *Tests:* scripts/__tests__/claims-lint-prose.test.mjs — "flags each incident of 2026-09-18 and leaves the negated forms alone".
 */
export function lint(file, text, addedLines) {
  const bad = [];
  for (const b of blocks(text)) {
    let touched = false;
    for (let i = b.start; i <= b.end; i += 1) if (addedLines.has(i)) touched = true;
    if (!touched) continue;
    const f = flagText(b.text, file);
    if (f.length && !TAG.test(b.text)) bad.push({ line: b.start + 1, text: b.text.slice(0, 150), f });
  }
  return bad;
}

/** Added line numbers (0-based) per file, from a zero-context diff. */
export function addedLinesFromDiff(diffText) {
  const byFile = new Map();
  let file = null;
  for (const line of diffText.split('\n')) {
    const header = line.match(/^\+\+\+ (?:b\/)?(.*)$/);
    if (header) {
      file = header[1] === '/dev/null' ? null : header[1];
      if (file && !byFile.has(file)) byFile.set(file, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i += 1) byFile.get(file).add(start - 1 + i);
    }
  }
  return byFile;
}

export function main(argv, { cwd = REPO_ROOT, run = defaultRunner, log = console.log } = {}) {
  let base = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') base = argv[(i += 1)];
    else throw new Error(`unrecognised argument: ${argv[i]}`);
  }
  base ??= git(['merge-base', 'origin/main', 'HEAD'], { cwd, run }).trim();
  const diff = git(['diff', '-U0', '--no-renames', base, '--', 'HANDOFF.md', 'CLAUDE.md', 'README.md', 'docs/'], { cwd, run });
  let count = 0;
  for (const [file, added] of addedLinesFromDiff(diff)) {
    if (!STATE_FILES.test(file) || !existsSync(path.join(cwd, file))) continue;
    for (const finding of lint(file, readFileSync(path.join(cwd, file), 'utf8'), added)) {
      count += 1;
      log(annotation('warning', `prose reads as a state or completion claim (${finding.f.join(', ')}). Point it at a plan item, or answer this in the review record. Advisory only.`, file, finding.line));
    }
  }
  log(`lint-prose: ${count} advisory annotation(s); this check never fails`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    // Advisory: a crash is reported, and the check still does not fail.
    console.log(annotation('warning', `lint-prose could not run: ${error.message}`));
    process.exit(0);
  }
}
