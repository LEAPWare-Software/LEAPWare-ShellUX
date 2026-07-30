#!/usr/bin/env node
/**
 * check-portability.mjs — the mechanical half of ADR-0002.
 *
 * ADR-0002 forbids local-environment dependencies in tracked files. A rule with
 * no checker is a wish, so this is the checker. It is deliberately a plain Node
 * script with no dependencies: Node is the one tool the acceptance test already
 * guarantees on every laptop, and a PowerShell or shell implementation would
 * itself be the platform-only script the mandate forbids.
 *
 * What it enforces, and why each rule earns its place:
 *
 *   windows-drive-path            An absolute path anchored to a drive letter
 *                                 resolves on exactly one machine.
 *   home-directory-path           A path through a per-user home directory
 *                                 encodes whose laptop wrote it.
 *   environment-home-reference    Per-user environment variables and the tilde
 *                                 shorthand expand differently per machine and
 *                                 per shell.
 *   appdata-path                  A Windows per-user application-data directory
 *                                 does not exist off Windows.
 *   temp-or-scratch-path          A scratch directory is not a build input.
 *   absolute-posix-path           An absolute system path anchored outside the
 *                                 repository is a layout assumption.
 *   unc-path                      A UNC path names one specific host.
 *   developer-username            See CURRENT_MACHINE_USERNAMES below.
 *   hardcoded-ip-address          An address literal is an environment
 *                                 assumption that is neither declared nor
 *                                 defaulted.
 *   hardcoded-hostname            Same, for a DNS name.
 *   undocumented-port             A port assumption is allowed only when it is
 *                                 a documented default (see DOCUMENTED_PORTS).
 *   platform-only-invocation      A build command that only one OS can run.
 *   platform-only-path-separator  A backslash in a build command is a Windows
 *                                 assumption.
 *   line-endings                  .gitattributes mandates LF; a committed CRLF
 *                                 contradicts it and produces phantom diffs.
 *   byte-order-mark               A UTF-8 BOM breaks JSON parsers and shebangs.
 *   case-collision                Two tracked paths differing only in case
 *                                 cannot both exist on a case-insensitive
 *                                 filesystem; one clobbers the other on clone.
 *   import-case                   An import whose case does not match the
 *                                 tracked filename resolves on Windows and
 *                                 macOS and fails on Linux.
 *   import-unresolved             An import that resolves to nothing tracked.
 *   unreadable-tracked-file       A path the index lists that the working tree
 *                                 does not have, which means a fresh clone and
 *                                 this tree would not agree.
 *
 * Precision over suppression. Two known-legitimate strings in this repository
 * match the naive form of these rules, and neither is allowlisted, because a
 * sharper pattern is worth more than an exemption:
 *
 *   - The package name shares a prefix with a developer login. The
 *     developer-username rule therefore matches only on word boundaries, so a
 *     login is never found inside a longer identifier.
 *   - A test fixture uses a single-label URL as a rejected-input sample. The
 *     hardcoded-hostname rule therefore only reports hosts containing a dot,
 *     because a single-label authority is never a reachable public endpoint.
 *
 * A third case was found by this checker on its own first run: the `env` shebang
 * at the top of this file. That one is handled the same way — the
 * absolute-posix-path rule accepts the POSIX-standard portable shebang on line one
 * and still reports a shebang that hardcodes an interpreter's install location.
 *
 * ALLOWLIST below exists for the cases precision cannot reach, and every entry
 * carries a written reason. Exit status: 0 clean, 1 violations found, 2 the
 * check could not be run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Declared, defaulted environment facts. Nothing below is read from the
// environment at scan time except the current login name, and that one has a
// total fallback: if it cannot be determined the rule simply contributes no
// patterns, so the check stays deterministic rather than becoming conditional.
// ---------------------------------------------------------------------------

/** Ports a tracked file may assume, each because it is a documented default. */
const DOCUMENTED_PORTS = new Map([[5173, "Vite's default dev-server port, documented in README.md"]]);

/** Address literals that name no machine: loopback and the wildcard bind. */
const DOCUMENTED_ADDRESSES = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255']);

/** DNS suffixes reserved by RFC 2606 / RFC 6761 for documentation and examples. */
const RESERVED_DNS_SUFFIXES = ['example.com', 'example.net', 'example.org', 'invalid', 'test', 'localhost'];

