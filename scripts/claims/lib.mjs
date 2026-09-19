/**
 * Shared helpers for the proof-of-completion scripts (docs/proof-of-completion.md §3).
 *
 * Everything here is a guardrail against the honest mistake, not an integrity control:
 * anyone who can merge can edit this file. The argv allowlist below is entry-point
 * validation for the register's `checks`, and it says nothing about what a check script
 * itself does once it runs; that is what the Linux `unshare --net` wrapper and review
 * are for.
 *
 * Every function that touches a process or the file system takes its runner or reader
 * as a parameter, so the node:test suites exercise it without a network or a token.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER_PATH = 'docs/claims.json';
export const EVIDENCE_DIR = 'docs/claims-evidence/';
export const CHECKS_DIR = 'scripts/claims/checks/';
export const PLANS_DIR = 'docs/plans/';
export const DEFAULT_REPO = 'LEAPWare-Software/LEAPWare-ShellUX';
export const CLASSES = ['repo', 'github', 'manual'];
export const OPS = ['==', '<=', '>=', '<', '>'];

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

/** Run a command without a shell. Returns `{ status, stdout, stderr }`. */
export function defaultRunner(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    timeout: options.timeout ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? String(result.error.message) : (result.stderr ?? ''),
  };
}

/** Run git and return stdout, throwing with git's message on a non-zero exit. */
export function git(args, { cwd = REPO_ROOT, run = defaultRunner, env } = {}) {
  const result = run('git', args, { cwd, env });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every depth, so equal content hashes equally. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** §3.1 rowHash: sha256 over the canonical JSON of box, class, checks, expect and probe. */
export function rowHash(row) {
  const material = {
    box: row.box ?? null,
    class: row.class ?? null,
    checks: row.checks ?? null,
    expect: row.expect ?? null,
    probe: row.probe ?? null,
  };
  return createHash('sha256').update(canonicalJson(material)).digest('hex');
}

export function parseRegister(text) {
  return JSON.parse(text);
}

export function loadRegister(root = REPO_ROOT, read = readFileSync) {
  return parseRegister(read(path.join(root, REGISTER_PATH), 'utf8'));
}

// ---------------------------------------------------------------------------
// The argv allowlist (§3.1)
// ---------------------------------------------------------------------------

const NODE_REJECTED_ARG1 = ['-e', '--eval', '-p', '--print', '--import', '--require', '-r'];
const GIT_SUBCOMMANDS = ['ls-files', 'show', 'grep', 'rev-parse', 'cat-file', 'diff'];
const GIT_REJECTED_LONG = ['--git-dir', '--work-tree', '--exec-path', '--ext-diff', '--output', '--open-files-in-pager'];
const GIT_REJECTED_SHORT = ['-c', '-C', '-O'];
const FORBIDDEN_WORDS = ['verify', 'test:coverage', 'test:browser'];

/**
 * `gh api` paths that name exactly one object. List and search endpoints do not match,
 * so they are rejected by construction rather than by a deny-list.
 */
const GH_API_PATHS = [
  /^repos\/[\w.-]+\/[\w.-]+$/,
  /^repos\/[\w.-]+\/[\w.-]+\/(pulls|issues)\/\d+$/,
  /^repos\/[\w.-]+\/[\w.-]+\/(commits|git\/commits)\/[0-9a-f]{7,40}$/,
  /^repos\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/,
  /^repos\/[\w.-]+\/[\w.-]+\/rulesets\/\d+$/,
];

function rejectsFlag(arg, shortFlags, longFlags) {
  if (longFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) return true;
  if (!arg.startsWith('--') && shortFlags.some((flag) => arg.startsWith(flag))) return true;
  return false;
}

function checkGhApi(argv) {
  const pathArg = argv[2];
  if (pathArg === undefined || pathArg.startsWith('-')) return 'gh api: the path must come first, before any flag';
  const normalised = pathArg.replace(/^\//, '');
  if (normalised === 'graphql' || normalised.startsWith('graphql')) return 'gh api: graphql is rejected';
  if (!GH_API_PATHS.some((re) => re.test(normalised))) {
    return `gh api: ${pathArg} is not a single-object path (list and search endpoints are rejected)`;
  }
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--jq') {
      if (argv[i + 1] === undefined) return 'gh api: --jq needs an expression';
      i += 1;
    } else if (arg.startsWith('--jq=')) {
      // joined form, fine
    } else if (arg === '--method' || arg.startsWith('--method=')) {
      const value = arg === '--method' ? argv[(i += 1)] : arg.slice('--method='.length);
      if (value !== 'GET') return `gh api: --method ${value} is rejected; only GET`;
    } else if (arg.startsWith('-X')) {
      return 'gh api: -X is rejected';
    } else {
      return `gh api: flag ${arg} is rejected; only --jq`;
    }
  }
  return null;
}

