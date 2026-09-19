/**
 * Tests for scripts/claims/prove-claims.mjs (§3.2, §3.4, §3.5), and the register as
 * committed: every repo row passes on this tree, every probe turns its row red, and the
 * measured times fit the budgets.
 *
 * The timing half is measured, not estimated, but only for repo rows: github rows need a
 * token and the network, which `test:scripts` has on no CI leg. prove-claims enforces the
 * same budgets at run time over the rows it actually ran, github rows included.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, defaultRunner, loadRegister, rowHash, runProbe, runRow, snapshotCommit } from '../claims/lib.mjs';
import { MAIN_BUDGET_MS, QUEUE_BUDGET_MS, parseArgs, prove, selectRows, timingFailure } from '../claims/prove-claims.mjs';

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('row selection', () => {
  const register = {
    active: [
      { id: 'C-1', class: 'repo' },
      { id: 'C-2', class: 'github' },
      { id: 'C-3', class: 'manual' },
      { id: 'C-4', class: 'repo' },
    ],
  };

  it('selects cited and changed rows in pull_request mode and every re-runnable row on push', () => {
    const diff = { citedRows: ['C-1', 'C-3'], rowsChanged: ['C-4'] };
    const pr = selectRows('pull_request', register, diff);
    assert.deepEqual(pr.run.map((r) => r.id), ['C-1', 'C-3', 'C-4']);
    assert.deepEqual(pr.probe.map((r) => r.id), ['C-4'], 'probes only for rows added or changed');
    const push = selectRows('push', register, diff);
    assert.deepEqual(push.run.map((r) => r.id), ['C-1', 'C-2', 'C-4'], 'manual rows are never re-run');
    assert.deepEqual(push.probe.map((r) => r.id), ['C-1', 'C-4']);
    assert.deepEqual(selectRows('schedule', register, diff).run.length, 3);
  });

  it('holds a change run to 4 minutes and a main run to 30', () => {
    assert.equal(timingFailure('pull_request', [{ ms: QUEUE_BUDGET_MS }]), null);
    assert.match(timingFailure('merge_group', [{ ms: QUEUE_BUDGET_MS }, { ms: 1 }]), /budget is 240s/);
    assert.equal(timingFailure('push', [{ ms: QUEUE_BUDGET_MS + 1 }]), null);
    assert.match(timingFailure('schedule', [{ ms: MAIN_BUDGET_MS + 1 }]), /budget is 1800s/);
  });

  it('parses its arguments', () => {
    assert.deepEqual(parseArgs(['--mode', 'push', '--out', 'x.json', '--only', 'C-1,C-2']), { mode: 'push', out: 'x.json', only: ['C-1', 'C-2'] });
    assert.throws(() => parseArgs(['--what']), /unrecognised/);
  });
});

// ---------------------------------------------------------------------------
// A whole run, in a throwaway repository
// ---------------------------------------------------------------------------

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function configure(dir) {
  sh(dir, 'config', 'user.email', 'test@example.invalid');
  sh(dir, 'config', 'user.name', 'test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
}

const CHECK = "import { readFileSync } from 'node:fs';\nconsole.log('bytes=' + readFileSync('notes.txt').length);\n";
const repoRow = {
  id: 'C-1',
  box: 'Notes stay short.',
  class: 'repo',
  checks: [['node', 'scripts/claims/checks/notes.mjs']],
  expect: [{ key: 'bytes', op: '<=', value: 10 }],
  probe: { name: 'notes grow', edits: [{ file: 'notes.txt', pad: 20 }] },
  provenOn: '2026-09-18',
  addedBy: 'test',
};

function makeProject(row = repoRow) {
  const origin = mkdtempSync(path.join(os.tmpdir(), 'claims-prove-origin-'));
  scratch.push(origin);
  sh(origin, 'init', '-q', '-b', 'main');
  configure(origin);
  mkdirSync(path.join(origin, 'docs', 'plans'), { recursive: true });
  mkdirSync(path.join(origin, 'scripts', 'claims', 'checks'), { recursive: true });
  mkdirSync(path.join(origin, '.github', 'rulesets'), { recursive: true });
  writeFileSync(path.join(origin, 'docs', 'plans', 'p.md'), '## S (0/1)\n- [ ] Notes stay short.\n');
  writeFileSync(path.join(origin, 'docs', 'claims.json'), JSON.stringify({ schemaVersion: 1, active: [], retired: [] }));
  writeFileSync(path.join(origin, 'notes.txt'), 'short');
  writeFileSync(path.join(origin, 'scripts', 'claims', 'checks', 'notes.mjs'), CHECK);
  writeFileSync(path.join(origin, '.github', 'rulesets', 'main.json'), JSON.stringify({ name: 'main', rules: [{ type: 'merge_queue', parameters: { merge_method: 'SQUASH' } }] }));
  sh(origin, 'add', '-A');
  sh(origin, 'commit', '-q', '-m', 'base');

  const clone = mkdtempSync(path.join(os.tmpdir(), 'claims-prove-clone-'));
  scratch.push(clone);
  sh(clone, 'clone', '-q', pathToFileURL(origin).href, '.');
  configure(clone);
  sh(clone, 'checkout', '-q', '-b', 'feature');
  writeFileSync(path.join(clone, 'docs', 'plans', 'p.md'), '## S (1/1)\n- [x] Notes stay short. [C-1]\n');
  writeFileSync(path.join(clone, 'docs', 'claims.json'), JSON.stringify({ schemaVersion: 1, active: [row], retired: [] }));
  sh(clone, 'commit', '-q', '-am', 'tick');
  return clone;
}

describe('a whole run', () => {
  it('passes a pull request whose tick cites a passing row, with its probe turning it red', () => {
    const cwd = makeProject();
    const lines = [];
    const { exitCode, report } = prove({ mode: 'pull_request', cwd, env: {}, log: (l) => lines.push(l) });
    assert.equal(exitCode, 0, lines.join('\n'));
    const row = report.results.find((r) => r.rowId === 'C-1');
    assert.equal(row.pass, true);
    assert.equal(row.rowHash, rowHash(repoRow));
    assert.equal(row.probe.pass, true);
    assert.ok(lines.some((l) => /UNRESTRICTED/.test(l)), 'a local run says it is unrestricted');
  });

  it('fails a pull request whose row expectation does not hold, with an error annotation', () => {
    const cwd = makeProject({ ...repoRow, expect: [{ key: 'bytes', op: '<=', value: 2 }] });
    const lines = [];
    const { exitCode } = prove({ mode: 'pull_request', cwd, env: {}, log: (l) => lines.push(l) });
    assert.equal(exitCode, 1);
    assert.ok(lines.some((l) => l.startsWith('::error::C-1')));
  });

  it('fails a vacuous row: a probe that leaves it green', () => {
    const cwd = makeProject({ ...repoRow, probe: { name: 'touch nothing that matters', edits: [{ file: 'docs/plans/p.md', append: '\n' }] } });
    const { exitCode, report } = prove({ mode: 'pull_request', cwd, env: {}, log: () => {} });
    assert.equal(exitCode, 1);
    assert.match(report.results.find((r) => r.rowId === 'C-1').probe.reason, /vacuous/);
  });

  it('fails a tick without a row in structure', () => {
    const cwd = makeProject();
    writeFileSync(path.join(cwd, 'docs', 'plans', 'p.md'), '## S (1/1)\n- [x] Notes stay short. [C-9]\n');
    const { exitCode, report } = prove({ mode: 'pull_request', cwd, env: {}, log: () => {} });
    assert.equal(exitCode, 1);
    assert.match(report.results.find((r) => r.rowId === 'S-structure').output, /C-9 is not in active/);
  });

  it('records every result on push and succeeds even when a row fails, with the ruleset compared', () => {
    const cwd = makeProject({ ...repoRow, expect: [{ key: 'bytes', op: '<=', value: 2 }] });
    const { exitCode, report } = prove({ mode: 'push', cwd, env: {}, log: () => {}, fetchRuleset: (declared) => ({ ...declared, rules: [] }) });
    assert.equal(exitCode, 0);
    assert.equal(report.results.find((r) => r.rowId === 'C-1').pass, false);
    const ruleset = report.results.find((r) => r.rowId === 'S-ruleset');
    assert.equal(ruleset.pass, false);
    assert.match(ruleset.output, /rule types differ/);
    const unreadable = prove({ mode: 'schedule', cwd, env: {}, log: () => {}, fetchRuleset: () => { throw new Error('HTTP 403'); } });
    assert.match(unreadable.report.results.find((r) => r.rowId === 'S-ruleset').output, /could not read the live ruleset: HTTP 403/);
  });

  it('refuses an unknown mode, and the wrapper off Linux', () => {
    assert.throws(() => prove({ mode: 'release', env: {}, log: () => {} }), /--mode must be one of/);
    if (process.platform !== 'linux') {
      assert.throws(() => prove({ mode: 'push', env: { CLAIMS_NET_RESTRICT: 'unshare' }, log: () => {} }), /Linux only/);
    }
  });

  it('checks manual rows for their evidence file in a change run', () => {
    const cwd = makeProject({ id: 'C-1', box: 'Notes stay short.', class: 'manual', evidence: 'docs/claims-evidence/n.txt', provenOn: '2026-09-18', addedBy: 't' });
    const { report } = prove({ mode: 'pull_request', cwd, env: {}, log: () => {} });
    const row = report.results.find((r) => r.rowId === 'C-1');
    assert.equal(row.pass, false);
    assert.match(row.failures[0], /is missing/);
  });
});

// ---------------------------------------------------------------------------
// The register as committed
// ---------------------------------------------------------------------------

describe('the committed register, measured on this tree', () => {
  const register = loadRegister();
  const repoRows = register.active.filter((row) => row.class === 'repo');
  const commit = snapshotCommit({});
  let total = 0;

  for (const row of repoRows) {
    it(`${row.id} passes here, and its probe "${row.probe.name}" turns it red`, () => {
      const outcome = runRow(row, { cwd: REPO_ROOT, run: defaultRunner });
      assert.equal(outcome.pass, true, outcome.failures.join('; '));
      const probe = runProbe(row, { commit, cwd: REPO_ROOT, run: defaultRunner });
      assert.equal(probe.pass, true, probe.reason);
      total += outcome.ms + probe.ms;
    });
  }

  it('fits the repo rows and every probe inside the queue budget and the main budget', () => {
    assert.ok(total > 0, 'the rows above ran');
    assert.ok(total <= QUEUE_BUDGET_MS, `measured ${total}ms for repo rows and probes; the queue budget is ${QUEUE_BUDGET_MS}ms`);
    assert.ok(total <= MAIN_BUDGET_MS);
  });

  it('keeps every register id in step with a tag in the plan', () => {
    const plan = readFileSync(path.join(REPO_ROOT, 'docs', 'plans', 'v1-production.md'), 'utf8');
    for (const row of register.active) assert.ok(plan.includes(`[${row.id}]`), `${row.id} is cited by no plan item`);
  });
});
