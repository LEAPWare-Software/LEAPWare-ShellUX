/**
 * The three context files, held to the caps the owner set on 2026-09-17.
 *
 * `CLAUDE.md` is loaded into every session in this repository, and `HANDOFF.md` is
 * the first thing a resuming session reads. Both had grown past any reader's
 * attention: on 2026-09-18 `HANDOFF.md` measured 70,219 bytes against a 3000-byte cap
 * and `CLAUDE.md` 334 lines against 200. A cap that nothing measures is advice, so
 * this file measures it, inside `test:scripts` and therefore inside `verify`.
 *
 * A cap reached is a signal to move content into `docs/`, never to trim meaning.
 * `docs/` itself is uncapped.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => readFileSync(root + name);

export const HANDOFF_MAX_BYTES = 3000;
export const CLAUDE_MAX_LINES = 200;

describe('context files — held to the owner caps of 2026-09-17', () => {
  it('keeps HANDOFF.md within 3000 bytes', () => {
    const bytes = read('HANDOFF.md').length;
    assert.ok(
      bytes <= HANDOFF_MAX_BYTES,
      `HANDOFF.md is ${bytes} bytes; the cap is ${HANDOFF_MAX_BYTES}. Move content into docs/, do not trim meaning.`,
    );
  });

  it('keeps CLAUDE.md within 200 lines', () => {
    const text = read('CLAUDE.md').toString('utf8');
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    assert.ok(
      lines <= CLAUDE_MAX_LINES,
      `CLAUDE.md is ${lines} lines; the cap is ${CLAUDE_MAX_LINES}. Move detail into docs/, keep pointers and rules.`,
    );
  });
});

/**
 * C-08's check compares the archived §2-§12 body against the pre-recast HANDOFF.md at
 * `5b3a6ff~1`, which it reads out of the local object store. In a clone without that
 * commit it cannot compare at all — and it used to say so by printing 0, the same value
 * it prints when the two texts really differ. That is the "I checked and found nothing"
 * / "I could not check" conflation, and it cost three red CI legs on a tree where
 * nothing had changed. The two cases now print different things.
 */
describe('context-caps check — a history it cannot read is not a mismatch', () => {
  const check = path.join(root, 'scripts', 'claims', 'checks', 'context-caps.mjs');
  const run = (env) => spawnSync(process.execPath, [check], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  const verbatimLine = (stdout) => stdout.split('\n').find((l) => l.startsWith('handoff_archive_verbatim='));

  it('prints 1 on this tree, where the pre-recast commit is readable', () => {
    const { status, stdout } = run({});
    assert.equal(status, 0);
    assert.equal(verbatimLine(stdout), 'handoff_archive_verbatim=1');
  });

  it('names the unreadable history instead of reporting a mismatch', () => {
    // GIT_DIR at a path that is not a repository is what a depth-1 clone amounts to for
    // this one revision: `git show 5b3a6ff~1:HANDOFF.md` exits non-zero either way.
    const { status, stdout } = run({ GIT_DIR: path.join(root, 'no-such-git-dir') });
    assert.equal(status, 0);
    assert.equal(verbatimLine(stdout), 'handoff_archive_verbatim=unreadable:no-5b3a6ff-in-history');
  });
});
