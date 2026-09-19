/**
 * Tests for scripts/check-portability.mjs — the mechanical half of ADR-0002.
 *
 * WHY A SUBPROCESS AND NOT AN IMPORT. The checker is a script, not a module: it
 * runs on import, it calls `process.exit`, and it locates the repository it scans
 * from its own file location. Making its internals importable would mean
 * restructuring a gate that runs on three operating systems in CI, and the
 * restructure would not buy much — the defects this file exists to catch are
 * *contract* defects. Which rules fire, what the message says, and which of the
 * three exit codes comes back are the things a caller depends on, and three of the
 * rules (case-exactness against the index, import resolution, symlinked-path) are
 * only meaningful against a real git index and a real filesystem. So each test
 * builds a throwaway repository in a temporary directory, drops a copy of the real
 * checker into its `scripts/` directory — which is how the checker learns where
 * the repository root is — and runs it exactly as `npm run check:portability`
 * does, asserting on the exit status and the parsed report.
 *
 * Run with `node --test scripts/__tests__/`. Node's own test runner, so this adds
 * no dependency, which is the same reason the checker itself has none. Vitest is
 * deliberately not used: `vitest.config.ts` scopes `include` to
 * `src/**` with a written reason, and a build script is not `src/`.
 *
 * WHY NO SAMPLE HERE IS WRITTEN AS A LITERAL. This file is tracked, so the checker
 * under test also checks this file. A drive-letter path or a home directory
 * written out here would be a real violation of this repository, and
 * `npm run check:portability` would fail on the very suite that proves it works —
 * a fixture containing a fake Windows path is exactly what the checker is designed
 * to reject, and it cannot tell a fake one from a real one. Every sample that is
 * *meant* to violate a rule is therefore assembled at run time from fragments that
 * match nothing on their own, via `assemble` below. Read the assembled value, not
 * the fragments.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = resolve(HERE, '..', 'check-portability.mjs');

/** One backslash, never spelled as one in this file. See the header. */
const BS = String.fromCharCode(92);

/**
 * Concatenate fragments into a sample that would violate a rule.
 *
 * The join is what matters: the fragments are separated by quotes and commas in
 * this source, so no rule pattern matches them here, and they are adjacent only in
 * the fixture file that is written at run time.
 */
const assemble = (...fragments) => fragments.join('');

// ---------------------------------------------------------------------------
// Fixture machinery
// ---------------------------------------------------------------------------

/**
 * `realpathSync`, because a temporary directory is a symbolic link on some
 * platforms — macOS resolves its temporary root through one — and both git's
 * ceiling-directory matching and this suite's own symlink assertions compare
 * resolved paths.
 */
const BASE = realpathSync(mkdtempSync(join(tmpdir(), 'shellux-portability-')));

after(() => rmSync(BASE, { recursive: true, force: true, maxRetries: 5 }));

/**
 * An environment with git's own location overrides stripped, so a fixture can
 * never be scanned against the repository this suite is running from.
 */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_GLOBAL']) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let fixtureCount = 0;

/**
 * A throwaway repository with a copy of the real checker in its `scripts`
 * directory. The copy is left untracked on purpose: it is the tool under test, not
 * a file under test, and tracking it would add its own rule table to every
 * fixture's findings.
 */
function newRepo(name, { init = true } = {}) {
  fixtureCount += 1;
  const root = join(BASE, `${fixtureCount}-${name}`);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(CHECKER, join(root, 'scripts', 'check-portability.mjs'));
  if (init) git(root, 'init', '-q');
  return root;
}

function write(root, relative, content) {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return relative;
}

/** `-f`, so a contributor's global ignore file cannot quietly empty a fixture. */
function track(root, ...paths) {
  git(root, 'add', '-f', '--', ...paths);
}

/**
 * Put a path in the index that the working tree does not have, or cannot have.
 *
 * Three fixtures need this and none of them can use `git add`: a case-colliding
 * pair cannot both exist on a case-insensitive filesystem, a tracked symbolic link
 * is a `120000` blob rather than a file, and `git add` refuses to walk through a
 * link to reach a path on the far side of one.
 */
function trackInIndexOnly(root, relative, content, mode = '100644') {
  const object = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], {
    input: content,
    encoding: 'utf8',
    env: cleanEnv(),
  }).trim();
  git(root, 'update-index', '--add', '--cacheinfo', `${mode},${object},${relative}`);
}

const VIOLATION_LINE = /^ {2}(.+?):(\d+):(\d+) {2}([a-z-]+)$/;

/** Parse the report back out of stderr, which is the interface a reader actually gets. */
function parse(stderr) {
  const lines = stderr.split('\n');
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = VIOLATION_LINE.exec(lines[index] ?? '');
    if (match === null) continue;
    found.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      rule: match[4],
      what: (lines[index + 1] ?? '').trim().replace(/^found /, ''),
      text: (lines[index + 2] ?? '').trim(),
    });
  }
  return found;
}

