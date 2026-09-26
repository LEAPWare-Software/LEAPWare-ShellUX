import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from '../../src/sdk/api-surface.json';
import { HOST_API_VERSION as SDK_HOST_API_VERSION } from '../../src/sdk';
import { FALLBACK_ICON, SHELL_ICONS } from '../../src/components/ui/shellIcons';
import { resolveShellIcon } from '../../src/components/ui/resolveShellIcon';
import { compareHostApiVersion } from '../main/plugins/compatibility';
import {
  EXTENSION_ID_PATTERN,
  HOST_API_VERSION,
  MAX_TEXT_LENGTH,
  RESERVED_IDS,
  TEXT_FORBIDDEN_PATTERN,
  TEXT_INVISIBLE_PATTERN,
} from '../main/plugins/hostContract';
import {
  ICON_KEY_PATTERN,
  MAX_PACKAGE_BYTES,
  PACKAGE_ENTRY,
  PACKAGE_FORMAT,
  nodePluginPackageFs,
  packageOpenFlags,
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

  it('refuses a title carrying a bidi control, a C0 or C1 control, a line/paragraph separator, an interlinear-annotation control, or nothing but invisible characters', () => {
    const controls = [
      '\u202Eliam',
      'Mail\u200F',
      'Ma\u2066il',
      '\u061CMail',
      'Mail\u0000',
      'Mail\n',
      'Mail\u007F',
      'Mail\u0085',
      'Mail\u2028Chain', // LINE SEPARATOR (D-56, #172)
      'Mail\u2029Chain', // PARAGRAPH SEPARATOR
      'Mail\uFFF9anno\uFFFB', // interlinear annotation anchor/terminator
      'Mail\u206Achain', // deprecated format control (INHIBIT SYMMETRIC SWAPPING)
    ];
    for (const title of controls) {
      expect(reasonOf(parse({ title }))).toBe('manifest.title must not contain control characters or bidi controls');
    }
    const invisible = [
      '\u200B',
      '\u200B\u200C\u200D',
      ' \u2060 ',
      '\uFEFF',
      '\u3164', // HANGUL FILLER
      '\u115F\u1160', // HANGUL CHOSEONG and JUNGSEONG FILLER
      '\uFFA0', // HALFWIDTH HANGUL FILLER
      '\u180E', // MONGOLIAN VOWEL SEPARATOR (subsumed by the U+180B-180F range)
      '\u00AD', // SOFT HYPHEN
      '\u{E0041}\u{E0042}', // TAG LATIN CAPITAL A, B
      '\u{E0000}\u{E007F}', // the ends of the original tag block
      '\u{E0080}\u{E0FFF}', // the widened part of the tag block (D-56, #172)
      '\u2061\u2062\u2065', // the extended U+2060-2065 range (U+2065 is unassigned+default-ignorable)
      '\u034F', // COMBINING GRAPHEME JOINER
      '\u17B4\u17B5', // Khmer inherent vowels
      '\u180B\u180C\u180D\u180F', // Mongolian variation selectors
      '\uFE00\uFE0F', // variation selectors (BMP)
      '\u{E0100}\u{E01EF}', // variation selectors (supplementary)
      '\uFFF0\uFFF8', // unassigned/default-ignorable
      '\u{1BCA0}\u{1BCA3}', // shorthand format controls
      '\u{1D173}\u{1D17A}', // musical format controls
      '\u2800', // BRAILLE PATTERN BLANK alone \u2014 named by decision, not by Default_Ignorable
      // Two DIFFERENT invisible characters together: this is the trap a bare
      // `.replace(TEXT_INVISIBLE_PATTERN, '')` (no fresh `g` copy) falls into,
      // since it removes only the FIRST match and leaves the second, making
      // the string look non-blank. D-56, #172.
      '\u200B\u034F',
    ];
    for (const title of invisible) {
      expect(reasonOf(parse({ title }))).toBe('manifest.title must not be blank');
    }
    // Zero-width characters inside a real title are left alone.
    expect(parse({ title: 'Ma\u200Dil' }).ok).toBe(true);
    // A Persian title held together by ZWNJ is not blank (D-56, #172).
    expect(parse({ title: '\u0645\u06CC\u200C\u0634\u0648\u062F' }).ok).toBe(true);
    // An emoji with a variation selector is not blank.
    expect(parse({ title: '\u2764\uFE0F' }).ok).toBe(true);
  });

  it('quotes an untrusted value in a refusal cut short and escaped', () => {
    const huge = 'A'.repeat(7 * 1024 * 1024);
    const reason = reasonOf(parse({ id: huge }));
    expect(reason).toBe(`manifest.id ${JSON.stringify(`${'A'.repeat(64)}…`)} is not a valid extension id`);
    expect(reason.length).toBeLessThan(120);
    // A newline in the value arrives escaped: the reason stays one line.
    const newline = reasonOf(parse({ id: 'mail\n' }));
    expect(newline).toBe('manifest.id "mail\\n" is not a valid extension id');
    expect(newline).not.toContain('\n');
    expect(reasonOf(parse({}, { ['x'.repeat(100)]: 1 }))).toBe(
      `package has a field lwplugin/1 does not define: "${'x'.repeat(64)}…"`,
    );
  });

  it('refuses a bundle that is base64 only by a lenient decoder', () => {
    const canonical = base64Of(BUNDLE);
    const urlSafe = Buffer.from([0xfb, 0xff]).toString('base64url');
    const cases = [
      urlSafe, // "-_8": the URL-safe alphabet
      canonical.replace(/=+$/, ''), // padding dropped
      `${canonical.slice(0, 8)} ${canonical.slice(8)}`, // whitespace inside
      `${canonical}\n`, // trailing newline
      'QR==', // non-zero trailing bits: decodes as "QQ=="
    ];
    expect(canonical.endsWith('=')).toBe(true);
    for (const bundle of cases) {
      expect(reasonOf(parse({}, { bundle }))).toBe('bundle is not canonical base64');
    }
  });

  it('refuses a __proto__ key at both levels as a field lwplugin/1 does not define', () => {
    const pkg = JSON.stringify(packageObject());
    const top = pkg.replace('{', '{"__proto__":{"polluted":true},');
    expect(reasonOf(parsePluginPackage(new TextEncoder().encode(top)))).toBe(
      'package has a field lwplugin/1 does not define: "__proto__"',
    );
    const inner = pkg.replace('"manifest":{', '"manifest":{"__proto__":{"polluted":true},');
    expect(reasonOf(parsePluginPackage(new TextEncoder().encode(inner)))).toBe(
      'manifest has a field lwplugin/1 does not define: "__proto__"',
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses every reserved id, including the one the id pattern admits', () => {
    expect(EXTENSION_ID_PATTERN.test('constructor')).toBe(true);
    for (const id of RESERVED_IDS) {
      expect(reasonOf(parse({ id }))).toBe(`manifest.id ${JSON.stringify(id)} is not a valid extension id`);
    }
    expect([...RESERVED_IDS].sort()).toEqual(['__proto__', 'constructor', 'prototype']);
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

  it("mirrors the SDK baseline's version, id pattern, text patterns, reserved ids and text bound", () => {
    // Main cannot import `src/` (ADR-0001 Amendment O decision 6), so
    // `hostContract.ts` writes these out and this assertion holds them to the
    // committed baseline and to the SDK's own export. A guardrail: it makes an
    // honest drift loud, and edits to both sides together pass it.
    expect(HOST_API_VERSION).toBe(SDK_HOST_API_VERSION);
    expect(HOST_API_VERSION).toBe(baseline.version);
    expect(EXTENSION_ID_PATTERN.source).toBe(baseline.extensionIdPattern);
    // The baseline records the source only; a flag would change what it accepts.
    expect(EXTENSION_ID_PATTERN.flags).toBe('');
    // These carry the `u` flag and it changes what the classes mean, so
    // `String(...)`, flags included, is what the baseline records (D-56, #172).
    expect(String(TEXT_FORBIDDEN_PATTERN)).toBe(baseline.textForbiddenPattern);
    expect(String(TEXT_INVISIBLE_PATTERN)).toBe(baseline.textInvisiblePattern);
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
  interface FakeFile {
    readonly bytes: Uint8Array;
    /** What `fstat` reports, when it is not the truth. */
    readonly statSize?: number;
    readonly isFile?: boolean;
  }

  interface FakeFs extends PluginPackageFs {
    readonly readBytes: number[];
    readonly open: Set<number>;
  }

  function fakeFs(files: Record<string, FakeFile>): FakeFs {
    const descriptors = new Map<number, FakeFile>();
    const open = new Set<number>();
    const readBytes: number[] = [];
    let next = 3;
    function fileOf(fd: number): FakeFile {
      const file = descriptors.get(fd);
      if (file === undefined || !open.has(fd)) throw new Error(`EBADF: bad file descriptor ${String(fd)}`);
      return file;
    }
    return {
      readBytes,
      open,
      openSync: (path) => {
        const file = files[path];
        if (file === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
        const fd = next++;
        descriptors.set(fd, file);
        open.add(fd);
        return fd;
      },
      fstatSync: (fd) => {
        const file = fileOf(fd);
        return { size: file.statSize ?? file.bytes.byteLength, isFile: () => file.isFile ?? true };
      },
      readSync: (fd, buffer, offset, length, position) => {
        const chunk = fileOf(fd).bytes.subarray(position, position + length);
        buffer.set(chunk, offset);
        readBytes.push(chunk.byteLength);
        return chunk.byteLength;
      },
      closeSync: (fd) => {
        fileOf(fd);
        open.delete(fd);
      },
    };
  }

  it('reads and validates the package at the path it is given, and closes its descriptor', () => {
    const fs = fakeFs({ 'mail.lwplugin': { bytes: encode(packageObject()) } });
    const result = readPluginPackage(fs, 'mail.lwplugin');
    expect(result.ok).toBe(true);
    expect(fs.open.size).toBe(0);
  });

  it('refuses a file over 8 MiB from its size, without reading a byte of it', () => {
    const fs = fakeFs({ 'big.lwplugin': { bytes: new Uint8Array(1), statSize: MAX_PACKAGE_BYTES + 1 } });
    expect(reasonOf(readPluginPackage(fs, 'big.lwplugin'))).toBe(
      `package is ${String(MAX_PACKAGE_BYTES + 1)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`,
    );
    expect(fs.readBytes).toEqual([]);
    expect(fs.open.size).toBe(0);
  });

  it('never buffers more than the limit plus one byte, even for a file stated at the limit', () => {
    // The largest buffer the reader ever allocates: `fstat` says exactly the
    // limit, and the file yields three times that.
    const fs = fakeFs({ 'full.lwplugin': { bytes: new Uint8Array(3 * MAX_PACKAGE_BYTES), statSize: MAX_PACKAGE_BYTES } });
    const allocated: number[] = [];
    const read = fs.readSync;
    fs.readSync = (fd, buffer, offset, length, position) => {
      allocated.push(buffer.byteLength);
      return read(fd, buffer, offset, length, position);
    };
    expect(reasonOf(readPluginPackage(fs, 'full.lwplugin'))).toBe(
      `package grew while it was read: fstat said ${String(MAX_PACKAGE_BYTES)} bytes`,
    );
    expect(Math.max(...allocated)).toBe(MAX_PACKAGE_BYTES + 1);
    expect(fs.readBytes.reduce((sum, n) => sum + n, 0)).toBe(MAX_PACKAGE_BYTES + 1);
    expect(fs.open.size).toBe(0);
  });

  it('stops reading one byte past its stat when a file yields more than its stat said', () => {
    // `fstat` says 10 bytes; the file yields 3 * the limit. The read must stop
    // one byte past what `fstat` said — well inside the limit — and refuse,
    // never buffering the rest.
    const fs = fakeFs({ 'grew.lwplugin': { bytes: new Uint8Array(3 * MAX_PACKAGE_BYTES), statSize: 10 } });
    expect(reasonOf(readPluginPackage(fs, 'grew.lwplugin'))).toBe('package grew while it was read: fstat said 10 bytes');
    expect(fs.readBytes.reduce((sum, n) => sum + n, 0)).toBe(11);
    expect(fs.open.size).toBe(0);
  });

  it("allocates for the file's size, not for the limit", () => {
    const bytes = encode(packageObject());
    const fs = fakeFs({ 'mail.lwplugin': { bytes } });
    const allocated: number[] = [];
    const read = fs.readSync;
    fs.readSync = (fd, buffer, offset, length, position) => {
      allocated.push(buffer.byteLength);
      return read(fd, buffer, offset, length, position);
    };
    expect(readPluginPackage(fs, 'mail.lwplugin').ok).toBe(true);
    expect(allocated[0]).toBe(bytes.byteLength + 1);
  });

  it('refuses a path that is not a regular file', () => {
    // A FIFO or a device reports size 0, which says nothing about what a read yields.
    const fs = fakeFs({ fifo: { bytes: encode(packageObject()), statSize: 0, isFile: false } });
    expect(reasonOf(readPluginPackage(fs, 'fifo'))).toBe('the package is not a regular file');
    expect(fs.readBytes).toEqual([]);
    expect(fs.open.size).toBe(0);
  });

  it('reads a file that arrives in short reads, to the end', () => {
    const bytes = encode(packageObject());
    const fs = fakeFs({ 'mail.lwplugin': { bytes } });
    const shortRead = fs.readSync;
    fs.readSync = (fd, buffer, offset, length, position) => shortRead(fd, buffer, offset, Math.min(length, 7), position);
    expect(readPluginPackage(fs, 'mail.lwplugin').ok).toBe(true);
    expect(fs.readBytes.reduce((sum, n) => sum + n, 0)).toBe(bytes.byteLength);
  });

  it('turns a failed open into a refusal rather than a throw', () => {
    expect(reasonOf(readPluginPackage(fakeFs({}), 'missing.lwplugin'))).toBe(
      `the package could not be read: ${JSON.stringify("Error: ENOENT: no such file, open 'missing.lwplugin'")}`,
    );
  });

  it('passes the host version through, so the rule runs against the host it is told', () => {
    // Derived from `HOST_API_VERSION`, not a bare literal, so this scenario
    // (a plugin declaring a newer minor than the told host offers) moves with
    // the constant rather than silently drifting from it.
    const [hostMajorPart, hostMinorPart] = HOST_API_VERSION.split('.');
    const hostMajor = Number(hostMajorPart);
    const hostMinor = Number(hostMinorPart);
    const toldHostVersion = `${hostMajor}.${hostMinor}`;
    const newerMinor = `${hostMajor}.${hostMinor + 1}`;
    const fs = fakeFs({ 'mail.lwplugin': { bytes: encode(packageObject({ hostApiVersion: newerMinor })) } });
    const result = readPluginPackage(fs, 'mail.lwplugin', toldHostVersion);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plugin.compatibility.state).toBe('incompatible');
  });

  it('reads a real package from a real temporary file through the production filesystem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lwplugin-'));
    try {
      const path = join(dir, 'mail.lwplugin');
      writeFileSync(path, encode(packageObject()));
      const result = readPluginPackage(nodePluginPackageFs, path);
      if (!result.ok) throw new Error(result.reason);
      expect(result.plugin.manifest.id).toBe('mail');
      // A directory opens on Windows and on POSIX alike, and fstat refuses it.
      expect(reasonOf(readPluginPackage(nodePluginPackageFs, dir))).toBe('the package is not a regular file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens non-blocking where the platform defines O_NONBLOCK, and read-only everywhere', () => {
    expect(packageOpenFlags({ O_RDONLY: 0, O_NONBLOCK: 2048 })).toBe(2048);
    expect(packageOpenFlags({ O_RDONLY: 0 })).toBe(0);
  });

  // A platform condition, not a suppression: Windows has no FIFO in the
  // filesystem for `mkfifo` to make. Runs on the Linux and macOS CI legs. If a
  // regression makes the open block, the synchronous call cannot be preempted
  // by the timeout below; the worker hangs and the run fails at vitest's own
  // hang detection instead, which is still a failure, never a pass.
  it.skipIf(process.platform === 'win32')(
    'refuses a real FIFO without blocking on its open',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'lwplugin-fifo-'));
      try {
        const fifo = join(dir, 'package.lwplugin');
        execFileSync('mkfifo', [fifo]);
        // No writer is ever opened: a blocking open would wait for one forever.
        expect(reasonOf(readPluginPackage(nodePluginPackageFs, fifo))).toBe('the package is not a regular file');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    5000,
  );
});