/**
 * Service and container accounts. These are the login names of build agents,
 * not of developers, so finding one in a tracked file says nothing about
 * anybody's laptop layout. Excluding them also keeps the rule from firing on
 * ordinary English words that happen to be a CI account name.
 */
const SERVICE_ACCOUNTS = new Set([
  'administrator',
  'app',
  'build',
  'circleci',
  'codespace',
  'containeradministrator',
  'default',
  'docker',
  'ec2-user',
  'gitpod',
  'jenkins',
  'node',
  'root',
  'runner',
  'runneradmin',
  'travis',
  'ubuntu',
  'user',
  'vagrant',
  'vsts',
]);

/**
 * Login names that are forbidden on every machine, including CI.
 *
 * Deliberately empty. Naming a developer here would publish that person's
 * identity in a tracked file to forbid it, which is the problem rather than the
 * fix, and the path-shaped rules above already catch a committed home-directory
 * path whoever wrote it and whoever is running the check. What this list adds is
 * the bare-identifier case — a machine name or a login mentioned outside a path
 * — and that is caught by CURRENT_MACHINE_USERNAMES on the machine where it
 * would be written. Add a name here only when a leak has to be kept out
 * repository-wide, and accept that doing so publishes it.
 */
const FORBIDDEN_USERNAMES = [];

/**
 * The login of whoever is running the check, as a backstop for the bare
 * identifier case. This is why the rule catches a developer's own login on the
 * machine that would introduce it, without the repository having to know any
 * developer's name in advance.
 */
const CURRENT_MACHINE_USERNAMES = (() => {
  const candidates = [];
  try {
    candidates.push(os.userInfo().username);
  } catch {
    // No passwd entry for the current uid. Nothing to add; the rule degrades to
    // FORBIDDEN_USERNAMES rather than failing.
  }
  for (const key of ['USERNAME', 'USER', 'LOGNAME']) {
    const value = process.env[key];
    if (value !== undefined) candidates.push(value);
  }
  for (const key of ['USERPROFILE', 'HOME']) {
    const value = process.env[key];
    if (value !== undefined) candidates.push(value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '');
  }
  const names = new Set();
  for (const raw of candidates) {
    const name = raw.trim().toLowerCase();
    // Three characters is the floor at which a login stops colliding with
    // ordinary prose on every other line.
    if (name.length < 3) continue;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) continue;
    if (SERVICE_ACCOUNTS.has(name)) continue;
    names.add(name);
  }
  return names;
})();

/**
 * Paths exempt from a named rule, each with the reason it is legitimate.
 *
 * `files` entries are matched against repository-relative POSIX paths. A trailing
 * slash makes the entry a directory prefix; anything else is an exact path.
 * `rules` must list rule ids explicitly — there is no wildcard, so a rule added
 * later starts out enforced everywhere and an exemption has to be argued for on
 * purpose rather than inherited.
 */