function run(root, env = {}) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'check-portability.mjs')], {
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    violations: parse(result.stderr),
  };
}

const rulesFor = (report, file) => report.violations.filter((v) => v.file === file).map((v) => v.rule);
const ruleIds = (report) => [...new Set(report.violations.map((v) => v.rule))];

/** A login name no machine has, so the developer-username rule is testable anywhere. */
const inventLogin = () => `u${randomUUID().replace(/-/g, '').slice(0, 12)}`;

// ---------------------------------------------------------------------------
// Content rules
// ---------------------------------------------------------------------------

/** One file per rule, all in one repository, so the whole table costs one run. */
const FIRING = [
  { rule: 'windows-drive-path', file: 'src/drive.ts', text: assemble('D', ':', BS, 'projects', BS, 'app') },
  { rule: 'home-directory-path', file: 'src/home.ts', text: assemble('/', 'home', '/', 'someone', '/', 'app') },
  { rule: 'environment-home-reference', file: 'src/env-var.ts', text: assemble('%', 'USERPROFILE', '%') },
  { rule: 'environment-home-reference', file: 'src/env-home.ts', text: assemble('$', '{HOME}', '/app') },
  { rule: 'environment-home-reference', file: 'src/env-tilde.ts', text: assemble(' ', '~', '/', 'app') },
  { rule: 'appdata-path', file: 'src/appdata.ts', text: assemble('App', 'Data') },
  { rule: 'temp-or-scratch-path', file: 'src/temp.ts', text: assemble('/', 'tmp', '/', 'build-output') },
  { rule: 'temp-or-scratch-path', file: 'src/scratch.ts', text: assemble('scratch', 'pad') },
  { rule: 'absolute-posix-path', file: 'src/posix.ts', text: assemble('/', 'usr', '/', 'local', '/', 'lib') },
  { rule: 'unc-path', file: 'src/unc.ts', text: assemble(' ', BS, BS, 'fileserver', '.', 'corp', BS, 'share') },
  { rule: 'hardcoded-ip-address', file: 'src/ip.ts', text: assemble('203', '.', '0', '.', '113', '.', '7') },
  {
    rule: 'hardcoded-hostname',
    file: 'src/host.ts',
    text: assemble('https', ':', '/', '/', 'build', '.', 'internal', '.', 'acme-corp', '.', 'net'),
  },
  { rule: 'undocumented-port', file: 'src/port.ts', text: assemble('port', ' = ', '8080') },
];

/**
 * Files that look close enough to a rule to be worth pinning down, and that must
 * produce nothing. Each one is a decision the checker's header documents.
 */
const ACCEPTED = [
  {
    file: 'src/loopback.ts',
    text: assemble('127', '.', '0', '.', '0', '.', '1'),
    why: 'loopback names no machine',
  },
  {
    file: 'src/version.ts',
    text: assemble('999', '.', '1', '.', '2', '.', '3'),
    why: 'an octet above 255 is a version number, not an address',
  },
  {
    file: 'src/reserved-host.ts',
    text: assemble('https', ':', '/', '/', 'docs', '.', 'example', '.', 'com'),
    why: 'RFC 2606 reserves example.com for documentation',
  },
  {
    file: 'src/single-label.ts',
    text: assemble('https', ':', '/', '/', 'shellux', '/', 'index'),
    why: 'a single-label authority resolves nowhere public, so it is sample data',
  },
  {
    file: 'src/documented-port.ts',
    text: assemble('port', ' = ', '5173'),
    why: "Vite's default dev-server port is documented in README.md",
  },
  {
    // The shape npm writes into package-lock.json for a package named `tmp`.
    // The host is RFC-reserved so that only the rule under test is in play.
    file: 'src/registry-url.ts',
    text: assemble('https', ':', '/', '/', 'registry', '.', 'example', '.', 'com', '/tmp', '/-/tmp-0.2.7.tgz'),
    why: 'a path segment inside a URL is a package name, not a directory on anyone disk',
  },
  {
    file: 'src/registry-url-temp.ts',
    text: assemble('https', ':', '/', '/', 'registry', '.', 'example', '.', 'com', '/temp', '/-/temp-0.9.4.tgz'),
    why: 'the same, for the other spelling',
  },
  {
    file: 'docs/citation.md',
    text: `${assemble('203', '.', '0', '.', '113', '.', '7')} and ${assemble('https', ':', '/', '/', 'acme-corp', '.', 'net')}`,
    why: 'a URL or address in prose is a citation, not a network dependency of the build',
  },
  {
    file: 'src/notabuild.ts',
    text: `powershell -Command build; a${BS}b`,
    why: 'platform-only-invocation and platform-only-path-separator are scoped to files that run commands',
  },
];

