#!/usr/bin/env node
/**
 * The prover: runs register rows, probes and structural checks
 * (docs/proof-of-completion.md §3.2, §3.4, §3.5).
 *
 * Modes, one per workflow event:
 *   pull_request  structure, plus the rows a change touched over origin/main...HEAD, plus
 *                 probes for rows added or changed. Any failure fails the run.
 *   merge_group   the same over HEAD~1..HEAD, after asserting the squash queue shape.
 *   push          structure, every repo and github row, every probe, the ruleset
 *   schedule      comparison. Every result is recorded; the run fails only on a crash.
 *
 * Results go to a JSON file (`--out`, default claims-results.json) as
 * `{ rowId, rowHash, pass, output, ... }`, with structural failures and ruleset drift
 * recorded as the synthetic rows S-structure and S-ruleset.
 *
 * Repo rows run under `unshare --net` only on Linux with CLAIMS_NET_RESTRICT=unshare, and the
 * run fails if that wrapper does not work. A local run is unrestricted and says so.
 *
 * A guardrail against the honest mistake, not an integrity control.
 *
 * Usage:
 *   node scripts/claims/prove-claims.mjs --mode pull_request [--out file] [--only C-01,C-02]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  annotation,
  assertRestrictionWorks,
  networkRestriction,
  defaultRunner,
  evaluateExpect,
  formatExpectation,
  git,
  rowHash,
  runProbe,
  runRow,
  snapshotCommit,
} from './lib.mjs';
import { checkStructure, diffScope, readCommit, readWorkingTree, resolveBase } from './lint-boxes.mjs';
import { RULESET_FILE, compareRuleset, fetchLiveRuleset } from './compare-ruleset.mjs';

export const MODES = ['pull_request', 'merge_group', 'push', 'schedule'];
/** A PR or queue run must fit the queue's 10 minutes beside CI's measured 4m18s. */
export const QUEUE_BUDGET_MS = 4 * 60 * 1000;
/** Main runs carry `timeout-minutes: 30`. */
export const MAIN_BUDGET_MS = 30 * 60 * 1000;

/** Is a mode diff-scoped (a change under review) or whole-register (main)? */
export function isChangeMode(mode) {
  return mode === 'pull_request' || mode === 'merge_group';
}

/**
 * Which rows run and which get probes, for a mode.
 * *Tests:* scripts/__tests__/claims-prove.test.mjs — "selects cited and changed rows in pull_request mode and every re-runnable row on push".
 */
export function selectRows(mode, register, diff) {
  const active = register.active ?? [];
  if (!isChangeMode(mode)) {
    const rerun = active.filter((row) => row.class === 'repo' || row.class === 'github');
    return { run: rerun, probe: rerun.filter((row) => row.class === 'repo') };
  }
  const wanted = new Set([...diff.citedRows, ...diff.rowsChanged]);
  const changed = new Set(diff.rowsChanged);
  const run = active.filter((row) => wanted.has(row.id));
  return { run, probe: run.filter((row) => row.class === 'repo' && changed.has(row.id)) };
}

/** Sum measured times and hold them to the budget for the mode. */
export function timingFailure(mode, results) {
  const total = results.reduce((sum, r) => sum + (r.ms ?? 0), 0);
  const budget = isChangeMode(mode) ? QUEUE_BUDGET_MS : MAIN_BUDGET_MS;
  return total > budget ? `rows and probes took ${Math.round(total / 1000)}s; the ${mode} budget is ${budget / 1000}s` : null;
}

/**
 * The whole run, with every process and file behind an injectable seam. Returns
 * `{ exitCode, report }`.
 */
