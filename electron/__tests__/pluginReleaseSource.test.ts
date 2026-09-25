import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_API_VERSION } from '../main/plugins/hostContract';
import { PLUGIN_CHANNEL, registerPluginIpc } from '../main/plugins/pluginIpc';
import type { PluginIpcEvent } from '../main/plugins/pluginIpc';
import { MAX_PACKAGE_BYTES, PACKAGE_ENTRY, PACKAGE_FORMAT } from '../main/plugins/pluginPackage';
import { STATE_FILE, createPluginStore, nodePluginStoreFs } from '../main/plugins/pluginStore';
import type { PluginStore } from '../main/plugins/pluginStore';
import {
  MAX_RELEASE_URL_LENGTH,
  RELEASE_ORGANISATION,
  RELEASE_URL_PREFIX,
  parseReleaseAssetUrl,
} from '../main/plugins/releaseSource';
import type { ReleaseFetch } from '../main/plugins/releaseSource';

/**
 * ============================================================================
 * THE GITHUB RELEASE INSTALL SOURCE (ADR-0006 STEP 11), ON A REAL DISK, WITH NO NETWORK.
 * ============================================================================
 * Every case drives `shellux:plugins:install-release` through
 * `registerPluginIpc` — the function `index.ts` calls — into a real
 * `createPluginStore` over `nodePluginStoreFs` in a fresh temporary directory.
 * The one fake is the network: `fetchAsset` records every URL it is asked for
 * and answers with a `Response` the case chooses. "No request was made" is
 * asserted as that record being empty, which is the property: the fake stands
 * exactly where `net.fetch` stands in the application.
 *
 * Packages are hashed with `node:crypto` directly, never with the module's own
 * `sha512Base64`, so a fixture cannot agree with the code under test by
 * construction.
 *
 * **Not shown here:** what Electron's `net.fetch` does with the abort signal,
 * or that it follows GitHub's redirect to its download host; no case reaches a
 * real network.
 * ============================================================================
 */

const BUNDLE = 'export default { id: "mail" };\n';

/** A URL decision 2 admits. */
const ALLOWED = `${RELEASE_URL_PREFIX}shellux-plugins/releases/download/v1.0.0/mail.lwplugin`;

type Json = Record<string, unknown>;

function hashOf(text: string): string {
  return createHash('sha512').update(Buffer.from(text, 'utf-8')).digest('base64');
}

function packageObject(manifest: Json = {}, bundle: string = BUNDLE): Json {
  return {
    format: PACKAGE_FORMAT,
    manifest: {
      id: 'mail',
      version: '1.0.0',
      hostApiVersion: HOST_API_VERSION,
      title: 'Mail',
      entry: PACKAGE_ENTRY,
      sha512: hashOf(bundle),
      ...manifest,
    },
    bundle: Buffer.from(bundle, 'utf-8').toString('base64'),
  };
}

function packageText(manifest: Json = {}, bundle: string = BUNDLE): string {
  return JSON.stringify(packageObject(manifest, bundle));
}

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fetched {
  readonly url: string;
  readonly signal: AbortSignal;
  readonly redirect: string;
}

