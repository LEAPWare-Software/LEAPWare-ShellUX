/**
 * Required-check hygiene (docs/proof-of-completion.md §3.4).
 *
 * A required status check that no workflow produces, or that a workflow produces only on
 * some events, stalls every pull request or silently never runs. This file reads the
 * workflows the way GitHub names their jobs (a matrix expanded into one context per
 * value) and holds the ruleset and the workflows to each other. It also pins the rules
 * the two proof-of-completion workflows must keep: their triggers, no path or branch
 * filters, the `edited` type, read-only permissions, full-history checkout, and the
 * concurrency split between change runs and main runs.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflowsDir = path.join(root, '.github', 'workflows');
const workflows = Object.fromEntries(
  readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => [f, YAML.parse(readFileSync(path.join(workflowsDir, f), 'utf8'))]),
);
const ruleset = JSON.parse(readFileSync(path.join(root, '.github', 'rulesets', 'main.json'), 'utf8'));
const requiredContexts = ruleset.rules
  .find((r) => r.type === 'required_status_checks')
  .parameters.required_status_checks.map((c) => c.context);

/**
 * A name of the one form `${{ github.event_name == 'workflow_dispatch' && 'A' || 'B' }}`
 * resolves to B, the name on every event but a dispatch (the events required checks see).
 * Any other expression is left as written, so it maps to no required context.
 */
const DISPATCH_NAME = /^\$\{\{ github\.event_name == 'workflow_dispatch' && '([^']+)' \|\| '([^']+)' \}\}$/;
export function nameOnEvent(name, event) {
  const m = DISPATCH_NAME.exec(name);
  if (!m) return name;
  return event === 'workflow_dispatch' ? m[1] : m[2];
}

