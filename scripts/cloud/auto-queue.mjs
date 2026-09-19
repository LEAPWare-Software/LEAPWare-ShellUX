#!/usr/bin/env node
/**
 * Queue a cloud-lane pull request once it is proven ready (docs/cloud/runbook.md, lane C
 * item 0a). Cloud routines cannot enable auto-merge through their proxy, so this runs in
 * GitHub Actions and adds the pull request to the merge queue, which re-runs every
 * required check.
 *
 * Ready means all of these hold:
 *   - the pull request is open, not a draft, and its head is the commit that triggered
 *     this run, when one is known;
 *   - it carries a `lane-a`, `lane-b` or `lane-c` label;
 *   - the body's `## Review` says `Verdict: MERGE`, exactly;
 *   - the **newest** review comment at the head (`Reviewer: shellux-cloud-reviewer`,
 *     `Reviewed SHA:` equal to the head) is authored by the owner's login, `LEAPWare-HQ`,
 *     under which the cloud routines post, and says `Verdict: MERGE`. A later rejection
 *     at the same head wins, and a comment from any other account is ignored (the
 *     repository is public).
 *
 * The enqueue passes `--match-head-commit`, so a push after the check cannot slip in.
 * A guardrail, not an integrity control: every routine posts under the owner's login, so
 * the comment proves a review exists at the head, not which routine wrote it.
 * *Tests:* scripts/__tests__/auto-queue.test.mjs.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LANE_LABELS = new Set(['lane-a', 'lane-b', 'lane-c']);
export const REVIEW_AUTHOR = 'LEAPWare-HQ';

function field(text, name) {
  const m = (text ?? '').match(new RegExp(`^[ \\t]*[-*]?[ \\t]*\\**${name}:\\**[ \\t]*(.*)$`, 'mi'));
  return m ? m[1].replace(/[`*]/g, '').trim() : null;
}

/** Whether a verdict line says exactly MERGE. */
export function isMergeVerdict(value) {
  return typeof value === 'string' && /^MERGE\s*$/i.test(value);
}

function isReviewAt(comment, head) {
  return /^Reviewer:\s*shellux-cloud-reviewer\b/m.test(comment.body ?? '')
    && field(comment.body, 'Reviewed SHA') === head
    && comment.user?.login === REVIEW_AUTHOR;
}

/** The reasons a pull request is not ready to queue; empty means ready. */
export function readiness(pr, comments, expectedHead = null) {
  const reasons = [];
  if (pr.state !== 'open') reasons.push(`state is ${pr.state}`);
  if (pr.draft) reasons.push('draft');
  const head = pr.head?.sha;
  if (expectedHead && head !== expectedHead) reasons.push(`head moved: ${head} is not ${expectedHead}`);
  const labels = (pr.labels ?? []).map((l) => l.name);
  if (!labels.some((l) => LANE_LABELS.has(l))) reasons.push('no lane label');
  const reviewSection = (pr.body ?? '').split(/^##\s+Review\s*$/mi)[1] ?? '';
  if (!isMergeVerdict(field(reviewSection, 'Verdict'))) reasons.push('body verdict is not MERGE');
  const atHead = (comments ?? [])
    .filter((c) => isReviewAt(c, head))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const newest = atHead[atHead.length - 1];
  if (!newest) reasons.push(`no ${REVIEW_AUTHOR} shellux-cloud-reviewer comment at head ${head}`);
  else if (!isMergeVerdict(field(newest.body, 'Verdict'))) reasons.push('newest review at head is not MERGE');
  return reasons;
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

export function main(prNumber, repo, expectedHead = null, run = gh, log = console.log) {
  const pr = JSON.parse(run(['api', `repos/${repo}/pulls/${prNumber}`]));
  const comments = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repo}/issues/${prNumber}/comments`])).flat();
  const reasons = readiness(pr, comments, expectedHead);
  if (reasons.length) {
    log(`auto-queue: #${prNumber} not queued: ${reasons.join('; ')}`);
    return false;
  }
  run(['pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--auto', '--match-head-commit', pr.head.sha]);
  log(`auto-queue: #${prNumber} queued at ${pr.head.sha}`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv[2], process.env.GITHUB_REPOSITORY ?? 'LEAPWare-Software/LEAPWare-ShellUX', process.argv[3] || null);
}