function rig(respond: ReleaseFetch = () => Promise.resolve(new Response(packageText())), timeoutMs = 60_000) {
  const base = mkdtempSync(join(tmpdir(), 'shellux-release-'));
  cleanup.push(base);
  const root = join(base, 'userData', 'plugins');
  const warnings: string[] = [];
  const store: PluginStore = createPluginStore({
    root,
    fs: nodePluginStoreFs,
    warn: (message) => warnings.push(message),
    now: () => new Date('2026-09-25T12:00:00.000Z'),
  });
  const fetched: Fetched[] = [];
  const handlers = new Map<string, (event: PluginIpcEvent, ...args: unknown[]) => unknown>();
  const chrome = { view: 'chrome' };
  registerPluginIpc({
    ipc: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    },
    hostChrome: () => chrome,
    store,
    pickPackage: () => Promise.reject(new Error('these cases never open the picker')),
    fetchAsset: (url, init) => {
      fetched.push({ url, signal: init.signal, redirect: init.redirect });
      return respond(url, init);
    },
    downloadTimeoutMs: timeoutMs,
    warn: (message) => warnings.push(message),
  });
  const installRelease = (url: unknown): Promise<unknown> => {
    const handler = handlers.get(PLUGIN_CHANNEL.installRelease);
    if (handler === undefined) throw new Error(`no handler for ${PLUGIN_CHANNEL.installRelease}`);
    return Promise.resolve(handler({ sender: chrome }, url));
  };
  const installed = (): unknown => {
    const listed = store.list();
    return listed.ok ? listed.value.map((plugin) => `${plugin.id} ${plugin.version} ${plugin.status}`) : listed.reason;
  };
  return { root, store, fetched, warnings, installRelease, installed };
}

const REFUSED_URL = /^the release URL was refused: /;

