#!/usr/bin/env node
/**
 * Queue a cloud-lane pull request once it is proven ready (docs/cloud/runbook.md, lane C
 * item 0a). Cloud routines cannot enable auto-merge through their proxy, so this runs in
 * GitHub Actions after the required `PR evidence` check succeeds, and adds the pull
 * request to the merge queue. The queue then re-runs every required check.
 *
 * Ready means all four of these hold:
 *   - the pull request is open and not a draft;
 *   - it carries a `lane-a`, `lane-b` or `lane-c` label;
 *   - the body's `## Review` has `Verdict: MERGE`, exactly;
 *   - a conversation comment starts `Reviewer: shellux-cloud-reviewer`, has `Reviewed SHA:`
 *     equal to the head, and has `Verdict: MERGE`.
 *
 * `PR evidence` has already checked that the body's `Reviewed SHA:` equals the head.
 *
 * A guardrail, not an integrity control: every routine posts under the owner's login, so
 * the review comment proves that a review exists at the head, not who wrote it. Lane C
 * item 0d moves the review to claude[bot]. The merge queue and the seven required checks
 * still gate the merge itself.
 * *Tests:* scripts/__tests__/auto-queue.test.mjs.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LANE_LABELS = new Set(['lane-a', 'lane-b', 'lane-c']);

function field(text, name) {
  const m = (text ?? '').match(new RegExp(`^[ \\t]*[-*]?[ \\t]*\\**${name}:\\**[ \\t]*(.*)$`, 'mi'));
  return m ? m[1].replace(/[`*]/g, '').trim() : null;
}

/** Whether a verdict line says MERGE and nothing weaker. */
export function isMergeVerdict(value) {
  return typeof value === 'string' && /^MERGE\b/i.test(value) && !/WITH FIXES|DO NOT/i.test(value);
}

/** The reasons a pull request is not ready to queue; empty means ready. */
export function readiness(pr, comments) {
  const reasons = [];
  if (pr.state !== 'open') reasons.push(`state is ${pr.state}`);
  if (pr.draft) reasons.push('draft');
  const labels = (pr.labels ?? []).map((l) => l.name);
  if (!labels.some((l) => LANE_LABELS.has(l))) reasons.push('no lane label');
  const head = pr.head?.sha;
  const reviewSection = (pr.body ?? '').split(/^##\s+Review\s*$/mi)[1] ?? '';
  if (!isMergeVerdict(field(reviewSection, 'Verdict'))) reasons.push('body verdict is not MERGE');
  const review = (comments ?? []).find(
    (c) => /^Reviewer:\s*shellux-cloud-reviewer\b/m.test(c.body ?? '')
      && field(c.body, 'Reviewed SHA') === head
      && isMergeVerdict(field(c.body, 'Verdict')),
  );
  if (!review) reasons.push(`no shellux-cloud-reviewer MERGE comment at head ${head}`);
  return reasons;
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/* The entry point runs only in the workflow; the decision above is what the tests pin. */
export function main(prNumber, repo, run = gh, log = console.log) {
  const pr = JSON.parse(run(['api', `repos/${repo}/pulls/${prNumber}`]));
  const comments = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repo}/issues/${prNumber}/comments`])).flat();
  const reasons = readiness(pr, comments);
  if (reasons.length) {
    log(`auto-queue: #${prNumber} not queued: ${reasons.join('; ')}`);
    return false;
  }
  run(['pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--auto']);
  log(`auto-queue: #${prNumber} queued at ${pr.head.sha}`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv[2], process.env.GITHUB_REPOSITORY ?? 'LEAPWare-Software/LEAPWare-ShellUX');
}
