import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RENDERER_CSP, createRendererHandler } from '../main/rendererCsp';
import { HOST_API_VERSION } from '../main/plugins/hostContract';
import { PACKAGE_ENTRY, PACKAGE_FORMAT, serializeManifest } from '../main/plugins/pluginPackage';
import { createPluginRoute, isPluginRequest, pluginEntryPath } from '../main/plugins/pluginRoute';
import {
  CORRUPT_SUFFIX,
  FILES_CHANGED_REASON,
  MANIFEST_FILE,
  STATE_FILE,
  STATE_FORMAT,
  createPluginStore,
  nodePluginStoreFs,
} from '../main/plugins/pluginStore';
import type { PluginListing, PluginStore, PluginStoreFs, StoreResult } from '../main/plugins/pluginStore';

/**
 * ============================================================================
 * THE PLUGIN STORE AND THE `/plugins/` ROUTE (ADR-0006 STEP 4), ON A REAL DISK.
 * ============================================================================
 * Every case installs real `.lwplugin` files into a fresh temporary directory
 * through `nodePluginStoreFs`, the filesystem production passes, and serves
 * through `createRendererHandler` — the function `index.ts` hands to
 * `protocol.handle` — so a served response is asserted with the
 * Content-Security-Policy the handler puts on it. Packages are hashed with
 * `node:crypto` directly, never with the module's own `sha512Base64`, so a
 * fixture cannot agree with the code under test by construction.
 *
 * Failure paths wrap the real filesystem (`faultyFs`) to throw on one named
 * operation; nothing stubs `node:fs` globally.
 *
 * **Not shown here:** that Chromium imports what this serves, or that it
 * enforces the policy on it — no plugin loads before step 6, and neither is
 * observable outside a browser.
 * ============================================================================
 */

const BUNDLE = 'export default { id: "mail" };\n';

type Json = Record<string, unknown>;

function hashOf(text: string): string {
  return createHash('sha512').update(Buffer.from(text, 'utf-8')).digest('base64');
}

function packageText(manifest: Json = {}, bundle: string = BUNDLE): string {
  return JSON.stringify({
    format: PACKAGE_FORMAT,
    manifest: {
      id: 'mail',
      version: '1.0.0',
      hostApiVersion: HOST_API_VERSION,
      title: 'Mail',
      icon: 'folder',
      entry: PACKAGE_ENTRY,
      sha512: hashOf(bundle),
      ...manifest,
    },
    bundle: Buffer.from(bundle, 'utf-8').toString('base64'),
  });
}

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  readonly base: string;
  readonly root: string;
  readonly dist: string;
  readonly store: PluginStore;
  readonly warnings: string[];
  /** Absolute paths the handler's file fetcher was asked for. */
  readonly fetched: string[];
  readonly serve: (path: string) => Promise<Response>;
  /** Write a package file and return its path. */
  readonly pkg: (name: string, text: string) => string;
  readonly install: (text: string) => PluginListing;
  readonly state: () => Json;
}

/** `state.json.corrupt-` plus the harness clock's time, colons and dots made dashes. */
const CORRUPT_NAME = `${STATE_FILE}${CORRUPT_SUFFIX}2026-09-19T12-00-00-000Z`;