describe('the GitHub Release install source', () => {
  it('refuses a URL outside the LEAPWare-Software organisation', async () => {
    const r = rig();
    // Named outside the organisation, as written.
    const otherOrganisation = [
      'https://github.com/SomeoneElse/shellux-plugins/releases/download/v1.0.0/mail.lwplugin',
      'https://github.com/LEAPWare-Software-Fork/shellux-plugins/releases/download/v1.0.0/mail.lwplugin',
      'https://github.com/leapware-software/shellux-plugins/releases/download/v1.0.0/mail.lwplugin',
      'https://github.com/LEAPWare/shellux-plugins/releases/download/v1.0.0/mail.lwplugin',
    ];
    // Written to start inside it, and PARSED by the URL parser fetch uses to a
    // path outside it: the reason the check reads the string as written.
    const parsesOutside = [
      'https://github.com/LEAPWare-Software/../SomeoneElse/mail/releases/download/v1.0.0/mail.lwplugin',
      'https://github.com/LEAPWare-Software\\..\\SomeoneElse/mail/releases/download/v1.0.0/mail.lwplugin',
      'https://github.com/LEAPWare-Software/%2e%2e/releases/download/v1.0.0/mail.lwplugin',
    ];
    for (const url of parsesOutside) {
      expect(new URL(url).pathname.startsWith(`/${RELEASE_ORGANISATION}/`), url).toBe(false);
    }
    // Not GitHub at all, or not GitHub's release door.
    const otherHost = [
      `https://evil.example.com/${RELEASE_ORGANISATION}/shellux-plugins/releases/download/v1.0.0/mail.lwplugin`,
      `https://github.com.evil.example.com/${RELEASE_ORGANISATION}/shellux-plugins/releases/download/v1.0.0/mail.lwplugin`,
      `https://github.com@evil.example.com/${RELEASE_ORGANISATION}/shellux-plugins/releases/download/v1.0.0/mail.lwplugin`,
      `http://github.com/${RELEASE_ORGANISATION}/shellux-plugins/releases/download/v1.0.0/mail.lwplugin`,
      `https://api.github.com/repos/${RELEASE_ORGANISATION}/shellux-plugins/releases/assets/1`,
      'https://release-assets.githubusercontent.com/github-production-release-asset/1/mail.lwplugin',
    ];

    for (const url of [...otherOrganisation, ...parsesOutside, ...otherHost]) {
      expect(await r.installRelease(url), url).toEqual({ ok: false, reason: expect.stringMatching(REFUSED_URL) });
    }
    for (const url of otherOrganisation) {
      expect(await r.installRelease(url), url).toEqual({
        ok: false,
        reason: expect.stringContaining(`it is outside the ${RELEASE_ORGANISATION} organisation`),
      });
    }
    // The property: no request was made for any of them, and nothing was installed.
    expect(r.fetched).toEqual([]);
    expect(existsSync(join(r.root, STATE_FILE))).toBe(false);
    expect(r.installed()).toEqual([]);

    // The same rig, given a URL inside the organisation, does reach the network
    // and install: the refusals above were the URL's.
    expect(await r.installRelease(ALLOWED)).toMatchObject({ ok: true, value: { id: 'mail', status: 'enabled' } });
    expect(r.fetched.map((call) => call.url)).toEqual([ALLOWED]);
  });

  it('checks the URL as written, and admits only spellings the URL parser leaves unchanged', () => {
    const longest = `${RELEASE_URL_PREFIX}${'r'.repeat(128)}/releases/download/${'t'.repeat(128)}/${'a'.repeat(119)}.lwplugin`;
    expect(longest).toHaveLength(441);
    expect(longest.length).toBeLessThan(MAX_RELEASE_URL_LENGTH);
    const admitted = [
      ALLOWED,
      `${RELEASE_URL_PREFIX}ShellUX.Plugins_2/releases/download/mail-v1.0.0+build.7/mail_1.0.0.lwplugin`,
      `${RELEASE_URL_PREFIX}r/releases/download/t/..lwplugin`,
      longest,
    ];
    for (const url of admitted) {
      expect(parseReleaseAssetUrl(url), url).toEqual({ ok: true, url });
      // What is checked is what fetch will request.
      expect(new URL(url).href, url).toBe(url);
    }

    // Each of these PARSES to a URL inside the organisation, and is refused
    // because it is not written as one.
    const tabbed = `https://github.com/LEAPWare-Soft\tware/shellux-plugins/releases/download/v1.0.0/mail.lwplugin`;
    expect(new URL(tabbed).href).toBe(ALLOWED);
    const respelled = [
      tabbed,
      ` ${ALLOWED}`,
      ALLOWED.replace('https://github.com', 'HTTPS://GITHUB.COM'),
      ALLOWED.replace('github.com', 'github.com:443'),
      ALLOWED.replace('https://github.com/', 'https://github.com\\'),
      ALLOWED.replace('https://', 'https://operator@'),
      `${ALLOWED}?download=1`,
      `${ALLOWED}#mail`,
      ALLOWED.replace('v1.0.0', 'v1%2E0%2E0'),
      ALLOWED.replace('shellux-plugins', 'shellux-plugins/.'),
      ALLOWED.replace('v1.0.0', '.'),
      ALLOWED.replace('shellux-plugins', '..'),
    ];
    for (const url of respelled) {
      expect(parseReleaseAssetUrl(url), JSON.stringify(url)).toEqual({ ok: false, reason: expect.stringMatching(REFUSED_URL) });
    }

    // Inside the organisation, and not a release asset.
    const notAnAsset = [
      `${RELEASE_URL_PREFIX}shellux-plugins`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/tag/v1.0.0`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/latest/download/mail.lwplugin`,
      `${RELEASE_URL_PREFIX}shellux-plugins/archive/refs/tags/v1.0.0.zip`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/download/v1.0.0/mail.zip`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/download/v1.0.0/mail.lwplugin.exe`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/download/v1.0.0/.lwplugin`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/download/v1.0.0/mail.lwplugin/`,
      `${RELEASE_URL_PREFIX}shellux-plugins/releases/download/v1.0.0/${'a'.repeat(120)}.lwplugin`,
    ];
    for (const url of notAnAsset) {
      expect(parseReleaseAssetUrl(url), url).toEqual({ ok: false, reason: expect.stringMatching(REFUSED_URL) });
    }

    for (const value of [42, null, undefined, { toString: () => ALLOWED }, [ALLOWED]]) {
      expect(parseReleaseAssetUrl(value)).toEqual({ ok: false, reason: 'the release URL was refused: it must be a string' });
    }
    expect(parseReleaseAssetUrl(`${ALLOWED}${'a'.repeat(MAX_RELEASE_URL_LENGTH)}`)).toEqual({
      ok: false,
      reason: `the release URL was refused: it is longer than ${String(MAX_RELEASE_URL_LENGTH)} characters`,
    });
  });

  it('unsigned by D-47: installs a release asset that carries no signature, including one whose bundle and sha512 were replaced together', async () => {
    let answer = packageText();
    const r = rig(() => Promise.resolve(new Response(answer)));

    // The package carries no signature, and lwplugin/1 has no field for one.
    const plain = packageObject();
    expect(Object.keys(plain).sort()).toEqual(['bundle', 'format', 'manifest']);
    expect(Object.keys(plain.manifest as Json).sort()).toEqual(['entry', 'hostApiVersion', 'id', 'sha512', 'title', 'version']);
    expect(await r.installRelease(ALLOWED)).toMatchObject({ ok: true, value: { id: 'mail', version: '1.0.0', status: 'enabled' } });

    // A later release from the same organisation whose bundle was replaced, with
    // its sha512 recomputed to match: installed, and served. Nothing at this
    // door can tell who built it; D-47 leaves that to the source restriction.
    const substituted = 'export default { id: "mail", substituted: true };\n';
    answer = packageText({ version: '1.0.1', sha512: hashOf(substituted) }, substituted);
    const nextRelease = ALLOWED.replaceAll('v1.0.0', 'v1.0.1');
    expect(await r.installRelease(nextRelease)).toMatchObject({ ok: true, value: { version: '1.0.1', status: 'enabled' } });
    const served = r.store.entryFor('mail', '1.0.1');
    expect(served.ok && new TextDecoder().decode(served.value)).toBe(substituted);

    // What does stand: the manifest sha512 refuses a bundle it does not match.
    answer = packageText({ version: '1.0.2', sha512: hashOf(BUNDLE) }, substituted);
    expect(await r.installRelease(ALLOWED.replaceAll('v1.0.0', 'v1.0.2'))).toEqual({
      ok: false,
      reason: expect.stringContaining('the bundle does not match the manifest sha512'),
    });

    // And a package that brings a signature is refused, not verified: there is
    // no field for it, so nothing reads one.
    answer = JSON.stringify({ ...packageObject({ version: '1.0.3' }), signature: 'ed25519:AAAA' });
    expect(await r.installRelease(ALLOWED.replaceAll('v1.0.0', 'v1.0.3'))).toEqual({
      ok: false,
      reason: 'the package was refused: package has a field lwplugin/1 does not define: "signature"',
    });

    expect(r.installed()).toEqual(['mail 1.0.1 enabled']);
  });

  it('asks for the admitted URL with redirects enabled, and installs a package that arrives in several chunks', async () => {
    const bytes = new TextEncoder().encode(packageText());
    const third = Math.ceil(bytes.byteLength / 3);
    const r = rig(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let at = 0; at < bytes.byteLength; at += third) controller.enqueue(bytes.slice(at, at + third));
              controller.close();
            },
          }),
        ),
      ),
    );
    expect(await r.installRelease(ALLOWED)).toMatchObject({ ok: true, value: { id: 'mail', status: 'enabled' } });
    expect(r.fetched).toHaveLength(1);
    const [call] = r.fetched;
    expect(call?.url).toBe(ALLOWED);
    expect(call?.redirect).toBe('follow');
    // The request is released once the download has ended.
    expect(call?.signal.aborted).toBe(true);
  });

  it('refuses an error status, an oversized download and an empty response, and installs nothing', async () => {
    const MIB = 1024 * 1024;
    let pulls = 0;
    const answers: Array<() => Response> = [
      () => new Response('Not Found', { status: 404 }),
      () => new Response('{}', { headers: { 'content-length': String(MAX_PACKAGE_BYTES + 1) } }),
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              controller.enqueue(new Uint8Array(MIB));
            },
          }),
        ),
      () => new Response(null, { status: 200 }),
    ];
    const r = rig(() => Promise.resolve((answers.shift() as () => Response)()));

    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: 'the download was refused: the server answered 404',
    });
    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: `the download was refused: it declares ${String(MAX_PACKAGE_BYTES + 1)} bytes; the limit is ${String(MAX_PACKAGE_BYTES)}`,
    });
    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: `the download was refused: it is more than ${String(MAX_PACKAGE_BYTES)} bytes`,
    });
    // An endless body was read one chunk past the bound and no further. The
    // stream may queue one chunk ahead of the reader, so at most one more pull.
    expect(pulls).toBeGreaterThanOrEqual(MAX_PACKAGE_BYTES / MIB + 1);
    expect(pulls).toBeLessThanOrEqual(MAX_PACKAGE_BYTES / MIB + 2);
    expect(r.fetched[2]?.signal.aborted).toBe(true);
    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: 'the download was refused: the response carried no body',
    });

    expect(r.fetched).toHaveLength(4);
    expect(existsSync(join(r.root, STATE_FILE))).toBe(false);
  });

  it('gives up on a download that does not finish in time', async () => {
    const r = rig(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason);
          });
        }),
      20,
    );
    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: 'the download failed: it did not finish within 20 ms',
    });
    expect(existsSync(join(r.root, STATE_FILE))).toBe(false);
  });

  it('gives up on a download whose fetch call never settles and never touches the signal', async () => {
    // Unlike the cooperative fake above (which listens for 'abort' itself)
    // and the read-side fake below (whose fetch resolves immediately), this
    // fake's fetch never resolves, never rejects, and never reads `init` at
    // all — the timer must end the download on its own, before `fetch` even
    // returns a response, not only once a body reader exists.
    const r = rig(() => new Promise<Response>(() => undefined), 20);
    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: 'the download failed: it did not finish within 20 ms',
    });
    expect(existsSync(join(r.root, STATE_FILE))).toBe(false);
  });

  it('gives up on a download whose network layer never notices the abort signal', async () => {
    // The headers arrive fine — `fetch` resolves — but the body's own pull()
    // never enqueues, never closes, and never reacts to the signal at all.
    // Nothing here calls `init.signal.addEventListener`, unlike the
    // cooperative fake above: this is the case the timer must end on its own.
    // `cancel` also rejects, so the timeout handler's own cleanup call to it
    // is exercised on its failure path too, and does not itself throw.
    const r = rig(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull: () => new Promise<void>(() => undefined),
              cancel: () => Promise.reject(new Error('the stream refused to cancel')),
            }),
          ),
        ),
      20,
    );
    expect(await r.installRelease(ALLOWED)).toEqual({
      ok: false,
      reason: 'the download failed: it did not finish within 20 ms',
    });
    expect(existsSync(join(r.root, STATE_FILE))).toBe(false);
  });

  it('reports a failed request as a refusal, and installs nothing', async () => {
    const failures: unknown[] = [new TypeError('fetch failed'), 'offline'];
    const r = rig(() => Promise.reject(failures.shift()));
    expect(await r.installRelease(ALLOWED)).toEqual({ ok: false, reason: 'the download failed: fetch failed' });
    expect(await r.installRelease(ALLOWED)).toEqual({ ok: false, reason: 'the download failed: offline' });
    expect(existsSync(join(r.root, STATE_FILE))).toBe(false);
  });

  it('runs one download at a time', async () => {
    let release: (response: Response) => void = () => undefined;
    const r = rig(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const first = r.installRelease(ALLOWED);
    expect(await r.installRelease(ALLOWED)).toEqual({ ok: false, reason: 'a plugin download is already in progress' });
    expect(r.fetched).toHaveLength(1);
    release(new Response(packageText()));
    expect(await first).toMatchObject({ ok: true, value: { id: 'mail' } });

    const second = r.installRelease(ALLOWED);
    release(new Response(packageText()));
    expect(await second).toMatchObject({ ok: true, value: { id: 'mail' } });
    expect(r.fetched).toHaveLength(2);
  });
});