function checkGhView(argv) {
  const [, noun, verb, id] = argv;
  if (verb !== 'view') return `gh ${noun}: only "view" is allowed`;
  if (!/^\d+$/.test(id ?? '')) return `gh ${noun} view: needs a number, got ${id}`;
  for (let i = 4; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json' || arg === '--jq') {
      if (argv[i + 1] === undefined) return `gh ${noun} view: ${arg} needs a value`;
      i += 1;
    } else if (arg.startsWith('--json=') || arg.startsWith('--jq=')) {
      // joined form, fine
    } else {
      return `gh ${noun} view: flag ${arg} is rejected; only --json and --jq`;
    }
  }
  return null;
}

/**
 * Validate one check's argv for a row class. Returns `null` when allowed, or the reason
 * it is rejected.
 * *Tests:* scripts/__tests__/claims-lib.test.mjs — "rejects every form the allowlist names".
 */
export function validateArgv(argv, rowClass) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
    return 'a check must be a non-empty array of strings';
  }
  const word = argv.find((a) => FORBIDDEN_WORDS.some((w) => a.includes(w)));
  if (word !== undefined) return `argv containing "${word}" is rejected (verify, test:coverage and test:browser)`;
  const [cmd] = argv;
  if (cmd === 'node') {
    if (rowClass !== 'repo') return 'node checks are allowed in repo rows only';
    const script = argv[1];
    if (script === undefined) return 'node: a script path is required';
    if (NODE_REJECTED_ARG1.includes(script) || script.startsWith('-')) return `node: ${script} is rejected`;
    if (script.includes('\\')) return 'node: use forward slashes in the script path';
    if (path.posix.isAbsolute(script) || /^[A-Za-z]:/.test(script)) return 'node: the script path must be relative';
    const normalised = path.posix.normalize(script);
    if (!normalised.startsWith(CHECKS_DIR)) return `node: ${script} is not under ${CHECKS_DIR}`;
    return null;
  }
  if (cmd === 'git') {
    if (rowClass !== 'repo') return 'git checks are allowed in repo rows only';
    if (!GIT_SUBCOMMANDS.includes(argv[1])) return `git: subcommand ${argv[1]} is not allowed`;
    const bad = argv.slice(2).find((a) => rejectsFlag(a, GIT_REJECTED_SHORT, GIT_REJECTED_LONG));
    if (bad !== undefined) return `git: ${bad} is rejected`;
    return null;
  }
  if (cmd === 'gh') {
    if (rowClass !== 'github') return 'gh checks are allowed in github rows only';
    if (argv[1] === 'api') return checkGhApi(argv);
    if (['pr', 'run', 'issue'].includes(argv[1])) return checkGhView(argv);
    return `gh: ${argv[1]} is not allowed`;
  }
  return `command ${cmd} is not allowed (node, git, gh)`;
}

