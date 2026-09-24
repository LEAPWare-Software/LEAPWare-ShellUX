/**
 * Tests for scripts/claims/pr-evidence.mjs, the PR evidence gate (§3.3).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { defaultRunner } from '../claims/lib.mjs';
import { checkBody, gate, hasBotMergeComment, isGateFile, isVerifiedDependabot, parseArgs, registerSchemaChanged, sections } from '../claims/pr-evidence.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const body = (overrides = {}) => {
  const parts = {
    evidence: '## Evidence\n\n```text\n...\n```\nVERIFY_EXIT=0\n',
    notDone: '## Not done\n\n- The browser lane was not run.\n',
    review: `## Review\n\nReviewer: lw-verifier (sonnet)\nReviewed SHA: ${SHA}\nVerdict: MERGE\nRows reviewed: C-01, C-02\nItems removed or reworded: docs/plans/v1-production.md:108\nGate changes: scripts/claims/lib.mjs\n`,
    ...overrides,
  };
  return [parts.evidence, parts.notDone, parts.review].join('\n');
};
const context = { headSha: SHA, requiredRows: ['C-01', 'C-02'], removedOrReworded: [{ file: 'docs/plans/v1-production.md', baseLine: 108 }], gateFiles: ['scripts/claims/lib.mjs'] };

describe('the PR evidence gate (§3.3)', () => {
  it('passes a body that carries every field', () => {
    assert.deepEqual(checkBody(body(), context), []);
  });

  it('fails without ## Evidence or without its VERIFY_EXIT=0 line', () => {
    assert.ok(checkBody(body({ evidence: '' }), context).includes('missing "## Evidence"'));
    assert.ok(checkBody(body({ evidence: '## Evidence\nVERIFY_EXIT=1\n' }), context).some((f) => /no line VERIFY_EXIT=0/.test(f)));
    assert.ok(checkBody(body({ evidence: '## Evidence\nsee VERIFY_EXIT=0 below\n' }), context).some((f) => /no line/.test(f)));
    assert.deepEqual(checkBody(body({ evidence: '## Evidence\n**`VERIFY_EXIT=0`**\n' }), context), []);
  });

  it('fails an empty or missing ## Not done', () => {
    assert.ok(checkBody(body({ notDone: '## Not done\n\n' }), context).includes('"## Not done" is empty'));
    assert.ok(checkBody(body({ notDone: '' }), context).includes('missing "## Not done"'));
  });

  it('fails a missing review record', () => {
    const failures = checkBody(body({ review: '' }), context);
    assert.ok(failures.includes('missing "## Review"'));
    assert.ok(failures.includes('missing "Rows reviewed:"'));
  });

  it('fails a body whose Reviewed SHA is not the head SHA', () => {
    const stale = body().replace(`Reviewed SHA: ${SHA}`, `Reviewed SHA: ${'f'.repeat(40)}`);
    assert.ok(checkBody(stale, context).some((f) => /is not the head SHA .* any push or rebase makes it stale/.test(f)));
    const short = body().replace(`Reviewed SHA: ${SHA}`, `Reviewed SHA: ${SHA.slice(0, 7)}`);
    assert.ok(checkBody(short, context).some((f) => /is not the head SHA/.test(f)));
  });

  it('fails a blank Reviewer, a missing Verdict, and a DO NOT MERGE verdict', () => {
    assert.ok(checkBody(body().replace('Reviewer: lw-verifier (sonnet)', 'Reviewer:'), context).includes('"## Review" has no Reviewer:'));
    assert.ok(checkBody(body().replace('Verdict: MERGE\n', ''), context).includes('"## Review" has no Verdict:'));
    assert.ok(checkBody(body().replace('Verdict: MERGE', 'Verdict: DO NOT MERGE'), context).includes('Verdict: is DO NOT MERGE'));
    assert.ok(checkBody(body().replace(`Reviewed SHA: ${SHA}\n`, ''), context).includes('"## Review" has no Reviewed SHA:'));
  });

  it('fails Rows reviewed that omits a row, and accepts "none" only when none is required', () => {
    assert.ok(checkBody(body().replace('Rows reviewed: C-01, C-02', 'Rows reviewed: C-01'), context).some((f) => /does not name C-02/.test(f)));
    const noRows = { ...context, requiredRows: [] };
    assert.deepEqual(checkBody(body().replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none'), noRows), []);
    assert.ok(checkBody(body().replace('Rows reviewed: C-01, C-02', 'Rows reviewed:'), noRows).some((f) => /write "none"/.test(f)));
    assert.ok(checkBody(body().replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none'), context).some((f) => /does not name C-01/.test(f)));
  });

  it('fails an unnamed removed or reworded item, and an unnamed deleted plan file', () => {
    assert.ok(checkBody(body().replace('docs/plans/v1-production.md:108', 'line 108'), context).some((f) => /does not name docs\/plans\/v1-production.md:108/.test(f)));
    assert.ok(checkBody(body().replace(/Items removed or reworded:.*\n/, ''), context).includes('missing "Items removed or reworded:"'));
    const deleted = { ...context, deletedPlanFiles: ['docs/plans/old.md'] };
    assert.ok(checkBody(body(), deleted).some((f) => /deleted or moved docs\/plans\/old.md/.test(f)));
  });

  it('compares names as exact tokens, never as substrings', () => {
    const at84 = { ...context, removedOrReworded: [{ file: 'docs/plans/v1-production.md', baseLine: 8 }] };
    assert.ok(checkBody(body().replace(':108', ':84'), at84).some((f) => /does not name docs\/plans\/v1-production.md:8$/.test(f)), '`:84` must not satisfy `:8`');
    assert.deepEqual(checkBody(body().replace(':108', ':84, docs/plans/v1-production.md:8.'), at84), []);
    const bak = body().replace('Gate changes: scripts/claims/lib.mjs', 'Gate changes: scripts/claims/lib.mjs.bak');
    assert.ok(checkBody(bak, context).some((f) => /Gate changes: does not name scripts\/claims\/lib.mjs/.test(f)), '`.bak` must not satisfy the file');
    const prefixed = body().replace('Gate changes: scripts/claims/lib.mjs', 'Gate changes: old-scripts/claims/lib.mjs');
    assert.ok(checkBody(prefixed, context).some((f) => /does not name scripts\/claims\/lib.mjs/.test(f)));
    const deleted = { ...context, deletedPlanFiles: ['docs/plans/old.md'] };
    assert.ok(checkBody(body().replace(':108', ':108 docs/plans/old.md.bak'), deleted).some((f) => /deleted or moved docs\/plans\/old.md/.test(f)));
    assert.ok(checkBody(body().replace('Rows reviewed: C-01, C-02', 'Rows reviewed: C-012, C-02'), context).some((f) => /does not name C-01/.test(f)));
  });

  it('fails a gate change that is not named', () => {
    assert.ok(checkBody(body().replace('Gate changes: scripts/claims/lib.mjs', 'Gate changes: none'), context).some((f) => /does not name scripts\/claims\/lib.mjs/.test(f)));
    assert.ok(checkBody(body().replace(/Gate changes:.*\n/, ''), context).includes('missing "Gate changes:"'));
  });

  it('does not let the template guidance in an HTML comment satisfy a field', () => {
    const commented = `<!--\nRows reviewed: C-01, C-02\nVERIFY_EXIT=0\n-->\n${body().replace('Rows reviewed: C-01, C-02\n', '')}`;
    assert.ok(checkBody(commented, context).includes('missing "Rows reviewed:"'));
    assert.equal(sections('<!-- ## Evidence -->\n## Not done\nx').has('evidence'), false);
  });
});

describe('what counts as a gate change', () => {
  it('names the gate files of §3.3', () => {
    for (const f of ['scripts/claims/lib.mjs', 'scripts/claims/checks/a.mjs', '.github/workflows/claims.yml', '.github/workflows/pr-evidence.yml', '.github/rulesets/main.json']) {
      assert.equal(isGateFile(f), true, f);
    }
    for (const f of ['scripts/status.mjs', '.github/workflows/ci.yml', 'docs/claims.json']) assert.equal(isGateFile(f), false, f);
  });

  it('treats a register change as a schema change only outside its rows', () => {
    const a = JSON.stringify({ schemaVersion: 1, active: [], retired: [] });
    assert.equal(registerSchemaChanged(a, JSON.stringify({ schemaVersion: 1, active: [{ id: 'C-1' }], retired: [] })), false);
    assert.equal(registerSchemaChanged(a, JSON.stringify({ schemaVersion: 2, active: [], retired: [] })), true);
    assert.equal(registerSchemaChanged(a, '{'), true);
  });
});

describe('the Dependabot exemption', () => {
  const commit = (login, verified) => ({ author: { login }, commit: { verification: { verified } } });

  it('holds only when every commit is dependabot[bot] and verified', () => {
    assert.equal(isVerifiedDependabot([commit('dependabot[bot]', true), commit('dependabot[bot]', true)]), true);
    assert.equal(isVerifiedDependabot([commit('dependabot[bot]', true), commit('someone', true)]), false);
    assert.equal(isVerifiedDependabot([commit('dependabot[bot]', false)]), false);
    assert.equal(isVerifiedDependabot([]), false);
    assert.equal(isVerifiedDependabot(null), false);
  });
});

describe('the claude[bot] merge comment (entry-point validation, not an integrity control)', () => {
  const botComment = (overrides = {}) => ({
    user: { login: 'claude[bot]' },
    body: `Claude review: No findings\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`,
    created_at: '2026-09-19T10:00:00Z',
    ...overrides,
  });

  it('fails when there is no claude[bot] comment at all', () => {
    assert.equal(hasBotMergeComment([], SHA), false);
    assert.equal(hasBotMergeComment([{ user: { login: 'someone' }, body: 'unrelated', created_at: '2026-09-19T10:00:00Z' }], SHA), false);
  });

  it('fails a claude[bot] comment at a stale SHA', () => {
    const stale = botComment({ body: `Claude review: No findings\nReviewed SHA: ${'f'.repeat(40)}\nVerdict: MERGE\n` });
    assert.equal(hasBotMergeComment([stale], SHA), false);
  });

  it('fails a claude[bot] comment at the head SHA with Verdict: MERGE WITH FIXES, because only a clean MERGE opens the gate', () => {
    const fixes = botComment({ body: `Claude review: one nit\nReviewed SHA: ${SHA}\nVerdict: MERGE WITH FIXES\n` });
    assert.equal(hasBotMergeComment([fixes], SHA), false);
  });

  it('fails a comment with the right SHA and Verdict: MERGE when it is authored by LEAPWare-HQ impersonating the format, not claude[bot]', () => {
    const impersonated = botComment({ user: { login: 'LEAPWare-HQ' } });
    assert.equal(hasBotMergeComment([impersonated], SHA), false);
  });

  it('passes a genuine claude[bot] comment at the head SHA with a clean Verdict: MERGE', () => {
    assert.equal(hasBotMergeComment([botComment()], SHA), true);
  });

  it('compares the SHA case-insensitively, like the body check', () => {
    const upper = botComment({ body: `Claude review: No findings\nReviewed SHA: ${SHA.toUpperCase()}\nVerdict: MERGE\n` });
    assert.equal(hasBotMergeComment([upper], SHA), true);
  });

  it('finds the genuine comment among other, unrelated comments', () => {
    const other = { user: { login: 'someone' }, body: 'unrelated comment', created_at: '2026-09-19T09:00:00Z' };
    assert.equal(hasBotMergeComment([other, botComment()], SHA), true);
  });

  it('fails a single comment body with two genuine, line-anchored Verdict: pairs whose real, final verdict is DO NOT MERGE, even though an earlier pair said Verdict: MERGE', () => {
    // Both pairs independently match field()'s `^...Verdict:` pattern (unlike a
    // mid-sentence quote, which matches neither the buggy nor the fixed parser and so
    // cannot discriminate between them — reproduced by reverting hasBotMergeComment to
    // call field() instead of lastField() and confirming a prior version of this
    // fixture still passed).
    const quoting = botComment({
      body: [
        'Claude review: first pass, nothing blocking.',
        '',
        `Reviewed SHA: ${SHA}`,
        'Verdict: MERGE',
        '',
        'On closer inspection I found a real defect and am revising my verdict.',
        '',
        `Reviewed SHA: ${SHA}`,
        'Verdict: DO NOT MERGE',
        '',
      ].join('\n'),
    });
    assert.equal(hasBotMergeComment([quoting], SHA), false);
  });

  it('fails when an earlier claude[bot] comment said Verdict: MERGE at the head SHA but a later claude[bot] comment at the same SHA retracts it with Verdict: DO NOT MERGE', () => {
    const earlierMerge = botComment({ created_at: '2026-09-19T10:00:00Z' });
    const laterRetraction = botComment({
      body: `Claude review: on further review I am retracting my earlier MERGE.\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`,
      created_at: '2026-09-19T11:00:00Z',
    });
    assert.equal(hasBotMergeComment([earlierMerge, laterRetraction], SHA), false);
  });

  it('passes when an earlier claude[bot] comment said Verdict: DO NOT MERGE but a later claude[bot] comment at the head SHA gives a genuine Verdict: MERGE', () => {
    const earlierReject = botComment({
      body: `Claude review: findings to fix.\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`,
      created_at: '2026-09-19T10:00:00Z',
    });
    const laterApproval = botComment({
      body: `Claude review: fixes applied and verified.\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`,
      created_at: '2026-09-19T11:00:00Z',
    });
    assert.equal(hasBotMergeComment([earlierReject, laterApproval], SHA), true);
  });

  it('resolves the latest comment by created_at, not by its position in the input array', () => {
    const laterRetraction = botComment({
      body: `Claude review: retracting.\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`,
      created_at: '2026-09-19T11:00:00Z',
    });
    const earlierMerge = botComment({ created_at: '2026-09-19T10:00:00Z' });
    // laterRetraction appears FIRST in the array, despite its later created_at.
    assert.equal(hasBotMergeComment([laterRetraction, earlierMerge], SHA), false);

    const earlierReject = botComment({
      body: `Claude review: findings to fix.\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`,
      created_at: '2026-09-19T10:00:00Z',
    });
    const laterApproval = botComment({ created_at: '2026-09-19T11:00:00Z' });
    // laterApproval appears FIRST in the array, despite being the later comment.
    assert.equal(hasBotMergeComment([laterApproval, earlierReject], SHA), true);
  });
});

describe('arguments', () => {
  it('requires an event it knows', () => {
    assert.deepEqual(parseArgs(['--event', 'pull_request', '--pr', '5']), { event: 'pull_request', pr: '5', headRef: null });
    assert.equal(parseArgs(['--event', 'merge_group', '--head-ref', 'r']).headRef, 'r');
    assert.throws(() => parseArgs(['--event', 'push']), /must be pull_request or merge_group/);
    assert.throws(() => parseArgs(['--x']), /unrecognised/);
  });
});

// ---------------------------------------------------------------------------
// The whole gate, in a throwaway repository, with gh answered by a double
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

function project() {
  const origin = mkdtempSync(path.join(os.tmpdir(), 'claims-evidence-origin-'));
  scratch.push(origin);
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'test'], ['config', 'commit.gpgsign', 'false']]) sh(origin, ...args);
  mkdirSync(path.join(origin, 'docs', 'plans'), { recursive: true });
  mkdirSync(path.join(origin, 'scripts', 'claims'), { recursive: true });
  writeFileSync(path.join(origin, 'docs', 'plans', 'p.md'), '- [ ] First\n- [ ] Second\n');
  writeFileSync(path.join(origin, 'docs', 'claims.json'), JSON.stringify({ schemaVersion: 1, active: [], retired: [] }));
  writeFileSync(path.join(origin, 'scripts', 'claims', 'gate.mjs'), '// v1\n');
  sh(origin, 'add', '-A');
  sh(origin, 'commit', '-q', '-m', 'base');
  const clone = mkdtempSync(path.join(os.tmpdir(), 'claims-evidence-clone-'));
  scratch.push(clone);
  sh(clone, 'clone', '-q', pathToFileURL(origin).href, '.');
  for (const args of [['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'test'], ['config', 'commit.gpgsign', 'false']]) sh(clone, ...args);
  sh(clone, 'checkout', '-q', '-b', 'feature');
  writeFileSync(path.join(clone, 'docs', 'plans', 'p.md'), '- [ ] First\n- [ ] Second, reworded\n');
  writeFileSync(path.join(clone, 'scripts', 'claims', 'gate.mjs'), '// v2\n');
  sh(clone, 'commit', '-q', '-am', 'change');
  return clone;
}

const genuineMergeComment = [{ user: { login: 'claude[bot]' }, body: `Claude review: No findings\nReviewed SHA: ${SHA}\nVerdict: MERGE\n` }];

function ghDouble({ bodyText, commits, comments = genuineMergeComment }) {
  return (cmd, args, opts) => {
    if (cmd !== 'gh') return defaultRunner(cmd, args, opts);
    if (args.at(-1).endsWith('/commits')) {
      // --paginate --slurp: one array per page. Split so the flatten is exercised.
      assert.deepEqual(args.slice(0, 3), ['api', '--paginate', '--slurp']);
      return { status: 0, stdout: JSON.stringify([commits.slice(0, 1), commits.slice(1)]), stderr: '' };
    }
    if (args.at(-1).endsWith('/comments')) {
      assert.deepEqual(args.slice(0, 3), ['api', '--paginate', '--slurp']);
      return { status: 0, stdout: JSON.stringify([comments]), stderr: '' };
    }
    return { status: 0, stdout: JSON.stringify({ head: { sha: SHA }, body: bodyText }), stderr: '' };
  };
}

describe('the gate end to end', () => {
  const human = [{ author: { login: 'someone' }, commit: { verification: { verified: true } } }];

  it('names what the diff requires, and fails a body that omits it', () => {
    const cwd = project();
    const lines = [];
    const code = gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: body().replace(/Items removed or reworded:.*\n/, '').replace(/Gate changes:.*\n/, ''), commits: human }), log: (l) => lines.push(l) });
    assert.equal(code, 1);
    assert.ok(lines.some((l) => /missing "Items removed or reworded:"/.test(l)));
    assert.ok(lines.some((l) => /missing "Gate changes:"/.test(l)));
  });

  it('passes a body that names the reworded item and the gate file', () => {
    const cwd = project();
    const text = body().replace('docs/plans/v1-production.md:108', 'docs/plans/p.md:2').replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none').replace('scripts/claims/lib.mjs', 'scripts/claims/gate.mjs');
    const lines = [];
    assert.equal(gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: text, commits: human }), log: (l) => lines.push(l) }), 0, lines.join('\n'));
  });

  it('exempts a verified Dependabot pull request', () => {
    const cwd = project();
    const bot = [{ author: { login: 'dependabot[bot]' }, commit: { verification: { verified: true } } }];
    const lines = [];
    assert.equal(gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: '', commits: bot }), log: (l) => lines.push(l) }), 0);
    assert.ok(lines.some((l) => /dependabot\[bot\].*skipped/.test(l)));
  });

  it('fails at the gate when the body is otherwise complete but no claude[bot] MERGE comment exists at the head', () => {
    const cwd = project();
    const text = body().replace('docs/plans/v1-production.md:108', 'docs/plans/p.md:2').replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none').replace('scripts/claims/lib.mjs', 'scripts/claims/gate.mjs');
    const lines = [];
    const code = gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: text, commits: human, comments: [] }), log: (l) => lines.push(l) });
    assert.equal(code, 1);
    assert.ok(lines.some((l) => /no comment authored by claude\[bot\]/.test(l)));
  });

  it('passes the gate end to end once the body and a genuine claude[bot] MERGE comment both hold', () => {
    const cwd = project();
    const text = body().replace('docs/plans/v1-production.md:108', 'docs/plans/p.md:2').replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none').replace('scripts/claims/lib.mjs', 'scripts/claims/gate.mjs');
    const lines = [];
    const code = gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: text, commits: human }), log: (l) => lines.push(l) });
    assert.equal(code, 0, lines.join('\n'));
  });

  it('fails when a merge-queue ref names no pull request, and when a pull request number is missing', () => {
    assert.throws(() => gate({ event: 'merge_group', headRef: 'refs/heads/main', repo: 'o/r' }), /cannot resolve/);
    assert.throws(() => gate({ event: 'pull_request', pr: undefined, repo: 'o/r' }), /no pull request number/);
  });
});
