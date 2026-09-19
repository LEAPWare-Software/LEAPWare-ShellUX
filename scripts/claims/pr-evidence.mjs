#!/usr/bin/env node
/**
 * The PR evidence gate: docs/proof-of-completion.md §3.3.
 *
 * Reads the pull request body through the API, so a re-run sees the body as it is now
 * rather than as the triggering event recorded it, and fails unless the body carries:
 *   ## Evidence      with a line VERIFY_EXIT=0
 *   ## Not done      with at least one line
 *   ## Review        with Reviewer:, Reviewed SHA: equal to the head SHA, and a Verdict:
 *                    that is not DO NOT MERGE
 *   Rows reviewed:   naming every row the change added, changed or cited (or `none`)
 *   Items removed or reworded:  each such item as <file>:<base line>, when there are any
 *   Gate changes:    every changed gate file, when there are any
 * HTML comments are removed first, so the template's own guidance satisfies nothing.
 *
 * Dependabot is exempt only when every commit on the pull request is authored by
 * dependabot[bot] and verified.
 *
 * A guardrail against the honest mistake: the body is written by the same identity that
 * merges, so this makes an omission loud and enforces nothing against a deliberate one.
 *
 * Usage (in the workflow):
 *   node scripts/claims/pr-evidence.mjs --event pull_request --pr <n>
 *   node scripts/claims/pr-evidence.mjs --event merge_group --head-ref <ref>
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REPO, REGISTER_PATH, REPO_ROOT, annotation, defaultRunner, ghJson, prNumberFromQueueRef } from './lib.mjs';
import { changedFiles, diffScope, readCommit, readWorkingTree, resolveBase } from './lint-boxes.mjs';

/** Files whose change must be named under `Gate changes:`. */
export function isGateFile(file) {
  return (
    file.startsWith('scripts/claims/') ||
    file === '.github/workflows/claims.yml' ||
    file === '.github/workflows/pr-evidence.yml' ||
    file.startsWith('.github/rulesets/')
  );
}

/** The register's schema changed: anything other than its rows. */
export function registerSchemaChanged(baseText, headText) {
  const shape = (text) => {
    try {
      const rest = JSON.parse(text);
      delete rest.active;
      delete rest.retired;
      return JSON.stringify(rest);
    } catch {
      return 'unparseable';
    }
  };
  return shape(baseText) !== shape(headText);
}

function stripComments(body) {
  return body.replace(/<!--[\s\S]*?-->/g, '');
}

/** Body sections by `## ` heading, lower-cased, comments removed. */
export function sections(body) {
  const map = new Map();
  let current = null;
  for (const line of stripComments(body ?? '').split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].toLowerCase();
      map.set(current, []);
    } else if (current) {
      map.get(current).push(line);
    }
  }
  return map;
}

function field(text, name) {
  // [ \t], not \s: in multiline mode \s crosses the newline, and a blank field would
  // then read the next line's value as its own.
  const m = text.match(new RegExp(`^[ \\t]*[-*]?[ \\t]*\\**${name}:\\**[ \\t]*(.*)$`, 'mi'));
  return m ? m[1].replace(/[`*]/g, '').trim() : null;
}

/**
 * Every rule of §3.3 against one body. Returns a list of failure messages.
 * *Tests:* scripts/__tests__/claims-pr-evidence.test.mjs — "fails a body whose Reviewed SHA is not the head SHA".
 */
export function checkBody(body, { headSha, requiredRows = [], removedOrReworded = [], deletedPlanFiles = [], gateFiles = [] }) {
  const failures = [];
  const secs = sections(body);
  const text = stripComments(body ?? '');

  const evidence = secs.get('evidence');
  if (!evidence) failures.push('missing "## Evidence"');
  else if (!evidence.some((l) => l.replace(/[`*]/g, '').trim() === 'VERIFY_EXIT=0')) {
    failures.push('"## Evidence" has no line VERIFY_EXIT=0');
  }

  const notDone = secs.get('not done');
  if (!notDone) failures.push('missing "## Not done"');
  else if (!notDone.some((l) => l.trim() !== '')) failures.push('"## Not done" is empty');

  const review = secs.get('review');
  if (!review) failures.push('missing "## Review"');
  else {
    const reviewText = review.join('\n');
    const reviewer = field(reviewText, 'Reviewer');
    const sha = field(reviewText, 'Reviewed SHA');
    const verdict = field(reviewText, 'Verdict');
    if (!reviewer) failures.push('"## Review" has no Reviewer:');
    if (!sha) failures.push('"## Review" has no Reviewed SHA:');
    else if (sha.toLowerCase() !== String(headSha).toLowerCase()) {
      failures.push(`Reviewed SHA: ${sha} is not the head SHA ${headSha}; any push or rebase makes it stale`);
    }
    if (!verdict) failures.push('"## Review" has no Verdict:');
    else if (/DO NOT MERGE/i.test(verdict)) failures.push('Verdict: is DO NOT MERGE');
  }

  const rows = field(text, 'Rows reviewed');
  if (rows === null) failures.push('missing "Rows reviewed:"');
  else {
    const named = new Set(rows.match(/C-\d+/g) ?? []);
    const missing = requiredRows.filter((id) => !named.has(id));
    if (missing.length) failures.push(`Rows reviewed: does not name ${missing.join(', ')}`);
    if (requiredRows.length === 0 && named.size === 0 && !/^none\b/i.test(rows)) failures.push('Rows reviewed: names no row; write "none"');
  }

  if (removedOrReworded.length || deletedPlanFiles.length) {
    const items = field(text, 'Items removed or reworded');
    if (items === null) failures.push('missing "Items removed or reworded:"');
    else {
      for (const r of removedOrReworded) {
        if (!items.includes(`${r.file}:${r.baseLine}`)) failures.push(`Items removed or reworded: does not name ${r.file}:${r.baseLine}`);
      }
      for (const f of deletedPlanFiles) if (!items.includes(f)) failures.push(`Items removed or reworded: does not name deleted or moved ${f}`);
    }
  }

  if (gateFiles.length) {
    const gates = field(text, 'Gate changes');
    if (gates === null) failures.push('missing "Gate changes:"');
    else for (const f of gateFiles) if (!gates.includes(f)) failures.push(`Gate changes: does not name ${f}`);
  }
  return failures;
}