export function prove({
  mode,
  only = null,
  cwd = REPO_ROOT,
  run = defaultRunner,
  env = process.env,
  log = console.log,
  fetchRuleset = (declared) => fetchLiveRuleset(declared, { run }),
  now = Date.now,
}) {
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const restrict = networkRestriction(env);
  assertRestrictionWorks(restrict, run);
  log(restrict.restricted ? 'repo rows run under unshare --net' : 'repo rows run UNRESTRICTED (local run, or CLAIMS_NET_RESTRICT is not set)');

  const head = readWorkingTree({ cwd, run });
  const structure = checkStructure(head, (p) => existsSync(path.join(cwd, p)));
  const register = structure.register ?? { active: [] };
  const results = [];

  let diff = { changedItems: [], rowsChanged: [], citedRows: [], removedOrReworded: [], deletedPlanFiles: [] };
  if (isChangeMode(mode)) {
    const base = resolveBase(mode, { cwd, run });
    diff = diffScope(readCommit(base, { cwd, run }), head);
    log(`diff base ${base.slice(0, 12)}: ${diff.changedItems.length} changed item(s); rows added or changed: ${diff.rowsChanged.join(', ') || 'none'}`);
  }

  const structuralMessages = structure.errors.map((e) => `${e.file}${e.line ? `:${e.line}` : ''}: ${e.message}`);
  // A cited row that does not exist is structural too; checkStructure reports it per item.
  let { run: toRun, probe: toProbe } = selectRows(mode, register, diff);
  if (only) {
    toRun = toRun.filter((row) => only.includes(row.id));
    toProbe = toProbe.filter((row) => only.includes(row.id));
  }
  const probeIds = new Set(toProbe.map((row) => row.id));
  let commit = null;
  if (probeIds.size > 0) {
    if (git(['status', '--porcelain', '--untracked-files=no'], { cwd, run }).trim() !== '') {
      log('probes run against a snapshot of tracked and staged changes; untracked files are not in it');
    }
    commit = snapshotCommit({ cwd, run });
  }

  for (const row of toRun) {
    const record = { rowId: row.id, rowHash: rowHash(row), class: row.class };
    if (row.class === 'manual') {
      // Never re-run. The stated expectations must at least agree with the committed
      // evidence: each key printed exactly once there, and holding.
      const file = path.join(cwd, row.evidence);
      if (!existsSync(file)) {
        Object.assign(record, { pass: false, output: `evidence=${row.evidence}`, failures: [`evidence file ${row.evidence} is missing`], ms: 0 });
      } else {
        const expect = evaluateExpect(row.expect, readFileSync(file, 'utf8'));
        const failures = expect.filter((e) => !e.pass).map((e) => `evidence ${row.evidence}: ${e.reason ?? `does not state ${formatExpectation(e)}`}`);
        Object.assign(record, { pass: failures.length === 0, output: `evidence=${row.evidence}`, expect, failures, ms: 0 });
      }
    } else {
      const outcome = runRow(row, { cwd, run, restrict, now });
      Object.assign(record, { pass: outcome.pass, output: outcome.output, expect: outcome.expect, failures: outcome.failures, ms: outcome.ms });
      if (probeIds.has(row.id)) {
        const probe = runProbe(row, { commit, cwd, run, restrict, now });
        record.probe = { name: row.probe.name, pass: probe.pass, reason: probe.reason ?? null, ms: probe.ms };
        record.ms += probe.ms;
        if (!probe.pass) {
          record.pass = false;
          record.failures.push(probe.reason);
        }
      }
    }
    results.push(record);
  }

  const late = timingFailure(mode, results);
  if (late) structuralMessages.push(late);
  results.push({ rowId: 'S-structure', rowHash: null, pass: structuralMessages.length === 0, output: structuralMessages.join('\n'), failures: structuralMessages });

  if (!isChangeMode(mode)) {
    const declared = JSON.parse(readFileSync(path.join(cwd, RULESET_FILE), 'utf8'));
    let drift;
    let notes = [];
    try {
      ({ drift, notes } = compareRuleset(declared, fetchRuleset(declared)));
    } catch (error) {
      drift = [`could not read the live ruleset: ${error.message}`];
    }
    results.push({ rowId: 'S-ruleset', rowHash: null, pass: drift.length === 0, output: [...notes.map((n) => `note: ${n}`), ...drift].join('\n'), failures: drift });
  }

  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    const timing = r.ms !== undefined ? ` (${r.ms}ms)` : '';
    log(`${mark} ${r.rowId}${timing}${r.probe ? ` probe "${r.probe.name}" ${r.probe.pass ? 'turned it red' : 'FAILED'}` : ''}`);
    for (const e of r.expect ?? []) log(`     ${formatExpectation(e)} ${e.pass ? 'holds' : 'DOES NOT HOLD'}`);
    for (const f of r.failures ?? []) {
      log(`     ${f}`);
      if (isChangeMode(mode)) log(annotation('error', `${r.rowId}: ${f}`));
    }
  }
  const failed = results.filter((r) => !r.pass);
  log(`prove-claims ${mode}: ${results.length - failed.length} of ${results.length} results pass`);

  const report = {
    schemaVersion: 1,
    mode,
    headSha: git(['rev-parse', 'HEAD'], { cwd, run }).trim(),
    restricted: restrict.restricted,
    diff: isChangeMode(mode) ? diff : null,
    results,
  };
  const exitCode = isChangeMode(mode) && failed.length > 0 ? 1 : 0;
  return { exitCode, report };
}

export function parseArgs(argv) {
  const options = { mode: null, out: 'claims-results.json', only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') options.mode = argv[(i += 1)];
    else if (arg === '--out') options.out = argv[(i += 1)];
    else if (arg === '--only') options.only = (argv[(i += 1)] ?? '').split(',').filter(Boolean);
    else throw new Error(`unrecognised argument: ${arg}`);
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { exitCode, report } = prove(options);
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
    process.exit(exitCode);
  } catch (error) {
    console.error(`prove-claims crashed: ${error.stack ?? error.message}`);
    process.exit(2);
  }
}
