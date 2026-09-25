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
  const STALE = 'f'.repeat(40);
  const t = (n) => `2026-09-${String(20 + n).padStart(2, '0')}T00:00:00Z`;
  const comment = (body, { login = 'claude[bot]', created_at = t(1) } = {}) => ({ user: { login }, body, created_at });
  const genuine = (verdict, { sha = SHA } = {}) => `Claude review:\n\nReviewed SHA: ${sha}\nVerdict: ${verdict}\n`;

  it('has no comment at all, or only an unrelated non-bot comment: false', () => {
    assert.equal(hasBotMergeComment([], SHA), false);
    assert.equal(hasBotMergeComment([comment('just chatting', { login: 'someone' })], SHA), false);
  });

  it('a claude[bot] comment at a stale (non-head) SHA: false', () => {
    assert.equal(hasBotMergeComment([comment(genuine('MERGE', { sha: STALE }))], SHA), false);
  });

  it('only a clean MERGE opens the gate, not MERGE WITH FIXES', () => {
    assert.equal(hasBotMergeComment([comment(genuine('MERGE WITH FIXES'))], SHA), false);
  });

  it('the right SHA and Verdict: MERGE, but authored by LEAPWare-HQ impersonating the format: false', () => {
    assert.equal(hasBotMergeComment([comment(genuine('MERGE'), { login: 'LEAPWare-HQ' })], SHA), false);
  });

  it('a genuine claude[bot] comment at the head SHA with Verdict: MERGE: true', () => {
    assert.equal(hasBotMergeComment([comment(genuine('MERGE'))], SHA), true);
  });

  it('SHA comparison is case-insensitive', () => {
    assert.equal(hasBotMergeComment([comment(genuine('MERGE', { sha: SHA.toUpperCase() }))], SHA), true);
  });

  it('is found among other unrelated comments', () => {
    const comments = [comment('unrelated', { login: 'someone' }), comment(genuine('MERGE')), comment('another one', { login: 'other-bot' })];
    assert.equal(hasBotMergeComment(comments, SHA), true);
  });

  it('F7: an unrelated later claude[bot] reply must not hide a genuine earlier MERGE', () => {
    const comments = [
      comment(genuine('MERGE'), { created_at: t(1) }),
      comment('Sure, happy to help with that question!', { created_at: t(2) }),
    ];
    assert.equal(hasBotMergeComment(comments, SHA), true);
  });

  it('a genuine MERGE retracted by a later, review-shaped DO NOT MERGE at the same SHA: false', () => {
    const comments = [comment(genuine('MERGE'), { created_at: t(1) }), comment(genuine('DO NOT MERGE'), { created_at: t(2) })];
    assert.equal(hasBotMergeComment(comments, SHA), false);
  });

  it('the mirror case: an earlier rejection followed by a later genuine MERGE is honoured', () => {
    const comments = [comment(genuine('DO NOT MERGE'), { created_at: t(1) }), comment(genuine('MERGE'), { created_at: t(2) })];
    assert.equal(hasBotMergeComment(comments, SHA), true);
  });

  it('resolution is by created_at, not array position', () => {
    const comments = [comment(genuine('MERGE'), { created_at: t(2) }), comment(genuine('DO NOT MERGE'), { created_at: t(1) })];
    assert.equal(hasBotMergeComment(comments, SHA), true, 'the later-by-time MERGE, even though it appears first in the array, must govern');
  });

  it('markup-tolerant openers: bold and heading genuine MERGE comments still govern', () => {
    assert.equal(hasBotMergeComment([comment(`**Claude review:**\n\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`)], SHA), true);
    assert.equal(hasBotMergeComment([comment(`## Claude Review\n\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`)], SHA), true);
  });

  it('markup-tolerant openers: bold, heading and bare-verdict retractions are still review-shaped and win', () => {
    const bold = [comment(genuine('MERGE'), { created_at: t(1) }), comment(`**Claude review:**\n\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`, { created_at: t(2) })];
    assert.equal(hasBotMergeComment(bold, SHA), false, 'bold opener retraction must not be skipped for lacking a literal "Claude review:" prefix');

    const heading = [comment(genuine('MERGE'), { created_at: t(1) }), comment(`## Claude Review\n\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`, { created_at: t(2) })];
    assert.equal(hasBotMergeComment(heading, SHA), false, 'heading opener retraction must not be skipped');

    const bare = [comment(genuine('MERGE'), { created_at: t(1) }), comment(`Verdict: DO NOT MERGE\n`, { created_at: t(2) })];
    assert.equal(hasBotMergeComment(bare, SHA), false, 'a bare line-anchored Verdict: line alone must count as review-shaped');
  });

  it('within one comment, the LAST Reviewed SHA:/Verdict: pair wins, not the first', () => {
    const body = `Claude review:\n\nReviewed SHA: ${SHA}\nVerdict: MERGE\n\n(revised)\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`;
    assert.equal(hasBotMergeComment([comment(body)], SHA), false);
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

const GENUINE_MERGE_COMMENT = [{ user: { login: 'claude[bot]' }, body: `Claude review:\n\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`, created_at: '2026-09-20T00:00:00Z' }];

function ghDouble({ bodyText, commits, comments = GENUINE_MERGE_COMMENT }) {
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

  it('fails when the body is otherwise complete but no comment carries the claude[bot] MERGE verdict', () => {
    const cwd = project();
    const text = body().replace('docs/plans/v1-production.md:108', 'docs/plans/p.md:2').replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none').replace('scripts/claims/lib.mjs', 'scripts/claims/gate.mjs');
    const lines = [];
    const code = gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: text, commits: human, comments: [] }), log: (l) => lines.push(l) });
    assert.equal(code, 1);
    assert.ok(lines.some((l) => /no comment authored by claude\[bot\]/.test(l)));
  });

  it('passes when the body is complete AND a genuine claude[bot] MERGE comment is present', () => {
    const cwd = project();
    const text = body().replace('docs/plans/v1-production.md:108', 'docs/plans/p.md:2').replace('Rows reviewed: C-01, C-02', 'Rows reviewed: none').replace('scripts/claims/lib.mjs', 'scripts/claims/gate.mjs');
    const lines = [];
    assert.equal(gate({ event: 'pull_request', pr: '7', repo: 'o/r', cwd, run: ghDouble({ bodyText: text, commits: human, comments: GENUINE_MERGE_COMMENT }), log: (l) => lines.push(l) }), 0, lines.join('\n'));
  });

  it('fails when a merge-queue ref names no pull request, and when a pull request number is missing', () => {
    assert.throws(() => gate({ event: 'merge_group', headRef: 'refs/heads/main', repo: 'o/r' }), /cannot resolve/);
    assert.throws(() => gate({ event: 'pull_request', pr: undefined, repo: 'o/r' }), /no pull request number/);
  });
});
