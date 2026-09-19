import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createShellAPI, createShellStateStore } from '../../core/ShellAPI';

/**
 * `DEVELOPER.md`'s "Testing your extension with a mocked `IShellAPI`" hands
 * authors a stub to copy. It sat at seven members while the interface grew to
 * fourteen, because nothing read it. This reads it.
 *
 * **Names only.** The snippet is not compiled here — its imports are relative to
 * a directory this repository does not have — so a member with the wrong type
 * would pass. What is pinned is that the stub lists exactly the members a real
 * handle has, which is the drift that happened.
 */
const GUIDE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'DEVELOPER.md');

describe('the mocked IShellAPI in DEVELOPER.md', () => {
  it('lists exactly the members a real IShellAPI has', () => {
    const guide = readFileSync(GUIDE, 'utf8');
    const start = guide.indexOf('export function makeShellStub(): IShellAPI {');
    expect(start).toBeGreaterThan(-1);
    const body = guide.slice(start, guide.indexOf('\n}\n', start));
    const stubbed = [...body.matchAll(/^ {4}(\w+): vi\.fn\(/gm)].map((match) => match[1]).sort();

    const real = Object.keys(createShellAPI(createShellStateStore())).sort();
    expect(stubbed).toEqual(real);
  });
});