function harness(fs: PluginStoreFs = nodePluginStoreFs, hostVersion = '1.0', reports: string[] = []): Harness {
  const base = mkdtempSync(join(tmpdir(), 'shellux-plugins-'));
  cleanup.push(base);
  const root = join(base, 'userData', 'plugins');
  const dist = join(base, 'dist');
  // A decoy under dist/: if the route ever fell through to the file fetcher,
  // this is what it would serve.
  mkdirSync(join(dist, 'plugins', 'mail', '1.0.0'), { recursive: true });
  writeFileSync(join(dist, 'plugins', 'mail', '1.0.0', 'bundle.js'), 'decoy');
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  const warnings: string[] = [];
  const fetched: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };
  const store = createPluginStore({
    root,
    fs,
    warn,
    hostVersion,
    now: () => new Date('2026-09-19T12:00:00.000Z'),
    report: (message) => reports.push(message),
  });
  const handle = createRendererHandler({
    root: dist,
    fetchFile: (path) => {
      fetched.push(path);
      return Promise.resolve().then(() => new Response(readFileSync(path)));
    },
    warn,
    servePlugin: createPluginRoute(store, warn),
  });
  const pkg = (name: string, text: string): string => {
    const path = join(base, name);
    writeFileSync(path, text);
    return path;
  };
  return {
    base,
    root,
    dist,
    store,
    warnings,
    fetched,
    serve: (path) => handle(new Request(`shellux://renderer${path}`)),
    pkg,
    install: (text) => valueOf(store.install(pkg(`p${String(Math.random()).slice(2)}.lwplugin`, text))),
    state: () => JSON.parse(readFileSync(join(root, STATE_FILE), 'utf-8')) as Json,
  };
}

