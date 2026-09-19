import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { compareHostApiVersion, CONTRACT_VERSION_PATTERN } from './compatibility.js';
import type { Compatibility } from './compatibility.js';
import { EXTENSION_ID_PATTERN, HOST_API_VERSION, MAX_TEXT_LENGTH, RESERVED_IDS } from './hostContract.js';

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
 * store, the install directory, `state.json` and the `/plugins/` route are
 * step 4.
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
 * THE FILESYSTEM IS INJECTED, AS IN `diagnosticsLog.ts`.
 * ---------------------------------------------------------------------------
 * `PluginPackageFs` is the seam: production passes `nodePluginPackageFs`, a
 * test passes an in-memory fake, and nothing stubs `node:fs` globally.
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
  statSync: (path: string) => { size: number };
  readFileSync: (path: string) => Uint8Array;
}

/** The real filesystem. What production code passes. */
export const nodePluginPackageFs: PluginPackageFs = {
  statSync,
  readFileSync,
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
    if (!allowed.has(key)) refuse(`${where} has a field lwplugin/1 does not define: "${key}"`);
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
    refuse(`manifest.id "${id}" is not a valid extension id`);
  }

  const version = requireString(value, 'version', 'manifest');
  if (!PLUGIN_VERSION_PATTERN.test(version)) {
    refuse(`manifest.version "${version}" must be MAJOR.MINOR.PATCH`);
  }

  const hostApiVersion = requireString(value, 'hostApiVersion', 'manifest');
  if (!CONTRACT_VERSION_PATTERN.test(hostApiVersion)) {
    refuse(`manifest.hostApiVersion "${hostApiVersion}" must be MAJOR.MINOR, as HOST_API_VERSION is`);
  }

  const title = requireString(value, 'title', 'manifest');
  if (title.trim().length === 0) refuse('manifest.title must not be blank');
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

function validate(bytes: Uint8Array, hostVersion: string): ValidatedPluginPackage {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    refuse(`package is ${String(bytes.byteLength)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    refuse('package is not a UTF-8 JSON document');
  }
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

/**
 * Read and validate the package at `path`. The size is checked from `stat`
 * before a byte is read, and again on the bytes read, so a file that grows
 * between the two is still refused. A read that fails is a refusal, not a throw.
 */
export function readPluginPackage(
  fs: PluginPackageFs,
  path: string,
  hostVersion: string = HOST_API_VERSION,
): PluginPackageResult {
  let bytes: Uint8Array;
  try {
    const { size } = fs.statSync(path);
    if (size > MAX_PACKAGE_BYTES) {
      return { ok: false, reason: `package is ${String(size)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}` };
    }
    bytes = fs.readFileSync(path);
  } catch (error) {
    return { ok: false, reason: `the package could not be read: ${String(error)}` };
  }
  return parsePluginPackage(bytes, hostVersion);
}