const ALLOWLIST = [
  {
    files: ['scripts/check-portability.mjs'],
    rules: ['appdata-path', 'temp-or-scratch-path'],
    reason:
      'This file is the rule table, so it has to name the directory names it forbids. ' +
      'Only the two rules whose patterns are plain words are exempted; every other ' +
      'rule stays enforced here, and each pattern above is written so that it does ' +
      'not match its own source text.',
  },
  {
    files: ['package-lock.json'],
    rules: ['hardcoded-hostname'],
    reason:
      'npm writes registry and funding URLs into the lockfile. They are provenance ' +
      'metadata for the resolver, not endpoints this codebase contacts, and the set ' +
      'of funding hosts changes whenever a dependency changes — allowlisting them ' +
      'individually would make an unrelated dependency bump fail this check. Every ' +
      'other rule, including the path and line-ending rules, still applies here.',
  },
];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const CONTENT_RULES = [
  {
    id: 'windows-drive-path',
    what: 'an absolute path anchored to a Windows drive letter',
    // The negative lookbehind is what keeps this off URL schemes: the two
    // characters before the separator in a scheme are letters, whereas a drive
    // letter is a single character preceded by a quote, a space or nothing.
    patterns: [/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/g],
  },
  {
    id: 'home-directory-path',
    what: 'a path through a per-user home directory',
    patterns: [/[\\/](?:Users|home)[\\/]/g],
  },
  {
    id: 'environment-home-reference',
    what: 'a per-user environment variable or shell shorthand for a home directory',
    patterns: [
      /%(?:USERPROFILE|USERNAME|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|COMPUTERNAME|USERDOMAIN)%/g,
      /\$\{?HOME\}?(?!\w)/g,
      /(?<![\w~.\-*])~[\\/]/g,
    ],
  },
  {
    id: 'appdata-path',
    what: 'a Windows per-user application-data directory',
    patterns: [/\bAppData\b/g],
  },
  {
    id: 'temp-or-scratch-path',
    what: 'a machine-specific temporary or scratch directory',
    patterns: [/[\\/](?:tmp|temp)[\\/]/gi, /\bscratchpad\b/gi, /[\\/]var[\\/]folders[\\/]/g],
  },
  {
    id: 'absolute-posix-path',
    what: 'an absolute POSIX path anchored outside the repository',
    // Excluding a preceding word character, dot or separator is what keeps this
    // off the path component of a URL and off repository-relative paths.
    patterns: [
      /(?<![\w~.\-/])\/(?:usr|opt|etc|var|srv|mnt|root|Applications|Volumes|Library|System|private)\//g,
    ],
    // A first-line `env` shebang is the POSIX-standard *portable* form: it
    // resolves the interpreter through PATH rather than hardcoding where that
    // interpreter happens to be installed. A shebang naming an interpreter's own
    // absolute path is still reported, and so is the same text anywhere but line
    // one.
    accept: (_match, context) => context.lineNumber === 1 && /^#!\/usr\/bin\/env\s+\S+\s*$/.test(context.line),
  },
  {
    id: 'unc-path',
    what: 'a UNC path naming a specific host',
    // The colon in the lookbehind is what keeps this off an escaped drive-letter
    // path in a source string, which is the drive-letter rule's finding to report
    // and not this one's.
    patterns: [/(?<![\\/:\w.$-])\\\\[A-Za-z0-9][A-Za-z0-9._-]+\\/g],
  },
  {
    id: 'developer-username',
    what: "a developer's login name",
    patterns: [...new Set([...FORBIDDEN_USERNAMES, ...CURRENT_MACHINE_USERNAMES])].map(
      // Word boundaries, so a login is never matched inside a longer identifier.
      (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
    ),
  },
  {
    id: 'hardcoded-ip-address',
    what: 'a hardcoded IP address',
    // Markdown is excluded because a citation in prose is not a network
    // dependency of the build; the rule is about code and configuration.
    skipExtensions: ['.md'],
    patterns: [/(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g],
    accept: (match) => {
      const address = match[1] ?? '';
      if (address.split('.').some((octet) => Number(octet) > 255)) return true; // a version number, not an address
      return DOCUMENTED_ADDRESSES.has(address);
    },
  },
  {
    id: 'hardcoded-hostname',
    what: 'a hardcoded network host',
    skipExtensions: ['.md'],
    patterns: [/\bhttps?:\/\/([A-Za-z0-9._-]+)/g],
    accept: (match) => {
      const host = (match[1] ?? '').toLowerCase();
      // A single-label authority resolves nowhere public, so it is a sample
      // value rather than an endpoint.
      if (!host.includes('.')) return true;
      return RESERVED_DNS_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    },
  },
  {
    id: 'undocumented-port',
    what: 'a port assumption that is not a documented default',
    patterns: [/(?:\bport\s*[:=]\s*|localhost:|127\.0\.0\.1:)(\d{2,5})/gi],
    accept: (match) => DOCUMENTED_PORTS.has(Number(match[1])),
  },
  {
    id: 'platform-only-invocation',
    what: 'a build command only one operating system can run',
    // Scoped to the files that actually run commands. Prose is free to discuss
    // any shell it likes; a build step is not.
    onlyFiles: ['package.json', '.github/workflows/'],
    patterns: [
      /\b(?:cmd\.exe|cmd\s+\/c|powershell(?:\.exe)?|pwsh|xcopy|robocopy|del\s+\/|rmdir\s+\/|copy\s+\/)/gi,
      /\.(?:bat|cmd|ps1)\b/gi,
    ],
  },
  {
    id: 'platform-only-path-separator',
    what: 'a Windows path separator in a build command',
    onlyFiles: ['package.json', '.github/workflows/'],
    patterns: [/\\/g],
  },
];

/**
 * Paths whose committed line endings are allowed to be CRLF, because
 * .gitattributes marks them `eol=crlf`. cmd.exe mis-parses an LF-only batch
 * file, which is the sole intentional exception to the LF rule.
 */
const CRLF_ALLOWED = /\.(?:bat|cmd)$/i;

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/** @type {{file: string, line: number, column: number, rule: string, what: string, text: string}[]} */
const violations = [];

function report(file, line, column, rule, what, text) {
  const trimmed = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  violations.push({ file, line, column, rule, what, text: trimmed });
}

function matchesPathList(file, list) {
  return list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
}

function isAllowed(file, rule) {
  return ALLOWLIST.some((entry) => entry.rules.includes(rule) && matchesPathList(file, entry.files));
}

function extensionOf(file) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function trackedFiles() {
  let raw;
  try {
    raw = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `check-portability: cannot list tracked files. This check scans what git tracks, so it needs\n` +
        `to run inside a git working tree with git on PATH.\n  ${detail}\n`,
    );
    process.exit(2);
  }
  return raw.split('\0').filter((entry) => entry !== '');
}

/** Two tracked paths that differ only in case cannot survive a clone onto one filesystem. */
function checkCaseCollisions(files) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const file of files) {
    const segments = file.split('/');
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const path = segments.slice(0, depth).join('/');
      const key = path.toLowerCase();
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, path);
      } else if (previous !== path) {
        report(
          file,
          1,
          1,
          'case-collision',
          'a tracked path that collides case-insensitively with another tracked path',
          `${path} vs ${previous}`,
        );
      }
    }
  }
}