// ---------------------------------------------------------------------------
// Register validation (structural)
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the register's shape. Returns a list of `{ rowId, message }` errors; empty
 * when the register is well formed. `exists(relPath)` answers whether a tracked file is
 * present, for manual evidence.
 */
export function validateRegister(register, exists = (p) => existsSync(path.join(REPO_ROOT, p))) {
  const errors = [];
  const fail = (rowId, message) => errors.push({ rowId, message });
  if (register === null || typeof register !== 'object') return [{ rowId: null, message: 'register is not an object' }];
  if (register.schemaVersion !== 1) fail(null, `schemaVersion must be 1, got ${register.schemaVersion}`);
  if (!Array.isArray(register.active)) fail(null, 'active must be an array');
  if (!Array.isArray(register.retired)) fail(null, 'retired must be an array');
  const extra = Object.keys(register).filter((k) => !['schemaVersion', 'active', 'retired'].includes(k));
  if (extra.length) fail(null, `unknown top-level keys: ${extra.join(', ')}`);
  if (errors.length) return errors;

  const seen = new Set();
  const all = [...register.active.map((r) => [r, false]), ...register.retired.map((r) => [r, true])];
  for (const [row, retired] of all) {
    const id = row?.id;
    if (typeof id !== 'string' || !/^C-\d+$/.test(id)) {
      fail(id ?? null, `id must be C- plus digits, got ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) fail(id, 'id is not unique across active and retired');
    seen.add(id);
    if (typeof row.box !== 'string' || row.box.trim() === '') fail(id, 'box must be a non-empty string');
    if (!CLASSES.includes(row.class)) fail(id, `class must be one of ${CLASSES.join(', ')}`);
    if (typeof row.provenOn !== 'string' || !DATE.test(row.provenOn)) fail(id, 'provenOn must be YYYY-MM-DD');
    if (typeof row.addedBy !== 'string' || row.addedBy.trim() === '') fail(id, 'addedBy is required');
    if (retired) {
      if (!row.retiredBy || !row.reason) fail(id, 'a retired row needs retiredBy and reason');
    }
    if (row.expect !== undefined) {
      if (!Array.isArray(row.expect)) fail(id, 'expect must be an array');
      else {
        for (const e of row.expect) {
          if (typeof e?.key !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(e.key)) fail(id, `expect key ${JSON.stringify(e?.key)} is malformed`);
          if (!OPS.includes(e?.op)) fail(id, `expect op ${JSON.stringify(e?.op)} is not one of ${OPS.join(' ')}`);
          if (typeof e?.value === 'string' && e.op !== '==') fail(id, `expect ${e.key}: a string value takes only ==`);
          if (typeof e?.value !== 'string' && typeof e?.value !== 'number') fail(id, `expect ${e?.key}: value must be a number or a string`);
        }
      }
    }
    if (row.class === 'manual') {
      if (row.checks !== undefined) fail(id, 'a manual row has no checks');
      if (row.probe !== undefined) fail(id, 'a manual row has no probe');
      if (typeof row.evidence !== 'string' || !path.posix.normalize(row.evidence).startsWith(EVIDENCE_DIR)) {
        fail(id, `evidence must name a file under ${EVIDENCE_DIR}`);
      } else if (!retired && !exists(row.evidence)) {
        fail(id, `evidence file ${row.evidence} is missing`);
      }
    } else if (CLASSES.includes(row.class)) {
      if (!Array.isArray(row.checks) || row.checks.length === 0) fail(id, 'checks must be a non-empty array');
      else {
        for (const argv of row.checks) {
          const reason = validateArgv(argv, row.class);
          if (reason) fail(id, `check ${JSON.stringify(argv)}: ${reason}`);
        }
      }
      if (row.evidence !== undefined) fail(id, 'evidence belongs to manual rows only');
      if (row.class === 'repo') {
        const probeError = validateProbe(row.probe);
        if (probeError) fail(id, probeError);
      } else if (row.probe !== undefined) {
        fail(id, 'a probe belongs to repo rows only');
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Expectations (§3.1, G2)
// ---------------------------------------------------------------------------

/** Every `key=value` line of a check's output, as a map of key to all its values. */
export function parseKeyValues(output) {
  const map = new Map();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], []);
    map.get(m[1]).push(m[2].trim());
  }
  return map;
}

/** Numbers compare after thousands separators are stripped: "2,137" is 2137. */
export function toNumber(text) {
  const stripped = text.replace(/[,_\s]/gu, '');
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return NaN;
  return Number(stripped);
}

function compare(actual, op, expected) {
  switch (op) {
    case '==':
      return actual === expected;
    case '<=':
      return actual <= expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '>':
      return actual > expected;
    default:
      return false;
  }
}

/**
 * Evaluate a row's `expect` list against its concatenated output. Each key must appear
 * exactly once. Returns `[{ key, op, value, actual, pass, reason? }]`.
 */
export function evaluateExpect(expect = [], output = '') {
  const values = parseKeyValues(output);
  return expect.map(({ key, op, value }) => {
    const found = values.get(key) ?? [];
    if (found.length !== 1) {
      return { key, op, value, actual: null, pass: false, reason: `${key} printed ${found.length} times; exactly once is required` };
    }
    const [raw] = found;
    if (typeof value === 'number') {
      const actual = toNumber(raw);
      if (Number.isNaN(actual)) return { key, op, value, actual: raw, pass: false, reason: `${key}=${raw} is not a number` };
      return { key, op, value, actual, pass: compare(actual, op, value) };
    }
    return { key, op, value, actual: raw, pass: compare(raw, op, value) };
  });
}

/** `handoff_bytes=1928 <= 3000` */
export function formatExpectation(result) {
  const shown = typeof result.value === 'string' ? JSON.stringify(result.value) : result.value;
  const actual = result.actual === null ? '(absent)' : result.actual;
  return `${result.key}=${actual} ${result.op} ${shown}`;
}

// ---------------------------------------------------------------------------
// Running a row
// ---------------------------------------------------------------------------

/**
 * Network restriction for repo rows (§3.1), a guardrail: `unshare --net` keeps an honest
 * check from reaching the network by accident. Only on Linux CI, only when
 * CLAIMS_NET_RESTRICT=unshare. Elsewhere rows run unrestricted and the caller says so.
 */
export function networkRestriction(env = process.env, platform = process.platform, user = safeUser()) {
  if (env.CLAIMS_NET_RESTRICT !== 'unshare') return { restricted: false };
  if (platform !== 'linux') {
    throw new Error(`CLAIMS_NET_RESTRICT=unshare is set but the platform is ${platform}; the wrapper runs on Linux only`);
  }
  return { restricted: true, prefix: ['unshare', '--net', '--', 'sudo', '-u', user, '-E'] };
}

function safeUser() {
  try {
    return os.userInfo().username;
  } catch {
    return 'runner';
  }
}

/**
 * Prove the wrapper works before trusting it: a wrapper that fails must fail the job,
 * never fall back to running unrestricted.
 */
export function assertRestrictionWorks(restrict, run = defaultRunner) {
  if (!restrict.restricted) return;
  const result = run('sudo', [...restrict.prefix, process.execPath, '-e', 'process.exit(0)'], {});
  if (result.status !== 0) {
    throw new Error(`the unshare wrapper failed (${result.stderr.trim()}); refusing to run repo rows unrestricted`);
  }
}

/** Turn a check argv into the command actually spawned. */
export function commandFor(argv, rowClass, restrict) {
  const [cmd, ...args] = argv;
  const resolved = cmd === 'node' ? process.execPath : cmd;
  if (rowClass === 'repo' && restrict.restricted) {
    return { cmd: 'sudo', args: [...restrict.prefix, resolved, ...args] };
  }
  return { cmd: resolved, args };
}

/**
 * Run a row's checks and evaluate its expectations. Returns
 * `{ pass, output, expect, failures, ms }`.
 */
export function runRow(row, { cwd = REPO_ROOT, run = defaultRunner, restrict = { restricted: false }, now = Date.now } = {}) {
  const started = now();
  const failures = [];
  let output = '';
  for (const argv of row.checks ?? []) {
    const reason = validateArgv(argv, row.class);
    if (reason) {
      failures.push(`check ${JSON.stringify(argv)} rejected: ${reason}`);
      continue;
    }
    const { cmd, args } = commandFor(argv, row.class, restrict);
    const result = run(cmd, args, { cwd });
    output += result.stdout.endsWith('\n') || result.stdout === '' ? result.stdout : `${result.stdout}\n`;
    if (result.status !== 0) failures.push(`${argv.join(' ')} exited ${result.status}: ${result.stderr.trim().slice(0, 400)}`);
  }
  const expect = evaluateExpect(row.expect, output);
  for (const e of expect) if (!e.pass) failures.push(e.reason ?? `expectation failed: ${formatExpectation(e)}`);
  return { pass: failures.length === 0, output, expect, failures, ms: now() - started };
}

// ---------------------------------------------------------------------------
// Probes (§3.1)
// ---------------------------------------------------------------------------

export function validateProbe(probe) {
  if (probe === undefined) return 'a repo row requires a probe';
  if (typeof probe?.name !== 'string' || !probe.name.trim()) return 'probe.name is required';
  if (!Array.isArray(probe.edits) || probe.edits.length === 0) return 'probe.edits must be a non-empty array';
  for (const edit of probe.edits) {
    if (typeof edit?.file !== 'string' || edit.file.includes('..') || path.posix.isAbsolute(edit.file)) {
      return `probe edit file ${JSON.stringify(edit?.file)} must be a relative path inside the tree`;
    }
    const ops = ['append', 'pad', 'replace', 'delete'].filter((op) => edit[op] !== undefined);
    if (ops.length !== 1) return `probe edit on ${edit.file} must have exactly one of append, pad, replace, delete`;
    if (edit.replace !== undefined && (!Array.isArray(edit.replace) || edit.replace.length !== 2)) {
      return `probe edit on ${edit.file}: replace is [find, with]`;
    }
    if (edit.pad !== undefined && !(Number.isInteger(edit.pad) && edit.pad > 0)) return `probe edit on ${edit.file}: pad is a positive integer`;
  }
  return null;
}

/** Apply a probe's edits inside `dir`. Throws when a replace finds nothing to replace. */
export function applyProbe(probe, dir, fsImpl = { readFileSync, writeFileSync, unlinkSync }) {
  for (const edit of probe.edits) {
    const file = path.join(dir, edit.file);
    if (edit.delete) {
      fsImpl.unlinkSync(file);
      continue;
    }
    const text = fsImpl.readFileSync(file, 'utf8');
    let next;
    if (edit.append !== undefined) next = text + edit.append;
    else if (edit.pad !== undefined) next = text + 'x'.repeat(edit.pad);
    else {
      const [find, replacement] = edit.replace;
      if (!text.includes(find)) throw new Error(`probe "${probe.name}": ${edit.file} does not contain ${JSON.stringify(find)}`);
      next = text.split(find).join(replacement);
    }
    fsImpl.writeFileSync(file, next);
  }
}

/**
 * The commit a probe's scratch worktree starts from. A clean tree uses HEAD. A dirty one
 * uses `git stash create`, which snapshots tracked and staged changes into a commit
 * object without touching the working tree, so a local run probes what is on disk.
 * Untracked files are not in the snapshot: stage a new file first (the same rule
 * `check:portability` already imposes).
 */
export function snapshotCommit({ cwd = REPO_ROOT, run = defaultRunner } = {}) {
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], { cwd, run }).trim() !== '';
  if (!dirty) return git(['rev-parse', 'HEAD'], { cwd, run }).trim();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'claims-probe',
    GIT_AUTHOR_EMAIL: 'claims-probe@example.invalid',
    GIT_COMMITTER_NAME: 'claims-probe',
    GIT_COMMITTER_EMAIL: 'claims-probe@example.invalid',
  };
  const sha = git(['stash', 'create'], { cwd, run, env }).trim();
  return sha || git(['rev-parse', 'HEAD'], { cwd, run }).trim();
}

/** Remove a symlink or junction without ever following it. */
function unlinkLink(linked) {
  try {
    unlinkSync(linked);
  } catch {
    try {
      rmdirSync(linked);
    } catch {
      // Absent, or not removable: the caller checks existence and refuses to go on.
    }
  }
}

/**
 * Run a probe: in a scratch worktree at `commit`, the row must pass unmutated (so a red
 * result cannot come from a broken scratch tree) and fail once the probe is applied.
 * Returns `{ pass, baseline, mutated, reason?, ms }`.
 */
export function runProbe(row, { commit, cwd = REPO_ROOT, run = defaultRunner, restrict = { restricted: false }, now = Date.now } = {}) {
  const started = now();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claims-probe-'));
  rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'add', '--detach', '--quiet', dir, commit], { cwd, run });
  const linked = path.join(dir, 'node_modules');
  let outcome;
  try {
    const modules = path.join(cwd, 'node_modules');
    if (existsSync(modules)) symlinkSync(modules, linked, 'junction');
    outcome = probeInside(row, dir, { run, restrict, now });
  } finally {
    // The link must be gone before git deletes the scratch tree: a recursive delete that
    // followed it would empty the real node_modules.
    unlinkLink(linked);
  }
  if (existsSync(linked)) {
    // Leak the scratch directory rather than risk that delete.
    throw new Error(`could not remove the node_modules link in ${dir}; the scratch worktree is left in place`);
  }
  git(['worktree', 'remove', '--force', dir], { cwd, run });
  return { ...outcome, ms: now() - started };
}

function probeInside(row, dir, { run, restrict, now }) {
  const baseline = runRow(row, { cwd: dir, run, restrict, now });
  if (!baseline.pass) {
    return { pass: false, baseline, mutated: null, reason: `baseline is red before the probe: ${baseline.failures.join('; ')}` };
  }
  applyProbe(row.probe, dir);
  const mutated = runRow(row, { cwd: dir, run, restrict, now });
  if (mutated.pass) {
    return { pass: false, baseline, mutated, reason: `probe "${row.probe.name}" left the row green: the row is vacuous` };
  }
  return { pass: true, baseline, mutated };
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

/** `refs/heads/gh-readonly-queue/main/pr-<N>-<base-sha>` → N, or throw. */
export function prNumberFromQueueRef(headRef) {
  const m = /^(?:refs\/heads\/)?gh-readonly-queue\/[^/]+\/pr-(\d+)-[0-9a-f]{40}$/.exec(headRef ?? '');
  if (!m) throw new Error(`cannot resolve a pull request number from merge_group head_ref ${JSON.stringify(headRef)}`);
  return Number(m[1]);
}

/** A GitHub token is available from the environment or from `gh auth token`. */
export function hasToken(env = process.env, run = defaultRunner) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return true;
  const result = run('gh', ['auth', 'token'], {});
  return result.status === 0 && result.stdout.trim() !== '';
}

/** `gh api <path>` parsed as JSON; throws with gh's message. */
export function ghJson(apiPath, run = defaultRunner) {
  const result = run('gh', ['api', apiPath], {});
  if (result.status !== 0) throw new Error(`gh api ${apiPath} failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

/** A GitHub Actions annotation line. */
export function annotation(level, message, file, line) {
  const where = file ? ` file=${file}${line ? `,line=${line}` : ''}` : '';
  const clean = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::${level}${where}::${clean}`;
}
