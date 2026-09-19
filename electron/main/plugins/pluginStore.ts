import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareHostApiVersion, quoteUntrusted } from './compatibility.js';
import { EXTENSION_ID_PATTERN, HOST_API_VERSION, RESERVED_IDS } from './hostContract.js';
import {
  MAX_PACKAGE_BYTES,
  PACKAGE_ENTRY,
  PLUGIN_VERSION_PATTERN,
  nodePluginPackageFs,
  parseInstalledManifest,
  readBoundedFile,
  readPluginPackage,
  serializeManifest,
  sha512Base64,
} from './pluginPackage.js';
import type { PluginManifest, PluginPackageFs } from './pluginPackage.js';

/**
 * ============================================================================
 * THE PLUGIN STORE: WHAT IS INSTALLED, WHERE, AND IN WHAT STATE. MAIN ONLY.
 * ============================================================================
 * ADR-0006 decision 2 and the store half of decision 4, implementation step 4.
 * The layout, under `<userData>/plugins/` (`index.ts` passes the root):
 *
 *   state.json                 written only by this module: id → record
 *   <id>/<version>/plugin.json the VALIDATED manifest, re-serialised
 *   <id>/<version>/bundle.js   the entry's bytes, as the package carried them
 *   .staging-* / .retired-*    transient; nothing reads them
 *
 * A transient name starts with `.`, which `EXTENSION_ID_PATTERN` never admits
 * as a first character, and `state.json` carries a `.`, which no id may; so no
 * id can name either. Every path this module builds is joined from an id and a
 * version that passed the manifest rules (at install) or the `state.json` rules
 * (at read) — never from a renderer string. The renderer supplies no path at
 * all: the package path comes from the picker main opens (`pluginIpc.ts`).
 *
 * ---------------------------------------------------------------------------
 * INSTALL: TEMPORARY DIRECTORY, VALIDATE, RENAME. A HALF-WRITTEN PLUGIN IS NEVER LISTED.
 * ---------------------------------------------------------------------------
 * The package is read and validated by `readPluginPackage` (step 3) before a
 * byte is written. Its bundle and manifest are written into a `.staging-*`
 * directory beside the target, which is renamed into `<id>/<version>/`; only
 * then does `state.json` name it. What is listed and served is decided by
 * `state.json` alone, so a directory with no record is never either. A package
 * whose `hostApiVersion` the host does not meet is INSTALLED and recorded, and
 * shows as incompatible — decision 11's state, whose one action is remove — and
 * is never served. An already-installed id at another version is an UPDATE:
 * the new version goes in beside the old, `state.json` switches, and the old
 * directory is deleted. Decision 2 deletes it after the extension surface
 * reloads; no surface loads plugins before step 6, so today it goes as soon as
 * `state.json` has switched, and step 6 moves the deletion after its reload.
 * The same version again is a REINSTALL — decision 11's action for a plugin
 * whose files changed — and clears the fault. *Tests:*
 * `electron/__tests__/pluginScheme.test.ts` — "installs an update beside the
 * old version, switches state.json, then deletes the old directory", "a
 * reinstall of the same version clears the files-changed state".
 *
 * ---------------------------------------------------------------------------
 * `plugin.json` IS THE VALIDATED MANIFEST, AND EVERY READER USES `JSON.parse`.
 * ---------------------------------------------------------------------------
 * Step 3's invariant, kept: `plugin.json` is written by `serializeManifest`
 * from the manifest that passed validation, never from the package's bytes, so
 * a package with two `title` keys installs one. `plugin.json` and `state.json`
 * are both read back with `JSON.parse` and re-validated. *Tests:*
 * `electron/__tests__/pluginScheme.test.ts` — "writes plugin.json from the
 * validated manifest re-serialised, never the package's raw bytes".
 *
 * ---------------------------------------------------------------------------
 * THE SERVE-TIME REHASH IS ENTRY-POINT VALIDATION, AND NOTHING MORE.
 * ---------------------------------------------------------------------------
 * `entryFor` reads `bundle.js` once, hashes those bytes, compares them with the
 * `sha512` recorded in `state.json` at install, and returns the SAME bytes it
 * hashed, so what is served is what was checked. A mismatch refuses the serve
 * and records the plugin as `files-changed` — D-48's fifth state, not a crash:
 * Restart cannot fix wrong files, Reinstall can. It catches a file changed on
 * disk after install by anything that did not also rewrite `state.json`. It
 * enforces nothing against a local user: `state.json` sits in the same
 * user-writable directory as the files it describes, and whoever rewrites both
 * passes it. *Tests:* `electron/__tests__/pluginScheme.test.ts` — "refuses to
 * serve an entry changed on disk after install", "serves a bundle whose file
 * and state.json record were rewritten together, because state.json is as
 * writable as the bundle".
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE THROWS, AND EVERY OPERATION IS SYNCHRONOUS.
 * ---------------------------------------------------------------------------
 * Each operation returns a result or one reason. The filesystem is synchronous
 * and injected (`PluginStoreFs`, the seam `diagnosticsLog.ts` and
 * `pluginPackage.ts` use), so an operation runs to completion inside one turn
 * of main's event loop and two IPC calls cannot interleave inside one. The cost,
 * accepted: a serve reads and hashes up to 8 MiB on main's thread.
 * ============================================================================
 */

