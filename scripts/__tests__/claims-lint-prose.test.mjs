/**
 * Tests for scripts/claims/lint-prose.mjs, the advisory prose lint (§3.8).
 *
 * The fixtures are the r6 prototype's, carried over unchanged: the three incidents of
 * 2026-09-18 in the forms they were written (I1 "zero open pull requests", I2 "npm
 * 10.9.8 crashes on this lockfile", I3 "0 sourcemaps packaged"), and the negated,
 * tagged, fenced and commented forms that must stay quiet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addedLinesFromDiff, blocks, governed, lint, main } from '../claims/lint-prose.mjs';

const all = (t) => new Set(t.split('\n').map((_, i) => i));

const FLAGGED = [
  ['HANDOFF.md', 'There are zero open pull requests.'],
  ['HANDOFF.md', '**Zero open pull requests. 53 open issues. `main` at `6caac5`'],
  ['docs/plans/v1-production.md', 'Zero open pull requests after:'],
  ['CLAUDE.md', '- **npm 10.9.8 crashes on this lockfile** (`edgesOut` of null).'],
  ['docs/traps.md', '### npm 10.9.8 crashes on this lockfile'],
  ['HANDOFF.md', '0 sourcemaps packaged.'],
  ['HANDOFF.md', 'No sourcemaps are packaged.'],
  ['HANDOFF.md', 'Packaging checked: no\nsourcemaps are packaged.'],
  ['docs/plans/v1-production.md', 'Step 0 is 6/6.'],
  ['docs/plans/v1-production.md', '- [x] Merge #115'],
  ['docs/plans/v1-production.md', '* [X] Merge'],
  ['docs/plans/v1-production.md', '1. [x] Merge'],
  ['docs/plans/v1-production.md', '- [x] Triage. **Done 2026-09-18:** merged. Not done: nothing pending.'],
  ['docs/plans/v1-production.md', '## Step 0 complete'],
  ['HANDOFF.md', 'Nothing pending, all done.'],
  ['HANDOFF.md', 'Pending: nothing. Done.'],
  ['HANDOFF.md', 'This is not complete: done in #120'],
  ['HANDOFF.md', 'never fixed; merged later'],
  ['README.md', '`verify` exits 0 on every OS.'],
];

const QUIET = [
  ['HANDOFF.md', '## Not done'],
  ['HANDOFF.md', 'not yet merged'],
  ['HANDOFF.md', 'Zero open pull requests as of 2026-09-18T20:00Z [C-01].'],
  ['CLAUDE.md', 'npm 10.9.8 crashes on the old lockfile [claim:none: historical, see traps table]'],
  ['HANDOFF.md', '```\nzero open pull requests\n```'],
  ['HANDOFF.md', '<!-- claim:none: quoted incident -->\nzero open pull requests\n<!-- /claim -->'],
  ['CHANGELOG.md', '### Fixed'],
];

describe('the advisory prose lint (§3.8)', () => {
  it('flags each incident of 2026-09-18 and leaves the negated forms alone', () => {
    for (const [file, text] of FLAGGED) assert.ok(lint(file, text, all(text)).length > 0, `missed: ${file} ${JSON.stringify(text)}`);
    for (const [file, text] of QUIET) assert.deepEqual(lint(file, text, all(text)), [], `false flag: ${file} ${JSON.stringify(text)}`);
  });

  it('looks only at blocks an added line touches', () => {
    const text = 'Zero open pull requests.\n\nA new line.';
    assert.deepEqual(lint('HANDOFF.md', text, new Set([2])), []);
    assert.equal(lint('HANDOFF.md', text, new Set([0])).length, 1);
  });

  it('splits list items, headings and table rows into their own blocks, and skips comments', () => {
    const b = blocks('# H\n- a\n- b\n| r |\n<!--\nhidden\n-->\npara\nwraps');
    assert.deepEqual(b.map((x) => x.text), ['# H', '- a', '- b', '| r |', 'para wraps']);
  });

  it('lets a negation govern only inside its own clause', () => {
    const t = 'not done';
    assert.equal(governed(t, t.indexOf('done')), true);
    const u = 'not complete: done';
    assert.equal(governed(u, u.indexOf('done')), false);
  });

  it('reads added line numbers from a zero-context diff', () => {
    const diff = [
      'diff --git a/HANDOFF.md b/HANDOFF.md',
      '--- a/HANDOFF.md',
      '+++ b/HANDOFF.md',
      '@@ -3,0 +4,2 @@',
      '+x',
      '+y',
      '@@ -9 +11 @@',
      '+z',
      '--- a/gone.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
    ].join('\n');
    const lines = addedLinesFromDiff(diff);
    assert.deepEqual([...lines.get('HANDOFF.md')], [3, 4, 10]);
    assert.equal(lines.has('/dev/null'), false);
  });

  it('annotates and always exits 0', () => {
    const run = (cmd, args) => {
      if (args[0] === 'diff') return { status: 0, stdout: '+++ b/README.md\n@@ -0,0 +1 @@\n', stderr: '' };
      return { status: 0, stdout: 'base\n', stderr: '' };
    };
    const lines = [];
    const code = main([], { run, log: (l) => lines.push(l) });
    assert.equal(code, 0);
    assert.ok(lines.at(-1).includes('this check never fails'));
    assert.throws(() => main(['--nope'], { run }), /unrecognised/);
  });
});
