import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { compareHostApiVersion, CONTRACT_VERSION_PATTERN, quoteUntrusted } from './compatibility.js';
import type { Compatibility } from './compatibility.js';
import {
  EXTENSION_ID_PATTERN,
  HOST_API_VERSION,
  MAX_TEXT_LENGTH,
  RESERVED_IDS,
  TEXT_FORBIDDEN_PATTERN,
  TEXT_INVISIBLE_PATTERN,
} from './hostContract.js';

/**
 * ============================================================================
 * THE `.lwplugin` PACKAGE: READ, VALIDATED, HASH-CHECKED. NOTHING INSTALLED.
 * ============================================================================
 * ADR-0006 decision 1 and decision 4, implementation step 3. A `.lwplugin` is
 * one UTF-8 JSON document of at most 8 MiB:
 *
 *   { "format": "lwplugin/1",
 *     "manifest": { id, version, hostApiVersion, title, icon?, entry, sha512 },
 *     "bundle": "<base64 of the entry's bytes>" }
 *
 * This module turns bytes into a validated manifest, the decoded bundle, and a
 * compatibility state, or into one refusal reason. It writes nothing: the
 * store, the install directory and `state.json` are `pluginStore.ts`, and the
 * `/plugins/` route is `pluginRoute.ts` (step 4).
 *
 * ---------------------------------------------------------------------------
 * THE `sha512` CHECK IS ENTRY-POINT VALIDATION, AND NOTHING MORE.
 * ---------------------------------------------------------------------------
 * The bundle's bytes are hashed and compared with the manifest's `sha512`. That
 * catches a truncated or corrupted download and a manifest from one build packed
 * with a bundle from another. It does not catch a deliberate substitution: the
 * manifest and the bundle travel in the same file, so whoever can alter one can
 * recompute the other, and a package altered that way is accepted. That limit is
 * asserted as expected behaviour, not left to prose. Packages are unsigned in
 * 1.0 (D-47). *Tests:* `electron/__tests__/pluginPackage.test.ts` — "refuses a
 * package whose bundle does not match its manifest sha512", "accepts a package
 * whose bundle and manifest were altered together, because the hash travels
 * with the bundle".
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN KEYS ARE REFUSED, AT BOTH LEVELS.
 * ---------------------------------------------------------------------------
 * `lwplugin/1` has exactly the keys above. A package carrying another one — a
 * `capabilities` list, which decision 1 rejects by name, or a misspelt `titel`
 * — is a packaging error and is refused loudly rather than ignored, so a field
 * the host does not act on is never mistaken for one it does.
 *
 * ---------------------------------------------------------------------------
 * DUPLICATE KEYS: LAST WINS, AND EVERY READER MUST USE `JSON.parse`.
 * ---------------------------------------------------------------------------
 * `JSON.parse` keeps the last of two same-named keys, so a package with two
 * `sha512` fields is judged by the second. That is not refused here: refusing
 * it needs a second JSON parser, and two parsers disagreeing is the hazard. The
 * invariant, binding on step 4: every reader of a package or an installed
 * `plugin.json` parses with `JSON.parse` and nothing else, and what install
 * writes to `plugin.json` is the validated `PluginManifest` re-serialised, never
 * the raw bytes, so no reader can see a different value than the one validated.
 *
 * ---------------------------------------------------------------------------
 * REFUSAL REASONS QUOTE UNTRUSTED VALUES, CUT AND ESCAPED.
 * ---------------------------------------------------------------------------
 * A reason echoes the offending value so a packager can find it, through
 * `quoteUntrusted`: at most 64 characters, then `JSON.stringify`, so a 7 MB id
 * or a value carrying a newline reaches a log or a dialog as one short, escaped
 * line. *Tests:* `electron/__tests__/pluginPackage.test.ts` — "quotes an
 * untrusted value in a refusal cut short and escaped".
 *
 * ---------------------------------------------------------------------------
 * THE FILESYSTEM IS INJECTED, AS IN `diagnosticsLog.ts`, AND READ THROUGH ONE DESCRIPTOR.
 * ---------------------------------------------------------------------------
 * `PluginPackageFs` is the seam: production passes `nodePluginPackageFs`, a
 * test passes an in-memory fake, and nothing stubs `node:fs` globally. The file
 * is opened once and `fstat`ed on that descriptor (a FIFO or a device is
 * refused: its size reads 0 and says nothing), then read into a buffer of its
 * stated size plus one byte — at most `MAX_PACKAGE_BYTES + 1` — so memory is
 * bounded by that buffer whatever the file does between the stat and the read. *Tests:*
 * `electron/__tests__/pluginPackage.test.ts` — "stops reading one byte past its
 * stat when a file yields more than its stat said", "never buffers more than
 * the limit plus one byte, even for a file stated at the limit", "refuses a
 * path that is not a regular file".
 * ============================================================================
 */