describe('content rules', () => {
  const root = newRepo('content');
  const paths = [];
  for (const testCase of FIRING) paths.push(write(root, testCase.file, `export const value = '${testCase.text}';\n`));
  for (const testCase of ACCEPTED) paths.push(write(root, testCase.file, `${testCase.text}\n`));

  // The `env` shebang is accepted on line one and reported anywhere else. Written
  // out here rather than in the tables above because the two cases differ only in
  // which line the identical text is on.
  const shebang = assemble('#!', '/', 'usr', '/', 'bin', '/', 'env node');
  paths.push(write(root, 'src/tool.mjs', `${shebang}\nexport const value = 1;\n`));
  paths.push(write(root, 'src/late-shebang.ts', `// the same text, on line two\n${shebang}\n`));

  // A temporary path being ASSEMBLED next to a URL is still a path, and the quote
  // between the two is exactly what tells them apart. Written out here rather than
  // in the FIRING table because the sample contains quotes of its own.
  paths.push(
    write(
      root,
      'src/assembled-temp.ts',
      `const base = '${assemble('https', ':', '/', '/', 'host', '.', 'example', '.', 'com')}';\n` +
        `export const value = base + scratch + '${assemble('/', 'tmp', '/', 'x')}';\n`,
    ),
  );

  // The two rules scoped to files that run commands.
  paths.push(
    write(
      root,
      'package.json',
      `{\n  "scripts": {\n    "build": "powershell -Command build",\n    "copy": "xcopy src${BS}app out"\n  }\n}\n`,
    ),
  );

  track(root, ...paths);
  const report = run(root);

  it('exits 1 when it finds violations', () => {
    assert.equal(report.status, 1);
    assert.match(report.stderr, /violations of ADR-0002/);
  });

  for (const testCase of FIRING) {
    it(`reports ${testCase.rule} in ${testCase.file}`, () => {
      assert.ok(
        rulesFor(report, testCase.file).includes(testCase.rule),
        `expected ${testCase.rule} for ${testCase.file}, got ${JSON.stringify(rulesFor(report, testCase.file))}`,
      );
    });
  }

  for (const testCase of ACCEPTED) {
    it(`reports nothing in ${testCase.file} — ${testCase.why}`, () => {
      assert.deepEqual(rulesFor(report, testCase.file), []);
    });
  }

  it('accepts a portable env shebang on line one', () => {
    assert.deepEqual(rulesFor(report, 'src/tool.mjs'), []);
  });

  it('reports the same shebang text on any other line', () => {
    assert.deepEqual(rulesFor(report, 'src/late-shebang.ts'), ['absolute-posix-path']);
  });

  it('reports a temporary path assembled beside a URL, because it is not inside one', () => {
    assert.deepEqual(rulesFor(report, 'src/assembled-temp.ts'), ['temp-or-scratch-path']);
  });

  it('reports platform-only-invocation and platform-only-path-separator in package.json', () => {
    const rules = rulesFor(report, 'package.json');
    assert.ok(rules.includes('platform-only-invocation'), JSON.stringify(rules));
    assert.ok(rules.includes('platform-only-path-separator'), JSON.stringify(rules));
  });

  it('names the file, the line and the column of each finding', () => {
    const drive = report.violations.find((v) => v.file === 'src/drive.ts');
    assert.ok(drive !== undefined);
    assert.equal(drive.line, 1);
    assert.ok(drive.column > 1, 'the column should point at the match, not at the start of the line');
    assert.match(drive.what, /Windows drive letter/);
  });
});

// ---------------------------------------------------------------------------
// Packaging, and the two rules it changed.
//
// Both changes landed with the desktop packaging lane, and both are the kind of
// change that is easy to make one-sided. `platform-only-invocation` gained a
// pattern for a build command that pins its output to one platform without
// naming a shell — the prose forbade it from the start and the regex did not.
// `hardcoded-hostname` gained `DOCUMENTED_ENDPOINTS`, which is a declaration and
// not an exemption, so the fixture below asserts BOTH halves: the declared host
// passes and a host that merely starts with it does not.
//
// The lookalike is the sharp one. `<declared>.something-else.tld` is a host an
// attacker can register, it is not the declared endpoint, and a suffix test —
// which is the right test for the RFC-reserved names and the wrong one here —
// would have accepted it.
//
// ---------------------------------------------------------------------------
// REWRITTEN 2026-08-03, because `DOCUMENTED_ENDPOINTS` IS NOW EMPTY.
//
// This fixture used to name the real declared feed host and assert it passed.
// That host turned out to be INVENTED — plausible-looking under the project's
// brand, never owned by this organisation, and a DNS lookup returning an address
// was mistaken for proof of ownership. It is deleted from the map, and with
// `provider: generic` an unowned feed is remote code execution by configuration:
// one URL is the sole authority for both the manifest and the installer it names,
// and nothing here is signed.
//
// So this fixture no longer asserts anything about a *particular* host. It
// asserts the MECHANISM, which is what has to keep working when the first real
// feed is declared: with the map empty, every hostname is reported — including
// one that would previously have been declared — and the lookalike is reported
// too. When a row returns, the first assertion below is the one that must be
// inverted, and the second must not.
// ---------------------------------------------------------------------------

