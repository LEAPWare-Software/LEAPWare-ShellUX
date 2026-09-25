import { fetchReleaseAsset } from './releaseSource.js';
import type { ReleaseDownloadResult, ReleaseFetch } from './releaseSource.js';
import type { PluginListing, PluginStore, StoreResult } from './pluginStore.js';

/**
 * ============================================================================
 * PLUGIN MANAGEMENT OVER IPC: ACCEPTED ONLY FROM HOST CHROME.
 * ============================================================================
 * ADR-0006 decision 6, implementation steps 4 and 11. Six calls — list,
 * install from the picker, install from a GitHub Release URL, enable, disable,
 * remove — each an `ipcMain.handle` channel.
 *
 * **The sender check is ENTRY-POINT VALIDATION at the IPC door.** Both views
 * load one preload, so `shelluxHost.plugins` exists in the extension surface
 * too, where every plugin runs. Every call here compares `event.sender` with
 * host chrome's `webContents`, read from the live window at the moment of the
 * call, and refuses anything else — the extension surface, a destroyed view, no
 * window — before a store operation runs, a picker opens or a request is made.
 * *Tests:* `electron/__tests__/pluginIpc.test.ts` — "refuses a management call
 * whose sender is the extension surface". It is real at this door and says
 * nothing about the filesystem, which is decision 4's door (`pluginStore.ts`),
 * nor about host chrome's own document: whatever runs there passes it, and host
 * chrome runs no plugin code only because it registers no extension
 * (ADR-0006 decision 6), not because of anything checked here.
 *
 * **Install takes no argument.** Main opens the picker (`pickPackage`, injected;
 * `index.ts` passes `dialog.showOpenDialog`) and the path it returns goes to
 * the store; a renderer never names a path. One picker at a time: a second
 * install while one is open is refused rather than stacked. *Tests:*
 * `electron/__tests__/pluginIpc.test.ts` — "installs from the path main's
 * picker returns, and takes no path from the renderer".
 *
 * **Install from a release takes one string, and main checks it before it
 * fetches.** Decision 2's second source. There is no URL to pick in a native
 * dialog, so the string has to come from host chrome; it goes to
 * `fetchReleaseAsset` (`releaseSource.ts`), which holds it to the
 * LEAPWare-Software allowlist and only then calls `fetchAsset` (`index.ts`
 * passes `net.fetch`). The downloaded bytes go to `store.installBytes`. One
 * download at a time, as one picker at a time. *Tests:*
 * `electron/__tests__/pluginReleaseSource.test.ts` — "refuses a URL outside the
 * LEAPWare-Software organisation", "runs one download at a time".
 * ============================================================================
 */

export const PLUGIN_CHANNEL = Object.freeze({
  list: 'shellux:plugins:list',
  install: 'shellux:plugins:install',
  installRelease: 'shellux:plugins:install-release',
  enable: 'shellux:plugins:enable',
  disable: 'shellux:plugins:disable',
  remove: 'shellux:plugins:remove',
} as const);

/** What the sender check reads off an `IpcMainInvokeEvent`, and nothing else. */
export interface PluginIpcEvent {
  readonly sender: unknown;
}

/** The part of `ipcMain` this module uses. */
export interface PluginIpcMain {
  handle(channel: string, listener: (event: PluginIpcEvent, ...args: unknown[]) => unknown): void;
}

export interface PluginIpcOptions {
  readonly ipc: PluginIpcMain;
  /** Host chrome's live `webContents`, or `null` when there is no window or it is destroyed. */
  readonly hostChrome: () => unknown;
  readonly store: PluginStore;
  /** Open main's file picker; resolves to the chosen path, or `null` when cancelled. */
  readonly pickPackage: () => Promise<string | null>;
  /** Main's network request, reached only with a URL the allowlist admitted. */
  readonly fetchAsset: ReleaseFetch;
  /** How long a release download may take; `releaseSource.ts`'s default when absent. */
  readonly downloadTimeoutMs?: number;
  readonly warn: (message: string) => void;
}

export const REFUSED_SENDER_REASON = 'plugin management is accepted only from host chrome';

export function registerPluginIpc(options: PluginIpcOptions): void {
  const { ipc, hostChrome, store, pickPackage, fetchAsset, downloadTimeoutMs, warn } = options;
  let picking = false;
  let downloading = false;

  function guarded<T>(channel: string, run: (args: readonly unknown[]) => StoreResult<T> | Promise<StoreResult<T>>): void {
    ipc.handle(channel, (event, ...args) => {
      const chrome = hostChrome();
      if (chrome === null || event.sender !== chrome) {
        warn(`refused ${channel}: the sender is not host chrome.`);
        return { ok: false, reason: REFUSED_SENDER_REASON };
      }
      return run(args);
    });
  }

  guarded(PLUGIN_CHANNEL.list, () => store.list());
  guarded(PLUGIN_CHANNEL.install, async (): Promise<StoreResult<PluginListing>> => {
    if (picking) return { ok: false, reason: 'a plugin picker is already open' };
    picking = true;
    let path: string | null;
    try {
      path = await pickPackage();
    } catch (error) {
      return { ok: false, reason: `the picker failed: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      picking = false;
    }
    if (path === null) return { ok: false, reason: 'no package was chosen' };
    return store.install(path);
  });
  guarded(PLUGIN_CHANNEL.installRelease, async ([url]): Promise<StoreResult<PluginListing>> => {
    if (downloading) return { ok: false, reason: 'a plugin download is already in progress' };
    downloading = true;
    let download: ReleaseDownloadResult;
    try {
      download = await fetchReleaseAsset(url, fetchAsset, downloadTimeoutMs);
    } finally {
      downloading = false;
    }
    if (!download.ok) return download;
    return store.installBytes(download.bytes);
  });
  guarded(PLUGIN_CHANNEL.enable, ([id]) => store.setEnabled(id, true));
  guarded(PLUGIN_CHANNEL.disable, ([id]) => store.setEnabled(id, false));
  guarded(PLUGIN_CHANNEL.remove, ([id]) => store.remove(id));
}
