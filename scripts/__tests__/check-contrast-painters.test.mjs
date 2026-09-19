/**
 * ============================================================================
 * TESTS FOR design/lib/painters.mjs — THE UNPAINTED RULE'S INPUT (GitHub #111).
 * ============================================================================
 * The rule asks "can a module the production build reaches paint this
 * background?". Every case below that expects NOT PAINTED is the #111 shape in
 * one of its costumes: a token named only by the role table, only by a dev
 * fixture, only by a test, only in a comment, or only by a module nothing
 * shipped imports. The trees are in memory, so each case differs from its
 * neighbour by the one edge under test.
 *
 * The bottom block runs against the real repository, so the checker's
 * exemptions are held to being true today: each exempt background is really
 * unpainted by shipped code, and a painted one really is painted.
 * ============================================================================
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TOKEN_CLASS_MODULE,
  documentEntries,
  isPainted,
  painters,
  reachableModules,
  relativeImports,
  repositoryPainters,
  sharedModuleEntries,
  tokenClassRoles,
} from '../../design/lib/painters.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A role table in the shape `tokenClasses.ts` is written in. */
const TABLE = `
export const TOKEN_CLASS = {
  // a comment naming bg-status-info-subtle is not a role
  paneSurface: 'bg-surface-pane',
  bannerWash: 'bg-status-info-subtle',
  ring:
    'focus-visible:ring-focus-ring ' +
    'focus-visible:ring-offset-focus-ring-offset',
} as const;
`;

/** An in-memory repository: path to text. */
function tree(files) {
  const map = new Map(Object.entries({ [TOKEN_CLASS_MODULE]: TABLE, ...files }));
  return {
    exists: (path) => map.has(path),
    read: (path) => map.get(path),
  };
}

function paints(files, token, entries = ['src/main.tsx']) {
  const { exists, read } = tree(files);
  return isPainted(painters(entries, exists, read), token);
}

describe('painters: what counts as painting a background', () => {
  it('counts a reachable module that uses a role naming the token', () => {
    assert.equal(
      paints(
        {
          'src/main.tsx': "import { Banner } from './ui/Banner';",
          'src/ui/Banner.tsx': "import { TOKEN_CLASS } from '../core/theme/tokenClasses';\nTOKEN_CLASS.bannerWash;",
        },
        '--status-info-subtle',
      ),
      true,
    );
  });

  it('does not count the role table itself, which names every token it has a role for', () => {
    assert.equal(
      paints(
        { 'src/main.tsx': "import { TOKEN_CLASS } from './core/theme/tokenClasses';" },
        '--status-info-subtle',
      ),
      false,
    );
  });

  it('does not count a role used only by a dev fixture no production document loads', () => {
    const files = {
      'src/main.tsx': "import './index.css';",
      'src/index.css': 'body {}',
      'src/dev/StatesFixture.tsx': "import { Banner } from '../ui/Banner';",
      'src/ui/Banner.tsx': "import { TOKEN_CLASS } from '../core/theme/tokenClasses';\nTOKEN_CLASS.bannerWash;",
    };
    assert.equal(paints(files, '--status-info-subtle'), false);
    // ...and the same tree painted the moment a shipped module imports it.
    assert.equal(
      paints({ ...files, 'src/main.tsx': "import './ui/Banner';" }, '--status-info-subtle'),
      true,
    );
  });

  it('does not count a direct class in src/dev, even when the dev entry imports it', () => {
    assert.equal(
      paints(
        {
          'src/main.tsx': 'export {};',
          'src/dev/main.states.tsx': "const c = 'bg-status-info-subtle';",
        },
        '--status-info-subtle',
      ),
      false,
    );
  });

  it('counts a role reached through an intermediate class module, as buttonClasses is', () => {
    assert.equal(
      paints(
        {
          'src/main.tsx': "import { X } from './ui/Button';",
          'src/ui/Button.tsx': "import { B } from './buttonClasses';",
          'src/ui/buttonClasses.ts': "import { TOKEN_CLASS } from '../core/theme/tokenClasses';\nconst b = TOKEN_CLASS.ring;",
        },
        '--focus-ring-offset',
      ),
      true,
    );
  });

  it('does not count a test, a generated file, or a comment, even when reached', () => {
    assert.equal(
      paints(
        {
          'src/main.tsx':
            "import './__tests__/x';\nimport './x.test';\nimport './styles/t.generated.css';\n// bg-status-info-subtle\n/* var(--status-info-subtle) */",
          'src/__tests__/x.ts': "'bg-status-info-subtle'",
          'src/x.test.ts': "'bg-status-info-subtle'",
          'src/styles/t.generated.css': '--status-info-subtle: red; .x { background: var(--status-info-subtle) }',
        },
        '--status-info-subtle',
      ),
      false,
    );
  });

  it('still counts a direct utility, var() and quoted name in a reachable module', () => {
    for (const text of ["'bg-surface-sunken'", 'var(--surface-sunken)', "'--surface-sunken'"]) {
      assert.equal(paints({ 'src/main.tsx': text }, '--surface-sunken'), true, text);
    }
  });

  it('does not let a role name that is a prefix of another stand in for it', () => {
    assert.equal(
      paints({ 'src/main.tsx': 'TOKEN_CLASS.bannerWashX;' }, '--status-info-subtle'),
      false,
    );
  });
});

