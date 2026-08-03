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
 *   temp-or-scratch-path          A scratch directory is not a build input. A
 *                                 path segment inside a URL is not a directory,
 *                                 and is left to hardcoded-hostname to judge.
 *   absolute-posix-path           An absolute system path anchored outside the
 *                                 repository is a layout assumption.
 *   unc-path                      A UNC path names one specific host.
 *   developer-username            See CURRENT_MACHINE_USERNAMES below.
 *   hardcoded-ip-address          An address literal is an environment
 *                                 assumption that is neither declared nor
 *                                 defaulted.
 *   hardcoded-hostname            Same, for a DNS name. A host is allowed only
 *                                 when it is a declared endpoint (see
 *                                 DOCUMENTED_ENDPOINTS).
 *   undocumented-port             A port assumption is allowed only when it is
 *                                 a documented default (see DOCUMENTED_PORTS).
 *   platform-only-invocation      A build command that only one OS can run —
 *                                 by the shell it names, or by the platform it
 *                                 pins its output to.
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
 *                                 A target sitting untracked in the working tree
 *                                 is the same violation and is reported with its
 *                                 own message, because the fix is `git add`.
 *   symlinked-path                A tracked path that is, or that reaches through,
 *                                 a symbolic link. Git records a link as a blob
 *                                 whose content is the target, and a checkout
 *                                 materialises a real link only where the platform
 *                                 and the local configuration allow one — so the
 *                                 same tracked path is a link on one machine and a
 *                                 one-line text file on another. A link is also the
 *                                 one way a tracked path can name a location
 *                                 outside the repository, which is the dependency
 *                                 this whole check exists to forbid.
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
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
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

/**
 * Network hosts a tracked file may name, each with the reason it is declared.
 *
 * **This table is a declaration, not an exemption, and the difference is the
 * whole point.** An ALLOWLIST entry switches the hostname rule OFF for a path, so
 * a second host arriving in the same file later is never seen. A row here names
 * ONE host: every other host in every file, including this one's own file, is
 * still reported. That is the shape ADR-0002 asks for when it says a sharper rule
 * is worth more than an exemption, and it is the same shape `DOCUMENTED_PORTS`
 * already has one row of.
 *
 * Matched on EXACT host equality. The reserved-suffix list below is matched with
 * `endsWith` because those genuinely are suffixes — every name under
 * `example.com` is reserved. An endpoint is not a suffix, and a suffix test here
 * would accept `updates.leapware.dev.somewhere-else.tld`, which is a different
 * host entirely and one an attacker can register.
 */
const DOCUMENTED_ENDPOINTS = new Map();

/*
 * EMPTY ON PURPOSE, AND THE REASON IS A SECURITY FINDING RATHER THAN A STYLE ONE.
 *
 * This map held one row: `updates.leapware.dev`, declared as the desktop update
 * feed. **That host was invented.** It was written to look plausible under the
 * project's brand, this organisation has never owned it, and a DNS lookup
 * returning an address was mistaken for proof of ownership — the apex resolves to
 * a netblock belonging to somebody else entirely.
 *
 * Why an invented feed host is worse than an invented anything else. The updater
 * uses `provider: generic`, so that one URL is the sole authority for BOTH the
 * `latest.yml` manifest and the installer the manifest names. A shipped
 * application would have asked a stranger's server what to download, and then run
 * it. Nothing this project produces is signed, so signature verification would not
 * have refused the answer. That is remote code execution by configuration, and it
 * was caught before any release, any tag, or any user holding a build.
 *
 * The rule this map softens is therefore switched fully back on: EVERY hostname in
 * every tracked non-Markdown file is now reported. Restoring a row here is how the
 * first real feed is declared, and it should happen in the same change that points
 * `electron-builder.yml` at a host somebody can prove they control — see
 * `docs/RELEASE.md` section 1. Until then the empty map is the honest state, and it
 * is what makes an accidental re-introduction fail the build.
 *
 * The `endsWith`-versus-equality argument below is kept because it survives the
 * deletion and is the trap the next person will meet: a suffix test would accept
 * `<declared-host>.somewhere-else.tld`, which is a different host and one an
 * attacker can register.
 */

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

/**
 * Whether the character at `index` sits inside a URL that begins earlier on the
 * same line.
 *
 * The test is deliberately cheap and deliberately strict. It looks backwards for
 * the nearest `://` and then requires that everything between it and the match is
 * URL-shaped — no quote, no whitespace, no bracket and no comma, any of which ends
 * an authority or a path in every format this repository tracks. So
 * `"https://host/tmp/x"` answers yes and `"https://host" + tmpDir + "/tmp/x"`
 * answers no, which is the distinction that matters: the second one is a path
 * being assembled, and a path being assembled is a path.
 *
 * Line-scoped, because every rule that uses it matches within one line.
 */
