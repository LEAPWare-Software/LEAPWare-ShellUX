/**
 * Tests for scripts/claims/lint-boxes.mjs: the structural checks, the diff scope and the
 * diff base. The git cases build throwaway repositories under the OS temp directory.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';
import { checkStructure, diffScope, main, readCommit, readWorkingTree, resolveBase } from '../claims/lint-boxes.mjs';

const row = (id, box, extra = {}) => ({
  id,
  box,
  class: 'github',
  checks: [['gh', 'pr', 'view', '1', '--json', 'state']],
  provenOn: '2026-09-18',
  addedBy: 'test',
  ...extra,
});
const register = (active, retired = []) => JSON.stringify({ schemaVersion: 1, active, retired });
const tree = (plan, reg) => ({ plans: [{ file: 'docs/plans/p.md', source: plan }], registerText: reg });

describe('structure, every ticked item (§3.2)', () => {
  it('passes a tagged item whose row box equals the item text', () => {
    const { errors } = checkStructure(tree('## S (1/2)\n- [x] Do it. [C-1]\n- [ ] Later\n', register([row('C-1', 'Do it.')])));
    assert.deepEqual(errors, []);
  });

  it('fails a ticked item with no tag, or with two', () => {
    const none = checkStructure(tree('- [x] Do it.\n', register([])));
    assert.match(none.errors[0].message, /exactly one \[C-nn\] tag; it has 0/);
    const two = checkStructure(tree('- [x] Do it. [C-1] [C-2]\n', register([row('C-1', 'Do it.'), row('C-2', 'Do it.')])));
    assert.match(two.errors[0].message, /it has 2/);
  });

  it('fails a ticked item whose row is retired or absent', () => {
    const retired = { ...row('C-1', 'Do it.'), retiredBy: 'PR 2', reason: 'gone' };
    const { errors } = checkStructure(tree('- [x] Do it. [C-1]\n', register([], [retired])));
    assert.match(errors[0].message, /C-1 is not in active/);
  });

  it('fails a ticked item whose row box differs from the item text', () => {
    const { errors } = checkStructure(tree('- [x] Do it now. [C-1]\n', register([row('C-1', 'Do it.')])));
    assert.match(errors[0].message, /box differs/);
    assert.equal(errors[0].rowId, 'C-1');
  });

  it('ignores unticked items, tagged or not', () => {
    assert.deepEqual(checkStructure(tree('- [ ] Later [C-9]\n', register([]))).errors, []);
  });

  it('fails a heading count and an ambiguous item', () => {
    const { errors } = checkStructure(tree('## S (0/1)\n- [x] a [C-1]\n\nText\n2. [x] b\n', register([row('C-1', 'a')])));
    assert.ok(errors.some((e) => /heading says/.test(e.message)));
    assert.ok(errors.some((e) => /ambiguous/.test(e.message)));
  });

  it('fails a register that is not JSON, or not well formed', () => {
    assert.match(checkStructure(tree('', '{')).errors[0].message, /not JSON/);
    assert.match(checkStructure(tree('', '{"schemaVersion":2,"active":[],"retired":[]}')).errors[0].message, /schemaVersion/);
  });
});

describe('diff scope (§3.2)', () => {
  const baseReg = register([row('C-1', 'Old item.')]);

  it('finds items whose tick, text or tag changed, and the rows they cite', () => {
    const base = tree('- [x] Old item. [C-1]\n- [ ] Next\n- [ ] Third\n', baseReg);
    const head = tree('- [x] Old item. [C-1]\n- [x] Next [C-2]\n- [ ] Third changed\n', register([row('C-1', 'Old item.'), row('C-2', 'Next')]));
    const diff = diffScope(base, head);
    assert.deepEqual(diff.changedItems.map((i) => i.text), ['Next', 'Third changed']);
    assert.deepEqual(diff.citedRows, ['C-2']);
    assert.deepEqual(diff.rowsChanged, ['C-2']);
  });

  it('treats a changed tag as a change, and a row whose hashed fields changed as changed', () => {
    const base = tree('- [x] Old item. [C-1]\n', baseReg);
    const head = tree('- [x] Old item. [C-3]\n', register([row('C-1', 'Old item.', { checks: [['gh', 'pr', 'view', '2']] }), row('C-3', 'Old item.')]));
    const diff = diffScope(base, head);
    assert.equal(diff.changedItems.length, 1);
    assert.deepEqual(diff.rowsChanged, ['C-1', 'C-3']);
    assert.deepEqual(diff.citedRows, ['C-3']);
  });

  it('reports a reworded item by its base line number', () => {
    const base = tree('# P\n\n- [ ] First\n- [ ] Second\n', baseReg);
    const head = tree('# P\n\n- [ ] First\n- [ ] Second, reworded\n', baseReg);
    assert.deepEqual(diffScope(base, head).removedOrReworded, [{ file: 'docs/plans/p.md', baseLine: 4, text: 'Second' }]);
  });

  it('reports a removed item and a deleted plan file, and not a tick alone', () => {
    const base = { plans: [{ file: 'docs/plans/p.md', source: '- [ ] Keep\n- [ ] Drop\n' }, { file: 'docs/plans/q.md', source: '- [ ] Q\n' }], registerText: baseReg };
    const head = { plans: [{ file: 'docs/plans/p.md', source: '- [x] Keep [C-1]\n' }], registerText: baseReg };
    const diff = diffScope(base, head);
    assert.deepEqual(diff.removedOrReworded.map((r) => r.text), ['Drop']);
    assert.deepEqual(diff.deletedPlanFiles, ['docs/plans/q.md']);
  });

  it('reads an unparseable register as having no rows', () => {
    const diff = diffScope(tree('', '{'), tree('', register([row('C-1', 'x')])));
    assert.deepEqual(diff.rowsChanged, ['C-1']);
  });
});

// ---------------------------------------------------------------------------
// Real git: the diff base
// ---------------------------------------------------------------------------

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claims-boxes-'));
  scratch.push(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'test@example.invalid');
  sh(dir, 'config', 'user.name', 'test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  mkdirSync(path.join(dir, '.github', 'rulesets'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'plans', 'p.md'), '## S (0/1)\n- [ ] Item\n');
  writeFileSync(path.join(dir, 'docs', 'claims.json'), register([]));
  writeFileSync(path.join(dir, '.github', 'rulesets', 'main.json'), JSON.stringify({ rules: [{ type: 'merge_queue', parameters: { merge_method: 'SQUASH' } }] }));
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

describe('the diff base, in real repositories', () => {
  it('fails loudly in a depth-1 clone', () => {
    const origin = makeRepo();
    writeFileSync(path.join(origin, 'x.txt'), 'x');
    sh(origin, 'add', '-A');
    sh(origin, 'commit', '-q', '-m', 'two');
    const clone = mkdtempSync(path.join(os.tmpdir(), 'claims-shallow-'));
    scratch.push(clone);
    sh(clone, 'clone', '-q', '--depth', '1', pathToFileURL(origin).href, '.');
    assert.throws(() => resolveBase('pull_request', { cwd: clone }), /shallow; the diff needs full history/);
  });

  it('diffs a pull request against its merge base with origin/main', () => {
    const origin = makeRepo();
    const clone = mkdtempSync(path.join(os.tmpdir(), 'claims-full-'));
    scratch.push(clone);
    sh(clone, 'clone', '-q', pathToFileURL(origin).href, '.');
    const base = sh(clone, 'rev-parse', 'HEAD');
    sh(clone, 'config', 'user.email', 'test@example.invalid');
    sh(clone, 'config', 'user.name', 'test');
    sh(clone, 'config', 'commit.gpgsign', 'false');
    sh(clone, 'checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(clone, 'docs', 'plans', 'p.md'), '## S (0/1)\n- [ ] Item reworded\n');
    sh(clone, 'commit', '-q', '-am', 'change');
    assert.equal(resolveBase('pull_request', { cwd: clone }), base);
    const diff = diffScope(readCommit(base, { cwd: clone }), readWorkingTree({ cwd: clone }));
    assert.deepEqual(diff.removedOrReworded, [{ file: 'docs/plans/p.md', baseLine: 2, text: 'Item' }]);

    const lines = [];
    assert.equal(main(['--mode', 'pull_request', '--json'], { cwd: clone, log: (l) => lines.push(l) }), 0);
    assert.equal(JSON.parse(lines.join('\n')).diff.removedOrReworded.length, 1);
    const text = [];
    main(['--mode', 'pull_request'], { cwd: clone, log: (l) => text.push(l) });
    assert.ok(text.some((l) => /removed or reworded: docs\/plans\/p.md:2/.test(l)));
    assert.throws(() => main(['--bogus'], { cwd: clone }), /unrecognised/);
  });

  it('diffs a merge-queue commit against its one parent, and refuses the wrong shape', () => {
    const repo = makeRepo();
    const parent = sh(repo, 'rev-parse', 'HEAD');
    writeFileSync(path.join(repo, 'y.txt'), 'y');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'queued');
    assert.equal(resolveBase('merge_group', { cwd: repo }), parent);
    assert.throws(
      () => resolveBase('merge_group', { cwd: repo, rulesetText: JSON.stringify({ rules: [{ type: 'merge_queue', parameters: { merge_method: 'MERGE' } }] }) }),
      /not SQUASH/,
    );
    sh(repo, 'checkout', '-q', '-b', 'side', parent);
    writeFileSync(path.join(repo, 'z.txt'), 'z');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'side');
    sh(repo, 'merge', '-q', '--no-ff', '--no-edit', 'main');
    assert.throws(() => resolveBase('merge_group', { cwd: repo }), /2 parents/);
    assert.throws(() => resolveBase('push', { cwd: repo }), /no diff base/);
  });

  it('reports structure from the working tree and exits 1 on an error', () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, 'docs', 'plans', 'p.md'), '## S (1/1)\n- [x] Item\n');
    const lines = [];
    assert.equal(main([], { cwd: repo, log: (l) => lines.push(l) }), 1);
    assert.ok(lines.some((l) => /exactly one \[C-nn\] tag/.test(l)));
  });
});
