#!/usr/bin/env node
/**
 * `npm run status`: where every ticked plan item stands, from the register and the
 * newest usable main run of `claims.yml` (docs/proof-of-completion.md §3.6).
 *
 * Order of work, and why:
 *   1. `git fetch origin main`, so ancestry is judged against the remote, not a stale ref.
 *   2. Local structure first. A ticked item without exactly one tag, whose row is not in
 *      `active`, or whose `box` differs from its text renders UNPROVEN whatever any run
 *      says, because a run can only speak for the rows it ran.
 *   3. The reference run: a `schedule`, `push` or `workflow_dispatch` run of claims.yml on
 *      `main`, from this repository, completed, not cancelled or skipped, highest
 *      run_number. Pull-request and merge-queue runs are never candidates. A dispatch is
 *      one so that a forced crash (rollout step 3) renders FAILING RUN, as a real one must.
 *   4. Render each row by the first rule that matches (renderRow below).
 *
 * It never reports an item as settled on its own authority: the strongest word it prints
 * is PASSING, with the run id that recorded it.
 *
 * Usage: npm run status
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REPO, REPO_ROOT, defaultRunner, formatExpectation, hasToken, rowHash } from './claims/lib.mjs';
import { checkStructure, readWorkingTree } from './claims/lint-boxes.mjs';

export const STALE_MS = 48 * 60 * 60 * 1000;
export const WORKFLOW = 'claims.yml';
/** Events whose runs on main may be the reference run (§3.6 step 3). */
export const MAIN_EVENTS = ['schedule', 'push', 'workflow_dispatch'];

/**
 * Pick the reference run from a runs-API list (§3.6 step 3), and the newest completed
 * main run (which may be cancelled; rule 3 needs it).
 * *Tests:* scripts/__tests__/status.test.mjs — "never takes a pull-request or merge-queue run as the reference run".
 * *Tests:* scripts/__tests__/status.test.mjs — "takes a workflow_dispatch run on main as the reference run, so a forced crash renders FAILING RUN, and never one from another branch".
 */
export function pickRuns(runs, repoId) {
  const main = (runs ?? []).filter(
    (r) =>
      MAIN_EVENTS.includes(r.event) &&
      r.head_branch === 'main' &&
      r.head_repository?.id === repoId &&
      r.status === 'completed',
  );
  const byNumber = (a, b) => b.run_number - a.run_number;
  const newest = [...main].sort(byNumber)[0] ?? null;
  const reference = main.filter((r) => r.conclusion !== 'cancelled' && r.conclusion !== 'skipped').sort(byNumber)[0] ?? null;
  return { reference, newest };
}

/**
 * The §3.6 rendering rules, first match wins. `context` carries what is known about the
 * token, the runs and the reference run's artifact; `row` is the local register row.
 * Returns `{ state, detail }`.
 * *Tests:* scripts/__tests__/status.test.mjs — "applies the rendering rules in the order the design fixes".
 */
export function renderRow(row, context) {
  const { structuralError, token, newest, reference, newestTimedOut, results, now, isAncestor } = context;
  if (structuralError) return { state: 'UNPROVEN', detail: structuralError };
  if (!token) return { state: 'UNPROVEN', detail: 'no GitHub token, so no run can be read' };
  if (row.class === 'manual') {
    const stated = (row.expect ?? []).map((e) => `${e.key} ${e.op} ${JSON.stringify(e.value)} STATED`);
    return { state: `MANUAL ${row.provenOn}`, detail: [`evidence ${row.evidence}`, ...stated].join('; ') };
  }
  if (newest && newestTimedOut) return { state: `FAILING RUN ${newest.id}`, detail: 'the newest completed main run hit timeout-minutes' };
  if (!reference) return { state: 'UNPROVEN', detail: `no completed main run of ${WORKFLOW} to read` };
  if (reference.conclusion !== 'success') {
    return { state: `FAILING RUN ${reference.id}`, detail: `the reference run concluded ${reference.conclusion}; its partial results are not trusted` };
  }
  if (now - Date.parse(reference.updated_at) > STALE_MS) return { state: 'STALE', detail: `run ${reference.id} is older than 48 hours` };
  if (!isAncestor) return { state: 'UNPROVEN', detail: `run ${reference.id} head ${reference.head_sha.slice(0, 12)} is unknown here or not an ancestor of origin/main` };
  const recorded = (results ?? []).find((r) => r.rowId === row.id);
  if (!recorded || recorded.rowHash !== rowHash(row)) {
    return { state: 'UNPROVEN', detail: `run ${reference.id} did not check this row as it now reads (rowHash differs)` };
  }
  if (!recorded.pass) return { state: `FAILING ${row.id}`, detail: (recorded.failures ?? []).join('; ') };
  return { state: `PASSING ${row.id} run ${reference.id}`, detail: (recorded.expect ?? []).map(formatExpectation).join('; ') };
}

