/**
 * Tests for scripts/status.mjs, `npm run status` (§3.6).
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { rowHash } from '../claims/lib.mjs';
import { STALE_MS, loadRunContext, main, pickRuns, renderRow, statusReport } from '../status.mjs';

const REPO_ID = 42;
const NOW = Date.parse('2026-09-20T12:00:00Z');
const run = (over) => ({
  id: 1000,
  run_number: 10,
  event: 'push',
  head_branch: 'main',
  head_repository: { id: REPO_ID },
  status: 'completed',
  conclusion: 'success',
  updated_at: '2026-09-20T11:00:00Z',
  head_sha: 'a'.repeat(40),
  ...over,
});

const repoRow = { id: 'C-1', box: 'Do it.', class: 'repo', checks: [['node', 'scripts/claims/checks/a.mjs']], expect: [{ key: 'k', op: '<=', value: 3 }], probe: { name: 'p', edits: [{ file: 'a', pad: 1 }] }, provenOn: '2026-09-18', addedBy: 't' };
const manualRow = { id: 'C-2', box: 'Scan.', class: 'manual', evidence: 'docs/claims-evidence/e.txt', expect: [{ key: 'EXIT', op: '==', value: 0 }], provenOn: '2026-09-18', addedBy: 't' };
const passing = { rowId: 'C-1', rowHash: rowHash(repoRow), pass: true, expect: [{ key: 'k', op: '<=', value: 3, actual: 2, pass: true }] };

const base = (over = {}) => ({
  structuralError: null,
  token: true,
  newest: run(),
  reference: run(),
  newestTimedOut: false,
  results: [passing],
  now: NOW,
  isAncestor: true,
  ...over,
});

describe('choosing the reference run (§3.6 step 3)', () => {
  it('never takes a pull-request or merge-queue run as the reference run', () => {
    const runs = [
      run({ id: 1, run_number: 50, event: 'pull_request' }),
      run({ id: 2, run_number: 51, event: 'merge_group' }),
      run({ id: 3, run_number: 5, event: 'schedule' }),
    ];
    assert.equal(pickRuns(runs, REPO_ID).reference.id, 3);
  });

  it('takes a workflow_dispatch run on main as the reference run, so a forced crash renders FAILING RUN, and never one from another branch', () => {
    const crashed = run({ id: 8, run_number: 30, event: 'workflow_dispatch', conclusion: 'failure' });
    const runs = [run({ id: 6, run_number: 20 }), crashed, run({ id: 9, run_number: 31, event: 'workflow_dispatch', head_branch: 'feature' })];
    const { reference } = pickRuns(runs, REPO_ID);
    assert.equal(reference.id, 8);
    assert.equal(renderRow(repoRow, base({ newest: reference, reference })).state, 'FAILING RUN 8');
  });

  it('skips other branches, forks, incomplete, cancelled and skipped runs, and takes the highest run_number', () => {
    const runs = [
      run({ id: 1, run_number: 90, head_branch: 'feature' }),
      run({ id: 2, run_number: 91, head_repository: { id: 7 } }),
      run({ id: 3, run_number: 92, status: 'in_progress' }),
      run({ id: 4, run_number: 93, conclusion: 'cancelled' }),
      run({ id: 5, run_number: 94, conclusion: 'skipped' }),
      run({ id: 6, run_number: 20 }),
      run({ id: 7, run_number: 21, conclusion: 'failure' }),
    ];
    const { reference, newest } = pickRuns(runs, REPO_ID);
    assert.equal(reference.id, 7);
    assert.equal(newest.id, 5, 'the newest completed main run may be cancelled or skipped');
    assert.deepEqual(pickRuns([], REPO_ID), { reference: null, newest: null });
    assert.deepEqual(pickRuns(undefined, REPO_ID), { reference: null, newest: null });
  });
});

describe('rendering (§3.6 step 4)', () => {
  it('applies the rendering rules in the order the design fixes', () => {
    // Each case breaks the rule named and every rule after it, so only order decides.
    const later = { newestTimedOut: true, reference: run({ conclusion: 'failure', updated_at: '2020-01-01T00:00:00Z' }), isAncestor: false, results: [] };
    assert.equal(renderRow(repoRow, base({ structuralError: 'box differs', token: false, ...later })).state, 'UNPROVEN');
    assert.match(renderRow(repoRow, base({ structuralError: 'box differs' })).detail, /box differs/);
    assert.equal(renderRow(repoRow, base({ token: false, ...later })).state, 'UNPROVEN');
    assert.equal(renderRow(manualRow, base({ ...later })).state, 'MANUAL 2026-09-18');
    assert.equal(renderRow(repoRow, base({ newest: run({ id: 9, conclusion: 'cancelled' }), ...later })).state, 'FAILING RUN 9');
    assert.equal(renderRow(repoRow, base({ reference: run({ id: 8, conclusion: 'failure', updated_at: '2020-01-01T00:00:00Z' }), isAncestor: false, results: [] })).state, 'FAILING RUN 8');
    assert.equal(renderRow(repoRow, base({ reference: run({ updated_at: new Date(NOW - STALE_MS - 1).toISOString() }), isAncestor: false, results: [] })).state, 'STALE');
    assert.equal(renderRow(repoRow, base({ isAncestor: false, results: [] })).state, 'UNPROVEN');
    assert.equal(renderRow(repoRow, base({ results: [{ ...passing, rowHash: 'other', pass: false }] })).state, 'UNPROVEN');
    assert.equal(renderRow(repoRow, base({ results: [{ ...passing, pass: false, failures: ['k=9'] }] })).state, 'FAILING C-1');
    const pass = renderRow(repoRow, base());
    assert.equal(pass.state, 'PASSING C-1 run 1000');
    assert.equal(pass.detail, 'k=2 <= 3');
  });

  it('marks manual expectations STATED, never measured', () => {
    assert.match(renderRow(manualRow, base()).detail, /EXIT == 0 STATED/);
  });

  it('renders UNPROVEN when there is no reference run, or the row is absent from it', () => {
    assert.match(renderRow(repoRow, base({ reference: null, newest: null })).detail, /no completed main run/);
    assert.equal(renderRow(repoRow, base({ results: [] })).state, 'UNPROVEN');
  });

  it('treats a run exactly 48 hours old as fresh', () => {
    assert.equal(renderRow(repoRow, base({ reference: run({ updated_at: new Date(NOW - STALE_MS).toISOString() }) })).state, 'PASSING C-1 run 1000');
  });

  it('skips staleness and the ancestor check for a locally-measured row, even against a stale reference run whose head is not known to be an ancestor', () => {
    const stale = run({ updated_at: new Date(NOW - STALE_MS - 1).toISOString() });
    const rendered = renderRow(repoRow, base({ reference: stale, isAncestor: false, resultsLocal: true }));
    assert.equal(rendered.state, 'MEASURED LOCALLY C-1');
    assert.equal(rendered.detail, 'k=2 <= 3');
  });
});

describe('the report', () => {
  const register = JSON.stringify({ schemaVersion: 1, active: [repoRow, manualRow], retired: [] });
  const tree = (plan) => ({ plans: [{ file: 'docs/plans/p.md', source: plan }], registerText: register });
  const plan = '## S (3/3)\n- [x] Do it. [C-1]\n- [x] Scan. [C-2]\n- [x] Untagged\n';
  const exists = () => true;

  it('degrades every row to UNPROVEN with no token', () => {
    const lines = statusReport({ tree: tree(plan), exists, token: false, runContext: base(), now: NOW });
    const states = lines.filter((l) => /docs\/plans/.test(l)).map((l) => l.split(/\s{2,}/)[0].trim());
    assert.deepEqual(states, ['UNPROVEN', 'UNPROVEN', 'UNPROVEN']);
    assert.ok(lines.some((l) => /\(no token\)/.test(l)));
  });

  it('renders structure failures UNPROVEN whatever the run says', () => {
    const lines = statusReport({ tree: tree(plan.replace('Do it. [C-1]', 'Do it again. [C-1]')), exists, token: true, runContext: base(), now: NOW });
    assert.ok(lines.some((l) => /^UNPROVEN\s+C-1/.test(l)));
    assert.ok(lines.some((l) => /box differs/.test(l)));
    assert.ok(lines.some((l) => /^UNPROVEN\s+\(no tag\)/.test(l)));
  });

  it('renders a register error against the row it names', () => {
    const lines = statusReport({ tree: tree(plan), exists: () => false, token: true, runContext: base(), now: NOW });
    assert.ok(lines.some((l) => /^UNPROVEN\s+C-2/.test(l)));
    assert.ok(lines.some((l) => /evidence file .* is missing/.test(l)));
  });

  it('never prints the word proven', () => {
    for (const token of [true, false]) {
      const text = statusReport({ tree: tree(plan), exists, token, runContext: base(), now: NOW }).join('\n');
      assert.doesNotMatch(text, /\bproven\b/i);
      assert.match(text, /PASSING C-1 run 1000|UNPROVEN/);
    }
  });
});

describe('reading runs through gh', () => {
  const answers = (over = {}) => (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    for (const [pattern, answer] of Object.entries(over)) if (key.includes(pattern)) return answer;
    return { status: 0, stdout: '', stderr: '' };
  };
  const ok = (value) => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });

  it('reads the repository id, the runs, and the ancestry of the reference run', () => {
    const context = loadRunContext({
      run: answers({
        'api repos/o/r/actions/workflows': ok({ workflow_runs: [run({ conclusion: 'failure' })] }),
        'api repos/o/r': ok({ id: REPO_ID }),
      }),
      repo: 'o/r',
    });
    assert.equal(context.reference.id, 1000);
    assert.equal(context.results, null, 'a failed run is not downloaded');
  });

  it('treats a missing workflow as no runs, and a cancelled newest run with a timed-out job as timed out', () => {
    const none = loadRunContext({
      run: answers({ 'actions/workflows': { status: 1, stdout: '', stderr: 'HTTP 404' }, 'api repos/o/r': ok({ id: REPO_ID }) }),
      repo: 'o/r',
    });
    assert.equal(none.reference, null);
    const timed = loadRunContext({
      run: answers({
        'actions/workflows': ok({ workflow_runs: [run({ id: 5, run_number: 2, conclusion: 'cancelled' })] }),
        '/jobs': ok({ jobs: [{ conclusion: 'timed_out' }] }),
        'api repos/o/r': ok({ id: REPO_ID }),
      }),
      repo: 'o/r',
    });
    assert.equal(timed.newestTimedOut, true);
  });

  it('downloads the reference run artifact and judges its ancestry', () => {
    const fake = (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      if (key.includes('run download')) {
        const dir = args[args.indexOf('--dir') + 1];
        writeFileSync(path.join(dir, 'claims-results.json'), JSON.stringify({ results: [passing] }));
        return ok('');
      }
      if (key.includes('actions/workflows')) return ok({ workflow_runs: [run()] });
      if (key.includes('api repos/o/r')) return ok({ id: REPO_ID });
      if (key.startsWith('git merge-base')) return { status: 1, stdout: '', stderr: '' };
      return ok('');
    };
    const context = loadRunContext({ run: fake, repo: 'o/r' });
    assert.deepEqual(context.results, [passing]);
    assert.equal(context.isAncestor, false);
  });

  it('fails loudly when gh cannot read the repository', () => {
    assert.throws(() => loadRunContext({ run: () => ({ status: 1, stdout: '', stderr: 'no auth' }), repo: 'o/r' }), /no auth/);
  });

  it('falls back to a local run of prove-claims --mode push when the reference run artifact cannot be downloaded, and renders the row MEASURED LOCALLY', () => {
    const fake = (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      if (key.includes('run download')) return { status: 1, stdout: '', stderr: 'HTTP 403: proxy blocked (agent proxy)' };
      if (cmd === 'node' && args[0] === 'scripts/claims/prove-claims.mjs') {
        assert.deepEqual(args.slice(0, 3), ['scripts/claims/prove-claims.mjs', '--mode', 'push'], 'reproduces the reference run in push mode');
        const out = args[args.indexOf('--out') + 1];
        writeFileSync(out, JSON.stringify({ results: [passing] }));
        return ok('');
      }
      if (key.includes('actions/workflows')) return ok({ workflow_runs: [run()] });
      if (key.includes('api repos/o/r')) return ok({ id: REPO_ID });
      return ok('');
    };
    const context = loadRunContext({ run: fake, repo: 'o/r' });
    assert.equal(context.resultsLocal, true);
    assert.deepEqual(context.results, [passing]);
    const rendered = renderRow(repoRow, base({ ...context, now: NOW }));
    assert.equal(rendered.state, 'MEASURED LOCALLY C-1');
    assert.equal(rendered.detail, 'k=2 <= 3');
  });

  it('throws an error naming both failures when the artifact download and the local reproduction both fail', () => {
    const fake = (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      if (key.includes('run download')) return { status: 1, stdout: '', stderr: 'HTTP 403: proxy blocked (agent proxy)' };
      if (cmd === 'node' && args[0] === 'scripts/claims/prove-claims.mjs') return { status: 2, stdout: '', stderr: 'prove-claims crashed: boom' };
      if (key.includes('actions/workflows')) return ok({ workflow_runs: [run()] });
      if (key.includes('api repos/o/r')) return ok({ id: REPO_ID });
      return ok('');
    };
    assert.throws(
      () => loadRunContext({ run: fake, repo: 'o/r' }),
      /proxy blocked \(agent proxy\).*reproducing it locally also failed.*prove-claims crashed: boom/s,
    );
  });

  it('falls back to a local run of prove-claims when gh run download succeeds but the artifact it wrote cannot be parsed', () => {
    const fake = (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      if (key.includes('run download')) {
        const dir = args[args.indexOf('--dir') + 1];
        writeFileSync(path.join(dir, 'claims-results.json'), '{not valid json');
        return ok('');
      }
      if (cmd === 'node' && args[0] === 'scripts/claims/prove-claims.mjs') {
        const out = args[args.indexOf('--out') + 1];
        writeFileSync(out, JSON.stringify({ results: [passing] }));
        return ok('');
      }
      if (key.includes('actions/workflows')) return ok({ workflow_runs: [run()] });
      if (key.includes('api repos/o/r')) return ok({ id: REPO_ID });
      return ok('');
    };
    const context = loadRunContext({ run: fake, repo: 'o/r' });
    assert.equal(context.resultsLocal, true);
    assert.deepEqual(context.results, [passing]);
  });

  it('names the parse failure rather than the download when gh run download succeeds but its artifact cannot be parsed and the local reproduction also fails', () => {
    const fake = (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      if (key.includes('run download')) {
        const dir = args[args.indexOf('--dir') + 1];
        writeFileSync(path.join(dir, 'claims-results.json'), '{not valid json');
        return ok('');
      }
      if (cmd === 'node' && args[0] === 'scripts/claims/prove-claims.mjs') return { status: 2, stdout: '', stderr: 'prove-claims crashed: boom' };
      if (key.includes('actions/workflows')) return ok({ workflow_runs: [run()] });
      if (key.includes('api repos/o/r')) return ok({ id: REPO_ID });
      return ok('');
    };
    assert.throws(
      () => loadRunContext({ run: fake, repo: 'o/r' }),
      (error) =>
        !/HTTP 403|proxy blocked/.test(error.message) &&
        /JSON/.test(error.message) &&
        /reproducing it locally also failed.*prove-claims crashed: boom/s.test(error.message),
    );
  });

  // This test's fake gives workingPlanFiles an empty `git ls-files`, so no row is ever
  // rendered here to assert against; that a row renders UNPROVEN once `reference` is
  // null (main()'s catch never reassigns runContext past its all-null default) is
  // already proven directly by "renders UNPROVEN when there is no reference run, or the
  // row is absent from it" above. This test proves only the process-level half: the
  // warning names both failures, and main() still exits 0 rather than throwing.
  it('prints one warning naming both failures and exits 0 when the artifact download and the local reproduction both fail', () => {
    const lines = [];
    const fake = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[0] === 'api') {
        const p = args[1];
        if (p.includes('actions/workflows')) return ok({ workflow_runs: [run()] });
        return ok({ id: REPO_ID });
      }
      if (cmd === 'gh' && args[0] === 'run' && args[1] === 'download') return { status: 1, stdout: '', stderr: 'HTTP 403: proxy blocked' };
      if (cmd === 'node' && args[0] === 'scripts/claims/prove-claims.mjs') return { status: 2, stdout: '', stderr: 'prove-claims crashed: boom' };
      return { status: 0, stdout: '', stderr: '' };
    };
    assert.equal(main({ run: fake, log: (l) => lines.push(l), env: { GH_TOKEN: 'x' } }), 0);
    assert.ok(lines.some((l) => /warning: could not read runs/.test(l) && /proxy blocked/.test(l) && /prove-claims crashed: boom/.test(l)));
  });

  it('prints a report and exits 0 with no token, after trying to fetch', () => {
    const calls = [];
    const lines = [];
    const fake = (cmd, args, opts) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'gh') return { status: 1, stdout: '', stderr: 'not logged in' };
      if (args[0] === 'fetch') return { status: 1, stdout: '', stderr: 'offline' };
      if (args[0] === 'ls-files' && args.includes('--error-unmatch')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: args[0] === 'ls-files' ? 'docs/plans/v1-production.md\n' : '', stderr: '', ...opts?.fake };
    };
    assert.equal(main({ run: fake, log: (l) => lines.push(l), env: {} }), 0);
    assert.equal(calls[0], 'git fetch origin main --quiet');
    assert.ok(lines.some((l) => /git fetch origin main failed/.test(l)));
    assert.ok(lines.some((l) => /\(no token\)/.test(l)));
  });
});