/** 8 MiB, decision 1's bound on the whole `.lwplugin` file. */
export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

/** The one package format this host reads. */
export const PACKAGE_FORMAT = 'lwplugin/1';

/** Fixed in `lwplugin/1`: one bundle, one name. */
export const PACKAGE_ENTRY = 'bundle.js';

/**
 * The manifest's `version`: strict `MAJOR.MINOR.PATCH`, no range, no prerelease,
 * no build metadata. Nine digits a part, so every part is an exact `Number`.
 */
export const PLUGIN_VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/**
 * The shape of an `icon` key: the shape every key in `SHELL_ICONS` has. A key
 * that fails it cannot be a published glyph, and markup, a URL and a data URI
 * all fail it (`<`, `:` and `/` are outside it). This is a **guardrail** that
 * makes that packaging mistake loud. What keeps plugin markup out of host chrome
 * is not this pattern but the lookup: chrome resolves the key through a `Map`
 * of host-shipped glyphs and draws nothing the key itself spells. *Tests:*
 * `electron/__tests__/pluginPackage.test.ts` — "refuses an icon that is markup,
 * a URL or a data URI rather than a key", "every key the host publishes is
 * key-shaped, so no real glyph is refused".
 */
export const ICON_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Base64 of 64 bytes: 86 alphabet characters and `==`. */
const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

const PACKAGE_KEYS: ReadonlySet<string> = new Set(['format', 'manifest', 'bundle']);
const MANIFEST_KEYS: ReadonlySet<string> = new Set([
  'id',
  'version',
  'hostApiVersion',
  'title',
  'icon',
  'entry',
  'sha512',
]);

/** A manifest that passed every rule in decision 1. */
export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly hostApiVersion: string;
  readonly title: string;
  /** Absent when the manifest declares none: host chrome keeps the monogram. */
  readonly icon?: string;
  readonly entry: typeof PACKAGE_ENTRY;
  readonly sha512: string;
}

/** A package that parsed, validated and hash-checked. Its compatibility is a state, not a refusal. */
export interface ValidatedPluginPackage {
  readonly manifest: PluginManifest;
  readonly bundle: Uint8Array;
  readonly compatibility: Compatibility;
}

export type PluginPackageResult =
  | { readonly ok: true; readonly plugin: ValidatedPluginPackage }
  | { readonly ok: false; readonly reason: string };

/** The filesystem operations reading a package needs, and nothing else. */
export interface PluginPackageFs {
  /** Open for reading; returns a descriptor. */
  openSync: (path: string) => number;
  fstatSync: (fd: number) => { size: number; isFile: () => boolean };
  /** Node's positional `readSync`: bytes read into `buffer` at `offset`, 0 at end of file. */
  readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => number;
  closeSync: (fd: number) => void;
}

/**
 * The flags a package is opened with: read-only, and non-blocking where the
 * platform defines `O_NONBLOCK`. On POSIX a plain `open` of a FIFO with no
 * writer blocks until one appears, and a synchronous open in the main process
 * would freeze the whole application before `fstat` could refuse it; with
 * `O_NONBLOCK` the open returns at once and `fstat` refuses the FIFO. Windows
 * defines no `O_NONBLOCK` and has no such FIFO in the filesystem. A function of
 * the constants, not a constant, so both shapes are tested on every platform.
 * *Tests:* `electron/__tests__/pluginPackage.test.ts` — "opens non-blocking
 * where the platform defines O_NONBLOCK, and read-only everywhere", "refuses a
 * real FIFO without blocking on its open".
 */
export function packageOpenFlags(flags: { readonly O_RDONLY: number; readonly O_NONBLOCK?: number }): number {
  return flags.O_RDONLY | (flags.O_NONBLOCK ?? 0);
}

/** The real filesystem. What production code passes. */
export const nodePluginPackageFs: PluginPackageFs = {
  openSync: (path) => openSync(path, packageOpenFlags(constants)),
  fstatSync,
  readSync,
  closeSync,
};

/** Base64 SHA-512 of `bytes`, the form the manifest records. Step 4's serve-time rehash reuses it. */
export function sha512Base64(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64');
}