describe('packaging build commands and the declared update feed', () => {
  const root = newRepo('packaging');

  // Assembled rather than written, so this file does not itself contain a
  // hostname the checker would report when it scans its own repository.
  const feed = assemble('https', ':', '/', '/', 'updates', '.', 'not-a-real-host', '.', 'test-host', '.', 'net/shellux/');
  const lookalike = assemble(feed.replace(/\/shellux\/$/, ''), '.', 'not-the-feed', '.', 'test-host', '.', 'net/shellux/');

  const paths = [
    // The portable form: no platform flag at all, so the same command means
    // "package for this machine" on every operating system.
    write(root, 'package.json', '{\n  "scripts": {\n    "package": "electron-builder --publish never"\n  }\n}\n'),
    // The form the rule now catches. No shell, no batch file, no backslash.
    write(
      root,
      '.github/workflows/desktop.yml',
      'jobs:\n  package:\n    steps:\n      - run: electron-builder --win nsis --publish never\n',
    ),
    write(root, 'electron-builder.yml', `publish:\n  provider: generic\n  url: ${feed}\n`),
    write(root, 'lookalike.yml', `publish:\n  provider: generic\n  url: ${lookalike}\n`),
  ];

  track(root, ...paths);
  const report = run(root);

  it('reports platform-only-invocation for a build command that pins its platform', () => {
    const rules = rulesFor(report, '.github/workflows/desktop.yml');
    assert.ok(rules.includes('platform-only-invocation'), JSON.stringify(rules));
  });

  it('reports nothing for a build command that names no platform', () => {
    assert.deepEqual(rulesFor(report, 'package.json'), []);
  });

  it('reports a feed host while no endpoint is declared, which is the empty map working', () => {
    // With `DOCUMENTED_ENDPOINTS` empty, the hostname rule is fully on and an
    // undeclared feed URL is a violation like any other. This is the assertion to
    // INVERT — and the only one — in the change that declares the first real feed.
    const rules = rulesFor(report, 'electron-builder.yml');
    assert.ok(rules.includes('hardcoded-hostname'), JSON.stringify(rules));
  });

  it('reports a lookalike host too, so a declaration could never be a suffix test', () => {
    // This one must keep passing after a real endpoint is declared. A suffix test
    // would accept `<declared>.somewhere-else.tld`, which is a host an attacker
    // registers; exact equality is what refuses it.
    const rules = rulesFor(report, 'lookalike.yml');
    assert.ok(rules.includes('hardcoded-hostname'), JSON.stringify(rules));
  });
});

// ---------------------------------------------------------------------------
// developer-username
//
// This rule reads the login of whoever is running the check, so a test that named
// a login would pass on one machine and fail everywhere else. Instead each login
// under test is INVENTED here — a random identifier no account has — and injected
// into the checker's environment for that one subprocess. The assertions are then
// about the rule's logic, not about who is logged in.
//
// A single run covers four behaviours because the checker reads four different
// environment keys and each can carry a different value: USERNAME carries a login
// that must be caught, USER carries a service account that must not be, LOGNAME
// carries a name below the length floor, and USERPROFILE carries a home directory
// whose last segment is a second login that must be caught.
//
// The one branch a subprocess cannot reach is the inert case, where the rule ends
// up with no patterns at all: `os.userInfo()` always answers on a machine that has
// a logged-in user, so the pattern list is never empty from outside. What is
// asserted instead is that a run with a login present does NOT claim to be inert,
// which is machine-independent because this test supplies the login.
// ---------------------------------------------------------------------------