/** The file main records every installed plugin in. */
export const STATE_FILE = 'state.json';

/** The installed manifest, beside the entry. */
export const MANIFEST_FILE = 'plugin.json';

/** The one `state.json` format this host reads and writes. */
export const STATE_FORMAT = 'shellux-plugin-state/1';

/** Bound on `state.json`. Sixty-four plugins' records fit in a few KiB. */
export const MAX_STATE_BYTES = 1024 * 1024;

/** Bound on `plugin.json`. A manifest is under a KiB; a title is at most 256 characters. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** Bound on a recorded fault's reason. */
export const MAX_FAULT_REASON = 1024;

/** D-48's words for the fifth state, as ADR-0006 decision 11 gives them. */
export const FILES_CHANGED_REASON = "the installed files no longer match this plugin's manifest";

const STAGING_PREFIX = '.staging-';
const RETIRED_PREFIX = '.retired-';
const STATE_TEMP_FILE = '.state.json.tmp';

/** A fault main recorded. `crashed` is decision 9's, written from step 6; `files-changed` is D-48's. */
export interface PluginFault {
  readonly state: 'files-changed' | 'crashed';
  readonly reason: string;
  /** ISO 8601, when main recorded it. */
  readonly at: string;
}

/** One plugin's line in `state.json`. */
export interface PluginRecord {
  readonly version: string;
  readonly enabled: boolean;
  /** The entry's hash as installed; the serve-time rehash compares against this. */
  readonly sha512: string;
  readonly fault: PluginFault | null;
}

/** Decision 11's five states. */
export type PluginStatus = 'enabled' | 'disabled' | 'incompatible' | 'crashed' | 'files-changed';

/**
 * What host chrome is told about one plugin: data only (ADR-0006 decision 6),
 * structured-clone shaped. `title`, `icon` and `hostApiVersion` are `null` when
 * the installed `plugin.json` could not be read.
 */
export interface PluginListing {
  readonly id: string;
  readonly version: string;
  readonly title: string | null;
  readonly icon: string | null;
  readonly hostApiVersion: string | null;
  readonly status: PluginStatus;
  /** Why, in words, for `incompatible`, `crashed` and `files-changed`; otherwise `null`. */
  readonly reason: string | null;
}

export type StoreResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** The filesystem operations the store needs: the package reader's four, and six writes. */
export interface PluginStoreFs extends PluginPackageFs {
  existsSync: (path: string) => boolean;
  /** Recursive: creates parents, and succeeds when the directory exists. */
  mkdirSync: (path: string) => void;
  /** Creates a directory named `prefix` plus a unique suffix, and returns its path. */
  mkdtempSync: (prefix: string) => string;
  writeFileSync: (path: string, data: Uint8Array) => void;
  renameSync: (from: string, to: string) => void;
  /** Recursive and forced: a missing path is not an error. */
  rmSync: (path: string) => void;
}

/** The real filesystem. What production code passes. */
export const nodePluginStoreFs: PluginStoreFs = {
  ...nodePluginPackageFs,
  existsSync,
  mkdirSync: (path) => {
    mkdirSync(path, { recursive: true });
  },
  mkdtempSync: (prefix) => mkdtempSync(prefix),
  writeFileSync: (path, data) => {
    writeFileSync(path, data);
  },
  renameSync,
  rmSync: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
};