function withinUrl(line, index) {
  const before = line.slice(0, index);
  const scheme = before.lastIndexOf('://');
  if (scheme === -1) return false;
  return !/["'`\s,;()<>[\]{}]/.test(before.slice(scheme + 3));
}

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
    // A path segment inside a URL is not a directory on anybody's disk, and this
    // rule is about directories. The case that found it: npm writes registry
    // tarball URLs into package-lock.json, and two dependencies of the desktop
    // packaging lane are *named* `tmp` and `temp`, so their download URLs contain
    // `/tmp/` and `/temp/` as package-name segments.
    //
    // Sharpened rather than allowlisted, which is the choice ADR-0002 section 3
    // requires: an ALLOWLIST entry would have switched this rule off for the whole
    // lockfile, and a lockfile CAN carry a genuine local path — a `file:` reference
    // to a directory on the author's disk is exactly the dependency this checker
    // exists to catch, and it is the one thing an exemption here would have hidden.
    //
    // The argument that this gives nothing away: a URL is not a local-environment
    // dependency of the shape this rule describes, and a URL to somewhere it should
    // not be reaching is `hardcoded-hostname`'s finding, which is enforced on the
    // same line by a rule that has its own declared table. So the match is not
    // dropped, it is reassigned to the rule that can actually judge it.
    //
    // Deliberately NOT applied to the other path-shaped rules. Each one states its
    // own URL reasoning where it needs one — `windows-drive-path` carries a
    // lookbehind for exactly this purpose — and a shared accept applied everywhere
    // would be a single decision quietly loosening five rules at once.
    accept: (match, context) => withinUrl(context.line, match.index),
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
      // Exact equality, never a suffix test. See DOCUMENTED_ENDPOINTS.
      if (DOCUMENTED_ENDPOINTS.has(host)) return true;
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
      // ---------------------------------------------------------------------
      // THE SECOND WAY A COMMAND CAN BE PLATFORM-ONLY, AND THE ONE THIS RULE
      // MISSED UNTIL PACKAGING ARRIVED.
      //
      // The patterns above ask which SHELL a command names. This one asks which
      // PLATFORM it pins its output to. `electron-builder --win nsis` contains
      // no shell, no batch extension and no Windows path — it matches nothing
      // above — and it is a build step that produces an artifact on one
      // operating system and fails or lies on the other two.
      //
      // ADR-0002's prose already forbade it (clause "a platform-only script,
      // build command, or path separator"). The regex did not, and
      // ADR-0004 clause 8 recorded the gap in advance rather than relying on
      // it: a written rule with no checker is the weaker instrument ADR-0002's
      // own "Alternatives considered" section rejects. Prose and pattern are
      // therefore fixed in one change, which is the whole point of recording
      // the gap.
      //
      // THE PORTABLE FORM IS TO NAME NO PLATFORM. `electron-builder` with no
      // platform flag builds for the host it is running on, so
      // `npm run verify:desktop` is one command that means "package for this
      // machine" on all of them, and `.github/workflows/desktop.yml` gets its
      // two platforms from a `runs-on` matrix — which is where a platform
      // belongs, because that is the line that says which machine is present.
      //
      // Written as a flag rather than as a word so that ordinary prose is
      // untouched: `runs-on: windows-latest` is not a match and must not be.
      // `--linux` is included even though nothing here targets Linux, because a
      // rule that only forbids the platforms someone happened to think of is a
      // rule that teaches people to reach for the third one.
      /(?:^|\s)--(?:win|windows|mac|macos|linux)(?=[\s=]|$)/gi,
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

/** The mode git records for a symbolic link: a blob whose content is the target path. */
const GIT_SYMLINK_MODE = '120000';

/**
 * Every path the index lists, each with the mode the index records for it.
 *
 * `-s` rather than a bare listing, because the mode is how a tracked symbolic
 * link is identified without touching the filesystem at all — git stores a link
 * as a `120000` blob whose content is the target. That answer is the same on a
 * machine that materialised the link and on one whose platform or configuration
 * checked it out as an ordinary text file instead, which is exactly the
 * divergence the symlinked-path rule exists to report.
 *
 * `-z` keeps paths unquoted and NUL-terminated, so a path containing a space, a
 * quote or a non-ASCII byte survives intact. Within a record the metadata is
 * separated from the path by a single tab, and the metadata itself never
 * contains one, so splitting at the first tab is exact even for a path that
 * contains tabs of its own.
 *
 * @returns {{path: string, mode: string}[]}
 */
function trackedEntries() {
  let raw;
  try {
    raw = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-s', '-z'], {
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
  const entries = [];
  for (const record of raw.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const space = record.indexOf(' ');
    // Unparseable output means this check is reading something other than what
    // it thinks it is. Dropping the record would silently stop scanning a
    // tracked file, so this is a could-not-run rather than a clean result.
    if (tab === -1 || space === -1 || space > tab) {
      process.stderr.write(
        `check-portability: cannot parse the output of \`git ls-files -s -z\`. Expected "<mode> <object>\n` +
          `<stage>\\t<path>", and this record is not that:\n  ${JSON.stringify(record.slice(0, 200))}\n`,
      );
      process.exit(2);
    }
    entries.push({ path: record.slice(tab + 1), mode: record.slice(0, space) });
  }
  return entries;
}

/**
 * The repository-relative prefix of `file` that is a symbolic link, or undefined
 * when no part of it is one.
 *
 * `lstatSync`, never `statSync`: lstat describes the link itself, so a link is
 * detected rather than traversed, and this check never opens whatever is on the
 * far side. On Windows that covers junctions as well — lstat reports a reparse
 * point as a symbolic link, which is what makes a junction detectable here
 * without any Windows-specific code.
 *
 * The answer per prefix is memoised, so a tree of N tracked files costs one lstat
 * per distinct directory rather than one per segment per file — the cost is
 * proportional to the size of the tree, not to its depth times its size.
 *
 * The repository root itself is not tested. If the root were reached through a
 * link then every path under it would be, including the one this script was
 * invoked by and the one `git -C` was handed, so there would be nothing to
 * compare against and nothing meaningful to report.
 */
const linkedPrefixCache = new Map();
function linkedPrefixOf(file) {
  let prefix = '';
  for (const segment of file.split('/')) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    let linked = linkedPrefixCache.get(prefix);
    if (linked === undefined) {
      try {
        linked = lstatSync(resolve(REPO_ROOT, prefix)).isSymbolicLink();
      } catch {
        // Absent, or a path this process cannot stat. That is
        // unreadable-tracked-file's finding to report, not this rule's.
        linked = false;
      }
      linkedPrefixCache.set(prefix, linked);
    }
    if (linked) return prefix;
  }
  return undefined;
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

/**
 * Where a specifier would resolve on this working tree, ignoring the index.
 *
 * Consulted only after resolution against the index has already failed, and it
 * changes nothing about whether that is a violation: an untracked file is absent
 * from a clone, so the import genuinely breaks for whoever clones. What it changes
 * is the sentence. "Resolves to no tracked file" reads as a typo when the target
 * is plainly sitting on disk, and the one thing a reader needs — that it is
 * untracked and that `git add` is the fix — is exactly what the generic message
 * does not say.
 *
 * Returns the candidate that exists, or undefined when none does.
 */
function resolvesOnDisk(candidates) {
  for (const candidate of candidates) {
    try {
      if (confirmedOnDisk(candidate)) return candidate;
    } catch {
      // Absent, or a path this process cannot list or stat. Neither is a resolution.
    }
  }
  return undefined;
}

/**
 * Whether `candidate` is a file on disk whose spelling is byte-exact at **every**
 * segment, not just the last.
 *
 * `statSync` answers case-insensitively on Windows and macOS, so a hit proves
 * only that something resolves — not that it is spelled the way the specifier
 * spells it. A directory listing is byte-exact everywhere, so each segment is
 * confirmed against a listing of its parent before the walk descends into it.
 *
 * Confirming the basename alone is not enough, and the gap had teeth. Given
 * `src/components/button.ts` on disk and `import f from './Components/button'`,
 * a basename-only check builds the parent out of the specifier's own casing;
 * `readdirSync` opens `src/Components` happily on a case-insensitive filesystem,
 * the basename confirms, and the advice reads ``run `git add
 * src/Components/button.ts` ``. Following it records a mis-cased path in the
 * index — the case-collision this checker exists to prevent, introduced by
 * obeying the checker, on a developer's machine and never in CI. Segment-wise
 * confirmation means the advice can only ever name a path this filesystem
 * really has; anything less exact falls through to the generic message.
 *
 * The walk starts at REPO_ROOT and descends only into a name it has just seen in
 * a listing, so it cannot address anything outside the repository whatever a
 * candidate says, and `..` cannot survive it because no listing contains it.
 *
 * A listing is not enough on its own, though, because a symbolic link or a
 * Windows junction appears in its parent's listing under its own byte-exact name
 * and then leads somewhere else entirely. Every segment is therefore lstat'd —
 * lstat, so the link is described rather than followed — and a link ends the walk
 * unconfirmed. That is what stops this function confirming, and the caller
 * advising ``git add`` for, a path that only resolves because of a link on one
 * machine: recommending that a machine-local link be recorded in the index is the
 * dependency ADR-0002 forbids, arriving from the tool that enforces ADR-0002. A
 * refused link is not reported here — the import is already a violation, and the
 * link itself is untracked, which is outside what this check speaks about — so it
 * falls through to the generic "resolves to no tracked file" message.
 *
 * The final test is lstat too, and for the same reason: for a path with no link
 * in it lstat and stat agree, and where they disagree the honest answer is that
 * the last segment is a link and not a file.
 */
function confirmedOnDisk(candidate) {
  let directory = REPO_ROOT;
  for (const segment of candidate.split('/')) {
    if (!readdirSync(directory).includes(segment)) return false;
    directory = resolve(directory, segment);
    if (lstatSync(directory).isSymbolicLink()) return false;
  }
  return lstatSync(directory).isFile();
}

function lineOf(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

/**
 * @param files every tracked path, which is what an import must resolve *to*.
 * @param linked the subset already reported as symlinked-path, which is what an
 *   import must not be read *from*. Reading one would mean reading a file the
 *   repository does not contain, so the file is skipped here exactly as the main
 *   scan skipped it; its own violation is already recorded. It stays in `files`,
 *   because a link is still a name the index carries, and dropping it would turn
 *   one honest violation into a second, misleading import-unresolved elsewhere.
 */
function checkImports(files, linked) {
  const tracked = new Set(files);
  /** @type {Map<string, string>} */
  const trackedLowercase = new Map();
  for (const file of files) trackedLowercase.set(file.toLowerCase(), file);

  for (const file of files) {
    if (!file.startsWith('src/')) continue;
    if (!SOURCE_EXTENSIONS.includes(extensionOf(file))) continue;
    if (linked.has(file)) continue;

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
          const onDisk = resolvesOnDisk(candidates);
          if (onDisk !== undefined) {
            report(
              file,
              line,
              1,
              'import-unresolved',
              `an import whose target "${onDisk}" exists in this working tree but is not tracked by git, ` +
                `so a fresh clone would not have it and this import would fail there — run \`git add ${onDisk}\``,
              specifier,
            );
          } else {
            report(file, line, 1, 'import-unresolved', 'an import that resolves to no tracked file', specifier);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const entries = trackedEntries();
const files = entries.map((entry) => entry.path);

checkCaseCollisions(files);

/**
 * Tracked paths reported as symlinked-path, so the import pass skips reading them
 * for the same reason the scan below does.
 * @type {Set<string>}
 */
const linkedFiles = new Set();

let scanned = 0;
let skippedBinary = 0;
for (const { path: file, mode } of entries) {
  // Two independent questions, and both have to be asked. The index knows whether
  // git *records* a link, which is the durable fact and travels with the clone.
  // The working tree knows whether this checkout *has* one — a tracked directory
  // replaced locally by a link is invisible to the index, and it is the case that
  // lets a scan of "tracked files" read a file the repository does not contain.
  if (mode === GIT_SYMLINK_MODE) {
    linkedFiles.add(file);
    report(
      file,
      1,
      1,
      'symlinked-path',
      'a tracked symbolic link — git stores it as its target path, and a clone turns that back into a ' +
        'real link only where the platform and the local git configuration allow one, so this path is a ' +
        'link on some machines and a one-line text file on others',
      file,
    );
    continue;
  }
  const linkedPrefix = linkedPrefixOf(file);
  if (linkedPrefix !== undefined) {
    linkedFiles.add(file);
    report(
      file,
      1,
      1,
      'symlinked-path',
      linkedPrefix === file
        ? 'a tracked file that this working tree holds as a symbolic link, so its contents come from ' +
            'wherever the link points rather than from the repository'
        : `a tracked path reached through the symbolic link "${linkedPrefix}", so its contents come from ` +
            `wherever that link points rather than from the repository`,
      linkedPrefix,
    );
    // Deliberately not read. Reading would follow the link and scan a file outside
    // this repository — reporting, or clearing, content that no clone contains.
    continue;
  }
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

checkImports(files, linkedFiles);

/** Rules decided structurally rather than by a content pattern. Listed, not counted, so the total below is exact. */
const STRUCTURAL_RULES = [
  'line-endings',
  'byte-order-mark',
  'case-collision',
  'import-case',
  'import-unresolved',
  'symlinked-path',
  'unreadable-tracked-file',
];
const ruleCount = CONTENT_RULES.length + STRUCTURAL_RULES.length;

if (violations.length === 0) {
  // The username rule is the one rule whose patterns depend on the machine. Saying
  // so on a clean run keeps that visible rather than implying all 20 rules found
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
