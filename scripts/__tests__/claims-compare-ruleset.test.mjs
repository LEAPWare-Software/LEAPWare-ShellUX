/**
 * Tests for scripts/claims/compare-ruleset.mjs (§3.5).
 *
 * The fixture is the unauthenticated response for ruleset 23685990, captured with an
 * unauthenticated `curl -s` of the REST path
 * `repos/LEAPWare-Software/LEAPWare-ShellUX/rulesets/23685990` on 2026-09-18 and
 * committed verbatim. It carries no `bypass_actors`: GitHub returns that
 * field only to callers with write access, which is why the comparison cannot see it.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareRuleset, fetchLiveRuleset, main } from '../claims/compare-ruleset.mjs';

const declared = JSON.parse(readFileSync(new URL('../../.github/rulesets/main.json', import.meta.url), 'utf8'));
const fixturePath = new URL('./fixtures/claims/ruleset-23685990-unauthenticated.json', import.meta.url);
const live = JSON.parse(readFileSync(fixturePath, 'utf8'));
const clone = (x) => structuredClone(x);
const rule = (r, type) => r.rules.find((x) => x.type === type);

// The captured fixture predates rollout step 4 (PR B), so it carries only the original 5
// required contexts. `appliedLive` is the post-M5-apply shape: the fixture plus the two
// new contexts, with no other change — the baseline every pure-mutation test below starts
// from, so a test's own mutation is the only drift it produces.
function appliedLiveFixture() {
  const applied = clone(live);
  rule(applied, 'required_status_checks').parameters.required_status_checks.push(
    { context: 'Prove claims' },
    { context: 'PR evidence' },
  );
  return applied;
}

describe('the ruleset comparison (§3.5)', () => {
  it('rollout step 4: main.json now declares 2 more required contexts than the captured (pre-apply) live response, and the comparison names exactly that as drift — the S-ruleset window §5 step 4 (M5) expects between merge and apply', () => {
    assert.equal('bypass_actors' in live, false, 'the unauthenticated response omits bypass_actors');
    const { drift, notes } = compareRuleset(declared, live);
    assert.equal(drift.length, 1);
    assert.match(drift[0], /required_status_checks/);
    assert.ok(notes.some((n) => /bypass_actors is not compared/.test(n)));
  });

  it('finds no drift once the live ruleset also carries the two new contexts (the post-apply state)', () => {
    const { drift, notes } = compareRuleset(declared, appliedLiveFixture());
    assert.deepEqual(drift, []);
    assert.ok(notes.some((n) => /bypass_actors is not compared/.test(n)));
    assert.ok(notes.some((n) => /integration_id is not compared/.test(n)));
  });

  it('detects a missing or extra rule type', () => {
    const fewer = appliedLiveFixture();
    fewer.rules = fewer.rules.filter((r) => r.type !== 'merge_queue');
    assert.match(compareRuleset(declared, fewer).drift[0], /rule types differ/);
    const more = appliedLiveFixture();
    more.rules.push({ type: 'required_signatures' });
    assert.match(compareRuleset(declared, more).drift[0], /rule types differ/);
  });

  it('detects a changed declared parameter, and ignores undeclared ones', () => {
    const changed = appliedLiveFixture();
    rule(changed, 'merge_queue').parameters.check_response_timeout_minutes = 60;
    assert.match(compareRuleset(declared, changed).drift[0], /merge_queue.check_response_timeout_minutes/);
    const extra = appliedLiveFixture();
    rule(extra, 'pull_request').parameters.something_new = true;
    assert.deepEqual(compareRuleset(declared, extra).drift, []);
  });

  it('compares declared arrays as a whole: a removed or added check is drift, a reorder is not', () => {
    const removed = appliedLiveFixture();
    rule(removed, 'required_status_checks').parameters.required_status_checks.pop();
    assert.match(compareRuleset(declared, removed).drift[0], /required_status_checks/);
    const added = appliedLiveFixture();
    rule(added, 'required_status_checks').parameters.required_status_checks.push({ context: 'Extra' });
    assert.equal(compareRuleset(declared, added).drift.length, 1);
    const reordered = appliedLiveFixture();
    rule(reordered, 'required_status_checks').parameters.required_status_checks.reverse();
    assert.deepEqual(compareRuleset(declared, reordered).drift, []);
    const methods = appliedLiveFixture();
    rule(methods, 'pull_request').parameters.allowed_merge_methods = ['squash', 'merge'];
    assert.match(compareRuleset(declared, methods).drift[0], /allowed_merge_methods/);
  });

  it('excludes integration_id when the read-only response omits it, and says so', () => {
    // declared already carries integration_id: 15368 on all 7 contexts (rollout step 4);
    // appliedLiveFixture() carries none, same as every response captured so far.
    const { drift, notes } = compareRuleset(declared, appliedLiveFixture());
    assert.deepEqual(drift, []);
    assert.ok(notes.some((n) => /integration_id is not compared/.test(n)));
  });

  it('compares integration_id when the response carries it', () => {
    const liveWithId = appliedLiveFixture();
    for (const c of rule(liveWithId, 'required_status_checks').parameters.required_status_checks) c.integration_id = 1;
    assert.equal(compareRuleset(declared, liveWithId).drift.length, 1);
  });

  it('rollout step 4: main.json declares integration_id 15368 on all 7 required contexts', () => {
    // §3.5's exclusion rule (omit integration_id from comparison when the live response
    // omits it) is what lets these 7 declared entries still compare clean against a
    // read-only response that never carries the field — proven by the two tests above.
    const checks = rule(declared, 'required_status_checks').parameters.required_status_checks;
    assert.equal(checks.length, 7);
    assert.ok(checks.every((c) => c.integration_id === 15368));
  });

  it('rollout step 4: fails when the live response is missing one of the two new required contexts', () => {
    const withOneNewCheck = appliedLiveFixture();
    rule(withOneNewCheck, 'required_status_checks').parameters.required_status_checks.pop(); // drop 'PR evidence'
    assert.match(compareRuleset(declared, withOneNewCheck).drift[0], /required_status_checks/);
  });

  it('detects enforcement switched off', () => {
    const off = appliedLiveFixture();
    off.enforcement = 'disabled';
    assert.match(compareRuleset(declared, off).drift[0], /enforcement/);
  });

  it('does not see a bypass actor added outside main.json (a stated limit)', () => {
    const bypassed = appliedLiveFixture();
    bypassed.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
    assert.deepEqual(compareRuleset(declared, bypassed).drift, []);
  });

  it('finds the live ruleset by name, and fails when there is none', () => {
    const run = (cmd, args) => {
      if (args[1].endsWith('/rulesets')) return { status: 0, stdout: JSON.stringify([{ id: 23685990, name: 'main' }]), stderr: '' };
      return { status: 0, stdout: JSON.stringify(live), stderr: '' };
    };
    assert.equal(fetchLiveRuleset(declared, { run }).id, 23685990);
    const none = () => ({ status: 0, stdout: '[]', stderr: '' });
    assert.throws(() => fetchLiveRuleset(declared, { run: none }), /no live ruleset named main/);
    const failing = () => ({ status: 1, stdout: '', stderr: 'HTTP 404' });
    assert.throws(() => fetchLiveRuleset(declared, { run: failing }), /HTTP 404/);
  });

  it('runs as a command against a saved response', () => {
    // Rollout step 4: the raw captured fixture predates PR B's two new required contexts,
    // so a command run against it exits 1 with exactly the drift the M5 window expects
    // (see the "S-ruleset" test above) — not 0.
    const preApplyLines = [];
    assert.equal(main(['--live', fileURLToPath(fixturePath)], { log: (l) => preApplyLines.push(l) }), 1);
    assert.match(preApplyLines.at(-1), /1 difference/);

    const dir = mkdtempSync(path.join(os.tmpdir(), 'claims-ruleset-'));
    try {
      const applied = appliedLiveFixture();
      writeFileSync(path.join(dir, 'applied.json'), JSON.stringify(applied));
      const lines = [];
      assert.equal(main(['--live', path.join(dir, 'applied.json')], { log: (l) => lines.push(l) }), 0);
      assert.match(lines.at(-1), /no drift/);

      const drifted = clone(applied);
      drifted.enforcement = 'evaluate';
      writeFileSync(path.join(dir, 'r.json'), JSON.stringify(drifted));
      assert.equal(main(['--live', path.join(dir, 'r.json')], { log: () => {} }), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.throws(() => main(['--what']), /unrecognised/);
  });
});