describe('developer-username', () => {
  const login = inventLogin();
  const profileLogin = inventLogin();
  const control = inventLogin();
  const root = newRepo('username');
  const home = join(BASE, 'homes', profileLogin);
  mkdirSync(home, { recursive: true });

  const paths = [
    write(root, 'src/login.ts', `// written by ${login}\n`),
    write(root, 'src/profile-login.ts', `// written by ${profileLogin}\n`),
    write(root, 'src/service-account.ts', `// the runner account builds this\n`),
    write(root, 'src/short.ts', `// ab\n`),
    write(root, 'src/control.ts', `// written by ${control}\n`),
    write(root, 'src/inside-identifier.ts', `export const ${login}Config = 1;\n`),
  ];
  track(root, ...paths);

  const report = run(root, {
    USERNAME: login,
    USER: 'runner',
    LOGNAME: 'ab',
    USERPROFILE: home,
    HOME: home,
  });

  it('catches a login supplied by the environment', () => {
    assert.deepEqual(rulesFor(report, 'src/login.ts'), ['developer-username']);
  });

  it('catches the last segment of a home directory as a login', () => {
    assert.deepEqual(rulesFor(report, 'src/profile-login.ts'), ['developer-username']);
  });

  it('ignores a service account, which is a build agent and not a developer', () => {
    assert.deepEqual(rulesFor(report, 'src/service-account.ts'), []);
  });

  it('ignores a name below the three-character floor', () => {
    assert.deepEqual(rulesFor(report, 'src/short.ts'), []);
  });

  it('ignores a name that is not any login this run was told about', () => {
    assert.deepEqual(rulesFor(report, 'src/control.ts'), []);
  });

  it('matches on word boundaries, so a login inside a longer identifier is not a hit', () => {
    assert.deepEqual(rulesFor(report, 'src/inside-identifier.ts'), []);
  });

  it('does not claim to be inert when it was given a login', () => {
    const clean = newRepo('username-clean');
    track(clean, write(clean, 'src/index.ts', 'export const answer = 42;\n'));
    const result = run(clean, { USERNAME: inventLogin() });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /inert/);
  });
});

// ---------------------------------------------------------------------------
// Structural rules
// ---------------------------------------------------------------------------

describe('line-endings and byte-order-mark', () => {
  const root = newRepo('bytes');
  const paths = [
    write(root, 'src/crlf.ts', Buffer.from('export const a = 1;\r\nexport const b = 2;\n', 'utf8')),
    write(root, 'src/bom.ts', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('export const a = 1;\n')])),
    write(root, 'src/clean.ts', 'export const a = 1;\n'),
    // .gitattributes marks batch files eol=crlf, so this is the one exception.
    write(root, 'tools/setup.bat', Buffer.from('@echo off\r\n', 'utf8')),
  ];
  track(root, ...paths);
  const report = run(root);

  it('reports a committed carriage return', () => {
    assert.deepEqual(rulesFor(report, 'src/crlf.ts'), ['line-endings']);
  });

  it('reports a UTF-8 byte-order mark', () => {
    assert.ok(rulesFor(report, 'src/bom.ts').includes('byte-order-mark'));
  });

  it('reports neither for an LF file with no mark', () => {
    assert.deepEqual(rulesFor(report, 'src/clean.ts'), []);
  });

  it('allows CRLF in a batch file, which cmd.exe requires', () => {
    assert.deepEqual(rulesFor(report, 'tools/setup.bat'), []);
  });
});

describe('case-collision', () => {
  it('reports two tracked paths that differ only in case', () => {
    const root = newRepo('case');
    track(root, write(root, 'src/widget.ts', 'export const a = 1;\n'));
    // Only the index can hold both spellings; a case-insensitive filesystem cannot.
    trackInIndexOnly(root, 'src/Widget.ts', 'export const a = 1;\n');
    const report = run(root);
    assert.equal(report.status, 1);
    const collision = report.violations.find((v) => v.rule === 'case-collision');
    assert.ok(collision !== undefined, JSON.stringify(ruleIds(report)));
    assert.match(collision.text, /src\/Widget\.ts/);
    assert.match(collision.text, /src\/widget\.ts/);
  });

  it('reports nothing for paths that differ by more than case', () => {
    const root = newRepo('case-clean');
    track(
      root,
      write(root, 'src/widget.ts', 'export const a = 1;\n'),
      write(root, 'src/gadget.ts', 'export const b = 2;\n'),
    );
    const report = run(root);
    assert.equal(report.status, 0);
  });
});

// ---------------------------------------------------------------------------
// module-case-collision
//
// The rule case-collision above cannot catch, because it compares whole tracked
// paths — extension included — and a component `RowStatus.tsx` sitting beside its
// data module `rowStatus.ts` is a whole-path pair that genuinely can coexist on
// any filesystem. The two files ARE, unlike a case-collision fixture, ordinary
// files that this suite can `git add` directly: nothing here needs
// `trackInIndexOnly`, because nothing about the pair is blocked by the filesystem
// this suite runs on, case-insensitive or not — the collision this rule reports
// exists one level up, in how tsc's module resolver answers an extensionless
// specifier, not in what a directory listing can hold.
// ---------------------------------------------------------------------------

