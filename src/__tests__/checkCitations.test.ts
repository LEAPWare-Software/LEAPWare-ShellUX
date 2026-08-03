import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * THE CHECKER THAT ENFORCES AMENDMENT G, CHECKED.
 * ============================================================================
 * `scripts/check-citations.mjs` resolves every quoted test title cited in prose
 * against the titles the suite really declares. It exists because a citation
 * naming a renamed or deleted test reads as evidence and is not.
 *
 * A checker with no tests is the same shape of problem one rung down — issue #11
 * records exactly that about `scripts/check-portability.mjs` — and the failure
 * mode is worse here than elsewhere, because this tool's whole value is its
 * false-positive rate. A checker that reports titles which are plainly present
 * gets ignored within a week, and an ignored checker is indistinguishable from
 * no checker while looking like enforcement in CI.
 *
 * **Everything below drives the real CLI as a subprocess**, over fixture trees
 * written to a scratch directory and passed with `--scan`. Nothing here imports
 * the script's internals, so the exit codes are the ones `npm run verify` will
 * see and the parsing is the parsing the repository gets. The two cases that
 * earn their place most are the ones a naive implementation gets wrong in
 * opposite directions:
 *
 *   - an `it.each` title, whose `%s` is filled in at run time, so prose cites a
 *     spelling that appears nowhere in the source;
 *   - a title containing an embedded `\"`, which a reader that stops at the
 *     first bare quote splits into three fragments and reports three times.
 *
 * Both were found by a manual sweep before this file existed, which is the
 * argument for this file existing.
 *
 * A third case was added later, and it is the one this file previously got
 * wrong. An `it.each` title whose placeholder is its LAST token has no literal
 * text to the right of the hole, so the anchor that fences a mid-title
 * placeholder does nothing and the pattern collapses into a prefix match over
 * the entire suite. The fixture that was meant to hold that line had a long
 * literal tail, which is exactly the shape that cannot exhibit the defect — the
 * case passed, and would have gone on passing against the broken compiler. The
 * lesson generalises past this file: a test aimed at a degenerate position has
 * to be written IN that position, or it tests the comfortable case and reports
 * the answer for the uncomfortable one.
 *
 * What is NOT asserted here: that the checker finds every kind of stale
 * citation. It cannot tell that a security sentence carries no citation at all —
 * the harder half of Amendment G, tracked as issue #5 — and the fixtures below
 * make no attempt to pretend otherwise.
 * ============================================================================
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = join(REPO_ROOT, 'scripts', 'check-citations.mjs');

const SCRATCH = mkdtempSync(join(tmpdir(), 'shellux-citations-'));
afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

let fixtureCount = 0;

/**
 * The suite every fixture cites against.
 *
 * Written as source rather than as a list of titles because the checker reads
 * titles out of the TypeScript AST, so the shapes it has to cope with — a
 * `describe` wrapper, an `it.each` template, a title carrying its own quotes —
 * only exist as source.
 */
const SUITE = [
  "import { describe, it } from 'vitest';",
  '',
  "describe('outer group', () => {",
  "  it('resolves a plain title', () => {});",
  '  it(\'never stores "__proto__" as a live key\', () => {});',
  "  it.each(['alt', 'ctrl'])('reads hotkey.%s exactly once, so no later read can differ', () => {});",
  // A template whose placeholder is the FINAL token. The line above cannot stand
  // in for this one: its eight literal trailing words fence the placeholder on
  // both sides, so it passes against a compiler that is wrong in the only
  // position where the wrongness has consequences. See the pair of cases below.
  "  it.each(['input', 'textarea'])('rejects focus inside %s', () => {});",
  "  it('validateBlueprint — text fields', () => {});",
  "  it('validateBlueprint — navigation tree', () => {});",
  '});',
  '',
].join('\n');

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Citations counted by the run, read back off the checker's own report. */
  readonly citations: number;
}

/** Write a fixture tree and run the real CLI over it. */
function run(files: Record<string, string>): Run {
  fixtureCount += 1;
  const root = join(SCRATCH, `fixture-${fixtureCount}`);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }

  const result = spawnSync(process.execPath, [CHECKER, '--scan', root], { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw result.error;
  }
  // The total is spelled differently on the two paths — "N citations in …" when
  // everything resolved, "R of N cited titles resolved …" when something did
  // not — and it is the total, never the resolved count, that these tests assert.
  const report = `${result.stdout}${result.stderr}`;
  const counted = /(?:— (\d+) citations in)|(?:\d+ of (\d+) cited titles)/.exec(report);
  const total = counted === null ? undefined : (counted[1] ?? counted[2]);

  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    citations: total === undefined ? -1 : Number(total),
  };
}