function looksBinary(buffer) {
  const window = buffer.subarray(0, Math.min(buffer.length, 8000));
  return window.includes(0);
}

function checkBytes(file, buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    report(file, 1, 1, 'byte-order-mark', 'a UTF-8 byte-order mark', '<BOM>');
  }
  if (CRLF_ALLOWED.test(file)) return;
  let line = 1;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 0x0a) {
      line += 1;
    } else if (byte === 0x0d) {
      const followedByLf = buffer[index + 1] === 0x0a;
      report(
        file,
        line,
        1,
        'line-endings',
        'a carriage return, but .gitattributes mandates LF',
        followedByLf ? '<CRLF>' : '<CR>',
      );
      return; // one report per file is enough to fail and to act on
    }
  }
}

function checkContent(file, text) {
  const extension = extensionOf(file);
  const lines = text.split('\n');
  for (const rule of CONTENT_RULES) {
    if (rule.patterns.length === 0) continue;
    if (rule.onlyFiles !== undefined && !matchesPathList(file, rule.onlyFiles)) continue;
    if (rule.skipExtensions !== undefined && rule.skipExtensions.includes(extension)) continue;
    if (isAllowed(file, rule.id)) continue;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].replace(/\r$/, '');
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          if (match[0] === '') break; // defensive: a zero-width match would spin
          const context = { file, line, lineNumber: index + 1 };
          if (rule.accept === undefined || !rule.accept(match, context)) {
            report(file, index + 1, match.index + 1, rule.id, rule.what, line.trim());
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Import resolution
//
// Case-exactness is decided against the git index rather than against the
// filesystem, on purpose: the index records the byte-exact name, so the answer
// is identical on a case-insensitive and a case-sensitive filesystem. Asking
// the filesystem would make this check pass on the machine where the mistake is
// made and fail only on Linux, which is precisely the failure it exists to stop.
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLUTION_EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];

const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /^\s*(?:import|export)\s*['"]([^'"]+)['"]/gm,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function normalisePosix(fromDirectory, specifier) {
  const segments = [];
  for (const part of `${fromDirectory}/${specifier}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null; // escapes the repository root
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

function lineOf(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

function checkImports(files) {
  const tracked = new Set(files);
  /** @type {Map<string, string>} */
  const trackedLowercase = new Map();
  for (const file of files) trackedLowercase.set(file.toLowerCase(), file);

  for (const file of files) {
    if (!file.startsWith('src/')) continue;
    if (!SOURCE_EXTENSIONS.includes(extensionOf(file))) continue;

    // Already reported as unreadable-tracked-file by the main scan; skip rather
    // than throw a second time on the same cause.
    let text;
    try {
      text = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    } catch {
      continue;
    }
    const directory = file.slice(0, file.lastIndexOf('/'));

    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const specifier = match[1];
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;

        const base = normalisePosix(directory, specifier);
        const line = lineOf(text, match.index);
        if (base === null) {
          report(file, line, 1, 'import-unresolved', 'a relative import that escapes the repository root', specifier);
          continue;
        }

        const candidates = [];
        for (const extension of RESOLUTION_EXTENSIONS) candidates.push(`${base}${extension}`);
        for (const extension of RESOLUTION_EXTENSIONS) {
          if (extension !== '') candidates.push(`${base}/index${extension}`);
        }

        if (candidates.some((candidate) => tracked.has(candidate))) continue;

        const caseInsensitiveHit = candidates
          .map((candidate) => trackedLowercase.get(candidate.toLowerCase()))
          .find((hit) => hit !== undefined);

        if (caseInsensitiveHit !== undefined) {
          report(
            file,
            line,
            1,
            'import-case',
            `an import whose case does not match the tracked file "${caseInsensitiveHit}"`,
            specifier,
          );
        } else {
          report(file, line, 1, 'import-unresolved', 'an import that resolves to no tracked file', specifier);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const files = trackedFiles();

checkCaseCollisions(files);

let scanned = 0;
let skippedBinary = 0;
for (const file of files) {
  let buffer;
  try {
    buffer = readFileSync(resolve(REPO_ROOT, file));
  } catch (error) {
    // A tracked path that cannot be read is itself a portability failure: a fresh
    // clone checks out everything the index lists, so this means the working tree
    // and the index disagree. Reported rather than thrown, so the message names
    // the file instead of a stack frame.
    report(file, 1, 1, 'unreadable-tracked-file', 'a tracked path that cannot be read from the working tree', String(error instanceof Error ? error.message : error));
    continue;
  }
  if (looksBinary(buffer)) {
    skippedBinary += 1;
    continue;
  }
  scanned += 1;
  checkBytes(file, buffer);
  checkContent(file, buffer.toString('utf8'));
}

checkImports(files);

/** Rules decided structurally rather than by a content pattern. Listed, not counted, so the total below is exact. */
const STRUCTURAL_RULES = [
  'line-endings',
  'byte-order-mark',
  'case-collision',
  'import-case',
  'import-unresolved',
  'unreadable-tracked-file',
];
const ruleCount = CONTENT_RULES.length + STRUCTURAL_RULES.length;

if (violations.length === 0) {
  // The username rule is the one rule whose patterns depend on the machine. Saying
  // so on a clean run keeps that visible rather than implying all 19 rules found
  // nothing when one of them had nothing to look for. See ADR-0002.
  const usernameRule = CONTENT_RULES.find((rule) => rule.id === 'developer-username');
  const inert = usernameRule !== undefined && usernameRule.patterns.length === 0 ? ' (developer-username inert: no login name to match)' : '';
  process.stdout.write(
    `check-portability: OK — ${files.length} tracked files (${scanned} scanned as text, ` +
      `${skippedBinary} binary), ${ruleCount} rules, 0 violations${inert}.\n`,
  );
  process.exit(0);
}

violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

process.stderr.write(
  `check-portability: ${violations.length} violation${violations.length === 1 ? '' : 's'} of ADR-0002 ` +
    `(no local-environment dependencies).\n\n`,
);
for (const violation of violations) {
  process.stderr.write(`  ${violation.file}:${violation.line}:${violation.column}  ${violation.rule}\n`);
  process.stderr.write(`    found ${violation.what}\n`);
  process.stderr.write(`    ${violation.text}\n\n`);
}
process.stderr.write(
  `A tracked file must resolve identically on every machine. See CONTRIBUTING.md and\n` +
    `docs/adr/0002-no-local-environment-dependencies.md. If a match is genuinely\n` +
    `legitimate, sharpen the rule or add an ALLOWLIST entry with a written reason in\n` +
    `scripts/check-portability.mjs — never by loosening the acceptance test.\n`,
);
process.exit(1);