describe('module-case-collision', () => {
  it('reports two module sources whose basenames collide once the extension is stripped', () => {
    // The exact pair from the incident this rule was written for.
    const root = newRepo('module-case');
    track(
      root,
      write(root, 'src/components/ui/RowStatus.tsx', 'export const RowStatus = 1;\n'),
      write(root, 'src/components/ui/rowStatus.ts', 'export const rowStatus = 1;\n'),
    );
    const report = run(root);
    assert.equal(report.status, 1);
    const collision = report.violations.find((v) => v.rule === 'module-case-collision');
    assert.ok(collision !== undefined, JSON.stringify(ruleIds(report)));
    assert.match(collision.text, /RowStatus\.tsx/);
    assert.match(collision.text, /rowStatus\.ts/);
  });

  it('reports nothing for two module sources with different names', () => {
    const root = newRepo('module-case-different-names');
    track(
      root,
      write(root, 'src/RowMetric.tsx', 'export const a = 1;\n'),
      write(root, 'src/rowDelta.ts', 'export const b = 2;\n'),
    );
    const report = run(root);
    assert.equal(report.status, 0);
  });

  it('reports nothing for the identical basename that differs only in extension', () => {
    // Button.tsx and Button.ts share the exact same basename — the finding this
    // rule looks for is DIFFERENT case, not SAME name, and this pair is neither
    // colliding on a filesystem nor colliding in tsc's resolver: each extension
    // resolves to its own file.
    const root = newRepo('module-case-extension-only');
    track(
      root,
      write(root, 'src/Button.tsx', 'export const a = 1;\n'),
      write(root, 'src/Button.ts', 'export const b = 2;\n'),
    );
    const report = run(root);
    assert.equal(report.status, 0);
  });

  it('reports nothing for the same basename in two different directories', () => {
    // TypeScript resolves a specifier within one directory; a same-named module in
    // a sibling directory is never what an extensionless import in the other one
    // could mean, so this must not be reported however the two basenames compare.
    const root = newRepo('module-case-different-directory');
    track(root, write(root, 'a/Foo.ts', 'export const a = 1;\n'), write(root, 'b/foo.ts', 'export const b = 2;\n'));
    const report = run(root);
    assert.equal(report.status, 0);
  });
});

describe('unreadable-tracked-file', () => {
  it('reports a path the index lists that the working tree does not have', () => {
    const root = newRepo('unreadable');
    track(root, write(root, 'src/present.ts', 'export const a = 1;\n'));
    trackInIndexOnly(root, 'src/ghost.ts', 'export const b = 2;\n');
    const report = run(root);
    assert.equal(report.status, 1);
    assert.deepEqual(rulesFor(report, 'src/ghost.ts'), ['unreadable-tracked-file']);
    assert.deepEqual(rulesFor(report, 'src/present.ts'), []);
  });
});

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

describe('import rules', () => {
  const root = newRepo('imports');
  write(root, 'src/components/button.ts', 'export const button = 1;\n');
  write(root, 'src/orphan.ts', 'export const orphan = 1;\n'); // on disk, deliberately never tracked
  const paths = [
    write(
      root,
      'src/App.ts',
      [
        "import { button } from './components/Button';",
        "import { orphan } from './orphan';",
        "import { missing } from './missing';",
        "import { far } from '../../elsewhere';",
        "import './';",
        "import { ok } from './core/registry';",
        'export const app = [button, orphan, missing, far, ok];',
      ].join('\n') + '\n',
    ),
    write(root, 'src/core/registry.ts', 'export const ok = 1;\n'),
  ];
  track(root, ...paths, 'src/components/button.ts');
  const report = run(root);
  const forApp = report.violations.filter((v) => v.file === 'src/App.ts');
  const at = (line) => forApp.find((v) => v.line === line);

  it('reports an import whose case does not match the tracked filename', () => {
    const violation = at(1);
    assert.ok(violation !== undefined, JSON.stringify(forApp));
    assert.equal(violation.rule, 'import-case');
    assert.match(violation.what, /src\/components\/button\.ts/);
  });

  it('tells the reader to `git add` a target that is untracked but really on disk', () => {
    const violation = at(2);
    assert.ok(violation !== undefined, JSON.stringify(forApp));
    assert.equal(violation.rule, 'import-unresolved');
    assert.match(violation.what, /git add src\/orphan\.ts/);
  });

  it('falls back to the generic message when nothing resolves', () => {
    const violation = at(3);
    assert.ok(violation !== undefined, JSON.stringify(forApp));
    assert.equal(violation.what, 'an import that resolves to no tracked file');
  });

  it('reports a relative import that escapes the repository root', () => {
    const violation = at(4);
    assert.ok(violation !== undefined, JSON.stringify(forApp));
    assert.equal(violation.what, 'a relative import that escapes the repository root');
  });

  it('never names a path outside the repository for a specifier that normalises to nothing', () => {
    // The closed finding recorded in issue #11: `import './'` produced an empty
    // base, and an earlier implementation evaluated it against an absolute root.
    const violation = at(5);
    assert.ok(violation !== undefined, JSON.stringify(forApp));
    assert.equal(violation.what, 'an import that resolves to no tracked file');
    for (const each of report.violations) assert.doesNotMatch(each.what, /index\.ts/);
  });

  it('reports nothing for an import that resolves to a tracked file', () => {
    assert.equal(at(6), undefined, JSON.stringify(forApp));
  });

  it('refuses to confirm a target whose parent directory is mis-cased', () => {
    // Confirmation is segment-wise, so a case-insensitive filesystem cannot talk
    // it into advising `git add src/Components/button.ts` and recording a
    // case-collision in the index.
    const mixed = newRepo('imports-miscased');
    write(mixed, 'src/components/button.ts', 'export const button = 1;\n');
    track(mixed, write(mixed, 'src/App.ts', "import { button } from './Components/button';\nexport const a = button;\n"));
    const result = run(mixed);
    assert.equal(result.status, 1);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].what, 'an import that resolves to no tracked file');
  });
});