export interface PluginStoreOptions {
  /** `<userData>/plugins`. */
  readonly root: string;
  readonly fs: PluginStoreFs;
  readonly warn: (message: string) => void;
  /** The host's contract; a test passes another to put a plugin on either side of the rule. */
  readonly hostVersion?: string;
  /** When a fault is recorded. */
  readonly now?: () => Date;
}

export interface PluginStore {
  /** Every installed plugin, sorted by id. Records a `files-changed` fault it discovers. */
  list(): StoreResult<readonly PluginListing[]>;
  /** Install, update or reinstall from a `.lwplugin` main chose. Never a renderer's path. */
  install(packagePath: string): StoreResult<PluginListing>;
  /** Enable or disable an installed, compatible, unfaulted plugin. */
  setEnabled(id: unknown, enabled: boolean): StoreResult<PluginListing>;
  /** Drop the record, then delete the directory. */
  remove(id: unknown): StoreResult<{ readonly id: string }>;
  /**
   * The entry's bytes, for the `/plugins/` route: only for an installed,
   * enabled, compatible, unfaulted plugin at that exact version, and only when
   * the bytes still hash to the recorded `sha512`.
   */
  entryFor(id: string, version: string): StoreResult<Uint8Array<ArrayBuffer>>;
}

/** Every refusal below throws; `run` turns any throw into `{ ok: false }` before it leaves this module. */
function refuse(reason: string): never {
  throw new Error(reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

function parseFault(value: unknown): PluginFault | null {
  if (value === null) return null;
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ['state', 'reason', 'at']) ||
    (value.state !== 'files-changed' && value.state !== 'crashed') ||
    typeof value.reason !== 'string' ||
    value.reason.length > MAX_FAULT_REASON ||
    typeof value.at !== 'string'
  ) {
    refuse('a fault record is malformed');
  }
  return { state: value.state, reason: value.reason, at: value.at };
}

function parseRecord(id: string, value: unknown): PluginRecord {
  if (!EXTENSION_ID_PATTERN.test(id) || RESERVED_IDS.has(id)) {
    refuse(`${quoteUntrusted(id)} is not a valid extension id`);
  }
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ['version', 'enabled', 'sha512', 'fault']) ||
    typeof value.version !== 'string' ||
    !PLUGIN_VERSION_PATTERN.test(value.version) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.sha512 !== 'string' ||
    !SHA512_BASE64_PATTERN.test(value.sha512) ||
    !Object.hasOwn(value, 'fault')
  ) {
    refuse(`the record for ${quoteUntrusted(id)} is malformed`);
  }
  return { version: value.version, enabled: value.enabled, sha512: value.sha512, fault: parseFault(value.fault) };
}

/** `state.json`'s bytes as records, through `JSON.parse` and nothing else. Refuses by throwing. */
function parseState(bytes: Uint8Array): Map<string, PluginRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    refuse('it is not a UTF-8 JSON document');
  }
  if (
    !isPlainObject(parsed) ||
    !hasOnlyKeys(parsed, ['format', 'plugins']) ||
    parsed.format !== STATE_FORMAT ||
    !isPlainObject(parsed.plugins)
  ) {
    refuse(`it is not a ${STATE_FORMAT} document`);
  }
  const records = new Map<string, PluginRecord>();
  for (const [id, value] of Object.entries(parsed.plugins)) records.set(id, parseRecord(id, value));
  return records;
}

