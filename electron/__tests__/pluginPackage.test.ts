import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import baseline from '../../src/sdk/api-surface.json';
import { HOST_API_VERSION as SDK_HOST_API_VERSION } from '../../src/sdk';
import { FALLBACK_ICON, SHELL_ICONS } from '../../src/components/ui/shellIcons';
import { resolveShellIcon } from '../../src/components/ui/resolveShellIcon';
import { compareHostApiVersion } from '../main/plugins/compatibility';
import { EXTENSION_ID_PATTERN, HOST_API_VERSION, MAX_TEXT_LENGTH, RESERVED_IDS } from '../main/plugins/hostContract';
import {
  ICON_KEY_PATTERN,
  MAX_PACKAGE_BYTES,
  PACKAGE_ENTRY,
  PACKAGE_FORMAT,
  nodePluginPackageFs,
  parsePluginPackage,
  readPluginPackage,
  sha512Base64,
} from '../main/plugins/pluginPackage';
import type { PluginPackageFs, PluginPackageResult } from '../main/plugins/pluginPackage';

/**
 * ============================================================================
 * THE `.lwplugin` VALIDATOR, AND THE `hostApiVersion` RULE (ADR-0006 STEP 3).
 * ============================================================================
 * Every package here is built in memory by `packageObject`, which hashes the
 * bundle with `node:crypto` directly rather than with the module's own
 * `sha512Base64` — a fixture that hashed with the function under test would
 * agree with it whatever it computed. `sha512Base64` is pinned separately
 * against a published SHA-512 test vector.
 *
 * The filesystem is the in-memory `PluginPackageFs` fake at the bottom, the
 * seam `diagnosticsLog.ts` established, so nothing here stubs `node:fs`.
 * ============================================================================
 */

const BUNDLE = 'export default { id: "mail" };\n';

function hashOf(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64');
}