/** Every commit authored by dependabot[bot] and verified. */
export function isVerifiedDependabot(commits) {
  return (
    Array.isArray(commits) &&
    commits.length > 0 &&
    commits.every((c) => c?.author?.login === 'dependabot[bot]' && c?.commit?.verification?.verified === true)
  );
}

export function gate({ event, pr, headRef, repo = DEFAULT_REPO, cwd = REPO_ROOT, run = defaultRunner, log = console.log }) {
  const number = event === 'merge_group' ? prNumberFromQueueRef(headRef) : Number(pr);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`no pull request number (event ${event})`);
  const pull = ghJson(`repos/${repo}/pulls/${number}`, run);
  const headSha = pull.head.sha;

  const mode = event === 'merge_group' ? 'merge_group' : 'pull_request';
  const base = resolveBase(mode, { cwd, run });
  const baseTree = readCommit(base, { cwd, run });
  const headTree = readWorkingTree({ cwd, run });
  const diff = diffScope(baseTree, headTree);
  const files = changedFiles(base, { cwd, run });
  const gateFiles = files.map((f) => f.file).filter(isGateFile);
  if (files.some((f) => f.file === REGISTER_PATH) && registerSchemaChanged(baseTree.registerText, headTree.registerText)) {
    gateFiles.push(REGISTER_PATH);
  }
  const requiredRows = [...new Set([...diff.rowsChanged, ...diff.citedRows])].sort();

  const commits = ghJson(`repos/${repo}/pulls/${number}/commits`, run);
  if (isVerifiedDependabot(commits)) {
    log(`PR #${number}: every commit is verified and authored by dependabot[bot]; the evidence gate is skipped (the box linter still runs in Prove claims)`);
    return 0;
  }

  const failures = checkBody(pull.body ?? '', {
    headSha,
    requiredRows,
    removedOrReworded: diff.removedOrReworded,
    deletedPlanFiles: diff.deletedPlanFiles,
    gateFiles,
  });
  log(`PR #${number} at ${headSha}: rows to name ${requiredRows.join(', ') || 'none'}; items removed or reworded ${diff.removedOrReworded.length}; gate files ${gateFiles.join(', ') || 'none'}`);
  for (const f of failures) log(annotation('error', f));
  log(failures.length ? `pr-evidence: ${failures.length} failure(s)` : 'pr-evidence: the body carries every required field');
  return failures.length ? 1 : 0;
}

export function parseArgs(argv) {
  const options = { event: null, pr: null, headRef: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--event') options.event = argv[(i += 1)];
    else if (arg === '--pr') options.pr = argv[(i += 1)];
    else if (arg === '--head-ref') options.headRef = argv[(i += 1)];
    else throw new Error(`unrecognised argument: ${arg}`);
  }
  if (!['pull_request', 'merge_group'].includes(options.event)) throw new Error('--event must be pull_request or merge_group');
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(gate(parseArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(`pr-evidence: ${error.message}`);
    process.exit(2);
  }
}