/** A fixture whose only prose is the one Markdown document under test. */
function withProse(prose: string): Run {
  return run({ 'suite.test.ts': SUITE, 'GUIDE.md': prose });
}

describe('check-citations — a citation that resolves', () => {
  it('accepts a title that names a real it(), and exits 0', () => {
    const result = withProse('The store is host-owned. *Tests:* `suite.test.ts` — "resolves a plain title".\n');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('accepts a describe > it path, because prose cites the group as often as the case', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "outer group > resolves a plain title".\n');

    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('accepts the "pinned by" spelling as well as the "*Tests:*" one', () => {
    const result = withProse('Pinned by "resolves a plain title" in `suite.test.ts`.\n');

    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('reads a citation that runs across a line break as one title', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "reads hotkey.alt exactly once, so no\nlater read can differ".\n');

    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });
});

describe('check-citations — a citation that does not resolve', () => {
  it('reports a title that names no test, with the file, the line and the title', () => {
    const result = withProse(
      'A claim about the registry.\n\n*Tests:* `suite.test.ts` — "a title that was renamed away last week".\n',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved-test-title');
    expect(result.stderr).toContain('GUIDE.md:3');
    expect(result.stderr).toContain('"a title that was renamed away last week"');
  });

  it('reports a cited test file that exists nowhere, which is how a renamed file is caught', () => {
    const result = withProse('*Tests:* `deleted-suite.test.ts` — "resolves a plain title".\n');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown-test-file');
    expect(result.stderr).toContain('deleted-suite.test.ts');
    // The title itself is present, so only the path is reported. Both halves are
    // checked, and they are checked independently.
    expect(result.stderr).not.toContain('unresolved-test-title');
  });

  it('reports one violation per unresolved title and none for the resolving ones beside it', () => {
    const result = withProse(
      '*Tests:* `suite.test.ts` — "resolves a plain title", "no such test as this one",\n' +
        '"never stores \\"__proto__\\" as a live key" and "nor is there a test called this".\n',
    );

    expect(result.status).toBe(1);
    expect(result.stderr.match(/unresolved-test-title/g)).toHaveLength(2);
    expect(result.stderr).toContain('"no such test as this one"');
    expect(result.stderr).toContain('"nor is there a test called this"');
    expect(result.citations).toBe(4);
  });
});

describe('check-citations — it.each templates', () => {
  /**
   * `it.each(['alt', 'ctrl'])('reads hotkey.%s exactly once, …')` emits
   * `reads hotkey.alt …` and `reads hotkey.ctrl …` at run time. Prose cites what
   * a developer sees in the test output, so the spelling in the document appears
   * nowhere in the source and a literal comparison reports a test that plainly
   * exists. There are real instances in
   * `src/core/__tests__/registrySecurity.test.tsx`.
   */
  it('resolves a citation of the interpolated form against the %s template', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "reads hotkey.alt exactly once, so no later read can differ".\n');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('resolves a citation that quotes the template verbatim, %s and all', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "reads hotkey.%s exactly once, so no later read can differ".\n');

    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('does not let the placeholder swallow the rest of the sentence', () => {
    // `%s` stands for one interpolated value, not for "anything at all". A title
    // that shares the template's prefix and abandons its tail is a different
    // title, and treating the placeholder as a wildcard over the whole string
    // would make this pass — which would make the whole rule decorative.
    //
    // Note what this case does NOT establish. Its placeholder sits in the middle
    // of the template, so the literal words after it anchor the match whatever
    // the placeholder compiles to. It passed against a compiler that turned a
    // placeholder into `.+?`, and a placeholder in final position compiled that
    // way is a prefix match over the entire suite. The two cases below are the
    // ones that hold that position; this one covers the interior only.
    const result = withProse('*Tests:* `suite.test.ts` — "reads hotkey.alt exactly once, so something else entirely".\n');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved-test-title');
  });

  /**
   * The defect a template with a trailing placeholder exposes, and the only
   * position in which it is exposed.
   *
   * `rejects focus inside %s` has nothing to the right of its placeholder but
   * the end-of-string anchor, so compiling the placeholder to `.+?` yields
   * `^rejects focus inside .+?$` — a pattern that resolves ANY citation opening
   * with those three words, including one naming a test that was renamed away.
   * Against the real suite this repository ships, patterns of that shape matched
   * 118 concrete titles they do not name, and shadowed 16 titles cited in prose:
   * each of those sixteen could have been renamed with its citation left
   * pointing at nothing and this checker still reporting a clean run. A gate
   * that stays green through the rename it exists to catch is worse than none,
   * which is why this case is asserted from both directions.
   */
  it('does not let a placeholder in final position match an arbitrary tail', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "rejects focus inside a contenteditable region".\n');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unresolved-test-title');
    expect(result.stderr).toContain('"rejects focus inside a contenteditable region"');
  });

  it('still resolves the interpolated form of a title whose placeholder is final', () => {
    // The other direction. Narrowing the placeholder must not cost the feature
    // the pattern exists for: `textarea` is a row of the table, so this citation
    // names a test that really runs and must resolve.
    const result = withProse('*Tests:* `suite.test.ts` — "rejects focus inside textarea".\n');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });
});

describe('check-citations — titles containing embedded double quotes', () => {
  /**
   * Prose writes an embedded quote as `\"`. A reader that stops at the first
   * bare `"` splits `never stores \"__proto__\" as a live key` into three
   * fragments and reports all three, which is one missing test reported three
   * times about a test that is present — the exact false positive that would
   * retire this checker.
   */
  it('resolves a title whose own text carries escaped quotes', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "never stores \\"__proto__\\" as a live key".\n');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('reports such a title as ONE violation carrying its quotes, not three fragments', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "never stores \\"__nope__\\" as a live key".\n');

    expect(result.status).toBe(1);
    expect(result.stderr.match(/unresolved-test-title/g)).toHaveLength(1);
    expect(result.stderr).toContain('never stores "__nope__" as a live key');
    expect(result.citations).toBe(1);
  });
});

describe('check-citations — prose that cites nothing', () => {
  it('finds no citations in a document with no marker, and exits 0', () => {
    const result = withProse(
      '# A document\n\n' +
        'This paragraph discusses the architecture and quotes "a phrase of several words"\n' +
        'without citing any test at all, because it asserts no security property.\n',
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(0);
  });

  it('does not read a marker out of a fenced code block, which documents the convention', () => {
    const result = withProse('How to cite a test:\n\n```md\n*Tests:* `suite.test.ts` — "a title nobody wrote"\n```\n');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(0);
  });
});

describe('check-citations — TypeScript sources', () => {
  it('reads a citation out of a docblock, asterisk decoration and line wrapping included', () => {
    const result = run({
      'suite.test.ts': SUITE,
      'module.ts': [
        '/**',
        ' * The registry stores a plain entry. Pinned by "never stores \\"__proto__\\" as a',
        ' * live key" in `suite.test.ts`.',
        ' */',
        'export const value = 1;',
        '',
      ].join('\n'),
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });

  it('reads comments only, so a marker inside a string literal is not a citation', () => {
    const result = run({
      'suite.test.ts': SUITE,
      'module.ts': 'export const doc = \'Pinned by "a title that does not exist anywhere" in `suite.test.ts`\';\n',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(0);
  });

  it('stops a citation window at the blank line that ends a docblock paragraph', () => {
    const result = run({
      'suite.test.ts': SUITE,
      'module.ts': [
        '/**',
        ' * Pinned by "resolves a plain title" in `suite.test.ts`.',
        ' *',
        ' * A separate paragraph, which mentions "a quoted phrase of its own" and is not',
        ' * part of the citation above.',
        ' */',
        'export const value = 1;',
        '',
      ].join('\n'),
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(1);
  });
});

describe('check-citations — the elided form', () => {
  /**
   * Prose citing several cases from one `describe` writes the shared prefix once
   * and elides it after: `"validateBlueprint — text fields", "— navigation
   * tree"`. Read literally the second names no test; read the way it is written
   * it names one that exists.
   */
  it('restores the antecedent prefix onto an em-dash elision', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "validateBlueprint — text fields", "— navigation tree".\n');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.citations).toBe(2);
  });

  it('still reports an elision that resolves to nothing even once restored', () => {
    const result = withProse('*Tests:* `suite.test.ts` — "validateBlueprint — text fields", "— no such group".\n');

    expect(result.status).toBe(1);
    expect(result.stderr.match(/unresolved-test-title/g)).toHaveLength(1);
    expect(result.stderr).toContain('"— no such group"');
  });
});

describe('check-citations — the contract of the command itself', () => {
  it('exits 2 rather than reporting everything when it can find no test files at all', () => {
    const result = run({ 'GUIDE.md': '*Tests:* `suite.test.ts` — "resolves a plain title".\n' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('found no test files');
    expect(result.stderr).not.toContain('unresolved-test-title');
  });

  it('says on a clean run that it does not check whether a claim carries a citation', () => {
    // The honest limit is printed on success, not buried in a comment, because
    // this command's output is where a reader forms their belief about how much
    // of Amendment G is enforced. Half of it is not.
    const result = withProse('*Tests:* `suite.test.ts` — "resolves a plain title".\n');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('not that every security claim');
  });
});