// ---------------------------------------------------------------------------
// symlinked-path
//
// The rule added for issue #11. Before it, a tracked path that was, or that
// reached through, a symbolic link was READ — so the checker scanned a file the
// repository does not contain, and reported or cleared content that no clone has.
// A junction is used rather than a symbolic link wherever a directory will do,
// because a junction needs no elevation and no developer mode on Windows while
// still being a reparse point that `lstat` reports as a link.
// ---------------------------------------------------------------------------

/**
 * Whether this machine lets an unprivileged process create a link of this type.
 *
 * A directory junction needs no elevation and no developer mode on Windows, so in
 * practice the junction probe always passes and the tests that need one always
 * run; a *file* symbolic link does need one of those, so the single test that
 * requires one skips rather than failing on a machine that will not grant it.
 * The rule is still covered on such a machine — by the index-mode test, which
 * needs no filesystem link at all.
 */
function canLink(type, target) {
  const probe = join(BASE, `link-probe-${randomUUID().slice(0, 8)}`);
  try {
    symlinkSync(target, probe, type);
  } catch {
    return false;
  }
  // Left behind if it will not go quietly; the whole base is removed afterwards.
  try {
    rmSync(probe, { force: true, recursive: true });
  } catch {
    /* ignored */
  }
  return true;
}