/** Read the runs, the reference run's artifact and its ancestry, through gh and git. */
export function loadRunContext({ repo = DEFAULT_REPO, cwd = REPO_ROOT, run = defaultRunner }) {
  const gh = (args) => {
    const result = run('gh', args, { cwd });
    if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`);
    return result.stdout;
  };
  const repoId = JSON.parse(gh(['api', `repos/${repo}`])).id;
  let runs;
  try {
    runs = JSON.parse(gh(['api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=100`])).workflow_runs;
  } catch {
    runs = []; // the workflow is not on main yet
  }
  const { reference, newest } = pickRuns(runs, repoId);
  let newestTimedOut = newest?.conclusion === 'timed_out';
  if (newest && newest.conclusion === 'cancelled') {
    const jobs = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${newest.id}/jobs`])).jobs ?? [];
    newestTimedOut = jobs.some((j) => j.conclusion === 'timed_out');
  }
  let results = null;
  let isAncestor = false;
  if (reference && reference.conclusion === 'success') {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claims-status-'));
    try {
      gh(['run', 'download', String(reference.id), '--name', 'claims-results', '--dir', dir]);
      results = JSON.parse(readFileSync(path.join(dir, 'claims-results.json'), 'utf8')).results;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const known = run('git', ['cat-file', '-e', `${reference.head_sha}^{commit}`], { cwd }).status === 0;
    isAncestor = known && run('git', ['merge-base', '--is-ancestor', reference.head_sha, 'origin/main'], { cwd }).status === 0;
  }
  return { reference, newest, newestTimedOut, results, isAncestor };
}

/**
 * Build the whole report as lines. Every seam is injectable.
 * *Tests:* scripts/__tests__/status.test.mjs — "degrades every row to UNPROVEN with no token".
 */
export function statusReport({ tree, exists, token, runContext, now = Date.now() }) {
  const structure = checkStructure(tree, exists);
  const active = new Map((structure.register?.active ?? []).map((row) => [row.id, row]));
  const errorsByLine = new Map();
  for (const e of structure.errors) if (e.line) errorsByLine.set(`${e.file}:${e.line}`, e.message);
  const globalErrors = structure.errors.filter((e) => !e.line);
  // A register error names its row, or (rowId null) the whole register; either way no
  // run can vouch for a row the register itself does not hold together.
  const rowErrors = new Map(globalErrors.filter((e) => e.rowId).map((e) => [e.rowId, `register: ${e.message}`]));
  const registerError = globalErrors.find((e) => !e.rowId);

  const lines = [];
  const counts = new Map();
  for (const item of structure.items.filter((i) => i.checked)) {
    const key = `${item.file}:${item.line}`;
    const row = item.tags.length === 1 ? active.get(item.tags[0]) : undefined;
    const structuralError =
      errorsByLine.get(key) ??
      (registerError ? `register: ${registerError.message}` : null) ??
      (row ? (rowErrors.get(row.id) ?? null) : 'no row in active');
    const { state, detail } = row
      ? renderRow(row, { ...runContext, structuralError, token, now })
      : { state: 'UNPROVEN', detail: structuralError };
    const bucket = state.split(' ')[0];
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    lines.push(`${state.padEnd(24)} ${item.tags.join(',') || '(no tag)'}  ${key}  ${item.text.slice(0, 70)}`);
    if (detail) lines.push(`${' '.repeat(26)}${detail}`);
  }
  const header = [
    `claims status: ${structure.items.filter((i) => i.checked).length} ticked item(s), ${active.size} active row(s)`,
    `reference run: ${runContext?.reference ? `${runContext.reference.id} (${runContext.reference.conclusion}, ${runContext.reference.updated_at})` : 'none'}${token ? '' : ' (no token)'}`,
    `summary: ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing ticked'}`,
    ...globalErrors.map((e) => `structure: ${e.file}: ${e.message}`),
    ...structure.errors.filter((e) => e.line && !structure.items.some((i) => i.checked && `${i.file}:${i.line}` === `${e.file}:${e.line}`)).map((e) => `structure: ${e.file}:${e.line}: ${e.message}`),
    '',
  ];
  return [...header, ...lines];
}

export function main({ cwd = REPO_ROOT, run = defaultRunner, log = console.log, env = process.env } = {}) {
  const fetched = run('git', ['fetch', 'origin', 'main', '--quiet'], { cwd });
  if (fetched.status !== 0) log(`warning: git fetch origin main failed (${fetched.stderr.trim()}); ancestry is judged against the local origin/main`);
  const token = hasToken(env, run);
  let runContext = { reference: null, newest: null, newestTimedOut: false, results: null, isAncestor: false };
  if (token) {
    try {
      runContext = loadRunContext({ cwd, run });
    } catch (error) {
      log(`warning: could not read runs (${error.message}); rows render UNPROVEN`);
    }
  }
  const tree = readWorkingTree({ cwd, run });
  const exists = (p) => run('git', ['ls-files', '--error-unmatch', '--', p], { cwd }).status === 0;
  for (const line of statusReport({ tree, exists, token, runContext })) log(line);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`status: ${error.message}`);
    process.exit(2);
  }
}
