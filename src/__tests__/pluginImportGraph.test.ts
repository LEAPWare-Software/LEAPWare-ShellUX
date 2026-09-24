import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * ADR-0006 STEP 7 — THE PACKAGED EXTENSION SURFACE REACHES NEITHER DELETED DIR.
 * ============================================================================
 * `src/mocks/` and `src/examples/` held the two verification remotes and the
 * copyable example until this step. All three moved to `plugins/mail/`,
 * `plugins/database/` and `plugins/hello/`, `FIXTURE_EXTENSIONS` was deleted
 * from `src/paneview/PaneViewShell.tsx`, and the packaged application installs
 * none of the three by default (ADR-0006 decision 12). This is the test the
 * Implementation-sequence table promises for that row: "no module reachable
 * from paneview.html imports src/mocks or src/examples".
 *
 * It is written in `crossDocumentIdref.test.ts`'s manner — a real import-graph
 * walk from the document's own entry point, over the SOURCE, resolved the way
 * the bundler resolves a relative specifier — rather than a directory-existence
 * check, for the same reason that file gives: a convention this test believed
 * would not catch a new import added tomorrow, and a walk of what the bundler
 * would actually pull in does.
 *
 * **What is NOT asserted.** This walks `paneview.html`'s entry
 * (`src/paneview/main.paneview.tsx`) only, because that is the document
 * ADR-0006 decision 12 names: the extension surface, the one that runs plug-in
 * code in the packaged application. `index.html` (host chrome) never imported
 * either mock or the example, and `src/dev/DevShell.tsx` — reached only from
 * `dev.html`, which is not a build input (`vite.config.ts`) — still imports the
 * three plugins' SOURCE on purpose, for the browser dev loop; that import is a
 * relative path OUT of `src/dev/` and into `plugins/`, not into `src/mocks/` or
 * `src/examples/`, so it is not the case this file guards against and this walk
 * never reaches it (`main.paneview.tsx` does not import `DevShell.tsx`).
 * ============================================================================
 */

/** The repository root, resolved from this file's own location. */
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The document this step's promised test names: the packaged extension surface. */
const ENTRY = 'src/paneview/main.paneview.tsx';

/** The two directories this step deletes, as path prefixes relative to `REPO_ROOT`. */
const FORBIDDEN_PREFIXES = ['src/mocks/', 'src/examples/'] as const;

/** Whether a path, relative to `REPO_ROOT`, names or sits under a forbidden directory. */
function isForbiddenPath(path: string): boolean {
  return FORBIDDEN_PREFIXES.some(
    (prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix),
  );
}

/** Every relative import specifier one module's source names. */
function importsOf(file: string, text: string): readonly string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.')
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

/** Resolve one relative specifier the way the bundler does, against `REPO_ROOT`. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = resolve(REPO_ROOT, dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate)) {
      return relative(REPO_ROOT, candidate).split(sep).join('/');
    }
  }
  // A `.css` import, or anything outside a resolvable module. Neither is a
  // module this walk can follow further.
  return null;
}

/** Every module reachable from one entry point, as paths relative to `REPO_ROOT`. */
function moduleGraph(entry: string): Map<string, readonly string[]> {
  const seen = new Map<string, readonly string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    const resolved = importsOf(file, readFileSync(join(REPO_ROOT, file), 'utf8'))
      .map((specifier) => resolveImport(file, specifier))
      .filter((path): path is string => path !== null);
    seen.set(file, resolved);
    for (const path of resolved) {
      queue.push(path);
    }
  }
  return seen;
}

const GRAPH = moduleGraph(ENTRY);

describe('the packaged extension surface — no reachable module imports the deleted fixture directories', () => {
  it('walks a real graph from paneview.html\'s own entry, so an empty scan cannot pass vacuously', () => {
    // Named modules rather than a count, so a walk that silently stopped at the
    // entry point fails here rather than passing everything below.
    expect([...GRAPH.keys()]).toEqual(
      expect.arrayContaining([
        'src/paneview/main.paneview.tsx',
        'src/paneview/PaneViewShell.tsx',
        'src/components/layout/ShellLayout.tsx',
      ]),
    );
  });

  it('reaches no module under src/mocks or src/examples, which ADR-0006 step 7 deleted', () => {
    const offenders = [...GRAPH.keys()].filter(isForbiddenPath);
    expect(offenders).toEqual([]);
  });

  it('reports a path under either deleted directory, so the check above can fail', () => {
    expect(isForbiddenPath('src/mocks/MailPlugin.tsx')).toBe(true);
    expect(isForbiddenPath('src/examples/HelloExtension.tsx')).toBe(true);
    expect(isForbiddenPath('src/mocks')).toBe(true);
    // A near-miss directory name and the real replacement both pass.
    expect(isForbiddenPath('src/mocksomething/File.tsx')).toBe(false);
    expect(isForbiddenPath('plugins/mail/src/MailPlugin.tsx')).toBe(false);
  });
});
