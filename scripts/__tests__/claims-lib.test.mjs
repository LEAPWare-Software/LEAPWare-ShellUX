/**
 * Tests for scripts/claims/lib.mjs: the argv allowlist, expectations, rowHash, register
 * validation, probes and the small GitHub helpers. No network, no token: every process
 * is an injected runner.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  annotation,
  applyProbe,
  assertRestrictionWorks,
  canonicalJson,
  commandFor,
  networkRestriction,
  evaluateExpect,
  formatExpectation,
  hasToken,
  parseKeyValues,
  prNumberFromQueueRef,
  rowHash,
  runRow,
  toNumber,
  validateArgv,
  validateProbe,
  validateRegister,
} from '../claims/lib.mjs';

const ok = (argv, cls) => assert.equal(validateArgv(argv, cls), null, `${JSON.stringify(argv)} should be allowed`);
const no = (argv, cls, pattern) => {
  const reason = validateArgv(argv, cls);
  assert.ok(reason, `${JSON.stringify(argv)} should be rejected`);
  if (pattern) assert.match(reason, pattern);
};

describe('the argv allowlist (§3.1)', () => {
  it('allows the shapes the register uses', () => {
    ok(['node', 'scripts/claims/checks/context-caps.mjs'], 'repo');
    ok(['node', 'scripts/claims/checks/x.mjs', '--flag', 'arg'], 'repo');
    ok(['git', 'ls-files', '--', 'docs'], 'repo');
    ok(['git', 'grep', '-n', 'TODO'], 'repo');
    ok(['git', 'diff', '--stat', 'HEAD~1'], 'repo');
    ok(['gh', 'api', 'repos/o/r/pulls/12', '--jq', '.state'], 'github');
    ok(['gh', 'api', '/repos/o/r/rulesets/5', '--jq=.name'], 'github');
    ok(['gh', 'api', 'repos/o/r/commits/abcdef1', '--method', 'GET'], 'github');
    ok(['gh', 'api', 'repos/o/r', '--method=GET'], 'github');
    ok(['gh', 'pr', 'view', '115', '--json', 'state', '--jq', '.state'], 'github');
    ok(['gh', 'run', 'view', '99', '--json=conclusion'], 'github');
    ok(['gh', 'issue', 'view', '146', '--jq=.number'], 'github');
  });

  it('rejects every form the allowlist names', () => {
    // node: path outside checks/, escapes, eval-style first arguments
    no(['node', 'scripts/check-citations.mjs'], 'repo', /not under/);
    no(['node', 'scripts/claims/checks/../../check-citations.mjs'], 'repo', /not under/);
    no(['node', '/abs/scripts/claims/checks/x.mjs'], 'repo', /relative/);
    // Built at run time: a drive-letter literal in a tracked file is what check:portability forbids.
    no(['node', `${'C'}:/scripts/claims/checks/x.mjs`], 'repo', /relative/);
    no(['node', 'scripts\\claims\\checks\\x.mjs'], 'repo', /forward slashes/);
    for (const flag of ['-e', '--eval', '-p', '--print', '--import', '--require', '-r']) {
      no(['node', flag, 'scripts/claims/checks/x.mjs'], 'repo', /rejected/);
    }
    no(['node'], 'repo', /script path/);
    // git: subcommands and dangerous options, split and joined
    no(['git', 'ls-remote', 'origin'], 'repo', /subcommand/);
    no(['git', 'log'], 'repo', /subcommand/);
    no(['git', '-c', 'core.pager=x', 'show'], 'repo', /subcommand/);
    for (const bad of ['-c', '-C', '-O', '-Oless', '-C3', '--git-dir', '--git-dir=x', '--work-tree=y', '--exec-path', '--ext-diff', '--output', '--output=f', '--open-files-in-pager']) {
      no(['git', 'grep', bad, 'x'], 'repo', /rejected/);
    }
    // Abbreviated long options: git accepts any unambiguous prefix, so `--open=CMD` is
    // `--open-files-in-pager=CMD` and runs CMD. Reproduced in review; each must be refused.
    for (const bad of ['--open=echo PWNED', '--open-files=echo PWNED', '--open-files-in=x', '--ext', '--ext-d', '--textc', '--textconv', '--outp=f', '--git-d=x', '--work-t=y', '--exec=x']) {
      no(['git', 'grep', bad, 'x'], 'repo', /rejected/);
      no(['git', 'diff', bad, 'HEAD'], 'repo', /rejected/);
    }
    // A flag allowed for one subcommand is not allowed for another.
    no(['git', 'ls-files', '-e', 'x'], 'repo', /rejected/);
    // A value after -e is a pattern, not a flag; everything after -- is a path.
    ok(['git', 'grep', '-e', '--open=looks-like-a-flag', '--', 'docs'], 'repo');
    ok(['git', 'ls-files', '--', '--open=a-path-name'], 'repo');
    // gh api: methods, fields, input, paginate, graphql, list endpoints, flag order
    no(['gh', 'api', 'repos/o/r/pulls/1', '-X', 'POST'], 'github', /-X/);
    no(['gh', 'api', 'repos/o/r/pulls/1', '-XPOST'], 'github', /-X/);
    no(['gh', 'api', 'repos/o/r/pulls/1', '-XGET'], 'github', /-X/);
    no(['gh', 'api', 'repos/o/r/pulls/1', '--method', 'POST'], 'github', /only GET/);
    no(['gh', 'api', 'repos/o/r/pulls/1', '--method=PATCH'], 'github', /only GET/);
    for (const flag of ['-f', '-F', '--field', '--raw-field', '--input', '--paginate']) {
      no(['gh', 'api', 'repos/o/r/pulls/1', flag, 'a=b'], 'github', /rejected/);
    }
    no(['gh', 'api', 'graphql', '--jq', '.'], 'github', /graphql/);
    no(['gh', 'api', '/graphql'], 'github', /graphql/);
    no(['gh', 'api', '-XPOST', 'repos/o/r/pulls/1'], 'github', /path must come first/);
    no(['gh', 'api', 'repos/o/r/pulls'], 'github', /single-object/);
    no(['gh', 'api', 'repos/o/r/pulls/1/commits'], 'github', /single-object/);
    no(['gh', 'api', 'search/issues?q=x'], 'github', /single-object/);
    no(['gh', 'api', 'repos/o/r/pulls/1', '--jq'], 'github', /needs an expression/);
    // The repository's own single-object settings resource is accepted; a list under it is not.
    ok(['gh', 'api', 'repos/o/r/private-vulnerability-reporting', '--jq', '.enabled'], 'github');
    no(['gh', 'api', 'repos/o/r/private-vulnerability-reporting/advisories'], 'github', /single-object/);
    // A milestone is a single object by number; a bare milestones list stays rejected.
    ok(['gh', 'api', 'repos/o/r/milestones/2', '--jq', '.title'], 'github');
    no(['gh', 'api', 'repos/o/r/milestones'], 'github', /single-object/);
    // C-25's one search exception: pinned to this exact repo and this exact read-only
    // query. GET only (the allowlist forbids -X/--method other than GET regardless).
    ok(['gh', 'api', 'search/issues?q=repo:LEAPWare-Software/LEAPWare-ShellUX+is:issue+is:open+no:milestone', '--jq', '"unmilestoned_open_issues=\\(.total_count)"'], 'github');
    // Every sibling and unrelated search/issues path is still rejected: a different repo,
    // a different query, and a bare list-issues endpoint on the same repo.
    no(['gh', 'api', 'search/issues?q=repo:someone-else/other+is:issue+is:open+no:milestone'], 'github', /single-object/);
    no(['gh', 'api', 'search/issues?q=repo:LEAPWare-Software/LEAPWare-ShellUX+is:pr+is:open'], 'github', /single-object/);
    no(['gh', 'api', 'search/issues?q=x'], 'github', /single-object/);
    no(['gh', 'api', 'repos/LEAPWare-Software/LEAPWare-ShellUX/issues'], 'github', /single-object/);
    // The mutation guardrail is not weakened by the new path: -X/--method/-f/--paginate
    // are still rejected on it, exactly as on every other gh api path.
    no(['gh', 'api', 'search/issues?q=repo:LEAPWare-Software/LEAPWare-ShellUX+is:issue+is:open+no:milestone', '-X', 'POST'], 'github', /-X/);
    no(['gh', 'api', 'search/issues?q=repo:LEAPWare-Software/LEAPWare-ShellUX+is:issue+is:open+no:milestone', '-f', 'q=x'], 'github', /rejected/);
    // gh views: verbs, ids, flags
    no(['gh', 'pr', 'list'], 'github', /only "view"/);
    no(['gh', 'pr', 'view', 'abc'], 'github', /number/);
    no(['gh', 'pr', 'view', '1', '--web'], 'github', /rejected/);
    no(['gh', 'pr', 'view', '1', '--json'], 'github', /needs a value/);
    no(['gh', 'repo', 'view'], 'github', /not allowed/);
    // class boundaries
    no(['gh', 'api', 'repos/o/r'], 'repo', /github rows only/);
    no(['node', 'scripts/claims/checks/x.mjs'], 'github', /repo rows only/);
    no(['git', 'show', 'HEAD'], 'github', /repo rows only/);
    no(['curl', 'x'], 'repo', /not allowed/);
    // the three forbidden words, anywhere
    no(['node', 'scripts/claims/checks/verify.mjs'], 'repo', /verify/);
    no(['git', 'grep', 'test:coverage'], 'repo', /test:coverage/);
    no(['gh', 'api', 'repos/o/r', '--jq', 'test:browser'], 'github', /test:browser/);
    // malformed
    no([], 'repo', /non-empty/);
    no('node x', 'repo', /non-empty/);
  });
});

describe('expectations (G2)', () => {
  it('reads key=value lines and ignores everything else', () => {
    const map = parseKeyValues('a=1\nnoise\nb = x\nc=two words\r\na=2\n');
    assert.deepEqual(map.get('a'), ['1', '2']);
    assert.deepEqual(map.get('c'), ['two words']);
    assert.equal(map.has('b '), false);
  });

  it('strips thousands separators before comparing numbers', () => {
    assert.equal(toNumber('2,137'), 2137);
    assert.equal(toNumber('1 000'), 1000);
    assert.equal(toNumber(`12${String.fromCharCode(0xa0)}345`), 12345);
    assert.equal(toNumber('3.5'), 3.5);
    assert.ok(Number.isNaN(toNumber('twelve')));
  });

  it('evaluates every op, and a string only with ==', () => {
    const out = 'n=10\ns=MERGED\n';
    const cases = [
      ['==', 10, true],
      ['==', 11, false],
      ['<=', 10, true],
      ['<=', 9, false],
      ['>=', 10, true],
      ['>=', 11, false],
      ['<', 11, true],
      ['<', 10, false],
      ['>', 9, true],
      ['>', 10, false],
    ];
    for (const [op, value, pass] of cases) {
      assert.equal(evaluateExpect([{ key: 'n', op, value }], out)[0].pass, pass, `n ${op} ${value}`);
    }
    assert.equal(evaluateExpect([{ key: 's', op: '==', value: 'MERGED' }], out)[0].pass, true);
    assert.equal(evaluateExpect([{ key: 's', op: '==', value: 'OPEN' }], out)[0].pass, false);
    assert.equal(evaluateExpect([{ key: 'n', op: '~', value: 1 }], out)[0].pass, false);
  });

  it('fails a key printed zero times or twice', () => {
    const [absent] = evaluateExpect([{ key: 'k', op: '==', value: 1 }], 'other=1\n');
    assert.equal(absent.pass, false);
    assert.match(absent.reason, /printed 0 times/);
    const [twice] = evaluateExpect([{ key: 'k', op: '==', value: 1 }], 'k=1\nk=1\n');
    assert.equal(twice.pass, false);
    assert.match(twice.reason, /printed 2 times/);
  });

  it('fails a bound that is exceeded, and a non-number where a number is expected', () => {
    assert.equal(evaluateExpect([{ key: 'bytes', op: '<=', value: 3000 }], 'bytes=3,001\n')[0].pass, false);
    const [nan] = evaluateExpect([{ key: 'bytes', op: '<=', value: 3000 }], 'bytes=many\n');
    assert.match(nan.reason, /not a number/);
  });

  it('formats a measured expectation for status', () => {
    assert.equal(formatExpectation({ key: 'handoff_bytes', op: '<=', value: 3000, actual: 1928 }), 'handoff_bytes=1928 <= 3000');
    assert.equal(formatExpectation({ key: 's', op: '==', value: 'X', actual: null }), 's=(absent) == "X"');
  });
});

describe('rowHash (§3.1, X2)', () => {
  const row = { id: 'C-1', box: 'b', class: 'repo', checks: [['node', 'scripts/claims/checks/a.mjs']], expect: [{ key: 'k', op: '==', value: 1 }], probe: { name: 'p', edits: [{ file: 'f', pad: 1 }] }, provenOn: '2026-09-18', addedBy: 'x' };

  it('ignores key order and the fields outside the hashed five', () => {
    const reordered = { addedBy: 'y', provenOn: '2020-01-01', probe: { edits: [{ pad: 1, file: 'f' }], name: 'p' }, expect: [{ value: 1, op: '==', key: 'k' }], checks: row.checks, class: 'repo', box: 'b', id: 'C-2' };
    assert.equal(rowHash(reordered), rowHash(row));
  });

  it('changes when any hashed field changes', () => {
    const base = rowHash(row);
    for (const change of [{ box: 'c' }, { class: 'github' }, { checks: [] }, { expect: [] }, { probe: null }]) {
      assert.notEqual(rowHash({ ...row, ...change }), base, JSON.stringify(change));
    }
  });

  it('canonical JSON sorts keys at every depth', () => {
    assert.equal(canonicalJson({ b: [{ d: 1, c: 2 }], a: null }), '{"a":null,"b":[{"c":2,"d":1}]}');
  });
});

describe('register validation', () => {
  const good = {
    schemaVersion: 1,
    active: [
      { id: 'C-1', box: 'x', class: 'repo', checks: [['node', 'scripts/claims/checks/a.mjs']], expect: [{ key: 'k', op: '==', value: 1 }], probe: { name: 'p', edits: [{ file: 'a', pad: 1 }] }, provenOn: '2026-09-18', addedBy: 'PR' },
      { id: 'C-2', box: 'y', class: 'github', checks: [['gh', 'pr', 'view', '1', '--json', 'state']], provenOn: '2026-09-18', addedBy: 'PR' },
      { id: 'C-3', box: 'z', class: 'manual', evidence: 'docs/claims-evidence/e.txt', expect: [{ key: 'E', op: '==', value: 0 }], provenOn: '2026-09-18', addedBy: 'PR' },
    ],
    retired: [{ id: 'C-4', box: 'w', class: 'github', checks: [['gh', 'pr', 'view', '2']], provenOn: '2026-09-18', addedBy: 'PR', retiredBy: 'PR 9', reason: 'superseded' }],
  };
  const exists = () => true;

  it('accepts a well-formed register', () => {
    assert.deepEqual(validateRegister(good, exists), []);
  });

  it('rejects each malformed shape', () => {
    const bad = (mutate, pattern) => {
      const copy = structuredClone(good);
      mutate(copy);
      const errors = validateRegister(copy, exists);
      assert.ok(errors.some((e) => pattern.test(e.message)), `${pattern}: ${JSON.stringify(errors)}`);
    };
    bad((r) => (r.schemaVersion = 2), /schemaVersion/);
    bad((r) => (r.extra = 1), /unknown top-level/);
    bad((r) => (r.active[1].id = 'C-1'), /not unique/);
    bad((r) => (r.retired[0].id = 'C-1'), /not unique/);
    bad((r) => (r.active[0].id = 'X-1'), /C- plus digits/);
    bad((r) => (r.active[0].box = ' '), /box/);
    bad((r) => (r.active[0].class = 'other'), /class/);
    bad((r) => (r.active[0].provenOn = 'today'), /provenOn/);
    bad((r) => delete r.active[0].addedBy, /addedBy/);
    bad((r) => delete r.retired[0].reason, /retiredBy and reason/);
    bad((r) => (r.active[0].expect = {}), /expect must be an array/);
    bad((r) => (r.active[0].expect = [{ key: 'a b', op: '==', value: 1 }]), /malformed/);
    bad((r) => (r.active[0].expect = [{ key: 'k', op: '!=', value: 1 }]), /op/);
    bad((r) => (r.active[0].expect = [{ key: 'k', op: '<=', value: 'x' }]), /takes only ==/);
    bad((r) => (r.active[0].expect = [{ key: 'k', op: '==', value: true }]), /number or a string/);
    bad((r) => (r.active[0].checks = []), /non-empty/);
    bad((r) => (r.active[0].checks = [['node', 'x.mjs']]), /not under/);
    bad((r) => delete r.active[0].probe, /requires a probe/);
    bad((r) => (r.active[0].evidence = 'docs/claims-evidence/x'), /manual rows only/);
    bad((r) => (r.active[1].probe = { name: 'p', edits: [{ file: 'a', pad: 1 }] }), /repo rows only/);
    bad((r) => (r.active[2].checks = [['gh', 'pr', 'view', '1']]), /no checks/);
    bad((r) => (r.active[2].probe = {}), /no probe/);
    bad((r) => (r.active[2].evidence = 'elsewhere/e.txt'), /under docs\/claims-evidence/);
    assert.ok(validateRegister(good, () => false).some((e) => /is missing/.test(e.message)));
    assert.match(validateRegister(null)[0].message, /not an object/);
    assert.ok(validateRegister({ schemaVersion: 1, active: {}, retired: [] }).some((e) => /active must be an array/.test(e.message)));
  });
});

describe('probes', () => {
  it('validates each edit shape', () => {
    assert.equal(validateProbe({ name: 'p', edits: [{ file: 'a', append: 'x' }] }), null);
    assert.match(validateProbe(undefined), /requires a probe/);
    assert.match(validateProbe({ edits: [] }), /name/);
    assert.match(validateProbe({ name: 'p', edits: [] }), /non-empty/);
    assert.match(validateProbe({ name: 'p', edits: [{ file: '../x', pad: 1 }] }), /inside the tree/);
    assert.match(validateProbe({ name: 'p', edits: [{ file: 'a' }] }), /exactly one/);
    assert.match(validateProbe({ name: 'p', edits: [{ file: 'a', pad: 1, append: 'x' }] }), /exactly one/);
    assert.match(validateProbe({ name: 'p', edits: [{ file: 'a', replace: ['x'] }] }), /\[find, with\]/);
    assert.match(validateProbe({ name: 'p', edits: [{ file: 'a', pad: 0 }] }), /positive integer/);
  });

  it('applies append, pad, replace and delete, and refuses a replace that finds nothing', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claims-lib-'));
    try {
      writeFileSync(path.join(dir, 'a.txt'), 'one two one');
      writeFileSync(path.join(dir, 'b.txt'), 'b');
      applyProbe({ name: 'p', edits: [{ file: 'a.txt', replace: ['one', '1'] }, { file: 'a.txt', append: '!' }, { file: 'a.txt', pad: 3 }, { file: 'b.txt', delete: true }] }, dir);
      assert.equal(readFileSync(path.join(dir, 'a.txt'), 'utf8'), '1 two 1!xxx');
      assert.equal(existsSync(path.join(dir, 'b.txt')), false);
      assert.throws(() => applyProbe({ name: 'p', edits: [{ file: 'a.txt', replace: ['absent', 'x'] }] }, dir), /does not contain/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('running a row', () => {
  const fakeRun = (answers) => (cmd, args) => answers(cmd, args);

  it('concatenates check output and evaluates expect over it', () => {
    const row = { class: 'repo', checks: [['node', 'scripts/claims/checks/a.mjs'], ['git', 'rev-parse', 'HEAD']], expect: [{ key: 'a', op: '==', value: 1 }, { key: 'b', op: '==', value: 'x' }] };
    const run = fakeRun((cmd) => (cmd === 'git' ? { status: 0, stdout: 'b=x', stderr: '' } : { status: 0, stdout: 'a=1\n', stderr: '' }));
    const result = runRow(row, { run, now: () => 0 });
    assert.equal(result.pass, true);
    assert.equal(result.output, 'a=1\nb=x\n');
  });

  it('fails on a non-zero exit, a rejected argv and a failed expectation', () => {
    const run = fakeRun(() => ({ status: 3, stdout: 'a=2\n', stderr: 'boom' }));
    const result = runRow({ class: 'repo', checks: [['node', 'scripts/claims/checks/a.mjs'], ['curl', 'x']], expect: [{ key: 'a', op: '==', value: 1 }] }, { run });
    assert.equal(result.pass, false);
    assert.ok(result.failures.some((f) => /exited 3: boom/.test(f)));
    assert.ok(result.failures.some((f) => /rejected/.test(f)));
    assert.ok(result.failures.some((f) => /expectation failed/.test(f)));
  });
});

describe('the unshare wrapper (§3.1)', () => {
  it('is off unless CLAIMS_NET_RESTRICT=unshare', () => {
    assert.deepEqual(networkRestriction({}, 'linux'), { restricted: false });
  });

  it('refuses to run on a platform that is not Linux', () => {
    assert.throws(() => networkRestriction({ CLAIMS_NET_RESTRICT: 'unshare' }, 'win32'), /Linux only/);
  });

  it('wraps repo rows, and only repo rows, in sudo unshare --net', () => {
    const restrict = networkRestriction({ CLAIMS_NET_RESTRICT: 'unshare' }, 'linux', 'runner');
    assert.deepEqual(restrict.prefix, ['unshare', '--net', '--', 'sudo', '-u', 'runner', '-E']);
    const wrapped = commandFor(['git', 'grep', 'x'], 'repo', restrict);
    assert.equal(wrapped.cmd, 'sudo');
    assert.deepEqual(wrapped.args, ['unshare', '--net', '--', 'sudo', '-u', 'runner', '-E', 'git', 'grep', 'x']);
    assert.equal(commandFor(['node', 'scripts/claims/checks/a.mjs'], 'repo', restrict).args[7], process.execPath);
    assert.deepEqual(commandFor(['gh', 'pr', 'view', '1'], 'github', restrict), { cmd: 'gh', args: ['pr', 'view', '1'] });
  });

  it('fails the run when the wrapper does not work, never falling back', () => {
    const restrict = networkRestriction({ CLAIMS_NET_RESTRICT: 'unshare' }, 'linux', 'runner');
    assert.throws(() => assertRestrictionWorks(restrict, () => ({ status: 1, stdout: '', stderr: 'unshare: Operation not permitted' })), /refusing to run repo rows unrestricted/);
    assert.doesNotThrow(() => assertRestrictionWorks(restrict, () => ({ status: 0, stdout: '', stderr: '' })));
    assert.doesNotThrow(() => assertRestrictionWorks({ restricted: false }, () => assert.fail('not called')));
  });
});

describe('GitHub helpers', () => {
  it('parses the pull request number from a merge-queue ref, and fails when it cannot', () => {
    const sha = 'a'.repeat(40);
    assert.equal(prNumberFromQueueRef(`refs/heads/gh-readonly-queue/main/pr-151-${sha}`), 151);
    assert.equal(prNumberFromQueueRef(`gh-readonly-queue/main/pr-7-${sha}`), 7);
    assert.throws(() => prNumberFromQueueRef('refs/heads/feature'), /cannot resolve/);
    assert.throws(() => prNumberFromQueueRef(undefined), /cannot resolve/);
    assert.throws(() => prNumberFromQueueRef('refs/heads/gh-readonly-queue/main/pr-x-abc'), /cannot resolve/);
  });

  it('finds a token in the environment or from gh, and reports none otherwise', () => {
    assert.equal(hasToken({ GH_TOKEN: 't' }, () => assert.fail('not called')), true);
    assert.equal(hasToken({ GITHUB_TOKEN: 't' }, () => assert.fail('not called')), true);
    assert.equal(hasToken({}, () => ({ status: 0, stdout: 'gho_x\n', stderr: '' })), true);
    assert.equal(hasToken({}, () => ({ status: 1, stdout: '', stderr: 'not logged in' })), false);
  });

  it('escapes annotation messages', () => {
    assert.equal(annotation('warning', 'a%b\nc', 'f.md', 3), '::warning file=f.md,line=3::a%25b%0Ac');
    assert.equal(annotation('error', 'x'), '::error::x');
  });
});
