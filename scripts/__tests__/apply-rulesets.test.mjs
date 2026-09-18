/**
 * ============================================================================
 * TESTS FOR scripts/apply-rulesets.mjs — no network, no real `gh`.
 * ============================================================================
 * Every test below injects its own `runGh` — a plain function of
 * (argv, input) => {status, stdout, stderr} — in place of `defaultGhRunner`.
 * `run()` (and the smaller functions it calls) take that function as a
 * parameter for exactly this reason: `test:scripts` runs on every CI leg,
 * this repository is currently private, and a test that shelled out for real
 * would either need a live GitHub token in CI or would silently no-op on one.
 * Neither is acceptable for a script whose whole job is the ordering check
 * before a mutating API call.
 *
 * The merge-settings ordering guard (`checkMergeSettingsOrDie`) is the part
 * worth the most coverage: it is the one thing this script does that
 * `lws_apply_rulesets.py` did NOT do until LEAPWare-SessionKeeper's own
 * LWS-D0 finding, so a regression here silently reintroduces a 422 a user
 * would otherwise have to debug live against GitHub's API.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_REPO,
  RULESETS_DIR,
  applyOne,
  checkMergeSettingsOrDie,
  currentMergeSettings,
  loadRulesets,
  requiredMergeSettings,
  run,
} from '../apply-rulesets.mjs';

const SQUASH_RULESET = {
  path: '/fake/.github/rulesets/main.json',
  name: 'main.json',
  data: {
    name: 'main',
    rules: [
      { type: 'deletion' },
      {
        type: 'pull_request',
        parameters: { allowed_merge_methods: ['squash'] },
      },
      {
        type: 'merge_queue',
        parameters: { merge_method: 'SQUASH' },
      },
    ],
  },
};

/** A runGh double that records every call and answers from a script. */
function fakeGh(script) {
  const calls = [];
  const fn = (argv, input) => {
    calls.push({ argv, input });
    const next = script.shift();
    if (!next) {
      throw new Error(`fakeGh: no scripted response left for argv=${JSON.stringify(argv)}`);
    }
    return next;
  };
  fn.calls = calls;
  return fn;
}

describe('requiredMergeSettings', () => {
  it('maps a pull_request rule requiring squash to allow_squash_merge', () => {
    const required = requiredMergeSettings([SQUASH_RULESET]);
    assert.ok(required.has('allow_squash_merge'));
    assert.deepEqual([...required.get('allow_squash_merge')], ['main.json']);
  });

  it('returns an empty map for a ruleset with no merge-method rule', () => {
    const ruleset = {
      path: '/fake/x.json',
      name: 'x.json',
      data: { name: 'x', rules: [{ type: 'deletion' }] },
    };
    const required = requiredMergeSettings([ruleset]);
    assert.equal(required.size, 0);
  });

  it('merges both a pull_request and a merge_queue requirement for the same setting into one file list', () => {
    const required = requiredMergeSettings([SQUASH_RULESET]);
    // Both the pull_request rule (squash) and the merge_queue rule (SQUASH)
    // resolve to the same setting, from the same file — set semantics mean
    // it appears once, not twice.
    assert.deepEqual([...required.get('allow_squash_merge')], ['main.json']);
  });
});

describe('currentMergeSettings', () => {
  it('parses the JSON gh api prints on stdout', () => {
    const gh = fakeGh([
      { status: 0, stdout: '{"allow_squash_merge":true,"allow_merge_commit":false,"allow_rebase_merge":false}\n', stderr: '' },
    ]);
    const settings = currentMergeSettings('OWNER/REPO', gh);
    assert.deepEqual(settings, {
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
    });
    assert.equal(gh.calls.length, 1);
    assert.ok(gh.calls[0].argv.includes('repos/OWNER/REPO'));
  });

  it('throws with gh stderr attached when the api call fails', () => {
    const gh = fakeGh([{ status: 1, stdout: '', stderr: 'HTTP 404: Not Found' }]);
    assert.throws(() => currentMergeSettings('OWNER/REPO', gh), /404/);
  });
});

describe('checkMergeSettingsOrDie — the ordering guard', () => {
  it('does nothing when no ruleset requires a merge method', () => {
    const noMethodRuleset = {
      path: '/fake/x.json',
      name: 'x.json',
      data: { name: 'x', rules: [{ type: 'deletion' }] },
    };
    const gh = fakeGh([]); // never called
    assert.doesNotThrow(() => checkMergeSettingsOrDie('OWNER/REPO', [noMethodRuleset], gh));
    assert.equal(gh.calls.length, 0);
  });

  it('passes silently when the repo already allows the required merge method', () => {
    const gh = fakeGh([
      { status: 0, stdout: '{"allow_squash_merge":true,"allow_merge_commit":false,"allow_rebase_merge":false}', stderr: '' },
    ]);
    assert.doesNotThrow(() => checkMergeSettingsOrDie('OWNER/REPO', [SQUASH_RULESET], gh));
  });

  it('throws the exact remediation command when allow_squash_merge is not yet enabled — the 422 this guard exists to prevent', () => {
    const gh = fakeGh([
      { status: 0, stdout: '{"allow_squash_merge":false,"allow_merge_commit":false,"allow_rebase_merge":false}', stderr: '' },
    ]);
    let thrown;
    try {
      checkMergeSettingsOrDie('OWNER/REPO', [SQUASH_RULESET], gh);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, 'expected checkMergeSettingsOrDie to throw');
    assert.match(thrown.message, /gh api -X PATCH repos\/OWNER\/REPO/);
    assert.match(thrown.message, /allow_squash_merge=true, required by: main\.json/);
  });
});