function base64Of(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

type Json = Record<string, unknown>;

/** A well-formed package as a JSON object, with any field overridden. */
function packageObject(manifestOverrides: Json = {}, packageOverrides: Json = {}): Json {
  const bundleBytes = new TextEncoder().encode(BUNDLE);
  return {
    format: PACKAGE_FORMAT,
    manifest: {
      id: 'mail',
      version: '1.0.0',
      hostApiVersion: HOST_API_VERSION,
      title: 'Mail',
      icon: 'folder',
      entry: PACKAGE_ENTRY,
      sha512: hashOf(bundleBytes),
      ...manifestOverrides,
    },
    bundle: base64Of(BUNDLE),
    ...packageOverrides,
  };
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parse(manifestOverrides: Json = {}, packageOverrides: Json = {}, host?: string): PluginPackageResult {
  return parsePluginPackage(encode(packageObject(manifestOverrides, packageOverrides)), host);
}

function reasonOf(result: PluginPackageResult): string {
  if (result.ok) throw new Error('expected a refusal, and the package was accepted');
  return result.reason;
}

function withoutManifestKey(key: string): Json {
  const pkg = packageObject();
  const manifest = { ...(pkg.manifest as Json) };
  delete manifest[key];
  return { ...pkg, manifest };
}

describe('the .lwplugin package', () => {
  it('accepts a well-formed package and returns its manifest, bundle and compatibility', () => {
    const result = parse();
    if (!result.ok) throw new Error(result.reason);
    expect(result.plugin.manifest).toEqual({
      id: 'mail',
      version: '1.0.0',
      hostApiVersion: HOST_API_VERSION,
      title: 'Mail',
      icon: 'folder',
      entry: 'bundle.js',
      sha512: hashOf(new TextEncoder().encode(BUNDLE)),
    });
    expect(new TextDecoder().decode(result.plugin.bundle)).toBe(BUNDLE);
    expect(result.plugin.compatibility).toEqual({ state: 'compatible' });
  });

  it('refuses a package whose bundle does not match its manifest sha512', () => {
    // A bundle from another build, packed with this build's manifest.
    const swapped = parse({}, { bundle: base64Of('export default { id: "other" };\n') });
    expect(reasonOf(swapped)).toBe(
      'the bundle does not match the manifest sha512: the package is damaged or was assembled from two builds',
    );
    // A truncated download: the same bundle, its tail missing.
    const truncated = parse({}, { bundle: base64Of(BUNDLE.slice(0, 12)) });
    expect(reasonOf(truncated)).toMatch(/does not match the manifest sha512/);
  });

  it('accepts a package whose bundle and manifest were altered together, because the hash travels with the bundle', () => {
    // HONEST PINNING. This is the limit of decision 4, asserted as expected
    // behaviour: the check is entry-point validation against a damaged or
    // mismatched package. Anyone who can write a `.lwplugin` can put any bundle
    // in it and the matching hash beside it, and this validator accepts it.
    // If this test starts failing, something now claims more than a hash that
    // travels with its subject can deliver; read ADR-0006 decision 4 first.
    const substituted = 'globalThis.substituted = true;\n';
    const result = parse(
      { sha512: hashOf(new TextEncoder().encode(substituted)) },
      { bundle: base64Of(substituted) },
    );
    if (!result.ok) throw new Error(result.reason);
    expect(new TextDecoder().decode(result.plugin.bundle)).toBe(substituted);
  });

  it('refuses every package that breaks a rule of lwplugin/1, each for its own reason', () => {
    const cases: readonly [PluginPackageResult, string][] = [
      [parsePluginPackage(new TextEncoder().encode('not json')), 'package is not a UTF-8 JSON document'],
      [parsePluginPackage(new Uint8Array([0x7b, 0xff, 0x7d])), 'package is not a UTF-8 JSON document'],
      [parsePluginPackage(encode([packageObject()])), 'package must be a JSON object'],
      [parsePluginPackage(encode(null)), 'package must be a JSON object'],
      [parse({}, { capabilities: ['network'] }), 'package has a field lwplugin/1 does not define: "capabilities"'],
      [parse({}, { format: 'lwplugin/2' }), 'package.format must be "lwplugin/1"'],
      [parse({}, { format: 1 }), 'package.format must be a string'],
      [parse({}, { manifest: 'mail' }), 'manifest must be an object'],
      [parsePluginPackage(encode({ format: PACKAGE_FORMAT, bundle: base64Of(BUNDLE) })), 'manifest must be an object'],
      [parse({ titel: 'Mail' }), 'manifest has a field lwplugin/1 does not define: "titel"'],
      [parsePluginPackage(encode(withoutManifestKey('id'))), 'manifest.id must be a string'],
      [parse({ id: 'Mail' }), 'manifest.id "Mail" is not a valid extension id'],
      [parse({ id: 'constructor' }), 'manifest.id "constructor" is not a valid extension id'],
      [parse({ version: '1.0' }), 'manifest.version "1.0" must be MAJOR.MINOR.PATCH'],
      [parse({ version: '1.0.0-beta.1' }), 'manifest.version "1.0.0-beta.1" must be MAJOR.MINOR.PATCH'],
      [parse({ version: '01.0.0' }), 'manifest.version "01.0.0" must be MAJOR.MINOR.PATCH'],
      [
        parse({ hostApiVersion: '1.0.0' }),
        'manifest.hostApiVersion "1.0.0" must be MAJOR.MINOR, as HOST_API_VERSION is',
      ],
      [parse({ title: '   ' }), 'manifest.title must not be blank'],
      [parse({ title: 'x'.repeat(MAX_TEXT_LENGTH + 1) }), 'manifest.title exceeds 256 characters'],
      [parse({ entry: 'index.js' }), 'manifest.entry must be "bundle.js" in lwplugin/1'],
      [parse({ sha512: 'abc' }), 'manifest.sha512 must be a base64 SHA-512 digest'],
      [parse({ icon: 7 }), 'manifest.icon must be a string'],
      [parsePluginPackage(encode({ ...packageObject(), bundle: undefined })), 'bundle must be a non-empty base64 string'],
      [parse({}, { bundle: '' }), 'bundle must be a non-empty base64 string'],
      [parse({}, { bundle: `${base64Of(BUNDLE)}!` }), 'bundle is not canonical base64'],
    ];
    for (const [result, reason] of cases) expect(reasonOf(result)).toBe(reason);
  });

  it('accepts a title at the registry bound exactly', () => {
    expect(parse({ title: 'x'.repeat(MAX_TEXT_LENGTH) }).ok).toBe(true);
  });

  it('refuses a package over 8 MiB before parsing it', () => {
    const oversize = new Uint8Array(MAX_PACKAGE_BYTES + 1);
    expect(reasonOf(parsePluginPackage(oversize))).toBe(
      `package is ${String(MAX_PACKAGE_BYTES + 1)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`,
    );
  });

  it('hashes with SHA-512, checked against the published test vector for the empty input', () => {
    // FIPS 180-2's SHA-512 of the empty string, in hex, converted without `node:crypto`.
    const hex =
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce' +
      '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e';
    expect(sha512Base64(new Uint8Array())).toBe(Buffer.from(hex, 'hex').toString('base64'));
  });
});

describe('the hostApiVersion rule', () => {
  function stateOf(result: PluginPackageResult): unknown {
    if (!result.ok) throw new Error(result.reason);
    return result.plugin.compatibility;
  }

  it('marks a plugin incompatible when its major differs', () => {
    expect(stateOf(parse({ hostApiVersion: '2.0' }, {}, '1.0'))).toEqual({
      state: 'incompatible',
      reason: 'built for host contract 2, this shell offers 1',
    });
    // An OLDER major is refused too: that major's members may since have been removed.
    expect(stateOf(parse({ hostApiVersion: '1.3' }, {}, '2.3'))).toEqual({
      state: 'incompatible',
      reason: 'built for host contract 1, this shell offers 2',
    });
  });

  it('marks a plugin incompatible when it needs a newer minor than the host offers', () => {
    expect(stateOf(parse({ hostApiVersion: '1.4' }, {}, '1.2'))).toEqual({
      state: 'incompatible',
      reason: 'needs contract 1.4, this shell offers 1.2',
    });
    // The boundary: one minor ahead is already too new.
    expect(stateOf(parse({ hostApiVersion: '1.3' }, {}, '1.2'))).toEqual({
      state: 'incompatible',
      reason: 'needs contract 1.3, this shell offers 1.2',
    });
    // And the same minor on the same major is not.
    expect(stateOf(parse({ hostApiVersion: '1.2' }, {}, '1.2'))).toEqual({ state: 'compatible' });
  });

  it('loads a plugin whose minor is at or below the host minor, on the same major', () => {
    expect(stateOf(parse({ hostApiVersion: '1.2' }, {}, '1.2'))).toEqual({ state: 'compatible' });
    expect(stateOf(parse({ hostApiVersion: '1.0' }, {}, '1.2'))).toEqual({ state: 'compatible' });
    // Integer comparison, not string: "1.10" is a newer minor than "1.9".
    expect(stateOf(parse({ hostApiVersion: '1.9' }, {}, '1.10'))).toEqual({ state: 'compatible' });
  });

  it('answers incompatible, and says why, for a version that is not major.minor', () => {
    expect(compareHostApiVersion('1.0', '1.0.0')).toEqual({
      state: 'incompatible',
      reason: 'host contract versions must be "major.minor"; the plugin states "1.0", this shell offers "1.0.0"',
    });
    expect(compareHostApiVersion('one', '1.0').state).toBe('incompatible');
  });

  it("mirrors the SDK baseline's version, id pattern, reserved ids and text bound", () => {
    // Main cannot import `src/` (ADR-0001 Amendment O decision 6), so
    // `hostContract.ts` writes these out and this assertion holds them to the
    // committed baseline and to the SDK's own export. A guardrail: it makes an
    // honest drift loud, and edits to both sides together pass it.
    expect(HOST_API_VERSION).toBe(SDK_HOST_API_VERSION);
    expect(HOST_API_VERSION).toBe(baseline.version);
    expect(EXTENSION_ID_PATTERN.source).toBe(baseline.extensionIdPattern);
    expect([...RESERVED_IDS].sort()).toEqual([...baseline.reservedIds].sort());
    expect(MAX_TEXT_LENGTH).toBe(baseline.registryLimits.MAX_TEXT_LENGTH);
  });
});

describe('the manifest icon (D-40)', () => {
  it('resolves a manifest icon key the host does not publish to the host fallback glyph, and keeps no icon when the manifest gives none', () => {
    const unknown = parse({ icon: 'no-such-icon' });
    if (!unknown.ok) throw new Error(unknown.reason);
    const key = unknown.plugin.manifest.icon;
    expect(key).toBe('no-such-icon');
    // The same lookup the navigation rail and the palette draw with.
    expect(resolveShellIcon(key ?? '')).toBe(FALLBACK_ICON);
    // A key the host publishes resolves to its own glyph, not the fallback.
    expect(resolveShellIcon('folder')).toBe(SHELL_ICONS.get('folder'));

    const none = parsePluginPackage(encode(withoutManifestKey('icon')));
    if (!none.ok) throw new Error(none.reason);
    // No key at all: chrome keeps the monogram, which is not the fallback glyph.
    expect(Object.hasOwn(none.plugin.manifest, 'icon')).toBe(false);
  });

  it('refuses an icon that is markup, a URL or a data URI rather than a key', () => {
    const notKeys = [
      '<svg onload="x()"></svg>',
      'https://example.invalid/icon.svg',
      'data:image/svg+xml;base64,PHN2Zy8+',
      '',
    ];
    for (const icon of notKeys) {
      expect(reasonOf(parse({ icon }))).toBe(
        'manifest.icon must be a key into the host icon set, never markup, a URL or a data URI',
      );
    }
  });

  it('every key the host publishes is key-shaped, so no real glyph is refused', () => {
    expect(SHELL_ICONS.size).toBeGreaterThan(0);
    for (const key of SHELL_ICONS.keys()) expect(key).toMatch(ICON_KEY_PATTERN);
  });
});

describe('reading a package from disk, through the injected filesystem', () => {
  interface FakeFs extends PluginPackageFs {
    readonly reads: string[];
  }

  function fakeFs(files: Record<string, Uint8Array>, statSize?: number): FakeFs {
    const reads: string[] = [];
    return {
      reads,
      statSync: (path) => {
        const bytes = files[path];
        if (bytes === undefined) throw new Error(`ENOENT: no such file, stat '${path}'`);
        return { size: statSize ?? bytes.byteLength };
      },
      readFileSync: (path) => {
        reads.push(path);
        return files[path] ?? new Uint8Array();
      },
    };
  }

  it('reads and validates the package at the path it is given', () => {
    const fs = fakeFs({ 'mail.lwplugin': encode(packageObject()) });
    const result = readPluginPackage(fs, 'mail.lwplugin');
    expect(result.ok).toBe(true);
    expect(fs.reads).toEqual(['mail.lwplugin']);
  });

  it('refuses a file over 8 MiB from its size, without reading a byte of it', () => {
    const fs = fakeFs({ 'big.lwplugin': new Uint8Array(1) }, MAX_PACKAGE_BYTES + 1);
    expect(reasonOf(readPluginPackage(fs, 'big.lwplugin'))).toBe(
      `package is ${String(MAX_PACKAGE_BYTES + 1)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`,
    );
    expect(fs.reads).toEqual([]);
  });

  it('refuses a file that grew past 8 MiB between its stat and its read', () => {
    const fs = fakeFs({ 'grew.lwplugin': new Uint8Array(MAX_PACKAGE_BYTES + 1) }, 10);
    expect(reasonOf(readPluginPackage(fs, 'grew.lwplugin'))).toMatch(/the limit is 8388608$/);
  });

  it('turns a failed read into a refusal rather than a throw', () => {
    expect(reasonOf(readPluginPackage(fakeFs({}), 'missing.lwplugin'))).toBe(
      "the package could not be read: Error: ENOENT: no such file, stat 'missing.lwplugin'",
    );
  });

  it('passes the host version through, so the rule runs against the host it is told', () => {
    const fs = fakeFs({ 'mail.lwplugin': encode(packageObject({ hostApiVersion: '1.1' })) });
    const result = readPluginPackage(fs, 'mail.lwplugin', '1.0');
    if (!result.ok) throw new Error(result.reason);
    expect(result.plugin.compatibility.state).toBe('incompatible');
  });

  it('gives production the real statSync and readFileSync, not a wrapper', async () => {
    const nodeFs = await import('node:fs');
    expect(nodePluginPackageFs.statSync).toBe(nodeFs.statSync);
    expect(nodePluginPackageFs.readFileSync).toBe(nodeFs.readFileSync);
  });
});
