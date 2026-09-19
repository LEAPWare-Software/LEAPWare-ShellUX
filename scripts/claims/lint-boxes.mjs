#!/usr/bin/env node
/**
 * The box linter: docs/proof-of-completion.md §3.2.
 *
 * Two jobs. The structural job runs on every ticked item in `docs/plans/**`, every run:
 * the item carries exactly one `[C-nn]` tag, the row is in `active`, and the row's `box`
 * equals the item text. It also holds each heading's `(x/y)` to its items. The diff job
 * works out what a change touched: items whose tick, text or tag changed, rows added or
 * changed, and base items removed or reworded (which the PR evidence gate makes the
 * author name).
 *
 * A guardrail against the honest mistake. Anyone who can merge can edit this file.
 *
 * Usage:
 *   node scripts/claims/lint-boxes.mjs                 # structure only, working tree
 *   node scripts/claims/lint-boxes.mjs --mode pull_request [--json]
 *   node scripts/claims/lint-boxes.mjs --mode merge_group [--json]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLANS_DIR,
  REGISTER_PATH,
  REPO_ROOT,
  defaultRunner,
  git,
  parseRegister,
  rowHash,
  validateRegister,
} from './lib.mjs';
import { headingErrors, parsePlan } from './plan.mjs';

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** Plan files in the working tree: tracked plus untracked-but-not-ignored. */
export function workingPlanFiles({ cwd = REPO_ROOT, run = defaultRunner } = {}) {
  const out = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', PLANS_DIR], { cwd, run });
  return [...new Set(out.split('\n').filter((f) => f.endsWith('.md')))]
    .filter((f) => existsSync(path.join(cwd, f)))
    .sort();
}

/** Plan files at a commit. */
export function planFilesAt(ref, { cwd = REPO_ROOT, run = defaultRunner } = {}) {
  const out = git(['ls-tree', '-r', '--name-only', ref, '--', PLANS_DIR], { cwd, run });
  return out.split('\n').filter((f) => f.endsWith('.md')).sort();
}

export function showAt(ref, file, { cwd = REPO_ROOT, run = defaultRunner } = {}) {
  return git(['show', `${ref}:${file}`], { cwd, run });
}

/** The working tree's plans and register. */
export function readWorkingTree({ cwd = REPO_ROOT, run = defaultRunner } = {}) {
  const plans = workingPlanFiles({ cwd, run }).map((file) => ({ file, source: readFileSync(path.join(cwd, file), 'utf8') }));
  const registerText = readFileSync(path.join(cwd, REGISTER_PATH), 'utf8');
  return { plans, registerText };
}

/** The plans and register at a commit; a missing register reads as empty. */
export function readCommit(ref, { cwd = REPO_ROOT, run = defaultRunner } = {}) {
  const plans = planFilesAt(ref, { cwd, run }).map((file) => ({ file, source: showAt(ref, file, { cwd, run }) }));
  let registerText;
  try {
    registerText = showAt(ref, REGISTER_PATH, { cwd, run });
  } catch {
    registerText = JSON.stringify({ schemaVersion: 1, active: [], retired: [] });
  }
  return { plans, registerText };
}

// ---------------------------------------------------------------------------
// Structure (every run)
// ---------------------------------------------------------------------------

/**
 * Every structural check over one tree. Returns `{ errors, items, register }` where
 * `errors` is `[{ file, line, rowId, message }]` and `items` is every task item with its
 * file.
 * *Tests:* scripts/__tests__/claims-lint-boxes.test.mjs — "fails a ticked item whose row box differs from the item text".
 */
export function checkStructure({ plans, registerText }, exists) {
  const errors = [];
  let register;
  try {
    register = parseRegister(registerText);
  } catch (error) {
    return { errors: [{ file: REGISTER_PATH, line: null, rowId: null, message: `register is not JSON: ${error.message}` }], items: [], register: null };
  }
  for (const e of validateRegister(register, exists)) errors.push({ file: REGISTER_PATH, line: null, rowId: e.rowId, message: e.message });
  const active = new Map((Array.isArray(register.active) ? register.active : []).map((row) => [row.id, row]));

  const items = [];
  for (const { file, source } of plans) {
    const parsed = parsePlan(source);
    for (const e of parsed.errors) errors.push({ file, line: e.line, rowId: null, message: e.message });
    for (const e of headingErrors(parsed.headings)) errors.push({ file, line: e.line, rowId: null, message: e.message });
    for (const item of parsed.items) {
      items.push({ file, ...item });
      if (!item.checked) continue;
      if (item.tags.length !== 1) {
        errors.push({ file, line: item.line, rowId: null, message: `a ticked item needs exactly one [C-nn] tag; it has ${item.tags.length}` });
        continue;
      }
      const [id] = item.tags;
      const row = active.get(id);
      if (!row) {
        errors.push({ file, line: item.line, rowId: id, message: `${id} is not in active` });
      } else if (row.box !== item.text) {
        errors.push({ file, line: item.line, rowId: id, message: `${id} box differs from the item text` });
      }
    }
  }
  return { errors, items, register };
}

// ---------------------------------------------------------------------------
// The diff (pull_request and merge_group)
// ---------------------------------------------------------------------------

function itemKey(item) {
  return `${item.checked}|${item.text}|${item.tags.join(',')}`;
}

/**
 * What a change touched, between two trees (§3.2 execution and removal rules).
 * Returns `{ changedItems, rowsChanged, citedRows, removedOrReworded, deletedPlanFiles }`.
 * *Tests:* scripts/__tests__/claims-lint-boxes.test.mjs — "reports a reworded item by its base line number".
 */