describe('symlinked-path', () => {
  const outside = join(BASE, 'outside-the-repository');
  mkdirSync(outside, { recursive: true });
  // Content that WOULD be reported if the checker ever read it. That is the point:
  // its absence from the report is the proof that nothing outside was read.
  const forbidden = assemble('D', ':', BS, 'elsewhere', BS, 'secret.txt');
  writeFileSync(join(outside, 'secret.ts'), `export const p = '${forbidden}';\n`);

  const junctions = canLink('junction', outside);
  const fileLinks = canLink('file', join(outside, 'secret.ts'));

  it('reports a symbolic link the index itself records, with no filesystem link involved', () => {
    // Mode 120000 is a blob whose content is the target path. Detecting it from the
    // index means the rule fires identically on a machine that materialised the
    // link and on one whose platform checked it out as an ordinary text file.
    const root = newRepo('symlink-index');
    track(root, write(root, 'src/index.ts', 'export const a = 1;\n'));
    trackInIndexOnly(root, 'src/link.ts', '../outside-the-repository/secret.ts', '120000');
    const report = run(root);
    assert.equal(report.status, 1);
    assert.deepEqual(rulesFor(report, 'src/link.ts'), ['symlinked-path']);
    assert.match(report.violations[0].what, /a tracked symbolic link/);
  });

  it('reports a tracked path reached through a linked parent, and does not read it', { skip: !junctions }, () => {
    const root = newRepo('symlink-parent');
    track(root, write(root, 'src/index.ts', 'export const a = 1;\n'));
    symlinkSync(outside, join(root, 'src', 'linked'), 'junction');
    // `git add` refuses to walk a link, so the path goes straight into the index —
    // which is exactly how this state arises in the wild, by a directory being
    // replaced with a link after it was tracked.
    trackInIndexOnly(root, 'src/linked/secret.ts', `export const p = '${forbidden}';\n`);
    const report = run(root);

    assert.equal(report.status, 1);
    assert.deepEqual(rulesFor(report, 'src/linked/secret.ts'), ['symlinked-path']);
    assert.match(report.violations[0].what, /through the symbolic link "src\/linked"/);
    // The load-bearing assertion. The file on the far side of the link contains a
    // drive-letter path; if the checker had followed the link it would be here.
    assert.ok(
      !ruleIds(report).includes('windows-drive-path'),
      'the checker read a file outside the repository through a link',
    );
  });

  it('reports a tracked path this working tree holds as a link', { skip: !junctions }, () => {
    // The index says a regular file; the working tree has a link under that name.
    // Reached with a junction so the case is covered without needing the privilege
    // a file symbolic link requires on Windows.
    const root = newRepo('symlink-self');
    track(root, write(root, 'src/index.ts', 'export const a = 1;\n'));
    symlinkSync(outside, join(root, 'src', 'linked'), 'junction');
    trackInIndexOnly(root, 'src/linked', 'export const a = 1;\n');
    const report = run(root);
    assert.equal(report.status, 1);
    assert.deepEqual(rulesFor(report, 'src/linked'), ['symlinked-path']);
    assert.match(report.violations[0].what, /holds as a symbolic link/);
  });

  it('reports a tracked file that is a real symbolic link', { skip: !fileLinks }, () => {
    const root = newRepo('symlink-file');
    track(root, write(root, 'src/index.ts', 'export const a = 1;\n'));
    symlinkSync(join(outside, 'secret.ts'), join(root, 'src', 'aliased.ts'), 'file');
    trackInIndexOnly(root, 'src/aliased.ts', 'export const a = 1;\n');
    const report = run(root);
    assert.equal(report.status, 1);
    assert.deepEqual(rulesFor(report, 'src/aliased.ts'), ['symlinked-path']);
    assert.ok(!ruleIds(report).includes('windows-drive-path'));
  });

  it('never advises `git add` for a target that only resolves through a link', { skip: !junctions }, () => {
    // The finding issue #11 opened against `resolvesOnDisk`. Before the fix this
    // printed ``run `git add src/linked/secret.ts` `` — advice to record a
    // machine-local link in the index, from the tool that forbids exactly that.
    const root = newRepo('symlink-advice');
    // Written first, because it is what creates `src` for the link to sit in.
    track(root, write(root, 'src/App.ts', "import { p } from './linked/secret';\nexport const q = p;\n"));
    symlinkSync(outside, join(root, 'src', 'linked'), 'junction');
    const report = run(root);

    assert.equal(report.status, 1);
    assert.deepEqual(rulesFor(report, 'src/App.ts'), ['import-unresolved']);
    assert.equal(report.violations[0].what, 'an import that resolves to no tracked file');
    assert.doesNotMatch(report.stderr, /git add/);
  });

  it('leaves an ordinary tree with no link alone', () => {
    const root = newRepo('symlink-none');
    track(root, write(root, 'src/index.ts', 'export const a = 1;\n'));
    const report = run(root);
    assert.equal(report.status, 0);
    assert.doesNotMatch(report.stdout, /symlink/);
  });
});

// ---------------------------------------------------------------------------
// The exit-code contract: 0 clean, 1 violations found, 2 the check could not run.
// ---------------------------------------------------------------------------

describe('exit codes', () => {
  it('exits 0 and reports the totals on a clean tree', () => {
    const root = newRepo('exit-zero');
    track(
      root,
      write(root, 'src/index.ts', "import { a } from './core';\nexport const b = a;\n"),
      write(root, 'src/core.ts', 'export const a = 1;\n'),
      write(root, 'README.md', '# A clean tree\n'),
    );
    const report = run(root, { USERNAME: inventLogin() });
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /^check-portability: OK — 3 tracked files/);
    assert.match(report.stdout, /21 rules, 0 violations/);
    assert.equal(report.stderr, '');
  });

  it('exits 1 when it finds a violation, and writes the report to stderr', () => {
    const root = newRepo('exit-one');
    track(root, write(root, 'src/index.ts', `export const p = '${assemble('D', ':', BS, 'x')}';\n`));
    const report = run(root);
    assert.equal(report.status, 1);
    assert.equal(report.stdout, '');
    assert.match(report.stderr, /1 violation of ADR-0002/);
    assert.match(report.stderr, /never by loosening the acceptance test/);
  });

  it('exits 2 when there is no git working tree to scan', () => {
    const root = newRepo('exit-two', { init: false });
    // Without a ceiling git would climb out of the temporary directory and might
    // find some unrelated repository above it, which would make this test pass or
    // fail depending on where the suite was checked out.
    const report = run(root, { GIT_CEILING_DIRECTORIES: BASE });
    assert.equal(report.status, 2);
    assert.match(report.stderr, /cannot list tracked files/);
    assert.equal(report.violations.length, 0);
  });

  // NOT COVERED, and recorded rather than quietly omitted: the second exit-2 path,
  // where `git ls-files -s -z` returns a record this script cannot parse. Driving
  // it means putting a fake `git` on PATH, and a fake `git` is a shell script on
  // one platform and a batch file on another — a platform-only script, in the
  // suite for the check that forbids platform-only scripts. The guard is a few
  // lines of defensive parsing over output format that git has not changed in its
  // history; the cost of covering it is higher than the risk it carries.
});