function valueOf<T>(result: StoreResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function reasonOf(result: StoreResult<unknown>): string {
  if (result.ok) throw new Error('expected a refusal, and the operation succeeded');
  return result.reason;
}

function statusesOf(store: PluginStore): Record<string, string> {
  return Object.fromEntries(valueOf(store.list()).map((plugin) => [plugin.id, plugin.status]));
}

describe('the /plugins/ route', () => {
  it('serves only the entry of an installed, enabled, compatible plugin', async () => {
    const h = harness();
    h.install(packageText());
    const newsBundle = 'export default { id: "news" };\n';
    h.install(packageText({ id: 'news', title: 'News', sha512: hashOf(newsBundle) }, newsBundle));
    valueOf(h.store.setEnabled('news', false));
    // Built against contract 1.1; this host offers 1.0.
    h.install(packageText({ id: 'future', title: 'Future', hostApiVersion: '1.1' }));
    expect(statusesOf(h.store)).toEqual({ future: 'incompatible', mail: 'enabled', news: 'disabled' });

    const served = await h.serve(pluginEntryPath('mail', '1.0.0'));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-security-policy')).toBe(RENDERER_CSP);
    expect(served.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await served.text()).toBe(BUNDLE);

    for (const path of [
      pluginEntryPath('news', '1.0.0'), // installed, disabled
      pluginEntryPath('future', '1.0.0'), // installed, incompatible
      pluginEntryPath('ghost', '1.0.0'), // not installed
      pluginEntryPath('mail', '9.9.9'), // not the installed version
    ]) {
      const refused = await h.serve(path);
      expect(refused.status, path).toBe(404);
      expect(refused.headers.get('content-security-policy'), path).toBe(RENDERER_CSP);
    }

    // The disabled plugin was refused for being disabled, not for anything else.
    valueOf(h.store.setEnabled('news', true));
    expect(await (await h.serve(pluginEntryPath('news', '1.0.0'))).text()).toBe(newsBundle);
    expect(h.fetched).toEqual([]);
  });

  it('answers 404 for every other path under /plugins/, and never reads dist for one', async () => {
    const h = harness();
    h.install(packageText());
    for (const path of [
      '/plugins',
      '/plugins/',
      `/plugins/mail/1.0.0/${MANIFEST_FILE}`,
      `/plugins/${STATE_FILE}`,
      '/plugins/mail/1.0.0/bundle.js/extra',
      '/plugins/mail%2F1.0.0/bundle.js',
      '/plugins/mail/1.0/bundle.js',
      '/plugins/Mail/1.0.0/bundle.js',
      '/plugins/__proto__/1.0.0/bundle.js',
      '/PLUGINS/mail/1.0.0/bundle.js',
      '/plug%69ns/mail/1.0.0/bundle.js',
    ]) {
      const response = await h.serve(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-security-policy'), path).toBe(RENDERER_CSP);
      expect(await response.text(), path).toBe('Not found');
    }
    // The decoy under dist/plugins/ was never asked for.
    expect(h.fetched).toEqual([]);
    // Everything else still goes to dist/.
    expect((await h.serve('/index.html')).status).toBe(200);
    expect(h.fetched).toEqual([join(h.dist, 'index.html')]);
  });

  it('leaves a URL that does not decode to the handler, which refuses it', async () => {
    expect(isPluginRequest('shellux://renderer/plugins/%E0%A4%A')).toBe(false);
    expect(isPluginRequest('not a url')).toBe(false);
    const h = harness();
    expect((await h.serve('/plugins/%E0%A4%A')).status).toBe(403);
    expect(h.fetched).toEqual([]);
  });

  it('refuses to serve an entry changed on disk after install', async () => {
    const h = harness();
    h.install(packageText());
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(200);

    const entry = join(h.root, 'mail', '1.0.0', PACKAGE_ENTRY);
    writeFileSync(entry, 'export default { id: "mail", changed: true };\n');
    const refused = await h.serve(pluginEntryPath('mail', '1.0.0'));
    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-security-policy')).toBe(RENDERER_CSP);

    // D-48's fifth state, recorded in state.json, not a crash.
    const record = (h.state().plugins as Json).mail as Json;
    expect(record.fault).toEqual({ state: 'files-changed', reason: FILES_CHANGED_REASON, at: '2026-09-19T12:00:00.000Z' });
    expect(valueOf(h.store.list())[0]).toMatchObject({ id: 'mail', status: 'files-changed', reason: FILES_CHANGED_REASON });
    expect(h.warnings.join('\n')).toMatch(/bundle\.js does not hash to the recorded sha512/);

    // Putting the bytes back does not un-record it: Reinstall is the action.
    writeFileSync(entry, BUNDLE);
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(404);
    expect(reasonOf(h.store.setEnabled('mail', false))).toBe('mail is files-changed and cannot be disabled');
  });

  it('refuses to serve an entry that is gone, and records the files as changed', async () => {
    const h = harness();
    h.install(packageText());
    rmSync(join(h.root, 'mail', '1.0.0', PACKAGE_ENTRY));
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(404);
    expect(statusesOf(h.store)).toEqual({ mail: 'files-changed' });
  });

  it('refuses to serve when plugin.json was changed on disk, and records the files as changed', async () => {
    const h = harness();
    h.install(packageText());
    const manifestPath = join(h.root, 'mail', '1.0.0', MANIFEST_FILE);
    const installed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Json;
    writeFileSync(manifestPath, JSON.stringify({ ...installed, sha512: hashOf('other') }));
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(404);
    expect(h.warnings.join('\n')).toMatch(/plugin\.json names a different id, version or sha512 than state\.json/);
    expect(statusesOf(h.store)).toEqual({ mail: 'files-changed' });
  });

  it('serves a bundle whose file and state.json record were rewritten together, because state.json is as writable as the bundle', async () => {
    // The honest-pinning case for decision 4's limit: the rehash compares with
    // a hash that sits in the same user-writable directory. Rewrite the bundle,
    // plugin.json and state.json together and the serve passes.
    const h = harness();
    h.install(packageText());
    const substitute = 'export default { id: "mail", substituted: true };\n';
    const dir = join(h.root, 'mail', '1.0.0');
    writeFileSync(join(dir, PACKAGE_ENTRY), substitute);
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf-8')) as Json;
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ ...manifest, sha512: hashOf(substitute) }));
    const state = h.state();
    const plugins = state.plugins as Json;
    writeFileSync(
      join(h.root, STATE_FILE),
      JSON.stringify({ ...state, plugins: { mail: { ...(plugins.mail as Json), sha512: hashOf(substitute) } } }),
    );
    const served = await h.serve(pluginEntryPath('mail', '1.0.0'));
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(substitute);
  });
});

