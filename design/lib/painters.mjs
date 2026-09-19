/**
 * ============================================================================
 * WHICH BACKGROUNDS THE SHIPPED SHELL CAN PAINT. THE UNPAINTED RULE'S INPUT.
 * ============================================================================
 * `design/check-contrast.mjs` fails a contrast row whose background nothing
 * paints (GitHub #111). Until wave 3 "nothing paints" meant "no file under
 * `src/` names it", and that stopped being a useful question the day
 * `src/core/theme/tokenClasses.ts` declared roles ahead of their consumers:
 * that file names every background it has a role for, so it alone would
 * satisfy the rule for all of them, which is #111's condition wearing a
 * different file name. A dev-only fixture (`src/dev/**`, `dev.html`,
 * `states.html`) is the same condition again: it renders a primitive the
 * shipped shell does not.
 *
 * So a background now counts as painted only when a module THE PRODUCTION
 * BUILD CAN REACH references it:
 *
 *  1. The entries are the `<script type="module" src>` of the two build inputs
 *     `vite.config.ts` declares, `index.html` and `paneview.html`. `dev.html`
 *     and `states.html` are not entries, so `src/dev/**` and `src/mocks/**`
 *     are reached only if a production module imports them.
 *  2. From there, every RELATIVE import is followed (`import … from './x'`,
 *     `export … from`, and a bare side-effect `import './x.css'`). Package
 *     imports are not followed: nothing in `node_modules` paints a token.
 *  3. `*.generated.*` files and anything under `__tests__` or named `.test.`
 *     are never painters, even if reached: the generated stylesheet DECLARES
 *     every token, which is not painting one.
 *  4. `tokenClasses.ts` is read as a table, never as a painter. A reachable
 *     module paints a token when its text names the token directly (as
 *     before), or names `TOKEN_CLASS.<role>` for a role whose value names it.
 *     `buttonClasses.ts` counts only when something reachable imports it.
 *
 * WHAT THIS IS, IN THIS REPOSITORY'S THREE WORDS: a **guardrail**. It follows
 * static relative imports by regular expression. It does not see a dynamic
 * `import()` (there are none in `src/` today), a path alias (none either), a
 * role reached through `TOKEN_CLASS[name]` (none), or whether a reachable
 * reference is in a branch that ever renders. A reference in reachable dead
 * code still satisfies it. It catches "no shipped module can paint this",
 * which is what #111 was.
 *
 * *Tests:* `scripts/__tests__/check-contrast-painters.test.mjs`.
 * ============================================================================
 */

import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** The build inputs `vite.config.ts` declares. `dev.html` and `states.html` are not. */
export const PRODUCTION_DOCUMENTS = Object.freeze(['index.html', 'paneview.html']);

/** The table of roles, which is read as data and never counted as a painter. */
export const TOKEN_CLASS_MODULE = 'src/core/theme/tokenClasses.ts';

/** Block and line comments removed, so a docblock NAMING a token is not a painter. */
export function stripComments(text) {
  // The line-comment rule skips `://`, so a URL inside a string survives.
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The module scripts an HTML document loads, as repository-relative paths. */
export function documentEntries(html) {
  const found = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+)"/g)) {
    found.push(match[1]);
  }
  return found;
}

/** Every relative specifier a module imports or re-exports, side-effect imports included. */
export function relativeImports(text) {
  const found = [];
  const source = stripComments(text);
  for (const match of source.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g)) found.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g)) found.push(match[1]);
  return found;
}

/** The candidates a relative specifier can resolve to, in Vite's order. */
function candidates(path) {
  const stem = path.replace(/\.js$/, '');
  return [path, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];
}

/**
 * Every module reachable from `entries` by relative imports.
 *
 * `exists` and `read` are injected so the walk can be tested over an in-memory
 * tree; paths are repository-relative with forward slashes throughout.
 */
export function reachableModules(entries, exists, read) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path) || !exists(path)) continue;
    seen.add(path);
    for (const specifier of relativeImports(read(path))) {
      const joined = posix.normalize(posix.join(posix.dirname(path), specifier));
      const resolved = candidates(joined).find((candidate) => exists(candidate));
      if (resolved !== undefined) pending.push(resolved);
    }
  }
  return seen;
}

/** Whether a reached module may count as a painter at all. */
export function canPaint(path) {
  return (
    /\.(tsx?|css)$/.test(path) &&
    !/\.generated\./.test(path) &&
    !/\.test\./.test(path) &&
    !path.split('/').includes('__tests__') &&
    path !== TOKEN_CLASS_MODULE
  );
}

/**
 * The `TOKEN_CLASS` table: role name to its complete class string.
 *
 * Read by regular expression over the source, because the table is a flat
 * object literal of single-quoted strings, some joined with `+`. A value
 * written any other way is not read, and its role then paints nothing, which
 * fails loud as UNPAINTED rather than passing quietly.
 */
export function tokenClassRoles(text) {
  const roles = new Map();
  const source = stripComments(text);
  const start = source.indexOf('export const TOKEN_CLASS = {');
  const end = source.indexOf('} as const;', start);
  if (start === -1 || end === -1) return roles;
  const body = source.slice(start, end);
  for (const match of body.matchAll(/(\w+):\s*((?:'[^']*'\s*\+?\s*)+),/g)) {
    const value = [...match[2].matchAll(/'([^']*)'/g)].map((part) => part[1]).join('');
    roles.set(match[1], value);
  }
  return roles;
}

/** Whether `text` references `token` the way a painter would. */
export function namesToken(text, token) {
  const bare = token.slice(2);
  return new RegExp(
    `(?<![\\w-])[a-z-]+-${bare}(?![\\w-])|var\\(--${bare}\\)|['"\`]--${bare}['"\`]`,
  ).test(text);
}

/**
 * The painter set: the comment-stripped text of every reachable module that
 * can paint, and the role table.
 */
export function painters(entries, exists, read) {
  const texts = [];
  for (const path of reachableModules(entries, exists, read)) {
    if (canPaint(path)) texts.push(stripComments(read(path)));
  }
  const roles = exists(TOKEN_CLASS_MODULE) ? tokenClassRoles(read(TOKEN_CLASS_MODULE)) : new Map();
  return { source: texts.join('\n'), roles };
}

/** Whether the painter set paints `token`, directly or through a `TOKEN_CLASS` role. */
export function isPainted({ source, roles }, token) {
  if (namesToken(source, token)) return true;
  for (const [role, value] of roles) {
    if (namesToken(value, token) && new RegExp(String.raw`\bTOKEN_CLASS\.${role}\b`).test(source)) {
      return true;
    }
  }
  return false;
}

/** The painter set of the repository rooted at `root`, from its production documents. */
export function repositoryPainters(root) {
  const toDisk = (path) => join(root, ...path.split('/'));
  const exists = (path) => statSync(toDisk(path), { throwIfNoEntry: false })?.isFile() === true;
  const read = (path) => readFileSync(toDisk(path), 'utf8');
  const entries = PRODUCTION_DOCUMENTS.flatMap((document) =>
    exists(document) ? documentEntries(read(document)) : [],
  );
  return { entries, ...painters(entries, exists, read) };
}