export function diffScope(baseTree, headTree) {
  const parseAll = (tree) =>
    tree.plans.map(({ file, source }) => ({ file, items: parsePlan(source).items }));
  const base = parseAll(baseTree);
  const head = parseAll(headTree);

  const changedItems = [];
  const removedOrReworded = [];
  const headFiles = new Set(head.map((p) => p.file));
  const deletedPlanFiles = base.map((p) => p.file).filter((f) => !headFiles.has(f));

  for (const { file, items } of head) {
    const baseItems = base.find((p) => p.file === file)?.items ?? [];
    const pool = new Map();
    for (const item of baseItems) pool.set(itemKey(item), (pool.get(itemKey(item)) ?? 0) + 1);
    for (const item of items) {
      const key = itemKey(item);
      if (pool.get(key) > 0) pool.set(key, pool.get(key) - 1);
      else changedItems.push({ file, line: item.line, checked: item.checked, text: item.text, tags: item.tags });
    }
  }
  for (const { file, items } of base) {
    if (!headFiles.has(file)) continue;
    const headTexts = new Set(head.find((p) => p.file === file).items.map((i) => i.text));
    for (const item of items) {
      if (!headTexts.has(item.text)) removedOrReworded.push({ file, baseLine: item.line, text: item.text });
    }
  }

  const rows = (text) => {
    try {
      const r = parseRegister(text);
      return new Map((r.active ?? []).map((row) => [row.id, row]));
    } catch {
      return new Map();
    }
  };
  const baseRows = rows(baseTree.registerText);
  const headRows = rows(headTree.registerText);
  const rowsChanged = [...headRows.values()]
    .filter((row) => !baseRows.has(row.id) || rowHash(baseRows.get(row.id)) !== rowHash(row))
    .map((row) => row.id)
    .sort();
  const citedRows = [...new Set(changedItems.filter((i) => i.checked).flatMap((i) => i.tags))].sort();

  return { changedItems, rowsChanged, citedRows, removedOrReworded, deletedPlanFiles };
}

/** The files a change touched, from `git diff --name-status`. */
export function changedFiles(base, { cwd = REPO_ROOT, run = defaultRunner } = {}) {
  const out = git(['diff', '--name-status', '--no-renames', base, 'HEAD'], { cwd, run });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status, file };
    });
}

/**
 * The base commit for a mode. `pull_request` diffs `origin/main...HEAD`, and fails loudly
 * in a shallow clone, where a merge base cannot be trusted. `merge_group` diffs
 * `HEAD~1..HEAD` after asserting the squash queue shape the diff depends on.
 * *Tests:* scripts/__tests__/claims-lint-boxes.test.mjs — "fails loudly in a depth-1 clone".
 */
export function resolveBase(mode, { cwd = REPO_ROOT, run = defaultRunner, rulesetText } = {}) {
  if (git(['rev-parse', '--is-shallow-repository'], { cwd, run }).trim() === 'true') {
    throw new Error('this clone is shallow; the diff needs full history (actions/checkout with fetch-depth: 0)');
  }
  if (mode === 'pull_request') {
    return git(['merge-base', 'origin/main', 'HEAD'], { cwd, run }).trim();
  }
  if (mode === 'merge_group') {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd, run }).trim().split(/\s+/).slice(1);
    if (parents.length !== 1) throw new Error(`merge_group HEAD has ${parents.length} parents; a squash queue commit has one`);
    const ruleset = JSON.parse(rulesetText ?? readFileSync(path.join(cwd, '.github/rulesets/main.json'), 'utf8'));
    const queue = (ruleset.rules ?? []).find((r) => r.type === 'merge_queue');
    if (queue?.parameters?.merge_method !== 'SQUASH') {
      throw new Error('main.json merge_queue merge_method is not SQUASH; HEAD~1..HEAD is not the change');
    }
    return parents[0];
  }
  throw new Error(`no diff base for mode ${mode}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(argv, { cwd = REPO_ROOT, run = defaultRunner, log = console.log } = {}) {
  let mode = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mode') mode = argv[(i += 1)];
    else if (argv[i] === '--json') json = true;
    else throw new Error(`unrecognised argument: ${argv[i]}`);
  }
  const head = readWorkingTree({ cwd, run });
  const structure = checkStructure(head, (p) => existsSync(path.join(cwd, p)));
  const report = { structure: structure.errors };
  if (mode) {
    const base = resolveBase(mode, { cwd, run });
    report.base = base;
    report.diff = diffScope(readCommit(base, { cwd, run }), head);
  }
  if (json) log(JSON.stringify(report, null, 2));
  else {
    for (const e of structure.errors) log(`${e.file}${e.line ? `:${e.line}` : ''}: ${e.message}`);
    if (report.diff) {
      log(`changed items: ${report.diff.changedItems.length}; rows added or changed: ${report.diff.rowsChanged.join(', ') || 'none'}`);
      for (const r of report.diff.removedOrReworded) log(`removed or reworded: ${r.file}:${r.baseLine} ${r.text.slice(0, 80)}`);
      for (const f of report.diff.deletedPlanFiles) log(`plan file deleted or moved: ${f}`);
    }
    log(structure.errors.length ? `lint-boxes: ${structure.errors.length} structural error(s)` : 'lint-boxes: structure holds');
  }
  return structure.errors.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`lint-boxes: ${error.message}`);
    process.exit(2);
  }
}
