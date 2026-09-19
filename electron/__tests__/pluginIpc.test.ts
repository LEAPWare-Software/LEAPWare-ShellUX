import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLUGIN_CHANNEL, REFUSED_SENDER_REASON, registerPluginIpc } from '../main/plugins/pluginIpc';
import type { PluginIpcEvent } from '../main/plugins/pluginIpc';
import type { PluginListing, PluginStore, StoreResult } from '../main/plugins/pluginStore';

/**
 * ============================================================================
 * THE PLUGIN-MANAGEMENT CHANNELS (ADR-0006 STEP 4), DRIVEN WITHOUT ELECTRON.
 * ============================================================================
 * `registerPluginIpc` takes `ipcMain`, host chrome's `webContents`, the store
 * and the picker as arguments; here each is a recording fake, and the two
 * "webContents" are two distinct objects, as the two views' are. The comparison
 * under test is the module's own `event.sender !== hostChrome()`.
 *
 * **Not shown here:** that Electron sets `event.sender` to the calling view's
 * `webContents` — that is Electron's contract, not this module's — or that
 * `paneWindow.contentsOf('chrome')` in `index.ts` is host chrome's view; that
 * wiring runs only in the real application.
 * ============================================================================
 */

type Listener = (event: PluginIpcEvent, ...args: unknown[]) => unknown;

const LISTING: PluginListing = {
  id: 'mail',
  version: '1.0.0',
  title: 'Mail',
  icon: null,
  hostApiVersion: '1.0',
  status: 'enabled',
  reason: null,
};

function rig(options: { chrome?: unknown; pick?: () => Promise<string | null> } = {}) {
  const chrome = { view: 'chrome' };
  const extension = { view: 'extension' };
  const handlers = new Map<string, Listener>();
  const calls: string[] = [];
  const warnings: string[] = [];
  const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
  const store: PluginStore = {
    list: () => {
      calls.push('list');
      return ok([LISTING]);
    },
    install: (path) => {
      calls.push(`install ${path}`);
      return ok(LISTING);
    },
    setEnabled: (id, enabled) => {
      calls.push(`setEnabled ${String(id)} ${String(enabled)}`);
      return ok(LISTING);
    },
    remove: (id) => {
      calls.push(`remove ${String(id)}`);
      return ok({ id: String(id) });
    },
    entryFor: () => ok(new Uint8Array()),
  };
  registerPluginIpc({
    ipc: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    },
    hostChrome: () => ('chrome' in options ? options.chrome : chrome),
    store,
    pickPackage:
      options.pick ??
      (() => {
        calls.push('picker');
        return Promise.resolve('picked/mail.lwplugin');
      }),
    warn: (message) => warnings.push(message),
  });
  const invoke = (sender: unknown, channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return Promise.resolve(handler({ sender }, ...args));
  };
  return { chrome, extension, handlers, calls, warnings, invoke };
}

const REFUSED = { ok: false, reason: REFUSED_SENDER_REASON };

describe('the plugin-management channels', () => {
  it('registers the five management channels, and nothing else', () => {
    expect([...rig().handlers.keys()].sort()).toEqual(Object.values(PLUGIN_CHANNEL).sort());
  });

  it('refuses a management call whose sender is the extension surface', async () => {
    const r = rig();
    for (const [channel, args] of [
      [PLUGIN_CHANNEL.list, []],
      [PLUGIN_CHANNEL.install, []],
      [PLUGIN_CHANNEL.enable, ['mail']],
      [PLUGIN_CHANNEL.disable, ['mail']],
      [PLUGIN_CHANNEL.remove, ['mail']],
    ] as const) {
      expect(await r.invoke(r.extension, channel, ...args), channel).toEqual(REFUSED);
    }
    // Refused before the store ran and before a picker opened.
    expect(r.calls).toEqual([]);
    expect(r.warnings).toHaveLength(5);
    expect(r.warnings[0]).toBe(`refused ${PLUGIN_CHANNEL.list}: the sender is not host chrome.`);

    // The same calls from host chrome reach the store: the refusal was the sender.
    expect(await r.invoke(r.chrome, PLUGIN_CHANNEL.list)).toEqual({ ok: true, value: [LISTING] });
    await r.invoke(r.chrome, PLUGIN_CHANNEL.enable, 'mail');
    await r.invoke(r.chrome, PLUGIN_CHANNEL.disable, 'mail');
    await r.invoke(r.chrome, PLUGIN_CHANNEL.remove, 'mail');
    expect(r.calls).toEqual(['list', 'setEnabled mail true', 'setEnabled mail false', 'remove mail']);
  });

  it('refuses every sender when host chrome has no live webContents', async () => {
    const r = rig({ chrome: null });
    expect(await r.invoke(null, PLUGIN_CHANNEL.list)).toEqual(REFUSED);
    expect(await r.invoke(r.chrome, PLUGIN_CHANNEL.list)).toEqual(REFUSED);
    expect(r.calls).toEqual([]);
  });

  it("installs from the path main's picker returns, and takes no path from the renderer", async () => {
    const r = rig();
    // A path smuggled as an argument is ignored: install reads none.
    expect(await r.invoke(r.chrome, PLUGIN_CHANNEL.install, 'renderer/evil.lwplugin')).toEqual({
      ok: true,
      value: LISTING,
    });
    expect(r.calls).toEqual(['picker', 'install picked/mail.lwplugin']);
  });

  it('installs nothing when the picker is cancelled or fails', async () => {
    const cancelled = rig({ pick: () => Promise.resolve(null) });
    expect(await cancelled.invoke(cancelled.chrome, PLUGIN_CHANNEL.install)).toEqual({
      ok: false,
      reason: 'no package was chosen',
    });
    expect(cancelled.calls).toEqual([]);

    const failedWithError = rig({ pick: () => Promise.reject(new Error('no display')) });
    expect(await failedWithError.invoke(failedWithError.chrome, PLUGIN_CHANNEL.install)).toEqual({
      ok: false,
      reason: 'the picker failed: no display',
    });
    const failedWithValue = rig({ pick: () => Promise.reject('gone') });
    expect(await failedWithValue.invoke(failedWithValue.chrome, PLUGIN_CHANNEL.install)).toEqual({
      ok: false,
      reason: 'the picker failed: gone',
    });
  });

  it('opens one picker at a time, and a second one after the first has closed', async () => {
    let resolvePick: (path: string | null) => void = () => undefined;
    const r = rig({
      pick: () =>
        new Promise((resolve) => {
          resolvePick = resolve;
        }),
    });
    const first = r.invoke(r.chrome, PLUGIN_CHANNEL.install);
    expect(await r.invoke(r.chrome, PLUGIN_CHANNEL.install)).toEqual({
      ok: false,
      reason: 'a plugin picker is already open',
    });
    resolvePick(null);
    expect(await first).toEqual({ ok: false, reason: 'no package was chosen' });
    const second = r.invoke(r.chrome, PLUGIN_CHANNEL.install);
    resolvePick('picked/second.lwplugin');
    expect(await second).toEqual({ ok: true, value: LISTING });
    expect(r.calls).toEqual(['install picked/second.lwplugin']);
  });

  it('the preload names every management channel main handles', () => {
    // The preload is a CommonJS realm and cannot import PLUGIN_CHANNEL, so it
    // spells the five names out. This holds the two lists together: a
    // guardrail against an honest rename on one side only.
    const preload = readFileSync(
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'preload', 'index.cts'),
      'utf-8',
    );
    for (const channel of Object.values(PLUGIN_CHANNEL)) expect(preload).toContain(`'${channel}'`);
  });
});