describe('applyOne', () => {
  it('dry-run prints the ruleset JSON and calls gh zero times', () => {
    const gh = fakeGh([]);
    const lines = [];
    applyOne('OWNER/REPO', SQUASH_RULESET, /* dryRun */ true, gh, (line) => lines.push(line));
    assert.equal(gh.calls.length, 0);
    assert.ok(lines.some((line) => line.includes('main.json')));
    assert.ok(lines.some((line) => line.includes('"name": "main"')));
  });

  it('creates via POST when no ruleset with that name exists yet (empty lookup result)', () => {
    const gh = fakeGh([
      { status: 0, stdout: '', stderr: '' }, // existingRulesetId lookup: nothing found
      { status: 0, stdout: '{"id":1}', stderr: '' }, // the POST itself
    ]);
    const lines = [];
    applyOne('OWNER/REPO', SQUASH_RULESET, false, gh, (line) => lines.push(line));
    assert.equal(gh.calls.length, 2);
    assert.ok(gh.calls[1].argv.includes('POST'));
    assert.ok(lines.some((line) => line.includes('created')));
  });

  it('updates via PUT against the existing id when the lookup finds one', () => {
    const gh = fakeGh([
      { status: 0, stdout: '42\n', stderr: '' }, // existingRulesetId lookup: id 42
      { status: 0, stdout: '{"id":42}', stderr: '' }, // the PUT itself
    ]);
    const lines = [];
    applyOne('OWNER/REPO', SQUASH_RULESET, false, gh, (line) => lines.push(line));
    assert.equal(gh.calls.length, 2);
    assert.ok(gh.calls[1].argv.includes('PUT'));
    assert.ok(gh.calls[1].argv.some((arg) => arg.includes('rulesets/42')));
    assert.ok(lines.some((line) => line.includes('updated')));
  });

  it('throws, naming the ruleset file, when the mutating gh call fails', () => {
    const gh = fakeGh([
      { status: 0, stdout: '', stderr: '' },
      { status: 1, stdout: '', stderr: '422 Unprocessable Entity' },
    ]);
    assert.throws(
      () => applyOne('OWNER/REPO', SQUASH_RULESET, false, gh, () => {}),
      /FAILED applying main\.json.*422/s,
    );
  });
});

describe('run — the whole apply, wired together', () => {
  it('runs the ordering guard before applying any ruleset when not a dry run', () => {
    const gh = fakeGh([
      { status: 0, stdout: '{"allow_squash_merge":false}', stderr: '' }, // the guard's own lookup
    ]);
    assert.throws(
      () => run({ repo: 'OWNER/REPO', dryRun: false, rulesets: [SQUASH_RULESET], runGh: gh }),
      /repo settings are not ready/,
    );
    // The guard's single lookup call happened; applyOne's calls never did.
    assert.equal(gh.calls.length, 1);
  });

  it('skips the ordering guard entirely on a dry run', () => {
    const gh = fakeGh([]); // would throw on any call — dry run must make none
    const lines = [];
    assert.doesNotThrow(() =>
      run({ repo: 'OWNER/REPO', dryRun: true, rulesets: [SQUASH_RULESET], runGh: gh, log: (l) => lines.push(l) }),
    );
    assert.equal(gh.calls.length, 0);
    assert.ok(lines.some((line) => line.includes('main.json')));
  });

  it('throws when handed an empty ruleset list, before touching gh', () => {
    const gh = fakeGh([]);
    assert.throws(
      () => run({ repo: 'OWNER/REPO', dryRun: true, rulesets: [], runGh: gh }),
      /no \*\.json rulesets found/,
    );
  });
});

describe('loadRulesets — against the real repository files, no mocking', () => {
  it('finds this repo\'s own .github/rulesets/main.json and it names itself "main"', () => {
    const rulesets = loadRulesets(RULESETS_DIR);
    assert.ok(rulesets.length >= 1, `expected at least one ruleset file under ${RULESETS_DIR}`);
    const main = rulesets.find((r) => r.name === 'main.json');
    assert.ok(main, 'expected .github/rulesets/main.json to exist');
    assert.equal(main.data.name, 'main');
  });

  it('every loaded ruleset requires squash, which is what DEFAULT_REPO must already allow before a real apply', () => {
    const rulesets = loadRulesets(RULESETS_DIR);
    const required = requiredMergeSettings(rulesets);
    assert.ok(required.has('allow_squash_merge'));
  });
});

describe('DEFAULT_REPO', () => {
  it('names this repository, not a template repo left over from a port', () => {
    assert.equal(DEFAULT_REPO, 'LEAPWare-Software/LEAPWare-ShellUX');
  });
});
