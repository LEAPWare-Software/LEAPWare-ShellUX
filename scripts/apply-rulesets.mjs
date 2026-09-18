#!/usr/bin/env node
// Apply (create or update) this repo's GitHub repository rulesets from JSON.
//
// Node port of LEAPWare-SessionKeeper's scripts/lws_apply_rulesets.py, kept
// deliberately close to that file so the two stay easy to compare. Reads
// every `*.json` file in `.github/rulesets/` and, for each one, either
// creates a new ruleset (POST) or updates the existing one by name (PUT),
// via `gh api`. `gh` carries the caller's auth, so this needs no token of
// its own and works unchanged from any machine that has `gh auth login`'d.
//
// Usage:
//   node scripts/apply-rulesets.mjs                  # apply every ruleset
//   node scripts/apply-rulesets.mjs --dry-run         # print the JSON, do nothing
//   node scripts/apply-rulesets.mjs --repo OWNER/REPO --dry-run
//
// Stdlib only (node:child_process, node:fs, node:path); shells out to the
// `gh` CLI, never to a bare `curl`/token, so PAT scoping and 2FA stay exactly
// what `gh auth` already enforces.
//
// Ordering trap this script guards against: a ruleset that requires a merge
// method GitHub doesn't return "invalid JSON", it returns a 422 naming the
// method (e.g. a `pull_request` or `merge_queue` rule requiring `squash`
// when the repo's own `allow_squash_merge` is still `false`). Before
// applying anything, this script reads every ruleset's required merge
// method(s) and checks them against `gh api repos/<repo>` — if any required
// method isn't enabled on the repo yet, it fails with the exact
// `gh api ... PATCH` command that fixes it, and applies nothing. Ported
// verbatim from LEAPWare-SessionKeeper's own LWS-D0 finding.
//
// This repository is PRIVATE (D-42/D-43 open), so an actual `--repo`
// invocation against it would 403 today — that is expected, not a bug in
// this script, and is why `--dry-run` is how this file is exercised before
// the repo goes public.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const RULESETS_DIR = path.join(REPO_ROOT, '.github', 'rulesets');
export const DEFAULT_REPO = 'LEAPWare-Software/LEAPWare-ShellUX';

// GitHub ruleset merge-method spellings -> the repo settings field that must
// be true before a ruleset requiring that method can be created or updated.
const MERGE_METHOD_TO_SETTING = {
  squash: 'allow_squash_merge',
  merge: 'allow_merge_commit',
  rebase: 'allow_rebase_merge',
  // merge_queue.parameters.merge_method is spelled upper-case.
  SQUASH: 'allow_squash_merge',
  MERGE: 'allow_merge_commit',
  REBASE: 'allow_rebase_merge',
};

/**
 * Default `gh` runner: shells out for real via spawnSync. Tests inject their
 * own runner instead, so nothing under test:scripts touches the network or a
 * real `gh` binary.
 */
