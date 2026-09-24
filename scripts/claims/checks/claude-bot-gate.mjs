#!/usr/bin/env node
// Row C-44: the reviewer's DO NOT MERGE verdict on this PR reproduced two real bugs in
// `hasBotMergeComment` (scripts/claims/pr-evidence.mjs) — a first-match-not-last-match
// bug in field parsing, and a stale-approval-never-expires bug from `.some()` over every
// comment ever posted — and named the missing probe row (docs/cloud/runbook.md §4 lane C
// item 3: "a missing review, a stale SHA, or a LEAPWare-HQ-authored review each fail").
// This check exercises `hasBotMergeComment` directly, in process, against constructed
// comment fixtures for each of those scenarios plus the two the reviewer reproduced.
// Reads no filesystem beyond its own import; builtins and the module under test only.
import { hasBotMergeComment } from '../pr-evidence.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const STALE_SHA = 'f'.repeat(40);

const comment = (overrides = {}) => ({
  user: { login: 'claude[bot]' },
  body: `Claude review: No findings\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`,
  created_at: '2026-09-19T10:00:00Z',
  ...overrides,
});

const scenarios = {
  // No review at all: nothing to open the gate on.
  no_review_fails: hasBotMergeComment([], SHA) === false,

  // A claude[bot] comment at a SHA that is not the current head.
  stale_sha_fails: hasBotMergeComment([comment({ body: `Claude review: No findings\nReviewed SHA: ${STALE_SHA}\nVerdict: MERGE\n` })], SHA) === false,

  // The right SHA and a clean Verdict: MERGE, but authored by LEAPWare-HQ, not claude[bot].
  leapware_hq_impersonation_fails: hasBotMergeComment([comment({ user: { login: 'LEAPWare-HQ' } })], SHA) === false,

  // Bug 1 (first-match-not-last-match): a single comment whose body quotes/discusses an
  // earlier "Verdict: MERGE" line, but whose real, final lines are Reviewed SHA / a clean
  // Verdict: DO NOT MERGE. Must fail: the LAST occurrence of each field wins.
  quoted_earlier_merge_real_verdict_do_not_merge_fails:
    hasBotMergeComment(
      [
        comment({
          body: [
            'Claude review: an earlier pass of mine said "Verdict: MERGE" here, but that was',
            'wrong given what I found on closer inspection.',
            '',
            `Reviewed SHA: ${SHA}`,
            'Verdict: DO NOT MERGE',
            '',
          ].join('\n'),
        }),
      ],
      SHA,
    ) === false,

  // Bug 2 (stale-approval-never-expires): an earlier claude[bot] comment says Verdict:
  // MERGE at the head SHA, but a LATER claude[bot] comment at the same SHA retracts it
  // with Verdict: DO NOT MERGE. Must fail: only the latest comment counts.
  superseded_stale_merge_fails:
    hasBotMergeComment(
      [
        comment({ created_at: '2026-09-19T10:00:00Z' }),
        comment({
          body: `Claude review: retracting my earlier MERGE on further review.\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`,
          created_at: '2026-09-19T11:00:00Z',
        }),
      ],
      SHA,
    ) === false,

  // The mirror case: an earlier claude[bot] comment rejects, a LATER one at the head SHA
  // genuinely approves. Must pass: a real change of mind, in either direction, is honoured.
  genuine_latest_merge_accepted_passes:
    hasBotMergeComment(
      [
        comment({
          body: `Claude review: findings to fix.\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`,
          created_at: '2026-09-19T10:00:00Z',
        }),
        comment({
          body: `Claude review: fixes applied and verified.\nReviewed SHA: ${SHA}\nVerdict: MERGE\n`,
          created_at: '2026-09-19T11:00:00Z',
        }),
      ],
      SHA,
    ) === true,
};

for (const [key, ok] of Object.entries(scenarios)) console.log(`${key}=${ok ? 1 : 0}`);
