#!/usr/bin/env node
// Row C-46: `hasBotMergeComment`'s review-shaped-comment selection (D-55, round 3), the
// gate that makes `PR evidence` require a genuine claude[bot] MERGE verdict rather than
// take the single latest claude[bot] comment (which is exactly the F7 bug the debate
// found and fixed). Entry-point validation, not an integrity control: real at the
// `PR evidence` check, silent about every other route a comment claiming that GitHub
// login could arrive by. In-process against constructed fixtures; no filesystem access
// beyond its own import.
import { hasBotMergeComment } from '../pr-evidence.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const STALE = 'f'.repeat(40);
const t = (n) => `2026-09-${String(20 + n).padStart(2, '0')}T00:00:00Z`;
const comment = (body, { login = 'claude[bot]', created_at = t(1) } = {}) => ({ user: { login }, body, created_at });
const genuine = (verdict, sha = SHA) => `Claude review:\n\nReviewed SHA: ${sha}\nVerdict: ${verdict}\n`;

const bool = (v) => (v ? 1 : 0);

console.log(`no_review_fails=${bool(hasBotMergeComment([], SHA) === false)}`);
console.log(`stale_sha_fails=${bool(hasBotMergeComment([comment(genuine('MERGE', STALE))], SHA) === false)}`);
console.log(`leapware_hq_impersonation_fails=${bool(hasBotMergeComment([comment(genuine('MERGE'), { login: 'LEAPWare-HQ' })], SHA) === false)}`);

console.log(
  `unrelated_later_reply_does_not_hide_earlier_merge_passes=${bool(
    hasBotMergeComment(
      [comment(genuine('MERGE'), { created_at: t(1) }), comment('Sure, happy to help with that!', { created_at: t(2) })],
      SHA,
    ) === true,
  )}`,
);

console.log(
  `superseded_stale_merge_fails=${bool(
    hasBotMergeComment([comment(genuine('MERGE'), { created_at: t(1) }), comment(genuine('DO NOT MERGE'), { created_at: t(2) })], SHA) ===
      false,
  )}`,
);

console.log(
  `genuine_latest_merge_accepted_passes=${bool(
    hasBotMergeComment([comment(genuine('DO NOT MERGE'), { created_at: t(1) }), comment(genuine('MERGE'), { created_at: t(2) })], SHA) ===
      true,
  )}`,
);

console.log(
  `bold_opener_retraction_fails=${bool(
    hasBotMergeComment(
      [
        comment(genuine('MERGE'), { created_at: t(1) }),
        comment(`**Claude review:**\n\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`, { created_at: t(2) }),
      ],
      SHA,
    ) === false,
  )}`,
);

console.log(
  `heading_opener_retraction_fails=${bool(
    hasBotMergeComment(
      [
        comment(genuine('MERGE'), { created_at: t(1) }),
        comment(`## Claude Review\n\nReviewed SHA: ${SHA}\nVerdict: DO NOT MERGE\n`, { created_at: t(2) }),
      ],
      SHA,
    ) === false,
  )}`,
);

console.log(
  `bare_verdict_retraction_fails=${bool(
    hasBotMergeComment(
      [comment(genuine('MERGE'), { created_at: t(1) }), comment(`Verdict: DO NOT MERGE\n`, { created_at: t(2) })],
      SHA,
    ) === false,
  )}`,
);