export function defaultGhRunner(argv, input) {
  const result = spawnSync('gh', argv, {
    input,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? '',
    stderr: result.error ? String(result.error.message) : result.stderr ?? '',
  };
}

export function loadRulesets(rulesetsDir, readDirFn = readdirSync, readFileFn = readFileSync) {
  const entries = readDirFn(rulesetsDir).filter((name) => name.endsWith('.json')).sort();
  return entries.map((name) => {
    const filePath = path.join(rulesetsDir, name);
    const data = JSON.parse(readFileFn(filePath, 'utf8'));
    if (!('name' in data)) {
      throw new Error(`${filePath}: ruleset JSON is missing required key 'name'`);
    }
    return { path: filePath, name, data };
  });
}

/** Map repo setting name -> the ruleset file name(s) that need it true. */
export function requiredMergeSettings(rulesets) {
  const required = new Map();
  for (const { name, data } of rulesets) {
    for (const rule of data.rules ?? []) {
      const params = rule.parameters ?? {};
      const methods = [];
      if (rule.type === 'pull_request') {
        methods.push(...(params.allowed_merge_methods ?? []));
      } else if (rule.type === 'merge_queue' && 'merge_method' in params) {
        methods.push(params.merge_method);
      }
      for (const method of methods) {
        const setting = MERGE_METHOD_TO_SETTING[method];
        if (!setting) continue;
        if (!required.has(setting)) required.set(setting, new Set());
        required.get(setting).add(name);
      }
    }
  }
  return required;
}

export function currentMergeSettings(repo, runGh) {
  const fields = 'allow_squash_merge,allow_merge_commit,allow_rebase_merge';
  const result = runGh(['api', `repos/${repo}`, '--jq', `{${fields}}`]);
  if (result.status !== 0) {
    throw new Error(`gh api repos/${repo} failed: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * Fail fast, before touching any ruleset, if the repo's own merge-method
 * settings don't yet allow what the rulesets require. This is the ordering
 * check: repo settings (allow_squash_merge et al.) must be applied BEFORE a
 * ruleset that requires that method, or GitHub returns a 422.
 *
 * Throws an Error carrying the remediation message on failure; returns
 * nothing on success.
 */
export function checkMergeSettingsOrDie(repo, rulesets, runGh) {
  const required = requiredMergeSettings(rulesets);
  if (required.size === 0) return;
  const current = currentMergeSettings(repo, runGh);
  const missing = new Map();
  for (const [setting, files] of required) {
    if (!current[setting]) missing.set(setting, files);
  }
  if (missing.size === 0) return;

  const lines = [
    `apply-rulesets.mjs: repo settings are not ready for these rulesets on ${repo}.`,
    'Run the repo-settings PATCH first, then re-run this script:',
    '',
    `  gh api -X PATCH repos/${repo} \\`,
    '    -F allow_squash_merge=true \\',
    '    -F allow_merge_commit=false \\',
    '    -F allow_rebase_merge=false \\',
    '    -F allow_auto_merge=true \\',
    '    -F delete_branch_on_merge=true \\',
    '    -f squash_merge_commit_title=PR_TITLE \\',
    '    -f squash_merge_commit_message=PR_BODY',
    '',
    'Missing settings:',
  ];
  for (const setting of [...missing.keys()].sort()) {
    const files = [...missing.get(setting)].sort().join(', ');
    lines.push(`  - ${setting}=true, required by: ${files}`);
  }
  throw new Error(lines.join('\n'));
}

function existingRulesetId(repo, name, runGh) {
  const result = runGh([
    'api',
    `repos/${repo}/rulesets`,
    '--jq',
    `.[] | select(.name=="${name}") | .id`,
  ]);
  if (result.status !== 0) {
    throw new Error(`gh api repos/${repo}/rulesets failed: ${result.stderr.trim()}`);
  }
  const output = result.stdout.trim();
  if (!output) return null;
  // If more than one id came back (shouldn't happen), take the first.
  return Number.parseInt(output.split('\n')[0], 10);
}

export function applyOne(repo, ruleset, dryRun, runGh, log = console.log) {
  const body = JSON.stringify(ruleset.data);
  if (dryRun) {
    log(`--- ${ruleset.name} (${ruleset.data.name}) ---`);
    log(JSON.stringify(ruleset.data, null, 2));
    return;
  }

  const existingId = existingRulesetId(repo, ruleset.data.name, runGh);
  let argv;
  let action;
  if (existingId === null) {
    argv = ['api', '--method', 'POST', `repos/${repo}/rulesets`, '--input', '-'];
    action = 'created';
  } else {
    argv = ['api', '--method', 'PUT', `repos/${repo}/rulesets/${existingId}`, '--input', '-'];
    action = 'updated';
  }

  const result = runGh(argv, body);
  if (result.status !== 0) {
    throw new Error(`FAILED applying ${ruleset.name}: ${result.stderr.trim()}`);
  }
  log(`OK: ruleset '${ruleset.data.name}' ${action} (${ruleset.name})`);
}

/**
 * The whole apply run, as a function tests can call directly with an
 * injected `runGh` and a fixed rulesets list — no network, no real `gh`.
 */
export function run({ repo, dryRun, rulesets, runGh, log = console.log }) {
  if (rulesets.length === 0) {
    throw new Error(`no *.json rulesets found`);
  }
  if (!dryRun) {
    checkMergeSettingsOrDie(repo, rulesets, runGh);
  }
  for (const ruleset of rulesets) {
    applyOne(repo, ruleset, dryRun, runGh, log);
  }
}

function parseArgs(argv) {
  let repo = DEFAULT_REPO;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--repo') {
      i += 1;
      repo = argv[i];
    } else {
      throw new Error(`unrecognised argument: ${arg}`);
    }
  }
  return { repo, dryRun };
}

function main(argv) {
  const { repo, dryRun } = parseArgs(argv);

  let rulesets;
  try {
    rulesets = loadRulesets(RULESETS_DIR);
  } catch (error) {
    console.error(`no rulesets directory at ${RULESETS_DIR}: ${error.message}`);
    return 1;
  }

  try {
    run({ repo, dryRun, rulesets, runGh: defaultGhRunner });
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