/**
 * Every rule below refuses by throwing, and `parsePluginPackage` turns the throw
 * into `{ ok: false }` before it leaves this module. Nothing else in `validate`
 * throws: the one call that can, `JSON.parse` behind a fatal `TextDecoder`, is
 * caught where it is made and refused with its own reason.
 */
function refuse(reason: string): never {
  throw new Error(reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuseUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) refuse(`${where} has a field lwplugin/1 does not define: ${quoteUntrusted(key)}`);
  }
}

function requireString(value: Record<string, unknown>, key: string, where: string): string {
  const field = Object.hasOwn(value, key) ? value[key] : undefined;
  if (typeof field !== 'string') refuse(`${where}.${key} must be a string`);
  return field;
}

function validateManifest(value: unknown): PluginManifest {
  if (!isPlainObject(value)) refuse('manifest must be an object');
  refuseUnknownKeys(value, MANIFEST_KEYS, 'manifest');

  const id = requireString(value, 'id', 'manifest');
  if (!EXTENSION_ID_PATTERN.test(id) || RESERVED_IDS.has(id)) {
    refuse(`manifest.id ${quoteUntrusted(id)} is not a valid extension id`);
  }

  const version = requireString(value, 'version', 'manifest');
  if (!PLUGIN_VERSION_PATTERN.test(version)) {
    refuse(`manifest.version ${quoteUntrusted(version)} must be MAJOR.MINOR.PATCH`);
  }

  const hostApiVersion = requireString(value, 'hostApiVersion', 'manifest');
  if (!CONTRACT_VERSION_PATTERN.test(hostApiVersion)) {
    refuse(`manifest.hostApiVersion ${quoteUntrusted(hostApiVersion)} must be MAJOR.MINOR, as HOST_API_VERSION is`);
  }

  const title = requireString(value, 'title', 'manifest');
  if (TEXT_FORBIDDEN_PATTERN.test(title)) {
    refuse('manifest.title must not contain control characters or bidi controls');
  }
  // Fresh, locally-built `g` copy: `TEXT_INVISIBLE_PATTERN` carries no `g` flag
  // (see its docblock in hostContract.ts). Calling `.replace(TEXT_INVISIBLE_PATTERN, '')`
  // directly would remove only the FIRST match, leaving a title made of two or
  // more different invisible characters looking non-blank when it draws nothing.
  const strippedForBlankCheck = title.replace(new RegExp(TEXT_INVISIBLE_PATTERN.source, 'gu'), '');
  if (strippedForBlankCheck.trim().length === 0) refuse('manifest.title must not be blank');
  if (title.length > MAX_TEXT_LENGTH) {
    refuse(`manifest.title exceeds ${String(MAX_TEXT_LENGTH)} characters`);
  }

  const entry = requireString(value, 'entry', 'manifest');
  if (entry !== PACKAGE_ENTRY) refuse(`manifest.entry must be "${PACKAGE_ENTRY}" in ${PACKAGE_FORMAT}`);

  const sha512 = requireString(value, 'sha512', 'manifest');
  if (!SHA512_BASE64_PATTERN.test(sha512)) refuse('manifest.sha512 must be a base64 SHA-512 digest');

  const manifest = { id, version, hostApiVersion, title, entry: PACKAGE_ENTRY, sha512 } as const;
  if (!Object.hasOwn(value, 'icon')) return manifest;
  const icon = requireString(value, 'icon', 'manifest');
  if (!ICON_KEY_PATTERN.test(icon)) {
    refuse('manifest.icon must be a key into the host icon set, never markup, a URL or a data URI');
  }
  return { ...manifest, icon };
}

/**
 * Strict base64: decoded, then re-encoded, and refused unless the two spellings
 * agree. `Buffer.from(…, 'base64')` alone skips characters outside the alphabet,
 * so a bundle field with a stray byte in it would otherwise decode to something
 * shorter and quietly different.
 */
function decodeBundle(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) refuse('bundle must be a non-empty base64 string');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) refuse('bundle is not canonical base64');
  return new Uint8Array(bytes);
}

/**
 * `JSON.parse` behind a fatal `TextDecoder`, and nothing else: the one parser
 * the duplicate-key invariant above binds every reader to.
 */
function parseJsonDocument(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return refuse(`${what} is not a UTF-8 JSON document`);
  }
}