describe('the plugin store', () => {
  it('lays out userData/plugins as ADR-0006 decision 2 fixes, and records the plugin in state.json', () => {
    const h = harness();
    const listing = h.install(packageText());
    expect(listing).toEqual({
      id: 'mail',
      version: '1.0.0',
      title: 'Mail',
      icon: 'folder',
      hostApiVersion: HOST_API_VERSION,
      status: 'enabled',
      reason: null,
    });
    expect(readdirSync(h.root).sort()).toEqual(['mail', STATE_FILE]);
    expect(readdirSync(join(h.root, 'mail', '1.0.0')).sort()).toEqual([PACKAGE_ENTRY, MANIFEST_FILE]);
    expect(readFileSync(join(h.root, 'mail', '1.0.0', PACKAGE_ENTRY), 'utf-8')).toBe(BUNDLE);
    expect(h.state()).toEqual({
      format: STATE_FORMAT,
      plugins: { mail: { version: '1.0.0', enabled: true, sha512: hashOf(BUNDLE), fault: null } },
    });
  });

  it("writes plugin.json from the validated manifest re-serialised, never the package's raw bytes", () => {
    // Two `title` keys: JSON.parse keeps the last, and so must every reader.
    // Were the raw bytes written, "Decoy" would be on disk for some later reader.
    const raw = packageText().replace('"title":"Mail"', '"title":"Decoy","title":"Mail"');
    expect(raw).toContain('"title":"Decoy"');
    const h = harness();
    valueOf(h.store.install(h.pkg('dup.lwplugin', raw)));
    const written = readFileSync(join(h.root, 'mail', '1.0.0', MANIFEST_FILE));
    expect(written.toString('utf-8')).not.toContain('Decoy');
    const validated = {
      id: 'mail',
      version: '1.0.0',
      hostApiVersion: HOST_API_VERSION,
      title: 'Mail',
      entry: PACKAGE_ENTRY,
      sha512: hashOf(BUNDLE),
      icon: 'folder',
    } as const;
    expect(written.toString('utf-8')).toBe(`${JSON.stringify(validated, null, 2)}
`);
    expect(written.toString('utf-8')).toBe(new TextDecoder().decode(serializeManifest(validated)));
  });

  it('refuses a package that fails validation, and writes nothing', () => {
    const h = harness();
    const reason = reasonOf(h.store.install(h.pkg('bad.lwplugin', packageText({}, 'export default {};\n').replace(hashOf('export default {};\n'), hashOf(BUNDLE)))));
    expect(reason).toMatch(/^the package was refused: the bundle does not match the manifest sha512/);
    expect(existsSync(h.root)).toBe(false);
  });

  it('installs an incompatible package, lists it with its reason, and refuses to enable it', () => {
    const h = harness();
    const listing = h.install(packageText({ hostApiVersion: '2.0' }));
    expect(listing).toMatchObject({ status: 'incompatible', reason: 'built for host contract 2, this shell offers 1' });
    expect(reasonOf(h.store.setEnabled('mail', true))).toBe('mail is incompatible and cannot be enabled');
  });

  it('installs an update beside the old version, switches state.json, then deletes the old directory', () => {
    const log: string[] = [];
    const h = harness(faultyFs(log));
    h.install(packageText());
    valueOf(h.store.setEnabled('mail', false));
    log.length = 0;
    const next = 'export default { id: "mail", v: 2 };\n';
    const listing = h.install(packageText({ version: '1.1.0', sha512: hashOf(next) }, next));

    // The disabled switch survives the update.
    expect(listing).toMatchObject({ version: '1.1.0', status: 'disabled' });
    expect(h.state().plugins).toEqual({ mail: { version: '1.1.0', enabled: false, sha512: hashOf(next), fault: null } });
    expect(readdirSync(join(h.root, 'mail'))).toEqual(['1.1.0']);
    // The order: placed beside, state switched, only then the old one deleted.
    const placed = log.findIndex((line) => /^renameSync \.staging-\S+ -> mail\/1\.1\.0$/.test(line));
    const switched = log.indexOf(`renameSync .state.json.tmp -> ${STATE_FILE}`);
    const deleted = log.indexOf('rmSync mail/1.0.0');
    expect(placed).toBeGreaterThanOrEqual(0);
    expect(switched).toBeGreaterThan(placed);
    expect(deleted).toBeGreaterThan(switched);
  });

  it('a reinstall of the same version clears the files-changed state', async () => {
    const h = harness();
    h.install(packageText());
    valueOf(h.store.setEnabled('mail', false));
    writeFileSync(join(h.root, 'mail', '1.0.0', MANIFEST_FILE), '{');
    expect(statusesOf(h.store)).toEqual({ mail: 'files-changed' });

    expect(h.install(packageText())).toMatchObject({ status: 'disabled', reason: null });
    valueOf(h.store.setEnabled('mail', true));
    expect(await (await h.serve(pluginEntryPath('mail', '1.0.0'))).text()).toBe(BUNDLE);
    // No transient directory is left behind.
    expect(readdirSync(h.root).sort()).toEqual(['mail', STATE_FILE]);
  });

  it('removes a plugin: the record first, then its directory', () => {
    const log: string[] = [];
    const h = harness(faultyFs(log));
    h.install(packageText());
    expect(valueOf(h.store.remove('mail'))).toEqual({ id: 'mail' });
    expect(h.state().plugins).toEqual({});
    expect(existsSync(join(h.root, 'mail'))).toBe(false);
    expect(log.indexOf('rmSync mail')).toBeGreaterThan(log.lastIndexOf(`renameSync .state.json.tmp -> ${STATE_FILE}`));
    expect(valueOf(h.store.list())).toEqual([]);
  });

  it('refuses an id that is not installed, or not a string, without touching state.json', () => {
    const h = harness();
    h.install(packageText());
    const before = readFileSync(join(h.root, STATE_FILE), 'utf-8');
    for (const id of ['ghost', '__proto__', 7, null, { id: 'mail' }]) {
      expect(reasonOf(h.store.remove(id))).toBe('no plugin with that id is installed');
      expect(reasonOf(h.store.setEnabled(id, true))).toBe('no plugin with that id is installed');
    }
    expect(readFileSync(join(h.root, STATE_FILE), 'utf-8')).toBe(before);
  });

  it('lists a crashed record as crashed, and neither serves nor toggles it', async () => {
    const h = harness();
    h.install(packageText());
    const state = h.state();
    const mail = (state.plugins as Json).mail as Json;
    const fault = { state: 'crashed', reason: 'the extension view stopped', at: '2026-09-19T00:00:00.000Z' };
    writeFileSync(join(h.root, STATE_FILE), JSON.stringify({ ...state, plugins: { mail: { ...mail, fault } } }));
    expect(valueOf(h.store.list())[0]).toMatchObject({ status: 'crashed', reason: 'the extension view stopped' });
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(404);
    expect(h.warnings.join('\n')).toMatch(/refused mail 1\.0\.0: recorded as crashed/);
    expect(reasonOf(h.store.setEnabled('mail', true))).toBe('mail is crashed and cannot be enabled');
  });

  it('lists a plugin whose plugin.json is gone as files-changed, with nothing it cannot read', () => {
    const h = harness();
    h.install(packageText());
    rmSync(join(h.root, 'mail', '1.0.0', MANIFEST_FILE));
    expect(valueOf(h.store.list())).toEqual([
      {
        id: 'mail',
        version: '1.0.0',
        title: null,
        icon: null,
        hostApiVersion: null,
        status: 'files-changed',
        reason: FILES_CHANGED_REASON,
      },
    ]);
  });

  it('lists nothing when no state.json exists yet', () => {
    expect(valueOf(harness().store.list())).toEqual([]);
  });

  const good = { version: '1.0.0', enabled: true, sha512: hashOf(BUNDLE), fault: null };
  it.each([
    ['not UTF-8 JSON', '{'],
    ['an array', '[]'],
    ['another format', JSON.stringify({ format: 'other/1', plugins: {} })],
    ['an extra top-level key', JSON.stringify({ format: STATE_FORMAT, plugins: {}, extra: 1 })],
    ['plugins not an object', JSON.stringify({ format: STATE_FORMAT, plugins: [] })],
    ['an id outside the pattern', JSON.stringify({ format: STATE_FORMAT, plugins: { 'Mail!': good } })],
    ['a reserved id', `{"format":"${STATE_FORMAT}","plugins":{"__proto__":${JSON.stringify(good)}}}`],
    ['a record that is not an object', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: 1 } })],
    ['a record with an extra key', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, x: 1 } } })],
    ['a version that is not a string', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, version: 1 } } })],
    ['a version outside the pattern', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, version: '1.0' } } })],
    ['enabled not a boolean', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, enabled: 'yes' } } })],
    ['a sha512 that is not a string', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, sha512: 1 } } })],
    ['a sha512 that is not a digest', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, sha512: 'x' } } })],
    ['no fault key', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { version: '1.0.0', enabled: true, sha512: hashOf(BUNDLE) } } })],
    ['a fault that is not an object', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, fault: 'x' } } })],
    ['a fault with an extra key', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, fault: { state: 'crashed', reason: '', at: '', x: 1 } } } })],
    ['a fault in an unknown state', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, fault: { state: 'odd', reason: '', at: '' } } } })],
    ['a fault reason that is not a string', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, fault: { state: 'crashed', reason: 1, at: '' } } } })],
    ['a fault reason over the bound', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, fault: { state: 'crashed', reason: 'x'.repeat(1025), at: '' } } } })],
    ['a fault time that is not a string', JSON.stringify({ format: STATE_FORMAT, plugins: { mail: { ...good, fault: { state: 'files-changed', reason: '', at: 0 } } } })],
  ])('sets aside a state.json that is %s, and starts empty', (_what, text) => {
    const h = harness();
    mkdirSync(h.root, { recursive: true });
    writeFileSync(join(h.root, STATE_FILE), text);
    expect(valueOf(h.store.list())).toEqual([]);
    expect(readFileSync(join(h.root, CORRUPT_NAME), 'utf-8')).toBe(text);
    expect(existsSync(join(h.root, STATE_FILE))).toBe(false);
  });

  it('sets aside a state.json that is not UTF-8 JSON, reports it, and starts empty', async () => {
    const reports: string[] = [];
    const h = harness(nodePluginStoreFs, '1.0', reports);
    h.install(packageText());
    writeFileSync(join(h.root, STATE_FILE), '{');
    // Nothing is served on the word of a state.json that does not validate.
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(404);
    expect(readFileSync(join(h.root, CORRUPT_NAME), 'utf-8')).toBe('{');
    expect(reports).toEqual([
      `plugin store: state.json could not be read (it is not a UTF-8 JSON document); moved to ${join(h.root, CORRUPT_NAME)} and starting with no plugins installed.`,
    ]);
    expect(h.warnings).toContain(reports[0]);
    // Not locked: the store works again, and a reinstall recovers the plugin.
    expect(valueOf(h.store.list())).toEqual([]);
    expect(h.install(packageText()).status).toBe('enabled');
    expect(await (await h.serve(pluginEntryPath('mail', '1.0.0'))).text()).toBe(BUNDLE);
  });

  it('refuses, and overwrites nothing, when a state.json that does not validate cannot be set aside', () => {
    const h = harness(faultyFs([], (op, path) => (op === 'renameSync' && path.startsWith(`${STATE_FILE} -> `) ? new Error('locked') : undefined)));
    mkdirSync(h.root, { recursive: true });
    writeFileSync(join(h.root, STATE_FILE), '[]');
    expect(reasonOf(h.store.list())).toBe(
      'state.json could not be read (it is not a shellux-plugin-state/1 document) and could not be set aside: locked',
    );
    expect(readFileSync(join(h.root, STATE_FILE), 'utf-8')).toBe('[]');
  });

  it('flushes state.json to disk before renaming it into place', () => {
    const log: string[] = [];
    const h = harness(faultyFs(log));
    h.install(packageText());
    const flushed = log.indexOf('fsyncFile .state.json.tmp');
    expect(flushed).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`renameSync .state.json.tmp -> ${STATE_FILE}`)).toBe(flushed + 1);
  });

  it('refuses a state.json that is not a regular file', () => {
    const h = harness();
    mkdirSync(join(h.root, STATE_FILE), { recursive: true });
    expect(reasonOf(h.store.list())).toBe('state.json could not be read: the state.json is not a regular file');
  });

  it('uses the host contract, the clock and a silent report by default', () => {
    const base = mkdtempSync(join(tmpdir(), 'shellux-plugins-'));
    cleanup.push(base);
    const store = createPluginStore({ root: join(base, 'plugins'), fs: nodePluginStoreFs, warn: () => undefined });
    writeFileSync(join(base, 'p.lwplugin'), packageText());
    expect(valueOf(store.install(join(base, 'p.lwplugin'))).status).toBe('enabled');
    writeFileSync(join(base, 'plugins', 'mail', '1.0.0', PACKAGE_ENTRY), 'changed');
    expect(store.entryFor('mail', '1.0.0').ok).toBe(false);
    const fault = (JSON.parse(readFileSync(join(base, 'plugins', STATE_FILE), 'utf-8')) as { plugins: { mail: { fault: { at: string } } } })
      .plugins.mail.fault;
    expect(Number.isNaN(Date.parse(fault.at))).toBe(false);
    // With no diagnostics log given, a set-aside state.json is still set aside.
    writeFileSync(join(base, 'plugins', STATE_FILE), '{');
    expect(valueOf(store.list())).toEqual([]);
    expect(readdirSync(join(base, 'plugins')).some((name) => name.startsWith(`${STATE_FILE}${CORRUPT_SUFFIX}`))).toBe(true);
  });
});