describe('painters: the walk and the table', () => {
  it('reads the module scripts of a document', () => {
    assert.deepEqual(
      documentEntries('<script type="module" src="/src/main.tsx"></script><script src="/a.js">'),
      ['src/main.tsx', 'a.js'],
    );
  });

  it('follows import, export-from and side-effect specifiers, and ignores packages', () => {
    assert.deepEqual(
      relativeImports(
        "import a from './a';\nexport { b } from '../b';\nimport './c.css';\nimport r from 'react';",
      ).sort(),
      ['../b', './a', './c.css'],
    );
  });

  it('skips type-only edges, which the build erases', () => {
    assert.deepEqual(
      relativeImports(
        [
          "import type { A } from './typeOnlyImport';",
          "export type { B } from './typeOnlyExport';",
          'import type {',
          '  C,',
          "} from './typeOnlyMultiline';",
          "import { type D } from './inlineTypeOnly';",
          "import { type E, f } from './mixed';",
          "export * from './star';",
        ].join('\n'),
      ).sort(),
      // `import { type D }` is kept: under verbatimModuleSyntax it survives as a
      // side-effect import, so the module still loads.
      ['./inlineTypeOnly', './mixed', './star'],
    );
  });

  it('does not follow a from-clause inside a string or text that does not begin a statement', () => {
    assert.deepEqual(
      relativeImports(
        "const help = \"write import x from './z' to use it\";\n<p>import a from './y'</p>",
      ),
      [],
    );
  });

  it('does not let a type-only edge make a module reachable', () => {
    const { exists, read } = tree({
      'src/main.tsx': "import type { Props } from './ui/Banner';",
      'src/ui/Banner.tsx': "import { TOKEN_CLASS } from '../core/theme/tokenClasses';\nTOKEN_CLASS.bannerWash;",
    });
    assert.equal(isPainted(painters(['src/main.tsx'], exists, read), '--status-info-subtle'), false);
  });

  it('reads the source paths of the SHARED_MODULES table', () => {
    assert.deepEqual(
      sharedModuleEntries(
        "// ['commented', 'src/no.ts']\nexport const SHARED_MODULES = new Map([\n  ['react', 'src/sdk/shared/react.ts'],\n  ['sdk', 'src/sdk/index.ts'],\n]);",
      ),
      ['src/sdk/shared/react.ts', 'src/sdk/index.ts'],
    );
    assert.deepEqual(sharedModuleEntries('export const OTHER = 1;'), []);
  });

  it('resolves extensionless, .js and index specifiers', () => {
    const { exists, read } = tree({
      'src/main.tsx': "import './a';\nimport './b.js';\nimport './c';",
      'src/a.tsx': '',
      'src/b.ts': '',
      'src/c/index.ts': "import '../d';",
      'src/d.ts': '',
      'src/unreached.ts': '',
    });
    assert.deepEqual(
      [...reachableModules(['src/main.tsx'], exists, read)].sort(),
      ['src/a.tsx', 'src/b.ts', 'src/c/index.ts', 'src/d.ts', 'src/main.tsx'],
    );
  });

  it('joins a role written across lines with +', () => {
    const roles = tokenClassRoles(TABLE);
    assert.deepEqual([...roles.keys()], ['paneSurface', 'bannerWash', 'ring']);
    assert.equal(
      roles.get('ring'),
      'focus-visible:ring-focus-ring focus-visible:ring-offset-focus-ring-offset',
    );
  });
});

describe('painters: the real repository', () => {
  const set = repositoryPainters(ROOT);

  it('starts from the two production documents and the /shared/* inputs, never from dev.html or states.html', () => {
    assert.deepEqual(set.entries, [
      'src/main.tsx',
      'src/paneview/main.paneview.tsx',
      'src/sdk/shared/react.ts',
      'src/sdk/shared/react-jsx-runtime.ts',
      'src/sdk/index.ts',
    ]);
  });

  it('reads every role in tokenClasses.ts, so no role is silently unreadable', () => {
    const source = readFileSync(new URL(`../../${TOKEN_CLASS_MODULE}`, import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export const TOKEN_CLASS = {'));
    const declared = [...body.slice(0, body.indexOf('} as const;')).matchAll(/^ {2}(\w+):/gm)];
    assert.ok(declared.length > 90);
    assert.equal(set.roles.size, declared.length);
  });

  it('holds every W3-1 exemption true: built, and painted by no shipped module', () => {
    for (const token of [
      '--accent-solid',
      '--accent-solid-hover',
      '--accent-subtle',
      '--status-danger-subtle',
      '--status-warning-subtle',
      '--status-success-subtle',
      '--status-info-subtle',
      '--focus-ring-offset',
    ]) {
      assert.equal(isPainted(set, token), false, token);
    }
    assert.equal(isPainted(set, '--surface-pane'), true);
    assert.equal(isPainted(set, '--surface-sunken'), true);
  });

  it('runs the checker to exit 0 end to end', () => {
    const run = spawnSync(process.execPath, ['design/check-contrast.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
  });
});