function validate(bytes: Uint8Array, hostVersion: string): ValidatedPluginPackage {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    refuse(`package is ${String(bytes.byteLength)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`);
  }
  const parsed = parseJsonDocument(bytes, 'package');
  if (!isPlainObject(parsed)) refuse('package must be a JSON object');
  refuseUnknownKeys(parsed, PACKAGE_KEYS, 'package');
  if (requireString(parsed, 'format', 'package') !== PACKAGE_FORMAT) {
    refuse(`package.format must be "${PACKAGE_FORMAT}"`);
  }
  const manifest = validateManifest(Object.hasOwn(parsed, 'manifest') ? parsed.manifest : undefined);
  const bundle = decodeBundle(Object.hasOwn(parsed, 'bundle') ? parsed.bundle : undefined);

  if (sha512Base64(bundle) !== manifest.sha512) {
    refuse('the bundle does not match the manifest sha512: the package is damaged or was assembled from two builds');
  }
  return { manifest, bundle, compatibility: compareHostApiVersion(manifest.hostApiVersion, hostVersion) };
}

/**
 * Validate a package already in memory. `hostVersion` defaults to the host's own
 * contract; a test passes another to exercise the rule on either side of it.
 */
export function parsePluginPackage(bytes: Uint8Array, hostVersion: string = HOST_API_VERSION): PluginPackageResult {
  try {
    return { ok: true, plugin: validate(bytes, hostVersion) };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/** An installed `plugin.json`, validated, or one refusal reason. */
export type InstalledManifestResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate an installed `plugin.json`: parsed with `JSON.parse`, as the
 * invariant above requires, and held to the same manifest rules a package's
 * manifest is, through the same `validateManifest`, so there is one rule and
 * not two. Install writes this file as `serializeManifest` of the validated
 * manifest; a file that no longer passes is a file changed on disk.
 */
export function parseInstalledManifest(bytes: Uint8Array): InstalledManifestResult {
  try {
    return { ok: true, manifest: validateManifest(parseJsonDocument(bytes, 'plugin.json')) };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/**
 * The bytes install writes to `plugin.json`: the VALIDATED manifest,
 * re-serialised, never the package's raw bytes — the second half of the
 * duplicate-key invariant above. *Tests:* `electron/__tests__/pluginScheme.test.ts`
 * — "writes plugin.json from the validated manifest re-serialised, never the
 * package's raw bytes".
 */
export function serializeManifest(manifest: PluginManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** Bytes read from disk under a bound, or one refusal reason. */
export type BoundedReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the file at `path` through one descriptor, buffering `fstat`'s size plus
 * one byte — never `limit + 1` for a small file. A path that is not a regular
 * file is refused before a read; a size over `limit` is refused from `fstat`;
 * and the read stops one byte past the stated size, so a file that grows
 * between the stat and the read is refused without being buffered whole.
 * *Tests:* `electron/__tests__/pluginPackage.test.ts` — "allocates for the
 * file's size, not for the limit", "stops reading one byte past its stat when a
 * file yields more than its stat said", "never buffers more than the limit plus
 * one byte, even for a file stated at the limit". A failure to open or read is a refusal, not a throw. `noun`
 * names the file in the reason. The package reader below and the plugin store's
 * serve-time read (`pluginStore.ts`) share it, so the bound is one rule.
 */
export function readBoundedFile(fs: PluginPackageFs, path: string, limit: number, noun: string): BoundedReadResult {
  try {
    const fd = fs.openSync(path);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) return { ok: false, reason: `the ${noun} is not a regular file` };
      if (stat.size > limit) {
        return { ok: false, reason: `${noun} is ${String(stat.size)} bytes; the limit is ${String(limit)}` };
      }
      // One byte past what `fstat` said, so a file that grew is seen without
      // being buffered: the read stops at `stat.size + 1`.
      const buffer = new Uint8Array(stat.size + 1);
      let total = 0;
      while (total < buffer.byteLength) {
        const read = fs.readSync(fd, buffer, total, buffer.byteLength - total, total);
        if (read === 0) break;
        total += read;
      }
      if (total > stat.size) {
        return { ok: false, reason: `${noun} grew while it was read: fstat said ${String(stat.size)} bytes` };
      }
      return { ok: true, bytes: buffer.subarray(0, total) };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return { ok: false, reason: `the ${noun} could not be read: ${quoteUntrusted(String(error))}` };
  }
}

/**
 * Read and validate the package at `path`, through `readBoundedFile` with
 * decision 1's 8 MiB bound.
 */
export function readPluginPackage(
  fs: PluginPackageFs,
  path: string,
  hostVersion: string = HOST_API_VERSION,
): PluginPackageResult {
  const read = readBoundedFile(fs, path, MAX_PACKAGE_BYTES, 'package');
  if (!read.ok) return read;
  return parsePluginPackage(read.bytes, hostVersion);
}