/**
 * The real filesystem, logging every write-side call as `op path` relative to
 * the plugins root, and throwing `fail(op, path)`'s value when it returns one.
 */
function faultyFs(log: string[], fail: (op: string, path: string) => unknown = () => undefined): PluginStoreFs {
  let root: string | null = null;
  const rel = (path: string): string => {
    root ??= path.slice(0, path.lastIndexOf(`${sep}plugins`) + `${sep}plugins`.length);
    return relative(root, path).split(sep).join('/');
  };
  const check = (op: string, relativePath: string): void => {
    const thrown = fail(op, relativePath);
    if (thrown !== undefined) throw thrown;
  };
  return {
    ...nodePluginStoreFs,
    mkdirSync: (path) => {
      check('mkdirSync', rel(path));
      nodePluginStoreFs.mkdirSync(path);
    },
    mkdtempSync: (prefix) => {
      check('mkdtempSync', rel(prefix));
      return nodePluginStoreFs.mkdtempSync(prefix);
    },
    writeFileSync: (path, data) => {
      check('writeFileSync', rel(path));
      nodePluginStoreFs.writeFileSync(path, data);
    },
    fsyncFile: (path) => {
      log.push(`fsyncFile ${rel(path)}`);
      nodePluginStoreFs.fsyncFile(path);
    },
    renameSync: (from, to) => {
      const line = `${rel(from)} -> ${rel(to)}`;
      log.push(`renameSync ${line}`);
      check('renameSync', line);
      nodePluginStoreFs.renameSync(from, to);
    },
    rmSync: (path) => {
      log.push(`rmSync ${rel(path)}`);
      check('rmSync', rel(path));
      nodePluginStoreFs.rmSync(path);
    },
  };
}