/** The check-run names a job produces on a change event: its `name`, with `${{ matrix.k }}` expanded. */
export function jobContexts(jobId, job) {
  const name = nameOnEvent(job.name ?? jobId, 'pull_request');
  const matrix = job.strategy?.matrix ?? {};
  const keys = Object.keys(matrix).filter((k) => Array.isArray(matrix[k]));
  let names = [name];
  for (const key of keys) {
    const re = new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`, 'g');
    if (!re.test(name)) continue;
    names = names.flatMap((n) => matrix[key].map((v) => n.replace(re, String(v))));
  }
  return names;
}

/** `on:` as an object, whichever of the three YAML shapes it was written in. */
function triggers(wf) {
  const on = wf.on ?? wf[true]; // YAML 1.1 reads a bare `on` key as boolean true
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, null]));
  return on ?? {};
}

const FILTERS = ['paths', 'paths-ignore', 'branches', 'branches-ignore'];

describe('every required context is produced on pull_request and merge_group', () => {
  it('now requires all seven contexts (rollout step 4 added Prove claims and PR evidence)', () => {
    assert.deepEqual(
      [...requiredContexts].sort(),
      [
        'Browser tests (chromium)',
        'Declared Node floor (22.13.0)',
        'PR evidence',
        'Prove claims',
        'Verify (macos-latest)',
        'Verify (ubuntu-latest)',
        'Verify (windows-latest)',
      ],
    );
  });

  it('expands a matrix into one context per value', () => {
    assert.deepEqual(jobContexts('v', { name: 'Verify (${{ matrix.os }})', strategy: { matrix: { os: ['a', 'b'] } } }), ['Verify (a)', 'Verify (b)']);
    assert.deepEqual(jobContexts('plain', {}), ['plain']);
  });

  for (const context of requiredContexts) {
    it(`maps "${context}" to a job that runs, unfiltered, on both events`, () => {
      const producers = Object.entries(workflows).flatMap(([file, wf]) =>
        Object.entries(wf.jobs ?? {})
          .filter(([id, job]) => jobContexts(id, job).includes(context))
          .map(([id]) => ({ file, id, on: triggers(wf) })),
      );
      assert.equal(producers.length, 1, `${context} is produced by ${producers.length} jobs`);
      const [{ file, on }] = producers;
      for (const event of ['pull_request', 'merge_group']) {
        assert.ok(event in on, `${file} does not trigger on ${event}`);
        for (const filter of FILTERS) assert.equal(on[event]?.[filter], undefined, `${file} filters ${event} by ${filter}`);
      }
    });
  }
});

describe('the proof-of-completion workflows (§3.4)', () => {
  const NEW = {
    'claims.yml': { job: 'prove', name: 'Prove claims' },
    'pr-evidence.yml': { job: 'evidence', name: 'PR evidence' },
  };

  for (const [file, { job, name }] of Object.entries(NEW)) {
    describe(file, () => {
      const wf = workflows[file];
      const on = triggers(wf ?? {});

      it(`exists, with job "${name}"`, () => {
        assert.ok(wf, `${file} is missing`);
        for (const event of ['pull_request', 'merge_group', 'push', 'schedule']) assert.equal(nameOnEvent(wf.jobs[job].name, event), name, event);
      });

      it('triggers on pull_request (opened, synchronize, reopened, edited) and merge_group, unfiltered', () => {
        assert.deepEqual([...on.pull_request.types].sort(), ['edited', 'opened', 'reopened', 'synchronize']);
        assert.ok('merge_group' in on);
        for (const event of ['pull_request', 'merge_group']) {
          for (const filter of FILTERS) assert.equal(on[event]?.[filter], undefined, `${event} filtered by ${filter}`);
        }
      });

      it('reads everything and writes nothing at the workflow level', () => {
        assert.deepEqual(wf.permissions, { contents: 'read', 'pull-requests': 'read', actions: 'read', issues: 'read' });
      });

      it('checks out full history, and skips only inside a step except pr-evidence.yml\'s own job-level filter for a non-PR issue comment', () => {
        const steps = wf.jobs[job].steps;
        const checkout = steps.find((s) => String(s.uses ?? '').startsWith('actions/checkout@'));
        assert.equal(checkout.with['fetch-depth'], 0);
        if (file === 'pr-evidence.yml') {
          // issue_comment fires for a plain issue too, which carries no pull request to
          // gate; this is the only job-level if: either workflow carries, and it never
          // makes the "PR evidence" context itself skip on pull_request or merge_group.
          assert.equal(wf.jobs[job].if, "github.event_name != 'issue_comment' || github.event.issue.pull_request != null");
        } else {
          assert.equal(wf.jobs[job].if, undefined, 'the checked job itself has no if:');
        }
      });

      it('is required (rollout step 4, PR B)', () => {
        assert.equal(requiredContexts.includes(name), true);
      });
    });
  }

  it('claims.yml also runs on push to main and on a schedule', () => {
    const on = triggers(workflows['claims.yml']);
    assert.deepEqual(on.push.branches, ['main']);
    assert.ok(Array.isArray(on.schedule) && on.schedule[0].cron);
  });

  it('claims.yml keeps change runs per ref with cancellation, and main runs in one uncancelled group', () => {
    const { group, 'cancel-in-progress': cancel } = workflows['claims.yml'].concurrency;
    const evaluate = (event) => {
      const main = event === 'push' || event === 'schedule' || event === 'workflow_dispatch';
      assert.match(group, /github\.event_name == 'push' \|\| github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\)\) && 'claims-main' \|\| format\('\{0\}-\{1\}', github\.workflow, github\.ref\)/);
      assert.match(cancel, /github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/);
      return { group: main ? 'claims-main' : 'per-ref', cancel: !main };
    };
    assert.deepEqual(evaluate('push'), { group: 'claims-main', cancel: false });
    assert.deepEqual(evaluate('schedule'), { group: 'claims-main', cancel: false });
    assert.deepEqual(evaluate('workflow_dispatch'), { group: 'claims-main', cancel: false });
    assert.deepEqual(evaluate('pull_request'), { group: 'per-ref', cancel: true });
    assert.deepEqual(evaluate('merge_group'), { group: 'per-ref', cancel: true });
  });

  it('claims.yml takes a workflow_dispatch with an inject choice, and pins the INJECT expression to that event', () => {
    const on = triggers(workflows['claims.yml']);
    const inject = on.workflow_dispatch.inputs.inject;
    assert.equal(inject.type, 'choice');
    assert.deepEqual(inject.options, ['none', 'failing-row', 'crash']);
    assert.equal(inject.default, 'none');
    const step = workflows['claims.yml'].jobs.prove.steps.find((s) => s.name === 'Prove claims');
    assert.equal(step.env.INJECT, "${{ github.event_name == 'workflow_dispatch' && inputs.inject || 'none' }}");
    assert.match(step.run, /--inject "\$INJECT"/);
    for (const event of ['pull_request', 'merge_group', 'push']) {
      assert.equal(on[event]?.inputs, undefined, `${event} carries no inputs`);
    }
  });

  it('claims.yml names a dispatch run "Prove claims (dispatch)", so a dispatch never produces the required context', () => {
    const { name } = workflows['claims.yml'].jobs.prove;
    assert.equal(name, "${{ github.event_name == 'workflow_dispatch' && 'Prove claims (dispatch)' || 'Prove claims' }}");
    assert.equal(nameOnEvent(name, 'workflow_dispatch'), 'Prove claims (dispatch)');
    assert.equal(nameOnEvent(name, 'pull_request'), 'Prove claims');
    assert.equal(nameOnEvent('Verify', 'workflow_dispatch'), 'Verify', 'a plain name is the same on every event');
  });

  it('claims.yml uploads and files issues for a workflow_dispatch run only from main', () => {
    const { prove, 'file-issue': issue } = workflows['claims.yml'].jobs;
    const upload = prove.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@'));
    const fromMain = /\(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\)/;
    assert.match(upload.if, fromMain);
    assert.match(issue.if, fromMain);
  });

  it('pr-evidence.yml keeps a per-pull-request group with cancellation, keyed off the PR/issue number so an issue_comment rerun cannot cancel a different PR\'s run', () => {
    assert.deepEqual(workflows['pr-evidence.yml'].concurrency, {
      group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.event.issue.number || github.ref }}",
      'cancel-in-progress': true,
    });
  });

  it('pr-evidence.yml also triggers on issue_comment (created), so a late claude[bot] review comment reruns the gate', () => {
    const on = triggers(workflows['pr-evidence.yml']);
    assert.deepEqual(on.issue_comment, { types: ['created'] });
  });

  it('claims.yml gives main runs 30 minutes and uploads claims-results on main events only', () => {
    const prove = workflows['claims.yml'].jobs.prove;
    assert.match(String(prove['timeout-minutes']), /&& 30 \|\| 10/);
    assert.match(String(prove['timeout-minutes']), /\(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\)\) && 30/);
    const upload = prove.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@'));
    assert.equal(upload.with.name, 'claims-results');
    assert.match(upload.if, /github\.event_name == 'push' \|\| github\.event_name == 'schedule'/);
  });

  it('claims.yml runs repo rows under the unshare wrapper on its Linux runner', () => {
    const prove = workflows['claims.yml'].jobs.prove;
    assert.match(prove['runs-on'], /^ubuntu-/);
    const step = prove.steps.find((s) => s.name === 'Prove claims');
    assert.equal(step.env.CLAIMS_NET_RESTRICT, 'unshare');
  });

  it('files issues from a separate job that needs the proving job, on main events, unless cancelled', () => {
    const job = workflows['claims.yml'].jobs['file-issue'];
    assert.equal(job.needs, 'prove');
    assert.match(job.if, /!cancelled\(\)/);
    assert.match(job.if, /github\.event_name == 'push' \|\| github\.event_name == 'schedule'/);
    assert.equal(job.permissions.issues, 'write');
    const file = job.steps.find((s) => s.name === 'File the failure where someone will see it');
    assert.equal(file.env.ISSUE_TITLE, 'Claims register is failing');
    assert.match(file.run, /gh issue comment/);
    assert.match(file.run, /gh issue create/);
  });
});