function serializeState(records: ReadonlyMap<string, PluginRecord>): Uint8Array {
  const plugins: Record<string, PluginRecord> = {};
  for (const id of [...records.keys()].sort()) plugins[id] = records.get(id) as PluginRecord;
  return new TextEncoder().encode(`${JSON.stringify({ format: STATE_FORMAT, plugins }, null, 2)}\n`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Why a record's installed files are not what was installed, or its manifest. */
type Inspection = { readonly ok: true; readonly manifest: PluginManifest } | { readonly ok: false; readonly detail: string };

export function createPluginStore(options: PluginStoreOptions): PluginStore {
  const { root, fs, warn } = options;
  const hostVersion = options.hostVersion ?? HOST_API_VERSION;
  const now = options.now ?? ((): Date => new Date());
  const statePath = join(root, STATE_FILE);

  function versionDirectory(id: string, version: string): string {
    return join(root, id, version);
  }

  /** Every operation starts here: a `state.json` that cannot be read refuses the operation, and is never overwritten. */
  function readState(): Map<string, PluginRecord> {
    if (!fs.existsSync(statePath)) return new Map();
    const read = readBoundedFile(fs, statePath, MAX_STATE_BYTES, STATE_FILE);
    if (!read.ok) refuse(`${STATE_FILE} could not be read: ${read.reason}`);
    try {
      return parseState(read.bytes);
    } catch (error) {
      refuse(`${STATE_FILE} could not be read: ${describeError(error)}`);
    }
  }

  /** Write beside, then rename over: a reader sees the old file or the new one, never half of one. */
  function writeState(records: ReadonlyMap<string, PluginRecord>): void {
    const temp = join(root, STATE_TEMP_FILE);
    try {
      fs.mkdirSync(root);
      fs.writeFileSync(temp, serializeState(records));
      fs.renameSync(temp, statePath);
    } catch (error) {
      refuse(`${STATE_FILE} could not be written: ${describeError(error)}`);
    }
  }

  /** Delete what nothing names any more. A failure leaves an orphan directory and is said, not thrown. */
  function removeQuietly(path: string): void {
    try {
      fs.rmSync(path);
    } catch (error) {
      warn(`plugin store: could not delete ${path}: ${describeError(error)}`);
    }
  }

  /** The installed `plugin.json`, validated, and held to the record it sits under. */
  function inspect(id: string, record: PluginRecord): Inspection {
    const read = readBoundedFile(
      fs,
      join(versionDirectory(id, record.version), MANIFEST_FILE),
      MAX_MANIFEST_BYTES,
      MANIFEST_FILE,
    );
    if (!read.ok) return { ok: false, detail: read.reason };
    const parsed = parseInstalledManifest(read.bytes);
    if (!parsed.ok) return { ok: false, detail: parsed.reason };
    const { manifest } = parsed;
    if (manifest.id !== id || manifest.version !== record.version || manifest.sha512 !== record.sha512) {
      return { ok: false, detail: `${MANIFEST_FILE} names a different id, version or sha512 than ${STATE_FILE}` };
    }
    return { ok: true, manifest };
  }

  /** Record D-48's fifth state. The serve is refused whether or not the record could be written. */
  function markFilesChanged(records: Map<string, PluginRecord>, id: string, record: PluginRecord, detail: string): void {
    warn(`plugin store: ${id} ${record.version}: ${FILES_CHANGED_REASON} (${detail})`);
    records.set(id, { ...record, fault: { state: 'files-changed', reason: FILES_CHANGED_REASON, at: now().toISOString() } });
    try {
      writeState(records);
    } catch (error) {
      warn(`plugin store: ${describeError(error)}`);
    }
  }

  function listingOf(records: Map<string, PluginRecord>, id: string): PluginListing {
    let record = records.get(id) as PluginRecord;
    const inspection = inspect(id, record);
    if (!inspection.ok && record.fault === null) {
      markFilesChanged(records, id, record, inspection.detail);
      record = records.get(id) as PluginRecord;
    }
    const manifest = inspection.ok ? inspection.manifest : null;
    const base = {
      id,
      version: record.version,
      title: manifest?.title ?? null,
      icon: manifest?.icon ?? null,
      hostApiVersion: manifest?.hostApiVersion ?? null,
    };
    if (record.fault !== null) return { ...base, status: record.fault.state, reason: record.fault.reason };
    const compatibility = compareHostApiVersion((manifest as PluginManifest).hostApiVersion, hostVersion);
    if (compatibility.state === 'incompatible') return { ...base, status: 'incompatible', reason: compatibility.reason };
    return { ...base, status: record.enabled ? 'enabled' : 'disabled', reason: null };
  }

  function knownId(records: ReadonlyMap<string, PluginRecord>, id: unknown): string {
    if (typeof id !== 'string' || !records.has(id)) refuse('no plugin with that id is installed');
    return id;
  }

  function run<T>(operation: () => T): StoreResult<T> {
    try {
      return { ok: true, value: operation() };
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
  }

  function install(packagePath: string): PluginListing {
    const read = readPluginPackage(fs, packagePath, hostVersion);
    if (!read.ok) refuse(`the package was refused: ${read.reason}`);
    const { manifest, bundle } = read.plugin;
    const records = readState();
    const previous = records.get(manifest.id);
    const target = versionDirectory(manifest.id, manifest.version);

    let staging: string | null = null;
    let retired: string | null = null;
    let placed = false;
    try {
      fs.mkdirSync(join(root, manifest.id));
      staging = fs.mkdtempSync(join(root, STAGING_PREFIX));
      fs.writeFileSync(join(staging, PACKAGE_ENTRY), bundle);
      fs.writeFileSync(join(staging, MANIFEST_FILE), serializeManifest(manifest));
      if (fs.existsSync(target)) {
        retired = join(root, `${RETIRED_PREFIX}${randomUUID()}`);
        fs.renameSync(target, retired);
      }
      fs.renameSync(staging, target);
      placed = true;
      records.set(manifest.id, {
        version: manifest.version,
        enabled: previous?.enabled ?? true,
        sha512: manifest.sha512,
        fault: null,
      });
      writeState(records);
    } catch (error) {
      // Undo in reverse, so `state.json` — unchanged, since its write is the
      // last step — still describes what is on disk.
      if (placed) removeQuietly(target);
      if (retired !== null) {
        try {
          fs.renameSync(retired, target);
        } catch (restoreError) {
          warn(`plugin store: could not restore ${target}: ${describeError(restoreError)}`);
        }
      }
      if (staging !== null && !placed) removeQuietly(staging);
      refuse(`the plugin could not be installed: ${describeError(error)}`);
    }
    if (retired !== null) removeQuietly(retired);
    if (previous !== undefined && previous.version !== manifest.version) {
      removeQuietly(versionDirectory(manifest.id, previous.version));
    }
    return listingOf(records, manifest.id);
  }

  function setEnabled(id: unknown, enabled: boolean): PluginListing {
    const records = readState();
    const known = knownId(records, id);
    const current = listingOf(records, known);
    if (current.status !== 'enabled' && current.status !== 'disabled') {
      refuse(`${known} is ${current.status} and cannot be ${enabled ? 'enabled' : 'disabled'}`);
    }
    records.set(known, { ...(records.get(known) as PluginRecord), enabled });
    writeState(records);
    return { ...current, status: enabled ? 'enabled' : 'disabled' };
  }

  function remove(id: unknown): { readonly id: string } {
    const records = readState();
    const known = knownId(records, id);
    records.delete(known);
    writeState(records);
    removeQuietly(join(root, known));
    return { id: known };
  }

  function entryFor(id: string, version: string): Uint8Array<ArrayBuffer> {
    const records = readState();
    const record = records.get(id);
    if (record === undefined) refuse('not installed');
    if (record.version !== version) refuse(`not the installed version, which is ${record.version}`);
    if (record.fault !== null) refuse(`recorded as ${record.fault.state}`);
    if (!record.enabled) refuse('disabled');
    const inspection = inspect(id, record);
    if (!inspection.ok) {
      markFilesChanged(records, id, record, inspection.detail);
      refuse(FILES_CHANGED_REASON);
    }
    const compatibility = compareHostApiVersion(inspection.manifest.hostApiVersion, hostVersion);
    if (compatibility.state === 'incompatible') refuse(`incompatible: ${compatibility.reason}`);
    const read = readBoundedFile(fs, join(versionDirectory(id, version), PACKAGE_ENTRY), MAX_PACKAGE_BYTES, PACKAGE_ENTRY);
    if (!read.ok || sha512Base64(read.bytes) !== record.sha512) {
      markFilesChanged(records, id, record, read.ok ? `${PACKAGE_ENTRY} does not hash to the recorded sha512` : read.reason);
      refuse(FILES_CHANGED_REASON);
    }
    return read.bytes;
  }

  return {
    list: () =>
      run(() => {
        const records = readState();
        return [...records.keys()].sort().map((id) => listingOf(records, id));
      }),
    install: (packagePath) => run(() => install(packagePath)),
    setEnabled: (id, enabled) => run(() => setEnabled(id, enabled)),
    remove: (id) => run(() => remove(id)),
    entryFor: (id, version) => run(() => entryFor(id, version)),
  };
}