describe('the plugin store when the filesystem fails', () => {
  it('removes the staging directory and lists nothing when writing the bundle fails', () => {
    const h = harness(faultyFs([], (op, path) => (op === 'writeFileSync' && path.endsWith(PACKAGE_ENTRY) ? new Error('disk full') : undefined)));
    expect(reasonOf(h.store.install(h.pkg('mail.lwplugin', packageText())))).toBe('the plugin could not be installed: disk full');
    expect(readdirSync(h.root)).toEqual(['mail']);
    expect(readdirSync(join(h.root, 'mail'))).toEqual([]);
    expect(valueOf(h.store.list())).toEqual([]);
  });

  it('refuses when the plugin directory cannot be created, with nothing staged', () => {
    const h = harness(faultyFs([], (op) => (op === 'mkdirSync' ? 'denied' : undefined)));
    expect(reasonOf(h.store.install(h.pkg('mail.lwplugin', packageText())))).toBe('the plugin could not be installed: denied');
  });

  it('puts the old files back when state.json cannot be written during a reinstall', () => {
    let failState = false;
    const h = harness(
      faultyFs([], (op, path) => (failState && op === 'writeFileSync' && path === '.state.json.tmp' ? new Error('read-only') : undefined)),
    );
    h.install(packageText());
    const before = readFileSync(join(h.root, STATE_FILE), 'utf-8');
    failState = true;
    expect(reasonOf(h.store.install(h.pkg('again.lwplugin', packageText())))).toBe(
      'the plugin could not be installed: state.json could not be written: read-only',
    );
    expect(readFileSync(join(h.root, STATE_FILE), 'utf-8')).toBe(before);
    expect(readFileSync(join(h.root, 'mail', '1.0.0', PACKAGE_ENTRY), 'utf-8')).toBe(BUNDLE);
    expect(readdirSync(h.root).sort()).toEqual(['mail', STATE_FILE]);
  });

  it('says so when the old files cannot be put back', () => {
    let failing = false;
    const h = harness(
      faultyFs([], (op, path) => {
        if (!failing) return undefined;
        if (op === 'writeFileSync' && path === '.state.json.tmp') return new Error('read-only');
        if (op === 'renameSync' && /^\.retired-\S+ -> mail\/1\.0\.0$/.test(path)) return new Error('locked');
        return undefined;
      }),
    );
    h.install(packageText());
    failing = true;
    expect(h.store.install(h.pkg('again.lwplugin', packageText())).ok).toBe(false);
    expect(h.warnings.join('\n')).toMatch(/could not restore .*1\.0\.0: locked/);
  });

  it('says so, and still succeeds, when an old directory cannot be deleted', () => {
    const h = harness(faultyFs([], (op) => (op === 'rmSync' ? new Error('busy') : undefined)));
    h.install(packageText());
    expect(valueOf(h.store.remove('mail'))).toEqual({ id: 'mail' });
    expect(h.warnings.join('\n')).toMatch(/could not delete .*mail: busy/);
  });

  it('refuses the serve, and says so, when the files-changed record cannot be written', async () => {
    let failState = false;
    const h = harness(
      faultyFs([], (op, path) => (failState && op === 'writeFileSync' && path === '.state.json.tmp' ? new Error('read-only') : undefined)),
    );
    h.install(packageText());
    writeFileSync(join(h.root, 'mail', '1.0.0', PACKAGE_ENTRY), 'changed');
    failState = true;
    expect((await h.serve(pluginEntryPath('mail', '1.0.0'))).status).toBe(404);
    expect(h.warnings.join('\n')).toMatch(/state\.json could not be written: read-only/);
  });

  it('refuses a toggle when state.json cannot be written', () => {
    let failState = false;
    const h = harness(
      faultyFs([], (op, path) => (failState && op === 'writeFileSync' && path === '.state.json.tmp' ? new Error('read-only') : undefined)),
    );
    h.install(packageText());
    failState = true;
    expect(reasonOf(h.store.setEnabled('mail', false))).toBe('state.json could not be written: read-only');
    expect(statusesOf(h.store)).toEqual({ mail: 'enabled' });
  });
});
