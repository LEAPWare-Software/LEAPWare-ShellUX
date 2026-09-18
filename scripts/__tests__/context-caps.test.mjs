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
import { readFileSync } from 'node:fs';
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
