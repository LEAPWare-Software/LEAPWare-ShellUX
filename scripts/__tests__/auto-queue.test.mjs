/**
 * Tests for scripts/cloud/auto-queue.mjs: when a cloud-lane pull request may enter the
 * merge queue.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMergeVerdict, main, readiness, REVIEW_AUTHOR } from '../cloud/auto-queue.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const pr = (over = {}) => ({
  state: 'open', draft: false, labels: [{ name: 'lane-c' }], head: { sha: HEAD },
  body: `## Evidence\n\nVERIFY_EXIT=0\n\n## Review\n\nReviewer: shellux-cloud-reviewer\nReviewed SHA: ${HEAD}\nVerdict: MERGE\n`,
  ...over,
});
const review = (sha = HEAD, verdict = 'MERGE', { login = REVIEW_AUTHOR, at = '2026-09-19T13:00:00Z' } = {}) => ({
  user: { login }, created_at: at,
  body: `Reviewer: shellux-cloud-reviewer\nReviewed SHA: ${sha}\nVerdict: ${verdict}\n\nFindings: none.`,
});

describe('auto-queue readiness', () => {
  it('queues an open lane PR with a MERGE review comment at its head', () => {
    assert.deepEqual(readiness(pr(), [review()]), []);
  });
  it('refuses a review comment made at an older head', () => {
    assert.match(readiness(pr(), [review('f'.repeat(40))]).join(), /no LEAPWare-HQ shellux-cloud-reviewer comment/);
  });
  it('ignores a forged review comment from any other account', () => {
    assert.match(readiness(pr(), [review(HEAD, 'MERGE', { login: 'someone-else' })]).join(), /no LEAPWare-HQ shellux-cloud-reviewer comment/);
  });
  it('lets a later rejection at the same head win over an earlier MERGE', () => {
    const early = review(HEAD, 'MERGE', { at: '2026-09-19T13:00:00Z' });
    const late = review(HEAD, 'DO NOT MERGE', { at: '2026-09-19T14:00:00Z' });
    assert.match(readiness(pr(), [late, early]).join(), /newest review at head is not MERGE/);
  });
  it('refuses MERGE WITH FIXES and DO NOT MERGE, in the comment and in the body', () => {
    assert.match(readiness(pr(), [review(HEAD, 'MERGE WITH FIXES')]).join(), /not MERGE/);
    assert.match(readiness(pr(), [review(HEAD, 'DO NOT MERGE')]).join(), /not MERGE/);
    assert.match(readiness(pr({ body: pr().body.replace('Verdict: MERGE', 'Verdict: MERGE WITH FIXES') }), [review()]).join(), /body verdict/);
  });
  it('refuses a head that moved since the triggering run', () => {
    assert.match(readiness(pr(), [review()], 'e'.repeat(40)).join(), /head moved/);
  });
  it('refuses a PR without a lane label, a draft, or a closed PR', () => {
    assert.match(readiness(pr({ labels: [] }), [review()]).join(), /no lane label/);
    assert.match(readiness(pr({ draft: true }), [review()]).join(), /draft/);
    assert.match(readiness(pr({ state: 'closed' }), [review()]).join(), /state is closed/);
  });
  it('reads MERGE strictly', () => {
    for (const v of ['MERGE', 'merge', 'MERGE ']) assert.equal(isMergeVerdict(v), true, v);
    for (const v of ['MERGE WITH FIXES', 'DO NOT MERGE', 'MERGE-WITH-FIXES', 'MERGE after fixes', 'Merge (blocked)', null]) {
      assert.equal(isMergeVerdict(v), false, String(v));
    }
  });
});

describe('auto-queue main', () => {
  const runner = (prObj, comments, calls) => (args) => {
    calls.push(args.join(' '));
    if (args[args.length - 1].endsWith('/comments')) return JSON.stringify([comments]);
    if (args[0] === 'api') return JSON.stringify(prObj);
    return '';
  };
  it('calls gh pr merge --squash --auto pinned to the head only when ready', () => {
    const calls = [];
    assert.equal(main(7, 'o/r', HEAD, runner(pr(), [review()], calls), () => {}), true);
    assert.ok(calls.includes(`pr merge 7 --repo o/r --squash --auto --match-head-commit ${HEAD}`));
  });
  it('does not merge, and says why, when not ready', () => {
    const calls = []; const logs = [];
    assert.equal(main(7, 'o/r', null, runner(pr({ labels: [] }), [review()], calls), (m) => logs.push(m)), false);
    assert.ok(!calls.some((c) => c.startsWith('pr merge')));
    assert.match(logs.join(), /no lane label/);
  });
});
