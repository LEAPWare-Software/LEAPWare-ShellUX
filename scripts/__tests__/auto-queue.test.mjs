/**
 * Tests for scripts/cloud/auto-queue.mjs: when a cloud-lane pull request may enter the
 * merge queue.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMergeVerdict, main, readiness } from '../cloud/auto-queue.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const pr = (over = {}) => ({
  state: 'open', draft: false, labels: [{ name: 'lane-c' }], head: { sha: HEAD },
  body: `## Evidence\n\nVERIFY_EXIT=0\n\n## Review\n\nReviewer: shellux-cloud-reviewer\nReviewed SHA: ${HEAD}\nVerdict: MERGE\n`,
  ...over,
});
const review = (sha = HEAD, verdict = 'MERGE') => ({ body: `Reviewer: shellux-cloud-reviewer\nReviewed SHA: ${sha}\nVerdict: ${verdict}\n\nFindings: none.` });

describe('auto-queue readiness', () => {
  it('queues an open lane PR with a MERGE review comment at its head', () => {
    assert.deepEqual(readiness(pr(), [review()]), []);
  });
  it('refuses a review comment made at an older head', () => {
    assert.match(readiness(pr(), [review('f'.repeat(40))]).join(), /no shellux-cloud-reviewer MERGE comment/);
  });
  it('refuses MERGE WITH FIXES and DO NOT MERGE, in the comment and in the body', () => {
    assert.match(readiness(pr(), [review(HEAD, 'MERGE WITH FIXES')]).join(), /no shellux-cloud-reviewer/);
    assert.match(readiness(pr(), [review(HEAD, 'DO NOT MERGE')]).join(), /no shellux-cloud-reviewer/);
    assert.match(readiness(pr({ body: pr().body.replace('Verdict: MERGE', 'Verdict: MERGE WITH FIXES') }), [review()]).join(), /body verdict/);
  });
  it('refuses a PR without a lane label, a draft, or a closed PR', () => {
    assert.match(readiness(pr({ labels: [] }), [review()]).join(), /no lane label/);
    assert.match(readiness(pr({ draft: true }), [review()]).join(), /draft/);
    assert.match(readiness(pr({ state: 'closed' }), [review()]).join(), /state is closed/);
  });
  it('refuses a comment that only quotes the reviewer line mid-text', () => {
    assert.match(readiness(pr(), [{ body: `see:\n> Reviewer: other\nReviewed SHA: ${HEAD}\nVerdict: MERGE` }]).join(), /no shellux-cloud-reviewer/);
  });
  it('reads MERGE strictly', () => {
    assert.equal(isMergeVerdict('MERGE'), true);
    assert.equal(isMergeVerdict('merge'), true);
    assert.equal(isMergeVerdict('MERGE WITH FIXES'), false);
    assert.equal(isMergeVerdict('DO NOT MERGE'), false);
    assert.equal(isMergeVerdict(null), false);
  });
});

describe('auto-queue main', () => {
  const runner = (prObj, comments, calls) => (args) => {
    calls.push(args.join(' '));
    if (args[args.length - 1].endsWith('/comments')) return JSON.stringify([comments]);
    if (args[0] === 'api') return JSON.stringify(prObj);
    return '';
  };
  it('calls gh pr merge --squash --auto only when ready', () => {
    const calls = [];
    assert.equal(main(7, 'o/r', runner(pr(), [review()], calls), () => {}), true);
    assert.ok(calls.some((c) => c === 'pr merge 7 --repo o/r --squash --auto'));
  });
  it('does not merge, and says why, when not ready', () => {
    const calls = []; const logs = [];
    assert.equal(main(7, 'o/r', runner(pr({ labels: [] }), [review()], calls), (m) => logs.push(m)), false);
    assert.ok(!calls.some((c) => c.startsWith('pr merge')));
    assert.match(logs.join(), /no lane label/);
  });
});
