#!/usr/bin/env node
/**
 * The ruleset comparison: docs/proof-of-completion.md §3.5.
 *
 * Compares the live ruleset, read with a read-only token, against
 * `.github/rulesets/main.json`. The set of rule types must be equal; for each rule,
 * every parameter key `main.json` declares must be equal, and a declared array is
 * compared as a whole. Keys `main.json` does not declare are ignored, because GitHub
 * adds defaults of its own (`required_reviewers`, `dismissal_restriction`, ...).
 *
 * Two things are not compared, and both are stated rather than hidden:
 * - `bypass_actors`: GitHub returns it only to a caller with write access to the ruleset
 *   (the unauthenticated response committed as a fixture omits it), so a bypass actor
 *   added in the UI is not detected.
 * - `integration_id` inside `required_status_checks`, whenever the live response omits
 *   it: a read-only response that omits the field cannot say whether it matches.
 *
 * *Tests:* scripts/__tests__/claims-compare-ruleset.test.mjs — "finds no drift between main.json and the captured unauthenticated response".
 *
 * Usage:
 *   node scripts/claims/compare-ruleset.mjs              # live, through `gh api`
 *   node scripts/claims/compare-ruleset.mjs --live <file> # a saved response
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REPO, REPO_ROOT, canonicalJson, defaultRunner, ghJson } from './lib.mjs';

export const RULESET_FILE = '.github/rulesets/main.json';

function omitIntegrationIdWhereLiveOmits(declared, live) {
  const liveHasId = Array.isArray(live) && live.some((c) => c && typeof c === 'object' && 'integration_id' in c);
  if (liveHasId) return { declared, live, excluded: false };
  const strip = (list) =>
    list.map((c) => {
      if (c === null || typeof c !== 'object') return c;
      const rest = { ...c };
      delete rest.integration_id;
      return rest;
    });
  const declaredHasId = declared.some((c) => c && typeof c === 'object' && 'integration_id' in c);
  return { declared: strip(declared), live: Array.isArray(live) ? strip(live) : live, excluded: declaredHasId };
}

/**
 * Returns `{ drift: string[], notes: string[] }`. An empty `drift` means equal under the
 * rules above.
 */
export function compareRuleset(declared, live) {
  const drift = [];
  const notes = ['bypass_actors is not compared: GitHub returns it only to callers with write access'];
  const declaredTypes = (declared.rules ?? []).map((r) => r.type).sort();
  const liveTypes = (live.rules ?? []).map((r) => r.type).sort();
  if (canonicalJson(declaredTypes) !== canonicalJson(liveTypes)) {
    drift.push(`rule types differ: main.json [${declaredTypes.join(', ')}], live [${liveTypes.join(', ')}]`);
  }
  for (const rule of declared.rules ?? []) {
    const liveRule = (live.rules ?? []).find((r) => r.type === rule.type);
    if (!liveRule) continue;
    for (const [key, value] of Object.entries(rule.parameters ?? {})) {
      let want = value;
      let got = liveRule.parameters?.[key];
      if (key === 'required_status_checks' && Array.isArray(value)) {
        const stripped = omitIntegrationIdWhereLiveOmits(value, got);
        want = stripped.declared;
        got = stripped.live;
        if (stripped.excluded) notes.push('integration_id is not compared: the read-only response omits it');
      }
      if (Array.isArray(want) && Array.isArray(got)) {
        // Equal as a whole: every element on both sides, in any order, since GitHub
        // does not promise to return them in the order they were written.
        want = want.map(canonicalJson).sort();
        got = got.map(canonicalJson).sort();
      }
      if (canonicalJson(want) !== canonicalJson(got)) {
        drift.push(`${rule.type}.${key}: main.json ${canonicalJson(value)}, live ${canonicalJson(liveRule.parameters?.[key])}`);
      }
    }
  }
  for (const key of ['enforcement', 'target']) {
    if (key in declared && declared[key] !== live[key]) drift.push(`${key}: main.json ${declared[key]}, live ${live[key]}`);
  }
  return { drift, notes };
}

/** Read the live ruleset named like main.json, through `gh api`. */
export function fetchLiveRuleset(declared, { repo = DEFAULT_REPO, run = defaultRunner } = {}) {
  const list = ghJson(`repos/${repo}/rulesets`, run);
  const match = list.find((r) => r.name === declared.name);
  if (!match) throw new Error(`no live ruleset named ${declared.name} on ${repo}`);
  return ghJson(`repos/${repo}/rulesets/${match.id}`, run);
}

export function main(argv, { root = REPO_ROOT, run = defaultRunner, log = console.log } = {}) {
  const declared = JSON.parse(readFileSync(path.join(root, RULESET_FILE), 'utf8'));
  let live;
  if (argv[0] === '--live') live = JSON.parse(readFileSync(argv[1], 'utf8'));
  else if (argv.length === 0) live = fetchLiveRuleset(declared, { run });
  else throw new Error(`unrecognised arguments: ${argv.join(' ')}`);
  const { drift, notes } = compareRuleset(declared, live);
  for (const n of notes) log(`note: ${n}`);
  for (const d of drift) log(`drift: ${d}`);
  log(drift.length ? `compare-ruleset: ${drift.length} difference(s)` : 'compare-ruleset: no drift under the §3.5 rules');
  return drift.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`compare-ruleset: ${error.message}`);
    process.exit(2);
  }
}
